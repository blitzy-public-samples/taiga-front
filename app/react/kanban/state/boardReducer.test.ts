/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for `boardReducer.ts`, the ONE place every board mutation lives.
 *
 * WHY THIS SPECIFICATION IS SHAPED THE WAY IT IS. The two defects it exists to
 * catch produce NO error, NO exception, NO failing request and NOTHING in the
 * console:
 *
 *   1. A wrong `order` value. Named risk R-DND-2 states that because the write
 *      API is position-relative (`previousCard`/`nextCard` serialised as
 *      `after_userstory_id`/`before_userstory_id`), an off-by-one in the order
 *      arithmetic SILENTLY PERSISTS A WRONG ORDER WITH NO ERROR SURFACE. It
 *      surfaces on the next page load, long after the drag.
 *   2. A `swimlane` of `-1`. `refreshSwimlanes` finds unclassified stories with
 *      `us.swimlane == null` [app/coffee/modules/kanban/kanban-usertories.coffee:305].
 *      A story holding the synthetic swimlane's own id instead of `null` is found
 *      by neither that test nor any real swimlane, so the synthetic swimlane is
 *      never created and its cards VANISH FROM THE BOARD without a trace.
 *
 * Neither is caught by a suite that drags one card one step, so every group below
 * separates the specified rule from its plausible neighbour: the FIRST- and
 * LAST-position cases the anchor rule treats asymmetrically; the CROSS-CONTAINER
 * cases; fixtures where the moved card sits BEFORE its anchor, which is the only
 * arrangement in which the pre-filter index and the post-filter array disagree;
 * and exact, hand-computed `order` maps rather than shape assertions, because a
 * shape assertion passes against every off-by-one there is.
 *
 * EVERY expected value is hand-computed from the CoffeeScript it reproduces, and
 * carries a `[path:locator]` comment so a reader can verify it without guessing
 * (T6). Where the incumbent's arithmetic is surprising -- and in two fixtures it
 * assigns the SAME order to two cards -- the surprising result is asserted AS-IS.
 * No test here asserts an improvement: a test that encodes an enhancement is
 * worse than no test, because it forces a future agent to break behaviour to make
 * it pass (T10, Minimal Change Clause).
 *
 * TECHNOLOGY SEAMS UNDER TEST (T9):
 *   - Immutable.js -> PLAIN OBJECTS AND ARRAYS. The incumbent held this state in
 *     `Immutable.Map`/`Immutable.List` and read it with `getIn`; the React state
 *     is plain, so fixtures are plain and `.length` replaces `.size`. There is
 *     deliberately ZERO Immutable in this folder (I5).
 *   - Immutable.js -> `immer`. The reducer mutates a draft and returns nothing, so
 *     every assertion here goes through `produce`, exactly as `useReducer(produce(
 *     reducer), init)` composes it. That keeps `autoFreeze` active (P-IMMER-4),
 *     which is what makes an accidental in-place `.sort()` throw instead of
 *     silently reordering a caller's array -- something no type check can find.
 *   - The KEY-TYPE ASYMMETRY. Column folds are keyed NUMERICALLY and swimlane
 *     folds are keyed by STRING, because the incumbent wrote `folds[status.id]`
 *     [main.coffee:835] but `foldedSwimlane.set(id.toString(), ...)`
 *     [main.coffee:384], and the latter record is persisted verbatim. Rekeying
 *     either one would drop the user's folds on the next load.
 *   - The `-1` -> `null` NORMALISATION, described above.
 *
 * Browserless by construction: it runs in the jsdom environment configured by
 * `jest.config.js`, and needs no browser binary, no built bundle, no network and
 * no DOM at all -- the unit under test is a plain function (I9). It renders
 * nothing, so it imports no React and no testing library.
 *
 * OWNERSHIP SPLIT, so nothing is tested twice. `shared/dnd/useSortableList.test.ts`
 * owns the DOM-side NEIGHBOUR arithmetic that decides WHICH card is the anchor;
 * this file owns the `order` MAP arithmetic that decides what the anchor MEANS.
 * Request bodies belong to `shared/api/userstories.test.ts`, fold persistence to
 * `shared/api/kanbanStorage.test.ts`, WIP arithmetic to `WipLimitMarker.test.tsx`,
 * viewport latching to `shared/useInViewport.test.ts`, and every derived view
 * (`usByStatus`, `usMap`, `usByStatusSwimlanes`, `swimlanesList`) to the selectors.
 * Timers are named in comments where they matter and tested nowhere here, because
 * the reducer owns none of them -- they belong to the hooks.
 */
import { produce } from 'immer';

import {
    UNCLASSIFIED_SWIMLANE_ID,
    createInitialBoardState,
    kanbanBoardReducer,
} from './boardReducer';
import type {
    KanbanBoardAction,
    KanbanBoardState,
    KanbanMoveCardAction,
} from './types';
import type { UserStory } from '../../shared/types/userStory';
import type { Status } from '../../shared/types/status';
import type { Swimlane } from '../../shared/types/swimlane';

/* ==========================================================================
 * FIXTURES
 *
 * Plain objects and arrays throughout. The incumbent's `Immutable.fromJS({1:
 * {model: {...}}})` shape -- see `move-to-sprint.controller.spec.coffee:81-85`
 * for the convention being translated -- has no counterpart here on purpose.
 * ========================================================================== */

const PROJECT_ID = 3;

/**
 * Status ids. Deliberately NOT named after the statuses in the Figma raster: the
 * frame's statuses are `sample_data` artefacts (Drift Register D3), and a fixture
 * that mimicked them would read as canonical Taiga configuration, which no
 * project is obliged to have.
 */
const STATUS_FIRST = 1;

const STATUS_SECOND = 2;

/** An archived status, which the fold hydration is required to force closed. */
const STATUS_ARCHIVED = 5;

const SWIMLANE_A = 7;

const SWIMLANE_B = 8;

/**
 * Every colour on this board is DATA -- a per-project database value read from
 * `status.color`, `tag[1]` or `epic.color` (T2, Drift Register D3). This
 * placeholder is obviously synthetic so that no reader mistakes it for a value
 * the product ships, and nothing in this file asserts on it.
 */
const SYNTHETIC_COLOR = '#0f0f0f';

function makeStory(
    overrides: Partial<UserStory> & { readonly id: number },
): UserStory {
    const base: UserStory = {
        id: overrides.id,
        ref: overrides.id,
        subject: `user story ${overrides.id}`,
        status: STATUS_FIRST,
        // Unclassified is spelled `null`, never `-1`. See the `-1` -> `null` group.
        swimlane: null,
        milestone: null,
        project: PROJECT_ID,
        is_blocked: false,
        blocked_note: '',
        is_closed: false,
        due_date: null,
        total_points: null,
        points: {},
        tags: [],
        epics: null,
        // Raw ids, not user objects: the board resolves them through `usersById`.
        assigned_users: [],
        assigned_to: null,
        kanban_order: 0,
        backlog_order: 0,
        total_attachments: 0,
        total_comments: 0,
        attachments: [],
        tasks: [],
        watchers: [],
        // Required: the optimistic-concurrency token a write must round-trip.
        version: 1,
    };

    return { ...base, ...overrides };
}

function makeStatus(
    overrides: Partial<Status> & { readonly id: number },
): Status {
    const base: Status = {
        id: overrides.id,
        name: `status ${overrides.id}`,
        color: SYNTHETIC_COLOR,
        // `null` means NO limit, which is not the same as a limit of zero.
        wip_limit: null,
        is_archived: false,
    };

    return { ...base, ...overrides };
}

function makeSwimlane(
    overrides: Partial<Swimlane> & { readonly id: number },
): Swimlane {
    const base: Swimlane = {
        id: overrides.id,
        name: `swimlane ${overrides.id}`,
    };

    return { ...base, ...overrides };
}

/**
 * A state built from the initial factory and then adjusted, for the handful of
 * fields no hydration parameter reaches (`selectedUss`, `movedUs`, flags). Every
 * other fixture goes through `createInitialBoardState` so the factory itself is
 * exercised by the whole file rather than by one group.
 */
function makeState(
    overrides: Partial<KanbanBoardState> = {},
): KanbanBoardState {
    return { ...createInitialBoardState(), ...overrides };
}

function moveCard(
    overrides: Partial<KanbanMoveCardAction> & {
        readonly usList: readonly number[];
        readonly statusId: number;
    },
): KanbanMoveCardAction {
    const base: KanbanMoveCardAction = {
        type: 'MOVE_CARD',
        usList: overrides.usList,
        statusId: overrides.statusId,
        swimlaneId: null,
        index: 0,
        previousCard: null,
        nextCard: null,
    };

    return { ...base, ...overrides };
}

/* ==========================================================================
 * HELPERS
 * ========================================================================== */

/**
 * The exact composition the board uses: `useReducer(produce(reducer), init)`.
 * Running every case through `produce` is what keeps `autoFreeze` on, so a
 * reducer that mutated a caller's array in place would throw here rather than
 * pass (P-IMMER-4).
 */
function reduce(
    state: KanbanBoardState,
    action: KanbanBoardAction,
): KanbanBoardState {
    return produce(state, (draft) => {
        kanbanBoardReducer(draft, action);
    });
}

function ordersOf(
    state: KanbanBoardState,
    ids: readonly number[],
): readonly number[] {
    return ids.map((id) => state.order[id]);
}

/**
 * Counts distinct values via `.length`, never `.size`. That is not a stylistic
 * choice: `.size` is the Immutable.js reading of a collection, and this folder is
 * required to hold none of it (I5), so the spelling is kept clear of it even where
 * a native `Set` would have been entitled to it.
 */
function countDistinct(values: readonly number[]): number {
    return Array.from(new Set(values)).length;
}

/**
 * The AngularJS seam is untyped. `$tgStorage` round-trips through JSON and the
 * zoom control is an Angular 1.5 component, so a zoom level can genuinely arrive
 * as a string -- which is why the reducer coerces with `Number()`
 * [main.coffee:143]. The action type declares `number`, so reproducing that
 * runtime value needs one deliberate widening through `unknown`. `any` is not
 * used, here or anywhere in this file.
 */
function untypedZoomLevel(raw: string): number {
    return raw as unknown as number;
}

/**
 * The action union is exhaustive, so an unrecognised action cannot be spelled in
 * typed code at all. It can still arrive at runtime -- from a hook built against
 * an older bundle, say -- and the reducer's `default` branch must absorb it.
 */
function untypedAction(type: string): KanbanBoardAction {
    return { type } as unknown as KanbanBoardAction;
}

/**
 * Three stories in ONE status with NO swimlane, ordered 1, 2, 3. The flat board
 * -- a project with swimlanes disabled -- reuses the swimlane code path unchanged
 * because the swimlane test is FALSY [kanban-usertories.coffee:132].
 */
function makeFlatColumnState(): KanbanBoardState {
    return createInitialBoardState({
        stories: [
            makeStory({ id: 10, status: STATUS_FIRST, kanban_order: 1 }),
            makeStory({ id: 11, status: STATUS_FIRST, kanban_order: 2 }),
            makeStory({ id: 12, status: STATUS_FIRST, kanban_order: 3 }),
        ],
        usStatusList: [
            makeStatus({ id: STATUS_FIRST }),
            makeStatus({ id: STATUS_SECOND }),
        ],
    });
}

