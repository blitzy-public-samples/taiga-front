/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * boardReducer.test.ts — browserless Jest (jsdom) unit spec for the immer-driven
 * Kanban board reducer `../state/boardReducer`.
 *
 * WHAT THIS COVERS
 *   Every reducer transition (RESET / INIT / SET / ADD / REMOVE / REPLACE_MODEL /
 *   ADD_ARCHIVED_STATUS / HIDE_STATUS / SHOW_STATUS / TOGGLE_FOLD / MOVE /
 *   MOVE_TO_END / EVENTS_LOAD), the exported selectors/helpers (`getStatus`,
 *   `isUsInArchivedHiddenStatus`, `getMovePayload`, `getMoveToEndPayload`), the
 *   synthetic "unclassified" swimlane logic, and immer copy-on-write
 *   immutability.
 *
 * SOURCE OF TRUTH
 *   The test vectors are ported from the AngularJS `KanbanUserstoriesService`
 *   (`app/coffee/modules/kanban/kanban-usertories.coffee`) — read-only, NEVER
 *   imported. The reducer under test is a faithful behavioural port of that
 *   service, so the observable behaviours asserted here are fixed by the source.
 *
 * ISOLATION CONTRACT (hard constraints)
 *   - Pure logic spec: NO `React` import, NO JSX, NO DOM/network, NO mocks.
 *   - The unit under test (`../state/boardReducer`) is imported directly.
 *   - `@testing-library/jest-dom` is registered globally via
 *     `jest.config.js#setupFilesAfterEnv` and is NOT imported here.
 *   - Jest globals (`describe`/`it`/`expect`) are typed via `@types/jest` and
 *     are NOT imported.
 *   - `isolatedModules` is on, so the type-only `State` import uses `import type`.
 *   - NEVER imports `immutable`, `dragula`, `dom-autoscroller`, `checksley`,
 *     `jquery`, `angular`, `@playwright/test`, or any `app/coffee/**` module.
 */

import {
    reducer,
    initialState,
    getStatus,
    isUsInArchivedHiddenStatus,
    getMovePayload,
    getMoveToEndPayload,
    UNCLASSIFIED_SWIMLANE_ID,
} from '../state/boardReducer';
import type { State } from '../state/boardReducer';
import { makeProject, makeSwimlane, makeUserStory } from './factories';

/**
 * Read a status column's ordered user-story id list, defaulting to an empty
 * array when the status key is absent. Keeps the array assertions terse.
 */
const ids = (s: State, statusKey: string): number[] => s.usByStatus[statusKey] ?? [];

/* ========================================================================== *
 * initialState
 * ========================================================================== */

describe('initialState', () => {
    it('returns an all-empty board state', () => {
        const s = initialState();

        // Array fields start empty.
        expect(s.userstoriesRaw).toEqual([]);
        expect(s.swimlanes).toEqual([]);
        expect(s.swimlanesList).toEqual([]);
        expect(s.statusHide).toEqual([]);
        expect(s.archivedStatus).toEqual([]);

        // Record fields start empty.
        expect(s.usByStatus).toEqual({});
        expect(s.usMap).toEqual({});
        expect(s.usByStatusSwimlanes).toEqual({});
        expect(s.foldStatusChanged).toEqual({});
        expect(s.order).toEqual({});
        expect(s.usersById).toEqual({});

        // No owning project until INIT.
        expect(s.project).toBeNull();
    });

    it('returns a fresh, distinct instance on every call', () => {
        const a = initialState();
        const b = initialState();

        expect(a).not.toBe(b);

        // Mutating one instance must never bleed into another.
        a.userstoriesRaw.push(makeUserStory({ id: 99 }));
        a.usByStatus['100'] = [99];

        expect(b.userstoriesRaw).toEqual([]);
        expect(b.usByStatus).toEqual({});
    });

    it('exposes UNCLASSIFIED_SWIMLANE_ID === -1', () => {
        expect(UNCLASSIFIED_SWIMLANE_ID).toBe(-1);
    });
});

/* ========================================================================== *
 * SET
 * ========================================================================== */

