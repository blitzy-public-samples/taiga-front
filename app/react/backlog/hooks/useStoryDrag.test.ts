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
 *
 * The suite is browserless and offline BY CONSTRUCTION: it touches no browser interface
 * beyond the jsdom the runner supplies, launches no browser, imports no end-to-end
 * runner, opens no socket, issues no request and depends on no build output. The
 * resource double resolves AngularJS-shaped promises rather than native ones, because
 * adopting one is part of what the code under test does.
 */

import { produce } from 'immer';
import { useReducer } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { AngularHttpResponse, AngularPromise } from '../../bridge/useAngularService';
import type { MultiDragController } from '../../shared/dnd/multiDrag';
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
    readonly milestoneCalls: MilestoneArgs[];
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
    const milestoneCalls: MilestoneArgs[] = [];
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

    return { resource, orderCalls, milestoneCalls, pendingOrder, pendingMilestone };
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
    readonly closedSprints?: readonly BacklogSprint[] | null;
    readonly project?: BacklogDragProject;
    readonly connected?: boolean;
    readonly displayVelocity?: boolean;
    readonly multiDrag?: MultiDragController;
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

    const realtime = { connected: options.connected ?? true };

    let tick = 0;
    const stamp = (sink: number[]): void => {
        tick += 1;
        sink.push(tick);
    };

    const hydration = {
        userStories: backlog.map((id, index) => backlogStory(id, index)),
        sprints: [sprint(SPRINT_ID, sprintStoryIds.map((id, index) => sprintStory(id, SPRINT_ID, index)))],
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
            services: { userstories: recording.resource, realtime },
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
        };

        return { drag: useStoryDrag(hookOptions), state, dispatch };
    });

    return {
        result: rendered.result,
        scene,
        recording,
        calls: {
            emitted,
            loadSprints,
            loadClosedSprints,
            loadProjectStats,
            toggleVelocity,
            calculateForecasting,
        },
        setConnected: (value: boolean): void => {
            realtime.connected = value;
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