/* ==========================================================================
 * createInitialBoardState
 * ========================================================================== */

describe('createInitialBoardState', () => {
    it('populates every field, so no consumer can read undefined out of a fresh board', () => {
        const state = createInitialBoardState();

        // Enumerated rather than shape-matched: a field that silently arrived as
        // `undefined` would read as "not folded", "not selected" or "no stories"
        // at every call site, which is indistinguishable from a real empty board.
        expect(state.storiesById).toEqual({});
        expect(state.order).toEqual({});
        expect(state.swimlanes).toEqual([]);
        expect(state.usStatusList).toEqual([]);
        expect(state.swimlanesStatuses).toEqual({});
        expect(state.usersById).toEqual({});
        expect(state.foldStatusChanged).toEqual({});
        expect(state.statusHide).toEqual([]);
        expect(state.archivedStatus).toEqual([]);
        expect(state.folds).toEqual({});
        expect(state.foldedSwimlane).toEqual({});
        expect(state.selectedUss).toEqual({});
        expect(state.movedUs).toEqual([]);
        expect(state.zoom).toEqual([]);
        expect(state.zoomLoading).toBe(false);
        expect(state.renderInProgress).toBe(false);
        expect(state.notFoundUserstories).toBe(false);

        // `unfold` is the one nullable field, and it starts null [main.coffee:834].
        expect(state.unfold).toBeNull();

        // `initialLoad` starts FALSE [main.coffee:640] and is raised only once the
        // board has actually rendered [main.coffee:646].
        expect(state.initialLoad).toBe(false);

        expect(
            Object.values(state).every((value) => value !== undefined),
        ).toBe(true);
    });

    it('starts the zoom level at -1, which is neither a zoom step nor a stored value', () => {
        // Zoom steps are 0..3. `-1` is the "not yet resolved" sentinel, so the
        // first `SET_ZOOM` always registers as a change instead of being
        // swallowed by the unchanged-level guard [main.coffee:144-145].
        expect(createInitialBoardState().zoomLevel).toBe(-1);
    });

    it('derives the order map from kanban_order, one entry per story', () => {
        const state = createInitialBoardState({
            stories: [
                makeStory({ id: 41, kanban_order: 9 }),
                makeStory({ id: 42, kanban_order: 4 }),
            ],
        });

        // `@.order[it.id] = it.kanban_order` [kanban-usertories.coffee:143].
        expect(state.order).toEqual({ 41: 9, 42: 4 });
        expect(Object.keys(state.storiesById)).toEqual(['41', '42']);
    });

    it('keeps the status list in the order it was handed, because the sort belongs upstream', () => {
        const statuses = [
            makeStatus({ id: STATUS_SECOND }),
            makeStatus({ id: STATUS_FIRST }),
        ];

        const state = createInitialBoardState({ usStatusList: statuses });

        // The kanban controller sorts by "order" [main.coffee:631]; the BACKLOG
        // controller sorts the SAME project list by "id" [backlog/main.coffee:490].
        // The two disagree deliberately, so the reducer sorts neither -- DO NOT
        // UNIFY, and do not add a sort here (T10).
        expect(state.usStatusList.map((status) => status.id)).toEqual([
            STATUS_SECOND,
            STATUS_FIRST,
        ]);
    });

    it('copies every collection it is handed instead of aliasing the caller', () => {
        const swimlanes = [makeSwimlane({ id: SWIMLANE_A })];
        const statuses = [makeStatus({ id: STATUS_FIRST })];
        const usersById = { 4: { id: 4 } };
        const zoom = ['description'];

        const state = createInitialBoardState({
            swimlanes,
            usStatusList: statuses,
            usersById,
            zoom,
        });

        // Aliasing would let a later hydration mutate state the board already
        // rendered from, which reads as a render that never happened.
        expect(state.swimlanes).toEqual(swimlanes);
        expect(state.swimlanes).not.toBe(swimlanes);
        expect(state.usStatusList).not.toBe(statuses);
        expect(state.usersById).toEqual(usersById);
        expect(state.usersById).not.toBe(usersById);
        expect(state.zoom).not.toBe(zoom);
    });

    it('converts the STRING-keyed stored folds into NUMERIC keys without losing an entry', () => {
        const state = createInitialBoardState({
            // `kanbanStorage` reads back what JSON gives it, so its keys are
            // strings; the fold lookups are by numeric status id
            // [main.coffee:835]. Both getters end in `or {}`, so a missing key
            // yields an empty record and no null guard is needed anywhere.
            folds: { '1': true, '2': false },
        });

        expect(state.folds[1]).toBe(true);
        expect(state.folds[2]).toBe(false);
        expect(Object.keys(state.folds)).toHaveLength(2);
    });

    it('keeps the swimlane fold keys as STRINGS, which is the opposite of the fold keys', () => {
        const state = createInitialBoardState({
            foldedSwimlane: { '7': true },
        });

        // `foldedSwimlane.set(id.toString(), ...)` [main.coffee:384], and the
        // record is written straight back to storage [main.coffee:385], so
        // rekeying it would lose the user's folded swimlanes on the next load.
        expect(state.foldedSwimlane['7']).toBe(true);
        expect(Object.keys(state.foldedSwimlane)).toEqual(['7']);
    });

    it('accepts the synthetic unclassified swimlane as a swimlanesStatuses key', () => {
        const allStatuses = [
            makeStatus({ id: STATUS_FIRST }),
            makeStatus({ id: STATUS_SECOND }),
        ];
        const swimlaneStatuses = [makeStatus({ id: STATUS_FIRST })];

        const state = createInitialBoardState({
            swimlanesStatuses: {
                [SWIMLANE_A]: swimlaneStatuses,
                // The unclassified swimlane is given ALL the project's statuses
                // [main.coffee:615], where a real swimlane gets only its own
                // [main.coffee:613]. The reducer preserves that difference.
                [UNCLASSIFIED_SWIMLANE_ID]: allStatuses,
            },
        });

        expect(state.swimlanesStatuses[SWIMLANE_A]).toHaveLength(1);
        expect(state.swimlanesStatuses[UNCLASSIFIED_SWIMLANE_ID]).toHaveLength(2);
        expect(
            state.swimlanesStatuses[UNCLASSIFIED_SWIMLANE_ID].map(
                (status) => status.id,
            ),
        ).toEqual([STATUS_FIRST, STATUS_SECOND]);
    });

    it('coerces the zoom level it is handed, so a stored string arrives as a number', () => {
        const state = createInitialBoardState({
            zoomLevel: untypedZoomLevel('2'),
        });

        // `zoomLevel = Number(zoomLevel)` [main.coffee:143].
        expect(state.zoomLevel).toBe(2);
        expect(typeof state.zoomLevel).toBe('number');
    });
});

/* ==========================================================================
 * HYDRATE
 * ========================================================================== */

describe('HYDRATE', () => {
    it('applies only the keys it was given and leaves the rest untouched by reference', () => {
        const state = makeFlatColumnState();

        const next = reduce(state, {
            type: 'HYDRATE',
            swimlanes: [makeSwimlane({ id: SWIMLANE_A })],
        });

        expect(next.swimlanes.map((swimlane) => swimlane.id)).toEqual([
            SWIMLANE_A,
        ]);

        // Structural sharing: an untouched branch keeps its identity, which is
        // what lets `React.memo` replace Immutable-based change detection
        // (P-IMMER-4). Asserted by reference, not by value.
        expect(next.storiesById).toBe(state.storiesById);
        expect(next.usStatusList).toBe(state.usStatusList);
        expect(next.order).toBe(state.order);
    });

    it('rebuilds the order map whenever it replaces the stories', () => {
        const state = makeFlatColumnState();

        const next = reduce(state, {
            type: 'HYDRATE',
            stories: [makeStory({ id: 99, kanban_order: 6 })],
        });

        expect(next.order).toEqual({ 99: 6 });
        expect(Object.keys(next.storiesById)).toEqual(['99']);
    });

    it('hydrates every remaining slice in one dispatch', () => {
        const next = reduce(createInitialBoardState(), {
            type: 'HYDRATE',
            usStatusList: [makeStatus({ id: STATUS_FIRST })],
            swimlanesStatuses: { [SWIMLANE_A]: [makeStatus({ id: STATUS_FIRST })] },
            usersById: { 4: { id: 4 } },
            folds: { '1': true },
            foldedSwimlane: { '7': true },
            zoom: ['description'],
            zoomLevel: 1,
        });

        expect(next.usStatusList).toHaveLength(1);
        expect(next.swimlanesStatuses[SWIMLANE_A]).toHaveLength(1);
        expect(next.usersById[4]).toEqual({ id: 4 });
        expect(next.folds[1]).toBe(true);
        expect(next.foldedSwimlane['7']).toBe(true);
        expect(next.zoom).toEqual(['description']);
        expect(next.zoomLevel).toBe(1);
    });

    it('is a no-op when handed nothing at all', () => {
        const state = makeFlatColumnState();

        // Nothing is written, so immer returns the base itself rather than a copy.
        expect(reduce(state, { type: 'HYDRATE' })).toBe(state);
    });

    it('accepts a zoom level of 0, which is a real zoom step and not "absent"', () => {
        const next = reduce(createInitialBoardState(), {
            type: 'HYDRATE',
            zoomLevel: 0,
        });

        // Guarded with `!== undefined` rather than truthiness, because level 0 is
        // the smallest card, not a missing value.
        expect(next.zoomLevel).toBe(0);
    });
});


/* ==========================================================================
 * THE STORY COLLECTION — SET_STORIES, ADD_STORIES, REMOVE_STORY, REPLACE_STORY
 * ========================================================================== */

describe('SET_STORIES', () => {
    it('replaces the whole collection, dropping stories the new payload omits', () => {
        const state = makeFlatColumnState();

        const next = reduce(state, {
            type: 'SET_STORIES',
            stories: [makeStory({ id: 12, kanban_order: 8 })],
        });

        // `set()` assigns `userstoriesRaw` outright and refreshes the raw order
        // [kanban-usertories.coffee:48-51], so a filter change that returns fewer
        // stories genuinely removes the others from the board.
        expect(Object.keys(next.storiesById)).toEqual(['12']);
        expect(next.order).toEqual({ 12: 8 });
    });

    it('accepts an empty payload, which is how a filter with no matches renders', () => {
        const next = reduce(makeFlatColumnState(), {
            type: 'SET_STORIES',
            stories: [],
        });

        expect(next.storiesById).toEqual({});
        expect(next.order).toEqual({});
    });
});