describe('SET', () => {
    it('buckets stories by status, sorted ascending by order', () => {
        const state = reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, kanban_order: 2 }),
                makeUserStory({ id: 2, status: 100, kanban_order: 1 }),
                makeUserStory({ id: 3, status: 200, kanban_order: 1 }),
            ],
        });

        // id 2 (order 1) sorts before id 1 (order 2) within status 100.
        expect(ids(state, '100')).toEqual([2, 1]);
        expect(ids(state, '200')).toEqual([3]);

        // Every story gets a derived card whose model id matches.
        expect(state.usMap[1]).toBeDefined();
        expect(state.usMap[2]).toBeDefined();
        expect(state.usMap[3]).toBeDefined();
        expect(state.usMap[1].model.id).toBe(1);
        expect(state.usMap[2].model.id).toBe(2);
        expect(state.usMap[3].model.id).toBe(3);
    });

    it('keys usByStatus by STRING status ids', () => {
        const state = reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100 }),
                makeUserStory({ id: 3, status: 200 }),
            ],
        });

        expect(Object.keys(state.usByStatus)).toEqual(
            expect.arrayContaining(['100', '200']),
        );
    });
});

/* ========================================================================== *
 * ADD
 * ========================================================================== */

describe('ADD', () => {
    it('sorts the incoming batch by kanban_order and appends the new ids', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [makeUserStory({ id: 1, status: 100, kanban_order: 1 })],
        });

        const state = reducer(base, {
            type: 'ADD',
            usList: [
                makeUserStory({ id: 2, status: 100, kanban_order: 3 }),
                makeUserStory({ id: 3, status: 100, kanban_order: 2 }),
            ],
        });

        // Incoming sorted by kanban_order => [id3(order2), id2(order3)], each
        // pushed after the existing id1 => [1, 3, 2].
        expect(ids(state, '100')).toEqual([1, 3, 2]);
    });

    it('does not duplicate an already-present story (only-new guard)', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [makeUserStory({ id: 1, status: 100, kanban_order: 1 })],
        });

        const state = reducer(base, {
            type: 'ADD',
            usList: [
                makeUserStory({ id: 1, status: 100, kanban_order: 1 }),
                makeUserStory({ id: 2, status: 100, kanban_order: 2 }),
            ],
        });

        // id1 already mapped => not re-pushed; id2 is new => appended.
        expect(ids(state, '100')).toEqual([1, 2]);
        // Raw list holds exactly the two distinct ids (no duplicate id 1).
        expect(state.userstoriesRaw).toHaveLength(2);
    });
});

/* ========================================================================== *
 * MOVE — same status reorder (SOURCE kanban-usertories.coffee:150-190)
 * ========================================================================== */

describe('MOVE — same status reorder', () => {
    it('reorders card 3 to just after card 1', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [1, 2, 3, 4, 5].map((id) =>
                makeUserStory({ id, status: 100, swimlane: null, kanban_order: id }),
            ),
        });

        const state = reducer(base, {
            type: 'MOVE',
            usIds: [3],
            statusId: 100,
            swimlaneId: null,
            index: 1,
            previousCard: 1,
            nextCard: null,
        });

        expect(ids(state, '100')).toEqual([1, 3, 2, 4, 5]);
        expect(state.order[3]).toBe(2);
    });
});

/* ========================================================================== *
 * MOVE — cross status + immer immutability
 * ========================================================================== */

describe('MOVE — cross status', () => {
    it('moves a card across statuses and leaves the previous state untouched', () => {
        const prev = reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, swimlane: null, kanban_order: 1 }),
                makeUserStory({ id: 2, status: 100, swimlane: null, kanban_order: 2 }),
                makeUserStory({ id: 3, status: 100, swimlane: null, kanban_order: 3 }),
                makeUserStory({ id: 4, status: 200, swimlane: null, kanban_order: 4 }),
                makeUserStory({ id: 5, status: 200, swimlane: null, kanban_order: 5 }),
            ],
        });

        const state = reducer(prev, {
            type: 'MOVE',
            usIds: [1],
            statusId: 200,
            swimlaneId: null,
            index: 1,
            previousCard: 4,
            nextCard: null,
        });

        // Destination buckets after the move.
        expect(ids(state, '100')).toEqual([2, 3]);
        expect(ids(state, '200')).toEqual([4, 1, 5]);

        // The moved story's raw model now belongs to status 200.
        const moved = state.userstoriesRaw.find((u) => u.id === 1);
        expect(moved).toBeDefined();
        expect(moved?.status).toBe(200);

        // Immer copy-on-write: base state is a different, unchanged object.
        expect(state).not.toBe(prev);
        expect(ids(prev, '100')).toEqual([1, 2, 3]);
        const prevOne = prev.userstoriesRaw.find((u) => u.id === 1);
        expect(prevOne?.status).toBe(100);
        expect(prev.usByStatus).not.toBe(state.usByStatus);
    });
});

