/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * The backlog screen's state machine, replacing the mutable `$scope` graph that
 * `BacklogController` maintained in `app/coffee/modules/backlog/main.coffee`.
 *
 * ─── WHY THE QUEUE LIVES HERE AND NOT IN A COMPONENT ────────────────────────────
 *
 * `moveUs` [main.coffee:L523-L642] is the single most dangerous behaviour in this
 * migration, and every part of it that can be got wrong is a PURE state transition.
 * Keeping it in a reducer makes it testable without a browser, without a network and
 * without a drag: a spec dispatches two moves back to back and asserts that only one
 * request was ever produced. Nothing else can prove that, because the failure is
 * silent — see the next section.
 *
 * ─── THE SILENT-CORRUPTION HAZARD, STATED PLAINLY ──────────────────────────────
 *
 * `bulk-update-us-backlog-order` is POSITION-RELATIVE. The request carries neighbour
 * ids (`after_userstory_id` / `before_userstory_id`), never absolute indices — see
 * `app/coffee/modules/resources/userstories.coffee:L92-L105`. With two requests in
 * flight at once, the second one computes its neighbours from a client-side ordering
 * the server has not yet acknowledged, so the order that gets persisted quietly
 * stops matching the order the user is looking at. There is no error, no toast and
 * no console warning; it surfaces on the next page load. A single-drag test passes
 * against a completely broken implementation, which is why the incumbent serialises
 * the writes and why that serialisation is reproduced here exactly.
 *
 * ─── HOW THIS FILE IS COMPOSED (immer) ─────────────────────────────────────────
 *
 * {@link backlogReducer} MUTATES A DRAFT and returns nothing. The container composes
 * it with immer's CURRIED `produce`:
 *
 *     const [state, dispatch] = useReducer(produce(backlogReducer), createInitialBacklogState(params));
 *
 * The curried form composes directly with a reducer, which is exactly why no extra
 * immer-for-React helper package is needed or wanted. `autoFreeze` is left at its
 * default (on): structural sharing then yields reference equality on every untouched
 * branch, which is what makes `React.memo` a real replacement for the change
 * detection the incumbent got from its immutable collections, and an accidental
 * mutation after `produce` throws in development instead of corrupting state.
 *
 * Two immer rules are honoured throughout, because breaking either is silent:
 *   • Every case either mutates the draft or returns — never both — and the draft
 *     parameter is never reassigned.
 *   • Nothing here logs a draft. Passing an immer proxy to a logger raises a
 *     TypeError, so there are no diagnostics in this file at all.
 *
 * ─── WHAT CALLERS MUST GUARANTEE ───────────────────────────────────────────────
 *
 * Every story, sprint and stats object reaching this reducer is CONTRACTUALLY
 * PRE-FLATTENED plain data. The AngularJS resource layer hands out model instances
 * that dirty-track their own fields, and freezing one of those into React state
 * would break the changed-fields-only PATCH the rest of the application depends on.
 * Flattening therefore happens at the bridge seam, following the precedent at
 * `app/modules/components/project-menu/project-menu.controller.coffee:L27`.
 *
 * ⚠ The sprint payload is TWO LEVELS DEEP: `app/coffee/modules/resources/sprints.coffee`
 * replaces a sprint's `user_stories` with an array of model instances, so a sprint is
 * a model whose stories are also models. BOTH levels must be flattened before a
 * sprint is dispatched into this reducer.
 *
 * ─── WHAT THIS FILE DELIBERATELY DOES NOT DO ───────────────────────────────────
 *
 * No I/O whatsoever. No HTTP, no DOM, no browser globals, no timers, no AngularJS,
 * and never a digest kick — digest cycles remain AngularJS's concern. The reducer
 * emits INTENT ({@link BacklogState.moveUsOutcome}, {@link BacklogState.intents},
 * {@link BacklogState.milestoneMoveRequest}); the owning hook performs the calls
 * through the typed facades in `app/react/shared/api` and performs the broadcasts.
 * Writes must go through those facades and not through a bridge-supplied callback:
 * two independent queues aimed at a position-relative endpoint reintroduce exactly
 * the corruption this file exists to prevent.
 *
 * ─── OUTCOME-CONSUMPTION CONTRACT ──────────────────────────────────────────────
 *
 * {@link BacklogState.moveUsOutcome} and {@link BacklogState.intents} are one-shot
 * mailboxes. The hook must consume each one in the effect that observes it, using
 * `CONSUME_MOVE_US_OUTCOME` / `CONSUME_INTENTS` / `CONSUME_MILESTONE_MOVE_REQUEST`,
 * before dispatching another move. That mirrors the incumbent, where the outcome was
 * a return value nobody could hold on to.
 *
 * ─── NOTES FOR NEIGHBOURING WORK (recorded here, not acted on here) ────────────
 *
 * • If either screen renders BLANK, the cause is upstream of this file and should be
 *   checked first: `app-loader/app-loader.coffee` still has no `js/react.js` load
 *   between its `elements.js` line and its `app.js` line. `customElements.define` has
 *   to run before `angular.bootstrap`, or the host element is an inert unknown element
 *   at first render and the properties assigned to it are plain expandos.
 *
 * • `app/react/shared/api/projects.ts` keeps a private five-member view of the project
 *   stats while `./types.ts` declares the canonical eight-member payload. A hook that
 *   assigns one to the other will fail `tsc --noEmit`, and the fix belongs to those two
 *   files — never by weakening the canonical type.
 *
 * • The sprint counts have no bridge getter: they come from the sprint-list facade's
 *   envelope (`{milestones, closed: <count>, open: <count>}`), parsed with an explicit
 *   radix. A missing header legitimately yields `NaN` AND THAT `NaN` MUST PROPAGATE — it
 *   must not be coerced to zero. Mind the name collision while doing it: the envelope's
 *   `closed` is a COUNT, whereas `Sprint.closed` is a BOOLEAN.
 *
 * • Realtime subscription belongs to `../hooks/useBacklogRealtime.ts`, not here. It
 *   subscribes exactly two routing keys — `changes.project.{id}.userstories` and
 *   `changes.project.{id}.milestones`, the latter with self-notification
 *   [main.coffee:L223-L234] — and because React passes a null scope, unsubscribing in
 *   the effect cleanup is mandatory. That leak is silent: it shows up only as duplicate
 *   refreshes after navigating away and back.
 */

import type { Draft } from 'immer';
import type { BacklogUserStory, BulkMilestoneItem } from './types';
import type { UserStory } from '../../shared/types/userStory';
import type { NestedSprintUserStory, Sprint } from '../../shared/types/sprint';