describe('ADD_STORIES', () => {
    it('adds every incoming story with its kanban_order as its order', () => {
        const state = makeFlatColumnState();

        const next = reduce(state, {
            type: 'ADD_STORIES',
            stories: [
                makeStory({ id: 20, kanban_order: 7 }),
                makeStory({ id: 21, kanban_order: 5 }),
            ],
        });

        expect(next.order).toEqual({ 10: 1, 11: 2, 12: 3, 20: 7, 21: 5 });
        expect(Object.keys(next.storiesById)).toHaveLength(5);
    });

    it('sorts a COPY of the incoming payload, never the caller\u2019s array', () => {
        // `_.sortBy usList, ['kanban_order']` [kanban-usertories.coffee:82] returns
        // a new array. A React port that reached for `Array.prototype.sort`
        // instead would reorder the caller's array in place -- and because every
        // fixture here is frozen by `produce`, a real payload arriving frozen
        // would make that throw at runtime rather than merely surprise someone.
        const payload: readonly UserStory[] = Object.freeze([
            makeStory({ id: 30, kanban_order: 9 }),
            makeStory({ id: 31, kanban_order: 2 }),
        ]);

        expect(() =>
            reduce(makeFlatColumnState(), { type: 'ADD_STORIES', stories: payload }),
        ).not.toThrow();

        expect(payload.map((story) => story.id)).toEqual([30, 31]);
    });

    it('does not duplicate a story that is already on the board when dispatched twice', () => {
        // The incumbent guarded re-adds with `if !@.usMap.get(usModel.id)`
        // [kanban-usertories.coffee:101], which existed because the collection was
        // an Immutable LIST of ids that could hold the same id twice. Keying by id
        // makes that structurally impossible, which is the point of the seam --
        // but the observable contract is unchanged and asserted here.
        const state = makeFlatColumnState();
        const stories = [makeStory({ id: 40, kanban_order: 4 })];

        const once = reduce(state, { type: 'ADD_STORIES', stories });
        const twice = reduce(once, { type: 'ADD_STORIES', stories });

        expect(Object.keys(twice.storiesById)).toHaveLength(4);
        expect(Object.keys(twice.storiesById)).toEqual(
            Object.keys(once.storiesById),
        );
        expect(countDistinct(Object.keys(twice.storiesById).map(Number))).toBe(4);
    });

    it('rebuilds the order map from kanban_order across the whole board', () => {
        // The rebuild covers every story, not just the arrivals
        // [kanban-usertories.coffee:90], which is why a card whose order was moved
        // client-side returns to its server order once new stories land.
        const moved = reduce(
            makeFlatColumnState(),
            moveCard({ usList: [12], statusId: STATUS_FIRST, previousCard: null }),
        );

        expect(moved.order[12]).toBe(0);

        const next = reduce(moved, {
            type: 'ADD_STORIES',
            stories: [makeStory({ id: 50, kanban_order: 5 })],
        });

        expect(next.order[12]).toBe(3);
        expect(next.order[50]).toBe(5);
    });
});

describe('REMOVE_STORY', () => {
    it('removes the story from BOTH the collection and the order map', () => {
        const next = reduce(makeFlatColumnState(), {
            type: 'REMOVE_STORY',
            storyId: 11,
        });

        // `delete @.order[usModel.id]` [kanban-usertories.coffee:63] alongside the
        // collection delete [:67]. Leaving a stale order entry behind would keep
        // renumbering a card nothing renders.
        expect(next.storiesById[11]).toBeUndefined();
        expect(11 in next.order).toBe(false);
        expect(Object.keys(next.storiesById)).toEqual(['10', '12']);
    });

    it('is a safe no-op for an id the board never held', () => {
        const state = makeFlatColumnState();

        const next = reduce(state, { type: 'REMOVE_STORY', storyId: 4242 });

        // Nothing is written, so immer hands back the base unchanged.
        expect(next).toBe(state);
    });
});

describe('REPLACE_STORY', () => {
    it('swaps the stored story for the one supplied without touching its order', () => {
        const state = makeFlatColumnState();

        const next = reduce(state, {
            type: 'REPLACE_STORY',
            story: makeStory({
                id: 11,
                subject: 'renamed',
                kanban_order: 99,
                version: 4,
            }),
        });

        expect(next.storiesById[11].subject).toBe('renamed');
        expect(next.storiesById[11].version).toBe(4);

        // `replaceModel` [kanban-usertories.coffee:207] replaces the model only;
        // the order map is refreshed by its own call, so a replace on its own must
        // not renumber the column.
        expect(next.order).toEqual(state.order);
    });

    it('adds the story when the board does not hold it yet', () => {
        const next = reduce(makeFlatColumnState(), {
            type: 'REPLACE_STORY',
            story: makeStory({ id: 60, kanban_order: 6 }),
        });

        expect(next.storiesById[60].id).toBe(60);

        // Deliberately NOT registered in the order map: only the paths that own
        // ordering write it, and a replace is not one of them.
        expect(60 in next.order).toBe(false);
    });
});


/* ==========================================================================
 * MOVE_CARD — THE R-DND-2 ORDER-MAP ARITHMETIC
 *
 * The arithmetic every expectation below is hand-computed from, in
 * `app/coffee/modules/kanban/kanban-usertories.coffee`:
 *
 *   L151-152  take the target column and sort it by the CURRENT order map
 *   L154-156  if previousCard: previousUsOrder = order[previousCard] + 1
 *                             previousUsIndex = indexOf(previousCard) + 1
 *   L157-159  else:           previousUsOrder = 0, previousUsIndex = 0
 *   L161-162  drop the moved ids from the sorted column
 *   L164      afterDestination = slice(thatFilteredColumn, previousUsIndex)
 *   L166      initialLength = usList.length + 1
 *   L169      each element of afterDestination:
 *                 order[id] = previousUsOrder + initialLength + key
 *   L171-177  each moved id, in PAYLOAD order:
 *                 status = statusId, swimlane = swimlaneId,
 *                 order[id] = previousUsOrder + key
 *
 * Two properties of that arithmetic are load-bearing and easy to "simplify" away,
 * so both are pinned by exact-value assertions rather than by shape:
 *   - the `+ 1` at L166, which leaves a one-wide gap between the moved block and
 *     the renumbered tail;
 *   - the index at L156, which is measured against the column BEFORE the moved
 *     cards are filtered out but applied to the column AFTER. Where those two
 *     disagree the incumbent leaves cards unrenumbered, and in two fixtures below
 *     it assigns the SAME order to two cards. That is asserted as-is (T10).
 * ========================================================================== */

/** Four cards in one flat column, ordered 1, 2, 3, 4. */
function makeFourCardColumnState(): KanbanBoardState {
    return createInitialBoardState({
        stories: [
            makeStory({ id: 10, status: STATUS_FIRST, kanban_order: 1 }),
            makeStory({ id: 11, status: STATUS_FIRST, kanban_order: 2 }),
            makeStory({ id: 12, status: STATUS_FIRST, kanban_order: 3 }),
            makeStory({ id: 13, status: STATUS_FIRST, kanban_order: 4 }),
        ],
    });
}

/**
 * A board with two swimlanes and two statuses, so a drag can cross the status, the
 * swimlane, or both at once:
 *
 *   swimlane A (7): status 1 -> [20]        status 2 -> [21, 22]
 *   swimlane B (8): status 1 -> [30]        status 2 -> [40]
 */
function makeSwimlaneBoardState(): KanbanBoardState {
    return createInitialBoardState({
        stories: [
            makeStory({
                id: 20,
                status: STATUS_FIRST,
                swimlane: SWIMLANE_A,
                kanban_order: 1,
            }),
            makeStory({
                id: 21,
                status: STATUS_SECOND,
                swimlane: SWIMLANE_A,
                kanban_order: 1,
            }),
            makeStory({
                id: 22,
                status: STATUS_SECOND,
                swimlane: SWIMLANE_A,
                kanban_order: 2,
            }),
            makeStory({
                id: 30,
                status: STATUS_FIRST,
                swimlane: SWIMLANE_B,
                kanban_order: 5,
            }),
            makeStory({
                id: 40,
                status: STATUS_SECOND,
                swimlane: SWIMLANE_B,
                kanban_order: 3,
            }),
        ],
        swimlanes: [
            makeSwimlane({ id: SWIMLANE_A }),
            makeSwimlane({ id: SWIMLANE_B }),
        ],
    });
}

describe('MOVE_CARD at the FIRST position', () => {
    it('numbers the moved card 0 and shifts the ENTIRE column below it', () => {
        // The live first-position path is `moveUsToTop` [main.coffee:175-199],
        // which calls `moveUs(null, uss, us.status, us.swimlane, 0, null, nextUsId)`
        // [main.coffee:199]: previousCard null, index 0, nextCard the current head.
        const state = makeFlatColumnState();

        const next = reduce(
            state,
            moveCard({
                usList: [12],
                statusId: STATUS_FIRST,
                previousCard: null,
                nextCard: 10,
                index: 0,
            }),
        );

        // previousUsOrder = 0 and previousUsIndex = 0 [L157-159], so the slice
        // starts at the head and NOTHING in the column keeps its old order:
        //   tail: order[10] = 0 + 2 + 0 = 2, order[11] = 0 + 2 + 1 = 3
        //   moved: order[12] = 0 + 0 = 0
        expect(next.order).toEqual({ 10: 2, 11: 3, 12: 0 });

        // Both effective inputs, asserted through their consequences: the moved
        // card lands at exactly 0, and every other card was renumbered.
        expect(next.order[12]).toBe(0);
        expect(next.order[10]).not.toBe(state.order[10]);
        expect(next.order[11]).not.toBe(state.order[11]);
    });

    it('sorts the moved card strictly ahead of every other card in the column', () => {
        const next = reduce(
            makeFlatColumnState(),
            moveCard({ usList: [12], statusId: STATUS_FIRST, previousCard: null }),
        );

        const others = ordersOf(next, [10, 11]);

        expect(others.every((order) => order > next.order[12])).toBe(true);
    });

    it('leaves no two cards sharing an order, which is what the "+ 1" at L166 buys', () => {
        // `initialLength = usList.length + 1` [L166] starts the renumbered tail one
        // past the moved block instead of flush against it. Drop the `+ 1` and the
        // exact values below shift by one, which is why they are asserted exactly:
        // a shape assertion passes against that mutation.
        const next = reduce(
            makeFlatColumnState(),
            moveCard({ usList: [12], statusId: STATUS_FIRST, previousCard: null }),
        );

        const columnOrders = ordersOf(next, [10, 11, 12]);

        expect(countDistinct(columnOrders)).toBe(columnOrders.length);
        expect(columnOrders).toEqual([2, 3, 0]);
    });

    it('keeps a multi-card drag in PAYLOAD order, contiguous, below the shifted tail', () => {
        const next = reduce(
            makeFlatColumnState(),
            moveCard({
                usList: [12, 11],
                statusId: STATUS_FIRST,
                previousCard: null,
                nextCard: 10,
            }),
        );

        // Two moved ids, so initialLength = 3 [L166]:
        //   tail:  order[10] = 0 + 3 + 0 = 3
        //   moved: order[12] = 0 + 0 = 0, order[11] = 0 + 1 = 1  (payload order)
        expect(next.order).toEqual({ 10: 3, 11: 1, 12: 0 });

        // The payload's own order decides which of the two ends up first -- NOT
        // their previous order in the column, where 11 preceded 12.
        expect(next.order[12]).toBeLessThan(next.order[11]);
        expect(next.order[11] - next.order[12]).toBe(1);
        expect(next.order[11]).toBeLessThan(next.order[10]);
    });

    it('takes the insert-at-top branch for a previousCard of null', () => {
        const next = reduce(
            makeFlatColumnState(),
            moveCard({ usList: [12], statusId: STATUS_FIRST, previousCard: null }),
        );

        expect(next.order).toEqual({ 10: 2, 11: 3, 12: 0 });
    });

    it('takes the SAME branch for a previousCard of 0, because the test is FALSY', () => {
        // `if previousCard` [L154] is a truthiness test, so an anchor id of 0 reads
        // as "no anchor". This is one of the module's falsy guards and must not be
        // "improved" into `!= null` (T10): the ids that reach here are the ones the
        // neighbour scan produced, and it rejects 0 for exactly this reason.
        const viaNull = reduce(
            makeFlatColumnState(),
            moveCard({ usList: [12], statusId: STATUS_FIRST, previousCard: null }),
        );

        const viaZero = reduce(
            makeFlatColumnState(),
            moveCard({ usList: [12], statusId: STATUS_FIRST, previousCard: 0 }),
        );

        expect(viaZero.order).toEqual(viaNull.order);
        expect(viaZero.order).toEqual({ 10: 2, 11: 3, 12: 0 });
    });
});