/* ========================================================================== *
 * MOVE — NaN swimlane normalization (F-AAP-09, data integrity)
 *
 * On a swimlane-less board a missing `data-swimlane` becomes `Number(undefined)`
 * === NaN upstream. Even though the DnD boundary and the hook now normalize it,
 * the reducer is the LAST gate before `usModel.swimlane` is written, so a MOVE
 * carrying a NaN swimlane must persist `null` — never NaN — into the model.
 * ========================================================================== */

describe('MOVE — NaN swimlane normalization (F-AAP-09)', () => {
    it('coerces a NaN swimlane to null in the moved story model (never persists NaN)', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, swimlane: null, kanban_order: 1 }),
                makeUserStory({ id: 2, status: 200, swimlane: null, kanban_order: 2 }),
            ],
        });

        const state = reducer(base, {
            type: 'MOVE',
            usIds: [1],
            statusId: 200,
            // A NaN swimlane — the exact value a missing lane produced pre-fix.
            swimlaneId: Number.NaN,
            index: 0,
            previousCard: null,
            nextCard: 2,
        });

        const moved = state.userstoriesRaw.find((u) => u.id === 1);
        expect(moved).toBeDefined();
        // The model's swimlane is a real null, NOT NaN.
        expect(moved?.swimlane).toBeNull();
        expect(Number.isNaN(moved?.swimlane as unknown as number)).toBe(false);
        // The card mirror stays consistent with the model.
        expect(state.usMap[1]?.swimlane ?? null).toBeNull();
        // The status still applied normally, so the move itself worked.
        expect(moved?.status).toBe(200);
    });
});

/* ========================================================================== *
 * MOVE_TO_END + getMoveToEndPayload (SOURCE 192-202)
 * ========================================================================== */

describe('MOVE_TO_END + getMoveToEndPayload', () => {
    it('sets order to -1 and stamps the raw model', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [makeUserStory({ id: 7, status: 100, kanban_order: 5 })],
        });

        const state = reducer(base, { type: 'MOVE_TO_END', id: 7, statusId: 100 });

        expect(state.order[7]).toBe(-1);
        const raw = state.userstoriesRaw.find((u) => u.id === 7);
        expect(raw?.status).toBe(100);
        expect(raw?.kanban_order).toBe(-1);
    });

    it('getMoveToEndPayload builds the { us_id, order:-1 } wire payload', () => {
        expect(getMoveToEndPayload(7)).toEqual({ us_id: 7, order: -1 });
    });
});

/* ========================================================================== *
 * getMovePayload — pure echo of its arguments (SOURCE 184-190)
 * ========================================================================== */

