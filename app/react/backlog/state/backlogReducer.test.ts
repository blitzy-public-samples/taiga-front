/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for `backlogReducer.ts`.
 *
 * ─── THE ONE SENTENCE THAT SHAPES THIS WHOLE FILE ──────────────────────────────
 *
 * A SINGLE-DRAG TEST PASSES AGAINST A COMPLETELY BROKEN IMPLEMENTATION. The
 * serialisation queue the reducer reproduces from `moveUs`
 * [app/coffee/modules/backlog/main.coffee:L523-L642] is the highest-risk behaviour
 * in this migration, and it is invisible to a suite that drags one story one step.
 * `bulk-update-us-backlog-order` is POSITION-RELATIVE — the request carries
 * neighbour ids, never absolute indices
 * [app/coffee/modules/resources/userstories.coffee:L92-L105] — so with two requests
 * in flight the second computes its neighbours from an ordering the server has not
 * acknowledged yet, and the persisted order quietly stops matching the order the
 * user is looking at. No error, no toast, no console warning; it surfaces on the
 * next page load. The queue groups below therefore drive the reducer with SEVERAL
 * moves back to back and count what would have gone on the wire.
 *
 * ─── WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT ────────────────────────────
 *
 * The reducer is a pure function: no injector, no DOM, no promises, no transport.
 * Every case here folds actions over state and asserts two things — the resulting
 * STATE, and the INTENT the reducer recorded for its owning hook to perform. The
 * hook (`../hooks/useStoryDrag`) is what issues the request, through the typed
 * facades in `app/react/shared/api`, and it is specified by its own file. Nothing
 * here asserts a call, because the reducer makes none.
 *
 * ─── DEFECT-LOCKING TESTS: READ THIS BEFORE "FIXING" A FAILURE ─────────────────
 *
 * Several cases below assert behaviour that looks wrong and IS wrong, and is
 * preserved deliberately because the migration is forbidden to change behaviour
 * (T10, Minimal Change Clause). Each one carries the `[path:locator]` of the
 * CoffeeScript it reproduces and the label the reducer itself uses:
 *
 *   • LOCKED HERE — MU-1 (the `nextUs` branch comparing `previousUs`), MU-2 (the
 *     guard that returned nothing to chain on), MS-1 (the seedless reduce that
 *     poisons a total to NaN), MS-3 (the hardcoded target sprint), SEL-1 (the
 *     shift range that never touches `is-checked`, in both of its halves) and
 *     SEL-2 (the anchor that moves inside `checkSelected`) — plus the preserved
 *     to-sprint splice asymmetry and the neighbourless insert at index 1, which
 *     look like defects and are not ones to touch.
 *   • DOCUMENTED DEVIATIONS, also asserted — DEV-1 (`backlog_order` written only
 *     from a backlog answer) and DEV-2 (an order of `0` for a story never ordered
 *     inside a sprint). Both are cases where reproducing the incumbent exactly
 *     would store `undefined` into a required field.
 *   • DOCUMENTED AND DELIBERATELY NOT REPRODUCED — SEL-3, the window listener that
 *     is never unbound. It is recorded in a comment on the shift-key helper, and
 *     no test demands the leak.
 *   • NOTHING LEFT TO REPRODUCE — MU-3. The incumbent's single-argument
 *     `Object.assign` sequence was reaching for the new object identities a change
 *     detector needs, and immer's structural sharing supplies exactly those, which
 *     the structural-sharing group asserts directly instead.
 *
 * If one of these starts failing, somebody has improved the reducer — revert the
 * improvement, do not relax the test. A test that encodes an enhancement is worse
 * than no test at all, because it forces the next reader to break real behaviour to
 * make it green.
 *
 * ─── TECHNOLOGY SEAMS UNDER TEST (T9) ─────────────────────────────────────────
 *
 *   • The immutable-collection library → `immer`. Every case runs through
 *     `produce`, exactly as `useReducer(produce(backlogReducer), init)` composes
 *     it, so `autoFreeze` stays active. That is what makes structural sharing
 *     assertable with `toBe` (P-IMMER-4) and what makes an accidental write to a
 *     finished result throw instead of silently corrupting state. No draft is ever
 *     logged here: passing an immer proxy to a logger raises a TypeError
 *     (P-IMMER-2), so this file contains no diagnostics at all.
 *   • The AngularJS `$scope` graph → plain objects and arrays. Fixtures are plain,
 *     `.length` replaces `.size`, and this folder holds none of the collection
 *     library the incumbent used (I5 — it stays installed for the 124 out-of-scope
 *     files that still need it).
 *   • Constructor injection → nothing at all. The reducer has no dependencies to
 *     inject, which is precisely why this specification needs no mock injector.
 *
 * Browserless by construction (HR-5): it runs in the jsdom environment
 * `jest.config.js` configures, renders nothing, imports no component library, and
 * needs no browser binary, no built bundle and no network.
 *
 * ─── OWNERSHIP SPLIT, SO NOTHING IS TESTED TWICE ──────────────────────────────
 *
 * `./backlogSelectors.test.ts` owns the derived views (doom line, points display,
 * last sprint). Request BODIES — including the after-wins rule applied at the wire
 * — belong to `shared/api/userstories.test.ts`, which is where that rule lives.
 * The neighbour arithmetic that decides WHICH story is the anchor belongs to
 * `shared/dnd/useSortableList.test.ts`. This file owns the QUEUE, the local
 * ordering arithmetic, the three selection facets, and the intents.
 */
import { produce } from 'immer';

import { backlogReducer, createInitialBacklogState } from './backlogReducer';
import type {
    BacklogAction,
    BacklogIntent,
    BacklogOrderRequest,
    BacklogRowStory,
    BacklogSprint,
    BacklogState,
    MoveUsOutcome,
    MoveUsRequestedAction,
} from './backlogReducer';
import type { BacklogUserStory } from './types';
import type { NestedSprintUserStory } from '../../shared/types/sprint';

/* ==========================================================================
 * FIXTURES
 *
 * Plain objects and arrays throughout, built from one complete base literal per
 * model with spread overrides, so every fixture is a valid instance of the real
 * type rather than a partial one widened into place.
 * ========================================================================== */

const PROJECT_ID = 3;

/**
 * A tag colour. Tags are `readonly [name, colour]` TUPLES, and the colour is a
 * per-project database value read straight from `tag[1]`, never a design token
 * (T2, Drift Register D3). This value is obviously synthetic so that no reader
 * mistakes it for a colour the product ships, and nothing here asserts on it.
 */
const SYNTHETIC_TAG_COLOUR = 'rgb(9, 9, 9)';

/** A backlog row: the full story shape the story-list serializer sends. */
function makeUs(
    overrides: Partial<BacklogUserStory> & { readonly id: number },
): BacklogUserStory {
    const base: BacklogUserStory = {
        id: overrides.id,
        ref: overrides.id,
        subject: `user story ${overrides.id}`,
        status: 1,
        swimlane: null,
        // `null` is the backlog: a story with no sprint. Never `0`, which is a
        // truthiness trap the write contract turns into an omitted key.
        milestone: null,
        project: PROJECT_ID,
        is_blocked: false,
        blocked_note: '',
        is_closed: false,
        due_date: null,
        total_points: null,
        points: {},
        tags: [['bug', SYNTHETIC_TAG_COLOUR]],
        epics: null,
        assigned_users: [],
        assigned_to: null,
        kanban_order: 0,
        backlog_order: 0,
        total_attachments: 0,
        total_comments: 0,
        attachments: [],
        tasks: [],
        watchers: [],
        // The optimistic-concurrency token a write has to round-trip.
        version: 1,
    };

    return { ...base, ...overrides };
    // `sprint_order` is deliberately absent from the base: it is optional on the
    // backlog model precisely because a story belonging to no sprint has none.
}

/**
 * A story as it arrives NESTED INSIDE a sprint — a strictly smaller shape than a
 * backlog row, from a different serializer. One fixture of it exists because a
 * cross-container move splices the very same object between the two lists
 * [main.coffee:L558-L559], so both lists genuinely hold a mixture afterwards and
 * the reducer has to cope with either member of the union.
 */
function makeNestedUs(
    overrides: Partial<NestedSprintUserStory> & { readonly id: number },
): NestedSprintUserStory {
    const base: NestedSprintUserStory = {
        id: overrides.id,
        ref: overrides.id,
        milestone: null,
        project: PROJECT_ID,
        project_extra_info: null,
        is_closed: false,
        created_date: '2026-05-01T09:00:00+0000',
        modified_date: '2026-05-01T09:00:00+0000',
        finish_date: null,
        subject: `nested story ${overrides.id}`,
        client_requirement: false,
        team_requirement: false,
        external_reference: null,
        version: 1,
        is_blocked: false,
        blocked_note: '',
        backlog_order: 0,
        // Required here, unlike on a backlog row: a story nested in a sprint has
        // always been ordered inside one.
        sprint_order: 0,
        kanban_order: 0,
        epics: null,
        points: {},
        total_points: null,
        status: 1,
        status_extra_info: null,
        assigned_to: null,
        assigned_to_extra_info: null,
        due_date: null,
        due_date_reason: '',
        due_date_status: 'not_set',
    };

    return { ...base, ...overrides };
}

/**
 * A sprint as this screen holds it. `estimated_start` / `estimated_finish` are
 * `YYYY-MM-DD` STRINGS, never dates; `closed` is the sprint's own boolean flag and
 * has nothing to do with the closed-sprint COUNT the list envelope carries; and
 * `total_points` is a scalar sum that is `null` when no role points are set.
 */
function makeSprint(
    overrides: Partial<BacklogSprint> & { readonly id: number },
): BacklogSprint {
    const base: BacklogSprint = {
        id: overrides.id,
        name: `sprint ${overrides.id}`,
        slug: `sprint-${overrides.id}`,
        owner: null,
        project: PROJECT_ID,
        closed: false,
        disponibility: null,
        order: 1,
        created_date: '2026-05-01T09:00:00+0000',
        modified_date: '2026-05-01T09:00:00+0000',
        closed_points: null,
        total_points: null,
        estimated_start: '2026-05-15',
        estimated_finish: '2026-05-30',
        user_stories: [],
    };

    return { ...base, ...overrides };
}

/**
 * Ids of the members of a list, in list order — which is what almost every ordering
 * assertion reads, of rows and of sprints alike.
 */
function idsOf(items: readonly { readonly id: number }[]): readonly number[] {
    return items.map((item) => item.id);
}

/** Three backlog rows, in order, and nothing else. The base for the queue groups. */
function makeThreeRowBacklog(): BacklogState {
    return createInitialBacklogState({
        userStories: [makeUs({ id: 1 }), makeUs({ id: 2 }), makeUs({ id: 3 })],
        // Loaded and empty, which is NOT the same as unloaded: it is what lets the
        // closed-sprint check at [main.coffee:L639] run at all.
        closedSprints: [],
        // Realtime up by default, so the reload fallback stays out of the way of
        // the groups that are not about it.
        eventsConnected: true,
    });
}

/* ==========================================================================
 * HARNESS
 * ========================================================================== */

/**
 * The exact composition the screen uses: `useReducer(produce(backlogReducer), init)`.
 *
 * Running every case through `produce` is not a convenience. It keeps `autoFreeze`
 * on, so a reducer that mutated a caller's array in place would throw here rather
 * than pass, and it is what makes the structural-sharing assertions meaningful.
 */
function reduce(state: BacklogState, action: BacklogAction): BacklogState {
    return produce(state, (draft) => {
        backlogReducer(draft, action);
    });
}

/**
 * What a run of actions produced: the final state, plus the one-shot mailboxes
 * drained in the order they were filled.
 */
interface Run {
    readonly state: BacklogState;

    /** Every request that would have gone on the wire, in dispatch order. */
    readonly dispatches: readonly BacklogOrderRequest[];

