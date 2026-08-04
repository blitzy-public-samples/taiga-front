/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Co-located specification for `useStoryDrag`.
 *
 * WHY THIS FILE IS MANDATORY, TWICE OVER. The runner turns coverage on unconditionally
 * and sweeps the whole React tree against a hard line threshold of 70, so the hook is
 * measured whether or not a specification exists. More importantly, EVERY behaviour
 * this hook exists to protect is SILENT when broken: the order endpoint is
 * position-relative, so a wrong order persists behind a successful response, with no
 * error, no toast and no console warning, surfacing only on the next page load. A
 * single-drag test passes against a completely broken implementation. That is why the
 * cases below are written the way they are.
 *
 * WHAT IS PINNED, AND WHY EACH CASE EARNS ITS PLACE:
 *
 *   1. ⭐⭐ THE SERIALISATION QUEUE. Two drags in rapid succession issue exactly ONE
 *      request; the second is recorded locally and sent only after the first settles.
 *      The order-relative arguments of the second request are asserted, because that is
 *      what a broken queue corrupts.
 *   2. ⭐⭐ THE INDENTATION PROOF. The drain re-drive applies NO local mutation, which
 *      is asserted by comparing the arrangement after the drain against the arrangement
 *      before it. A drain that re-ran the mutation would double-apply the move.
 *   3. ⭐⭐ MU-2. A queued move hands back NOTHING, a dispatched move hands back a
 *      promise, and that promise settles only when its own request settles.
 *   4. ⭐ RECONCILIATION. Both authoritative members are copied back from the response.
 *   5. ⭐⭐ THE THREE-CALL FALLBACK, and the fact that the realtime flag is read WHEN
 *      THE RESPONSE LANDS rather than when the drag began -- asserted by flipping it
 *      mid-flight.
 *   6. ⭐⭐ THE FIFTH DRAIN ACTION -- the closed-sprint re-broadcast, with both halves
 *      of its condition exercised.
 *   7. ⭐ MU-4. A failed write wedges the queue exactly as the incumbent wedges it, and
 *      reports the failure to the caller that holds a handle.
 *   8. ⭐⭐ R-DND-2's THREE POSITIONS -- first, last and cross-container -- each
 *      asserted through the neighbour arguments that actually reach the wire.
 *   9. ⭐⭐ THE LOAD-BEARING INDEX SCOPING. The table header carries the row class too,
 *      so a first-position drop must report index 0 with that header rendered above it.
 *  10. ⭐ MU-1's dependency. Move-to-top supplies only a FOLLOWING neighbour, and the
 *      story lands at position 0 in the local arrangement.
 *  11. ⭐ The native already-resolved promise for an empty backlog.
 *  12. ⭐ AFTER WINS and the truthiness omission, asserted on the request body's own
 *      arguments.
 *  13. ⭐ PG-1's gate, with an archived project deliberately left DRAGGABLE.
 *  14. ⭐⭐ C-DND-6's sprint identity -- stamped from the registration argument, read
 *      back through the drop, and cleared on teardown.
 *  15. ⭐ The velocity toggle on drag start, which the plan omits entirely.
 *  16. ⭐ The gesture class on the document body, removed on every exit including the
 *      guard's, and the document-scoped forecast-band removal.
 *  17. ⭐ The autoscroll numbers, the arm-then-read call order, and pointer-only input.
 *  18. ⭐ R-DND-3 -- an off-screen row is still a legitimate neighbour.
 *  19. ⭐ The milestone reassignment's own body, which uses the OTHER bulk key.
 *  20. ⭐⭐⭐ THREE DRAGS, NOT TWO. Two drags exercise the guard once and the drain once,
 *      and a drain that itself respected the guard would still look correct because the
 *      queue holds one entry by the time it runs. With three entries the drain runs
 *      while the queue is STILL longer than one, which is the only arrangement in which
 *      a guard-respecting drain stalls -- and it stalls silently, for the rest of the
 *      session. The queue length is asserted at the instant each request goes out, and
 *      the whole success tail is asserted to stay shut until the queue has emptied.
 *  21. ⭐⭐ THE RETAINED CONTROLLER'S MOVE SEAM IS NEVER REACHED. It is supplied on the
 *      realtime service, reachable, and asserted uncalled for an order change, a
 *      move-to-top and a sprint reassignment: that controller still owns a second copy
 *      of this queue, so reaching for it would put one write into two queues at once.
 *  22. ⭐⭐ THE REST OF R-DND-2 -- a middle drop, sprint-to-backlog, sprint-to-sprint,
 *      a neighbour whose identifier is not a positive integer, a neighbour with no
 *      identifier at all, the placeholder exclusion against a hidden original, a subject
 *      that cannot be identified, a sibling that is not a row, and the sibling-index
 *      fallback that gives a sprint drop a real position.
 *  23. ⭐ THE WIRE CONTRACT READ BACK AS A BODY, because three of its rules are
 *      invisible in a positional view: a null slot is an ABSENT key, the two neighbour
 *      keys are mutually exclusive, and the two endpoints carry DIFFERENT bulk keys.
 *  24. ⭐⭐ RECONCILIATION OF THE SECOND WRITE of a drained queue, plus the three
 *      properties of the state it writes into -- the touched story is replaced, every
 *      untouched story keeps its identity, and no model bookkeeping crosses the
 *      boundary. State is frozen, and the wire carries identifiers only.
 *  25. ⭐ THE CONFIGURATION BAG's exact membership: nine result members, twelve provider
 *      members, no second kind of sensor, and autoscroll numbers that are asserted
 *      NOT to be the board's.
 *  26. ⭐ THE GATE'S WHOLE TRUTH TABLE, precedence included.
 *  27. ⭐ THE MULTI-SELECTION's measurement rule: every position is taken against the
 *      FIRST SELECTED row, proven by a drop the guard absorbs for a selection and
 *      persists without one.
 *  28. ⭐ THE TWO REFUSALS -- the injector is never asked for a service, and neither
 *      coordination announcement is dispatched as a document-level event.
 *  29. ⭐ THE OWNERSHIP BOUNDARIES -- a move rewrites a sprint's story list and nothing
 *      else about it, the multi-selection controller is handed over and never called
 *      directly, geometry is never consulted so an unmeasurable row is still usable, the
 *      write lands on the instance's own sub-resource, and every container the retained
 *      screen registers is registered here.
 *
 * The suite is browserless and offline BY CONSTRUCTION: it touches no browser interface
 * beyond the jsdom the runner supplies, launches no browser, imports no end-to-end
 * runner, opens no socket, issues no request and depends on no build output. The
 * resource double resolves AngularJS-shaped promises rather than native ones, because
 * adopting one is part of what the code under test does.
 */

import { produce } from 'immer';
import { useReducer } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';

import { mockInjector, withMockInjector } from '../../bridge/mockInjector';
import { toNativePromise } from '../../bridge/toNativePromise';
import type { AngularHttpResponse, AngularPromise } from '../../bridge/useAngularService';
import { MULTIPLE_SORTABLE_CLASS, createMultiDrag } from '../../shared/dnd/multiDrag';
import type { MultiDragController } from '../../shared/dnd/multiDrag';
import { TRANSIT_CLASS } from '../../shared/dnd/useSortableList';
import {
    backlogReducer,
    createInitialBacklogState,
} from '../state/backlogReducer';
import type {
    BacklogAction,
    BacklogOrderResultRow,
    BacklogRowStory,
    BacklogSprint,
    BacklogState,
} from '../state/backlogReducer';
import type { BulkMilestoneItem } from '../state/types';
import { useStoryDrag } from './useStoryDrag';
import type {
    BacklogDispatch,
    BacklogDragProject,
    BacklogOrderWriteResource,
    BacklogRealtimeStatus,
    UseStoryDragOptions,
    UseStoryDragResult,
} from './useStoryDrag';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

const PROJECT_ID = 42;

const SPRINT_ID = 7;

const CLOSED_SPRINT_ID = 9;

/** Three backlog stories, in rendered order. */
const STORY_A = 101;
const STORY_B = 102;
const STORY_C = 103;

/** One story already sitting inside the open sprint. */
const STORY_IN_SPRINT = 201;

function backlogStory(id: number, order: number): BacklogRowStory {
    return {
        id,
        ref: id,
        subject: `story ${String(id)}`,
        status: 1,
        swimlane: null,
        milestone: null,
        project: PROJECT_ID,
        is_blocked: false,
        blocked_note: '',
        is_closed: false,
        due_date: null,
        total_points: 3,
        points: {},
        tags: [],
        epics: null,
        assigned_users: [],
        assigned_to: null,
        kanban_order: order,
        backlog_order: order,
        total_attachments: 0,
        total_comments: 0,
        attachments: [],
        tasks: [],
        watchers: [],
        version: 1,
    };
}

function sprintStory(id: number, milestone: number, order: number): BacklogRowStory {
    return { ...backlogStory(id, order), milestone, sprint_order: order };
}

function sprint(id: number, stories: readonly BacklogRowStory[]): BacklogSprint {
    return {
        id,
        name: `sprint ${String(id)}`,
        slug: `sprint-${String(id)}`,
        owner: null,
        project: PROJECT_ID,
        closed: false,
        disponibility: null,
        order: id,
        created_date: '2026-01-01T00:00:00Z',
        modified_date: '2026-01-01T00:00:00Z',
        closed_points: 0,
        total_points: 10,
        estimated_start: '2026-01-01',
        estimated_finish: '2026-01-15',
        user_stories: stories,
    };
}

const OPEN_PROJECT: BacklogDragProject = { my_permissions: ['modify_us', 'view_us'] };

/* ==========================================================================
 * THE RESOURCE DOUBLE
 *
 * Deliberately NOT a native promise: the frozen resource layer answers with an
 * AngularJS-shaped promise, and marshalling one is part of what the typed facade does.
 * Each write is held open so a specification can decide exactly when -- and whether --
 * it settles, which is the only way to observe "exactly one request on the wire".
 * ========================================================================== */

type OrderArgs = readonly [number, number | null, number | null, number | null, number[]];

type MilestoneArgs = readonly [number, number, readonly BulkMilestoneItem[]];

interface PendingWrite<T> {
    settle(value: T): void;
    fail(reason: unknown): void;
}

interface RecordingResource {
    readonly resource: BacklogOrderWriteResource;
    readonly orderCalls: OrderArgs[];
    /**
     * How many arguments the facade actually handed the resource, per call.
     *
     * Recorded separately from {@link RecordingResource.orderCalls}, whose tuple type
     * fixes the count at five whatever arrives: a facade that dropped its last argument
     * would still produce a five-slot tuple here, with the missing slot reading as
     * `undefined` -- and a dropped story list is a write that reorders the backlog
     * around nothing. The count is taken from the call itself so the omission cannot
     * hide.
     */
    readonly orderArity: number[];
    readonly milestoneCalls: MilestoneArgs[];
    readonly milestoneArity: number[];
    readonly pendingOrder: Array<PendingWrite<readonly BacklogOrderResultRow[]>>;
    readonly pendingMilestone: Array<PendingWrite<unknown>>;
}

/**
 * The response's header accessor, which the frozen shape declares as an overloaded
 * call. Nothing under test reads it; it is implemented rather than faked so the
 * response object satisfies the declared shape without a conversion.
 */
function noHeaders(): Record<string, string>;
function noHeaders(name: string): string | null;
function noHeaders(name?: string): Record<string, string> | string | null {
    return name === undefined ? {} : null;
}

function deferredThenable<T>(
    sink: Array<PendingWrite<T>>,
): AngularPromise<AngularHttpResponse<T>> {
    const handlers: Array<{
        fulfil: (value: AngularHttpResponse<T>) => unknown;
        rejectWith: (reason: unknown) => unknown;
    }> = [];

    let settled: { kind: 'value'; value: T } | { kind: 'reason'; reason: unknown } | null = null;

    const response = (value: T): AngularHttpResponse<T> => ({
        data: value,
        status: 200,
        headers: noHeaders,
    });

    sink.push({
        settle(value: T): void {
            settled = { kind: 'value', value };

            for (const handler of handlers.splice(0)) {
                handler.fulfil(response(value));
            }
        },
        fail(reason: unknown): void {
            settled = { kind: 'reason', reason };

            for (const handler of handlers.splice(0)) {
                handler.rejectWith(reason);
            }
        },
    });

    return {
        then(onFulfilled, onRejected): unknown {
            if (settled === null) {
                handlers.push({ fulfil: onFulfilled, rejectWith: onRejected });

                return undefined;
            }

            return settled.kind === 'value'
                ? onFulfilled(response(settled.value))
                : onRejected(settled.reason);
        },
    };
}

function createRecordingResource(): RecordingResource {
    const orderCalls: OrderArgs[] = [];
    const orderArity: number[] = [];
    const milestoneCalls: MilestoneArgs[] = [];
    const milestoneArity: number[] = [];
    const pendingOrder: Array<PendingWrite<readonly BacklogOrderResultRow[]>> = [];
    const pendingMilestone: Array<PendingWrite<unknown>> = [];

    const resource: BacklogOrderWriteResource = {
        bulkUpdateBacklogOrder(
            projectId,
            milestoneId,
            afterUserstoryId,
            beforeUserstoryId,
            bulkUserstories,
        ): AngularPromise<AngularHttpResponse<readonly BacklogOrderResultRow[]>> {
            orderArity.push(arguments.length);

            orderCalls.push([
                projectId,
                milestoneId,
                afterUserstoryId,
                beforeUserstoryId,
                [...bulkUserstories],
            ]);

            return deferredThenable(pendingOrder);
        },

        bulkUpdateMilestone(projectId, milestoneId, data): AngularPromise<AngularHttpResponse<unknown>> {
            milestoneArity.push(arguments.length);

            const entries: BulkMilestoneItem[] = [];

            for (const entry of data) {
                const usId = entry['us_id'];
                const order = entry['order'];

                entries.push({
                    us_id: typeof usId === 'number' ? usId : -1,
                    order: typeof order === 'number' ? order : -1,
                });
            }

            milestoneCalls.push([projectId, milestoneId, entries]);

            return deferredThenable(pendingMilestone);
        },
    };

    return {
        resource,
        orderCalls,
        orderArity,
        milestoneCalls,
        milestoneArity,
        pendingOrder,
        pendingMilestone,
    };
}

/* ==========================================================================
 * THE RETAINED CONTROLLER'S MOVE SEAM, AS A PROBE
 *
 * ⭐⭐ V8 -- WHY A PROBE EXISTS AT ALL. The bridge that hands this screen its services
 * also exposes the RETAINED controller's own move methods, and that controller still
 * owns a second copy of the serialisation queue. Reaching for either of them from the
 * drag path would enqueue the same write twice, and two position-relative writes
 * interleaving is exactly the silent order corruption the queue exists to prevent --
 * an HTTP 200 for each, and an order the user never chose on the next page load.
 *
 * The two members are therefore supplied, right there and reachable, and every case in
 * this file asserts they are never called. Declared as an extension of the realtime
 * shape rather than as a separate service so the probe travels wherever that shape
 * does, and typed honestly: nothing is converted to satisfy a signature.
 * ========================================================================== */