describe('getMovePayload (pure echo)', () => {
    it('echoes a multi-card move anchored after a card', () => {
        expect(getMovePayload([1, 2], 200, null, 5, null)).toEqual({
            statusId: 200,
            swimlaneId: null,
            afterUserstoryId: 5,
            beforeUserstoryId: null,
            bulkUserstories: [1, 2],
        });
    });

    it('echoes a single-card move anchored before a card, with a swimlane', () => {
        const p = getMovePayload([9], 300, 10, null, 4);

        expect(p).toEqual({
            statusId: 300,
            swimlaneId: 10,
            afterUserstoryId: null,
            beforeUserstoryId: 4,
            bulkUserstories: [9],
        });

        // bulkUserstories is the plain number array (not wrapped objects).
        expect(Array.isArray(p.bulkUserstories)).toBe(true);
        expect(p.bulkUserstories).toEqual([9]);
    });

    // F-AAP-09 (data integrity): a NaN swimlane — the value `Number(undefined)`
    // yields for a missing `data-swimlane` on a swimlane-less board — must NEVER
    // reach the `/userstories/bulk_update_kanban_order` body. getMovePayload is
    // the last builder before the wire, so it defensively coerces NaN -> null.
    it('coerces a NaN swimlane to null in the wire payload (F-AAP-09)', () => {
        const p = getMovePayload([9], 300, Number.NaN, null, 4);

        expect(p.swimlaneId).toBeNull();
        // The coerced value is a real null (not NaN), so it serializes cleanly.
        expect(Number.isNaN(p.swimlaneId as unknown as number)).toBe(false);
        expect(p).toEqual({
            statusId: 300,
            swimlaneId: null,
            afterUserstoryId: null,
            beforeUserstoryId: 4,
            bulkUserstories: [9],
        });
    });

    it('passes a real swimlane id (including the synthetic -1) through unchanged (F-AAP-09)', () => {
        // The `-1` "Unclassified" sentinel is a legitimate value the reducer does
        // NOT touch — only the hook maps it to the API `null`. getMovePayload must
        // leave it intact so the sentinel is not confused with the NaN guard.
        expect(getMovePayload([9], 300, -1, null, null).swimlaneId).toBe(-1);
        expect(getMovePayload([9], 300, 42, null, null).swimlaneId).toBe(42);
    });
});

/* ========================================================================== *
 * getStatus — the `!swimlaneId` bypass (SOURCE 130-132)
 * ========================================================================== */

describe('getStatus — !swimlaneId bypass', () => {
    const build = (): State =>
        reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, swimlane: 10 }),
                makeUserStory({ id: 2, status: 100, swimlane: null }),
                makeUserStory({ id: 3, status: 100, swimlane: 20 }),
            ],
        });

    it('returns every story in the status when swimlaneId is null', () => {
        const result = getStatus(build(), 100, null);

        expect(result).toHaveLength(3);
        expect(result.map((u) => u.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });

    it('filters to a single swimlane when swimlaneId is truthy', () => {
        const result = getStatus(build(), 100, 10);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
    });

    it('bypasses the swimlane filter when swimlaneId is 0 (falsy)', () => {
        expect(getStatus(build(), 100, 0)).toHaveLength(3);
    });
});

/* ========================================================================== *
 * TOGGLE_FOLD (SOURCE 44-46)
 * ========================================================================== */

describe('TOGGLE_FOLD', () => {
    it('flips the per-us fold flag on each dispatch', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [makeUserStory({ id: 1, status: 100 })],
        });

        const once = reducer(base, { type: 'TOGGLE_FOLD', usId: 1 });
        expect(once.foldStatusChanged[1]).toBe(true);

        const twice = reducer(once, { type: 'TOGGLE_FOLD', usId: 1 });
        expect(twice.foldStatusChanged[1]).toBe(false);
    });
});

/* ========================================================================== *
 * REMOVE (SOURCE 60-75)
 * ========================================================================== */

describe('REMOVE', () => {
    it('removes a story from every board index', () => {
        const us1 = makeUserStory({ id: 1, status: 100 });
        const us2 = makeUserStory({ id: 2, status: 100 });

        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [us1, us2],
        });

        const state = reducer(base, { type: 'REMOVE', usModel: us1 });

        expect(state.userstoriesRaw.map((u) => u.id)).toEqual([2]);
        expect(ids(state, '100')).toEqual([2]);
        expect(state.usMap[1]).toBeUndefined();
        expect(state.order[1]).toBeUndefined();
    });
});

/* ========================================================================== *
 * REPLACE_MODEL (SOURCE 207-215)
 * ========================================================================== */

describe('REPLACE_MODEL', () => {
    it('replaces the raw model and its derived usMap card', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, subject: 'A', kanban_order: 1 }),
            ],
        });

        const state = reducer(base, {
            type: 'REPLACE_MODEL',
            usModel: makeUserStory({
                id: 1,
                status: 100,
                subject: 'B',
                kanban_order: 1,
            }),
        });

        const raw = state.userstoriesRaw.find((u) => u.id === 1);
        expect(raw?.subject).toBe('B');
        expect(state.usMap[1].model.subject).toBe('B');
    });
});