describe('MOVE_CARD at the LAST position', () => {
    it('numbers the moved card strictly after every other card in the column', () => {
        const state = makeFlatColumnState();

        const next = reduce(
            state,
            moveCard({
                usList: [10],
                statusId: STATUS_FIRST,
                previousCard: 12,
                nextCard: null,
            }),
        );

        // previousUsOrder = order[12] + 1 = 4 [L155]; previousUsIndex = 2 + 1 = 3
        // [L156]; the filtered column is [11, 12] so slice(3) is EMPTY [L164] and
        // no tail is renumbered. moved: order[10] = 4 + 0 = 4.
        expect(next.order).toEqual({ 10: 4, 11: 2, 12: 3 });

        const others = ordersOf(next, [11, 12]);

        expect(others.every((order) => order < next.order[10])).toBe(true);
    });

    it('disturbs nothing above the insertion point', () => {
        const state = makeFlatColumnState();

        const next = reduce(
            state,
            moveCard({ usList: [10], statusId: STATUS_FIRST, previousCard: 12 }),
        );

        // The two cards that stay put keep the orders they already had, because the
        // slice that renumbers is empty.
        expect(next.order[11]).toBe(state.order[11]);
        expect(next.order[12]).toBe(state.order[12]);
    });

    it('leaves no two cards sharing an order', () => {
        const next = reduce(
            makeFlatColumnState(),
            moveCard({ usList: [10], statusId: STATUS_FIRST, previousCard: 12 }),
        );

        const columnOrders = ordersOf(next, [10, 11, 12]);

        expect(countDistinct(columnOrders)).toBe(columnOrders.length);
    });
});

describe('MOVE_CARD across containers', () => {
    it('changes the status and keeps the swimlane when only the column changes', () => {
        const next = reduce(
            makeSwimlaneBoardState(),
            moveCard({
                usList: [20],
                statusId: STATUS_SECOND,
                swimlaneId: SWIMLANE_A,
                previousCard: 21,
                nextCard: 22,
            }),
        );

        expect(next.storiesById[20].status).toBe(STATUS_SECOND);
        expect(next.storiesById[20].swimlane).toBe(SWIMLANE_A);

        // Target column is [21, 22], sorted 1 then 2. previousUsOrder = 1 + 1 = 2,
        // previousUsIndex = 0 + 1 = 1, so the tail is [22]:
        //   order[22] = 2 + 2 + 0 = 4, order[20] = 2 + 0 = 2
        // The moved card is positioned against the TARGET column's neighbours, not
        // against the column it came from.
        expect(next.order[20]).toBe(2);
        expect(next.order[22]).toBe(4);
        expect(next.order[21]).toBe(1);
        expect(next.order[21]).toBeLessThan(next.order[20]);
        expect(next.order[20]).toBeLessThan(next.order[22]);
    });

    it('changes the swimlane and keeps the status when only the swimlane changes', () => {
        const state = makeSwimlaneBoardState();

        const next = reduce(
            state,
            moveCard({
                usList: [20],
                statusId: STATUS_FIRST,
                swimlaneId: SWIMLANE_B,
                previousCard: 30,
            }),
        );

        expect(next.storiesById[20].swimlane).toBe(SWIMLANE_B);
        expect(next.storiesById[20].status).toBe(STATUS_FIRST);

        // Target column is [30] alone: previousUsOrder = 5 + 1 = 6, the tail is
        // empty, order[20] = 6.
        expect(next.order[20]).toBe(6);
        expect(next.order[30]).toBe(5);

        // It genuinely left the source grouping: nothing with status 1 remains in
        // swimlane A.
        expect(
            Object.values(next.storiesById).filter(
                (story) =>
                    story.status === STATUS_FIRST && story.swimlane === SWIMLANE_A,
            ),
        ).toEqual([]);
    });

    it('changes the status AND the swimlane in a single move', () => {
        const next = reduce(
            makeSwimlaneBoardState(),
            moveCard({
                usList: [20],
                statusId: STATUS_SECOND,
                swimlaneId: SWIMLANE_B,
                previousCard: null,
                nextCard: 40,
            }),
        );

        expect(next.storiesById[20].status).toBe(STATUS_SECOND);
        expect(next.storiesById[20].swimlane).toBe(SWIMLANE_B);

        // Target column is [40]: previousUsOrder = 0, previousUsIndex = 0, so the
        // tail is [40] -> order[40] = 0 + 2 + 0 = 2, and order[20] = 0.
        expect(next.order[20]).toBe(0);
        expect(next.order[40]).toBe(2);
        expect(next.order[20]).toBeLessThan(next.order[40]);

        // The source swimlane's other cards are untouched.
        expect(next.order[21]).toBe(1);
        expect(next.order[22]).toBe(2);
    });
});


/* ==========================================================================
 * MOVE_CARD — THE `-1` -> `null` SWIMLANE NORMALISATION
 *
 * The highest-value assertion in this file. The synthetic swimlane that collects
 * stories belonging to none is `{id: -1, kanban_order: 1, name: KANBAN.
 * UNCLASSIFIED_USER_STORIES}` [kanban-usertories.coffee:316-318]. It is a real
 * grouping key -- the board renders it and it owns a full status set -- but it
 * must NEVER be written onto a story, because the membership test is
 * `us.swimlane == null` [kanban-usertories.coffee:305].
 *
 * A story holding `-1` is matched by that test no more than by any real swimlane.
 * `refreshSwimlanes` would then find NO unclassified stories, never create the
 * synthetic swimlane, and the cards belonging to it would VANISH FROM THE BOARD:
 * no exception, no failed request, no console warning. The incumbent normalises at
 * the controller [main.coffee:661-662]; the reducer normalises at its own edge.
 * ========================================================================== */

/** One unclassified story and one in a real swimlane, both in the same status. */
function makeUnclassifiedBoardState(): KanbanBoardState {
    return createInitialBoardState({
        stories: [
            makeStory({
                id: 50,
                status: STATUS_FIRST,
                swimlane: null,
                kanban_order: 1,
            }),
            makeStory({
                id: 51,
                status: STATUS_FIRST,
                swimlane: SWIMLANE_A,
                kanban_order: 2,
            }),
        ],
        swimlanes: [makeSwimlane({ id: SWIMLANE_A })],
    });
}

describe('MOVE_CARD into the unclassified swimlane', () => {
    it('spells the synthetic swimlane id as -1, which the normalisation depends on', () => {
        expect(UNCLASSIFIED_SWIMLANE_ID).toBe(-1);
    });

    it('stores null, NEVER -1, so the cards do not silently vanish from the board', () => {
        const action = moveCard({
            usList: [51],
            statusId: STATUS_FIRST,
            swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
            previousCard: null,
            nextCard: 50,
        });

        const next = reduce(makeUnclassifiedBoardState(), action);

        expect(next.storiesById[51].swimlane).toBeNull();
        expect(next.storiesById[51].swimlane).not.toBe(UNCLASSIFIED_SWIMLANE_ID);
        expect(next.storiesById[51].swimlane).not.toBe(-1);
    });

    it('is idempotent: a swimlaneId of null already produces the stored value', () => {
        const viaSentinel = reduce(
            makeUnclassifiedBoardState(),
            moveCard({
                usList: [51],
                statusId: STATUS_FIRST,
                swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
                previousCard: null,
            }),
        );

        const viaNull = reduce(
            makeUnclassifiedBoardState(),
            moveCard({
                usList: [51],
                statusId: STATUS_FIRST,
                swimlaneId: null,
                previousCard: null,
            }),
        );

        expect(viaSentinel.storiesById[51].swimlane).toBeNull();
        expect(viaNull.storiesById[51].swimlane).toBeNull();
        expect(viaSentinel.order).toEqual(viaNull.order);
    });

    it('leaves the ACTION payload holding -1, preserving the incumbent asymmetry', () => {
        // `moveUs` broadcasts the UNCONVERTED id [main.coffee:657] and only then
        // derives the converted one [main.coffee:659-662], so the two values coexist
        // by design. The reducer normalises what it STORES without rewriting what it
        // was handed, which is what keeps a caller free to keep using the grouping
        // key for anything else it is mid-way through.
        const action = moveCard({
            usList: [51],
            statusId: STATUS_FIRST,
            swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
            previousCard: null,
        });

        reduce(makeUnclassifiedBoardState(), action);

        expect(action.swimlaneId).toBe(UNCLASSIFIED_SWIMLANE_ID);
    });

    it('treats the whole status as the column, because the swimlane test is FALSY', () => {
        const next = reduce(
            makeUnclassifiedBoardState(),
            moveCard({
                usList: [51],
                statusId: STATUS_FIRST,
                swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
                previousCard: null,
                nextCard: 50,
            }),
        );

        // Once the sentinel becomes `null` the swimlane clause of
        // `it.status == statusId && (!swimlaneId || it.swimlane == swimlaneId)`
        // [kanban-usertories.coffee:132] short-circuits, so BOTH status-1 stories
        // form the column -- which is why story 50 is renumbered here at all:
        //   tail:  order[50] = 0 + 2 + 0 = 2
        //   moved: order[51] = 0 + 0 = 0
        expect(next.order).toEqual({ 50: 2, 51: 0 });
    });
});

/* ==========================================================================
 * MOVE_CARD — ORDERING EDGE CASES THAT CATCH REAL OFF-BY-ONES
 * ========================================================================== */