    /** Every outcome the reducer decided, so `QUEUED` is countable too. */
    readonly outcomes: readonly MoveUsOutcome['kind'][];

    /** Every side effect recorded, flattened in the order recorded. */
    readonly intents: readonly BacklogIntent[];
}

/**
 * Folds actions over state exactly as the owning hook does, INCLUDING the
 * outcome-consumption contract: the hook must consume `moveUsOutcome` and `intents`
 * in the effect that observes them, before dispatching the next move. Draining them
 * here is what makes "how many requests were issued" countable at all — the reducer
 * holds one mailbox, not a log, so a harness that never drained it could not tell
 * one dispatch from three.
 *
 * Note what is NOT auto-driven: a `DRAIN_PENDING_DRAG` intent does not silently
 * dispatch `PENDING_DRAG_DRAIN`. Every drain step is spelled out by the case that
 * needs it, so the FIFO order is visible in the test rather than hidden in here.
 */
function run(initial: BacklogState, actions: readonly BacklogAction[]): Run {
    let state = initial;
    const dispatches: BacklogOrderRequest[] = [];
    const outcomes: MoveUsOutcome['kind'][] = [];
    const intents: BacklogIntent[] = [];

    actions.forEach((action) => {
        state = reduce(state, action);

        const outcome = state.moveUsOutcome;

        if (outcome !== null) {
            outcomes.push(outcome.kind);

            if (outcome.kind === 'DISPATCH') {
                dispatches.push(outcome.request);
            }

            state = reduce(state, { type: 'CONSUME_MOVE_US_OUTCOME' });
        }

        if (state.intents.length > 0) {
            intents.push(...state.intents);

            state = reduce(state, { type: 'CONSUME_INTENTS' });
        }
    });

    return { state, dispatches, outcomes, intents };
}

/** A user-initiated move, with the neighbourless same-container case as its base. */
function moveUs(
    overrides: Partial<MoveUsRequestedAction> & { readonly usList: readonly number[] },
): MoveUsRequestedAction {
    const base: MoveUsRequestedAction = {
        type: 'MOVE_US_REQUESTED',
        usList: overrides.usList,
        newUsIndex: 0,
        newSprintId: null,
        previousUs: null,
        nextUs: null,
    };

    return { ...base, ...overrides };
}

/** A server answer for a BACKLOG reorder: `milestone` is `null`, `backlog_order` renumbered. */
function backlogRow(id: number, backlogOrder: number): BacklogAction {
    return { type: 'MOVE_US_SUCCEEDED', rows: [{ id, milestone: null, backlog_order: backlogOrder }] };
}

/** A success carrying no rows, for the cases that are about the tail rather than the data. */
const SUCCEEDED_WITH_NO_ROWS: BacklogAction = { type: 'MOVE_US_SUCCEEDED', rows: [] };

/**
 * The body `bulkUpdateBacklogOrder` builds from a request
 * [app/coffee/modules/resources/userstories.coffee:L92-L105], reproduced here so
 * that what the reducer emits can be checked against what the wire would carry.
 *
 * ⭐ AFTER WINS. The resource layer is `if afterUserstoryId … else if
 * beforeUserstoryId` [:L99-L103], so supplying BOTH neighbours sends only
 * `after_userstory_id`, and supplying NEITHER sends neither key.
 *
 * ⭐ THOSE CONDITIONALS TEST TRUTHINESS, NOT NULLISHNESS [:L96, L99, L102]. An id of
 * `0` therefore OMITS its key entirely. That is the frozen contract, not an
 * oversight, and it must not be "improved" into a null check anywhere in this
 * pipeline. The reducer passes all five values through UNFILTERED on purpose and
 * lets the facade apply the rule in the one place it belongs, which is why this
 * helper lives in the specification rather than in the reducer.
 */
interface BacklogOrderWireParams {
    readonly project_id: number;
    readonly bulk_userstories: readonly number[];
    readonly milestone_id?: number;
    readonly after_userstory_id?: number;
    readonly before_userstory_id?: number;
}

function toWireParams(request: BacklogOrderRequest): BacklogOrderWireParams {
    const base: BacklogOrderWireParams = {
        project_id: request.projectId,
        bulk_userstories: request.bulkUserstories,
    };

    const withMilestone: BacklogOrderWireParams = request.milestoneId
        ? { ...base, milestone_id: request.milestoneId }
        : base;

    if (request.afterUserstoryId) {
        return { ...withMilestone, after_userstory_id: request.afterUserstoryId };
    }

    if (request.beforeUserstoryId) {
        return { ...withMilestone, before_userstory_id: request.beforeUserstoryId };
    }

    return withMilestone;
}

/**
 * A dispatch surface for an action shape no typed caller can spell.
 *
 * The action union is exhaustive and the reducer's `default` binds it to `never`, so
 * adding a member without handling it is a COMPILE error rather than a silently
 * ignored dispatch — which also means an unrecognised action cannot be written in
 * typed code. It can still ARRIVE at runtime, from a hook built against an older
 * bundle, so the absorbing branch needs covering. Declaring the seam as a METHOD is
 * what allows it: method parameters are checked bivariantly, so this needs no cast
 * of the kind this file forbids.
 */
interface RuntimeOnlyDispatch {
    reduce(
        draft: Parameters<typeof backlogReducer>[0],
        action: { readonly type: string },
    ): void;
}

const runtimeOnly: RuntimeOnlyDispatch = { reduce: backlogReducer };

/** Every intent name the reducer is allowed to record. */
const EVERY_INTENT: readonly BacklogIntent[] = [
    'BROADCAST_SPRINT_US_MOVED',
    'BROADCAST_LOAD_CLOSED_SPRINTS',
    'DRAIN_PENDING_DRAG',
    'LOAD_SPRINTS',
    'LOAD_CLOSED_SPRINTS',
    'LOAD_PROJECT_STATS',
    'TOGGLE_VELOCITY_FORECASTING',
    'CALCULATE_FORECASTING',
];

/** The three reloads the disconnected fallback fires [main.coffee:L635-L637]. */
const RELOAD_INTENTS: readonly BacklogIntent[] = [
    'LOAD_SPRINTS',
    'LOAD_CLOSED_SPRINTS',
    'LOAD_PROJECT_STATS',
];

function reloadIntentsIn(intents: readonly BacklogIntent[]): readonly BacklogIntent[] {
    return intents.filter((intent) => RELOAD_INTENTS.includes(intent));
}

/* ==========================================================================
 * createInitialBacklogState
 * ========================================================================== */

describe('createInitialBacklogState', () => {
    it('starts with an empty serialisation queue', () => {
        // [main.coffee:L84] `@.pendingDrag = []`. The queue's length is what the
        // re-entrancy guard reads, so a queue that started non-empty would block
        // the very first drag of every visit.
        expect(createInitialBacklogState().pendingDrag).toEqual([]);
    });

    it('populates every field, so no component can read undefined out of a fresh screen', () => {
        const state = createInitialBacklogState();

        // Enumerated rather than shape-matched: a field that silently arrived as
        // `undefined` would read as "nothing selected", "no stories" or "not
        // connected" at every call site, which is indistinguishable from a real
        // empty screen.
        expect(state.userStories).toEqual([]);
        expect(state.sprints).toEqual([]);
        expect(state.currentSprintId).toBeNull();
        expect(state.eventsConnected).toBe(false);
        expect(state.visibleUserStories).toEqual([]);
        expect(state.inFlightMove).toBeNull();
        expect(state.moveUsOutcome).toBeNull();
        expect(state.milestoneMoveRequest).toBeNull();
        expect(state.intents).toEqual([]);
        expect(state.moveToSprintVisible).toBe(false);
    });

    it('leaves the closed sprints unloaded rather than empty', () => {
        // ⭐ `null` MEANS "NOT LOADED YET" and is not the same as the empty list.
        // The incumbent guards with `if @scope.closedSprintsById && …`
        // [main.coffee:L639] precisely because that map is undefined until the
        // closed sprints load, so flattening the two states into one empty array
        // would make an unloaded screen look like a project with no closed sprints.
        expect(createInitialBacklogState().closedSprints).toBeNull();
    });

    it('starts with all three selection facets empty, no shift and no anchor', () => {
        const state = createInitialBacklogState();

        expect(state.checkedIds).toEqual({});
        expect(state.isCheckedIds).toEqual({});
        expect(state.multiSelectedIds).toEqual({});
        expect(state.shiftPressed).toBe(false); // [main.coffee:L819]
        expect(state.lastCheckedId).toBeNull(); // [main.coffee:L820]
    });

    it('copies the hydration lists instead of holding the bridge arrays', () => {
        const userStories = [makeUs({ id: 1 })];
        const sprints = [makeSprint({ id: 7 })];

        const state = createInitialBacklogState({ userStories, sprints });

        expect(state.userStories).toEqual(userStories);
        expect(state.sprints).toEqual(sprints);

        // A retained reference would let the AngularJS side mutate React state
        // behind React's back, and would be frozen by the first `produce`.
        expect(state.userStories).not.toBe(userStories);
        expect(state.sprints).not.toBe(sprints);
    });
});

/* ==========================================================================
 * HYDRATION AND SETTERS
 * ========================================================================== */

describe('backlogReducer hydration', () => {
    it('applies only the members the bridge actually supplied', () => {
        const state = reduce(makeThreeRowBacklog(), {
            type: 'HYDRATE',
            currentSprintId: 42,
        });

        expect(state.currentSprintId).toBe(42);

        // Everything omitted from the action is untouched, so a partial refresh
        // cannot blank the rows it said nothing about.
        expect(idsOf(state.userStories)).toEqual([1, 2, 3]);
        expect(state.eventsConnected).toBe(true);
    });

    it('can put the closed sprints back into the unloaded state', () => {
        const loaded = reduce(makeThreeRowBacklog(), {
            type: 'SET_CLOSED_SPRINTS',
            closedSprints: [makeSprint({ id: 9, closed: true })],
        });

        expect(idsOf(loaded.closedSprints ?? [])).toEqual([9]);

        const unloaded = reduce(loaded, { type: 'HYDRATE', closedSprints: null });

        expect(unloaded.closedSprints).toBeNull();
    });

    it('replaces the rows, the sprints, the closed sprints and the connection flag', () => {
        const state = reduce(makeThreeRowBacklog(), {
            type: 'HYDRATE',
            userStories: [makeUs({ id: 8 })],
            sprints: [makeSprint({ id: 7 })],
            closedSprints: [makeSprint({ id: 99, closed: true })],
            eventsConnected: false,
        });

        expect(idsOf(state.userStories)).toEqual([8]);
        expect(idsOf(state.sprints)).toEqual([7]);
        expect(idsOf(state.closedSprints ?? [])).toEqual([99]);
        expect(state.eventsConnected).toBe(false);
    });

    it('replaces the rows, the sprints, the current sprint and the connection flag', () => {
        let state = createInitialBacklogState();

        state = reduce(state, { type: 'SET_USER_STORIES', userStories: [makeUs({ id: 5 })] });
        state = reduce(state, { type: 'SET_SPRINTS', sprints: [makeSprint({ id: 6 })] });
        state = reduce(state, { type: 'SET_CURRENT_SPRINT', currentSprintId: 6 });
        state = reduce(state, { type: 'SET_EVENTS_CONNECTED', eventsConnected: true });

        expect(idsOf(state.userStories)).toEqual([5]);
        expect(idsOf(state.sprints)).toEqual([6]);
        expect(state.currentSprintId).toBe(6);
        expect(state.eventsConnected).toBe(true);
    });

    it('clears the current sprint when the project has none', () => {
        const state = reduce(makeThreeRowBacklog(), {
            type: 'SET_CURRENT_SPRINT',
            currentSprintId: null,
        });

        expect(state.currentSprintId).toBeNull();
    });
});