interface RetainedMoveSeam extends BacklogRealtimeStatus {
    connected: boolean;
    readonly moveUs: jest.Mock<void, unknown[]>;
    readonly moveUsToTopOfBacklog: jest.Mock<void, unknown[]>;
}

function createRetainedMoveSeam(connected: boolean): RetainedMoveSeam {
    return {
        connected,
        moveUs: jest.fn<void, unknown[]>(),
        moveUsToTopOfBacklog: jest.fn<void, unknown[]>(),
    };
}

/* ==========================================================================
 * THE DOM THE GESTURE RUNS AGAINST
 *
 * Reproduces the retained partials' structure exactly where it matters: the table
 * header carries the row class and sits OUTSIDE the table body
 * (`app/partials/includes/modules/backlog-table.jade:9` against `:19`), and both
 * empty-backlog blocks are siblings of the table (`app/partials/backlog/backlog.jade:174`
 * and `:178`).
 * ========================================================================== */

interface Scene {
    readonly root: HTMLElement;
    readonly body: HTMLElement;
    readonly emptyFiltered: HTMLElement;
    readonly emptyLarge: HTMLElement;
    readonly sprintTable: HTMLElement;
    readonly rows: Readonly<Record<number, HTMLElement>>;
}

function buildScene(backlogIds: readonly number[], sprintIds: readonly number[]): Scene {
    const root = document.createElement('div');
    root.className = 'backlog-page';

    const table = document.createElement('section');
    table.className = 'backlog-table';

    const header = document.createElement('div');
    header.className = 'backlog-table-header';

    /* ⭐ THE HEADER CARRIES THE ROW CLASS. This is what the index scoping excludes. */
    const headerRow = document.createElement('div');
    headerRow.className = 'row backlog-table-title';
    header.appendChild(headerRow);

    const body = document.createElement('div');
    body.className = 'backlog-table-body';

    const rows: Record<number, HTMLElement> = {};

    for (const id of backlogIds) {
        const row = document.createElement('div');
        row.className = 'row us-item-row';
        row.dataset['id'] = String(id);
        body.appendChild(row);
        rows[id] = row;
    }

    table.appendChild(header);
    table.appendChild(body);

    const emptyFiltered = document.createElement('div');
    emptyFiltered.className = 'empty-backlog js-empty-backlog';

    const emptyLarge = document.createElement('div');
    emptyLarge.className = 'empty-large js-empty-backlog';

    const sprintTable = document.createElement('div');
    sprintTable.className = 'sprint-table';

    for (const id of sprintIds) {
        const row = document.createElement('div');
        row.className = 'row milestone-us-item-row';
        row.dataset['id'] = String(id);
        sprintTable.appendChild(row);
        rows[id] = row;
    }

    root.appendChild(table);
    root.appendChild(emptyFiltered);
    root.appendChild(emptyLarge);
    root.appendChild(sprintTable);
    document.body.appendChild(root);

    return { root, body, emptyFiltered, emptyLarge, sprintTable, rows };
}

/* ==========================================================================
 * THE HARNESS
 * ========================================================================== */

interface HarnessOptions {
    readonly backlog?: readonly number[];
    readonly sprintStories?: readonly number[];
    /** Further sprints the screen holds, each rendered empty. */
    readonly additionalSprintIds?: readonly number[];
    readonly closedSprints?: readonly BacklogSprint[] | null;
    readonly project?: BacklogDragProject;
    readonly connected?: boolean;
    readonly displayVelocity?: boolean;
    readonly multiDrag?: MultiDragController;
    readonly renderOverlay?: UseStoryDragOptions['renderOverlay'];
    readonly collisionDetection?: UseStoryDragOptions['collisionDetection'];
    /**
     * The subtree wrapper, used to mount the hook under a STRICT injector.
     *
     * Typed from what the library's own option accepts so nothing about the shape is
     * guessed, and defaulted to nothing so the ordinary cases mount bare.
     */
    readonly wrapper?: (props: { children?: ReactNode }) => ReactElement;
}

interface Harness {
    readonly result: {
        current: {
            readonly drag: UseStoryDragResult;
            readonly state: BacklogState;
            readonly dispatch: BacklogDispatch;
        };
    };
    readonly scene: Scene;
    readonly recording: RecordingResource;
    /** The retained controller's move seam. See {@link RetainedMoveSeam}. */
    readonly seam: RetainedMoveSeam;
    readonly calls: {
        readonly emitted: string[];
        readonly loadSprints: number[];
        readonly loadClosedSprints: number[];
        readonly loadProjectStats: number[];
        readonly toggleVelocity: number[];
        readonly calculateForecasting: number[];
    };
    readonly setConnected: (value: boolean) => void;
    readonly rerender: () => void;
    readonly unmount: () => void;
}

/**
 * The reducer under the producer, which is what keeps the freeze on.
 *
 * The screen composes it with the CURRIED producer; this is the explicit equivalent,
 * written out so the state and action types are named at the call site and the runtime
 * behaviour -- structural sharing, and a throw on post-produce mutation -- is
 * identical.
 */
function reduce(state: BacklogState, action: BacklogAction): BacklogState {
    return produce(state, (draft) => {
        backlogReducer(draft, action);
    });
}

function renderHarness(options: HarnessOptions = {}): Harness {
    const backlog = options.backlog ?? [STORY_A, STORY_B, STORY_C];
    const sprintStoryIds = options.sprintStories ?? [STORY_IN_SPRINT];

    const scene = buildScene(backlog, sprintStoryIds);
    const recording = createRecordingResource();

    const emitted: string[] = [];
    const loadSprints: number[] = [];
    const loadClosedSprints: number[] = [];
    const loadProjectStats: number[] = [];
    const toggleVelocity: number[] = [];
    const calculateForecasting: number[] = [];

    const seam = createRetainedMoveSeam(options.connected ?? true);

    let tick = 0;
    const stamp = (sink: number[]): void => {
        tick += 1;
        sink.push(tick);
    };

    const hydration = {
        userStories: backlog.map((id, index) => backlogStory(id, index)),
        sprints: [
            sprint(SPRINT_ID, sprintStoryIds.map((id, index) => sprintStory(id, SPRINT_ID, index))),
            ...(options.additionalSprintIds ?? []).map((id) => sprint(id, [])),
        ],
        closedSprints: options.closedSprints ?? null,
        eventsConnected: options.connected ?? true,
    };

    const rendered = renderHook(() => {
        const [state, dispatch] = useReducer(reduce, createInitialBacklogState(hydration));

        const hookOptions: UseStoryDragOptions = {
            params: {
                project: options.project ?? OPEN_PROJECT,
                rootRef: { current: scene.root },
                state,
                displayVelocity: options.displayVelocity ?? false,
            },
            services: { userstories: recording.resource, realtime: seam },
            actions: {
                dispatch,
                emitAngularEvent: (eventName): void => {
                    emitted.push(eventName);
                },
                loadSprints: (): void => {
                    stamp(loadSprints);
                },
                loadClosedSprints: (): void => {
                    stamp(loadClosedSprints);
                },
                loadProjectStats: (): void => {
                    stamp(loadProjectStats);
                },
                toggleVelocityForecasting: (): void => {
                    stamp(toggleVelocity);
                },
                calculateForecasting: (): void => {
                    stamp(calculateForecasting);
                },
            },
            ...(options.multiDrag === undefined ? {} : { multiDrag: options.multiDrag }),
            ...(options.renderOverlay === undefined
                ? {}
                : { renderOverlay: options.renderOverlay }),
            ...(options.collisionDetection === undefined
                ? {}
                : { collisionDetection: options.collisionDetection }),
        };

        return { drag: useStoryDrag(hookOptions), state, dispatch };
    }, options.wrapper === undefined ? undefined : { wrapper: options.wrapper });

    return {
        result: rendered.result,
        scene,
        recording,
        seam,
        calls: {
            emitted,
            loadSprints,
            loadClosedSprints,
            loadProjectStats,
            toggleVelocity,
            calculateForecasting,
        },
        setConnected: (value: boolean): void => {
            seam.connected = value;
        },
        rerender: (): void => {
            rendered.rerender();
        },
        unmount: (): void => {
            rendered.unmount();
        },
    };
}

/* ==========================================================================
 * DRAG DRIVERS
 *
 * The three provider callbacks, invoked exactly as the shared provider invokes them:
 * drag start, then the multi-selection report, then drag over, then the multi-selection
 * stop report, then drag end. The identifiers the library would carry are supplied on
 * the data objects the hook itself builds, so nothing about the shapes is guessed.
 * ========================================================================== */

interface OverTarget {
    readonly container: HTMLElement;
    readonly reference?: HTMLElement | undefined;
}

function activeFor(drag: UseStoryDragResult, row: HTMLElement): { readonly active: unknown } {
    return {
        active: { id: row.dataset['id'] ?? '', data: { current: drag.getDraggableData(row) } },
    };
}

/** The same shape for a node the hook was never asked to describe. */
function activeForNode(node: HTMLElement, id: string): { readonly active: unknown } {
    return { active: { id, data: { current: { sourceNode: node } } } };
}

/** A subject described by whatever data a screen chose to attach -- or by none. */
function activeForData(id: string, data: unknown): { readonly active: unknown } {
    return { active: { id, data: { current: data } } };
}

/** A drop target described by whatever data a screen chose to attach. */
function overForData(id: string, data: unknown): { readonly over: unknown } {
    return { over: { id, data: { current: data } } };
}

/** The pointer over no target at all. */
const NO_OVER: { readonly over: unknown } = { over: null };

function overFor(drag: UseStoryDragResult, target: OverTarget): { readonly over: unknown } {
    const node = target.reference ?? target.container;

    return { over: { id: node.dataset['id'] ?? 'container', data: { current: drag.getDroppableData(node) } } };
}

/**
 * One complete gesture. Returns whatever `moveUs` returned for it, by reading the
 * handle the drag-end path produced -- which is how MU-2's two return values are
 * observed through a real gesture rather than through a direct call.
 */
function performDrag(
    harness: Harness,
    subject: HTMLElement,
    target: OverTarget,
    selection: readonly HTMLElement[] = [],
): void {
    const { drag } = harness.result.current;
    const props = drag.dndProviderProps;

    act(() => {
        props.onDragStart?.(activeFor(drag, subject) as Parameters<
            NonNullable<typeof props.onDragStart>
        >[0]);
    });

    if (selection.length > 0) {
        act(() => {
            props.onMultiDragStart?.(
                selection,
                activeFor(drag, subject) as Parameters<NonNullable<typeof props.onMultiDragStart>>[1],
            );
        });
    }

    act(() => {
        props.onDragOver?.(
            overFor(drag, target) as Parameters<NonNullable<typeof props.onDragOver>>[0],
        );
    });

    act(() => {
        props.onMultiDragEnd?.(
            selection,
            activeFor(drag, subject) as Parameters<NonNullable<typeof props.onMultiDragEnd>>[1],
        );
        props.onDragEnd?.(
            activeFor(drag, subject) as Parameters<NonNullable<typeof props.onDragEnd>>[0],
        );
    });
}

/** Story ids in the order the reducer currently holds the backlog. */
function backlogOrder(state: BacklogState): number[] {
    return state.userStories.map((story) => story.id);
}

/** Story ids in the order the reducer currently holds the open sprint. */
function sprintOrder(state: BacklogState): number[] {
    const first = state.sprints[0];

    return first === undefined ? [] : first.user_stories.map((story) => story.id);
}

/*
 * Only this suite's own nodes are removed, and the runner's own container is left
 * alone: clearing the whole body would pull the render container out from under the
 * library's automatic cleanup.
 */
afterEach(() => {
    for (const node of document.querySelectorAll('.backlog-page, .doom-line')) {
        node.remove();
    }

    document.body.className = '';
});

/* ==========================================================================
 * 1. THE SERIALISATION QUEUE
 * ========================================================================== */

describe('the order-write serialisation queue', () => {
    it('issues ONE request for two drags in rapid succession, and sends the second only after the first settles', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // Drag C to the front of the backlog.
        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // A second drag arrives while the first request is still open.
        performDrag(harness, rows[STORY_B]!, { container: body, reference: rows[STORY_A]! });

        // ⭐⭐ STILL ONE. The guard recorded the second move and did not send it.
        expect(harness.recording.orderCalls).toHaveLength(1);
        expect(harness.result.current.state.pendingDrag).toHaveLength(2);

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([
                { id: STORY_C, milestone: null, backlog_order: 0 },
            ]);
        });

        // The drain sent the queued move, and only then.
        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(2);
        });

        expect(harness.result.current.state.pendingDrag).toHaveLength(1);

        // The second request carries ITS OWN neighbour, not the first one's.
        const second = harness.recording.orderCalls[1]!;
        expect(second[4]).toEqual([STORY_B]);
    });

    it('a queued move hands back NOTHING while a dispatched move hands back a promise (MU-2)', async () => {
        const harness = renderHarness();

        let first: Promise<void> | undefined;
        let second: Promise<void> | undefined;

        act(() => {
            first = harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        act(() => {
            second = harness.result.current.drag.moveUs([STORY_B], 0, null, null, STORY_A);
        });

        expect(first).toBeInstanceOf(Promise);
        // ⭐⭐ MU-2 -- the guard's bare return, reproduced as `undefined`.
        expect(second).toBeUndefined();

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        let settled = false;
        void first?.then(() => {
            settled = true;
        });

        expect(settled).toBe(false);

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(settled).toBe(true);
        });
    });

    it('still puts the head on the wire when two moves collapse into ONE render batch', async () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;

        // Both requested inside one batch, so the reducer runs twice before the hook can
        // read its one-shot outcome and the first request is overwritten by the second's
        // "queued". Without the recovery, nothing is ever sent and the queue stalls
        // forever with no error anywhere.
        act(() => {
            drag.moveUs([STORY_C], 0, null, null, STORY_A);
            drag.moveUs([STORY_B], 0, null, null, STORY_A);
        });

        expect(harness.result.current.state.pendingDrag).toHaveLength(2);

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // The HEAD of the queue, which is the first move requested.
        expect(harness.recording.orderCalls[0]![4]).toEqual([STORY_C]);

        // And the queue still drains normally from there.
        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(2);
        });

        expect(harness.recording.orderCalls[1]![4]).toEqual([STORY_B]);
    });

    it('applies the local mutation ONCE, so a drain re-drive does not double-apply it (the indentation proof)', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // Two moves, both queued behind one request.
        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        const afterFirst = backlogOrder(harness.result.current.state);
        expect(afterFirst).toEqual([STORY_C, STORY_A, STORY_B]);

        act(() => {
            harness.result.current.drag.moveUs([STORY_A], 0, null, null, STORY_C);
        });

        const afterSecond = backlogOrder(harness.result.current.state);

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(2);
        });

        // ⭐⭐ THE DRAIN CHANGED NOTHING LOCALLY. A drain that re-ran the optimistic
        // mutation would have moved the story a second time.
        expect(backlogOrder(harness.result.current.state)).toEqual(afterSecond);

        expect(rows[STORY_A]).toBeDefined();
        expect(body.isConnected).toBe(true);
    });
});

