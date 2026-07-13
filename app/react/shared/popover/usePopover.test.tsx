/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the shared {@link usePopover} hook (`./usePopover.ts`).
 *
 * `usePopover` is the single source of inline-popover behavior for the migrated
 * Backlog/Kanban leaves. It enforces the legacy single-active-popover invariant
 * GLOBALLY (a module-level registry closes any other open popover when one
 * opens), dismisses on outside pointer-down and on Escape (restoring focus to
 * the trigger), and moves focus to the first actionable item on open.
 *
 * The tests drive a small harness component that wires the hook's trigger and
 * content refs to real DOM nodes, then assert on open/closed state and focus.
 * The module-level registry is reset via `__resetPopoverRegistry()` in
 * `afterEach` so state never leaks across tests.
 */

import { render, fireEvent } from "@testing-library/react";
import { usePopover, __resetPopoverRegistry } from "./usePopover";

/**
 * Harness exposing one `usePopover` instance as a trigger button + a content
 * panel (rendered only while open). `label` distinguishes instances in the
 * cross-instance tests.
 */
function Harness(props: { label?: string }): JSX.Element {
    const pop = usePopover();
    const label = props.label ?? "pop";
    return (
        <div>
            <button
                type="button"
                data-testid={`trigger-${label}`}
                ref={(el) => {
                    pop.triggerRef.current = el;
                }}
                onClick={() => pop.toggle()}
            >
                trigger
            </button>
            {pop.open ? (
                <ul
                    data-testid={`content-${label}`}
                    className="popover active"
                    ref={(el) => {
                        pop.contentRef.current = el;
                    }}
                >
                    <li>
                        <a href="" data-testid={`item-${label}`}>
                            item
                        </a>
                    </li>
                </ul>
            ) : null}
            <button type="button" data-testid={`close-${label}`} onClick={() => pop.close()}>
                close
            </button>
        </div>
    );
}

afterEach(() => {
    __resetPopoverRegistry();
});

describe("usePopover", () => {
    it("starts closed and toggles open/closed", () => {
        const { queryByTestId, getByTestId } = render(<Harness />);
        expect(queryByTestId("content-pop")).toBeNull();

        fireEvent.click(getByTestId("trigger-pop"));
        expect(queryByTestId("content-pop")).not.toBeNull();

        fireEvent.click(getByTestId("trigger-pop"));
        expect(queryByTestId("content-pop")).toBeNull();
    });

    it("moves focus to the first actionable item on open", () => {
        const { getByTestId } = render(<Harness />);
        fireEvent.click(getByTestId("trigger-pop"));
        expect(document.activeElement).toBe(getByTestId("item-pop"));
    });

    it("closes via the close() action", () => {
        const { getByTestId, queryByTestId } = render(<Harness />);
        fireEvent.click(getByTestId("trigger-pop"));
        expect(queryByTestId("content-pop")).not.toBeNull();

        fireEvent.click(getByTestId("close-pop"));
        expect(queryByTestId("content-pop")).toBeNull();
    });

    it("enforces a single active popover across instances", () => {
        const { getByTestId, queryByTestId } = render(
            <>
                <Harness label="a" />
                <Harness label="b" />
            </>,
        );

        fireEvent.click(getByTestId("trigger-a"));
        expect(queryByTestId("content-a")).not.toBeNull();

        // Opening B closes A.
        fireEvent.click(getByTestId("trigger-b"));
        expect(queryByTestId("content-b")).not.toBeNull();
        expect(queryByTestId("content-a")).toBeNull();
    });

    it("closes on an outside pointer-down", () => {
        const { getByTestId, queryByTestId } = render(<Harness />);
        fireEvent.click(getByTestId("trigger-pop"));
        expect(queryByTestId("content-pop")).not.toBeNull();

        fireEvent.mouseDown(document.body);
        expect(queryByTestId("content-pop")).toBeNull();
    });

    it("does not close on a pointer-down inside the content", () => {
        const { getByTestId, queryByTestId } = render(<Harness />);
        fireEvent.click(getByTestId("trigger-pop"));
        fireEvent.mouseDown(getByTestId("content-pop"));
        expect(queryByTestId("content-pop")).not.toBeNull();
    });

    it("does not close on a pointer-down on the trigger (the trigger owns toggling)", () => {
        const { getByTestId, queryByTestId } = render(<Harness />);
        fireEvent.click(getByTestId("trigger-pop"));
        fireEvent.mouseDown(getByTestId("trigger-pop"));
        expect(queryByTestId("content-pop")).not.toBeNull();
    });

    it("closes on Escape and restores focus to the trigger", () => {
        const { getByTestId, queryByTestId } = render(<Harness />);
        fireEvent.click(getByTestId("trigger-pop"));
        expect(queryByTestId("content-pop")).not.toBeNull();

        fireEvent.keyDown(document, { key: "Escape" });
        expect(queryByTestId("content-pop")).toBeNull();
        expect(document.activeElement).toBe(getByTestId("trigger-pop"));
    });

    it("releases the registry when the open popover unmounts", () => {
        const { getByTestId, queryByTestId, unmount } = render(<Harness label="a" />);
        fireEvent.click(getByTestId("trigger-a"));
        expect(queryByTestId("content-a")).not.toBeNull();

        // Unmounting the open popover must clear the module registry so the next
        // mounted popover can open without a stale close handler interfering.
        unmount();
        const second = render(<Harness label="b" />);
        fireEvent.click(second.getByTestId("trigger-b"));
        expect(second.queryByTestId("content-b")).not.toBeNull();
    });

    it("__resetPopoverRegistry clears the active close handler", () => {
        const first = render(<Harness label="a" />);
        fireEvent.click(first.getByTestId("trigger-a"));
        expect(first.queryByTestId("content-a")).not.toBeNull();

        __resetPopoverRegistry();

        // With the registry cleared, opening B does NOT attempt to close the
        // (now-orphaned) A handler; both simply reflect their own state.
        const second = render(<Harness label="b" />);
        fireEvent.click(second.getByTestId("trigger-b"));
        expect(second.queryByTestId("content-b")).not.toBeNull();
    });
});
