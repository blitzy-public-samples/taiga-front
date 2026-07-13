/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the shared filter model ({@link panels.ts}). These are the
 * PURE builders that back the `tg-filter` category panel reproduced by
 * `BacklogFilterPanel` and consumed by BOTH `useBacklogStories` and
 * `useKanbanStories`. Because this module is the single source of truth for
 * filter parity (findings C4 + C11), the value/param transforms are exercised
 * directly here — independent of either screen's React wiring.
 */
import {
    FILTER_CATEGORIES,
    EXCLUDE_PREFIX,
    paramNameFor,
    addParamValue,
    removeParamValue,
    buildDataCollection,
    buildFilterPanels,
    formatSelectedFilters,
    computeSelectedFilters,
    collectCustomFilterParams,
} from "./panels";

describe("shared filter model — panels.ts", () => {
    describe("FILTER_CATEGORIES + paramNameFor", () => {
        it("keeps the legacy generateFilters push order", () => {
            expect(FILTER_CATEGORIES).toEqual([
                "status",
                "tags",
                "assigned_users",
                "role",
                "owner",
                "epic",
            ]);
        });

        it("maps (category, mode) to the legacy URL param name", () => {
            expect(paramNameFor("tags", "include")).toBe("tags");
            expect(paramNameFor("tags", "exclude")).toBe(`${EXCLUDE_PREFIX}tags`);
            expect(paramNameFor("role", "exclude")).toBe("exclude_role");
        });
    });

    describe("addParamValue (legacy selectFilter)", () => {
        it("creates the key when the param is absent", () => {
            expect(addParamValue({}, "tags", "urgent")).toEqual({ tags: "urgent" });
        });

        it("appends to an existing comma-joined param and de-duplicates", () => {
            const start = { tags: "urgent" };
            const next = addParamValue(start, "tags", "blocker");
            expect(next).toEqual({ tags: "urgent,blocker" });
            // idempotent: adding a value already present does not duplicate it
            expect(addParamValue(next, "tags", "urgent")).toEqual({
                tags: "urgent,blocker",
            });
            // input is not mutated
            expect(start).toEqual({ tags: "urgent" });
        });
    });

    describe("removeParamValue (legacy unselectFilter)", () => {
        it("returns the params unchanged when the key is absent", () => {
            expect(removeParamValue({ tags: "a" }, "role", "x")).toEqual({ tags: "a" });
        });

        it("removes one value while keeping the rest", () => {
            expect(removeParamValue({ tags: "a,b,c" }, "tags", "b")).toEqual({
                tags: "a,c",
            });
        });

        it("deletes the key entirely when the last value is removed", () => {
            expect(removeParamValue({ tags: "only" }, "tags", "only")).toEqual({});
        });
    });

    describe("buildDataCollection (legacy dataCollection normalisation)", () => {
        it("returns empty per-category lists for empty / nullish input", () => {
            const dc = buildDataCollection(undefined);
            expect(dc.status).toEqual([]);
            expect(dc.tags).toEqual([]);
            expect(dc.assigned_users).toEqual([]);
            expect(dc.role).toEqual([]);
            expect(dc.owner).toEqual([]);
            expect(dc.epic).toEqual([]);
        });

        it("normalises every category with derived names + fallbacks", () => {
            const dc = buildDataCollection({
                statuses: [{ id: 1, name: "New", color: "#fff", count: 3 }],
                tags: [{ name: "urgent", color: "#f00", count: 2 }],
                assigned_users: [
                    { id: 7, full_name: "Ada Lovelace", count: 4 },
                    { id: null, count: 5 }, // unassigned -> id "null", name "Unassigned"
                ],
                roles: [
                    { id: 2, name: "Back", count: 1 },
                    { id: null, count: 0 }, // null role -> id "null", name "Unassigned"
                ],
                owners: [
                    { id: 9, full_name: "Grace Hopper", username: "grace", count: 6 },
                    { id: 10, username: "onlyuser" }, // full_name missing -> username
                ],
                epics: [
                    { id: 5, ref: 42, subject: "Big epic", count: 8 },
                    { id: null }, // not in an epic
                ],
            });

            expect(dc.status).toEqual([
                { id: "1", name: "New", color: "#fff", count: 3 },
            ]);
            // tag id is derived from the name (legacy behaviour)
            expect(dc.tags).toEqual([
                { id: "urgent", name: "urgent", color: "#f00", count: 2 },
            ]);
            expect(dc.assigned_users).toEqual([
                { id: "7", name: "Ada Lovelace", count: 4 },
                { id: "null", name: "Unassigned", count: 5 },
            ]);
            expect(dc.role).toEqual([
                { id: "2", name: "Back", count: 1 },
                { id: "null", name: "Unassigned", count: 0 },
            ]);
            expect(dc.owner).toEqual([
                { id: "9", name: "Grace Hopper", count: 6 },
                { id: "10", name: "onlyuser", count: undefined },
            ]);
            expect(dc.epic).toEqual([
                { id: "5", name: "#42 Big epic", count: 8 },
                { id: "null", name: "Not in an epic", count: undefined },
            ]);
        });
    });

    describe("buildFilterPanels (legacy filters.push)", () => {
        const dc = buildDataCollection({
            statuses: [{ id: 1, name: "New" }],
            tags: [
                { name: "urgent", count: 2 },
                { name: "later", count: 0 },
            ],
        });

        it("emits all six category panels in order when nothing is excluded", () => {
            const panels = buildFilterPanels(dc);
            expect(panels.map((p) => p.dataType)).toEqual([
                "status",
                "tags",
                "assigned_users",
                "role",
                "owner",
                "epic",
            ]);
            const tags = panels.find((p) => p.dataType === "tags");
            expect(tags?.hideEmpty).toBe(true);
            // only the tag with a positive count is "tagged"
            expect(tags?.totalTaggedElements).toBe(1);
        });

        it("omits categories passed in excludeFilters (Kanban excludes status)", () => {
            const panels = buildFilterPanels(dc, ["status"]);
            expect(panels.map((p) => p.dataType)).toEqual([
                "tags",
                "assigned_users",
                "role",
                "owner",
                "epic",
            ]);
            expect(panels.find((p) => p.dataType === "status")).toBeUndefined();
        });
    });

    describe("formatSelectedFilters (legacy chip formatting)", () => {
        const list = [
            { id: "1", name: "New", color: "#fff" },
            { id: "2", name: "Done" },
        ];

        it("builds valid include chips from known ids", () => {
            const chips = formatSelectedFilters("status", list, "1", "include");
            expect(chips).toEqual([
                {
                    id: "1",
                    key: "status:1",
                    dataType: "status",
                    name: "New",
                    color: "#fff",
                    mode: "include",
                },
            ]);
        });

        it("emits invalid-id chips (name === id) before valid ones, honouring mode", () => {
            const chips = formatSelectedFilters("status", list, "ghost,2", "exclude");
            expect(chips[0]).toMatchObject({
                id: "ghost",
                name: "ghost",
                mode: "exclude",
            });
            expect(chips[1]).toMatchObject({ id: "2", name: "Done", mode: "exclude" });
        });
    });

    describe("computeSelectedFilters (legacy generateFilters loop)", () => {
        const dc = buildDataCollection({
            tags: [
                { name: "urgent", count: 2 },
                { name: "later", count: 1 },
            ],
            roles: [{ id: 2, name: "Back", count: 1 }],
        });

        it("projects include AND exclude chips across categories", () => {
            const chips = computeSelectedFilters(dc, {
                tags: "urgent",
                exclude_role: "2",
            });
            expect(chips).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        dataType: "tags",
                        id: "urgent",
                        mode: "include",
                    }),
                    expect.objectContaining({
                        dataType: "role",
                        id: "2",
                        mode: "exclude",
                    }),
                ]),
            );
            expect(chips).toHaveLength(2);
        });

        it("returns no chips for empty params", () => {
            expect(computeSelectedFilters(dc, {})).toEqual([]);
        });
    });

    describe("collectCustomFilterParams (saved custom-filter snapshot)", () => {
        it("keeps only category include+exclude params, dropping the rest", () => {
            const out = collectCustomFilterParams({
                tags: "urgent",
                exclude_role: "2",
                q: "search text", // free-text query is NOT a saved category param
                page: "3", // pagination is NOT a saved category param
            });
            expect(out).toEqual({ tags: "urgent", exclude_role: "2" });
        });
    });
});