/**
 * A row of the backlog list, or of a sprint's story list.
 *
 * ⭐ THIS IS A UNION ON PURPOSE, and collapsing it to one member would describe a
 * state the application never actually holds. The backlog's own rows arrive from the
 * story-list serializer as full stories, while a sprint's `user_stories` arrive from
 * the nested serializer as a strictly smaller shape (see the docblock on
 * {@link NestedSprintUserStory}). Dragging a story out of a sprint and into the
 * backlog moves that OBJECT between the two lists — `main.coffee:L558-L559` splices
 * the very same story it removed from `sprint.user_stories` straight into
 * `$scope.userstories` — so after a cross-container move both lists genuinely hold
 * a mixture until the next reload replaces them.
 *
 * Declaring only the full shape would have promised members the nested rows do not
 * have, and a component reading one of them would render nothing rather than fail.
 * Every member this reducer touches — `id`, `ref`, `project`, `milestone`,
 * `backlog_order`, `total_points` — is common to both, and `sprint_order` narrows to
 * `number | undefined`, which is the honest description of a story that may never
 * have been ordered inside a sprint.
 */
export type BacklogRowStory = BacklogUserStory | NestedSprintUserStory;

/**
 * A sprint as this screen holds it: the wire shape, with its story list widened to
 * {@link BacklogRowStory} for the reason given above. Nothing else about `Sprint`
 * changes, and in particular it still has no `version` — a sprint carries no
 * optimistic-concurrency token even though its nested stories do.
 */
export type BacklogSprint = Omit<Sprint, 'user_stories'> & {
    readonly user_stories: readonly BacklogRowStory[];
};

/**
 * One entry of the serialisation queue [main.coffee:L540-L546].
 *
 * The five leading members are the incumbent's entry verbatim, except that `usList`
 * holds story IDS rather than live objects. The incumbent could keep object
 * references because a story was one shared mutable object appearing in both lists at
 * once; a normalised store has one copy per list instead, so ids plus a lookup
 * reproduce that aliasing faithfully and cannot go stale.
 *
 * The four trailing members are the request-shaped scalars the incumbent re-derived
 * from its retained object references at dispatch time. Capturing them at enqueue is
 * sound because they are INVARIANT: `currentSprintId` [main.coffee:L533] evaluates to
 * the same value whether it is computed before or after the local mutation, in all
 * three of the to-sprint, to-backlog and same-container cases.
 *
 * `oldSprintId` is the one value that is NOT invariant, which is why both readings are
 * stored. A to-sprint move sets `us.milestone = newSprintId` at `main.coffee:L565`, so
 * an entry dispatched later by a drain reads the DESTINATION sprint as its "old"
 * sprint. That difference is observable in exactly one place: the closed-sprint
 * broadcast at `main.coffee:L639`.
 */
export interface PendingDragEntry {
    readonly usList: readonly number[];

    readonly newUsIndex: number;

    readonly newSprintId: number | null;

    /** The neighbour the drop landed AFTER. Serialises to `after_userstory_id`. */
    readonly previousUs: number | null;

    /** The neighbour the drop landed BEFORE. Serialises to `before_userstory_id`. */
    readonly nextUs: number | null;

    /** `usList[0].project` [main.coffee:L525]. */
    readonly projectId: number;

    /** `currentSprintId` [main.coffee:L533]. Serialises to `milestone_id`. */
    readonly milestoneId: number | null;

    /** `usList[0].milestone` as read BEFORE the local mutation [main.coffee:L524]. */
    readonly oldSprintId: number | null;

    /** The same reading as a queue drain would take, i.e. AFTER the local mutation. */
    readonly drainOldSprintId: number | null;
}

/**
 * The five arguments of `bulkUpdateBacklogOrder`, named as the typed facade in
 * `app/react/shared/api/userstories` names them.
 *
 * ⭐ THERE IS A NAME INVERSION ACROSS THIS SEAM, and wiring it crossed reverses every
 * drop. It is spelled out here so that nobody has to rediscover it:
 *
 *     backlog controller  →  api facade            →  wire key
 *     previousUs          →  afterUserstoryId      →  after_userstory_id
 *     nextUs              →  beforeUserstoryId     →  before_userstory_id
 *     currentSprintId     →  milestoneId           →  milestone_id
 *
 * ⭐ AFTER WINS. The resource layer is `if afterUserstoryId … else if
 * beforeUserstoryId` [resources/userstories.coffee:L99-L103], so supplying both sends
 * ONLY `after_userstory_id`, and supplying neither sends neither key.
 *
 * ⭐ THOSE CONDITIONALS TEST TRUTHINESS, NOT NULLISHNESS [resources/userstories.coffee:L96,
 * L99, L102]. An id of `0` therefore OMITS its key entirely. That is the frozen
 * contract, not an oversight: it must not be "improved" into a null check anywhere in
 * this pipeline. This request object consequently passes all five values through
 * UNFILTERED and lets the facade apply the rule in the one place it belongs.
 */
export interface BacklogOrderRequest {
    readonly projectId: number;

    readonly milestoneId: number | null;

    readonly afterUserstoryId: number | null;

    readonly beforeUserstoryId: number | null;

    readonly bulkUserstories: readonly number[];
}

/**
 * The reified closure of `promise.then` at `main.coffee:L611-L640`.
 *
 * The incumbent's success handler captured two things from the invocation that made
 * the request: the `usList` whose stories may be reconciled, and the `oldSprintId`
 * the closed-sprint check reads. Both are recorded here so that the success action
 * stays a pure function of state plus the server response.
 */
export interface InFlightMove {
    readonly usList: readonly number[];

    readonly oldSprintId: number | null;
}

/**
 * What a requested move actually did — the explicit, discriminable replacement for a
 * defect described under {@link BacklogAction}.
 *
 * `DISPATCH` means this move is the head of the queue and its request must be sent.
 * `QUEUED` means the move was recorded locally and deliberately NOT sent, because a
 * request is already in flight.
 */
export type MoveUsOutcome =
    | { readonly kind: 'DISPATCH'; readonly request: BacklogOrderRequest }
    | { readonly kind: 'QUEUED' };

/**
 * A pending `bulk-update-us-milestone` call [main.coffee:L799].
 *
 * ⛔ TRAP MS-2 — ITS BODY KEY IS `bulk_stories`, AND IT IS NOT `bulk_userstories`. The
 * two ORDER endpoints use `bulk_userstories` [resources/userstories.coffee:L94, L117]
 * while `bulkCreate`, `bulkUpdateMilestone` and the sprint facade's story move use
 * `bulk_stories` [:L68, :L109]. Conflating them is a silent HTTP 400 — the request
 * shape validates as an empty bulk rather than failing loudly at the call site. The
 * entry shape is exactly `BulkMilestoneItem` from `./types`, which is why the payload is
 * typed rather than assembled ad hoc. Reported to the Drift Register.
 */