/* ==========================================================================
 * 2. THE SUCCESS TAIL
 * ========================================================================== */

describe('the success tail', () => {
    it('reconciles both authoritative members from the response', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([
                { id: STORY_C, milestone: null, backlog_order: 77 },
            ]);
        });

        await waitFor(() => {
            const moved = harness.result.current.state.userStories.find(
                (story) => story.id === STORY_C,
            );

            expect(moved?.backlog_order).toBe(77);
            expect(moved?.milestone).toBeNull();
        });
    });

    it('broadcasts the move once the queue is empty', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.calls.emitted).toContain('sprint:us:moved');
        });
    });

    it('makes ALL THREE reload calls when realtime is down, and reads the flag WHEN THE RESPONSE LANDS', async () => {
        const harness = renderHarness({ connected: true });

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // ⭐⭐ The connection drops WHILE the request is open. A flag captured when the
        // drag began would still read "connected" and skip the reload entirely.
        harness.setConnected(false);

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.calls.loadSprints).toHaveLength(1);
        });

        // ⭐⭐ THREE, not one. The plan names only the first.
        expect(harness.calls.loadClosedSprints).toHaveLength(1);
        expect(harness.calls.loadProjectStats).toHaveLength(1);

        // In the incumbent's order: the broadcast precedes the reloads.
        expect(harness.calls.emitted[0]).toBe('sprint:us:moved');
    });

    it('makes NO reload call while realtime is up', async () => {
        const harness = renderHarness({ connected: true });

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.calls.emitted).toContain('sprint:us:moved');
        });

        expect(harness.calls.loadSprints).toHaveLength(0);
        expect(harness.calls.loadClosedSprints).toHaveLength(0);
        expect(harness.calls.loadProjectStats).toHaveLength(0);
    });

    it('re-broadcasts the closed-sprint reload when the story came from a closed sprint (the fifth drain action)', async () => {
        const closed = sprint(CLOSED_SPRINT_ID, [sprintStory(STORY_IN_SPRINT, CLOSED_SPRINT_ID, 0)]);
        const harness = renderHarness({
            backlog: [STORY_A],
            sprintStories: [],
            closedSprints: [{ ...closed, closed: true }],
        });

        act(() => {
            harness.result.current.drag.moveUs([STORY_IN_SPRINT], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.calls.emitted).toContain('backlog:load-closed-sprints');
        });
    });

    it('does NOT re-broadcast it when the closed-sprint list has not been loaded', async () => {
        const harness = renderHarness({ closedSprints: null });

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.calls.emitted).toContain('sprint:us:moved');
        });

        expect(harness.calls.emitted).not.toContain('backlog:load-closed-sprints');
    });
});

/* ==========================================================================
 * 3. THE FAILURE PATH -- MU-4
 * ========================================================================== */

describe('a failed order write', () => {
    it('wedges the queue exactly as the incumbent wedges it, and reports the failure to its caller', async () => {
        const harness = renderHarness();
        const reason = new Error('rejected by the server');

        let handle: Promise<void> | undefined;

        act(() => {
            handle = harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.fail(reason);
        });

        await expect(handle).rejects.toBe(reason);

        // ⛔ MU-4 -- the entry stays at the head, so a later drag is recorded and never
        // sent. Preserved, not repaired.
        act(() => {
            harness.result.current.drag.moveUs([STORY_B], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.result.current.state.pendingDrag).toHaveLength(2);
        });

        expect(harness.recording.orderCalls).toHaveLength(1);
    });
});

/* ==========================================================================
 * 4. THE FROZEN REQUEST BODY
 * ========================================================================== */

describe('the request the facade is handed', () => {
    it('passes the preceding neighbour through and lets AFTER WIN when both are supplied', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 1, null, STORY_A, STORY_B);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const [projectId, milestoneId, after, before, bulk] = harness.recording.orderCalls[0]!;

        expect(projectId).toBe(PROJECT_ID);
        // ⭐ AFTER WINS: the facade drops the following neighbour, so the resource sees
        // only the preceding one.
        expect(after).toBe(STORY_A);
        expect(before).toBeNull();
        expect(milestoneId).toBeNull();
        expect(bulk).toEqual([STORY_C]);
    });

    it('omits the destination entirely for a backlog reorder, and sends it for a sprint reorder', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_IN_SPRINT], 0, SPRINT_ID, null, null);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(harness.recording.orderCalls[0]![1]).toBe(SPRINT_ID);
    });

    it('refuses a move whose subject the screen does not hold', () => {
        const harness = renderHarness();

        let handle: Promise<void> | undefined;

        act(() => {
            handle = harness.result.current.drag.moveUs([999_999], 0, null, null, STORY_A);
        });

        expect(handle).toBeUndefined();
        expect(harness.recording.orderCalls).toHaveLength(0);
        expect(harness.result.current.state.pendingDrag).toHaveLength(0);
    });
});

/* ==========================================================================
 * 5. MOVE TO TOP -- MU-1's DEPENDENCY
 * ========================================================================== */

describe('moveUsToTopOfBacklog', () => {
    it('returns a native already-resolved promise for an empty backlog and issues no request', async () => {
        const harness = renderHarness({ backlog: [] });

        let handle: Promise<void> | undefined;

        act(() => {
            handle = harness.result.current.drag.moveUsToTopOfBacklog([STORY_IN_SPRINT]);
        });

        expect(handle).toBeInstanceOf(Promise);
        await expect(handle).resolves.toBeUndefined();
        expect(harness.recording.orderCalls).toHaveLength(0);
    });

    it('lands the story at position 0, which depends on MU-1', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUsToTopOfBacklog([STORY_C]);
        });

        // ⭐⭐ POSITION 0. The reducer's following-neighbour branch searches for the
        // PRECEDING id, answers -1, and the increment lands the insertion at the top.
        expect(backlogOrder(harness.result.current.state)).toEqual([STORY_C, STORY_A, STORY_B]);

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // Only a FOLLOWING neighbour was supplied, so that is the key that reaches the wire.
        const [, , after, before] = harness.recording.orderCalls[0]!;
        expect(after).toBeNull();
        expect(before).toBe(STORY_A);
    });
});

/* ==========================================================================
 * 6. THE GESTURE -- INDEX, NEIGHBOURS AND CONTAINERS
 * ========================================================================== */

describe('the gesture', () => {
    it('reports index 0 for a first-position drop even though the table header carries the row class', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        harness.scene.root.querySelectorAll('.backlog-table-title').forEach((header) => {
            expect(header.classList.contains('row')).toBe(true);
        });

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // ⭐⭐ Index 0, not 1. Dropping the `backlog-table-body ` scoping would have
        // counted the header and reported 1 here.
        expect(harness.result.current.state.pendingDrag[0]?.newUsIndex).toBe(0);

        // First position: no preceding neighbour, the following one is the old first row.
        const [, , after, before] = harness.recording.orderCalls[0]!;
        expect(after).toBeNull();
        expect(before).toBe(STORY_A);
    });

    it('reports the preceding neighbour for a last-position drop (PREVIOUS WINS)', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        performDrag(harness, rows[STORY_A]!, { container: body });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const [, , after, before] = harness.recording.orderCalls[0]!;
        expect(after).toBe(STORY_C);
        expect(before).toBeNull();
    });

    it('resolves a cross-container drop into the sprint from the stamped identity, and hands the element back to React', async () => {
        const harness = renderHarness();
        const { rows, sprintTable } = harness.scene;

        const unregister = harness.result.current.drag.registerSprintDragContainer(SPRINT_ID)(
            sprintTable,
        );

        // ⭐⭐ C-DND-6 -- the attribute is stamped from the registration argument.
        expect(sprintTable.getAttribute('data-sprint-id')).toBe(String(SPRINT_ID));

        const moved = rows[STORY_A]!;

        performDrag(harness, moved, { container: sprintTable });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(harness.recording.orderCalls[0]![1]).toBe(SPRINT_ID);
        /*
         * ⭐⭐ THIS EXPECTATION WAS INVERTED UNTIL A BROWSER RUN DISPROVED IT. The
         * incumbent removes the element itself (`sortable.coffee:134-145`) and this spec
         * originally asserted the same, but the node is React's: removing it behind
         * React's back makes the next commit throw `NotFoundError` and blanks the screen.
         * The element therefore stays connected, under the parent React recorded, and
         * React removes it while rendering the state below. See suite 6a.
         */
        expect(moved.isConnected).toBe(true);
        expect(moved.parentElement).toBe(harness.scene.body);
        expect(sprintOrder(harness.result.current.state)).toContain(STORY_A);

        unregister();
        expect(sprintTable.hasAttribute('data-sprint-id')).toBe(false);
        expect(harness.result.current.drag.getContainers()).not.toContain(sprintTable);
    });

    it('hands back the SAME registrar for the same sprint id, so a card does not re-register on every render', () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;

        expect(drag.registerSprintDragContainer(SPRINT_ID)).toBe(
            drag.registerSprintDragContainer(SPRINT_ID),
        );
        expect(drag.registerSprintDragContainer(SPRINT_ID)).not.toBe(
            drag.registerSprintDragContainer(CLOSED_SPRINT_ID),
        );
    });

    it('registers BOTH empty-backlog blocks and the table body', () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const { body, emptyFiltered, emptyLarge } = harness.scene;

        drag.registerDragContainer(body);
        drag.registerDragContainer(emptyFiltered);
        drag.registerDragContainer(emptyLarge);

        const containers = drag.getContainers();

        expect(containers).toContain(body);
        expect(containers).toContain(emptyFiltered);
        expect(containers).toContain(emptyLarge);
        expect(containers).toHaveLength(3);
    });

    it('persists nothing for an unchanged drop, and still clears the gesture class', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // Dropped back exactly where it started: still first, still in the table body.
        performDrag(harness, rows[STORY_A]!, { container: body, reference: rows[STORY_B]! });

        await waitFor(() => {
            expect(document.body.classList.contains('drag-active')).toBe(false);
        });

        // ⭐ The incumbent's bare `return` -- index equals the captured one and the
        // container is the same, so there is nothing to persist.
        expect(harness.recording.orderCalls).toHaveLength(0);
        expect(backlogOrder(harness.result.current.state)).toEqual([STORY_A, STORY_B, STORY_C]);
    });

    it('persists nothing for a cancelled gesture and puts the row back', async () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const props = drag.dndProviderProps;
        const { rows, body } = harness.scene;
        const moved = rows[STORY_C]!;

        act(() => {
            props.onDragStart?.(
                activeFor(drag, moved) as Parameters<NonNullable<typeof props.onDragStart>>[0],
            );
        });

        act(() => {
            props.onDragOver?.(
                overFor(drag, { container: body, reference: rows[STORY_A]! }) as Parameters<
                    NonNullable<typeof props.onDragOver>
                >[0],
            );
        });

        expect(body.firstElementChild).toBe(moved);

        act(() => {
            props.onDragCancel?.(
                activeFor(drag, moved) as Parameters<NonNullable<typeof props.onDragCancel>>[0],
            );
        });

        // Reverted, and nothing persisted -- the guard absorbed the gesture.
        expect(body.lastElementChild).toBe(moved);
        expect(harness.recording.orderCalls).toHaveLength(0);
        expect(document.body.classList.contains('drag-active')).toBe(false);
    });

    it('turns velocity forecasting off on drag start, which the plan omits entirely', () => {
        const harness = renderHarness({ displayVelocity: true });
        const { drag } = harness.result.current;
        const props = drag.dndProviderProps;

        act(() => {
            props.onDragStart?.(
                activeFor(drag, harness.scene.rows[STORY_A]!) as Parameters<
                    NonNullable<typeof props.onDragStart>
                >[0],
            );
        });

        expect(harness.calls.toggleVelocity).toHaveLength(1);
        expect(document.body.classList.contains('drag-active')).toBe(true);
    });

    it('leaves velocity forecasting alone when it is already off', () => {
        const harness = renderHarness({ displayVelocity: false });
        const { drag } = harness.result.current;
        const props = drag.dndProviderProps;

        act(() => {
            props.onDragStart?.(
                activeFor(drag, harness.scene.rows[STORY_A]!) as Parameters<
                    NonNullable<typeof props.onDragStart>
                >[0],
            );
        });

        expect(harness.calls.toggleVelocity).toHaveLength(0);
    });

    it('removes the forecast band document-wide when the gesture ends', () => {
        const harness = renderHarness();
        const band = document.createElement('div');
        band.className = 'doom-line';
        document.body.appendChild(band);

        performDrag(harness, harness.scene.rows[STORY_A]!, { container: harness.scene.body });

        expect(band.isConnected).toBe(false);
    });

    it('ignores a gesture whose subject is not a row', () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const props = drag.dndProviderProps;
        const stranger = document.createElement('div');
        stranger.dataset['id'] = String(STORY_A);
        harness.scene.body.appendChild(stranger);

        act(() => {
            props.onDragStart?.(
                activeForNode(stranger, String(STORY_A)) as Parameters<
                    NonNullable<typeof props.onDragStart>
                >[0],
            );
        });

        expect(document.body.classList.contains('drag-active')).toBe(false);
        expect(harness.calls.toggleVelocity).toHaveLength(0);
    });

    it('keeps an off-screen row usable as a neighbour (R-DND-3)', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // Off screen by every measure jsdom can express, and still a legitimate anchor.
        rows[STORY_A]!.style.display = 'none';

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(harness.recording.orderCalls[0]![3]).toBe(STORY_A);
    });

    it('carries the whole multi-selection when one is reported, and measures the first selected row', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;
        const selection = [rows[STORY_B]!, rows[STORY_C]!];

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! }, selection);

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(harness.recording.orderCalls[0]![4]).toEqual([STORY_B, STORY_C]);
    });
});

/* ==========================================================================
 * 6a. THE DOCUMENT HANDED BACK TO REACT
 *
 * ⭐⭐ THIS SUITE EXISTS BECAUSE A REAL BROWSER CAUGHT WHAT jsdom COULD NOT ARGUE ABOUT.
 *
 * The hook displaces the dragged row into its destination container while the gesture
 * runs, because that is the only way the neighbour scan can read the siblings the
 * incumbent read (`sortable.coffee:54-55`). The incumbent then DELETES that node when
 * the container changed (`:134-145`). Transcribing the deletion is fatal here: the node
 * belongs to React, so removing it -- or leaving it parked under a different parent --
 * makes React's next commit call `removeChild` against a parent that no longer holds it,
 * which throws `NotFoundError` and unmounts the screen to a blank page. That was
 * reproduced deterministically in Chrome on a cross-container drop.
 *
 * So the invariant every one of these cases pins is the same: WHEN THE HANDLER RETURNS,
 * EVERY DRAGGED ROW SITS UNDER THE PARENT REACT RECORDED, and React performs the real
 * removal or reordering from state. The end state after that commit is the incumbent's;
 * only the agent of the change differs.
 * ========================================================================== */