describe('MOVE_CARD ordering edge cases', () => {
    it('measures the slice index BEFORE filtering and applies it AFTER, leaving a gap', () => {
        // The only arrangement in which the two indices differ: the moved card sits
        // BEFORE its anchor in the sorted column.
        //
        //   sorted column      [10(1), 11(2), 12(3), 13(4)]
        //   anchor 11          previousUsOrder = 2 + 1 = 3   [L155]
        //                      previousUsIndex = 1 + 1 = 2   [L156]  <- PRE-filter
        //   filtered column    [11, 12, 13]                          <- POST-filter
        //   slice(2)           [13]                          [L164]
        //   tail               order[13] = 3 + 2 + 0 = 5     [L169]
        //   moved              order[10] = 3 + 0 = 3         [L177]
        //
        // Card 12 is never renumbered and keeps its order of 3 -- the SAME order the
        // moved card is given. This looks like a bug and IS the specified behaviour:
        // the server recomputes from `after_userstory_id`/`before_userstory_id` and
        // its answer is authoritative, so the client's transient collision is
        // resolved on the next load. Do NOT "correct" the index (T10) -- recompute
        // it against the filtered column and this expectation fails, which is
        // exactly what it is here to do.
        const next = reduce(
            makeFourCardColumnState(),
            moveCard({
                usList: [10],
                statusId: STATUS_FIRST,
                previousCard: 11,
                nextCard: 12,
            }),
        );

        expect(next.order).toEqual({ 10: 3, 11: 2, 12: 3, 13: 5 });
    });

    it('survives an anchor that is itself one of the moved cards', () => {
        // A drag that lands where it started: the anchor is filtered out of the
        // column it is being measured in.
        //   previousUsOrder = order[11] + 1 = 3, previousUsIndex = 1 + 1 = 2
        //   filtered [10, 12], slice(2) = [] -> no tail
        //   moved    order[11] = 3
        const state = makeFlatColumnState();

        const next = reduce(
            state,
            moveCard({ usList: [11], statusId: STATUS_FIRST, previousCard: 11 }),
        );

        expect(next.order).toEqual({ 10: 1, 11: 3, 12: 3 });

        // Coherent: still one entry per story, every value finite, nothing lost.
        expect(Object.keys(next.order)).toEqual(Object.keys(state.order));
        expect(ordersOf(next, [10, 11, 12]).every(Number.isFinite)).toBe(true);
    });

    it('skips a moved id the board does not hold instead of throwing inside the draft', () => {
        // The incumbent would have thrown on the missing model [L172-173]. A throw
        // raised inside a `produce` recipe aborts the whole draft, so the board
        // would lose the drag AND the render that followed it.
        const state = makeFlatColumnState();

        expect(() =>
            reduce(
                state,
                moveCard({
                    usList: [4242],
                    statusId: STATUS_FIRST,
                    previousCard: null,
                }),
            ),
        ).not.toThrow();

        const next = reduce(
            state,
            moveCard({ usList: [4242], statusId: STATUS_FIRST, previousCard: null }),
        );

        // The tail is still renumbered -- the id is absent only from the moved loop:
        //   order[10] = 0 + 2 + 0 = 2, order[11] = 3, order[12] = 4
        expect(next.order).toEqual({ 10: 2, 11: 3, 12: 4 });

        // And no order entry is invented for a story that does not exist.
        expect(4242 in next.order).toBe(false);
        expect(next.storiesById[4242]).toBeUndefined();
    });

    it('gives the only card in an empty target column a finite order', () => {
        const state = createInitialBoardState({
            stories: [
                makeStory({
                    id: 80,
                    status: STATUS_FIRST,
                    swimlane: SWIMLANE_A,
                    kanban_order: 1,
                }),
            ],
        });

        const next = reduce(
            state,
            moveCard({
                usList: [80],
                statusId: STATUS_SECOND,
                swimlaneId: SWIMLANE_A,
                previousCard: null,
            }),
        );

        expect(next.order[80]).toBe(0);
        expect(Number.isFinite(next.order[80])).toBe(true);
        expect(next.storiesById[80].status).toBe(STATUS_SECOND);
        expect(next.storiesById[80].swimlane).toBe(SWIMLANE_A);
    });

    it('never produces NaN from an anchor that carries no order', () => {
        // `undefined + 1` is NaN, and NaN sorts unpredictably -- a textbook silent
        // order corruption. The anchor's order is read defensively, so an anchor
        // absent from the map reads as 0 rather than poisoning the whole column.
        const state = createInitialBoardState({
            stories: [
                makeStory({ id: 90, status: STATUS_FIRST, kanban_order: 1 }),
                makeStory({ id: 91, status: STATUS_FIRST, kanban_order: 2 }),
            ],
        });

        const next = reduce(
            state,
            moveCard({ usList: [91], statusId: STATUS_FIRST, previousCard: 4242 }),
        );

        // previousUsOrder = 0 + 1 = 1; previousUsIndex = -1 + 1 = 0, so the whole
        // filtered column is the tail: order[90] = 1 + 2 + 0 = 3, order[91] = 1.
        expect(next.order).toEqual({ 90: 3, 91: 1 });
        expect(ordersOf(next, [90, 91]).every(Number.isFinite)).toBe(true);
        expect(ordersOf(next, [90, 91]).some(Number.isNaN)).toBe(false);
    });

    it('does not renumber cards in other columns or other swimlanes', () => {
        const state = makeSwimlaneBoardState();

        const next = reduce(
            state,
            moveCard({
                usList: [21],
                statusId: STATUS_SECOND,
                swimlaneId: SWIMLANE_A,
                previousCard: 22,
            }),
        );

        // Swimlane B is untouched by a drag inside swimlane A.
        expect(next.order[30]).toBe(state.order[30]);
        expect(next.order[40]).toBe(state.order[40]);
        expect(next.storiesById[30].swimlane).toBe(SWIMLANE_B);
        expect(next.storiesById[40].swimlane).toBe(SWIMLANE_B);
    });
});

describe('MOVE_CARD immutability', () => {
    it('returns a new state and mutates none of the input', () => {
        const state = makeSwimlaneBoardState();

        const next = reduce(
            state,
            moveCard({
                usList: [20],
                statusId: STATUS_SECOND,
                swimlaneId: SWIMLANE_B,
                previousCard: null,
            }),
        );

        expect(next).not.toBe(state);

        // The input still describes the board as it was before the drag.
        expect(state.storiesById[20].status).toBe(STATUS_FIRST);
        expect(state.storiesById[20].swimlane).toBe(SWIMLANE_A);
        expect(state.order[20]).toBe(1);
        expect(state.order[40]).toBe(3);
    });

    it('keeps untouched branches referentially identical, which is what React.memo needs', () => {
        const state = makeSwimlaneBoardState();

        const next = reduce(
            state,
            moveCard({ usList: [20], statusId: STATUS_FIRST, previousCard: null }),
        );

        // immer's structural sharing is the whole reason `React.memo` can replace
        // Immutable-based change detection (P-IMMER-4): a branch the reducer did not
        // enter comes back as the SAME object, so a memoised child skips its render.
        expect(next.usStatusList).toBe(state.usStatusList);
        expect(next.swimlanes).toBe(state.swimlanes);
        expect(next.selectedUss).toBe(state.selectedUss);
        expect(next.folds).toBe(state.folds);
        expect(next.foldedSwimlane).toBe(state.foldedSwimlane);
    });
});

/* ==========================================================================
 * MOVE_TO_END
 *
 * `moveToEnd` has ZERO call sites anywhere in the incumbent -- its only match is
 * its own definition [kanban-usertories.coffee:192] -- so this suite is its sole
 * consumer, and the only thing standing between it and a silent regression.
 * ========================================================================== */

describe('MOVE_TO_END', () => {
    it('writes the -1 order sentinel and the new status', () => {
        const next = reduce(
            makeFlatColumnState(),
            { type: 'MOVE_TO_END', storyId: 11, statusId: STATUS_SECOND },
        );

        // `@.order[us.id] = -1` [kanban-usertories.coffee:195]. Unrelated to the
        // swimlane sentinel: here `-1` means "append", and the real position comes
        // back from the server with the reloaded story.
        expect(next.order[11]).toBe(-1);
        expect(next.storiesById[11].status).toBe(STATUS_SECOND);
    });

    it('writes BOTH the order map AND the story\u2019s own kanban_order', () => {
        const next = reduce(
            makeFlatColumnState(),
            { type: 'MOVE_TO_END', storyId: 11, statusId: STATUS_SECOND },
        );

        // `us.kanban_order = @.order[us.id]` [kanban-usertories.coffee:198] -- the
        // second write is the one that is easy to lose, because the board reads the
        // order map and only a reload reads `kanban_order`.
        expect(next.storiesById[11].kanban_order).toBe(-1);
        expect(next.order[11]).toBe(next.storiesById[11].kanban_order);
    });

    it('leaves the swimlane alone, because appending is not a regrouping', () => {
        const next = reduce(
            makeSwimlaneBoardState(),
            { type: 'MOVE_TO_END', storyId: 20, statusId: STATUS_SECOND },
        );

        expect(next.storiesById[20].swimlane).toBe(SWIMLANE_A);
    });

    it('is a safe no-op for a story the board does not hold', () => {
        const state = makeFlatColumnState();

        const next = reduce(state, {
            type: 'MOVE_TO_END',
            storyId: 4242,
            statusId: STATUS_SECOND,
        });

        expect(next).toBe(state);
        expect(4242 in next.order).toBe(false);
    });

    it('differs from MOVE_CARD, which writes the order map ONLY', () => {
        const state = makeFlatColumnState();

        const moved = reduce(
            state,
            moveCard({ usList: [11], statusId: STATUS_SECOND, previousCard: null }),
        );

        // `move()` never assigns `kanban_order` [kanban-usertories.coffee:171-177];
        // `moveToEnd` assigns both [:195,:198]. The asymmetry is deliberate and must
        // not be unified (T10): a dragged card's server order arrives with the
        // bulk-update response, whereas an appended card has none to arrive.
        expect(moved.storiesById[11].kanban_order).toBe(
            state.storiesById[11].kanban_order,
        );
        expect(moved.order[11]).not.toBe(moved.storiesById[11].kanban_order);
    });
});


/* ==========================================================================
 * CARD FOLDS — TOGGLE_FOLD, RESET_FOLDS
 * ========================================================================== */

describe('TOGGLE_FOLD and RESET_FOLDS', () => {
    it('flips one card\u2019s fold state on and off again', () => {
        // `@.foldStatusChanged[usId] = !@.foldStatusChanged[usId]`
        // [kanban-usertories.coffee:45]. The card reads it to choose between
        // `icon-arrow-down` and `icon-arrow-up`.
        const opened = reduce(makeFlatColumnState(), {
            type: 'TOGGLE_FOLD',
            storyId: 11,
        });

        expect(opened.foldStatusChanged[11]).toBe(true);

        const closed = reduce(opened, { type: 'TOGGLE_FOLD', storyId: 11 });

        expect(closed.foldStatusChanged[11]).toBe(false);
    });

    it('clears every card fold at once, which is what a zoom change asks for', () => {
        // `resetFolds` empties the record outright [kanban-usertories.coffee:41-42].
        // It is the CARD folds this clears -- the column folds are a different
        // record with a different key type, and nothing here touches them.
        const state = reduce(
            reduce(makeFlatColumnState(), { type: 'TOGGLE_FOLD', storyId: 10 }),
            { type: 'TOGGLE_FOLD', storyId: 11 },
        );

        expect(Object.keys(state.foldStatusChanged)).toHaveLength(2);

        const next = reduce(state, { type: 'RESET_FOLDS' });

        expect(next.foldStatusChanged).toEqual({});
        expect(next.folds).toBe(state.folds);
    });
});

/* ==========================================================================
 * COLUMN FOLDS AND THE UNFOLD LATCH — TOGGLE_STATUS_COLUMN_FOLD, SET_FOLDS
 * ========================================================================== */