/* ========================================================================== *
 * archived + hidden status -> isUsInArchivedHiddenStatus (SOURCE 113-128)
 * ========================================================================== */

describe('archived + hidden status → isUsInArchivedHiddenStatus', () => {
    const seed = (): State =>
        reducer(initialState(), {
            type: 'SET',
            userstories: [makeUserStory({ id: 1, status: 100 })],
        });

    it('is true only when the status is BOTH archived and hidden', () => {
        let state = seed();
        state = reducer(state, { type: 'ADD_ARCHIVED_STATUS', statusId: 100 });
        state = reducer(state, { type: 'HIDE_STATUS', statusId: 100 });

        expect(isUsInArchivedHiddenStatus(state, 1)).toBe(true);
    });

    it('is false when archived but not hidden', () => {
        let state = seed();
        state = reducer(state, { type: 'ADD_ARCHIVED_STATUS', statusId: 100 });

        expect(isUsInArchivedHiddenStatus(state, 1)).toBe(false);
    });

    it('is false again after SHOW_STATUS unhides the column', () => {
        let state = seed();
        state = reducer(state, { type: 'ADD_ARCHIVED_STATUS', statusId: 100 });
        state = reducer(state, { type: 'HIDE_STATUS', statusId: 100 });
        state = reducer(state, { type: 'SHOW_STATUS', statusId: 100 });

        expect(state.statusHide).not.toContain(100);
        expect(isUsInArchivedHiddenStatus(state, 1)).toBe(false);
    });
});

/* ========================================================================== *
 * refreshSwimlanes — synthetic unclassified swimlane (SOURCE 277-317)
 * ========================================================================== */

describe('refreshSwimlanes (synthetic unclassified swimlane)', () => {
    const initSwimlanes = (): State =>
        reducer(initialState(), {
            type: 'INIT',
            project: makeProject(),
            swimlanes: [
                makeSwimlane({ id: 10, order: 1 }),
                makeSwimlane({ id: 20, order: 2 }),
            ],
            usersById: {},
        });

    it('prepends the unclassified lane when a story has no swimlane', () => {
        const state = reducer(initSwimlanes(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, swimlane: null }),
                makeUserStory({ id: 2, status: 100, swimlane: 10 }),
            ],
        });

        // The synthetic lane sits first, carrying the resolved English label.
        expect(state.swimlanesList[0].id).toBe(UNCLASSIFIED_SWIMLANE_ID);
        expect(state.swimlanesList[0].name).toBe('Unclassified user stories');

        // The configured lanes remain present.
        const laneIds = state.swimlanesList.map((s) => s.id);
        expect(laneIds).toContain(10);
        expect(laneIds).toContain(20);

        // Each lane's status bucket only contains its own stories.
        expect(state.usByStatusSwimlanes['-1']['100']).toEqual([1]);
        expect(state.usByStatusSwimlanes['10']['100']).toEqual([2]);
    });

    it('omits the unclassified lane when every story has a swimlane', () => {
        const state = reducer(initSwimlanes(), {
            type: 'SET',
            userstories: [makeUserStory({ id: 5, status: 100, swimlane: 10 })],
        });

        expect(state.swimlanesList.every((s) => s.id !== -1)).toBe(true);
        expect(state.usByStatusSwimlanes['10']['100']).toEqual([5]);
    });

    it('returns early when no swimlanes are configured', () => {
        const state = reducer(initialState(), {
            type: 'SET',
            userstories: [makeUserStory({ id: 1, status: 100, swimlane: null })],
        });

        expect(state.swimlanesList).toEqual([]);
        expect(state.usByStatusSwimlanes).toEqual({});
    });
});

/* ========================================================================== *
 * RESET (SOURCE 19-34) — both flag paths
 * ========================================================================== */