describe('the document handed back to React', () => {
    it('returns a row that crossed into the sprint to its original parent', async () => {
        const harness = renderHarness();
        const { body, sprintTable, rows } = harness.scene;
        const subject = rows[STORY_A]!;

        harness.result.current.drag.registerDragContainer(body);
        harness.result.current.drag.registerSprintDragContainer(SPRINT_ID)(sprintTable);

        performDrag(harness, subject, { container: sprintTable });

        /* The write really did describe a cross-container move... */
        expect(harness.recording.orderCalls).toHaveLength(1);
        expect(harness.recording.orderCalls[0]![1]).toBe(SPRINT_ID);

        /* ...and yet the node is back where React put it, NOT in the sprint table and
         * NOT removed from the document. React owns the move from here. */
        expect(subject.parentElement).toBe(body);
        expect(subject.isConnected).toBe(true);
        expect(sprintTable.contains(subject)).toBe(false);
    });

    it('returns a row dropped into an empty-backlog block, which the incumbent would not have deleted', async () => {
        /*
         * ⭐ The subtle one. `:99` reads an empty-backlog block AS the backlog, so this is
         * a SAME-container drop and the incumbent's deletion branch never fires -- but the
         * block is still a different DOM parent, so React is still desynchronised unless
         * the row comes home. A browser run left the row parked in the drop zone while
         * state held it in the list; this pins that it cannot happen again.
         */
        const harness = renderHarness();
        const { body, emptyFiltered, rows } = harness.scene;
        const subject = rows[STORY_B]!;

        harness.result.current.drag.registerDragContainer(body);
        harness.result.current.drag.registerDragContainer(emptyFiltered);

        performDrag(harness, subject, { container: emptyFiltered });

        expect(subject.parentElement).toBe(body);
        expect(emptyFiltered.contains(subject)).toBe(false);
    });

    it('returns every row of a multi-selection, not just the one under the pointer', async () => {
        /*
         * The shared multi-selection controller clusters the other selected rows around
         * the main one, so a cross-container multi-drag can carry them into the wrong
         * parent too. React would then throw once per row, so parentage is corrected for
         * the whole selection.
         */
        const harness = renderHarness();
        const { body, sprintTable, rows } = harness.scene;
        const main = rows[STORY_A]!;
        const companion = rows[STORY_C]!;

        harness.result.current.drag.registerDragContainer(body);
        harness.result.current.drag.registerSprintDragContainer(SPRINT_ID)(sprintTable);

        /* Reproduce the clustering the controller performs before the handler runs. */
        sprintTable.appendChild(companion);

        performDrag(harness, main, { container: sprintTable }, [main, companion]);

        expect(main.parentElement).toBe(body);
        expect(companion.parentElement).toBe(body);
        expect(harness.recording.orderCalls[0]![4]).toEqual([STORY_A, STORY_C]);
    });

    it('leaves a row that never moved exactly where it was', async () => {
        /* The return is idempotent: an in-place drop must not reshuffle the document. */
        const harness = renderHarness();
        const { body, rows } = harness.scene;
        const subject = rows[STORY_B]!;
        const before = [...body.children];

        harness.result.current.drag.registerDragContainer(body);

        performDrag(harness, subject, { container: body, reference: rows[STORY_C]! });

        expect(subject.parentElement).toBe(body);
        expect([...body.children]).toEqual(before);
    });

    it('does not move the row a second time when a later gesture is abandoned', async () => {
        /*
         * The successful drop has already undone the displacement, so the gesture's
         * bookkeeping must be clear: a subsequent abandoned gesture has nothing of its
         * own to undo and must leave the document alone.
         */
        const harness = renderHarness();
        const { body, sprintTable, rows } = harness.scene;
        const subject = rows[STORY_A]!;

        harness.result.current.drag.registerDragContainer(body);
        harness.result.current.drag.registerSprintDragContainer(SPRINT_ID)(sprintTable);

        performDrag(harness, subject, { container: sprintTable });
        expect(subject.parentElement).toBe(body);

        const settled = [...body.children];
        const props = harness.result.current.drag.dndProviderProps;

        act(() => {
            props.onDragStart?.(
                activeFor(harness.result.current.drag, subject) as Parameters<
                    NonNullable<typeof props.onDragStart>
                >[0],
            );
        });
        act(() => {
            props.onDragCancel?.(
                activeFor(harness.result.current.drag, subject) as Parameters<
                    NonNullable<typeof props.onDragCancel>
                >[0],
            );
        });

        expect([...body.children]).toEqual(settled);
        expect(document.body.className).toBe('');
    });
});

/* ==========================================================================
 * 6b. THE DEFENSIVE PATHS
 *
 * Each of these is a real degradation the hook has to survive, not a coverage
 * exercise: a screen that nominates no node, a hovered row that has moved on, a
 * container carrying an identifier nothing wrote, and a subject that left the document
 * mid-gesture.
 * ========================================================================== */

describe('the degraded paths', () => {
    it('falls back to the identifier probe when the screen nominates no node', async () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const props = drag.dndProviderProps;
        const { rows, body } = harness.scene;

        drag.registerDragContainer(body);

        // No `sourceNode` and no `containerNode`: only the identifiers are given.
        act(() => {
            props.onDragStart?.(
                activeForData(String(STORY_C), {}) as Parameters<
                    NonNullable<typeof props.onDragStart>
                >[0],
            );
        });

        expect(document.body.classList.contains('drag-active')).toBe(true);

        act(() => {
            props.onDragOver?.(
                overForData(String(STORY_A), {}) as Parameters<
                    NonNullable<typeof props.onDragOver>
                >[0],
            );
        });

        expect(body.firstElementChild).toBe(rows[STORY_C]!);

        act(() => {
            props.onDragEnd?.(
                activeForNode(rows[STORY_C]!, String(STORY_C)) as Parameters<
                    NonNullable<typeof props.onDragEnd>
                >[0],
            );
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(harness.recording.orderCalls[0]![3]).toBe(STORY_A);
    });

    it('discards a hovered row that is no longer a child of the resolved container', () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const { rows, body, sprintTable } = harness.scene;

        // The row is described against the table body, but the drop names the sprint
        // table -- so the reference cannot order anything inside it and is dropped,
        // leaving an append.
        const data = { containerNode: sprintTable, itemNode: rows[STORY_A]! };

        act(() => {
            drag.dndProviderProps.onDragStart?.(
                activeFor(drag, rows[STORY_C]!) as Parameters<
                    NonNullable<typeof drag.dndProviderProps.onDragStart>
                >[0],
            );
        });

        act(() => {
            drag.dndProviderProps.onDragOver?.(
                overForData(String(STORY_A), data) as Parameters<
                    NonNullable<typeof drag.dndProviderProps.onDragOver>
                >[0],
            );
        });

        expect(sprintTable.lastElementChild).toBe(rows[STORY_C]!);
        expect(body.contains(rows[STORY_C]!)).toBe(false);
    });

    it('ignores a drop with no target at all', () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const { rows, body } = harness.scene;

        act(() => {
            drag.dndProviderProps.onDragStart?.(
                activeFor(drag, rows[STORY_C]!) as Parameters<
                    NonNullable<typeof drag.dndProviderProps.onDragStart>
                >[0],
            );
        });

        act(() => {
            drag.dndProviderProps.onDragOver?.(
                NO_OVER as Parameters<NonNullable<typeof drag.dndProviderProps.onDragOver>>[0],
            );
        });

        // Nothing moved: the row is exactly where it started.
        expect(body.lastElementChild).toBe(rows[STORY_C]!);
    });

    it('treats a sprint table carrying a non-canonical identifier as having none', async () => {
        const harness = renderHarness();
        const { rows, sprintTable } = harness.scene;

        // Nothing this hook wrote -- and deliberately not a canonical positive integer,
        // so it must read as "no identity" rather than as a not-a-number.
        sprintTable.setAttribute('data-sprint-id', '0');

        performDrag(harness, rows[STORY_A]!, { container: sprintTable });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // No destination reaches the wire, because none could be read.
        expect(harness.recording.orderCalls[0]![1]).toBeNull();
    });

    it('persists nothing when the subject has left every container', () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const props = drag.dndProviderProps;
        const row = harness.scene.rows[STORY_A]!;

        act(() => {
            props.onDragStart?.(
                activeFor(drag, row) as Parameters<NonNullable<typeof props.onDragStart>>[0],
            );
        });

        harness.scene.root.appendChild(row);

        act(() => {
            props.onDragEnd?.(
                activeFor(drag, row) as Parameters<NonNullable<typeof props.onDragEnd>>[0],
            );
        });

        expect(harness.recording.orderCalls).toHaveLength(0);
        expect(document.body.classList.contains('drag-active')).toBe(false);
    });

    it('does not re-write the DOM when the row is already where the pointer says', () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const props = drag.dndProviderProps;
        const { rows, body } = harness.scene;
        const row = rows[STORY_C]!;

        act(() => {
            props.onDragStart?.(
                activeFor(drag, row) as Parameters<NonNullable<typeof props.onDragStart>>[0],
            );
        });

        // Already the last child, so an append must be a no-op.
        act(() => {
            props.onDragOver?.(
                overFor(drag, { container: body }) as Parameters<
                    NonNullable<typeof props.onDragOver>
                >[0],
            );
            props.onDragOver?.(
                overFor(drag, { container: body }) as Parameters<
                    NonNullable<typeof props.onDragOver>
                >[0],
            );
        });

        expect(backlogOrder(harness.result.current.state)).toEqual([STORY_A, STORY_B, STORY_C]);
        expect(body.lastElementChild).toBe(row);

        act(() => {
            props.onDragCancel?.(
                activeFor(drag, row) as Parameters<NonNullable<typeof props.onDragCancel>>[0],
            );
        });

        // The row was never moved by the hook, so nothing was restored either.
        expect(body.lastElementChild).toBe(row);
    });
});

/* ==========================================================================
 * 7. THE PROVIDER CONFIGURATION
 * ========================================================================== */

describe('the provider props', () => {
    it('passes the backlog autoscroll numbers explicitly, targeting the owning window', () => {
        const harness = renderHarness();
        const { autoScroll } = harness.result.current.drag.dndProviderProps;

        expect(autoScroll.enabled).toBe(true);
        expect(autoScroll.margin).toBe(20);
        expect(autoScroll.pixels).toBe(30);
        expect(autoScroll.scrollWhenOutside).toBe(true);
        expect(autoScroll.maxSpeed).toBeUndefined();
        expect(autoScroll.getTargets()).toEqual([window]);
    });

    it('states the arm-then-read call order rather than inheriting the board default', () => {
        const harness = renderHarness();

        expect(harness.result.current.drag.dndProviderProps.multiDragCallOrder).toBe(
            'start-then-elements',
        );
    });

    it('supplies a multi-selection controller and hands an injected one through untouched', () => {
        const injected: MultiDragController = {
            start: (): void => undefined,
            stop: (): readonly HTMLElement[] => [],
            getElements: (): readonly HTMLElement[] => [],
            isMultiple: (): boolean => false,
            reset: (): void => undefined,
            inProgress: false,
            destroy: (): void => undefined,
        };

        expect(renderHarness().result.current.drag.dndProviderProps.multiDrag).toBeDefined();
        expect(renderHarness({ multiDrag: injected }).result.current.drag.dndProviderProps.multiDrag).toBe(
            injected,
        );
    });

    it('wires all five lifecycle callbacks plus both multi-selection reports', () => {
        const props = renderHarness().result.current.drag.dndProviderProps;

        expect(typeof props.onDragStart).toBe('function');
        expect(typeof props.onDragOver).toBe('function');
        expect(typeof props.onDragEnd).toBe('function');
        expect(typeof props.onDragCancel).toBe('function');
        expect(typeof props.onMultiDragStart).toBe('function');
        expect(typeof props.onMultiDragEnd).toBe('function');
    });
});

/* ==========================================================================
 * 8. PG-1 -- THE PERMISSION GATE, PRESERVED
 * ========================================================================== */

describe('the permission gate (PG-1)', () => {
    it('enables the gesture for a member who may modify stories', () => {
        expect(renderHarness().result.current.drag.dndProviderProps.disabled).toBe(false);
    });

    it('disables it for a member who may not, on a project that is not archived', () => {
        const harness = renderHarness({ project: { my_permissions: ['view_us'] } });

        expect(harness.result.current.drag.dndProviderProps.disabled).toBe(true);
        expect(harness.result.current.drag.dndProviderProps.autoScroll.enabled).toBe(false);
    });

    it('⛔ leaves an ARCHIVED project draggable even without the permission -- the preserved precedence', () => {
        const harness = renderHarness({
            project: { my_permissions: ['view_us'], archived_code: 'archived' },
        });

        // `not (…) and !archived_code`: `not` binds tighter, so an archived project
        // never reaches the refusal. Repairing this would be a behaviour change.
        expect(harness.result.current.drag.dndProviderProps.disabled).toBe(false);
    });
});

/* ==========================================================================
 * 9. THE ROW AND DROPPABLE DATA
 * ========================================================================== */

describe('the data the screen attaches', () => {
    it('describes a row with its own node and a SINGLE container element', () => {
        const harness = renderHarness();
        const row = harness.scene.rows[STORY_A]!;
        const data = harness.result.current.drag.getDraggableData(row);

        expect(data.sourceNode).toBe(row);
        // ⭐⭐ ONE element, where the board hands over the whole registered list.
        expect(data.multiDragContainer).toBe(harness.scene.body);
        expect(Array.isArray(data.multiDragContainer)).toBe(false);
    });

    it('describes each container as a container and each row as a row', () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const { body, emptyLarge, sprintTable, rows } = harness.scene;

        expect(drag.getDroppableData(body)).toEqual({ containerNode: body });
        expect(drag.getDroppableData(emptyLarge)).toEqual({ containerNode: emptyLarge });
        expect(drag.getDroppableData(sprintTable)).toEqual({ containerNode: sprintTable });
        expect(drag.getDroppableData(rows[STORY_A]!)).toEqual({
            itemNode: rows[STORY_A]!,
            containerNode: body,
        });
    });

    it('recognises only elements carrying the row class as draggable', () => {
        const harness = renderHarness();
        const { canMove } = harness.result.current.drag;

        expect(canMove(harness.scene.rows[STORY_A]!)).toBe(true);
        expect(canMove(harness.scene.body)).toBe(false);
        expect(canMove(null)).toBe(false);
        expect(canMove('row')).toBe(false);
    });
});