describe('TOGGLE_STATUS_COLUMN_FOLD', () => {
    it('folds a column and leaves the unfold latch empty', () => {
        // `$scope.folds[status.id] = !!!$scope.folds[status.id]` [main.coffee:835]
        // over a NUMERIC status id, with `$scope.unfold = null` first
        // [main.coffee:834].
        const next = reduce(createInitialBoardState(), {
            type: 'TOGGLE_STATUS_COLUMN_FOLD',
            statusId: STATUS_FIRST,
        });

        expect(next.folds[STATUS_FIRST]).toBe(true);
        expect(next.unfold).toBeNull();
    });

    it('latches the unfold on the way back OPEN, which is what drives .vunfold', () => {
        // `if !$scope.folds[status.id] then $scope.unfold = status.id`
        // [main.coffee:837-838]. The markup applies `vunfold` only to the column
        // whose id matches [kanban-table.jade:113,190], so the latch has to name
        // one column rather than being a boolean.
        const folded = reduce(createInitialBoardState(), {
            type: 'TOGGLE_STATUS_COLUMN_FOLD',
            statusId: STATUS_FIRST,
        });

        const unfolded = reduce(folded, {
            type: 'TOGGLE_STATUS_COLUMN_FOLD',
            statusId: STATUS_FIRST,
        });

        expect(unfolded.folds[STATUS_FIRST]).toBe(false);
        expect(unfolded.unfold).toBe(STATUS_FIRST);
    });

    it('clears a pending latch when a DIFFERENT column is folded', () => {
        const withLatch = reduce(
            reduce(createInitialBoardState(), {
                type: 'TOGGLE_STATUS_COLUMN_FOLD',
                statusId: STATUS_FIRST,
            }),
            { type: 'TOGGLE_STATUS_COLUMN_FOLD', statusId: STATUS_FIRST },
        );

        expect(withLatch.unfold).toBe(STATUS_FIRST);

        const next = reduce(withLatch, {
            type: 'TOGGLE_STATUS_COLUMN_FOLD',
            statusId: STATUS_SECOND,
        });

        // The reset at [main.coffee:834] runs before the flip, so at most one column
        // is ever mid-unfold and the animation cannot be applied to two at once.
        expect(next.unfold).toBeNull();
        expect(next.folds).toEqual({
            [STATUS_FIRST]: false,
            [STATUS_SECOND]: true,
        });
    });
});

describe('SET_FOLDS', () => {
    /** A board whose status list includes one archived status. */
    function makeArchivedStatusState(): KanbanBoardState {
        return createInitialBoardState({
            usStatusList: [
                makeStatus({ id: STATUS_FIRST }),
                makeStatus({ id: STATUS_SECOND }),
                makeStatus({ id: STATUS_ARCHIVED, is_archived: true }),
            ],
        });
    }

    it('rekeys the stored record from STRING to NUMBER without dropping an entry', () => {
        const next = reduce(createInitialBoardState(), {
            type: 'SET_FOLDS',
            // What `getStatusColumnModes` hands back: JSON object keys, so strings.
            folds: { '1': true, '2': false, '5': true },
        });

        expect(next.folds[1]).toBe(true);
        expect(next.folds[2]).toBe(false);
        expect(next.folds[5]).toBe(true);
        expect(Object.keys(next.folds)).toHaveLength(3);
    });

    it('coerces the key rather than copying it, so a non-canonical key resolves numerically', () => {
        // The coercion probe. Storage writes canonical keys, so `'007'` is
        // synthetic -- but it is the only way to SHOW that the key is passed through
        // `Number()` rather than copied verbatim, and it is the exact opposite of
        // what the swimlane record does with the same input.
        const next = reduce(createInitialBoardState(), {
            type: 'SET_FOLDS',
            folds: { '007': true },
        });

        expect(next.folds[7]).toBe(true);
        expect('007' in next.folds).toBe(false);
        expect(Object.keys(next.folds)).toEqual(['7']);
    });

    it('forces every ARCHIVED status folded, whatever the stored record said', () => {
        // `_.filter(...).forEach -> $scope.folds[status.id] = true`
        // [main.coffee:847-855], applied once `initialLoad` rises. The archived
        // column is the squished rail on the right, so it must open only on demand.
        const next = reduce(makeArchivedStatusState(), {
            type: 'SET_FOLDS',
            folds: { '1': true, '5': false },
        });

        expect(next.folds[STATUS_ARCHIVED]).toBe(true);
    });

    it('does NOT fold a status that is not archived', () => {
        const next = reduce(makeArchivedStatusState(), {
            type: 'SET_FOLDS',
            folds: { '1': false },
        });

        expect(next.folds[STATUS_FIRST]).toBe(false);

        // A status the stored record never mentioned stays absent rather than being
        // invented as folded -- an absent key reads as "not folded" everywhere.
        expect(STATUS_SECOND in next.folds).toBe(false);
    });

    it('replaces the record wholesale, dropping folds the stored record omits', () => {
        const state = reduce(createInitialBoardState(), {
            type: 'SET_FOLDS',
            folds: { '1': true, '2': true },
        });

        const next = reduce(state, { type: 'SET_FOLDS', folds: { '2': true } });

        expect(next.folds).toEqual({ 2: true });
    });

    it('adds an archived fold even when handed an empty record', () => {
        // Both storage getters end in `or {}`, so an empty record is the normal
        // first-visit value and needs no null guard at any call site.
        const next = reduce(makeArchivedStatusState(), {
            type: 'SET_FOLDS',
            folds: {},
        });

        expect(next.folds).toEqual({ [STATUS_ARCHIVED]: true });
    });
});

/* ==========================================================================
 * SWIMLANE FOLDS — TOGGLE_SWIMLANE, SET_FOLDED_SWIMLANES
 * ========================================================================== */

describe('TOGGLE_SWIMLANE', () => {
    it('keys the record by STRING, even though the id arrives as a number', () => {
        // `@.foldedSwimlane.set(id.toString(), !@.foldedSwimlane.get(id.toString()))`
        // [main.coffee:384]. The record is written straight back to storage
        // [main.coffee:385], which is why the key type is part of the contract and
        // not an implementation detail.
        const next = reduce(createInitialBoardState(), {
            type: 'TOGGLE_SWIMLANE',
            swimlaneId: 3,
        });

        expect('3' in next.foldedSwimlane).toBe(true);
        expect(next.foldedSwimlane['3']).toBe(true);

        // Exactly one key: no second, numeric-looking entry was created alongside it.
        expect(Object.keys(next.foldedSwimlane)).toEqual(['3']);
    });

    it('flips the same key back on a second toggle', () => {
        const collapsed = reduce(createInitialBoardState(), {
            type: 'TOGGLE_SWIMLANE',
            swimlaneId: 3,
        });

        const expanded = reduce(collapsed, {
            type: 'TOGGLE_SWIMLANE',
            swimlaneId: 3,
        });

        expect(expanded.foldedSwimlane['3']).toBe(false);
        expect(Object.keys(expanded.foldedSwimlane)).toEqual(['3']);

        // The 100 ms `redraw:wip` broadcast that follows the toggle
        // [main.coffee:387-389] belongs to the hook: the reducer owns no timers, so
        // nothing here uses fake timers.
    });

    it('keys the unclassified swimlane by its sentinel id, which is a legitimate key', () => {
        const next = reduce(createInitialBoardState(), {
            type: 'TOGGLE_SWIMLANE',
            swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
        });

        // `-1` is barred from a STORY's swimlane field and perfectly ordinary as a
        // grouping key: the synthetic swimlane folds like any other.
        expect(next.foldedSwimlane['-1']).toBe(true);
    });
});

describe('SET_FOLDED_SWIMLANES', () => {
    it('stores the persisted keys VERBATIM, never coercing them', () => {
        const next = reduce(createInitialBoardState(), {
            type: 'SET_FOLDED_SWIMLANES',
            foldedSwimlane: { '007': true },
        });

        // The exact opposite of `SET_FOLDS` given the same input: this record is
        // round-tripped to storage, so rekeying it would silently discard the user's
        // folded swimlanes on their next visit.
        expect(next.foldedSwimlane['007']).toBe(true);
        expect('007' in next.foldedSwimlane).toBe(true);
        expect(7 in next.foldedSwimlane).toBe(false);
    });

    it('copies the record instead of aliasing the caller\u2019s object', () => {
        const stored = { '7': true };

        const next = reduce(createInitialBoardState(), {
            type: 'SET_FOLDED_SWIMLANES',
            foldedSwimlane: stored,
        });

        expect(next.foldedSwimlane).toEqual(stored);
        expect(next.foldedSwimlane).not.toBe(stored);
    });

    it('force-unfolds the FIRST swimlane when a filter matches nothing', () => {
        // The composition at [main.coffee:164-170]: when `swimlanesList` is
        // non-empty and the filtered result is EMPTY, the first swimlane's key is
        // set to FALSE. Without it an empty filtered board is a blank rectangle --
        // every swimlane collapsed and no explanation on screen.
        //
        // The debounce (`debounceLeading 100`) and the reload itself are hook-owned;
        // the reducer's share is storing the record it is handed, which is what this
        // asserts.
        const collapsed = reduce(createInitialBoardState(), {
            type: 'SET_FOLDED_SWIMLANES',
            foldedSwimlane: { '7': true, '8': true },
        });

        const next = reduce(collapsed, {
            type: 'SET_FOLDED_SWIMLANES',
            foldedSwimlane: { ...collapsed.foldedSwimlane, '7': false },
        });

        expect(next.foldedSwimlane['7']).toBe(false);

        // Negative path: the swimlanes that were not named keep their fold state, so
        // a non-empty result leaves the board exactly as the user left it.
        expect(next.foldedSwimlane['8']).toBe(true);
    });
});

/* ==========================================================================
 * SELECTION — TOGGLE_SELECTED_US, CLEAN_SELECTED_USS
 * ========================================================================== */

describe('TOGGLE_SELECTED_US', () => {
    it('flips one story\u2019s selection on and off', () => {
        // `@.selectedUss[usId] = !@.selectedUss[usId]` [main.coffee:125].
        const selected = reduce(makeFlatColumnState(), {
            type: 'TOGGLE_SELECTED_US',
            storyId: 11,
        });

        expect(selected.selectedUss[11]).toBe(true);

        const deselected = reduce(selected, {
            type: 'TOGGLE_SELECTED_US',
            storyId: 11,
        });

        expect(deselected.selectedUss[11]).toBe(false);
    });
});