describe('RESET', () => {
    const populate = (): State => {
        let state = reducer(initialState(), {
            type: 'INIT',
            project: makeProject(),
            swimlanes: [
                makeSwimlane({ id: 10, order: 1 }),
                makeSwimlane({ id: 20, order: 2 }),
            ],
            usersById: {},
        });
        state = reducer(state, {
            type: 'SET',
            userstories: [makeUserStory({ id: 1, status: 100, swimlane: null })],
        });
        state = reducer(state, { type: 'ADD_ARCHIVED_STATUS', statusId: 100 });
        state = reducer(state, { type: 'HIDE_STATUS', statusId: 100 });
        return state;
    };

    it('clears everything when all flags default to true', () => {
        const populated = populate();

        // Sanity: the populated state is genuinely non-empty first.
        expect(populated.userstoriesRaw.length).toBeGreaterThan(0);
        expect(populated.swimlanesList.length).toBeGreaterThan(0);

        const state = reducer(populated, { type: 'RESET' });

        expect(state.userstoriesRaw).toEqual([]);
        expect(state.swimlanes).toEqual([]);
        expect(state.swimlanesList).toEqual([]);
        expect(state.statusHide).toEqual([]);
        expect(state.archivedStatus).toEqual([]);
        expect(state.usByStatus).toEqual({});
        expect(state.usMap).toEqual({});
        expect(state.usByStatusSwimlanes).toEqual({});
    });

    it('preserves swimlanesList/archivedStatus/statusHide when their flags are false', () => {
        const state = reducer(populate(), {
            type: 'RESET',
            resetSwimlanesList: false,
            resetArchivedStatus: false,
            resetHideStatud: false,
        });

        // Preserved because their reset flags were turned off.
        expect(state.swimlanesList.length).toBeGreaterThan(0);
        expect(state.archivedStatus).toEqual([100]);
        expect(state.statusHide).toEqual([100]);

        // Always-cleared indexes.
        expect(state.userstoriesRaw).toEqual([]);
        expect(state.usByStatus).toEqual({});
        expect(state.usMap).toEqual({});
    });
});

/* ========================================================================== *
 * EVENTS_LOAD — modified + new merge
 * ========================================================================== */

describe('EVENTS_LOAD (modified + new merge)', () => {
    it('replaces modified stories in place and adds brand-new ones', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, subject: 'A', kanban_order: 1 }),
            ],
        });

        const state = reducer(base, {
            type: 'EVENTS_LOAD',
            userstories: [
                makeUserStory({ id: 1, status: 100, subject: 'A2', kanban_order: 1 }),
                makeUserStory({ id: 2, status: 100, kanban_order: 2 }),
            ],
        });

        // The already-present story is replaced with the new revision.
        const raw1 = state.userstoriesRaw.find((u) => u.id === 1);
        expect(raw1?.subject).toBe('A2');

        // The brand-new story is added to the same status bucket.
        expect(ids(state, '100')).toContain(1);
        expect(ids(state, '100')).toContain(2);
    });
});


/* ========================================================================== *
 * EVENTS_LOAD — removal reconciliation (QA M-24 live-delete parity)
 * ========================================================================== */