export interface MilestoneMoveRequest {
    readonly projectId: number;

    readonly milestoneId: number;

    readonly data: readonly BulkMilestoneItem[];
}

/**
 * Side effects the reducer records and the hook performs, in the order recorded.
 *
 * The two `BROADCAST_` members map to `$rootScope.$broadcast` calls; the `LOAD_`
 * members map to the controller reloads; `DRAIN_PENDING_DRAG` is the deferred
 * re-drive that `main.coffee:L621` scheduled through `$applyAsync`, which in React is
 * simply the next dispatch. The reducer performs none of them itself.
 */
export type BacklogIntent =
    | 'BROADCAST_SPRINT_US_MOVED'
    | 'BROADCAST_LOAD_CLOSED_SPRINTS'
    | 'DRAIN_PENDING_DRAG'
    | 'LOAD_SPRINTS'
    | 'LOAD_CLOSED_SPRINTS'
    | 'LOAD_PROJECT_STATS'
    | 'TOGGLE_VELOCITY_FORECASTING'
    | 'CALCULATE_FORECASTING';

/**
 * A row of the `bulk-update-us-backlog-order` response, declared locally because the
 * typed facade that also describes it is not a dependency of this file.
 *
 * The union is DISCRIMINATED ON `milestone`: omit a milestone from the request and the
 * server renumbers `backlog_order` and answers with `milestone: null`; supply one and
 * it renumbers `sprint_order` instead. Which branch arrives is therefore a property of
 * the request, and narrowing on `milestone` is what keeps the reconciliation from
 * reading an order member that is absent.
 */
export interface BacklogOrderedRow {
    readonly id: number;

    readonly milestone: null;

    readonly backlog_order: UserStory['backlog_order'];
}

/** The sprint-reorder answer: `sprint_order` renumbered, and no `backlog_order`. */
export interface SprintOrderedRow {
    readonly id: number;

    readonly milestone: number;

    readonly sprint_order: number;
}

export type BacklogOrderResultRow = BacklogOrderedRow | SprintOrderedRow;

/**
 * Everything the backlog screen holds, replacing the `$scope` members listed at
 * `main.coffee:L82-L86` plus the controller state the drag path and the selection path
 * used to keep in closures and in the DOM.
 */
export interface BacklogState {
    /** `$scope.userstories` [main.coffee:L82]. Ordered as rendered. */
    readonly userStories: readonly BacklogRowStory[];

    /** `$scope.sprints`. Index 0 is the "latest" sprint every move-to-sprint targets. */
    readonly sprints: readonly BacklogSprint[];

    /**
     * `$scope.closedSprints`.
     *
     * ⭐ `null` MEANS "NOT LOADED YET", AND IS NOT THE SAME AS THE EMPTY LIST. The
     * incumbent guards with `if @scope.closedSprintsById && …` [main.coffee:L639]
     * precisely because that map is undefined until the closed sprints are fetched, so
     * flattening the two states into one empty array would make an unloaded screen
     * indistinguishable from a project with no closed sprints.
     */
    readonly closedSprints: readonly BacklogSprint[] | null;

    /** `$scope.currentSprint`'s id, read by the move-to-current-sprint action [main.coffee:L808]. */
    readonly currentSprintId: number | null;

    /**
     * `events.connected`.
     *
     * ⭐ REFERENCED AT EXACTLY ONE SITE IN THE WHOLE INCUMBENT [main.coffee:L634],
     * which is why the reload fallback it guards is so easy to drop on the floor.
     */
    readonly eventsConnected: boolean;

    /** `$scope.visibleUserStories` [main.coffee:L597-L598]: the backlog rows' refs. */
    readonly visibleUserStories: readonly number[];

    /** `@.pendingDrag` [main.coffee:L84]. FIFO; index 0 is the only entry ever on the wire. */
    readonly pendingDrag: readonly PendingDragEntry[];

    /** Non-null while a reorder request is outstanding. See {@link InFlightMove}. */
    readonly inFlightMove: InFlightMove | null;

    /** One-shot mailbox: what the last requested move decided. See {@link MoveUsOutcome}. */
    readonly moveUsOutcome: MoveUsOutcome | null;

    /** One-shot mailbox for `bulk-update-us-milestone`. See {@link MilestoneMoveRequest}. */
    readonly milestoneMoveRequest: MilestoneMoveRequest | null;

    /** One-shot, ORDER-SIGNIFICANT mailbox of side effects. See {@link BacklogIntent}. */
    readonly intents: readonly BacklogIntent[];

    /**
     * Selection facet 1 of 3: the checkbox's own `checked` state, which the incumbent
     * read straight back out of the DOM with
     * `$el.find(".backlog-table-body input:checkbox:checked")` [main.coffee:L771, L826].
     */
    readonly checkedIds: Readonly<Record<number, boolean>>;

    /**
     * Selection facet 2 of 3: the `is-checked` class on `.us-item-row`, toggled at
     * `main.coffee:L859` for the DIRECTLY CLICKED row only.
     */
    readonly isCheckedIds: Readonly<Record<number, boolean>>;

    /**
     * Selection facet 3 of 3: the `ui-multisortable-multiple` class, toggled inside
     * `checkSelected` at `main.coffee:L824`.
     *
     * ⛔ THE THREE FACETS ARE SEPARATE BECAUSE THEY GENUINELY DRIFT APART, and merging
     * them into one set of selected ids would quietly FIX that drift — which is a
     * behaviour change, not a clean-up. The class names are the existing stylesheet
     * contract and are applied by the components from this state.
     */
    readonly multiSelectedIds: Readonly<Record<number, boolean>>;

    /** The shift key's state [main.coffee:L819]. See the note on the listener below. */
    readonly shiftPressed: boolean;

    /** The shift-range anchor [main.coffee:L820], reassigned inside `checkSelected` [:L823]. */
    readonly lastCheckedId: number | null;

    /**
     * Whether the move-to-sprint control is showing, recomputed on every selection
     * change from `checked.length > 0 and sprints.length > 0` [main.coffee:L826-L831]
     * and forced off after a successful move [:L805].
     */
    readonly moveToSprintVisible: boolean;
}

/** The subset of {@link BacklogState} the bridge supplies. Every member is optional. */
export interface BacklogHydration {
    readonly userStories?: readonly BacklogRowStory[];

    readonly sprints?: readonly BacklogSprint[];

    readonly closedSprints?: readonly BacklogSprint[] | null;

    readonly currentSprintId?: number | null;

    readonly eventsConnected?: boolean;
}

