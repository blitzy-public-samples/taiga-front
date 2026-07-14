/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { usePendingDelete } from "./usePendingDelete";

/**
 * C7 confirm-before-delete controller. Verifies that NOTHING mutates until the
 * user confirms, that cancel is a pure no-op, that the modal closes once the
 * delete settles (success AND failure — legacy `askResponse.finish()` /
 * `finish(false)`), and that the busy guard rejects re-entrancy.
 */
describe("usePendingDelete (C7 confirm-before-delete controller)", () => {
    it("starts closed and idle", () => {
        const run = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => usePendingDelete<number>(run));
        expect(result.current.pending).toBeNull();
        expect(result.current.busy).toBe(false);
    });

    it("request() opens the modal WITHOUT running the delete", () => {
        const run = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => usePendingDelete<number>(run));
        act(() => result.current.request(7, "My story"));
        expect(result.current.pending).toEqual({ target: 7, subject: "My story" });
        expect(run).not.toHaveBeenCalled();
    });

    it("cancel() closes the modal without running the delete", () => {
        const run = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => usePendingDelete<number>(run));
        act(() => result.current.request(7, "My story"));
        act(() => result.current.cancel());
        expect(result.current.pending).toBeNull();
        expect(run).not.toHaveBeenCalled();
    });

    it("confirm() runs the delete for the pending target, then closes", async () => {
        const run = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => usePendingDelete<number>(run));
        act(() => result.current.request(7, "My story"));
        await act(async () => {
            result.current.confirm();
        });
        await waitFor(() => expect(result.current.pending).toBeNull());
        expect(run).toHaveBeenCalledWith(7);
        expect(result.current.busy).toBe(false);
    });

    it("confirm() closes even when run REJECTS (legacy finish(false))", async () => {
        const run = jest.fn().mockRejectedValue(new Error("boom"));
        const { result } = renderHook(() => usePendingDelete<number>(run));
        act(() => result.current.request(7, "My story"));
        await act(async () => {
            result.current.confirm();
        });
        await waitFor(() => expect(result.current.pending).toBeNull());
        expect(run).toHaveBeenCalledWith(7);
        expect(result.current.busy).toBe(false);
    });

    it("confirm() is a no-op when nothing is pending", async () => {
        const run = jest.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => usePendingDelete<number>(run));
        await act(async () => {
            result.current.confirm();
        });
        expect(run).not.toHaveBeenCalled();
        expect(result.current.pending).toBeNull();
    });

    it("marks busy while in flight and IGNORES a second confirm + cancel until it settles", async () => {
        let resolveRun: () => void = () => {};
        const run = jest.fn().mockImplementation(
            () =>
                new Promise<void>((res) => {
                    resolveRun = res;
                }),
        );
        const { result } = renderHook(() => usePendingDelete<number>(run));
        act(() => result.current.request(7, "My story"));

        // Kick off the confirmed delete and let the scheduling microtask invoke
        // `run` (which captures `resolveRun`).
        await act(async () => {
            result.current.confirm();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(result.current.busy).toBe(true);
        expect(run).toHaveBeenCalledTimes(1);

        // Re-entrant confirm + cancel are ignored while a delete is in flight.
        act(() => {
            result.current.confirm();
            result.current.cancel();
        });
        expect(result.current.pending).not.toBeNull();
        expect(run).toHaveBeenCalledTimes(1);

        // Settle -> the modal closes and busy clears.
        await act(async () => {
            resolveRun();
            await Promise.resolve();
        });
        await waitFor(() => expect(result.current.pending).toBeNull());
        expect(result.current.busy).toBe(false);
    });

    it("request() is ignored while a delete is in flight (double-trigger safety)", async () => {
        let resolveRun: () => void = () => {};
        const run = jest.fn().mockImplementation(
            () =>
                new Promise<void>((res) => {
                    resolveRun = res;
                }),
        );
        const { result } = renderHook(() => usePendingDelete<number>(run));
        act(() => result.current.request(1, "first"));
        await act(async () => {
            result.current.confirm();
            await Promise.resolve();
            await Promise.resolve();
        });
        // A new request while busy must not replace the in-flight target.
        act(() => result.current.request(2, "second"));
        expect(result.current.pending?.target).toBe(1);

        await act(async () => {
            resolveRun();
            await Promise.resolve();
        });
        await waitFor(() => expect(result.current.pending).toBeNull());
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(1);
    });
});