/* ==========================================================================
 * 10. THE MILESTONE REASSIGNMENT -- THE OTHER BULK KEY
 * ========================================================================== */

describe('the milestone reassignment', () => {
    it('sends the reducer payload ONCE, with the other bulk key, and performs its four post-success effects', async () => {
        const harness = renderHarness();

        // The selection path is the screen's, driven straight through the reducer; this
        // hook's job begins when the reducer records the request.
        act(() => {
            harness.result.current.dispatch({ type: 'TOGGLE_ROW_CHECKBOX', storyId: STORY_A });
        });

        act(() => {
            harness.result.current.dispatch({ type: 'MOVE_SELECTED_TO_SPRINT', target: 'latest' });
        });

        await waitFor(() => {
            expect(harness.recording.milestoneCalls).toHaveLength(1);
        });

        const [projectId, milestoneId, entries] = harness.recording.milestoneCalls[0]!;

        expect(projectId).toBe(PROJECT_ID);
        expect(milestoneId).toBe(SPRINT_ID);
        // ⭐ Each entry carries BOTH required integers; a dropped order is a rejection of
        // the whole request rather than a defaulted value.
        expect(entries).toEqual([{ us_id: STORY_A, order: 0 }]);

        // One request, not two: the slot is consumed as soon as it is read.
        harness.rerender();
        expect(harness.recording.milestoneCalls).toHaveLength(1);

        await act(async () => {
            harness.recording.pendingMilestone[0]!.settle(undefined);
        });

        // The four post-success effects, in the incumbent's order.
        await waitFor(() => {
            expect(harness.calls.calculateForecasting).toHaveLength(1);
        });

        expect(harness.calls.loadSprints).toHaveLength(1);
        expect(harness.calls.loadProjectStats).toHaveLength(1);
        expect(harness.calls.toggleVelocity).toHaveLength(1);
        expect(harness.calls.loadSprints[0]).toBeLessThan(harness.calls.loadProjectStats[0]!);
        expect(harness.calls.toggleVelocity[0]).toBeLessThan(
            harness.calls.calculateForecasting[0]!,
        );

        // ⭐ NO ORDER WRITE was issued: this path uses the other endpoint entirely.
        expect(harness.recording.orderCalls).toHaveLength(0);
    });

    it('releases its slot after a failure, unlike the order write', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.dispatch({ type: 'TOGGLE_ROW_CHECKBOX', storyId: STORY_A });
        });

        act(() => {
            harness.result.current.dispatch({ type: 'MOVE_SELECTED_TO_SPRINT', target: 'latest' });
        });

        await waitFor(() => {
            expect(harness.recording.milestoneCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingMilestone[0]!.fail(new Error('rejected'));
        });

        act(() => {
            harness.result.current.dispatch({ type: 'TOGGLE_ROW_CHECKBOX', storyId: STORY_B });
        });

        act(() => {
            harness.result.current.dispatch({ type: 'MOVE_SELECTED_TO_SPRINT', target: 'latest' });
        });

        await waitFor(() => {
            expect(harness.recording.milestoneCalls).toHaveLength(2);
        });
    });
});

/* ==========================================================================
 * 11. TEARDOWN
 * ========================================================================== */

describe('teardown', () => {
    it('clears the gesture class and restores a displaced row when unmounted mid-drag', () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const props = drag.dndProviderProps;
        const { rows, body } = harness.scene;
        const moved = rows[STORY_C]!;

        act(() => {
            props.onDragStart?.(
                activeFor(drag, moved) as Parameters<NonNullable<typeof props.onDragStart>>[0],
            );
            props.onDragOver?.(
                overFor(drag, { container: body, reference: rows[STORY_A]! }) as Parameters<
                    NonNullable<typeof props.onDragOver>
                >[0],
            );
        });

        expect(body.firstElementChild).toBe(moved);
        expect(document.body.classList.contains('drag-active')).toBe(true);

        act(() => {
            harness.unmount();
        });

        expect(body.lastElementChild).toBe(moved);
        expect(document.body.classList.contains('drag-active')).toBe(false);
    });

    it('drops a response that lands after unmount without dispatching', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        act(() => {
            harness.unmount();
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([
                { id: STORY_C, milestone: null, backlog_order: 5 },
            ]);
        });

        expect(harness.calls.emitted).toHaveLength(0);
    });
});

/* ==========================================================================
 * 12. THE QUEUE UNDER LOAD -- THREE DRAGS, THE DRAIN, AND THE GATED TAIL
 *
 * ⭐⭐⭐ Suite 1 pins two drags. This one pins THREE, because two drags exercise the
 * guard once and the drain once, and a drain that itself respected the guard would
 * still look correct: the queue would hold one entry by the time it ran. With three
 * entries the drain runs while the queue is STILL longer than one, which is the only
 * arrangement in which a guard-respecting drain stalls -- silently, forever, with the
 * remaining moves recorded locally and never sent.
 * ========================================================================== */

describe('the queue under load', () => {
    it('issues exactly ONE request for a single drag and empties the queue when it settles', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(harness.result.current.state.pendingDrag).toHaveLength(1);

        // Five arguments, and the count is read from the call rather than from a tuple
        // type: a dropped story list would reorder the backlog around nothing.
        expect(harness.recording.orderArity).toEqual([5]);

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.result.current.state.pendingDrag).toHaveLength(0);
        });

        // The dequeue leaves nothing to drain, so nothing further goes out.
        expect(harness.recording.orderCalls).toHaveLength(1);
    });

    it('serialises THREE drags, sending each only after the previous one settles', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // Two more while the first request is still open.
        act(() => {
            harness.result.current.drag.moveUs([STORY_B], 0, null, null, STORY_A);
        });

        act(() => {
            harness.result.current.drag.moveUs([STORY_A], 0, null, null, STORY_C);
        });

        // ⭐⭐ STILL ONE ON THE WIRE. Both later moves are recorded and neither is sent:
        // only the head of the queue is ever in flight, because the second would compute
        // its neighbours from an arrangement the server has not acknowledged.
        expect(harness.recording.orderCalls).toHaveLength(1);
        expect(harness.result.current.state.pendingDrag).toHaveLength(3);

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(2);
        });

        await act(async () => {
            harness.recording.pendingOrder[1]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(3);
        });

        await act(async () => {
            harness.recording.pendingOrder[2]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.result.current.state.pendingDrag).toHaveLength(0);
        });

        // ⭐ STRICTLY IN ORDER, AND NEVER OVERLAPPING: three requests, each carrying its
        // OWN subject, in the order the three gestures happened.
        expect(harness.recording.orderCalls.map((call) => call[4])).toEqual([
            [STORY_C],
            [STORY_B],
            [STORY_A],
        ]);
        expect(harness.recording.orderArity).toEqual([5, 5, 5]);
    });

    it('drains THROUGH the guard, dispatching while the queue still holds more than one entry', async () => {
        const harness = renderHarness();
        const queueLengths: number[] = [];

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        act(() => {
            harness.result.current.drag.moveUs([STORY_B], 0, null, null, STORY_A);
        });

        act(() => {
            harness.result.current.drag.moveUs([STORY_A], 0, null, null, STORY_C);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        queueLengths.push(harness.result.current.state.pendingDrag.length);

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(2);
        });

        // ⭐⭐ TWO ENTRIES ARE STILL QUEUED as the second request goes out. The
        // user-initiated path refuses to send in exactly this situation; the drain must
        // not, and the incumbent bypasses its own guard by passing a placeholder first
        // argument for precisely this reason.
        queueLengths.push(harness.result.current.state.pendingDrag.length);
        expect(harness.result.current.state.pendingDrag).toHaveLength(2);

        await act(async () => {
            harness.recording.pendingOrder[1]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(3);
        });

        queueLengths.push(harness.result.current.state.pendingDrag.length);

        // ⭐ AND THE DRAIN ENQUEUES NOTHING. The queue only ever shrinks from here: a
        // re-drive that enqueued would have grown it to four and the screen would never
        // stop writing.
        expect(queueLengths).toEqual([3, 2, 1]);
    });

    it('takes the drain instead of the announcement while the queue is not empty', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        act(() => {
            harness.result.current.drag.moveUs([STORY_B], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(2);
        });

        // ⭐ NOTHING IS ANNOUNCED ON AN INTERMEDIATE SUCCESS. The whole tail -- the moved
        // announcement, the reload fallback and the closed-sprint re-broadcast -- sits
        // inside the branch that opens only when the queue has emptied; an intermediate
        // success records the drain and nothing else.
        expect(harness.calls.emitted).toHaveLength(0);
        expect(harness.calls.loadSprints).toHaveLength(0);
        expect(harness.calls.loadClosedSprints).toHaveLength(0);
        expect(harness.calls.loadProjectStats).toHaveLength(0);

        await act(async () => {
            harness.recording.pendingOrder[1]!.settle([]);
        });

        // And the announcement arrives exactly once, when the last entry has gone.
        await waitFor(() => {
            expect(harness.calls.emitted).toEqual(['sprint:us:moved']);
        });
    });
});

/* ==========================================================================
 * 13. THE RETAINED CONTROLLER'S MOVE SEAM IS NEVER REACHED
 *
 * ⭐⭐ See {@link RetainedMoveSeam}. The seam is supplied on the realtime service and
 * every case here proves it is never touched. This is the positive form of the
 * ownership rule: the retained methods are right there, reachable, and calling either
 * of them would put the same write into two queues at once.
 * ========================================================================== */

describe('the retained move seam', () => {
    it('writes an order change straight through the injected resource and never through the seam', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.calls.emitted).toEqual(['sprint:us:moved']);
        });

        expect(harness.seam.moveUs).not.toHaveBeenCalled();
        expect(harness.seam.moveUsToTopOfBacklog).not.toHaveBeenCalled();
    });

    it('sends stories to the top of the backlog without the seam either', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUsToTopOfBacklog([STORY_C]);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(harness.seam.moveUsToTopOfBacklog).not.toHaveBeenCalled();
        expect(harness.seam.moveUs).not.toHaveBeenCalled();
    });

    it('leaves the seam untouched for a sprint reassignment as well', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.dispatch({ type: 'TOGGLE_ROW_CHECKBOX', storyId: STORY_A });
        });

        act(() => {
            harness.result.current.dispatch({ type: 'MOVE_SELECTED_TO_SPRINT', target: 'latest' });
        });

        await waitFor(() => {
            expect(harness.recording.milestoneCalls).toHaveLength(1);
        });

        expect(harness.seam.moveUs).not.toHaveBeenCalled();
        expect(harness.seam.moveUsToTopOfBacklog).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * 14. THE ORDERING ARITHMETIC THAT HAS NO ERROR SURFACE
 *
 * ⭐⭐ The endpoint these values reach is POSITION-RELATIVE: it is told which story to
 * land after or before, never at which index. It cannot detect a wrong anchor, so it
 * does what it is told and answers 200. An off-by-one here therefore persists an order
 * the user never chose, with no error, no notice and no console line, and it surfaces
 * on the next page load. Every case below fixes one arrangement whose answer would
 * otherwise be plausible and wrong.
 * ========================================================================== */

/** A second sprint the screen holds, rendered as an empty table. */
const OTHER_SPRINT_ID = 8;

/**
 * An identifier put on the retired library's own placeholder.
 *
 * Chosen to be a story this screen does NOT hold, so a scan that wrongly read the
 * placeholder produces an obviously foreign anchor rather than a plausible one.
 */
const PLACEHOLDER_ID = 555;