/**
 * A user-initiated move: the drag the sortable layer completed, or the row action that
 * sends a story to the top of the backlog.
 *
 * ⭐ THIS IS WHERE THE INCUMBENT'S `ctx` ARGUMENT WENT. `ctx`
 * [main.coffee:L523] was inspected for TRUTHINESS ONLY, at exactly two sites — the
 * enqueue at `:L539` and the re-entrancy guard at `:L600` — and it arrived as three
 * unrelated things: an AngularJS event object (from `$scope.$on("sprint:us:move",
 * @.moveUs)` [:L215]), the literal string `"sprint:us:move"` (from `:L519` and from
 * `app/coffee/modules/backlog/sortable.coffee:L143`), or the literal `null` from the
 * queue-drain re-drive at `:L623`.
 *
 * Passing `null` bypassed BOTH the enqueue AND the guard, and that double bypass is the
 * whole mechanism by which a drain step drives a request without re-queueing itself or
 * being blocked. Modelling it as one action with a flag would let a caller forget the
 * flag, so the two intents are two ACTION KINDS instead:
 * `MOVE_US_REQUESTED` / `MOVE_US_TO_TOP_REQUESTED` are user-initiated, and
 * `PENDING_DRAG_DRAIN` is internal. Nothing framework-shaped is ever smuggled in: an
 * AngularJS event object inside an immer draft would break both the draft and the
 * browserless testability this reducer exists to provide.
 */
export interface MoveUsRequestedAction {
    readonly type: 'MOVE_US_REQUESTED';

    /** Story ids in drag order. The incumbent's `usList` [main.coffee:L523]. */
    readonly usList: readonly number[];

    readonly newUsIndex: number;

    /** The destination sprint, or `null` for the backlog. */
    readonly newSprintId: number | null;

    readonly previousUs: number | null;

    readonly nextUs: number | null;
}

export type BacklogAction =
    | ({ readonly type: 'HYDRATE' } & BacklogHydration)

    | { readonly type: 'SET_USER_STORIES'; readonly userStories: readonly BacklogRowStory[] }
    | { readonly type: 'SET_SPRINTS'; readonly sprints: readonly BacklogSprint[] }
    | { readonly type: 'SET_CLOSED_SPRINTS'; readonly closedSprints: readonly BacklogSprint[] }
    | { readonly type: 'SET_CURRENT_SPRINT'; readonly currentSprintId: number | null }
    | { readonly type: 'SET_EVENTS_CONNECTED'; readonly eventsConnected: boolean }

    | MoveUsRequestedAction
    | { readonly type: 'MOVE_US_TO_TOP_REQUESTED'; readonly usList: readonly number[] }
    | { readonly type: 'PENDING_DRAG_DRAIN' }
    | { readonly type: 'MOVE_US_SUCCEEDED'; readonly rows: readonly BacklogOrderResultRow[] }
    | { readonly type: 'CONSUME_MOVE_US_OUTCOME' }
    | { readonly type: 'CONSUME_INTENTS' }

    | { readonly type: 'SET_SHIFT_PRESSED'; readonly shiftPressed: boolean }
    | { readonly type: 'TOGGLE_ROW_CHECKBOX'; readonly storyId: number }

    | { readonly type: 'MOVE_SELECTED_TO_SPRINT'; readonly target: 'current' | 'latest' }
    | { readonly type: 'CONSUME_MILESTONE_MOVE_REQUEST' }
    | { readonly type: 'MILESTONE_MOVE_SUCCEEDED' };

type BacklogDraft = Draft<BacklogState>;

type SprintDraft = BacklogDraft['sprints'][number];

type RowStoryDraft = BacklogDraft['userStories'][number];

/**
 * Hands freshly-built plain data to a draft slot. The state type is deeply readonly by
 * design, and a draft's slots are not, so the conversion has to be stated once here
 * rather than at every assignment.
 */
function toDraft<T>(value: T): Draft<T> {
    return value as Draft<T>;
}

/**
 * `@scope.sprintsById[id] || @scope.closedSprintsById[id]` [main.coffee:L527-L528, L530-L531]:
 * OPEN SPRINTS FIRST, then closed ones.
 *
 * The incumbent could throw here — the second lookup dereferences a map that is
 * undefined until the closed sprints load — so this returns `undefined` instead of
 * reproducing a crash, which is the only difference and affects nothing else.
 */
function findSprintDraft(draft: BacklogDraft, sprintId: number | null): SprintDraft | undefined {
    if (sprintId === null) {
        return undefined;
    }

    return (
        draft.sprints.find((sprint) => sprint.id === sprintId) ??
        draft.closedSprints?.find((sprint) => sprint.id === sprintId)
    );
}

/**
 * Every sprint, open then closed. The spread copies the ARRAY, not the sprints, so the
 * elements are still the same drafts and mutating one still registers.
 */
function allSprintDrafts(draft: BacklogDraft): SprintDraft[] {
    return draft.closedSprints ? [...draft.sprints, ...draft.closedSprints] : [...draft.sprints];
}

/**
 * Every story the screen holds, backlog rows first and then each sprint's rows.
 *
 * A normalised store keeps one copy per list where the incumbent kept a single shared
 * mutable object appearing in two lists at once, so the two functions below stand in for
 * that aliasing: one picks the copy a move is about, the other writes them all.
 */
function allStoryDrafts(draft: BacklogDraft): RowStoryDraft[] {
    return [
        ...draft.userStories,
        ...allSprintDrafts(draft).flatMap((sprint) => sprint.user_stories),
    ];
}

/** The backlog copy of a story if it has one, otherwise its copy inside a sprint. */
function findStoryAnywhere(draft: BacklogDraft, storyId: number | undefined): RowStoryDraft | undefined {
    return storyId === undefined
        ? undefined
        : allStoryDrafts(draft).find((story) => story.id === storyId);
}

/**
 * Visits EVERY copy of a story. The incumbent wrote `us.milestone = …` once and both
 * views changed because both views were the same object; writing both copies here is
 * observably identical.
 */
function eachStoryCopy(
    draft: BacklogDraft,
    storyId: number,
    visit: (story: RowStoryDraft) => void,
): void {
    allStoryDrafts(draft)
        .filter((story) => story.id === storyId)
        .forEach(visit);
}

/**
 * `_.remove list, (it) -> it.id == <one of ids>` [main.coffee:L551, L556, L562, L584].
 *
 * Walks backwards so that removing an element cannot skip the next one, and tolerates
 * ids that are not present — which the incumbent's `_.remove` also did.
 */
function removeIds(list: { readonly id: number }[], ids: readonly number[]): void {
    for (let index = list.length - 1; index >= 0; index -= 1) {
        if (ids.includes(list[index].id)) {
            list.splice(index, 1);
        }
    }
}

