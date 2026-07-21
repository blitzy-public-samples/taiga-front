/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    loadColumnFolds,
    loadKanbanFilters,
    loadSwimlaneFolds,
    saveColumnFolds,
    saveKanbanFilters,
    saveSwimlaneFolds,
} from "../persistence";

/**
 * Unit specs for the Kanban view-preference persistence layer (QA-FUNC-03
 * column/swimlane fold modes, QA-FUNC-09 sidebar filters + search query).
 *
 * The board is React-only, so byte-exact key hashing is not asserted; the
 * contract under test is: per-project isolation, round-trip fidelity, graceful
 * degradation on absent/malformed data, and best-effort behavior when
 * localStorage is unavailable.
 */

interface TestFilter {
    id: string;
    name: string;
    dataType: string;
    color?: string;
}

describe("kanban/persistence", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
        jest.restoreAllMocks();
    });

    describe("column fold modes (QA-FUNC-03)", () => {
        it("round-trips a numeric-keyed fold record for a project", () => {
            saveColumnFolds(7, { 1: true, 2: false, 6: true });

            expect(loadColumnFolds(7)).toEqual({ 1: true, 2: false, 6: true });
        });

        it("returns null when nothing is stored", () => {
            expect(loadColumnFolds(7)).toBeNull();
        });

        it("isolates storage per project id", () => {
            saveColumnFolds(7, { 1: true });
            saveColumnFolds(8, { 1: false });

            expect(loadColumnFolds(7)).toEqual({ 1: true });
            expect(loadColumnFolds(8)).toEqual({ 1: false });
        });

        it("coerces string JSON keys back to finite numbers", () => {
            // localStorage always serializes object keys as strings.
            expect(loadColumnFolds(7)).toBeNull();
            saveColumnFolds(7, { 3: true });
            const restored = loadColumnFolds(7);
            expect(restored).not.toBeNull();
            // Numeric indexing must work on the restored record.
            expect((restored as Record<number, boolean>)[3]).toBe(true);
        });

        it("returns null for malformed stored JSON", () => {
            window.localStorage.setItem(
                "kanban-statuscolumn-modes.7",
                "not-valid-json{",
            );

            expect(loadColumnFolds(7)).toBeNull();
        });

        it("returns null when the stored value is a JSON array (not an object)", () => {
            window.localStorage.setItem(
                "kanban-statuscolumn-modes.7",
                JSON.stringify([1, 2, 3]),
            );

            expect(loadColumnFolds(7)).toBeNull();
        });

        it("does not read or write for a non-finite project id", () => {
            const setSpy = jest.spyOn(Storage.prototype, "setItem");

            saveColumnFolds(Number.NaN, { 1: true });
            expect(setSpy).not.toHaveBeenCalled();
            expect(loadColumnFolds(Number.NaN)).toBeNull();
        });

        it("degrades gracefully when localStorage.getItem throws", () => {
            saveColumnFolds(7, { 1: true });
            jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
                throw new Error("localStorage unavailable");
            });

            expect(loadColumnFolds(7)).toBeNull();
        });

        it("swallows a throwing localStorage.setItem (best-effort)", () => {
            jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
                throw new Error("quota exceeded");
            });

            expect(() => saveColumnFolds(7, { 1: true })).not.toThrow();
        });
    });

    describe("swimlane fold modes (QA-FUNC-03)", () => {
        it("round-trips a swimlane fold record", () => {
            saveSwimlaneFolds(7, { 10: true, 20: false });

            expect(loadSwimlaneFolds(7)).toEqual({ 10: true, 20: false });
        });

        it("uses a key distinct from the column fold key", () => {
            saveColumnFolds(7, { 1: true });
            saveSwimlaneFolds(7, { 1: false });

            // The two stores must not clobber each other.
            expect(loadColumnFolds(7)).toEqual({ 1: true });
            expect(loadSwimlaneFolds(7)).toEqual({ 1: false });
        });

        it("returns null when nothing is stored", () => {
            expect(loadSwimlaneFolds(7)).toBeNull();
        });
    });

    describe("sidebar filters + search query (QA-FUNC-09)", () => {
        const selection: TestFilter[] = [
            { id: "5", name: "Carol", dataType: "assigned_users" },
            { id: "9", name: "urgent", dataType: "tags", color: "#f00" },
        ];

        // Legacy parity (controllerMixins.coffee `getFilters` L131): the mixin
        // does `delete data.q` before returning, so the search query is NEVER
        // restored on load — only the `selected` sidebar chips are. `saveKanban-
        // Filters` still persists `q` (harmless), but `loadKanbanFilters` always
        // returns `q: ""`.
        it("restores selected filters but strips the search query on load", () => {
            saveKanbanFilters<TestFilter>(7, { q: "login", selected: selection });

            expect(loadKanbanFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: selection,
            });
        });

        it("always returns q:\"\" even when a non-empty q was stored (delete data.q)", () => {
            window.localStorage.setItem(
                "kanban-filters.7",
                JSON.stringify({ q: "should-be-dropped", selected: selection }),
            );

            expect(loadKanbanFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: selection,
            });
        });

        it("returns null when nothing is stored", () => {
            expect(loadKanbanFilters<TestFilter>(7)).toBeNull();
        });

        it("isolates filter storage per project id", () => {
            saveKanbanFilters<TestFilter>(7, { q: "a", selected: [] });
            saveKanbanFilters<TestFilter>(8, { q: "b", selected: selection });

            // The `selected` selection is project-scoped; `q` is dropped on load.
            expect(loadKanbanFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: [],
            });
            expect(loadKanbanFilters<TestFilter>(8)).toEqual({
                q: "",
                selected: selection,
            });
        });

        it("degrades a missing q to an empty string", () => {
            window.localStorage.setItem(
                "kanban-filters.7",
                JSON.stringify({ selected: selection }),
            );

            expect(loadKanbanFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: selection,
            });
        });

        it("degrades a missing/invalid selected to an empty array", () => {
            window.localStorage.setItem(
                "kanban-filters.7",
                JSON.stringify({ q: "x", selected: "not-an-array" }),
            );

            // `q` is stripped on load regardless of what was stored.
            expect(loadKanbanFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: [],
            });
        });

        it("returns null for malformed stored JSON", () => {
            window.localStorage.setItem("kanban-filters.7", "}{bad");

            expect(loadKanbanFilters<TestFilter>(7)).toBeNull();
        });

        it("does not write for a non-finite project id", () => {
            const setSpy = jest.spyOn(Storage.prototype, "setItem");

            saveKanbanFilters<TestFilter>(Number.NaN, {
                q: "x",
                selected: selection,
            });
            expect(setSpy).not.toHaveBeenCalled();
        });
    });
});