describe('the ordering arithmetic', () => {
    it('anchors a MIDDLE drop on the row it landed after', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // The first story lands between the second and the third.
        performDrag(harness, rows[STORY_A]!, { container: body, reference: rows[STORY_C]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const [, , after, before] = harness.recording.orderCalls[0]!;

        // ⭐ PREVIOUS WINS -- trap 2. Both neighbours exist in the document, and the pair
        // is deliberately mutually exclusive: the following one is computed ONLY when
        // there is no preceding one, so a middle drop can never emit both keys. Sending
        // both is not a richer request, it is a different request.
        expect(after).toBe(STORY_B);
        expect(before).toBeNull();
        expect(harness.result.current.state.pendingDrag[0]?.newUsIndex).toBe(1);
    });

    it('computes a SPRINT-to-BACKLOG drop from the destination container', async () => {
        const harness = renderHarness();
        const { rows, body, sprintTable } = harness.scene;

        harness.result.current.drag.registerSprintDragContainer(SPRINT_ID)(sprintTable);

        performDrag(harness, rows[STORY_IN_SPRINT]!, {
            container: body,
            reference: rows[STORY_A]!,
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const [, milestoneId, after, before] = harness.recording.orderCalls[0]!;

        // No destination sprint, and the neighbours are the BACKLOG's -- the container the
        // row was dropped into, never the one it came from.
        expect(milestoneId).toBeNull();
        expect(after).toBeNull();
        expect(before).toBe(STORY_A);
        expect(backlogOrder(harness.result.current.state)).toEqual([
            STORY_IN_SPRINT,
            STORY_A,
            STORY_B,
            STORY_C,
        ]);
        expect(sprintOrder(harness.result.current.state)).toEqual([]);
    });

    it('treats a SPRINT-to-SPRINT drop as a container change and sends the new destination', async () => {
        const harness = renderHarness({ additionalSprintIds: [OTHER_SPRINT_ID] });
        const { rows, root, sprintTable } = harness.scene;
        const { drag } = harness.result.current;

        // The second sprint's table, registered with ITS OWN id.
        const otherTable = document.createElement('div');
        otherTable.className = 'sprint-table';
        root.appendChild(otherTable);

        drag.registerSprintDragContainer(SPRINT_ID)(sprintTable);
        drag.registerSprintDragContainer(OTHER_SPRINT_ID)(otherTable);

        performDrag(harness, rows[STORY_IN_SPRINT]!, { container: otherTable });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // ⭐ THE POSITION IS THE SAME IN BOTH SPRINTS -- index 0 of one, index 0 of the
        // other -- so only the container change makes this a move at all. A verdict built
        // from the index alone would have absorbed it and the story would have snapped
        // back to the sprint it came from.
        expect(harness.recording.orderCalls[0]![1]).toBe(OTHER_SPRINT_ID);
        expect(harness.result.current.state.pendingDrag[0]?.newUsIndex).toBe(0);

        const sprints = harness.result.current.state.sprints;
        expect(sprints[0]?.user_stories.map((story) => story.id)).toEqual([]);
        expect(sprints[1]?.user_stories.map((story) => story.id)).toEqual([STORY_IN_SPRINT]);
    });

    it('reads a neighbour whose identifier is not a positive integer as ABSENT (trap 3)', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // ⛔ PRESERVED. The incumbent tested the attribute for TRUTHINESS and then coerced
        // it, so a zero read as present in one place and absent in another. The shared
        // adapter refuses it outright, and the falsy test that follows is reproduced
        // verbatim rather than "improved" into a null check.
        rows[STORY_A]!.dataset['id'] = '0';

        // The subject lands immediately after that row, which is its nearest PRECEDING
        // candidate.
        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_B]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const [, , after, before] = harness.recording.orderCalls[0]!;

        expect(after).toBeNull();
        // ⭐ TRAP 3 -- because the preceding value is FALSY rather than merely null, the
        // following neighbour is computed as well.
        expect(before).toBe(STORY_B);
    });

    it('yields null, never a not-a-number, for a neighbour with no identifier at all (trap 4)', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        rows[STORY_A]!.removeAttribute('data-id');

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_B]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const [, , after, before] = harness.recording.orderCalls[0]!;

        // ⭐ TRAP 4. A bare coercion would have produced a not-a-number here, and the
        // serialiser turns that into a null FIELD rather than an obviously broken value --
        // so the server would have reordered the backlog around nothing.
        expect(after).toBeNull();
        expect(Number.isNaN(after)).toBe(false);
        expect(before).toBe(STORY_B);
    });

    it('skips the placeholder alone, so a hidden original is still chosen (trap 5)', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // A hidden original of a multi-selection: display-suppressed, still in the
        // document, and NOT carrying the placeholder class -- so it stays a candidate.
        rows[STORY_A]!.style.display = 'none';

        // The retired library's own placeholder, which IS excluded, carrying an
        // identifier no story on this screen has.
        const placeholder = document.createElement('div');
        placeholder.className = `row ${TRANSIT_CLASS}`;
        placeholder.dataset['id'] = String(PLACEHOLDER_ID);
        body.insertBefore(placeholder, rows[STORY_B]!);

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_B]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const [, , after] = harness.recording.orderCalls[0]!;

        // ⭐ TRAP 5, both halves at once: the placeholder immediately before the subject is
        // stepped over, and the hidden row beyond it is accepted. Filtering on visibility
        // would have rejected the hidden one and reached for something further away.
        expect(after).toBe(STORY_A);
        expect(after).not.toBe(PLACEHOLDER_ID);

        // ⭐ AND THE PLACEHOLDER IS STILL COUNTED FOR THE INDEX. That asymmetry is the
        // incumbent's: the neighbour scan excludes it and the index expression does not,
        // and excluding it here as well would shift every index during a drag.
        expect(harness.result.current.state.pendingDrag[0]?.newUsIndex).toBe(2);
    });

    it('persists nothing when the dragged row itself carries no usable identifier', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        rows[STORY_C]!.dataset['id'] = '0';

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        // The shared arithmetic answers with nothing, which is its way of saying "persist
        // nothing" -- the incumbent's bare return, reached here for a subject that could
        // not be identified rather than for an unchanged drop.
        expect(harness.result.current.state.moveUsOutcome).toBeNull();
        expect(harness.recording.orderCalls).toHaveLength(0);
        expect(harness.result.current.state.pendingDrag).toHaveLength(0);

        // And the row goes back where it started, because state never changed.
        expect(body.lastElementChild).toBe(rows[STORY_C]!);
    });

    it('steps over a sibling that is not a row when looking for a neighbour', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // The divider the retained screen splices between rows carries no row class.
        const divider = document.createElement('div');
        divider.className = 'backlog-table-divider';
        body.insertBefore(divider, rows[STORY_B]!);

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_B]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // The divider sits between the subject and the first story, and is transparent to
        // both the scan and the index: the item selector is the row class and nothing else.
        expect(harness.recording.orderCalls[0]![2]).toBe(STORY_A);
        expect(harness.result.current.state.pendingDrag[0]?.newUsIndex).toBe(1);
    });

    it('measures a drop into a sprint by sibling position, because the scoped selector cannot match it', async () => {
        const harness = renderHarness();
        const { rows, sprintTable } = harness.scene;

        harness.result.current.drag.registerSprintDragContainer(SPRINT_ID)(sprintTable);

        // Dropped at the END of a sprint that already holds one story.
        performDrag(harness, rows[STORY_A]!, { container: sprintTable });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        /*
         * ⭐ POSITION 1, NOT -1. The index selector is `.backlog-table-body .row`, so a
         * sprint row is outside its match set entirely and the scoped lookup answers -1; the
         * sibling fallback is what turns that into a real position. Without the fallback the
         * reducer would splice at a negative index and the story would land at the wrong end
         * of the sprint -- and with the scoping dropped instead, every BACKLOG index would
         * shift by one, because the table header carries the row class too.
         */
        expect(harness.result.current.state.pendingDrag[0]?.newUsIndex).toBe(1);
        expect(harness.recording.orderCalls[0]![1]).toBe(SPRINT_ID);
    });
});

/* ==========================================================================
 * 15. THE FROZEN WIRE CONTRACT, KEY BY KEY
 *
 * Suite 4 pins the positional call. This one reads that call back as the BODY the
 * endpoint receives, because three of the contract's rules are invisible in a
 * positional view: a null slot is an ABSENT key rather than a null field, the two
 * neighbour keys are mutually exclusive, and the two endpoints carry DIFFERENT bulk
 * keys. Getting the last of those backwards validates as an empty bulk -- an HTTP 200
 * that moved nothing.
 * ========================================================================== */

/**
 * The order-write body, assembled from the positional call exactly as the frozen
 * resource layer assembles it (`resources/userstories.coffee:92-105`).
 *
 * That layer is out of scope and unchanged, so transcribing its assembly is how a
 * positional call is read back in the endpoint's own terms. Every value asserted below
 * is one this hook produced; the transcription only NAMES it. The three conditionals
 * are truthiness tests, not null checks, and the neighbour pair is an `else if`.
 */
function orderRequestBody(call: OrderArgs): Record<string, unknown> {
    const [projectId, milestoneId, afterUserstoryId, beforeUserstoryId, bulkUserstories] = call;

    const body: Record<string, unknown> = {
        project_id: projectId,
        bulk_userstories: [...bulkUserstories],
    };

    if (milestoneId) {
        body['milestone_id'] = milestoneId;
    }

    if (afterUserstoryId) {
        body['after_userstory_id'] = afterUserstoryId;
    } else if (beforeUserstoryId) {
        body['before_userstory_id'] = beforeUserstoryId;
    }

    return body;
}

/**
 * The sprint-reassignment body (`resources/userstories.coffee:107-110`).
 *
 * Unconditional, all three keys always present -- and the bulk key is `bulk_stories`,
 * which is NOT the order write's.
 */
function milestoneRequestBody(call: MilestoneArgs): Record<string, unknown> {
    const [projectId, milestoneId, data] = call;

    return { project_id: projectId, milestone_id: milestoneId, bulk_stories: [...data] };
}

describe('the frozen wire contract', () => {
    it('emits after_userstory_id ALONE when both neighbours are known', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 1, null, STORY_A, STORY_B);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const body = orderRequestBody(harness.recording.orderCalls[0]!);

        // ⭐ THE NAME INVERSIONS AT THE SEAM: the PRECEDING neighbour becomes
        // `after_userstory_id`, the FOLLOWING one becomes `before_userstory_id`, and the
        // destination sprint becomes `milestone_id`. Reading either neighbour name as the
        // side it came from inverts the whole ordering.
        expect(Object.keys(body).sort()).toEqual([
            'after_userstory_id',
            'bulk_userstories',
            'project_id',
        ]);
        expect(body['after_userstory_id']).toBe(STORY_A);
        expect(Object.keys(body)).not.toContain('before_userstory_id');
    });

    it('emits before_userstory_id alone when only the following neighbour is known', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const body = orderRequestBody(harness.recording.orderCalls[0]!);

        expect(body['before_userstory_id']).toBe(STORY_A);
        expect(Object.keys(body)).not.toContain('after_userstory_id');
        expect(harness.recording.orderArity).toEqual([5]);
    });

    it('emits NEITHER neighbour key when the drop had no anchor at all', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 1, null, null, null);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const [, , after, before] = harness.recording.orderCalls[0]!;
        const body = orderRequestBody(harness.recording.orderCalls[0]!);

        expect(after).toBeNull();
        expect(before).toBeNull();
        expect(Object.keys(body).sort()).toEqual(['bulk_userstories', 'project_id']);
    });

    it('OMITS the destination key entirely for a zero destination, on truthiness', async () => {
        const harness = renderHarness();

        // A destination of zero. No sprint can have that id, and the frozen layer tests the
        // value for TRUTHINESS, so the key is dropped rather than sent as a zero.
        act(() => {
            harness.result.current.drag.moveUs([STORY_A], 0, 0, null, STORY_B);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const [, milestoneId] = harness.recording.orderCalls[0]!;
        const body = orderRequestBody(harness.recording.orderCalls[0]!);

        expect(milestoneId).toBeNull();
        expect(Object.keys(body)).not.toContain('milestone_id');

        // ⭐ AND THIS ENDPOINT CARRIES NO STATUS AT ALL. The BOARD's order write is the one
        // that always sends a status; this one has five slots and none of them is a status,
        // so a specification that expected one here would be describing the other screen.
        expect(harness.recording.orderArity).toEqual([5]);
        expect(Object.keys(body)).not.toContain('status_id');
    });

    it('carries bulk_userstories for an order change and bulk_stories for a reassignment', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const orderBody = orderRequestBody(harness.recording.orderCalls[0]!);

        expect(orderBody['bulk_userstories']).toEqual([STORY_C]);
        expect(Object.keys(orderBody)).not.toContain('bulk_stories');

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        act(() => {
            harness.result.current.dispatch({ type: 'TOGGLE_ROW_CHECKBOX', storyId: STORY_A });
        });

        act(() => {
            harness.result.current.dispatch({ type: 'MOVE_SELECTED_TO_SPRINT', target: 'latest' });
        });

        await waitFor(() => {
            expect(harness.recording.milestoneCalls).toHaveLength(1);
        });

        const milestoneBody = milestoneRequestBody(harness.recording.milestoneCalls[0]!);

        // ⭐ THE OTHER KEY, AND THE OTHER SHAPE: story records rather than bare ids, each
        // carrying both required integers.
        expect(Object.keys(milestoneBody).sort()).toEqual([
            'bulk_stories',
            'milestone_id',
            'project_id',
        ]);
        expect(Object.keys(milestoneBody)).not.toContain('bulk_userstories');
        expect(harness.recording.milestoneArity).toEqual([3]);

        const entries = harness.recording.milestoneCalls[0]![2];
        expect(entries).toHaveLength(1);
        expect(Object.keys(entries[0] ?? {}).sort()).toEqual(['order', 'us_id']);
    });
});

/* ==========================================================================
 * 16. RECONCILIATION, STRUCTURAL SHARING, AND THE PLAIN-DATA BOUNDARY
 *
 * Suite 2 pins the reconciliation of ONE write. This suite pins it for the SECOND write
 * of a drained queue -- the one a "reconcile the first response and move on"
 * implementation silently skips -- and pins the three properties of the state it writes
 * into: the touched story is replaced, every untouched story keeps its identity, and
 * nothing in it is a live model instance.
 * ========================================================================== */

/**
 * A response row shaped like a live dirty-tracking model.
 *
 * ⭐ P-IMMER-1. The producer library's drafts do not tolerate class instances: a model
 * carries its own modified-attribute bookkeeping, and putting one into a draft yields
 * undefined behaviour. Model-shaped members are therefore attached to a response row
 * here to prove the reconciliation copies the two AUTHORITATIVE VALUES and nothing else
 * -- no bookkeeping crosses into state, so no state object can be handed to a save.
 */
interface ModelShapedOrderRow {
    readonly id: number;
    readonly milestone: null;
    readonly backlog_order: number;
    readonly getAttrs: (patch?: boolean) => Record<string, unknown>;
    readonly toJS: () => Record<string, unknown>;
    readonly _modifiedAttrs: Record<string, unknown>;
}

function modelShapedRow(id: number, order: number): ModelShapedOrderRow {
    return {
        id,
        milestone: null,
        backlog_order: order,
        getAttrs: (): Record<string, unknown> => ({ id, backlog_order: order }),
        toJS: (): Record<string, unknown> => ({ id, backlog_order: order }),
        _modifiedAttrs: { backlog_order: order },
    };
}