/**
 * `(acc, num) -> acc + num` over story points [main.coffee:L786].
 *
 * `total_points` is `null` for an unestimated story, and the incumbent added those
 * nulls with `+`, which coerces them to zero. `Number` reproduces that coercion
 * exactly while keeping the arithmetic typed, and it also preserves the `NaN` that a
 * missing total is supposed to produce — see the note on `MOVE_SELECTED_TO_SPRINT`.
 */
function addPoints(accumulator: number | null, points: number | null): number {
    return Number(accumulator) + Number(points);
}

/**
 * The checked stories in RENDERED ROW ORDER, which is what
 * `$el.find(".backlog-table-body input:checkbox:checked")` [main.coffee:L771, L826]
 * returned: a selector match is yielded in rendered order.
 */
function checkedIdsInRowOrder(draft: BacklogDraft): number[] {
    return draft.userStories.filter((story) => draft.checkedIds[story.id]).map((story) => story.id);
}

/**
 * `checkSelected` [main.coffee:L822-L831], reproduced in its original order.
 *
 * ⛔ PRESERVED DEFECT SEL-2 [main.coffee:L823] — the shift-range ANCHOR IS REASSIGNED
 * HERE, inside `checkSelected`, rather than only in the change handler. Because the
 * range loop calls this function once per row [:L856] and the clicked row calls it last
 * [:L860], the anchor after every change event is the CLICKED row, never the row the user
 * originally anchored on. Consecutive shift-clicks therefore measure their range from
 * the previous click. Preserved per T10. Reported to the Drift Register.
 *
 * The class toggle at `:L824` is a TOGGLE, not a set, which is the other half of SEL-1.
 */
function applyCheckSelected(draft: BacklogDraft, storyId: number): void {
    draft.lastCheckedId = storyId;
    draft.multiSelectedIds[storyId] = !draft.multiSelectedIds[storyId];
    draft.moveToSprintVisible = checkedIdsInRowOrder(draft).length > 0 && draft.sprints.length > 0;
}

/**
 * The rows `lastChecked.nextUntil(current)` / `lastChecked.prevUntil(current)` selected
 * [main.coffee:L845-L851].
 *
 * ⭐ BOTH ENDPOINTS ARE EXCLUDED. `nextUntil` and `prevUntil` stop BEFORE the element
 * they are given and never include the element they start from, so neither the anchor
 * nor the clicked row is part of the range; the clicked row is handled separately at
 * `:L858-L860`. Clicking the anchor itself matches neither `nextAll` nor `prevAll`
 * [:L848, :L850] and selects nothing.
 *
 * `prevUntil` walks away from the anchor, so the backwards range is returned in reverse
 * document order to match. Order is not observable in the resulting state — the facet
 * updates are per-row toggles and the anchor is overwritten at `:L860` — but reproducing
 * it costs nothing and removes a question.
 *
 * ⭐ The incumbent walked DOM SIBLINGS, which also include the doom-line divider that
 * `main.coffee:L755` splices between rows. That element carries no checkbox, so the
 * incumbent's per-element work degenerated to a no-op on it. An id-keyed model has no
 * such sibling at all, which is why the divider needs no representation here.
 */
function shiftRangeIds(draft: BacklogDraft, anchorId: number, currentId: number): number[] {
    const rows = draft.userStories;
    const anchor = rows.findIndex((story) => story.id === anchorId);
    const current = rows.findIndex((story) => story.id === currentId);

    if (anchor < 0 || current < 0) {
        return [];
    }

    if (current > anchor) {
        return rows.slice(anchor + 1, current).map((story) => story.id);
    }

    return rows
        .slice(current + 1, anchor)
        .reverse()
        .map((story) => story.id);
}

/**
 * The optimistic local move, reproducing `main.coffee:L548-L595` branch for branch.
 *
 * It runs ONLY for a user-initiated move, because the incumbent nested the whole block
 * inside `if ctx` [:L539]. A queue drain re-sends a request for a move whose local
 * effect has already been applied, so re-applying it would move the story twice.
 *
 * ⛔ PRESERVED DEFECT MU-1 [main.coffee:L590-L591] — the `else if nextUs` branch
 * compares `previousUs` instead of `nextUs`, a copy-paste of the branch above it. Since
 * that branch is only reached when `previousUs` is falsy, the comparison can never
 * match, `findIndex` returns -1, and the increment at `:L593` turns it into 0.
 * `moveUsToTopOfBacklog` [:L519] DEPENDS ON THAT ACCIDENT: it passes
 * `previousUs = null` with `nextUs = <first story id>` and gets position 0 out of it, so
 * "fixing" the comparison would break move-to-top. Reproduced exactly per T10. Reported
 * to the Drift Register.
 *
 * The same arithmetic has a third case worth naming, because it looks like a bug and is
 * not one to touch: with BOTH neighbours falsy neither branch runs, `position` keeps the
 * 0 it was initialised with at `:L586`, and the increment makes it 1 — so such a move
 * inserts at index 1 rather than at the head.
 */
function applyLocalMove(draft: BacklogDraft, entry: PendingDragEntry): void {
    const { usList, newUsIndex, newSprintId, previousUs, nextUs, oldSprintId } = entry;

    // Resolved BEFORE the removals below, because a removed story is no longer findable.
    // These stand in for the objects the incumbent held by reference for the whole
    // transition.
    const moved = usList
        .map((storyId) => findStoryAnywhere(draft, storyId))
        .filter((story): story is RowStoryDraft => story !== undefined);

    if (newSprintId !== oldSprintId) {
        const sprint = findSprintDraft(draft, oldSprintId);

        // [:L549-L552], and then again at [:L555-L556] for the to-backlog case. The
        // incumbent really does write the same removal twice; the second pass is a no-op
        // because the first already emptied the match, so one call is equivalent.
        if (sprint) {
            removeIds(sprint.user_stories, usList);
        }

        if (newSprintId === null) {
            // Sprint → backlog [:L558-L559]. Note `newUsIndex + index`, which keeps a
            // multi-story drag in its original relative order.
            moved.forEach((story, index) => draft.userStories.splice(newUsIndex + index, 0, story));

            return;
        }

        const newSprint = findSprintDraft(draft, newSprintId);

        if (!newSprint) {
            return;
        }

        removeIds(draft.userStories, usList); // [:L561-L562]

        moved.forEach((story) => {
            story.milestone = newSprintId; // [:L565]

            // ⭐ PRESERVED ASYMMETRY [:L566] — every story is spliced at the SAME
            // `newUsIndex`, with no `+ index`, unlike the to-backlog branch above. A
            // multi-story drag into a sprint therefore lands in REVERSED relative order.
            // Preserved per T10; the server renumbers `sprint_order` on the reply anyway.
            newSprint.user_stories.splice(newUsIndex, 0, story);
        });

        // ⛔ PRESERVED DEFECT MU-3 [main.coffee:L575-L576] — `@scope.sprints.map (sprint)
        // -> Object.assign(sprint)` calls `Object.assign` WITH A SINGLE ARGUMENT, which
        // returns the very same reference; only the surrounding `.map` produced a new
        // array identity, and the two-argument `Object.assign` just above it [:L568-L573]
        // mutated its target in place and assigned the result back over itself. The whole
        // sequence was reaching for the new object identities that a change detector needs.
        // immer's structural sharing produces exactly those identities for the sprint that
        // was touched and preserves them for every sprint that was not, so there is
        // nothing left to reproduce and no second argument to "restore" — it never
        // existed. Reported to the Drift Register.
        return;
    }

    // Same container: reorder within one sprint, or within the backlog [:L577-L595].
    const targetList =
        newSprintId === null
            ? draft.userStories
            : findSprintDraft(draft, newSprintId)?.user_stories;

    if (!targetList) {
        return;
    }

    removeIds(targetList, usList); // [:L583-L584]

    let position = 0; // [:L586]

    if (previousUs) {
        position = targetList.findIndex((story) => story.id === previousUs); // [:L588-L589]
    } else if (nextUs) {
        position = targetList.findIndex((story) => story.id === previousUs); // [:L590-L591] MU-1
    }

    position += 1; // [:L593]

    moved.forEach((story, index) => targetList.splice(position + index, 0, story)); // [:L594-L595]
}