describe('EVENTS_LOAD (removal reconciliation — QA M-24)', () => {
    it('prunes a story that is ABSENT from the fresh (complete) list — live delete', () => {
        // Two stories on the board.
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, subject: 'A', kanban_order: 1 }),
                makeUserStory({ id: 2, status: 100, subject: 'B', kanban_order: 2 }),
            ],
        });
        expect(ids(base, '100')).toEqual([1, 2]);

        // A live frame arrives after story 2 was deleted on the backend: the
        // fresh full list contains only story 1.
        const state = reducer(base, {
            type: 'EVENTS_LOAD',
            userstories: [
                makeUserStory({ id: 1, status: 100, subject: 'A', kanban_order: 1 }),
            ],
        });

        // Story 2's card must disappear from EVERY collection, not just linger.
        expect(ids(state, '100')).toEqual([1]);
        expect(state.usMap[2]).toBeUndefined();
        expect(state.order[2]).toBeUndefined();
        expect(state.userstoriesRaw.some((u) => u.id === 2)).toBe(false);
        // Surviving story is untouched.
        expect(state.userstoriesRaw.some((u) => u.id === 1)).toBe(true);
    });

    it('PRESERVES a story in a reopened archived status even though it is absent from the non-archived list', () => {
        // Board with one active story (status 100).
        let state = reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, subject: 'A', kanban_order: 1 }),
            ],
        });

        // Reopen an archived status column (status 200) and add its story —
        // exactly what `showArchivedStatus` does (ADD_ARCHIVED_STATUS + ADD).
        state = reducer(state, { type: 'ADD_ARCHIVED_STATUS', statusId: 200 });
        state = reducer(state, {
            type: 'ADD',
            usList: [makeUserStory({ id: 9, status: 200, subject: 'ARCH', kanban_order: 1 })],
        });
        expect(state.usMap[9]).toBeDefined();

        // A live `changes.project.*.userstories` frame carries the fresh
        // NON-archived list (status__is_archived:false) — which never contains
        // the archived story 9.
        state = reducer(state, {
            type: 'EVENTS_LOAD',
            userstories: [
                makeUserStory({ id: 1, status: 100, subject: 'A', kanban_order: 1 }),
            ],
        });

        // The archived story 9 must be preserved (not wrongly pruned).
        expect(state.usMap[9]).toBeDefined();
        expect(state.userstoriesRaw.some((u) => u.id === 9)).toBe(true);
        expect(ids(state, '200')).toContain(9);
        // The active story 1 remains too.
        expect(ids(state, '100')).toEqual([1]);
    });

    it('merges modified + new AND prunes deleted in a single frame', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, subject: 'A', kanban_order: 1 }),
                makeUserStory({ id: 2, status: 100, subject: 'B', kanban_order: 2 }),
                makeUserStory({ id: 3, status: 100, subject: 'C', kanban_order: 3 }),
            ],
        });

        // Fresh list: 1 modified (A -> A2), 2 deleted (absent), 3 kept, 4 new.
        const state = reducer(base, {
            type: 'EVENTS_LOAD',
            userstories: [
                makeUserStory({ id: 1, status: 100, subject: 'A2', kanban_order: 1 }),
                makeUserStory({ id: 3, status: 100, subject: 'C', kanban_order: 3 }),
                makeUserStory({ id: 4, status: 100, subject: 'D', kanban_order: 4 }),
            ],
        });

        // Modified applied.
        expect(state.userstoriesRaw.find((u) => u.id === 1)?.subject).toBe('A2');
        // Deleted pruned everywhere.
        expect(state.usMap[2]).toBeUndefined();
        expect(state.order[2]).toBeUndefined();
        expect(state.userstoriesRaw.some((u) => u.id === 2)).toBe(false);
        // New added, kept retained.
        expect(ids(state, '100')).toContain(4);
        expect(ids(state, '100')).toContain(3);
        expect(ids(state, '100')).not.toContain(2);
    });
});


/* ========================================================================== *
 * MOVE — insert at front (previousCard === null) (SOURCE 157-159)
 * ========================================================================== */

describe('MOVE — insert at front (previousCard null)', () => {
    it('anchors order/index at 0 and moves the card to the front', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [1, 2, 3].map((id) =>
                makeUserStory({ id, status: 100, swimlane: null, kanban_order: id }),
            ),
        });

        const state = reducer(base, {
            type: 'MOVE',
            usIds: [3],
            statusId: 100,
            swimlaneId: null,
            index: 0,
            previousCard: null,
            nextCard: 1,
        });

        expect(ids(state, '100')).toEqual([3, 1, 2]);
        expect(state.order[3]).toBe(0);
    });
});

/* ========================================================================== *
 * ADD — into a brand-new status bucket (SOURCE 98-99)
 * ========================================================================== */

describe('ADD — into a new status bucket', () => {
    it('creates the status slot when the incoming story introduces a new status', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [makeUserStory({ id: 1, status: 100, kanban_order: 1 })],
        });

        const state = reducer(base, {
            type: 'ADD',
            usList: [makeUserStory({ id: 2, status: 200, kanban_order: 1 })],
        });

        expect(ids(state, '100')).toEqual([1]);
        expect(ids(state, '200')).toEqual([2]);
    });
});