/* ==========================================================================
 * THE pendingDrag SERIALISATION QUEUE
 *
 * Reproduces `moveUs` [app/coffee/modules/backlog/main.coffee:L84, L523-L642]: the
 * queue itself, the re-entrancy guard, the reconciliation, the dequeue, the drain
 * and the queue-empty tail.
 * ========================================================================== */

describe('backlogReducer pendingDrag queue', () => {
    describe('a single user-initiated move', () => {
        it('enqueues exactly one entry and dispatches it, because it is the head', () => {
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
            ]);

            // [main.coffee:L539-L546] enqueues, then [:L600-L601] lets the head
            // through because the queue holds only this entry.
            expect(result.state.pendingDrag).toHaveLength(1);
            expect(result.outcomes).toEqual(['DISPATCH']);
            expect(result.dispatches).toHaveLength(1);
            expect(result.dispatches[0].bulkUserstories).toEqual([3]);
        });

        it('records the in-flight closure the success handler will read', () => {
            const state = reduce(makeThreeRowBacklog(), moveUs({ usList: [3], nextUs: 1 }));

            // The reified closure of `promise.then` [main.coffee:L611-L640]: the
            // `usList` whose stories may be reconciled, and the `oldSprintId` the
            // closed-sprint check reads.
            expect(state.inFlightMove).toEqual({ usList: [3], oldSprintId: null });
        });

        it('carries all five members of the incumbent entry', () => {
            const state = reduce(
                makeThreeRowBacklog(),
                moveUs({ usList: [3], newUsIndex: 2, newSprintId: null, previousUs: 1, nextUs: 2 }),
            );

            const entry = state.pendingDrag[0];

            // [main.coffee:L540-L546] pushes exactly these five. `usList` holds IDS
            // rather than live objects because a normalised store keeps one copy per
            // list where the incumbent kept one shared mutable object in two lists,
            // so ids plus a lookup reproduce that aliasing and cannot go stale.
            expect(entry.usList).toEqual([3]);
            expect(entry.newUsIndex).toBe(2);
            expect(entry.newSprintId).toBeNull();
            expect(entry.previousUs).toBe(1);
            expect(entry.nextUs).toBe(2);
        });

        it('refreshes the visible refs from the backlog rows', () => {
            // [main.coffee:L597-L598] `@scope.visibleUserStories = _.map
            // @scope.userstories, (it) -> it.ref`, inside the `if ctx` block.
            const state = reduce(makeThreeRowBacklog(), moveUs({ usList: [3], nextUs: 1 }));

            expect(state.visibleUserStories).toEqual([3, 1, 2]);
        });

        it('leaves the queue alone when the dragged story is not held anywhere', () => {
            // The incumbent read `usList[0].milestone` unguarded [main.coffee:L524]
            // and could only ever be handed a live story, so this was unreachable
            // there. Totality matters here: an entry enqueued for a story that does
            // not exist would sit at the head forever and block every later drag.
            const result = run(makeThreeRowBacklog(), [moveUs({ usList: [9999] })]);

            expect(result.state.pendingDrag).toEqual([]);
            expect(result.dispatches).toEqual([]);
            expect(idsOf(result.state.userStories)).toEqual([1, 2, 3]);
        });

        it('leaves the queue alone for an empty drag', () => {
            const result = run(makeThreeRowBacklog(), [moveUs({ usList: [] })]);

            expect(result.state.pendingDrag).toEqual([]);
            expect(result.dispatches).toEqual([]);
        });
    });

    describe('rapid consecutive drags', () => {
        it('queues the second drag and sends only the first', () => {
            // ⭐⭐ MANDATORY [main.coffee:L600-L601] — the re-entrancy guard: a second
            // user drag arriving while one is in flight is QUEUED but NOT SENT. Only
            // the head is ever on the wire. A single-drag test passes against a
            // completely broken implementation (AAP 0.8.3).
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                moveUs({ usList: [2], previousUs: 1 }),
            ]);

            expect(result.state.pendingDrag).toHaveLength(2);
            expect(result.dispatches).toHaveLength(1);
            expect(result.dispatches[0].bulkUserstories).toEqual([3]);
            expect(result.outcomes).toEqual(['DISPATCH', 'QUEUED']);
        });

        it('queues the third drag too and still sends only the first', () => {
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                moveUs({ usList: [2], previousUs: 1 }),
                moveUs({ usList: [1], previousUs: 2 }),
            ]);

            expect(result.state.pendingDrag).toHaveLength(3);
            expect(result.dispatches).toHaveLength(1);
            expect(result.outcomes).toEqual(['DISPATCH', 'QUEUED', 'QUEUED']);
        });

        it('keeps the first request in flight while later drags queue behind it', () => {
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                moveUs({ usList: [2], previousUs: 1 }),
            ]);

            // The in-flight closure is still the FIRST move's. A second one written
            // here would reconcile the wrong stories when the first answer arrives.
            expect(result.state.inFlightMove).toEqual({ usList: [3], oldSprintId: null });
        });

        it('still applies every queued drag locally, so the rows the user sees keep up', () => {
            // The local mutation is inside `if ctx` [main.coffee:L539] and therefore
            // runs for BOTH drags; only the REQUEST is withheld. Queueing the local
            // effect as well would make the board freeze under a fast hand.
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                moveUs({ usList: [1], previousUs: 2 }),
            ]);

            // Drag 1: [1,2,3] -> [3,1,2]. Drag 2 moves 1 after 2: [3,2,1].
            expect(idsOf(result.state.userStories)).toEqual([3, 2, 1]);
        });

        it('reports the queued drag as an explicit outcome rather than nothing at all', () => {
            // ⛔ MU-2 [main.coffee:L600-L601] — the incumbent's guard is a bare
            // `return`, so it hands back `undefined`; `moveUsToTopOfBacklog` [:L519]
            // returns that value and its callers at [:L163] and [:L182] chain
            // `.then()` on it, producing a TypeError the digest swallows. The
            // BEHAVIOUR is preserved exactly — recorded locally, deliberately not
            // sent — but the outcome is surfaced as a discriminable value so a React
            // caller branches on `kind` instead of dereferencing nothing.
            let state = reduce(makeThreeRowBacklog(), moveUs({ usList: [3], nextUs: 1 }));
            state = reduce(state, { type: 'CONSUME_MOVE_US_OUTCOME' });
            state = reduce(state, moveUs({ usList: [2], previousUs: 1 }));

            const outcome = state.moveUsOutcome;

            expect(outcome).not.toBeNull();
            expect(outcome?.kind).toBe('QUEUED');

            // Discriminable: the queued branch carries no request, and reading one
            // off it is a compile error rather than a runtime surprise.
            expect(outcome).toEqual({ kind: 'QUEUED' });
        });
    });

    describe('server reconciliation', () => {
        it('lets the server ordering win over the optimistic local value', () => {
            // ⭐ [main.coffee:L611-L617]. THE SERVER IS THE AUTHORITY ON ORDERING.
            // The local move already put the story where the user dropped it, and
            // skipping the write-back because of that is exactly how a client-side
            // ordering starts drifting from the persisted one — silently, until the
            // next page load. The payload below disagrees with the local value on
            // purpose, so a reducer that dropped the write-back would fail here.
            const initial = createInitialBacklogState({
                userStories: [makeUs({ id: 1, backlog_order: 1 }), makeUs({ id: 2, backlog_order: 2 })],
                closedSprints: [],
                eventsConnected: true,
            });

            const result = run(initial, [
                moveUs({ usList: [2], nextUs: 1 }),
                backlogRow(2, 4242),
            ]);

            const moved = result.state.userStories.find((story) => story.id === 2);

            expect(moved?.backlog_order).toBe(4242);
        });

        it('lets the server milestone win, even when it contradicts the local one', () => {
            const initial = createInitialBacklogState({
                userStories: [makeUs({ id: 1 }), makeUs({ id: 2 })],
                sprints: [makeSprint({ id: 7 })],
                closedSprints: [],
                eventsConnected: true,
            });

            // A SPRINT reorder answers `{id, milestone, sprint_order}`; the local
            // story was in the backlog with `milestone: null`.
            const result = run(initial, [
                moveUs({ usList: [2], nextUs: 1 }),
                { type: 'MOVE_US_SUCCEEDED', rows: [{ id: 2, milestone: 7, sprint_order: 3 }] },
            ]);

            const moved = result.state.userStories.find((story) => story.id === 2);

            expect(moved?.milestone).toBe(7);
        });

        it('writes backlog_order only from a backlog answer, never from a sprint answer', () => {
            // ⭐ DEV-1 — the incumbent assigns `updatedUs.backlog_order`
            // unconditionally [main.coffee:L616], but a sprint reorder answers with
            // `sprint_order` and NO `backlog_order`, so that assignment stores
            // `undefined` into a required numeric field. The union's `milestone`
            // discriminant is what identifies which answer arrived.
            const initial = createInitialBacklogState({
                userStories: [makeUs({ id: 1 }), makeUs({ id: 2, backlog_order: 77 })],
                sprints: [makeSprint({ id: 7 })],
                closedSprints: [],
                eventsConnected: true,
            });

            const result = run(initial, [
                moveUs({ usList: [2], nextUs: 1 }),
                { type: 'MOVE_US_SUCCEEDED', rows: [{ id: 2, milestone: 7, sprint_order: 3 }] },
            ]);

            const moved = result.state.userStories.find((story) => story.id === 2);

            expect(moved?.backlog_order).toBe(77);
            expect(moved?.backlog_order).toBeDefined();
        });

        it('leaves stories the answer says nothing about untouched', () => {
            const initial = createInitialBacklogState({
                userStories: [
                    makeUs({ id: 1, backlog_order: 1 }),
                    makeUs({ id: 2, backlog_order: 2 }),
                    makeUs({ id: 3, backlog_order: 3 }),
                ],
                closedSprints: [],
                eventsConnected: true,
            });

            const result = run(initial, [
                moveUs({ usList: [2, 3], nextUs: 1 }),
                backlogRow(2, 4242),
            ]);

            const untouched = result.state.userStories.find((story) => story.id === 3);

            expect(untouched?.backlog_order).toBe(3);
        });

        it('ignores answer rows for stories the dispatched move did not carry', () => {
            // [main.coffee:L613-L614] loops the invocation's own `usList`, so a row
            // for some other story cannot be written through this handler.
            const initial = createInitialBacklogState({
                userStories: [makeUs({ id: 1, backlog_order: 1 }), makeUs({ id: 2, backlog_order: 2 })],
                closedSprints: [],
                eventsConnected: true,
            });

            const result = run(initial, [
                moveUs({ usList: [2], nextUs: 1 }),
                backlogRow(1, 9999),
            ]);

            const bystander = result.state.userStories.find((story) => story.id === 1);

            expect(bystander?.backlog_order).toBe(1);
        });

        it('reconciles every copy of a story, in the backlog and inside its sprint alike', () => {
            // The incumbent wrote `us.milestone = …` once and both views changed
            // because both views were the same object [main.coffee:L615]. A
            // normalised store has one copy per list, so both are written.
            const shared = makeUs({ id: 2, backlog_order: 2 });
            const initial = createInitialBacklogState({
                userStories: [makeUs({ id: 1 }), shared],
                sprints: [makeSprint({ id: 7, user_stories: [shared] })],
                closedSprints: [],
                eventsConnected: true,
            });

            const result = run(initial, [
                moveUs({ usList: [2], nextUs: 1 }),
                backlogRow(2, 4242),
            ]);

            const inSprint = result.state.sprints[0].user_stories.find((story) => story.id === 2);

            expect(inSprint?.backlog_order).toBe(4242);
        });

        it('does nothing when no request was in flight', () => {
            const result = run(makeThreeRowBacklog(), [backlogRow(1, 4242)]);

            expect(result.state.pendingDrag).toEqual([]);
            expect(result.intents).toEqual([]);
            expect(result.state.userStories[0].backlog_order).toBe(0);
        });
    });

    describe('dequeue and drain', () => {
        it('removes the head once its request has succeeded', () => {
            // [main.coffee:L618] `@.pendingDrag.shift()`.
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            expect(result.state.pendingDrag).toEqual([]);
            expect(result.state.inFlightMove).toBeNull();
            expect(result.state.moveUsOutcome).toBeNull();
        });

        it('asks for a drain instead of firing the tail while entries remain', () => {
            // [main.coffee:L620-L621] deferred the re-drive through `$applyAsync`; in
            // React the deferral is simply the hook's next dispatch, so the reducer
            // records the request and performs none of it.
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                moveUs({ usList: [2], previousUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            expect(result.state.pendingDrag).toHaveLength(1);
            expect(result.intents).toEqual(['DRAIN_PENDING_DRAG']);
        });

        it('dispatches the next entry without re-queueing it or tripping the guard', () => {
            // ⭐ The literal `null` `ctx` of the re-drive [main.coffee:L620-L629]. It
            // bypasses BOTH the enqueue at [:L539] AND the guard at [:L600], and that
            // double bypass is the entire mechanism by which a drain drives a request
            // without queueing itself or being blocked. Modelling it as the same
            // action with a flag would let a caller forget the flag, so it is its own
            // action kind.
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                moveUs({ usList: [2], previousUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
                { type: 'PENDING_DRAG_DRAIN' },
            ]);

            // The queue fell from 2 to 1 on the success, and the drain sent the
            // survivor without adding anything.
            expect(result.state.pendingDrag).toHaveLength(1);
            expect(result.dispatches).toHaveLength(2);
            expect(result.dispatches[1].bulkUserstories).toEqual([2]);
        });

        it('never grows the queue on a drain step', () => {
            // A regression guard: a drain implemented as a user-initiated move would
            // push its entry back on, and the queue would never empty.
            const beforeDrain = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                moveUs({ usList: [2], previousUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            const afterDrain = reduce(beforeDrain.state, { type: 'PENDING_DRAG_DRAIN' });

            expect(afterDrain.pendingDrag).toHaveLength(beforeDrain.state.pendingDrag.length);
        });

        it('does not re-apply the local move a drained entry already performed', () => {
            // The local mutation is nested inside `if ctx` [main.coffee:L539], so a
            // drain re-sends the request for a move whose local effect has already
            // landed. Re-applying it would move the story a second time.
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                moveUs({ usList: [2], previousUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            const orderBeforeDrain = idsOf(result.state.userStories);
            const afterDrain = reduce(result.state, { type: 'PENDING_DRAG_DRAIN' });

            expect(idsOf(afterDrain.userStories)).toEqual(orderBeforeDrain);
        });

        it('drains a three-deep queue completely, in first-in-first-out order', () => {
            // The order is the whole point: a stack would send 4, 3, 2 and persist
            // an ordering the user never asked for, with no error anywhere.
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                moveUs({ usList: [2], previousUs: 1 }),
                moveUs({ usList: [1], previousUs: 3 }),
                SUCCEEDED_WITH_NO_ROWS,
                { type: 'PENDING_DRAG_DRAIN' },
                SUCCEEDED_WITH_NO_ROWS,
                { type: 'PENDING_DRAG_DRAIN' },
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            expect(result.dispatches).toHaveLength(3);
            expect(result.dispatches.map((request) => request.bulkUserstories)).toEqual([
                [3],
                [2],
                [1],
            ]);
            expect(result.state.pendingDrag).toEqual([]);
        });

        it('does nothing when asked to drain an empty queue', () => {
            const result = run(makeThreeRowBacklog(), [{ type: 'PENDING_DRAG_DRAIN' }]);

            expect(result.dispatches).toEqual([]);
            expect(result.state.inFlightMove).toBeNull();
            expect(result.state.pendingDrag).toEqual([]);
        });

        it('keeps the head queued while its request is outstanding', () => {
            // ⭐ Consuming the outcome must NOT dequeue. `pendingDrag.length` is what
            // the guard reads, so removing the head at consumption time would let a
            // second drag go out while the first was still on the wire — which is the
            // corruption this whole queue exists to prevent. Only success dequeues.
            let state = reduce(makeThreeRowBacklog(), moveUs({ usList: [3], nextUs: 1 }));
            state = reduce(state, { type: 'CONSUME_MOVE_US_OUTCOME' });

            expect(state.pendingDrag).toHaveLength(1);
            expect(state.inFlightMove).not.toBeNull();

            state = reduce(state, moveUs({ usList: [2], previousUs: 1 }));

            expect(state.moveUsOutcome).toEqual({ kind: 'QUEUED' });
        });
    });

    describe('the queue-empty tail', () => {
        it('fires no tail effect at all while entries remain', () => {
            // [main.coffee] measured indentation — L620 (queue non-empty) and L630
            // (else) both open at depth 12, while L634 and L639 sit at depth 16, so
            // BOTH tail blocks live INSIDE the queue-EMPTY else branch. Firing them
            // per drain step would broadcast and reload once per queued drag.
            const disconnectedWithClosedSprint = createInitialBacklogState({
                userStories: [makeUs({ id: 1 }), makeUs({ id: 2 })],
                closedSprints: [makeSprint({ id: 99, closed: true, user_stories: [makeNestedUs({ id: 5, milestone: 99 })] })],
                eventsConnected: false,
            });

            const result = run(disconnectedWithClosedSprint, [
                // Out of the closed sprint and into the backlog, so the closed-sprint
                // broadcast would fire if the gating were wrong.
                moveUs({ usList: [5], newSprintId: null, nextUs: 1 }),
                moveUs({ usList: [2], previousUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            expect(result.intents).toEqual(['DRAIN_PENDING_DRAG']);
            expect(result.intents).not.toContain('BROADCAST_SPRINT_US_MOVED');
            expect(reloadIntentsIn(result.intents)).toEqual([]);
            expect(result.intents).not.toContain('BROADCAST_LOAD_CLOSED_SPRINTS');
        });

        it('broadcasts the move and reloads nothing when realtime is connected', () => {
            // [main.coffee:L631] broadcasts `"sprint:us:moved"`, and [:L633] notes
            // that "taiga events will refresh the backlog if it's available" — so the
            // reload guard at [:L634] is `!connected`.
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            expect(result.intents).toEqual(['BROADCAST_SPRINT_US_MOVED']);
            expect(reloadIntentsIn(result.intents)).toEqual([]);
        });

        it('reloads all THREE collections when realtime is disconnected', () => {
            // ⭐⭐ AAP CORRECTION [main.coffee:L634-L637] — AAP 0.8.3 names only
            // `loadSprints()`; the measured source has THREE calls. `events.connected`
            // is referenced at exactly one site repository-wide, which is why the
            // fallback as a whole is easy to miss, and why the two calls beyond the
            // first are easier still.
            const disconnected = createInitialBacklogState({
                userStories: [makeUs({ id: 1 }), makeUs({ id: 2 })],
                closedSprints: [],
                eventsConnected: false,
            });

            const result = run(disconnected, [
                moveUs({ usList: [2], nextUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            expect(result.intents).toContain('LOAD_SPRINTS'); // [:L635]
            expect(result.intents).toContain('LOAD_CLOSED_SPRINTS'); // [:L636]
            expect(result.intents).toContain('LOAD_PROJECT_STATS'); // [:L637]
            expect(reloadIntentsIn(result.intents)).toHaveLength(3);

            // In the incumbent's order, and after the broadcast that precedes them.
            expect(result.intents).toEqual([
                'BROADCAST_SPRINT_US_MOVED',
                'LOAD_SPRINTS',
                'LOAD_CLOSED_SPRINTS',
                'LOAD_PROJECT_STATS',
            ]);
        });

        it('broadcasts for the closed sprints when the story came out of a closed one', () => {
            // [main.coffee:L639-L640] `if @scope.closedSprintsById &&
            // @scope.closedSprintsById[oldSprintId]`. `oldSprintId` is read from the
            // invocation that made the request, which for a user-initiated move is
            // the value BEFORE the local mutation — the sprint the story left.
            const initial = createInitialBacklogState({
                userStories: [makeUs({ id: 1 })],
                closedSprints: [
                    makeSprint({ id: 99, closed: true, user_stories: [makeNestedUs({ id: 5, milestone: 99 })] }),
                ],
                eventsConnected: true,
            });

            const result = run(initial, [
                moveUs({ usList: [5], newSprintId: null, nextUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            expect(result.intents).toEqual([
                'BROADCAST_SPRINT_US_MOVED',
                'BROADCAST_LOAD_CLOSED_SPRINTS',
            ]);
        });

        it('stays quiet about closed sprints when the story came out of an open one', () => {
            const initial = createInitialBacklogState({
                userStories: [makeUs({ id: 1 })],
                sprints: [makeSprint({ id: 7, user_stories: [makeNestedUs({ id: 5, milestone: 7 })] })],
                closedSprints: [makeSprint({ id: 99, closed: true })],
                eventsConnected: true,
            });

            const result = run(initial, [
                moveUs({ usList: [5], newSprintId: null, nextUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            expect(result.intents).not.toContain('BROADCAST_LOAD_CLOSED_SPRINTS');
        });

        it('stays quiet about closed sprints while they are still unloaded', () => {
            // Both halves of the incumbent guard are preserved: an unloaded list
            // checks nothing at all, which is the case `null` exists to express.
            const initial = createInitialBacklogState({
                userStories: [makeUs({ id: 1 }), makeUs({ id: 2 })],
                eventsConnected: true,
            });

            expect(initial.closedSprints).toBeNull();

            const result = run(initial, [
                moveUs({ usList: [2], nextUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            expect(result.intents).toEqual(['BROADCAST_SPRINT_US_MOVED']);
        });

        it('records nothing outside the documented set of intents', () => {
            const result = run(makeThreeRowBacklog(), [
                moveUs({ usList: [3], nextUs: 1 }),
                moveUs({ usList: [2], previousUs: 1 }),
                SUCCEEDED_WITH_NO_ROWS,
                { type: 'PENDING_DRAG_DRAIN' },
                SUCCEEDED_WITH_NO_ROWS,
            ]);

            expect(result.intents.length).toBeGreaterThan(0);
            result.intents.forEach((intent) => {
                expect(EVERY_INTENT).toContain(intent);
            });
        });

        it('empties the intent mailbox when the hook consumes it', () => {
            let state = reduce(makeThreeRowBacklog(), moveUs({ usList: [3], nextUs: 1 }));
            state = reduce(state, { type: 'CONSUME_MOVE_US_OUTCOME' });
            state = reduce(state, SUCCEEDED_WITH_NO_ROWS);

            expect(state.intents).toEqual(['BROADCAST_SPRINT_US_MOVED']);

            state = reduce(state, { type: 'CONSUME_INTENTS' });

            expect(state.intents).toEqual([]);
        });
    });
});

/* ==========================================================================
 * THE POSITION-RELATIVE WRITE CONTRACT
 *
 * `bulk-update-us-backlog-order` takes NEIGHBOUR IDS, never indices
 * [app/coffee/modules/resources/userstories.coffee:L92-L105]. Every rule below is
 * frozen (G2) and every one of them fails SILENTLY when it is got wrong: the wrong
 * order is persisted, the response is a success, and it surfaces on the next load.
 * ========================================================================== */

describe('backlogReducer order request', () => {
    /** Sends story 3 between 1 and 2, with whichever neighbours the case supplies. */
    function requestFor(overrides: Partial<MoveUsRequestedAction>): BacklogOrderRequest {
        const result = run(makeThreeRowBacklog(), [moveUs({ usList: [3], ...overrides })]);

        return result.dispatches[0];
    }

    it('maps the controller names onto the facade names without crossing them', () => {
        // ⭐ NAME INVERSION ACROSS THE SEAM. Wiring it crossed reverses every drop
        // and reports nothing:
        //     backlog controller  ->  facade argument     ->  wire key
        //     previousUs          ->  afterUserstoryId    ->  after_userstory_id
        //     nextUs              ->  beforeUserstoryId   ->  before_userstory_id
        //     currentSprintId     ->  milestoneId         ->  milestone_id
        const request = requestFor({ previousUs: 1, nextUs: 2 });

        expect(request.afterUserstoryId).toBe(1);
        expect(request.beforeUserstoryId).toBe(2);
    });

    it('sends the destination sprint as the milestone for a cross-container move', () => {
        // `currentSprintId = if newSprintId != oldSprintId then newSprintId else
        // oldSprintId` [main.coffee:L533].
        const initial = createInitialBacklogState({
            userStories: [makeUs({ id: 1 }), makeUs({ id: 2 })],
            sprints: [makeSprint({ id: 7 })],
            closedSprints: [],
            eventsConnected: true,
        });

        const result = run(initial, [moveUs({ usList: [2], newSprintId: 7 })]);

        expect(result.dispatches[0].milestoneId).toBe(7);
    });

    it('sends the sprint the story is already in when it is reordered inside it', () => {
        const initial = createInitialBacklogState({
            userStories: [makeUs({ id: 1 })],
            sprints: [
                makeSprint({
                    id: 7,
                    user_stories: [makeNestedUs({ id: 5, milestone: 7 }), makeNestedUs({ id: 6, milestone: 7 })],
                }),
            ],
            closedSprints: [],
            eventsConnected: true,
        });

        const result = run(initial, [moveUs({ usList: [6], newSprintId: 7, previousUs: 5 })]);

        expect(result.dispatches[0].milestoneId).toBe(7);
    });

    it('sends no milestone at all for a move inside the backlog', () => {
        const request = requestFor({ nextUs: 1 });

        expect(request.milestoneId).toBeNull();
        expect(toWireParams(request)).not.toHaveProperty('milestone_id');
    });

    it('sends the story ids, and never the {us_id, order} shape of the other endpoint', () => {
        // ⛔ THE WIRE-KEY TRAP. The two ORDER endpoints take `bulk_userstories`
        // [resources/userstories.coffee:L94, L117] — a plain list of ids — while
        // `bulkCreate`, `bulkUpdateMilestone` and the sprint story move take
        // `bulk_stories` [:L68, :L109], a list of `{us_id, order}` entries.
        // Conflating them is a silent HTTP 400: the request shape validates as an
        // empty bulk rather than failing loudly at the call site.
        const request = requestFor({ nextUs: 1 });

        expect(request.bulkUserstories).toEqual([3]);
        expect(toWireParams(request).bulk_userstories).toEqual([3]);
        request.bulkUserstories.forEach((entry) => {
            expect(typeof entry).toBe('number');
        });
    });

    it('passes both neighbours through unfiltered, leaving the rule to one place', () => {
        // The reducer records what the drop reported and applies no filtering, so the
        // after-wins rule lives once — in the facade that builds the body. A reducer
        // that pre-filtered here would hide a crossed wiring from the facade's own
        // specification as well as from this one.
        const request = requestFor({ previousUs: 1, nextUs: 2 });

        expect(request.afterUserstoryId).not.toBeNull();
        expect(request.beforeUserstoryId).not.toBeNull();
    });

    it('sends only the after neighbour when the drop reported both', () => {
        // ⭐ [resources/userstories.coffee:L99-L103] `if after … else if before` =>
        // AFTER WINS. Both supplied sends only `after_userstory_id`.
        const params = toWireParams(requestFor({ previousUs: 1, nextUs: 2 }));

        expect(params.after_userstory_id).toBe(1);
        expect(params).not.toHaveProperty('before_userstory_id');
    });

    it('sends only the before neighbour when the drop reported just that one', () => {
        const params = toWireParams(requestFor({ nextUs: 1 }));

        expect(params.before_userstory_id).toBe(1);
        expect(params).not.toHaveProperty('after_userstory_id');
    });

    it('sends neither key when the drop reported neither neighbour', () => {
        // The head of an empty list, and the only case in which the server is left to
        // choose the position itself.
        const params = toWireParams(requestFor({}));

        expect(params).not.toHaveProperty('after_userstory_id');
        expect(params).not.toHaveProperty('before_userstory_id');
        expect(Object.keys(params).sort()).toEqual(['bulk_userstories', 'project_id']);
    });

    it('omits a neighbour key entirely when the id is zero', () => {
        // ⭐ TRUTHINESS, NOT NULLISHNESS [resources/userstories.coffee:L96, L99, L102].
        // An id of `0` OMITS its key. That is the single most surprising line in the
        // contract and the easiest to "improve" into a null check — which would start
        // sending `after_userstory_id: 0` and change where the server puts the story.
        const request = requestFor({ previousUs: 0, nextUs: 0 });

        // The reducer carries the zero through faithfully...
        expect(request.afterUserstoryId).toBe(0);
        expect(request.beforeUserstoryId).toBe(0);

        // ...and the frozen rule then drops both keys.
        const params = toWireParams(request);

        expect(params).not.toHaveProperty('after_userstory_id');
        expect(params).not.toHaveProperty('before_userstory_id');
    });

    it('carries the project id from the dragged story', () => {
        // `project = usList[0].project` [main.coffee:L525].
        expect(requestFor({ nextUs: 1 }).projectId).toBe(PROJECT_ID);
    });

    it('carries every story of a multi-story drag, in drag order', () => {
        const result = run(makeThreeRowBacklog(), [
            moveUs({ usList: [2, 3], previousUs: 1 }),
        ]);

        expect(result.dispatches[0].bulkUserstories).toEqual([2, 3]);
    });
});

/* ==========================================================================
 * THE LOCAL POSITION ARITHMETIC
 *
 * `main.coffee:L577-L595` for the same-container case and `:L548-L576` for a move
 * between containers. Two preserved defects live here, and one preserved asymmetry.
 * ========================================================================== */

describe('backlogReducer local ordering', () => {
    it('sends a story to the very top when the drop reported only the first row', () => {
        // ⛔⛔ LOCKS PRESERVED DEFECT MU-1 [main.coffee:L588-L593] — the `else if
        // nextUs` branch compares `previousUs`, a copy-paste of the branch above it.
        // That branch is only reached when `previousUs` is falsy, so the comparison
        // can never match, `findIndex` returns -1, and the increment at [:L593] turns
        // it into 0. `moveUsToTopOfBacklog` [:L519] DEPENDS on that accident: it
        // passes `previousUs = null` with `nextUs = <first story id>` and gets
        // position 0 out of it. Do NOT "fix" the comparison (T10); if this test
        // starts failing, someone did.
        const result = run(makeThreeRowBacklog(), [
            moveUs({ usList: [3], newUsIndex: 0, previousUs: null, nextUs: 1 }),
        ]);

        expect(idsOf(result.state.userStories)).toEqual([3, 1, 2]);
        expect(idsOf(result.state.userStories).indexOf(3)).toBe(0);
    });

    it('sends a story to the top through the row action, which relies on the same accident', () => {
        // `moveUsToTopOfBacklog` [main.coffee:L511-L521] resolves `nextUs` from the
        // first row [:L518] and passes no `previousUs` [:L519].
        const result = run(makeThreeRowBacklog(), [
            { type: 'MOVE_US_TO_TOP_REQUESTED', usList: [3] },
        ]);

        expect(idsOf(result.state.userStories)).toEqual([3, 1, 2]);
        expect(result.dispatches).toHaveLength(1);
        expect(result.dispatches[0].beforeUserstoryId).toBe(1);
    });

    it('does nothing at all when the backlog is empty', () => {
        // [main.coffee:L517-L521] returns an already-resolved promise without
        // touching the queue when there is no first row to aim at.
        const empty = createInitialBacklogState({ closedSprints: [], eventsConnected: true });

        const result = run(empty, [{ type: 'MOVE_US_TO_TOP_REQUESTED', usList: [3] }]);

        expect(result.state.pendingDrag).toEqual([]);
        expect(result.dispatches).toEqual([]);
    });

    it('places a story immediately after the row the drop landed on', () => {
        // The companion to MU-1, and the branch that actually works: `position =
        // targetList.findIndex(id == previousUs)` then `position++`
        // [main.coffee:L588-L589, L593]. Story 3 lands after story 1, at index 1 —
        // demonstrably NOT the 0 the `nextUs` branch produces.
        const result = run(makeThreeRowBacklog(), [
            moveUs({ usList: [3], previousUs: 1 }),
        ]);

        expect(idsOf(result.state.userStories)).toEqual([1, 3, 2]);
        expect(idsOf(result.state.userStories).indexOf(3)).toBe(1);
    });

    it('places a story at index one when the drop reported no neighbour at all', () => {
        // A third case that looks like a defect and is not one to touch: with both
        // neighbours falsy neither branch runs, `position` keeps the 0 it was
        // initialised with at [main.coffee:L586], and the increment at [:L593] makes
        // it 1 — so the story inserts at index 1 rather than at the head.
        const result = run(makeThreeRowBacklog(), [moveUs({ usList: [3] })]);

        expect(idsOf(result.state.userStories)).toEqual([1, 3, 2]);
    });

    it('keeps a multi-story drag in relative order inside the backlog', () => {
        // `targetList.splice(position + index, 0, us)` [main.coffee:L594-L595].
        const result = run(makeThreeRowBacklog(), [
            moveUs({ usList: [2, 3], previousUs: 1 }),
        ]);

        expect(idsOf(result.state.userStories)).toEqual([1, 2, 3]);
    });

    it('moves a story out of its sprint and into the backlog at the drop index', () => {
        // [main.coffee:L549-L559]: removed from the sprint's list, spliced into the
        // backlog at `newUsIndex + index`.
        const initial = createInitialBacklogState({
            userStories: [makeUs({ id: 1 }), makeUs({ id: 2 })],
            sprints: [makeSprint({ id: 7, user_stories: [makeNestedUs({ id: 5, milestone: 7 })] })],
            closedSprints: [],
            eventsConnected: true,
        });

        const result = run(initial, [
            moveUs({ usList: [5], newUsIndex: 1, newSprintId: null }),
        ]);

        expect(idsOf(result.state.userStories)).toEqual([1, 5, 2]);
        expect(result.state.sprints[0].user_stories).toEqual([]);
    });

    it('moves a story out of the backlog and into a sprint, stamping the new milestone', () => {
        // [main.coffee:L561-L566]: removed from the backlog, `us.milestone =
        // newSprintId`, spliced into the sprint.
        const initial = createInitialBacklogState({
            userStories: [makeUs({ id: 1 }), makeUs({ id: 2 })],
            sprints: [makeSprint({ id: 7, user_stories: [makeNestedUs({ id: 5, milestone: 7 })] })],
            closedSprints: [],
            eventsConnected: true,
        });

        const result = run(initial, [
            moveUs({ usList: [2], newUsIndex: 0, newSprintId: 7, nextUs: 5 }),
        ]);

        expect(idsOf(result.state.userStories)).toEqual([1]);
        expect(idsOf(result.state.sprints[0].user_stories)).toEqual([2, 5]);

        const moved: BacklogRowStory | undefined = result.state.sprints[0].user_stories.find(
            (story) => story.id === 2,
        );

        expect(moved?.milestone).toBe(7);
    });

    it('reverses a multi-story drag into a sprint, exactly as the incumbent does', () => {
        // ⭐ PRESERVED ASYMMETRY [main.coffee:L566] — every story is spliced at the
        // SAME `newUsIndex`, with no `+ index`, unlike the to-backlog branch at
        // [:L558-L559]. A multi-story drag into a sprint therefore lands in REVERSED
        // relative order. Preserved per T10; the server renumbers `sprint_order` on
        // the reply anyway, so the reversal is not observable after a reload.
        const initial = createInitialBacklogState({
            userStories: [makeUs({ id: 1 }), makeUs({ id: 2 }), makeUs({ id: 3 })],
            sprints: [makeSprint({ id: 7, user_stories: [makeNestedUs({ id: 5, milestone: 7 })] })],
            closedSprints: [],
            eventsConnected: true,
        });

        const result = run(initial, [
            moveUs({ usList: [1, 2], newUsIndex: 0, newSprintId: 7, nextUs: 5 }),
        ]);

        expect(idsOf(result.state.sprints[0].user_stories)).toEqual([2, 1, 5]);
    });

    it('reorders inside one sprint without touching the backlog', () => {
        const initial = createInitialBacklogState({
            userStories: [makeUs({ id: 1 })],
            sprints: [
                makeSprint({
                    id: 7,
                    user_stories: [
                        makeNestedUs({ id: 5, milestone: 7 }),
                        makeNestedUs({ id: 6, milestone: 7 }),
                        makeNestedUs({ id: 8, milestone: 7 }),
                    ],
                }),
            ],
            closedSprints: [],
            eventsConnected: true,
        });

        const result = run(initial, [
            moveUs({ usList: [8], newSprintId: 7, previousUs: 5 }),
        ]);

        expect(idsOf(result.state.sprints[0].user_stories)).toEqual([5, 8, 6]);
        expect(idsOf(result.state.userStories)).toEqual([1]);
    });

    it('finds the story in a closed sprint too, open sprints first', () => {
        // `@scope.sprintsById[id] || @scope.closedSprintsById[id]`
        // [main.coffee:L527-L528, L530-L531].
        const initial = createInitialBacklogState({
            userStories: [makeUs({ id: 1 })],
            sprints: [],
            closedSprints: [
                makeSprint({ id: 99, closed: true, user_stories: [makeNestedUs({ id: 5, milestone: 99 })] }),
            ],
            eventsConnected: true,
        });

        const result = run(initial, [
            moveUs({ usList: [5], newUsIndex: 0, newSprintId: null, nextUs: 1 }),
        ]);

        expect(idsOf(result.state.userStories)).toEqual([5, 1]);
        expect(result.state.closedSprints?.[0].user_stories).toEqual([]);
    });

    it('leaves the lists alone when the destination sprint is not held', () => {
        // The incumbent would have thrown on `newSprint.user_stories`; returning is
        // the totality this reducer needs and changes nothing reachable before.
        const result = run(makeThreeRowBacklog(), [
            moveUs({ usList: [3], newSprintId: 4242 }),
        ]);

        expect(idsOf(result.state.userStories)).toEqual([1, 2, 3]);
    });

    it('leaves the lists alone when a reorder names a sprint that is not held', () => {
        // A story whose `milestone` points at a sprint the screen does not hold —
        // reachable while the closed sprints are still unloaded — reordered inside that
        // same sprint. The incumbent would have dereferenced `newSprint.user_stories`
        // [main.coffee:L579]; returning leaves the rows exactly as they were.
        const initial = createInitialBacklogState({
            userStories: [makeUs({ id: 1 }), makeUs({ id: 2, milestone: 4242 })],
            eventsConnected: true,
        });

        const result = run(initial, [
            moveUs({ usList: [2], newSprintId: 4242, previousUs: 1 }),
        ]);

        expect(idsOf(result.state.userStories)).toEqual([1, 2]);

        // The entry is still queued and still dispatched: only the LOCAL move is
        // skipped, exactly as the incumbent's control flow would have it.
        expect(result.dispatches).toHaveLength(1);
    });
});

/* ==========================================================================
 * THE THREE SELECTION FACETS
 *
 * `main.coffee:L819-L860`. Selection lives in three places that GENUINELY DRIFT
 * APART:
 *
 *   1. the checkbox's own `checked` state, which the incumbent read straight back
 *      out of the DOM [:L771, :L826];
 *   2. the `is-checked` class on `.us-item-row`, toggled at [:L859] for the
 *      DIRECTLY CLICKED row only;
 *   3. the `ui-multisortable-multiple` class, toggled inside `checkSelected` at
 *      [:L824].
 *
 * ⛔ DO NOT COLLAPSE THEM INTO ONE SET OF SELECTED IDS to make these cases
 * simpler. Collapsing FIXES the drift, which is a behaviour change and not a
 * clean-up (T10), and the three class names are the existing stylesheet contract
 * the components apply from this state (T1).
 * ========================================================================== */

describe('backlogReducer selection', () => {
    /** Four rows and one sprint, so the move-to-sprint control has something to show. */
    function makeSelectableBacklog(): BacklogState {
        return createInitialBacklogState({
            userStories: [makeUs({ id: 1 }), makeUs({ id: 2 }), makeUs({ id: 3 }), makeUs({ id: 4 })],
            sprints: [makeSprint({ id: 7 })],
            closedSprints: [],
            eventsConnected: true,
        });
    }

    function click(state: BacklogState, storyId: number): BacklogState {
        return reduce(state, { type: 'TOGGLE_ROW_CHECKBOX', storyId });
    }

    function holdShift(state: BacklogState): BacklogState {
        // `$(window).on "keydown.shift-pressed keyup.shift-pressed"` set this from
        // `!!event.shiftKey` [main.coffee:L834-L837].
        //
        // ⛔ SEL-3, DOCUMENTED AND DELIBERATELY NOT CARRIED ACROSS — that listener is
        // never unbound, so every visit to the backlog leaves another one attached to
        // `window`. The FLAG is reproduced; the leak is not. In React the listener
        // belongs to a hook whose effect returns a cleanup, and importing an uncleaned
        // global listener would be importing a defect class the migration must not
        // carry. Recorded as a documented deviation in the Drift Register rather than
        // as a silent fix, and deliberately NOT asserted here: no test should demand
        // a leak.
        return reduce(state, { type: 'SET_SHIFT_PRESSED', shiftPressed: true });
    }

    /** Whether a facet holds a truthy entry for a row, distinguishing absent from false. */
    function has(facet: Readonly<Record<number, boolean>>, storyId: number): boolean {
        return facet[storyId] === true;
    }

    function isPresent(facet: Readonly<Record<number, boolean>>, storyId: number): boolean {
        return Object.prototype.hasOwnProperty.call(facet, storyId);
    }

    describe('a direct click', () => {
        it('sets all three facets for the row that was clicked', () => {
            const state = click(makeSelectableBacklog(), 2);

            expect(has(state.checkedIds, 2)).toBe(true); // the checkbox itself
            expect(has(state.isCheckedIds, 2)).toBe(true); // [main.coffee:L859]
            expect(has(state.multiSelectedIds, 2)).toBe(true); // [main.coffee:L824]
        });

        it('moves the shift anchor onto the clicked row', () => {
            // `lastChecked = target.closest(".us-item-row")` [main.coffee:L823], reached
            // through `checkSelected(target)` at [:L860].
            const state = click(makeSelectableBacklog(), 2);

            expect(state.lastCheckedId).toBe(2);
        });

        it('shows the move-to-sprint control once a row is selected', () => {
            // `if selectedUsDom.length > 0 and $scope.sprints.length > 0`
            // [main.coffee:L828-L831].
            const state = click(makeSelectableBacklog(), 2);

            expect(state.moveToSprintVisible).toBe(true);
        });

        it('keeps the control hidden when the project has no sprint to move into', () => {
            const noSprints = createInitialBacklogState({
                userStories: [makeUs({ id: 1 })],
                closedSprints: [],
                eventsConnected: true,
            });

            expect(click(noSprints, 1).moveToSprintVisible).toBe(false);
        });

        it('clears all three facets when the same row is clicked again', () => {
            let state = click(makeSelectableBacklog(), 2);
            state = click(state, 2);

            expect(has(state.checkedIds, 2)).toBe(false);
            expect(has(state.isCheckedIds, 2)).toBe(false);
            expect(has(state.multiSelectedIds, 2)).toBe(false);
            expect(state.moveToSprintVisible).toBe(false);
        });

        it('selects several rows independently', () => {
            let state = click(makeSelectableBacklog(), 1);
            state = click(state, 3);

            expect(has(state.checkedIds, 1)).toBe(true);
            expect(has(state.checkedIds, 3)).toBe(true);
            expect(isPresent(state.checkedIds, 2)).toBe(false);
        });
    });

    describe('a shift-click range', () => {
        it('leaves the range rows checked but WITHOUT the is-checked class', () => {
            // ⛔⛔ LOCKS PRESERVED DEFECT SEL-1 [main.coffee:L842-L859] — the shift-range
            // path sets `checked` idempotently at [:L855] and then TOGGLES
            // `ui-multisortable-multiple` through `checkSelected` at [:L856], but it
            // never touches `is-checked`: [:L859] is only ever reached for the row the
            // user actually clicked. So range rows end up checked with `is-checked`
            // MISSING. Preserved per T10; if this test starts failing, someone unified
            // the three facets — revert it.
            let state = click(makeSelectableBacklog(), 1);
            state = holdShift(state);
            state = click(state, 4);

            // Rows 2 and 3 are the range. Both endpoints are excluded by `nextUntil`
            // [main.coffee:L849], and the clicked row is handled separately at [:L858].
            [2, 3].forEach((storyId) => {
                expect(has(state.checkedIds, storyId)).toBe(true);
                expect(has(state.multiSelectedIds, storyId)).toBe(true);
                expect(isPresent(state.isCheckedIds, storyId)).toBe(false);
            });

            // The clicked row, by contrast, carries all three.
            expect(has(state.checkedIds, 4)).toBe(true);
            expect(has(state.isCheckedIds, 4)).toBe(true);
            expect(has(state.multiSelectedIds, 4)).toBe(true);
        });

        it('REMOVES the multi class from a range row that already carried it, and leaves it checked', () => {
            // ⛔ THE SECOND HALF OF SEL-1 [main.coffee:L856] — `checkSelected` TOGGLES
            // the class rather than setting it, while [:L855] sets `checked`
            // idempotently. A row that was already multi-selected and is then caught in
            // a range therefore ends up checked with the multi class GONE. It looks
            // like a defect because it is one, and it is preserved.
            let state = click(makeSelectableBacklog(), 2);

            expect(has(state.multiSelectedIds, 2)).toBe(true);

            state = click(state, 1);
            state = holdShift(state);
            state = click(state, 4);

            expect(has(state.checkedIds, 2)).toBe(true);
            expect(has(state.multiSelectedIds, 2)).toBe(false);
        });

        it('walks a backwards range as well as a forwards one', () => {
            // `prevAll` / `prevUntil` [main.coffee:L846, L850-L851].
            let state = click(makeSelectableBacklog(), 4);
            state = holdShift(state);
            state = click(state, 1);

            [2, 3].forEach((storyId) => {
                expect(has(state.checkedIds, storyId)).toBe(true);
                expect(isPresent(state.isCheckedIds, storyId)).toBe(false);
            });
        });

        it('selects nothing extra when the anchor itself is shift-clicked', () => {
            // The anchor matches neither `nextAll` nor `prevAll` [main.coffee:L848,
            // L850], so the range is empty and only the clicked row changes.
            let state = click(makeSelectableBacklog(), 2);
            state = holdShift(state);
            state = click(state, 2);

            expect(has(state.checkedIds, 2)).toBe(false);
            expect(isPresent(state.checkedIds, 1)).toBe(false);
            expect(isPresent(state.checkedIds, 3)).toBe(false);
        });

        it('selects nothing extra for adjacent rows, because both endpoints are excluded', () => {
            // `nextUntil` stops BEFORE the element it is given and never includes the
            // element it starts from [main.coffee:L849], so adjacent rows have no rows
            // between them.
            let state = click(makeSelectableBacklog(), 1);
            state = holdShift(state);
            state = click(state, 2);

            expect(has(state.checkedIds, 1)).toBe(true);
            expect(has(state.checkedIds, 2)).toBe(true);
            expect(isPresent(state.checkedIds, 3)).toBe(false);
        });

        it('selects no range when the anchor row has left the backlog', () => {
            // The anchor is an id, and the row it names can disappear — dragged into a
            // sprint, or filtered away — between the two clicks. The incumbent held a
            // detached DOM node in that situation and its sibling walk found nothing; an
            // id that matches no row does the same, rather than measuring from index -1
            // and selecting the whole list.
            let state = click(makeSelectableBacklog(), 1);

            state = reduce(state, {
                type: 'SET_USER_STORIES',
                userStories: [makeUs({ id: 2 }), makeUs({ id: 3 }), makeUs({ id: 4 })],
            });
            state = holdShift(state);
            state = click(state, 4);

            expect(has(state.checkedIds, 4)).toBe(true);
            expect(isPresent(state.checkedIds, 2)).toBe(false);
            expect(isPresent(state.checkedIds, 3)).toBe(false);
        });

        it('ignores the shift key while there is no anchor to measure from', () => {
            // `if lastChecked && shiftPressed` [main.coffee:L842].
            let state = holdShift(makeSelectableBacklog());
            state = click(state, 3);

            expect(has(state.checkedIds, 3)).toBe(true);
            expect(isPresent(state.checkedIds, 1)).toBe(false);
            expect(isPresent(state.checkedIds, 2)).toBe(false);
        });

        it('moves the anchor to the clicked row rather than keeping the original', () => {
            // ⛔ LOCKS PRESERVED DEFECT SEL-2 [main.coffee:L823] — `lastChecked` is
            // reassigned INSIDE `checkSelected`, which the range loop calls once per row
            // [:L856] and the clicked row calls last [:L860]. The anchor after every
            // change event is therefore the CLICKED row, never the row the user
            // originally anchored on.
            let state = click(makeSelectableBacklog(), 1);
            state = holdShift(state);
            state = click(state, 3);

            expect(state.lastCheckedId).toBe(3);
            expect(state.lastCheckedId).not.toBe(1);
        });

        it('measures a second shift-click from the previous click, not from the original anchor', () => {
            // The observable consequence of SEL-2: consecutive shift-clicks measure
            // their range from the previous click. Had the anchor stayed at row 1, the
            // second range would have been rows 2, 3 and 4 instead of row 4 alone.
            let state = click(makeSelectableBacklog(), 1);
            state = holdShift(state);
            state = click(state, 3);

            // Row 2 was the first range; it is checked and carries no `is-checked`.
            expect(has(state.checkedIds, 2)).toBe(true);

            const beforeSecondClick = state.multiSelectedIds[2];

            state = reduce(state, {
                type: 'SET_USER_STORIES',
                userStories: [makeUs({ id: 1 }), makeUs({ id: 2 }), makeUs({ id: 3 }), makeUs({ id: 4 }), makeUs({ id: 5 })],
            });
            state = click(state, 5);

            // The second range is row 4 only, measured from row 3.
            expect(has(state.checkedIds, 4)).toBe(true);
            expect(isPresent(state.isCheckedIds, 4)).toBe(false);

            // Row 2 was outside the second range, so its multi facet is untouched.
            expect(state.multiSelectedIds[2]).toBe(beforeSecondClick);
        });

        it('releases the shift key again', () => {
            let state = holdShift(makeSelectableBacklog());

            expect(state.shiftPressed).toBe(true);

            state = reduce(state, { type: 'SET_SHIFT_PRESSED', shiftPressed: false });

            expect(state.shiftPressed).toBe(false);
        });
    });
});

/* ==========================================================================
 * MOVING THE SELECTION INTO A SPRINT
 *
 * `getUsToMove` / `moveUssToSprint` / `moveToCurrentSprint` / `moveToLatestSprint`
 * [main.coffee:L769-L813]. Two preserved defects and one documented deviation.
 * ========================================================================== */

describe('backlogReducer move to sprint', () => {
    const LATEST_SPRINT_ID = 1;

    const CURRENT_SPRINT_ID = 2;

    /**
     * Two sprints with distinct totals, so "which sprint did this actually touch" is
     * always answerable, and three rows to select from.
     */
    function makeTwoSprintBacklog(
        stories: readonly BacklogUserStory[] = [makeUs({ id: 10, total_points: 3 })],
    ): BacklogState {
        return createInitialBacklogState({
            userStories: [...stories],
            sprints: [
                makeSprint({ id: LATEST_SPRINT_ID, total_points: 10 }),
                makeSprint({ id: CURRENT_SPRINT_ID, total_points: 100 }),
            ],
            currentSprintId: CURRENT_SPRINT_ID,
            closedSprints: [],
            eventsConnected: true,
        });
    }

    function selectAndMove(
        state: BacklogState,
        storyIds: readonly number[],
        target: 'current' | 'latest',
    ): BacklogState {
        const selected = storyIds.reduce(
            (accumulator, storyId) => reduce(accumulator, { type: 'TOGGLE_ROW_CHECKBOX', storyId }),
            state,
        );

        return reduce(selected, { type: 'MOVE_SELECTED_TO_SPRINT', target });
    }

    it('poisons the sprint total to NaN when nothing is selected', () => {
        // ⛔⛔ LOCKS PRESERVED DEFECT MS-1 [main.coffee:L786, L792] — `_.reduce` is
        // called WITHOUT A SEED, so an empty selection reduces to `undefined`, and the
        // `+=` at [:L792] then turns the sprint's total into NaN. Adding a `0` seed
        // would repair it and is therefore forbidden (T10).
        const state = reduce(makeTwoSprintBacklog(), {
            type: 'MOVE_SELECTED_TO_SPRINT',
            target: 'latest',
        });

        // `toBeNaN` rather than `toBe(NaN)`, because NaN is not equal to itself.
        expect(state.sprints[0].total_points).toBeNaN();
        expect(state.milestoneMoveRequest?.data).toEqual([]);
    });

    it('adds the selected points to the sprint total when something is selected', () => {
        const state = selectAndMove(
            makeTwoSprintBacklog([
                makeUs({ id: 10, total_points: 3 }),
                makeUs({ id: 11, total_points: 5 }),
            ]),
            [10, 11],
            'latest',
        );

        // 10 + (3 + 5) [main.coffee:L785-L786, L792].
        expect(state.sprints[0].total_points).toBe(18);
    });

    it('counts an unestimated story as zero, exactly as the incumbent addition did', () => {
        // `total_points` is `null` for an unestimated story and the incumbent added
        // those nulls with `+`, which coerces them to zero.
        const state = selectAndMove(
            makeTwoSprintBacklog([
                makeUs({ id: 10, total_points: 3 }),
                makeUs({ id: 11, total_points: null }),
            ]),
            [10, 11],
            'latest',
        );

        expect(state.sprints[0].total_points).toBe(13);
    });

    it('counts a sprint with no points as zero rather than dropping the addition', () => {
        const initial = createInitialBacklogState({
            userStories: [makeUs({ id: 10, total_points: 3 })],
            sprints: [makeSprint({ id: LATEST_SPRINT_ID, total_points: null })],
            closedSprints: [],
            eventsConnected: true,
        });

        const state = selectAndMove(initial, [10], 'latest');

        expect(state.sprints[0].total_points).toBe(3);
    });

    it('removes the moved rows from the backlog', () => {
        // [main.coffee:L783].
        const state = selectAndMove(
            makeTwoSprintBacklog([makeUs({ id: 10 }), makeUs({ id: 11 })]),
            [10],
            'latest',
        );

        expect(idsOf(state.userStories)).toEqual([11]);
    });

    it('appends only rows the sprint does not already hold', () => {
        // `_.union` [main.coffee:L789].
        const shared = makeUs({ id: 10, total_points: 3 });
        const initial = createInitialBacklogState({
            userStories: [shared],
            sprints: [makeSprint({ id: LATEST_SPRINT_ID, total_points: 10, user_stories: [shared] })],
            closedSprints: [],
            eventsConnected: true,
        });

        const state = selectAndMove(initial, [10], 'latest');

        expect(idsOf(state.sprints[0].user_stories)).toEqual([10]);
    });

    it('hides the move-to-sprint control once the move is under way', () => {
        // `$el.find(".move-to-sprint").hide()` [main.coffee:L805].
        const state = selectAndMove(makeTwoSprintBacklog(), [10], 'latest');

        expect(state.moveToSprintVisible).toBe(false);
    });

    it('emits exactly the {us_id, order} entries the milestone endpoint takes', () => {
        // [main.coffee:L794-L798]. The keys are SNAKE_CASE wire names: `us_id` is what
        // the backend validator declares, and camelCasing it is a rejected request
        // rather than a style difference (G2).
        //
        // ⛔ AND THE BODY KEY IS `bulk_stories`, NOT `bulk_userstories`. The two ORDER
        // endpoints use `bulk_userstories` [resources/userstories.coffee:L94, L117]
        // while `bulkCreate`, `bulkUpdateMilestone` and the sprint story move use
        // `bulk_stories` [:L68, :L109]. Conflating them is a silent HTTP 400.
        const state = selectAndMove(
            makeTwoSprintBacklog([makeUs({ id: 10, sprint_order: 7 })]),
            [10],
            'latest',
        );

        expect(state.milestoneMoveRequest?.data).toEqual([{ us_id: 10, order: 7 }]);
        expect(Object.keys(state.milestoneMoveRequest?.data[0] ?? {}).sort()).toEqual([
            'order',
            'us_id',
        ]);
    });

    it('reads sprint_order for the entry order, never the backlog position', () => {
        // `prepareBulkUpdateData` defaults its field to `"backlog_order"`
        // [main.coffee:L504-L505], but this payload is built from `us.sprint_order`
        // [:L797] — a DIFFERENT field. Reading the wrong one persists a wrong position
        // inside the sprint with no error surface, so the fixture below gives the two
        // fields deliberately different values.
        const state = selectAndMove(
            makeTwoSprintBacklog([makeUs({ id: 10, backlog_order: 41, sprint_order: 7 })]),
            [10],
            'latest',
        );

        expect(state.milestoneMoveRequest?.data[0].order).toBe(7);
        expect(state.milestoneMoveRequest?.data[0].order).not.toBe(41);
    });

    it('sends order zero for a story that has never been ordered inside a sprint', () => {
        // ⭐ DOCUMENTED DEVIATION DEV-2 — the incumbent reads `us.sprint_order`, which a
        // story that has never been in a sprint does not have, and the serialiser then
        // DROPS the key; both members are required integers on the endpoint's
        // validator, so that request is rejected outright. `0` is the least inventive
        // narrowing available: the same "unordered" position the model itself defaults
        // to. It is still NOT the story's backlog position.
        const state = selectAndMove(
            makeTwoSprintBacklog([makeUs({ id: 10, backlog_order: 41 })]),
            [10],
            'latest',
        );

        expect(state.milestoneMoveRequest?.data[0].order).toBe(0);
        expect(state.milestoneMoveRequest?.data[0].order).not.toBe(41);
    });

    it('addresses the request to the FIRST sprint even when a different one was asked for', () => {
        // ⛔⛔ LOCKS PRESERVED DEFECT MS-3 [main.coffee:L776, L799] — the target sprint
        // is hardcoded to `sprints[0]`, both in the milestone the stories are stamped
        // with and in the sprint the request is addressed to, IGNORING the sprint that
        // `moveToCurrentSprint` [:L808] took the trouble to resolve. So "move to
        // current sprint" updates the CURRENT sprint's local totals while persisting
        // the stories into the LATEST one. Preserved per T10.
        const state = selectAndMove(makeTwoSprintBacklog(), [10], 'current');

        expect(state.milestoneMoveRequest?.milestoneId).toBe(LATEST_SPRINT_ID);
        expect(state.milestoneMoveRequest?.milestoneId).not.toBe(CURRENT_SPRINT_ID);
    });

    it('stamps the moved stories with the FIRST sprint, whichever sprint was asked for', () => {
        const state = selectAndMove(makeTwoSprintBacklog(), [10], 'current');

        const moved: BacklogRowStory | undefined = state.sprints
            .flatMap((sprint) => [...sprint.user_stories])
            .find((story) => story.id === 10);

        expect(moved?.milestone).toBe(LATEST_SPRINT_ID);
    });

    it('updates the local totals of the sprint that WAS asked for, which is the contradiction', () => {
        const state = selectAndMove(makeTwoSprintBacklog(), [10], 'current');

        // The current sprint received the story and its points...
        expect(idsOf(state.sprints[1].user_stories)).toEqual([10]);
        expect(state.sprints[1].total_points).toBe(103);

        // ...while the sprint the request names was left exactly as it was.
        expect(state.sprints[0].user_stories).toEqual([]);
        expect(state.sprints[0].total_points).toBe(10);
    });

    it('targets the first sprint for both the local move and the request when asked for the latest', () => {
        const state = selectAndMove(makeTwoSprintBacklog(), [10], 'latest');

        expect(idsOf(state.sprints[0].user_stories)).toEqual([10]);
        expect(state.milestoneMoveRequest?.milestoneId).toBe(LATEST_SPRINT_ID);
    });

    it('falls back to the first sprint when the project has no current sprint', () => {
        // `sprint = if $scope.currentSprint then $scope.currentSprint else
        // $scope.sprints[0]` [main.coffee:L808].
        const initial = createInitialBacklogState({
            userStories: [makeUs({ id: 10, total_points: 3 })],
            sprints: [makeSprint({ id: LATEST_SPRINT_ID, total_points: 10 })],
            currentSprintId: null,
            closedSprints: [],
            eventsConnected: true,
        });

        const state = selectAndMove(initial, [10], 'current');

        expect(idsOf(state.sprints[0].user_stories)).toEqual([10]);
        expect(state.sprints[0].total_points).toBe(13);
    });

    it('carries the project id and touches nothing when there is no sprint at all', () => {
        // The incumbent dereferenced `$scope.sprints[0].id` [main.coffee:L776] without
        // a guard, and the control that reaches it is only shown when
        // `sprints.length > 0` [:L826-L831], so this branch was unreachable there.
        const withSprint = selectAndMove(makeTwoSprintBacklog(), [10], 'latest');

        expect(withSprint.milestoneMoveRequest?.projectId).toBe(PROJECT_ID);

        const noSprints = createInitialBacklogState({
            userStories: [makeUs({ id: 10 })],
            closedSprints: [],
            eventsConnected: true,
        });

        const state = reduce(noSprints, { type: 'MOVE_SELECTED_TO_SPRINT', target: 'latest' });

        expect(state.milestoneMoveRequest).toBeNull();
        expect(idsOf(state.userStories)).toEqual([10]);
    });

    it('takes the selection in rendered row order, not in click order', () => {
        // `$el.find(".backlog-table-body input:checkbox:checked")` [main.coffee:L771]
        // yields its matches in rendered order, whatever order the user clicked in.
        const state = selectAndMove(
            makeTwoSprintBacklog([makeUs({ id: 10 }), makeUs({ id: 11 }), makeUs({ id: 12 })]),
            [12, 10],
            'latest',
        );

        expect(state.milestoneMoveRequest?.data.map((entry) => entry.us_id)).toEqual([10, 12]);
    });

    it('empties the request mailbox when the hook consumes it', () => {
        let state = selectAndMove(makeTwoSprintBacklog(), [10], 'latest');

        expect(state.milestoneMoveRequest).not.toBeNull();

        state = reduce(state, { type: 'CONSUME_MILESTONE_MOVE_REQUEST' });

        expect(state.milestoneMoveRequest).toBeNull();
    });

    it('records all FOUR follow-ups once the milestone move has succeeded', () => {
        // [main.coffee:L800-L803], in their original order. They are post-success,
        // which is why they are not recorded when the request is built.
        const result = run(makeTwoSprintBacklog(), [{ type: 'MILESTONE_MOVE_SUCCEEDED' }]);

        expect(result.intents).toEqual([
            'LOAD_SPRINTS',
            'LOAD_PROJECT_STATS',
            'TOGGLE_VELOCITY_FORECASTING',
            'CALCULATE_FORECASTING',
        ]);
    });
});

/* ==========================================================================
 * IMMER COMPOSITION AND PURITY
 *
 * The properties that make this reducer safe to hand to `useReducer(produce(...))`
 * and to `React.memo`, and that no type check can establish.
 * ========================================================================== */

describe('backlogReducer composition', () => {
    it('leaves untouched branches at the same reference', () => {
        // ⭐ P-IMMER-4 — `autoFreeze` is on, so immer's structural sharing yields
        // REFERENCE EQUALITY on every branch an action did not touch. That is what
        // makes `React.memo` a genuine replacement for the change detection the
        // incumbent got from its immutable collections, and it is worth locking:
        // `toBe`, never `toEqual`, because deep equality would pass against a reducer
        // that rebuilt every branch on every dispatch and re-rendered the whole screen.
        const before = makeThreeRowBacklog();
        const after = reduce(before, moveUs({ usList: [3], nextUs: 1 }));

        // A queue action touches none of the three selection facets.
        expect(after.checkedIds).toBe(before.checkedIds);
        expect(after.isCheckedIds).toBe(before.isCheckedIds);
        expect(after.multiSelectedIds).toBe(before.multiSelectedIds);
        expect(after.sprints).toBe(before.sprints);

        // ...while the branches it did touch are new, so a memoised subtree does
        // re-render when it has to.
        expect(after.pendingDrag).not.toBe(before.pendingDrag);
        expect(after.userStories).not.toBe(before.userStories);
    });

    it('leaves the queue at the same reference when only the selection changed', () => {
        // The other direction, so the previous case cannot pass by accident on a
        // reducer that simply never rebuilds anything.
        const before = createInitialBacklogState({
            userStories: [makeUs({ id: 1 })],
            sprints: [makeSprint({ id: 7 })],
            closedSprints: [],
            eventsConnected: true,
        });

        const after = reduce(before, { type: 'TOGGLE_ROW_CHECKBOX', storyId: 1 });

        expect(after.pendingDrag).toBe(before.pendingDrag);
        expect(after.userStories).toBe(before.userStories);
        expect(after.checkedIds).not.toBe(before.checkedIds);
    });

    it('freezes what it hands back, so a stray write fails loudly', () => {
        // The companion to structural sharing: with `autoFreeze` on, a mutation after
        // `produce` throws in development instead of corrupting state silently. The
        // module output is strict, so the assignment below raises rather than being
        // ignored.
        const state = reduce(makeThreeRowBacklog(), moveUs({ usList: [3], nextUs: 1 }));

        expect(Object.isFrozen(state)).toBe(true);
        expect(Object.isFrozen(state.checkedIds)).toBe(true);
        expect(Object.isFrozen(state.pendingDrag)).toBe(true);
        expect(() => Object.assign(state.checkedIds, { 99: true })).toThrow(TypeError);
    });

    it('does not mutate the state it was given', () => {
        // Two identical fixtures rather than a clone: the pristine one is what the
        // dispatched one is compared against, so a reducer that wrote through to its
        // input would show up as a difference here. This is the property that lets a
        // component hold on to a previous state safely.
        const dispatched = makeThreeRowBacklog();
        const pristine = makeThreeRowBacklog();

        reduce(dispatched, moveUs({ usList: [3], nextUs: 1 }));
        reduce(dispatched, { type: 'TOGGLE_ROW_CHECKBOX', storyId: 1 });
        reduce(dispatched, { type: 'MOVE_SELECTED_TO_SPRINT', target: 'latest' });

        expect(dispatched).toEqual(pristine);
    });

    it('absorbs an action it does not recognise, returning the very same state', () => {
        // The switch is exhaustive over the action union and its `default` binds the
        // action to `never`, so adding a member without handling it is a COMPILE error
        // under `noFallthroughCasesInSwitch` rather than a silently ignored dispatch.
        // An unrecognised action can therefore only arrive at runtime — from a hook
        // built against an older bundle — and the absorbing branch must neither throw
        // nor invent a new state identity.
        const before = makeThreeRowBacklog();

        const after = produce(before, (draft) => {
            runtimeOnly.reduce(draft, { type: 'AN_ACTION_NO_HOOK_SENDS' });
        });

        expect(after).toBe(before);
    });

    it('emits inert data rather than anything callable', () => {
        // The reducer performs NO input or output whatsoever: no request, no DOM, no
        // browser global, no timer, no AngularJS, and never a digest kick — digest
        // cycles remain AngularJS's concern. What it emits is INTENT: a plain request
        // object and a list of intent NAMES, which the owning hook resolves and
        // performs through the typed facades in `app/react/shared/api`. That split is
        // what keeps this whole specification browserless and offline, and it matters
        // beyond testability: a move driven through a bridge-supplied callback instead
        // would put a second queue against a position-relative endpoint, which
        // reintroduces exactly the silent ordering corruption the queue exists to
        // prevent.
        const result = run(makeThreeRowBacklog(), [moveUs({ usList: [3], nextUs: 1 })]);
        const request = result.dispatches[0];

        expect(typeof request.projectId).toBe('number');
        expect(typeof request.afterUserstoryId).not.toBe('function');
        expect(typeof request.beforeUserstoryId).not.toBe('function');
        expect(Array.isArray(request.bulkUserstories)).toBe(true);

        // Serialisable end to end, which nothing callable is.
        expect(JSON.stringify(request)).toContain('"bulkUserstories":[3]');

        // And the intents are names, not functions.
        result.intents.forEach((intent) => {
            expect(typeof intent).toBe('string');
        });
    });

    it('holds plain arrays, so nothing here depends on a collection library', () => {
        // The one collection-library value in the incumbent controller
        // [main.coffee:L86] stays on the AngularJS side and is flattened to a plain
        // array at the bridge seam. The conversion is a genuine trap rather than a
        // formality: that collection's `push` returns a NEW COLLECTION, whereas an
        // array's `push` returns the NEW LENGTH, so a naive conversion of the consumer
        // at [main.coffee:L302] would have assigned a NUMBER to the list and broken the
        // screen silently. This folder therefore imports no such package at all (I5 —
        // it stays installed for the many out-of-scope screens that still use it), and
        // list state is read with `.length`.
        const state = reduce(makeThreeRowBacklog(), moveUs({ usList: [3], nextUs: 1 }));

        expect(Array.isArray(state.userStories)).toBe(true);
        expect(Array.isArray(state.pendingDrag)).toBe(true);
        expect(Array.isArray(state.visibleUserStories)).toBe(true);
        expect(Array.isArray(state.intents)).toBe(true);
        expect(state.userStories).toHaveLength(3);
    });

    it('survives a long run of mixed actions without losing queue integrity', () => {
        // A last integration pass over the whole machine: drags, a selection, a
        // sprint move and the drains in between. The invariant is that the queue
        // empties and that exactly as many requests were produced as drags were made
        // — no more, which would be corruption, and no fewer, which would be a lost
        // reorder.
        const result = run(makeThreeRowBacklog(), [
            moveUs({ usList: [3], nextUs: 1 }),
            moveUs({ usList: [2], previousUs: 1 }),
            { type: 'TOGGLE_ROW_CHECKBOX', storyId: 1 },
            moveUs({ usList: [1], previousUs: 3 }),
            SUCCEEDED_WITH_NO_ROWS,
            { type: 'PENDING_DRAG_DRAIN' },
            SUCCEEDED_WITH_NO_ROWS,
            { type: 'PENDING_DRAG_DRAIN' },
            SUCCEEDED_WITH_NO_ROWS,
        ]);

        expect(result.dispatches).toHaveLength(3);
        expect(result.state.pendingDrag).toEqual([]);
        expect(result.state.inFlightMove).toBeNull();
        expect(result.state.moveUsOutcome).toBeNull();
        expect(result.intents[result.intents.length - 1]).toBe('BROADCAST_SPRINT_US_MOVED');

        // The selection made along the way is still intact, because the queue and the
        // selection are independent branches of this state.
        expect(result.state.checkedIds[1]).toBe(true);
    });
});