/**
 * Puts the queue's head on the wire [main.coffee:L603-L609] and records the closure the
 * success handler will need.
 *
 * `oldSprintId` is passed in rather than read from the entry because the incumbent read
 * it from the invocation that made the request: the pre-mutation value when a
 * user-initiated move dispatched immediately, and the post-mutation value when a drain
 * dispatched the same entry later. See {@link PendingDragEntry}.
 */
function dispatchEntry(draft: BacklogDraft, entry: PendingDragEntry, oldSprintId: number | null): void {
    draft.inFlightMove = { usList: [...entry.usList], oldSprintId };

    draft.moveUsOutcome = {
        kind: 'DISPATCH',
        request: {
            projectId: entry.projectId,
            milestoneId: entry.milestoneId,
            afterUserstoryId: entry.previousUs,
            beforeUserstoryId: entry.nextUs,
            bulkUserstories: [...entry.usList],
        },
    };
}

/**
 * `moveUs` for a USER-INITIATED move [main.coffee:L523-L609 with `ctx` truthy].
 *
 * ⛔ PRESERVED DEFECT MU-2 [main.coffee:L600-L601] — the incumbent's re-entrancy guard
 * is a bare `return`, so it hands back `undefined`; `moveUsToTopOfBacklog` [:L519]
 * returns that value and its callers at `:L163` and `:L182` chain `.then()` on it,
 * producing a TypeError that the AngularJS digest swallows. The BEHAVIOUR is preserved
 * exactly — the drag is recorded locally and deliberately not sent — but the outcome is
 * surfaced as an explicit typed {@link MoveUsOutcome} so that a React caller branches on
 * `kind` instead of dereferencing nothing and repeating the crash. Reported to the Drift
 * Register.
 */
function applyMoveUs(
    draft: BacklogDraft,
    usList: readonly number[],
    newUsIndex: number,
    newSprintId: number | null,
    previousUs: number | null,
    nextUs: number | null,
): void {
    const head = findStoryAnywhere(draft, usList[0]);

    // The incumbent read `usList[0].milestone` unguarded [:L524] and could only ever be
    // handed a live story, so an empty or stale list was unreachable there. Returning is
    // the totality this reducer needs and changes nothing that was reachable before.
    if (!head) {
        return;
    }

    const oldSprintId = head.milestone;

    const entry: PendingDragEntry = {
        usList: [...usList],
        newUsIndex,
        newSprintId,
        previousUs,
        nextUs,
        projectId: head.project, // [:L525]
        milestoneId: newSprintId !== oldSprintId ? newSprintId : oldSprintId, // [:L533]
        oldSprintId,
        // A to-sprint move rewrites `us.milestone` at [:L565]; every other case leaves it.
        drainOldSprintId: newSprintId !== oldSprintId && newSprintId !== null ? newSprintId : oldSprintId,
    };

    draft.pendingDrag.push(toDraft(entry)); // [:L539-L546]

    applyLocalMove(draft, entry);

    draft.visibleUserStories = draft.userStories.map((story) => story.ref); // [:L597-L598]

    // ⭐⭐ THE RE-ENTRANCY GUARD [:L600-L601]. Queued, not dispatched: only the head of
    // the queue is ever on the wire, which is the entire defence against the
    // position-relative corruption described at the top of this file.
    if (draft.pendingDrag.length > 1) {
        draft.moveUsOutcome = { kind: 'QUEUED' };

        return;
    }

    dispatchEntry(draft, entry, oldSprintId);
}

/**
 * `BacklogController`'s constructor, reduced to the members this reducer owns
 * [main.coffee:L82-L86].
 *
 * ⭐ `swimlanesList` IS ABSENT ON PURPOSE. `main.coffee:L86` is the ONE
 * immutable-collection value in that controller, and it stays there: its `push` returns a
 * NEW COLLECTION where an array's `push` returns the NEW LENGTH, so a naive conversion of
 * the consumer at `:L302` would have assigned a number to the list and broken the screen
 * silently. It is flattened to a plain array at the bridge seam instead, and this file
 * never imports that package — it remains installed for the many out-of-scope screens
 * that still use it.
 */
export function createInitialBacklogState(params: BacklogHydration = {}): BacklogState {
    return {
        userStories: params.userStories ? [...params.userStories] : [],
        sprints: params.sprints ? [...params.sprints] : [],
        closedSprints: params.closedSprints ? [...params.closedSprints] : null,
        currentSprintId: params.currentSprintId ?? null,
        eventsConnected: params.eventsConnected ?? false,
        visibleUserStories: [],
        pendingDrag: [], // [:L84]
        inFlightMove: null,
        moveUsOutcome: null,
        milestoneMoveRequest: null,
        intents: [],
        checkedIds: {},
        isCheckedIds: {},
        multiSelectedIds: {},
        shiftPressed: false, // [:L819]
        lastCheckedId: null, // [:L820]
        moveToSprintVisible: false,
    };
}

/**
 * The backlog state machine. Mutates the draft; returns nothing.
 *
 * Compose it with immer's curried `produce` — see this file's module docblock. The switch
 * is exhaustive over {@link BacklogAction} and its default binds the action to `never`, so
 * adding a member to the union without handling it here is a COMPILE ERROR rather than a
 * silently ignored dispatch.
 */