describe('CLEAN_SELECTED_USS', () => {
    function makeSelectionState(): KanbanBoardState {
        return reduce(
            reduce(makeFlatColumnState(), {
                type: 'TOGGLE_SELECTED_US',
                storyId: 11,
            }),
            { type: 'TOGGLE_SELECTED_US', storyId: 12 },
        );
    }

    it('sets every existing key to false and NEVER deletes one', () => {
        // `for key of @.selectedUss then @.selectedUss[key] = false`
        // [main.coffee:120-122]. It assigns; it does not delete. The key set is
        // observable: `kanban-task-selected` and `ui-multisortable-multiple` are both
        // bound to `ctrl.selectedUss[usId]` [kanban-table.jade:154,230], so the
        // lookups have to keep resolving.
        const state = makeSelectionState();

        expect(Object.keys(state.selectedUss)).toHaveLength(2);

        const next = reduce(state, { type: 'CLEAN_SELECTED_USS' });

        expect(Object.keys(next.selectedUss)).toHaveLength(2);
        expect(Object.keys(next.selectedUss)).toEqual(
            Object.keys(state.selectedUss),
        );
        expect(Object.values(next.selectedUss).every((value) => value === false))
            .toBe(true);
    });

    it('is NOT an empty record afterwards', () => {
        // Stated as its own expectation because emptying the record is the obvious
        // "simplification", it looks identical in the UI, and it is wrong (T10).
        const next = reduce(makeSelectionState(), { type: 'CLEAN_SELECTED_USS' });

        expect(next.selectedUss).not.toEqual({});
        expect(next.selectedUss).toEqual({ 11: false, 12: false });
    });

    it('is harmless when nothing was selected', () => {
        const state = makeFlatColumnState();

        expect(reduce(state, { type: 'CLEAN_SELECTED_USS' }).selectedUss).toEqual(
            {},
        );
    });

    it('preserves the keys of a record it did not build itself', () => {
        // Built directly rather than reached through toggles, because a board
        // restored mid-flight arrives with a selection the reducer never assembled.
        // Nothing here may depend on having seen the dispatches that produced it.
        const state = makeState({ selectedUss: { 11: true, 12: false } });

        const next = reduce(state, { type: 'CLEAN_SELECTED_USS' });

        expect(next.selectedUss).toEqual({ 11: false, 12: false });
        expect(Object.keys(next.selectedUss)).toHaveLength(2);
    });
});

/* ==========================================================================
 * THE MOVED-CARD HIGHLIGHT — MARK_US_MOVED, CLEAR_MOVED_US
 * ========================================================================== */

describe('MARK_US_MOVED and CLEAR_MOVED_US', () => {
    it('appends each moved story id in the order it was marked', () => {
        // `@.movedUs.push(us.id)` [main.coffee:182]. `kanban-moved` is applied while
        // the id is present [kanban-table.jade:154].
        const first = reduce(makeFlatColumnState(), {
            type: 'MARK_US_MOVED',
            storyId: 11,
        });

        const second = reduce(first, { type: 'MARK_US_MOVED', storyId: 12 });

        expect(second.movedUs).toEqual([11, 12]);
    });

    it('empties the list in one dispatch', () => {
        // `@timeout (=> @.movedUs = []), 1000, false` [main.coffee:183-185]: the
        // highlight is cleared after exactly 1000 ms with `invokeApply` FALSE. That
        // TIMER BELONGS TO THE HOOK -- the reducer only knows how to empty the list,
        // so there is nothing here to drive with fake timers.
        const state = reduce(makeFlatColumnState(), {
            type: 'MARK_US_MOVED',
            storyId: 11,
        });

        expect(reduce(state, { type: 'CLEAR_MOVED_US' }).movedUs).toEqual([]);
    });

    it('empties a list it did not build, however many ids are on it', () => {
        // Several ids can be in flight at once: a multi-card drag marks each one,
        // and the single 1000 ms timer clears the whole list rather than one entry.
        const state = makeState({ movedUs: [10, 11, 12] });

        expect(reduce(state, { type: 'CLEAR_MOVED_US' }).movedUs).toEqual([]);
    });
});


/* ==========================================================================
 * ZOOM — SET_ZOOM, SET_ZOOM_LOADING
 * ========================================================================== */

describe('SET_ZOOM', () => {
    it('records the level and the feature list together', () => {
        const next = reduce(createInitialBoardState(), {
            type: 'SET_ZOOM',
            zoomLevel: 1,
            zoom: ['description'],
        });

        expect(next.zoomLevel).toBe(1);
        expect(next.zoom).toEqual(['description']);
    });

    it('copies the feature list rather than aliasing the caller\u2019s array', () => {
        const zoom = ['description'];

        const next = reduce(createInitialBoardState(), {
            type: 'SET_ZOOM',
            zoomLevel: 1,
            zoom,
        });

        expect(next.zoom).not.toBe(zoom);
    });

    it('coerces a level that arrives as a string', () => {
        // `zoomLevel = Number(zoomLevel)` [main.coffee:143].
        const next = reduce(createInitialBoardState(), {
            type: 'SET_ZOOM',
            zoomLevel: untypedZoomLevel('2'),
            zoom: [],
        });

        expect(next.zoomLevel).toBe(2);
        expect(typeof next.zoomLevel).toBe('number');
    });

    it('treats an unchanged level as a complete no-op', () => {
        // `if @.zoomLevel == zoomLevel then return null` [main.coffee:144-145].
        // Reference equality is the assertion, not value equality: immer returns the
        // BASE when a recipe writes nothing, so a memoised board does not re-render
        // when the zoom control re-announces the level it is already on.
        const state = createInitialBoardState({ zoomLevel: 2 });

        const next = reduce(state, {
            type: 'SET_ZOOM',
            zoomLevel: 2,
            zoom: ['description'],
        });

        expect(next).toBe(state);
        expect(next.zoom).toEqual([]);
    });

    it('recognises a STRING level as unchanged, because the coercion happens first', () => {
        // The coercion and the guard are ordered deliberately: without `Number()`
        // the comparison would be `2 === '2'`, every re-announcement would register
        // as a change, and the extra-detail fetch would fire on each one.
        const state = createInitialBoardState({ zoomLevel: 2 });

        const next = reduce(state, {
            type: 'SET_ZOOM',
            zoomLevel: untypedZoomLevel('2'),
            zoom: [],
        });

        expect(next).toBe(state);
    });

    it('raises the loading flag when the level crosses UP past 2', () => {
        // `if @.zoomLevel > 2 && previousZoomLevel <= 2 then @.zoomLoading = true`
        // [main.coffee:157-158]. Only the two largest zoom steps render the extra
        // per-card detail that has to be fetched. The fetch itself, and the
        // `resetFolds()` that follows it [main.coffee:160-162], are I/O and belong to
        // the hook -- the reducer's whole share is this flag.
        const state = createInitialBoardState({ zoomLevel: 2 });

        const next = reduce(state, { type: 'SET_ZOOM', zoomLevel: 3, zoom: [] });

        expect(next.zoomLoading).toBe(true);
        expect(next.zoomLevel).toBe(3);
    });

    it('does NOT raise it again when moving between two large levels', () => {
        // 3 -> 4 crosses nothing: the detail is already loaded, so a second fetch
        // would be pure waste.
        const state = createInitialBoardState({ zoomLevel: 3 });

        const next = reduce(state, { type: 'SET_ZOOM', zoomLevel: 4, zoom: [] });

        expect(next.zoomLoading).toBe(false);
        expect(next.zoomLevel).toBe(4);
    });

    it('does NOT raise it when the level drops back down', () => {
        const state = createInitialBoardState({ zoomLevel: 3 });

        const next = reduce(state, { type: 'SET_ZOOM', zoomLevel: 1, zoom: [] });

        expect(next.zoomLoading).toBe(false);
    });

    it('does NOT raise it when moving between two small levels', () => {
        const state = createInitialBoardState({ zoomLevel: 1 });

        const next = reduce(state, { type: 'SET_ZOOM', zoomLevel: 2, zoom: [] });

        expect(next.zoomLoading).toBe(false);
    });

    it('raises it on the very first resolution into a large level', () => {
        // The unresolved level is -1, which satisfies `<= 2`, so a board restored
        // straight into zoom 3 still fetches the detail it needs.
        const next = reduce(createInitialBoardState(), {
            type: 'SET_ZOOM',
            zoomLevel: 3,
            zoom: [],
        });

        expect(next.zoomLoading).toBe(true);
    });
});

describe('SET_ZOOM_LOADING', () => {
    it('lowers the flag once the extra detail has arrived', () => {
        // `@.zoomLoading = false` in the reload's continuation [main.coffee:161].
        const loading = reduce(createInitialBoardState({ zoomLevel: 2 }), {
            type: 'SET_ZOOM',
            zoomLevel: 3,
            zoom: [],
        });

        expect(loading.zoomLoading).toBe(true);

        const next = reduce(loading, {
            type: 'SET_ZOOM_LOADING',
            zoomLoading: false,
        });

        expect(next.zoomLoading).toBe(false);
    });

    it('can raise the flag on its own', () => {
        const next = reduce(createInitialBoardState(), {
            type: 'SET_ZOOM_LOADING',
            zoomLoading: true,
        });

        expect(next.zoomLoading).toBe(true);
    });
});

/* ==========================================================================
 * RENDER AND LOAD FLAGS
 * ========================================================================== */

describe('SET_RENDER_IN_PROGRESS', () => {
    it('raises and lowers the batching flag', () => {
        // `@.renderInProgress = true` [main.coffee:428] while the board renders its
        // batches, `false` when the last batch lands [main.coffee:448]. The batch
        // schedule is `[200, 100, 50]` with a `|| 20` fallback, and it belongs to
        // the hook. The flag itself is bound to the column counter's `disabled`
        // attribute [kanban-table.jade:127,203], so it must be observable state.
        const started = reduce(createInitialBoardState(), {
            type: 'SET_RENDER_IN_PROGRESS',
            renderInProgress: true,
        });

        expect(started.renderInProgress).toBe(true);

        const finished = reduce(started, {
            type: 'SET_RENDER_IN_PROGRESS',
            renderInProgress: false,
        });

        expect(finished.renderInProgress).toBe(false);
    });
});

describe('SET_INITIAL_LOAD', () => {
    it('rises exactly once, from the false it starts at', () => {
        // `@.initialLoad = false` [main.coffee:640] then `true` [main.coffee:646].
        // The archived-column directive watches it and UNWATCHES on the first truthy
        // value [main.coffee:785-788], which is what makes the archived force-fold a
        // one-time event rather than a rule.
        //
        // The measured timing is `@timeout(..., 0, true)` -- `invokeApply` TRUE here,
        // in deliberate contrast with the WIP marker's `, 0, false`. Not a typo in
        // the source, and not the reducer's concern either way.
        const state = createInitialBoardState();

        expect(state.initialLoad).toBe(false);

        const next = reduce(state, { type: 'SET_INITIAL_LOAD', initialLoad: true });

        expect(next.initialLoad).toBe(true);
    });

    it('can be lowered again, which is what a project switch does', () => {
        const loaded = reduce(createInitialBoardState(), {
            type: 'SET_INITIAL_LOAD',
            initialLoad: true,
        });

        expect(
            reduce(loaded, { type: 'SET_INITIAL_LOAD', initialLoad: false })
                .initialLoad,
        ).toBe(false);
    });
});

describe('SET_NOT_FOUND_USERSTORIES', () => {
    it('raises and lowers the empty-filter flag', () => {
        // Lowered before every load [main.coffee:553] and raised only when a filter
        // or a query was actually applied [main.coffee:555-556]. It drives the
        // `not-found` class [kanban-table.jade:146,222], which is why an empty board
        // with no filter must NOT show it.
        const raised = reduce(createInitialBoardState(), {
            type: 'SET_NOT_FOUND_USERSTORIES',
            notFoundUserstories: true,
        });

        expect(raised.notFoundUserstories).toBe(true);

        const lowered = reduce(raised, {
            type: 'SET_NOT_FOUND_USERSTORIES',
            notFoundUserstories: false,
        });

        expect(lowered.notFoundUserstories).toBe(false);
    });
});