/* ========================================================================== *
 * Card derivation — retrieveUserStoryData via usersById (SOURCE 228-252)
 * ========================================================================== */

describe('card derivation via usersById (INIT + SET)', () => {
    it('resolves assignees, filters thumbnail images, and flattens tags', () => {
        const usersById = {
            1: { id: 1, full_name_display: 'User One', photo: null },
            2: { id: 2, full_name_display: 'User Two', photo: null },
        };

        const withUsers = reducer(initialState(), {
            type: 'INIT',
            project: makeProject(),
            swimlanes: [],
            usersById,
        });

        const state = reducer(withUsers, {
            type: 'SET',
            userstories: [
                makeUserStory({
                    id: 1,
                    status: 100,
                    assigned_to: 1,
                    assigned_users: [1, 2],
                    attachments: [
                        { id: 1, thumbnail_card_url: 'thumb.png' },
                        { id: 2, thumbnail_card_url: null },
                    ],
                    tags: [
                        ['alpha', '#ffffff'],
                        ['beta', null],
                    ],
                }),
            ],
        });

        const card = state.usMap[1];

        // assigned_to is resolved from the member id to the member object.
        expect(card.assigned_to?.id).toBe(1);

        // assigned_users resolves every member id (both are known).
        expect(card.assigned_users).toHaveLength(2);
        expect(card.assigned_users_preview).toHaveLength(2);

        // Only the attachment carrying a thumbnail_card_url survives.
        expect(card.images).toHaveLength(1);
        expect(card.images[0].id).toBe(1);

        // Each [name, color] tuple is flattened to a ColorizedTag object.
        expect(card.colorized_tags).toEqual([
            { name: 'alpha', color: '#ffffff' },
            { name: 'beta', color: null },
        ]);
    });

    it('drops unknown assignee ids and yields a null assigned_to when unset', () => {
        const state = reducer(
            reducer(initialState(), {
                type: 'INIT',
                project: makeProject(),
                swimlanes: [],
                usersById: { 1: { id: 1, full_name_display: 'User One', photo: null } },
            }),
            {
                type: 'SET',
                userstories: [
                    makeUserStory({
                        id: 1,
                        status: 100,
                        assigned_to: null,
                        // id 1 is known, id 99 is not => only one resolves.
                        assigned_users: [1, 99],
                    }),
                ],
            },
        );

        const card = state.usMap[1];
        expect(card.assigned_to).toBeNull();
        expect(card.assigned_users).toHaveLength(1);
        expect(card.assigned_users[0].id).toBe(1);
    });
});

/* ========================================================================== *
 * REFRESH / REFRESH_RAW_ORDER / RESET_FOLDS (SOURCE 41-42, 140-143, 254-275)
 * ========================================================================== */

describe('REFRESH / REFRESH_RAW_ORDER / RESET_FOLDS', () => {
    it('REFRESH rebuilds usByStatus idempotently', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [
                makeUserStory({ id: 1, status: 100, kanban_order: 1 }),
                makeUserStory({ id: 2, status: 100, kanban_order: 2 }),
            ],
        });

        const state = reducer(base, { type: 'REFRESH' });

        expect(ids(state, '100')).toEqual([1, 2]);
        expect(state.usMap[1]).toBeDefined();
        expect(state.usMap[2]).toBeDefined();
    });

    it('REFRESH_RAW_ORDER recomputes order from each raw kanban_order', () => {
        const base = reducer(initialState(), {
            type: 'SET',
            userstories: [makeUserStory({ id: 1, status: 100, kanban_order: 7 })],
        });

        const state = reducer(base, { type: 'REFRESH_RAW_ORDER' });

        expect(state.order[1]).toBe(7);
    });

    it('RESET_FOLDS clears every per-us fold flag', () => {
        let state = reducer(initialState(), {
            type: 'SET',
            userstories: [makeUserStory({ id: 1, status: 100 })],
        });
        state = reducer(state, { type: 'TOGGLE_FOLD', usId: 1 });
        expect(state.foldStatusChanged[1]).toBe(true);

        state = reducer(state, { type: 'RESET_FOLDS' });
        expect(state.foldStatusChanged).toEqual({});
    });
});