describe('reconciliation and the state it writes into', () => {
    it('reconciles the SECOND write of a drained queue, not only the first', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        act(() => {
            harness.result.current.drag.moveUs([STORY_B], 0, null, null, STORY_C);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([
                { id: STORY_C, milestone: null, backlog_order: 11 },
            ]);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(2);
        });

        await act(async () => {
            harness.recording.pendingOrder[1]!.settle([
                { id: STORY_B, milestone: null, backlog_order: 22 },
            ]);
        });

        await waitFor(() => {
            expect(
                harness.result.current.state.userStories.find((story) => story.id === STORY_B)
                    ?.backlog_order,
            ).toBe(22);
        });

        const stories = harness.result.current.state.userStories;

        // ⭐ BOTH authoritative members, from BOTH responses. A drained write whose response
        // was dropped leaves the screen holding an order the server renumbered away.
        expect(stories.find((story) => story.id === STORY_C)?.backlog_order).toBe(11);
        expect(stories.find((story) => story.id === STORY_C)?.milestone).toBeNull();
        expect(stories.find((story) => story.id === STORY_B)?.milestone).toBeNull();
    });

    it('replaces only the reconciled story and preserves every other identity', async () => {
        const harness = renderHarness();

        const storyBefore = (id: number): BacklogRowStory | undefined =>
            harness.result.current.state.userStories.find((story) => story.id === id);

        const untouchedBefore = storyBefore(STORY_A);
        const reconciledBefore = storyBefore(STORY_C);

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([
                { id: STORY_C, milestone: null, backlog_order: 33 },
            ]);
        });

        await waitFor(() => {
            expect(storyBefore(STORY_C)?.backlog_order).toBe(33);
        });

        // ⭐ P-IMMER-4 -- STRUCTURAL SHARING, WHICH IS WHAT REPLACES THE RETIRED
        // COLLECTION LIBRARY'S CHANGE DETECTION. The reordering copied the LIST and the
        // reconciliation copied the ONE story it wrote to; every other story is the very
        // same object, so a memoised row re-renders only when its own story changed.
        expect(storyBefore(STORY_A)).toBe(untouchedBefore);
        expect(storyBefore(STORY_C)).not.toBe(reconciledBefore);
    });

    it('hands back frozen state, so a stray write fails loudly instead of drifting', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const story = harness.result.current.state.userStories[0]!;

        // ⭐ P-IMMER-4's other half: automatic freezing is left ON, so post-production
        // mutation raises rather than corrupting a value the screen is still rendering.
        expect(Object.isFrozen(story)).toBe(true);
        expect(Object.isFrozen(harness.result.current.state.userStories)).toBe(true);
        expect(() => Object.assign(story, { backlog_order: 999 })).toThrow(TypeError);
        expect(harness.result.current.state.userStories[0]?.backlog_order).toBe(story.backlog_order);
    });

    it('copies the authoritative values out of a model-shaped response and nothing else', async () => {
        const harness = renderHarness();

        act(() => {
            harness.result.current.drag.moveUs([STORY_C], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([modelShapedRow(STORY_C, 44)]);
        });

        await waitFor(() => {
            expect(
                harness.result.current.state.userStories.find((story) => story.id === STORY_C)
                    ?.backlog_order,
            ).toBe(44);
        });

        const moved = harness.result.current.state.userStories.find(
            (story) => story.id === STORY_C,
        );

        // ⭐ NOT ONE BOOKKEEPING MEMBER CROSSED THE BOUNDARY. State stays plain data, which
        // is what keeps the producer library able to draft it -- and what keeps a screen
        // from ever handing a state object to a save, which would send a whole object
        // where the model layer sends only the fields that changed.
        expect(Object.keys(moved ?? {})).not.toContain('getAttrs');
        expect(Object.keys(moved ?? {})).not.toContain('toJS');
        expect(Object.keys(moved ?? {})).not.toContain('_modifiedAttrs');
    });

    it('puts nothing but identifiers on the wire', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const [projectId, milestoneId, after, before, bulk] = harness.recording.orderCalls[0]!;

        /*
         * ⭐⭐ WHY THIS MATTERS FAR MORE THAN IT LOOKS. The retained model layer's save
         * sends only the attributes that were modified, together with the concurrency
         * version, and short-circuits entirely when nothing changed
         * (`app/coffee/modules/base/model.coffee:18-64`,
         * `app/coffee/modules/base/repository.coffee:57-59`). A write assembled from
         * flattened copies would start sending whole objects instead, turning every edit
         * into a possible lost update -- two people editing different fields of one story
         * would overwrite each other, and neither would be told.
         *
         * This path sends identifiers and positions ONLY. There is nothing here that could
         * carry a stale field, because there are no fields.
         */
        expect(typeof projectId).toBe('number');
        expect(bulk.every((id) => typeof id === 'number')).toBe(true);

        for (const value of [milestoneId, after, before]) {
            expect(value === null || typeof value === 'number').toBe(true);
        }
    });

    it('marshals the resource answer through unaltered, in both directions', async () => {
        const response: AngularHttpResponse<readonly BacklogOrderResultRow[]> = {
            data: [{ id: STORY_C, milestone: null, backlog_order: 1 }],
            status: 200,
            headers: noHeaders,
        };

        const fulfilling: AngularPromise<AngularHttpResponse<readonly BacklogOrderResultRow[]>> = {
            then(onFulfilled): unknown {
                return onFulfilled(response);
            },
        };

        // Fulfilment: the EXACT value, not a copy and not a re-shape.
        await expect(toNativePromise(fulfilling)).resolves.toBe(response);

        const reason = new Error('the transport refused the write');

        const rejecting: AngularPromise<AngularHttpResponse<readonly BacklogOrderResultRow[]>> = {
            then(_onFulfilled, onRejected): unknown {
                return onRejected(reason);
            },
        };

        // Rejection: the EXACT reason. The interceptor chain surfaces a version conflict, a
        // blocked project and a lost connection through this value, so converting or
        // wrapping it would hide all three.
        await expect(toNativePromise(rejecting)).rejects.toBe(reason);

        // A plain value settles directly, which is what the retained repository does when a
        // model is unmodified: it answers without issuing a request at all.
        await expect(toNativePromise(response)).resolves.toBe(response);
    });
});

/* ==========================================================================
 * 17. THE CONFIGURATION BAG, MEMBER BY MEMBER
 *
 * Suite 7 pins the values. This one pins the SHAPE: the exact members present, the
 * members deliberately absent, and the numbers that must not be unified with the
 * board's. Every one of these is a value the provider silently defaults if the screen
 * leaves it out, which is why the bag is handed over whole.
 * ========================================================================== */

/** The board's autoscroll edge, quoted so the difference is asserted rather than assumed. */
const BOARD_AUTOSCROLL_MARGIN = 100;

describe('the configuration bag', () => {
    it('states the backlog autoscroll numbers and no others', () => {
        const { autoScroll } = renderHarness().result.current.drag.dndProviderProps;

        expect(Object.keys(autoScroll).sort()).toEqual([
            'enabled',
            'getTargets',
            'margin',
            'pixels',
            'scrollWhenOutside',
        ]);

        expect(autoScroll).toEqual(
            expect.objectContaining({
                enabled: true,
                margin: 20,
                pixels: 30,
                scrollWhenOutside: true,
            }),
        );

        /*
         * ⭐ DO NOT UNIFY THE TWO SCREENS. The board passes `margin: 100` and NO pixel step
         * at all, so it drifts at the library's own speed near a much wider edge; this list
         * scrolls a fixed thirty pixels inside a twenty-pixel edge. Both are the
         * incumbent's, taken from two different call sites, and collapsing them into one
         * shared constant would change the feel of whichever screen lost.
         */
        expect(autoScroll.margin).not.toBe(BOARD_AUTOSCROLL_MARGIN);
        expect(autoScroll.pixels).toBe(30);
    });

    it('exposes exactly nine members and no leftover controller helper', () => {
        const { drag } = renderHarness().result.current;

        expect(Object.keys(drag).sort()).toEqual([
            'canMove',
            'dndProviderProps',
            'getContainers',
            'getDraggableData',
            'getDroppableData',
            'moveUs',
            'moveUsToTopOfBacklog',
            'registerDragContainer',
            'registerSprintDragContainer',
        ]);

        /*
         * The retained controller's own first-story indicator and bulk-payload builder are
         * NOT surfaced here. The first is a rendering concern the row components own, and
         * the payload is built by the reducer, which is where the one copy of it belongs.
         */
        expect(Object.keys(drag)).not.toContain('resetFirstStoryIndicator');
        expect(Object.keys(drag)).not.toContain('prepareBulkUpdateData');

        for (const member of [
            'canMove',
            'getContainers',
            'getDraggableData',
            'getDroppableData',
            'moveUs',
            'moveUsToTopOfBacklog',
            'registerDragContainer',
            'registerSprintDragContainer',
        ]) {
            expect(typeof Reflect.get(drag, member)).toBe('function');
        }
    });

    it('hands over every provider member the screen must not forget, and renders nothing itself', () => {
        const props = renderHarness().result.current.drag.dndProviderProps;
        const keys = Object.keys(props);

        expect(keys.sort()).toEqual([
            'autoScroll',
            'collisionDetection',
            'disabled',
            'multiDrag',
            'multiDragCallOrder',
            'onDragCancel',
            'onDragEnd',
            'onDragOver',
            'onDragStart',
            'onMultiDragEnd',
            'onMultiDragStart',
            'renderOverlay',
        ]);

        // The children are the screen's, which is why the bag is the provider's props MINUS
        // them.
        expect(keys).not.toContain('children');

        /*
         * ⭐⭐ A POINTER GESTURE AND NOTHING ELSE. There is no key sensor and no touch
         * sensor to configure here, and none is added: the retired library bound mouse
         * events only, so neither of these screens has ever been draggable from the
         * keyboard. Making them so would be a real improvement and a real behaviour change,
         * and it belongs in its own piece of work covering the screens that stay as they
         * are too -- otherwise the application becomes operable on two screens and not on
         * the rest.
         */
        expect(keys.filter((key) => /sensor|keyboard|touch/i.test(key))).toEqual([]);
        expect(props.activationDistance).toBeUndefined();

        // This is a hook, not a component: the runner's host element stays empty.
        const hosts = Array.from(document.body.children).filter(
            (node) => !node.classList.contains('backlog-page'),
        );

        expect(hosts.length).toBeGreaterThan(0);
        expect(hosts.every((node) => node.childElementCount === 0)).toBe(true);
    });

    it('forwards the overlay renderer and the collision strategy untouched', () => {
        const renderOverlay: UseStoryDragOptions['renderOverlay'] = () => null;
        const collisionDetection: UseStoryDragOptions['collisionDetection'] = () => [];

        const bare = renderHarness().result.current.drag.dndProviderProps;

        expect(bare.renderOverlay).toBeUndefined();
        expect(bare.collisionDetection).toBeUndefined();

        const supplied = renderHarness({ renderOverlay, collisionDetection }).result.current.drag
            .dndProviderProps;

        /*
         * ⭐ THE OVERLAY RENDERER IS NOT COSMETIC. It is the seam the retired library's clone
         * handler became: the provider arms the multi-selection once the overlay node is in
         * the document, and the shared controller then stacks the ghost clones against that
         * node and marks each of them with the multiple-drag mirror class -- which is what
         * the retained ghost block in the shared card partial is styled for, two placeholder
         * blocks that stay hidden until the multi-transit class reveals them. That partial
         * and its stylesheet are shared with a screen outside this work and are never
         * touched. With no overlay renderer the stack never appears and the class is never
         * applied: no error, no warning, just a multi-row drag that shows one row.
         */
        expect(supplied.renderOverlay).toBe(renderOverlay);
        expect(supplied.collisionDetection).toBe(collisionDetection);
        expect(supplied.multiDragCallOrder).toBe('start-then-elements');
    });

    it('invents no sprint identity for a table that carries none', async () => {
        const harness = renderHarness();
        const { rows, sprintTable } = harness.scene;

        // Never registered, so nothing stamped it -- and the retained partial renders no
        // such attribute of its own.
        expect(sprintTable.hasAttribute('data-sprint-id')).toBe(false);

        performDrag(harness, rows[STORY_A]!, { container: sprintTable });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // ⛔ NO ANCESTOR WALK, NO SIBLING COUNT, NO REGISTRATION-ORDER GUESS. The identity is
        // read from the stamped attribute and from nothing else, so an unstamped table
        // yields no destination rather than a plausible wrong one -- and a wrong sprint id
        // here would move stories into a sprint nobody chose.
        expect(harness.recording.orderCalls[0]![1]).toBeNull();
        expect(sprintTable.hasAttribute('data-sprint-id')).toBe(false);
    });
});

/* ==========================================================================
 * 18. THE SIDE EFFECTS THIS SCREEN OWNS, AND THE GATE IT PRESERVES
 * ========================================================================== */

describe('the screen-owned side effects', () => {
    it('marks the document body for the duration of the gesture', () => {
        const harness = renderHarness();
        const { drag } = harness.result.current;
        const props = drag.dndProviderProps;
        const { rows } = harness.scene;
        const moved = rows[STORY_C]!;

        expect(document.body.classList.contains('drag-active')).toBe(false);

        act(() => {
            props.onDragStart?.(
                activeFor(drag, moved) as Parameters<NonNullable<typeof props.onDragStart>>[0],
            );
        });

        /*
         * ⭐ THE BACKLOG DOES THIS AND THE BOARD DOES NOT. The mark is on the document BODY
         * rather than on the list, because the rules it drives suppress selection and
         * pointer feedback across the whole page while a row is in flight. Dropping it would
         * leave text selecting under the pointer mid-drag on this screen only.
         */
        expect(document.body.classList.contains('drag-active')).toBe(true);

        act(() => {
            props.onDragEnd?.(
                activeFor(drag, moved) as Parameters<NonNullable<typeof props.onDragEnd>>[0],
            );
        });

        expect(document.body.classList.contains('drag-active')).toBe(false);
    });

    it('never writes the multi-selection marker class, which belongs to the screen', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // The screen puts it on the rows it has selected; the drag layer only READS it.
        rows[STORY_A]!.classList.add(MULTIPLE_SORTABLE_CLASS);

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // Exactly where the screen left it, on exactly one element: nothing was added to the
        // dragged row, the container or the document.
        expect(rows[STORY_A]!.classList.contains(MULTIPLE_SORTABLE_CLASS)).toBe(true);
        expect(rows[STORY_C]!.classList.contains(MULTIPLE_SORTABLE_CLASS)).toBe(false);
        expect(body.classList.contains(MULTIPLE_SORTABLE_CLASS)).toBe(false);
        expect(document.querySelectorAll(`.${MULTIPLE_SORTABLE_CLASS}`)).toHaveLength(1);
    });

    it('leaves the gesture enabled for a member who may modify stories on an archived project', () => {
        const harness = renderHarness({
            project: { my_permissions: ['modify_us'], archived_code: 'archived' },
        });

        expect(harness.result.current.drag.dndProviderProps.disabled).toBe(false);
    });

    it('⛔ reproduces the gate across its whole truth table, precedence and all', () => {
        const cases: ReadonlyArray<{
            readonly permissions: readonly string[];
            readonly archived: string | null;
            readonly disabled: boolean;
        }> = [
            { permissions: ['modify_us'], archived: null, disabled: false },
            { permissions: ['modify_us'], archived: 'archived', disabled: false },
            { permissions: ['view_us'], archived: null, disabled: true },
            // ⛔ THE PRESERVED PRECEDENCE. The refusal reads "not (has the permission) and
            // not archived", and the negation binds to the lookup alone -- so an archived
            // project stays draggable for a member who may not modify stories. It reads like
            // an inversion and it is exactly what the retained screen does; asserting the
            // sensible precedence here would be asserting an improvement, which this work
            // does not make.
            { permissions: ['view_us'], archived: 'archived', disabled: false },
        ];

        for (const scenario of cases) {
            const project: BacklogDragProject = {
                my_permissions: scenario.permissions,
                archived_code: scenario.archived,
            };

            const harness = renderHarness({ project });

            expect(harness.result.current.drag.dndProviderProps.disabled).toBe(scenario.disabled);
            // The autoscroll follows the same verdict, so a refused gesture cannot scroll the
            // page either.
            expect(harness.result.current.drag.dndProviderProps.autoScroll.enabled).toBe(
                !scenario.disabled,
            );
        }
    });

    it('computes no permission notion of its own', () => {
        // The list is read by index lookup, exactly as the retained directive reads it, so an
        // unrelated permission neither grants nor withholds the gesture.
        expect(
            renderHarness({ project: { my_permissions: [] } }).result.current.drag.dndProviderProps
                .disabled,
        ).toBe(true);

        expect(
            renderHarness({ project: { my_permissions: ['modify_us', 'delete_us'] } }).result.current
                .drag.dndProviderProps.disabled,
        ).toBe(false);
    });

    it('leaves the row lifecycle classes the screen renders alone', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // The marker the retained screen puts on a freshly created story.
        rows[STORY_C]!.classList.add('new');

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(rows[STORY_C]!.classList.contains('new')).toBe(true);
        expect(rows[STORY_C]!.classList.contains('us-item-row')).toBe(true);
    });

    it('leaves the incumbent dead code dead', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // The retained handler read a checkbox state into a variable nothing used.
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        rows[STORY_C]!.appendChild(checkbox);

        // And it computed an index against the BOARD's card element, which both following
        // branches immediately overwrote.
        const boardCard = document.createElement('tg-card');
        body.insertBefore(boardCard, rows[STORY_A]!);

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // Identical to the same drop without either of them: the checkbox is not consulted
        // and the board's element is not what the position is measured against.
        expect(harness.result.current.state.pendingDrag[0]?.newUsIndex).toBe(0);
        expect(harness.recording.orderCalls[0]![3]).toBe(STORY_A);
        expect(checkbox.checked).toBe(true);
    });
});