/* ==========================================================================
 * STATUS VISIBILITY — HIDE_STATUS, SHOW_STATUS, ADD_ARCHIVED_STATUS
 * ========================================================================== */

describe('HIDE_STATUS and SHOW_STATUS', () => {
    it('appends each hidden status id', () => {
        // `@.statusHide.push(statusId)` [kanban-usertories.coffee:125].
        const next = reduce(
            reduce(createInitialBoardState(), {
                type: 'HIDE_STATUS',
                statusId: STATUS_FIRST,
            }),
            { type: 'HIDE_STATUS', statusId: STATUS_ARCHIVED },
        );

        expect(next.statusHide).toEqual([STATUS_FIRST, STATUS_ARCHIVED]);
    });

    it('removes just the one status it is asked to show', () => {
        // `_.remove @.statusHide, (it) -> it == statusId`
        // [kanban-usertories.coffee:128].
        const hidden = reduce(
            reduce(createInitialBoardState(), {
                type: 'HIDE_STATUS',
                statusId: STATUS_FIRST,
            }),
            { type: 'HIDE_STATUS', statusId: STATUS_ARCHIVED },
        );

        const next = reduce(hidden, {
            type: 'SHOW_STATUS',
            statusId: STATUS_FIRST,
        });

        expect(next.statusHide).toEqual([STATUS_ARCHIVED]);
    });

    it('leaves the list alone when asked to show a status that is not hidden', () => {
        const hidden = reduce(createInitialBoardState(), {
            type: 'HIDE_STATUS',
            statusId: STATUS_FIRST,
        });

        const next = reduce(hidden, {
            type: 'SHOW_STATUS',
            statusId: STATUS_SECOND,
        });

        expect(next.statusHide).toEqual([STATUS_FIRST]);
    });
});

describe('ADD_ARCHIVED_STATUS', () => {
    it('appends the archived status id', () => {
        // `@.archivedStatus.push(statusId)` [kanban-usertories.coffee:114], pushed by
        // the archived-column directive alongside the hide [main.coffee:792-793].
        const next = reduce(createInitialBoardState(), {
            type: 'ADD_ARCHIVED_STATUS',
            statusId: STATUS_ARCHIVED,
        });

        expect(next.archivedStatus).toEqual([STATUS_ARCHIVED]);
    });

    it('tracks archived and hidden SEPARATELY, because a card needs both to count', () => {
        // `archivedStatus.indexOf(status) != -1 && statusHide.indexOf(status) != -1`
        // [kanban-usertories.coffee:120-121]: an archived status whose column the
        // user has expanded is archived but no longer hidden, so collapsing the two
        // lists into one would keep those cards suppressed.
        const next = reduce(
            reduce(createInitialBoardState(), {
                type: 'ADD_ARCHIVED_STATUS',
                statusId: STATUS_ARCHIVED,
            }),
            { type: 'HIDE_STATUS', statusId: STATUS_ARCHIVED },
        );

        expect(next.archivedStatus).toEqual([STATUS_ARCHIVED]);
        expect(next.statusHide).toEqual([STATUS_ARCHIVED]);

        const shown = reduce(next, {
            type: 'SHOW_STATUS',
            statusId: STATUS_ARCHIVED,
        });

        expect(shown.archivedStatus).toEqual([STATUS_ARCHIVED]);
        expect(shown.statusHide).toEqual([]);
    });
});

/* ==========================================================================
 * BOARD CONFIGURATION
 * ========================================================================== */

describe('SET_SWIMLANES', () => {
    it('replaces the swimlane list with a copy of the payload', () => {
        const swimlanes = [
            makeSwimlane({ id: SWIMLANE_A }),
            makeSwimlane({ id: SWIMLANE_B }),
        ];

        const next = reduce(createInitialBoardState(), {
            type: 'SET_SWIMLANES',
            swimlanes,
        });

        expect(next.swimlanes.map((swimlane) => swimlane.id)).toEqual([
            SWIMLANE_A,
            SWIMLANE_B,
        ]);
        expect(next.swimlanes).not.toBe(swimlanes);
    });

    it('accepts an empty list, which is how a board without swimlanes renders', () => {
        const state = reduce(createInitialBoardState(), {
            type: 'SET_SWIMLANES',
            swimlanes: [makeSwimlane({ id: SWIMLANE_A })],
        });

        // `refreshSwimlanes` returns immediately on an empty list
        // [kanban-usertories.coffee:298-299], which is exactly the flat board.
        expect(reduce(state, { type: 'SET_SWIMLANES', swimlanes: [] }).swimlanes)
            .toEqual([]);
    });
});

describe('SET_SWIMLANES_STATUSES', () => {
    it('rekeys the record numerically and copies each status list', () => {
        const own = [makeStatus({ id: STATUS_FIRST })];
        const all = [
            makeStatus({ id: STATUS_FIRST }),
            makeStatus({ id: STATUS_SECOND }),
        ];

        const next = reduce(createInitialBoardState(), {
            type: 'SET_SWIMLANES_STATUSES',
            swimlanesStatuses: {
                [SWIMLANE_A]: own,
                [UNCLASSIFIED_SWIMLANE_ID]: all,
            },
        });

        // A real swimlane gets its OWN statuses [main.coffee:613]; the unclassified
        // swimlane gets the project's FULL set [main.coffee:615].
        expect(next.swimlanesStatuses[SWIMLANE_A]).toHaveLength(1);
        expect(next.swimlanesStatuses[SWIMLANE_A]).not.toBe(own);
        expect(next.swimlanesStatuses[UNCLASSIFIED_SWIMLANE_ID]).toHaveLength(2);
        expect(next.swimlanesStatuses[UNCLASSIFIED_SWIMLANE_ID]).not.toBe(all);
    });
});

describe('SET_US_STATUS_LIST', () => {
    it('replaces the status list with a copy, in the order supplied', () => {
        const statuses = [
            makeStatus({ id: STATUS_SECOND }),
            makeStatus({ id: STATUS_FIRST }),
        ];

        const next = reduce(createInitialBoardState(), {
            type: 'SET_US_STATUS_LIST',
            usStatusList: statuses,
        });

        // Sorted upstream by "order" [main.coffee:631], so the reducer preserves the
        // sequence it is handed rather than imposing one of its own.
        expect(next.usStatusList.map((status) => status.id)).toEqual([
            STATUS_SECOND,
            STATUS_FIRST,
        ]);
        expect(next.usStatusList).not.toBe(statuses);
    });

    it('is what a later SET_FOLDS reads to decide which columns are archived', () => {
        const withStatuses = reduce(createInitialBoardState(), {
            type: 'SET_US_STATUS_LIST',
            usStatusList: [
                makeStatus({ id: STATUS_FIRST }),
                makeStatus({ id: STATUS_ARCHIVED, is_archived: true }),
            ],
        });

        const next = reduce(withStatuses, { type: 'SET_FOLDS', folds: {} });

        expect(next.folds).toEqual({ [STATUS_ARCHIVED]: true });
    });
});

describe('SET_USERS_BY_ID', () => {
    it('replaces the user index with a copy of the payload', () => {
        const usersById = { 4: { id: 4 }, 5: { id: 5 } };

        const next = reduce(createInitialBoardState(), {
            type: 'SET_USERS_BY_ID',
            usersById,
        });

        // Stories carry RAW assignee ids, so this index is what turns them into an
        // avatar or the "Not assigned" placeholder.
        expect(next.usersById[4]).toEqual({ id: 4 });
        expect(next.usersById[5]).toEqual({ id: 5 });
        expect(next.usersById).not.toBe(usersById);
    });
});

/* ==========================================================================
 * PURITY AND THE IMMER COMPOSITION
 * ========================================================================== */

describe('reducer purity', () => {
    it('absorbs an action type it does not recognise, changing nothing', () => {
        // The `switch` is exhaustive over the union, so its `default` branch is
        // unreachable from typed code -- and reachable at runtime from a hook built
        // against a different bundle. An unrecognised action must be inert, not a
        // crash that takes the board down with it.
        const state = makeFlatColumnState();

        const next = reduce(state, untypedAction('NOT_A_REAL_ACTION'));

        expect(next).toBe(state);
        expect(next.order).toEqual({ 10: 1, 11: 2, 12: 3 });
    });

    it('writes only through the draft, so a FROZEN input is safe', () => {
        // `produce` deep-freezes its result while `autoFreeze` is on (P-IMMER-4), so
        // feeding one result straight back in is a genuine deep-freeze test: a
        // reducer that reached past the draft -- an in-place `.sort()` or `.push()`
        // on a shared array, say -- would throw here rather than corrupt the board
        // silently. No type check can find that; this can.
        const frozen = reduce(
            makeFlatColumnState(),
            moveCard({ usList: [12], statusId: STATUS_FIRST, previousCard: null }),
        );

        expect(Object.isFrozen(frozen)).toBe(true);
        expect(Object.isFrozen(frozen.order)).toBe(true);
        expect(Object.isFrozen(frozen.usStatusList)).toBe(true);

        expect(() =>
            reduce(
                frozen,
                moveCard({ usList: [10], statusId: STATUS_FIRST, previousCard: 11 }),
            ),
        ).not.toThrow();

        expect(() =>
            reduce(frozen, { type: 'ADD_STORIES', stories: [makeStory({ id: 70 })] }),
        ).not.toThrow();

        expect(() =>
            reduce(frozen, { type: 'MARK_US_MOVED', storyId: 10 }),
        ).not.toThrow();

        expect(() =>
            reduce(frozen, { type: 'HIDE_STATUS', statusId: STATUS_FIRST }),
        ).not.toThrow();
    });

    it('leaves an explicitly frozen fixture untouched', () => {
        const state = Object.freeze(makeFlatColumnState());

        const next = reduce(state, { type: 'TOGGLE_SELECTED_US', storyId: 11 });

        expect(next.selectedUss[11]).toBe(true);
        expect(state.selectedUss).toEqual({});
    });

    it('is deterministic: the same state and action give the same result twice', () => {
        const state = makeSwimlaneBoardState();
        const action = moveCard({
            usList: [20],
            statusId: STATUS_SECOND,
            swimlaneId: SWIMLANE_A,
            previousCard: 21,
        });

        expect(reduce(state, action).order).toEqual(reduce(state, action).order);
    });

    it('composes with produce in its CURRIED form, which is how the board wires it', () => {
        // `useReducer(produce(reducer), init)`: the curried form IS the reducer the
        // board hands React, so it is asserted directly rather than assumed
        // equivalent to the explicit form used throughout this file.
        const curriedReduce: (
            state: KanbanBoardState,
            action: KanbanBoardAction,
        ) => KanbanBoardState = produce(kanbanBoardReducer);

        const state = makeFlatColumnState();
        const action = moveCard({
            usList: [12],
            statusId: STATUS_FIRST,
            previousCard: null,
        });

        const curried = curriedReduce(state, action);

        expect(curried.order).toEqual({ 10: 2, 11: 3, 12: 0 });
        expect(curried.order).toEqual(reduce(state, action).order);
        expect(curried).not.toBe(state);
    });
});