export function backlogReducer(draft: BacklogDraft, action: BacklogAction): void {
    switch (action.type) {

        case 'HYDRATE': {
            if (action.userStories) {
                draft.userStories = toDraft([...action.userStories]);
            }

            if (action.sprints) {
                draft.sprints = toDraft([...action.sprints]);
            }

            if (action.closedSprints !== undefined) {
                draft.closedSprints = action.closedSprints
                    ? toDraft([...action.closedSprints])
                    : null;
            }

            if (action.currentSprintId !== undefined) {
                draft.currentSprintId = action.currentSprintId;
            }

            if (action.eventsConnected !== undefined) {
                draft.eventsConnected = action.eventsConnected;
            }

            return;
        }

        case 'SET_USER_STORIES': {
            draft.userStories = toDraft([...action.userStories]);

            return;
        }

        case 'SET_SPRINTS': {
            draft.sprints = toDraft([...action.sprints]);

            return;
        }

        case 'SET_CLOSED_SPRINTS': {
            // Assigning a list is what takes this out of the "not loaded yet" state; see
            // the note on {@link BacklogState.closedSprints}.
            draft.closedSprints = toDraft([...action.closedSprints]);

            return;
        }

        case 'SET_CURRENT_SPRINT': {
            draft.currentSprintId = action.currentSprintId;

            return;
        }

        case 'SET_EVENTS_CONNECTED': {
            draft.eventsConnected = action.eventsConnected;

            return;
        }

        case 'MOVE_US_REQUESTED': {
            applyMoveUs(
                draft,
                action.usList,
                action.newUsIndex,
                action.newSprintId,
                action.previousUs,
                action.nextUs,
            );

            return;
        }

        case 'MOVE_US_TO_TOP_REQUESTED': {
            // `moveUsToTopOfBacklog` [main.coffee:L511-L521]. An empty backlog is a no-op
            // there too — it returns an already-resolved promise at `:L521` without
            // touching the queue. The incumbent's array wrap at `:L512-L513` is unnecessary
            // here because the action type already requires a list, and its `us = uss[0]`
            // at `:L515` was dead.
            const first = draft.userStories[0];

            if (!first) {
                return;
            }

            // `:L519` passes `newUsIndex = 0`, no destination sprint and no `previousUs`,
            // relying on MU-1 to turn `nextUs` into position 0.
            applyMoveUs(draft, action.usList, 0, null, null, first.id);

            return;
        }

        case 'PENDING_DRAG_DRAIN': {
            // The `null`-`ctx` re-drive [main.coffee:L620-L629]. It must neither enqueue
            // nor consult the guard, which is why it is its own action kind and why it goes
            // straight to `dispatchEntry`.
            const head = draft.pendingDrag[0];

            if (!head) {
                return;
            }

            dispatchEntry(draft, head, head.drainOldSprintId);

            return;
        }

        case 'MOVE_US_SUCCEEDED': {
            const inFlight = draft.inFlightMove;

            if (!inFlight) {
                return;
            }

            // ⭐ RECONCILIATION [main.coffee:L611-L617]. THE SERVER IS THE AUTHORITY ON
            // ORDERING, and skipping this because the story was already moved locally is
            // how a client-side ordering starts drifting from the persisted one. Only the
            // stories of the dispatched `usList` are reconciled, matched by id, exactly as
            // the incumbent's nested loops did.
            //
            // ⭐ DOCUMENTED DEVIATION DEV-1 — the incumbent assigns `updatedUs.backlog_order`
            // unconditionally, but a SPRINT reorder answers with `sprint_order` and no
            // `backlog_order`, so that assignment stores `undefined` into a required numeric
            // field. `backlog_order` is therefore written only from a backlog row, which the
            // union's `milestone` discriminant identifies. `milestone` is always written,
            // as the incumbent does. A story sitting inside a sprint has no backlog position
            // to read until it returns to the backlog, by which point a reload or a later
            // reconciliation has supplied one, so nothing observable changes. Reported to
            // the Drift Register.
            action.rows.forEach((row) => {
                if (!inFlight.usList.includes(row.id)) {
                    return;
                }

                eachStoryCopy(draft, row.id, (story) => {
                    story.milestone = row.milestone;

                    if (row.milestone === null) {
                        story.backlog_order = row.backlog_order;
                    }
                });
            });

            draft.pendingDrag.shift(); // [:L618]
            draft.inFlightMove = null;
            draft.moveUsOutcome = null;

            if (draft.pendingDrag.length) {
                // [:L620-L621] deferred the re-drive through `$applyAsync`; in React the
                // deferral is simply the hook's next dispatch.
                draft.intents.push('DRAIN_PENDING_DRAG');

                return;
            }

            // ⭐⭐ EVERYTHING BELOW IS GATED ON THE QUEUE BEING EMPTY. In the incumbent the
            // `else` at `:L630` opens at indent depth 12 while the two blocks at `:L634` and
            // `:L639` sit at depth 16, i.e. INSIDE it — so neither the reload fallback nor
            // the closed-sprint broadcast fires on an intermediate drain iteration.
            draft.intents.push('BROADCAST_SPRINT_US_MOVED'); // [:L631]

            // [:L633] "taiga events will refresh the backlog if it's available".
            // ⭐ THREE reload calls [:L635-L637], not one.
            if (!draft.eventsConnected) {
                draft.intents.push('LOAD_SPRINTS', 'LOAD_CLOSED_SPRINTS', 'LOAD_PROJECT_STATS');
            }

            // [:L639] `if @scope.closedSprintsById && @scope.closedSprintsById[oldSprintId]`
            // — both halves preserved: an unloaded closed-sprint list checks nothing, and a
            // `null` old sprint matches nothing.
            if (
                draft.closedSprints !== null &&
                draft.closedSprints.some((sprint) => sprint.id === inFlight.oldSprintId)
            ) {
                draft.intents.push('BROADCAST_LOAD_CLOSED_SPRINTS'); // [:L640]
            }

            return;
        }

        case 'CONSUME_MOVE_US_OUTCOME': {
            // ⭐ THE QUEUE IS NOT TOUCHED HERE. The head stays in place for as long as its
            // request is outstanding, because `pendingDrag.length` is what the guard reads;
            // only `MOVE_US_SUCCEEDED` shifts it. The incumbent has no rejection handler at
            // all, so a request that fails leaves its entry at the head and every later drag
            // is queued and never sent. That is preserved rather than repaired: inventing a
            // recovery path would be a functional change, and the reducer stays total over
            // its inputs regardless.
            draft.moveUsOutcome = null;

            return;
        }

        case 'CONSUME_INTENTS': {
            draft.intents = [];

            return;
        }

        case 'SET_SHIFT_PRESSED': {
            // `$(window).on "keydown.shift-pressed keyup.shift-pressed"` [main.coffee:L834-L837]
            // set this from `!!event.shiftKey`.
            //
            // ⛔ PRESERVED DEFECT SEL-3, DELIBERATELY NOT CARRIED ACROSS — that listener is
            // never unbound, so every visit to the backlog leaves another one attached to
            // `window`. The BEHAVIOUR is reproduced (this flag), but the leak is not: the
            // React listener belongs in a hook whose `useEffect` returns a cleanup, and
            // importing an uncleaned global listener would be importing a defect class the
            // migration must not carry. Recorded as a documented deviation in the Drift
            // Register rather than as a silent fix.
            draft.shiftPressed = action.shiftPressed;

            return;
        }

        case 'TOGGLE_ROW_CHECKBOX': {
            // The `change` handler on a row checkbox [main.coffee:L840-L860], in its original
            // order: the browser has already flipped the checkbox by the time `change` fires,
            // then the shift range is applied, then the clicked row's own two updates.
            draft.checkedIds[action.storyId] = !draft.checkedIds[action.storyId];

            if (draft.lastCheckedId !== null && draft.shiftPressed) { // [:L842]
                // ⛔ PRESERVED DEFECT SEL-1 [main.coffee:L853-L856] — the range path sets
                // `checked` idempotently at `:L855` and then TOGGLES
                // `ui-multisortable-multiple` through `checkSelected` at `:L856`, but it
                // NEVER touches `is-checked`. Two consequences are reproduced verbatim:
                // range rows end up checked with `is-checked` absent, and a range row that
                // already carried `ui-multisortable-multiple` has it REMOVED while its
                // checkbox stays checked. Collapsing the three facets into one selection set
                // would fix this, which is precisely why they are three. Reported to the
                // Drift Register.
                shiftRangeIds(draft, draft.lastCheckedId, action.storyId).forEach((storyId) => {
                    draft.checkedIds[storyId] = true;
                    applyCheckSelected(draft, storyId);
                });
            }

            draft.isCheckedIds[action.storyId] = !draft.isCheckedIds[action.storyId]; // [:L859]
            applyCheckSelected(draft, action.storyId); // [:L860]

            return;
        }

        case 'MOVE_SELECTED_TO_SPRINT': {
            // `moveUssToSprint` [main.coffee:L779-L805], reached through `moveToCurrentSprint`
            // [:L807-L810] or `moveToLatestSprint` [:L812-L813].
            const firstSprint = draft.sprints[0];

            // The incumbent dereferenced `$scope.sprints[0].id` [:L776] without a guard, and
            // the control that reaches it is only shown when `sprints.length > 0`
            // [:L826-L831], so this branch was unreachable there.
            if (!firstSprint) {
                return;
            }

            const selectedIds = checkedIdsInRowOrder(draft); // [:L771]
            const selected = selectedIds
                .map((storyId) => findStoryAnywhere(draft, storyId))
                .filter((story): story is RowStoryDraft => story !== undefined);

            // ⛔ PRESERVED DEFECT MS-3 [main.coffee:L776, L799] — the target sprint is
            // hardcoded to `sprints[0]` in both the milestone the stories are stamped with
            // and the sprint the request is addressed to, IGNORING the `sprint` argument that
            // `moveToCurrentSprint` [:L808] took the trouble to resolve. So "move to current
            // sprint" updates the CURRENT sprint's local totals while persisting the stories
            // into the LATEST sprint. Preserved per T10. Reported to the Drift Register.
            selected.forEach((story) => {
                story.milestone = firstSprint.id;
            });

            const target =
                action.target === 'current'
                    ? findSprintDraft(draft, draft.currentSprintId) ?? firstSprint
                    : firstSprint;

            removeIds(draft.userStories, selectedIds); // [:L783]

            const extraPoints = selected.map((story) => story.total_points); // [:L785]

            // ⛔ PRESERVED DEFECT MS-1 [main.coffee:L786] — `_.reduce` is called WITHOUT A
            // SEED, so an empty selection reduces to `undefined`, and the `+=` at `:L792`
            // then turns the sprint's total into `NaN`. Adding a `0` seed would repair it and
            // is therefore forbidden (T10); the `undefined` is produced explicitly here and
            // allowed to propagate through the arithmetic below. Reported to the Drift
            // Register.
            const totalExtraPoints =
                extraPoints.length === 0 ? undefined : extraPoints.reduce(addPoints);

            // `_.union` [:L789] appends only stories the sprint does not already hold.
            selected.forEach((story) => {
                if (!target.user_stories.some((existing) => existing.id === story.id)) {
                    target.user_stories.push(story);
                }
            });

            // [:L792]. `Number` reproduces `+=`'s coercion exactly: a `null` total counts as
            // zero, and an `undefined` addend yields NaN — which is MS-1 becoming visible.
            target.total_points = Number(target.total_points) + Number(totalExtraPoints);

            draft.milestoneMoveRequest = {
                // The incumbent reads `$scope.project.id` [:L799]; a sprint carries the same
                // project id, so it is taken from there rather than duplicating project state.
                projectId: firstSprint.project,
                milestoneId: firstSprint.id,
                // [:L794-L798] — exactly `BulkMilestoneItem`, whose wire key is `bulk_stories`.
                //
                // ⭐ DOCUMENTED DEVIATION DEV-2 — the incumbent reads `us.sprint_order`, which
                // a story that has never been ordered inside a sprint does not have, and the
                // serialiser then DROPS the key; both members are required integers on the
                // endpoint's validator, so that request is rejected outright. `./types.ts`
                // records this as a latent defect not to reproduce and directs producers to
                // compute or narrow the order first, which is done here with the least
                // inventive value available: `0`, the same "unordered" position the model
                // itself defaults to. Reported to the Drift Register.
                data: selected.map((story) => ({
                    us_id: story.id,
                    order: typeof story.sprint_order === 'number' ? story.sprint_order : 0,
                })),
            };

            draft.moveToSprintVisible = false; // [:L805]

            return;
        }

        case 'CONSUME_MILESTONE_MOVE_REQUEST': {
            draft.milestoneMoveRequest = null;

            return;
        }

        case 'MILESTONE_MOVE_SUCCEEDED': {
            // The four calls the incumbent made inside the `.then()` [main.coffee:L800-L803],
            // in their original order. They are post-success, which is why they are not
            // recorded when the request is built.
            draft.intents.push(
                'LOAD_SPRINTS',
                'LOAD_PROJECT_STATS',
                'TOGGLE_VELOCITY_FORECASTING',
                'CALCULATE_FORECASTING',
            );

            return;
        }

        default: {
            const exhaustive: never = action;
            void exhaustive;

            return;
        }
    }
}
