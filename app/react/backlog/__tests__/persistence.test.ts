/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { loadBacklogFilters, saveBacklogFilters } from "../persistence";

/**
 * Unit specs for the Backlog sidebar-filter persistence layer (QA finding #4:
 * the active quick-filter selection must survive a reload).
 *
 * The board is React-only, so byte-exact key hashing is not asserted; the
 * contract under test is: per-project isolation, round-trip fidelity of the
 * `selected` selection, the legacy `delete data.q` search-query stripping on
 * load, graceful degradation on absent/malformed data, and best-effort behavior
 * when localStorage is unavailable. This mirrors the Kanban persistence specs so
 * BOTH migrated screens are proven to treat a reload identically.
 */

interface TestFilter {
    id: string;
    name: string;
    dataType: string;
    color?: string;
}

describe("backlog/persistence", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
        jest.restoreAllMocks();
    });

    describe("sidebar filters + search query (QA finding #4)", () => {
        const selection: TestFilter[] = [
            { id: "5", name: "Carol", dataType: "assigned_users" },
            { id: "9", name: "urgent", dataType: "tags", color: "#f00" },
        ];

        // Legacy parity (controllerMixins.coffee `getFilters` L131): the mixin
        // does `delete data.q` before returning, so the search query is NEVER
        // restored on load — only the `selected` sidebar chips are.
        // `saveBacklogFilters` still persists `q` (harmless), but
        // `loadBacklogFilters` always returns `q: ""`.
        it("restores selected filters but strips the search query on load", () => {
            saveBacklogFilters<TestFilter>(7, { q: "login", selected: selection });

            expect(loadBacklogFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: selection,
            });
        });

        it("always returns q:\"\" even when a non-empty q was stored (delete data.q)", () => {
            window.localStorage.setItem(
                "backlog-filters.7",
                JSON.stringify({ q: "should-be-dropped", selected: selection }),
            );

            expect(loadBacklogFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: selection,
            });
        });

        it("writes the whole payload (including q) but reads it back with q dropped", () => {
            saveBacklogFilters<TestFilter>(7, { q: "typed", selected: selection });

            // The raw stored value keeps `q` (mirrors `storeFilters`)...
            const raw = window.localStorage.getItem("backlog-filters.7");
            expect(raw).not.toBeNull();
            expect(JSON.parse(raw as string)).toEqual({
                q: "typed",
                selected: selection,
            });
            // ...but the loader strips it (mirrors `getFilters` delete data.q).
            expect(loadBacklogFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: selection,
            });
        });

        it("uses a key distinct from the Kanban filters key", () => {
            saveBacklogFilters<TestFilter>(7, { q: "x", selected: selection });

            expect(window.localStorage.getItem("backlog-filters.7")).not.toBeNull();
            // The Kanban key must be untouched — the two screens never collide.
            expect(window.localStorage.getItem("kanban-filters.7")).toBeNull();
        });

        it("returns null when nothing is stored", () => {
            expect(loadBacklogFilters<TestFilter>(7)).toBeNull();
        });

        it("isolates filter storage per project id", () => {
            saveBacklogFilters<TestFilter>(7, { q: "a", selected: [] });
            saveBacklogFilters<TestFilter>(8, { q: "b", selected: selection });

            // The `selected` selection is project-scoped; `q` is dropped on load.
            expect(loadBacklogFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: [],
            });
            expect(loadBacklogFilters<TestFilter>(8)).toEqual({
                q: "",
                selected: selection,
            });
        });

        it("degrades a missing q to an empty string", () => {
            window.localStorage.setItem(
                "backlog-filters.7",
                JSON.stringify({ selected: selection }),
            );

            expect(loadBacklogFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: selection,
            });
        });

        it("degrades a missing/invalid selected to an empty array", () => {
            window.localStorage.setItem(
                "backlog-filters.7",
                JSON.stringify({ q: "x", selected: "not-an-array" }),
            );

            // `q` is stripped on load regardless of what was stored.
            expect(loadBacklogFilters<TestFilter>(7)).toEqual({
                q: "",
                selected: [],
            });
        });

        it("returns null for malformed stored JSON", () => {
            window.localStorage.setItem("backlog-filters.7", "}{bad");

            expect(loadBacklogFilters<TestFilter>(7)).toBeNull();
        });

        it("returns null when the stored value is a JSON array (not an object)", () => {
            window.localStorage.setItem("backlog-filters.7", JSON.stringify([1, 2, 3]));

            expect(loadBacklogFilters<TestFilter>(7)).toBeNull();
        });

        it("does not write for a non-finite project id", () => {
            const setSpy = jest.spyOn(Storage.prototype, "setItem");

            saveBacklogFilters<TestFilter>(Number.NaN, {
                q: "x",
                selected: selection,
            });
            expect(setSpy).not.toHaveBeenCalled();
        });

        it("does not read for a non-finite project id", () => {
            const getSpy = jest.spyOn(Storage.prototype, "getItem");

            expect(loadBacklogFilters<TestFilter>(Number.NaN)).toBeNull();
            expect(getSpy).not.toHaveBeenCalled();
        });

        it("degrades gracefully when localStorage.getItem throws", () => {
            jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
                throw new Error("blocked");
            });

            expect(loadBacklogFilters<TestFilter>(7)).toBeNull();
        });

        it("swallows a throwing localStorage.setItem (best-effort)", () => {
            jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
                throw new Error("quota");
            });

            expect(() =>
                saveBacklogFilters<TestFilter>(7, { q: "x", selected: selection }),
            ).not.toThrow();
        });
    });
});