/* ==========================================================================
 * 19. THE MULTI-SELECTION, WHICH THE ADOPTED LIBRARY DOES NOT PROVIDE
 *
 * R-DND-1: the adopted library has no multi-item drag of its own, so the whole of it is
 * hand-built in the shared controller and reported to this hook through two callbacks.
 * The property that is easy to lose is not "several rows move" -- it is WHICH row every
 * measurement is taken against.
 * ========================================================================== */

describe('the multi-selection', () => {
    it('measures the gesture against the FIRST SELECTED row, not the grabbed one', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // The first story is grabbed, and the selection reports the LAST story first.
        performDrag(harness, rows[STORY_A]!, { container: body, reference: rows[STORY_C]! }, [
            rows[STORY_C]!,
            rows[STORY_A]!,
        ]);

        /*
         * ⭐⭐ NOTHING IS PERSISTED, and that is the point. The grabbed row moved from the
         * head of the list to the middle, but the FIRST SELECTED row sits at the same
         * position it began at, so the unchanged-drop guard absorbs the gesture -- which is
         * precisely what the retained screen does, because it arms the selection first and
         * then re-reads its own first element to measure. A hook that measured the grabbed
         * row would send a request the retained screen never sends.
         */
        expect(harness.recording.orderCalls).toHaveLength(0);
        expect(harness.result.current.state.pendingDrag).toHaveLength(0);
    });

    it('does persist the same drop when no selection is reported', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        // The control for the case above: the identical drop, with no selection.
        performDrag(harness, rows[STORY_A]!, { container: body, reference: rows[STORY_C]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(harness.recording.orderCalls[0]![4]).toEqual([STORY_A]);
    });

    it('treats an EMPTY selection report as "not a multi-selection"', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;
        const { drag } = harness.result.current;
        const props = drag.dndProviderProps;
        const moved = rows[STORY_C]!;

        act(() => {
            props.onDragStart?.(
                activeFor(drag, moved) as Parameters<NonNullable<typeof props.onDragStart>>[0],
            );
        });

        // The controller reports nothing at both ends of the gesture, which is how it says
        // the gesture is a single row.
        act(() => {
            props.onMultiDragStart?.(
                [],
                activeFor(drag, moved) as Parameters<NonNullable<typeof props.onMultiDragStart>>[1],
            );
        });

        act(() => {
            props.onDragOver?.(
                overFor(drag, { container: body, reference: rows[STORY_A]! }) as Parameters<
                    NonNullable<typeof props.onDragOver>
                >[0],
            );
        });

        act(() => {
            props.onMultiDragEnd?.(
                [],
                activeFor(drag, moved) as Parameters<NonNullable<typeof props.onMultiDragEnd>>[1],
            );
            props.onDragEnd?.(
                activeFor(drag, moved) as Parameters<NonNullable<typeof props.onDragEnd>>[0],
            );
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        // The grabbed row alone, and the start measurement taken at drag start still stands.
        expect(harness.recording.orderCalls[0]![4]).toEqual([STORY_C]);
    });

    it('carries every selected row, in the order the selection reported them', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! }, [
            rows[STORY_B]!,
            rows[STORY_C]!,
        ]);

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(harness.recording.orderCalls[0]![4]).toEqual([STORY_B, STORY_C]);
    });

    it('builds its controller from the FACTORY, so two screens never share one gesture', () => {
        const first = renderHarness().result.current.drag.dndProviderProps.multiDrag;
        const second = renderHarness().result.current.drag.dndProviderProps.multiDrag;

        expect(first).toBeDefined();
        expect(second).toBeDefined();

        // ⭐ Two mounted screens, two controllers. A module-level singleton would let one
        // screen's teardown reset the other's hidden originals and clones mid-drag.
        expect(first).not.toBe(second);

        // The factory itself answers with a fresh controller each time, which is the property
        // the hook depends on.
        const own = createMultiDrag();
        const another = createMultiDrag();

        try {
            expect(own).not.toBe(another);
            expect(own.inProgress).toBe(false);
            expect(typeof own.start).toBe('function');
            expect(typeof own.stop).toBe('function');
            expect(typeof own.getElements).toBe('function');
        } finally {
            own.destroy();
            another.destroy();
        }
    });
});

/* ==========================================================================
 * 20. WHAT THIS HOOK REFUSES TO REACH FOR
 *
 * Two refusals, both invisible when broken. The first keeps the AngularJS scope services
 * out of React entirely; the second keeps the two coordination announcements on the
 * channel the retained listeners are actually registered on.
 * ========================================================================== */

describe('the refusals', () => {
    it('asks the AngularJS injector for nothing whatsoever', async () => {
        const injector = mockInjector({});
        const request = jest.spyOn(injector, 'get');

        const harness = renderHarness({ wrapper: withMockInjector(injector) });
        const { rows, body } = harness.scene;

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.calls.emitted).toEqual(['sprint:us:moved']);
        });

        /*
         * ⭐ THE INJECTOR IS RIGHT THERE AND IS NEVER ASKED. Every service this hook needs
         * arrives as an argument, which is what makes the whole machine drivable without
         * AngularJS at all -- and it is also the mechanism by which the scope services stay
         * unreachable: the accessor's map excludes them deliberately, and the one sanctioned
         * exception exposes a listener registrar and nothing more. This injector supplies
         * nothing, so a single request would have thrown a diagnosable error here.
         */
        expect(request).not.toHaveBeenCalled();
    });

    it('announces both coordination events through the supplied emitter and dispatches no DOM event', async () => {
        const closed = sprint(CLOSED_SPRINT_ID, [
            sprintStory(STORY_IN_SPRINT, CLOSED_SPRINT_ID, 0),
        ]);

        const harness = renderHarness({
            backlog: [STORY_A],
            sprintStories: [],
            closedSprints: [{ ...closed, closed: true }],
        });

        const windowDispatch = jest.spyOn(window, 'dispatchEvent');
        const documentDispatch = jest.spyOn(document, 'dispatchEvent');

        act(() => {
            harness.result.current.drag.moveUs([STORY_IN_SPRINT], 0, null, null, STORY_A);
        });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        await act(async () => {
            harness.recording.pendingOrder[0]!.settle([]);
        });

        await waitFor(() => {
            expect(harness.calls.emitted).toEqual([
                'sprint:us:moved',
                'backlog:load-closed-sprints',
            ]);
        });

        const dispatched = [...windowDispatch.mock.calls, ...documentDispatch.mock.calls].map(
            ([event]) => event.type,
        );

        /*
         * ⛔ A DOCUMENT-LEVEL EVENT IS NOT A SUBSTITUTE. The listeners for both of these are
         * registered on the AngularJS scope hierarchy -- the doom-line directive listens for
         * the first, the retained controller for the second -- and neither would ever see an
         * event dispatched on the window or the document. The emitter is supplied by the
         * bridge for exactly this reason and is required rather than optional, so a screen
         * cannot lose the two announcements by omission.
         */
        expect(dispatched).not.toContain('sprint:us:moved');
        expect(dispatched).not.toContain('backlog:load-closed-sprints');
    });
});

/* ==========================================================================
 * 21. THE REMAINING OWNERSHIP BOUNDARIES
 *
 * Four boundaries that are each invisible until they move: which parts of a sprint a
 * move is allowed to touch, who drives the multi-selection controller, whether a row has
 * to be measurable to be usable, and which resource a write lands on.
 * ========================================================================== */

describe('the ownership boundaries', () => {
    it('⛔ leaves a sprint\'s own members untouched, MU-3 and all', async () => {
        const harness = renderHarness({ additionalSprintIds: [OTHER_SPRINT_ID] });
        const { rows, sprintTable } = harness.scene;

        const before = harness.result.current.state.sprints[0];
        const otherBefore = harness.result.current.state.sprints[1];

        harness.result.current.drag.registerSprintDragContainer(SPRINT_ID)(sprintTable);

        performDrag(harness, rows[STORY_A]!, { container: sprintTable });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        const after = harness.result.current.state.sprints[0];

        // The story joined the sprint, which is the whole of the local effect.
        expect(after?.user_stories.map((story) => story.id)).toContain(STORY_A);

        /*
         * ⛔ MU-3 IS PRESERVED BY HAVING NOTHING TO PRESERVE. The retained controller mapped
         * over its sprint list calling the merge helper with a SINGLE argument, which hands
         * back the very same reference and merges nothing -- the surrounding map was reaching
         * for the new object identities a change detector needs. The producer library
         * supplies exactly those identities for the sprint that was touched and keeps them
         * for every sprint that was not, so there is no second argument to "restore": it
         * never existed. What must hold is that the move rewrites the story list and NOTHING
         * ELSE about the sprint.
         */
        expect(after?.name).toBe(before?.name);
        expect(after?.slug).toBe(before?.slug);
        expect(after?.total_points).toBe(before?.total_points);
        expect(after?.closed_points).toBe(before?.closed_points);
        expect(after?.estimated_start).toBe(before?.estimated_start);
        expect(after?.estimated_finish).toBe(before?.estimated_finish);
        expect(after?.closed).toBe(before?.closed);

        // And the sprint nobody dragged into keeps its identity outright.
        expect(harness.result.current.state.sprints[1]).toBe(otherBefore);
    });

    it('drives the multi-selection controller through the provider and never calls it directly', async () => {
        const controller = {
            start: jest.fn<void, unknown[]>(),
            stop: jest.fn<readonly HTMLElement[], unknown[]>(() => []),
            getElements: jest.fn<readonly HTMLElement[], unknown[]>(() => []),
            isMultiple: jest.fn<boolean, unknown[]>(() => false),
            reset: jest.fn<void, unknown[]>(),
            inProgress: false,
            destroy: jest.fn<void, unknown[]>(),
        };

        const harness = renderHarness({ multiDrag: controller });
        const { rows, body } = harness.scene;

        performDrag(harness, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        /*
         * ⭐⭐ THE ARM-THEN-READ ORDER IS DECLARED, NOT PERFORMED HERE. This screen arms the
         * selection and then reads its elements back, and the board does the reverse; the
         * provider performs both calls, so the ordering crosses as the value asserted in
         * suite 7 rather than as a call this hook makes. The controller is handed over and
         * left alone -- and the difference matters, because a hook that armed the selection
         * itself would arm it a second time behind the provider's back and the two would
         * disagree about which rows are moving.
         */
        expect(controller.start).not.toHaveBeenCalled();
        expect(controller.getElements).not.toHaveBeenCalled();
        expect(controller.stop).not.toHaveBeenCalled();
        expect(controller.isMultiple).not.toHaveBeenCalled();
        expect(controller.reset).not.toHaveBeenCalled();

        expect(harness.result.current.drag.dndProviderProps.multiDrag).toBe(controller);
        expect(harness.result.current.drag.dndProviderProps.multiDragCallOrder).toBe(
            'start-then-elements',
        );
    });

    it('never consults geometry, so an unmeasurable row is still a subject and a neighbour (R-DND-3)', async () => {
        const harness = renderHarness();
        const { rows, body } = harness.scene;

        /*
         * ⭐ R-DND-3 IS SATISFIED STRUCTURALLY HERE. This screen has no columns and no
         * swimlanes, so it does not virtualise: the viewport helper the board needs is not
         * reached for at all, and nothing on this path asks a row for its size, its computed
         * display or an offsetted ancestor. Every row in this environment reports an empty
         * rectangle, and the rows below are additionally display-suppressed -- if geometry
         * were consulted anywhere, neither could be dragged and neither could be an anchor.
         */
        const subject = rows[STORY_C]!;
        const anchor = rows[STORY_A]!;

        subject.style.display = 'none';
        anchor.style.display = 'none';

        const rect = subject.getBoundingClientRect();
        expect(rect.width).toBe(0);
        expect(rect.height).toBe(0);

        expect(harness.result.current.drag.canMove(subject)).toBe(true);
        expect(harness.result.current.drag.getDroppableData(anchor)).toEqual({
            itemNode: anchor,
            containerNode: body,
        });

        performDrag(harness, subject, { container: body, reference: anchor });

        await waitFor(() => {
            expect(harness.recording.orderCalls).toHaveLength(1);
        });

        expect(harness.recording.orderCalls[0]![3]).toBe(STORY_A);
        expect(harness.result.current.state.pendingDrag[0]?.newUsIndex).toBe(0);
    });

    it('writes only to the resource its own instance was given', async () => {
        const first = renderHarness();
        const second = renderHarness();

        const { rows, body } = first.scene;

        performDrag(first, rows[STORY_C]!, { container: body, reference: rows[STORY_A]! });

        await waitFor(() => {
            expect(first.recording.orderCalls).toHaveLength(1);
        });

        /*
         * ⭐ NO SHARED CLIENT ANYWHERE. The write reached the sub-resource this instance was
         * handed and no other, which is the observable form of "there is one transport and
         * the AngularJS layer owns it": a request assembled here would have had to come from
         * somewhere else, and the second instance's recorder would still be empty either way,
         * so the assertion that matters is that the FIRST one is not.
         */
        expect(second.recording.orderCalls).toHaveLength(0);
        expect(second.recording.milestoneCalls).toHaveLength(0);
        expect(first.recording.orderCalls[0]![4]).toEqual([STORY_C]);
    });

    it('registers every container the retained screen registers, sprints included', () => {
        const harness = renderHarness({ additionalSprintIds: [OTHER_SPRINT_ID] });
        const { drag } = harness.result.current;
        const { body, emptyFiltered, emptyLarge, sprintTable, root } = harness.scene;

        const otherTable = document.createElement('div');
        otherTable.className = 'sprint-table';
        root.appendChild(otherTable);

        drag.registerDragContainer(body);
        drag.registerDragContainer(emptyFiltered);
        drag.registerDragContainer(emptyLarge);
        drag.registerSprintDragContainer(SPRINT_ID)(sprintTable);
        drag.registerSprintDragContainer(OTHER_SPRINT_ID)(otherTable);

        // The table body, BOTH empty-backlog blocks -- one for a filtered-empty backlog and
        // one for a genuinely empty one -- and EVERY sprint table, in registration order.
        expect(drag.getContainers()).toEqual([
            body,
            emptyFiltered,
            emptyLarge,
            sprintTable,
            otherTable,
        ]);

        // Registering the same element twice does not visit it twice.
        drag.registerDragContainer(body);
        expect(drag.getContainers()).toHaveLength(5);
    });
});
