/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BacklogDndContext.integration.test.tsx — browserless Jest + jsdom spec for the
 * Backlog / Sprint-planning drag-and-drop layer `../dnd/BacklogDndContext` (the
 * React 18 port of the AngularJS `tgBacklogSortable` directive: dragula +
 * dom-autoscroller).
 *
 * WHY THIS SPEC EXISTS (w009#8)
 *   The pure payload helpers (`computeBacklogMovePayload`, `computeNeighbors`,
 *   `resolveDraggedIds`, `isSamePosition`) are already unit-tested directly by
 *   `computeBacklogMovePayload.test.ts`. This spec closes the coverage gap on
 *   the IMPURE parts that only run inside the mounted component:
 *     - the `BacklogDndContext` provider body (`usById` / `orderedIdsFor`
 *       memoization, `sensors`, the `modify_us` + `archived_code` `draggable`
 *       gate, `collisionDetection`, `handleDragStart` / `handleDragEnd` /
 *       `handleDragCancel`, and the `DragOverlay` single/multi mirror);
 *     - the private `computeOverIndex` DOM helper (translated-rect center-Y vs
 *       each `[data-id]` row's `getBoundingClientRect`, including the empty
 *       target and missing-row branches),
 *   bringing this file toward parity with `KanbanDndContext.test.tsx` (100%).
 *
 * TEST-LAYER ISOLATION (identical to every backlog __tests__ spec)
 *   - `.tsx` using the automatic JSX runtime, so there is deliberately NO
 *     `import React`.
 *   - jest globals + jest-dom matchers are AMBIENT (root `tsconfig.json` `types`
 *     + `jest.config.js` `setupFilesAfterEnv`), so neither is imported.
 *   - `@dnd-kit/core` is MOCKED to a thin render/dispatch shim so the drag
 *     lifecycle is exercised deterministically in jsdom (real pointer/keyboard
 *     sensor drags are validated by the Playwright e2e layer, not here). The
 *     mock captures the `DndContext` callbacks + `collisionDetection` on
 *     `globalThis.__bdndMock` so the factory references no out-of-scope module
 *     variable. No dragula / dom-autoscroller / immutable / checksley / jquery /
 *     angular imports, no network, no real browser. Node v16.19.1 compatible.
 */

/* eslint-disable @typescript-eslint/no-empty-function */

/* ---------------------------------------------------------------------------
 * @dnd-kit/core mock — a minimal shim that (a) renders `DndContext` /
 * `DragOverlay` children inline, (b) captures the drag callbacks +
 * `collisionDetection` on `globalThis.__bdndMock` so tests can drive the
 * lifecycle with fabricated events, and (c) lets `pointerWithin` /
 * `rectIntersection` return store-configured collision arrays so BOTH branches
 * of the module's `collisionDetection` are reachable.
 * ------------------------------------------------------------------------- */
jest.mock('@dnd-kit/core', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const react = require('react');

    const getStore = () => {
        const g = globalThis as unknown as {
            __bdndMock?: {
                onDragStart?: (e: unknown) => void;
                onDragEnd?: (e: unknown) => void;
                onDragCancel?: () => void;
                collisionDetection?: (args: unknown) => unknown;
                pointerResult?: unknown[];
                rectResult?: unknown[];
            };
        };
        if (!g.__bdndMock) {
            g.__bdndMock = {};
        }
        return g.__bdndMock;
    };

    return {
        __esModule: true,
        DndContext: (props: {
            children?: unknown;
            onDragStart?: (e: unknown) => void;
            onDragEnd?: (e: unknown) => void;
            onDragCancel?: () => void;
            collisionDetection?: (args: unknown) => unknown;
        }) => {
            const store = getStore();
            store.onDragStart = props.onDragStart;
            store.onDragEnd = props.onDragEnd;
            store.onDragCancel = props.onDragCancel;
            store.collisionDetection = props.collisionDetection;
            return react.createElement(react.Fragment, null, props.children);
        },
        DragOverlay: (props: { children?: unknown }) =>
            react.createElement(react.Fragment, null, props.children),
        PointerSensor: function PointerSensor() {},
        KeyboardSensor: function KeyboardSensor() {},
        useSensor: (sensor: unknown, options?: unknown) => ({ sensor, options }),
        useSensors: (...sensors: unknown[]) => sensors,
        // Return store-configured arrays so the module's collisionDetection can
        // exercise BOTH the pointer-hit and the rectIntersection-fallback branch.
        pointerWithin: () => getStore().pointerResult ?? [],
        rectIntersection: () => getStore().rectResult ?? [],
    };
});

import { render, cleanup, act } from '@testing-library/react';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';

import { BacklogDndContext } from '../dnd/BacklogDndContext';
import type { BacklogMovePayload } from '../dnd/BacklogDndContext';
import { makeProject, makeUserStory, makeMilestone } from './factories';
import type { Project, UserStory, Milestone } from '../../shared/types';

/* ========================================================================== *
 * Typed access to the @dnd-kit mock store
 * ========================================================================== */

interface BDndMockStore {
    onDragStart?: (e: unknown) => void;
    onDragEnd?: (e: unknown) => void;
    onDragCancel?: () => void;
    collisionDetection?: (args: unknown) => unknown;
    pointerResult?: unknown[];
    rectResult?: unknown[];
}

function dndMock(): BDndMockStore {
    const g = globalThis as unknown as { __bdndMock?: BDndMockStore };
    if (!g.__bdndMock) {
        g.__bdndMock = {};
    }
    return g.__bdndMock;
}

/* ========================================================================== *
 * Fixtures + harness
 * ========================================================================== */

/** A project whose `my_permissions` grants `modify_us` -> `isBoardDraggable` true. */
function draggableProject(overrides: Partial<Project> = {}): Project {
    return makeProject({ my_permissions: ['view_us', 'modify_us'], ...overrides });
}

/** Build a backlog story with a given id (ref mirrors id for readable overlays). */
function us(id: number, overrides: Partial<UserStory> = {}): UserStory {
    return makeUserStory({ id, ref: id, subject: `Story ${id}`, milestone: null, ...overrides });
}

interface HarnessOpts {
    project?: Project;
    canModifyUs?: boolean;
    backlog?: UserStory[];
    sprints?: Milestone[];
    selectedUsIds?: number[];
    /** ids to actually render as `[data-id]` rows (defaults to every id). */
    renderIds?: number[];
    onMove?: jest.Mock;
}

interface HarnessResult {
    onMove: jest.Mock;
    container: HTMLElement;
}

/**
 * Render `<BacklogDndContext>` around plain `[data-id]` rows for the backlog and
 * each sprint container — exactly the DOM contract `computeOverIndex` relies on
 * (globally-unique `[data-id]` per row).
 */
function renderDnd(opts: HarnessOpts = {}): HarnessResult {
    const backlog = opts.backlog ?? [us(1), us(2), us(3)];
    const sprints = opts.sprints ?? [];
    const onMove = opts.onMove ?? jest.fn();
    const project = opts.project ?? draggableProject();
    const canModifyUs = opts.canModifyUs ?? true;

    const rowIds =
        opts.renderIds ??
        [
            ...backlog.map((u) => u.id),
            ...sprints.flatMap((s) => (s.user_stories ?? []).map((u) => u.id)),
        ];
    const shouldRender = (id: number) => rowIds.includes(id);

    const { container } = render(
        <BacklogDndContext
            project={project}
            canModifyUs={canModifyUs}
            userstories={backlog}
            sprints={sprints}
            selectedUsIds={opts.selectedUsIds}
            onMove={onMove}
        >
            <div className="backlog-table-body">
                {backlog
                    .filter((u) => shouldRender(u.id))
                    .map((u) => (
                        <div key={u.id} className="row" data-id={String(u.id)}>
                            #{u.ref}
                        </div>
                    ))}
            </div>
            {sprints.map((s) => (
                <div key={s.id} className="sprint-table" data-sprint={String(s.id)}>
                    {(s.user_stories ?? [])
                        .filter((u) => shouldRender(u.id))
                        .map((u) => (
                            <div key={u.id} className="row" data-id={String(u.id)}>
                                #{u.ref}
                            </div>
                        ))}
                </div>
            ))}
        </BacklogDndContext>,
    );

    return { onMove, container };
}

/* ---- rect stubbing for computeOverIndex --------------------------------- */

let rectSpy: jest.SpyInstance | undefined;

function rectAt(top: number, height: number) {
    return {
        top,
        left: 0,
        width: 100,
        height,
        right: 100,
        bottom: top + height,
        x: 0,
        y: top,
        toJSON: () => ({}),
    } as unknown as DOMRect;
}

/** Stub `getBoundingClientRect` per `[data-id]` so row center-Y is deterministic. */
function stubRects(rectById: Record<number, { top: number; height: number }>): void {
    rectSpy = jest
        .spyOn(Element.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: Element) {
            const id = this.getAttribute?.('data-id');
            if (id != null && rectById[Number(id)]) {
                const r = rectById[Number(id)];
                return rectAt(r.top, r.height);
            }
            return rectAt(0, 0);
        });
}

/* ---- fabricated @dnd-kit events ----------------------------------------- */

function startEvent(activeId: number, fromSprintId: number | null): DragStartEvent {
    return {
        active: {
            id: activeId,
            data: { current: { type: 'us', usId: activeId, fromSprintId } },
        },
    } as unknown as DragStartEvent;
}

type Over =
    | null
    | { type: 'backlog' }
    | { type: 'sprint'; sprintId: number };

function endEvent(params: {
    activeId: number;
    fromSprintId: number | null;
    over: Over;
    translated?: { top: number; height: number } | null;
    /** override active.data.current with undefined to hit the missing-data guard. */
    noActiveData?: boolean;
}): DragEndEvent {
    const translated =
        params.translated === undefined
            ? null
            : params.translated
              ? rectAt(params.translated.top, params.translated.height)
              : null;
    const over =
        params.over === null
            ? null
            : {
                  id: params.over.type === 'sprint' ? `sprint-${params.over.sprintId}` : 'backlog',
                  data: { current: params.over },
              };
    return {
        active: {
            id: params.activeId,
            rect: { current: { initial: null, translated } },
            data: {
                current: params.noActiveData
                    ? undefined
                    : { type: 'us', usId: params.activeId, fromSprintId: params.fromSprintId },
            },
        },
        over,
    } as unknown as DragEndEvent;
}

/** Drive a full start -> end drag through the captured callbacks. */
function drag(startArgs: DragStartEvent, endArgs: DragEndEvent): void {
    act(() => {
        dndMock().onDragStart?.(startArgs);
    });
    act(() => {
        dndMock().onDragEnd?.(endArgs);
    });
}

afterEach(() => {
    rectSpy?.mockRestore();
    rectSpy = undefined;
    const store = dndMock();
    store.pointerResult = undefined;
    store.rectResult = undefined;
    cleanup();
});

/* ========================================================================== *
 * mount + gate
 * ========================================================================== */

describe('BacklogDndContext — mount & permission gate', () => {
    it('mounts the provider and renders the row children, with no overlay at rest', () => {
        const { container } = renderDnd();
        expect(container.querySelectorAll('[data-id]')).toHaveLength(3);
        expect(container.querySelector('.tg-react-drag-overlay')).toBeNull();
        // Provider wired the lifecycle callbacks + collisionDetection onto the mock.
        expect(typeof dndMock().onDragStart).toBe('function');
        expect(typeof dndMock().onDragEnd).toBe('function');
        expect(typeof dndMock().onDragCancel).toBe('function');
        expect(typeof dndMock().collisionDetection).toBe('function');
    });

    it('renders inert (project === null) without throwing — pre-load window', () => {
        expect(() =>
            render(
                <BacklogDndContext
                    project={null}
                    canModifyUs={false}
                    userstories={[]}
                    sprints={[]}
                    onMove={jest.fn()}
                >
                    <div />
                </BacklogDndContext>,
            ),
        ).not.toThrow();
    });
});

/* ========================================================================== *
 * collisionDetection — pointer-hit vs rectIntersection fallback
 * ========================================================================== */

describe('BacklogDndContext — collisionDetection', () => {
    it('returns pointer collisions when present, else the rectIntersection fallback', () => {
        renderDnd();
        const detect = dndMock().collisionDetection!;

        // Pointer hit -> returned verbatim.
        dndMock().pointerResult = [{ id: 'ptr' }];
        dndMock().rectResult = [{ id: 'rect' }];
        expect(detect({} as unknown)).toEqual([{ id: 'ptr' }]);

        // No pointer hit -> rectIntersection fallback.
        dndMock().pointerResult = [];
        expect(detect({} as unknown)).toEqual([{ id: 'rect' }]);
    });
});

/* ========================================================================== *
 * DragOverlay mirror (single + multi) + handleDragStart / handleDragCancel
 * ========================================================================== */

describe('BacklogDndContext — overlay + drag start/cancel', () => {
    it('handleDragStart shows the single-card overlay mirror for the active story', () => {
        const { container } = renderDnd();
        act(() => {
            dndMock().onDragStart?.(startEvent(2, null));
        });
        const overlay = container.querySelector('.tg-react-drag-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay?.querySelector('.us-item-ref')?.textContent).toBe('#2');
        expect(container.querySelector('.tg-react-drag-count')).toBeNull();
    });

    it('shows the multi-card count badge when a selected row is grabbed with >1 selected', () => {
        const { container } = renderDnd({ selectedUsIds: [1, 3] });
        act(() => {
            dndMock().onDragStart?.(startEvent(1, null));
        });
        expect(container.querySelector('.tg-react-drag-count')?.textContent).toBe('2');
    });

    it('handleDragStart ignores an event with no draggable data (guard)', () => {
        const { container } = renderDnd();
        act(() => {
            dndMock().onDragStart?.({ active: { id: 1, data: { current: undefined } } });
        });
        // No active id was set -> no overlay mirror rendered.
        expect(container.querySelector('.tg-react-drag-overlay')).toBeNull();
    });

    it('handleDragCancel clears the active drag (overlay disappears)', () => {
        const { container } = renderDnd();
        act(() => {
            dndMock().onDragStart?.(startEvent(2, null));
        });
        expect(container.querySelector('.tg-react-drag-overlay')).not.toBeNull();
        act(() => {
            dndMock().onDragCancel?.();
        });
        expect(container.querySelector('.tg-react-drag-overlay')).toBeNull();
    });
});

/* ========================================================================== *
 * handleDragEnd — the move payload contract
 * ========================================================================== */

describe('BacklogDndContext — handleDragEnd move payloads', () => {
    it('emits onMove for a cross-sprint drop with the target sprint id and dragged usList', () => {
        const sprint = makeMilestone({ id: 10, user_stories: [us(4), us(5)] });
        const { onMove } = renderDnd({ backlog: [us(1), us(2), us(3)], sprints: [sprint] });
        // Row rects irrelevant to the sprint id / usList assertions.
        stubRects({ 4: { top: 0, height: 50 }, 5: { top: 50, height: 50 } });

        drag(
            startEvent(1, null),
            endEvent({ activeId: 1, fromSprintId: null, over: { type: 'sprint', sprintId: 10 } }),
        );

        expect(onMove).toHaveBeenCalledTimes(1);
        const payload = onMove.mock.calls[0][0] as BacklogMovePayload;
        expect(payload.sprint).toBe(10);
        expect(payload.usList.map((u) => u.id)).toEqual([1]);
    });

    it('emits onMove for an intra-backlog reorder with the computed insertion index + neighbours', () => {
        const { onMove } = renderDnd({ backlog: [us(1), us(2), us(3)] });
        // destExcl = [2, 3]; row 2 center 50, row 3 center 150.
        stubRects({ 2: { top: 0, height: 100 }, 3: { top: 100, height: 100 } });

        // dragged center-Y = 70 -> lands BEFORE row 3 (index 1), after row 2.
        drag(
            startEvent(1, null),
            endEvent({
                activeId: 1,
                fromSprintId: null,
                over: { type: 'backlog' },
                translated: { top: 60, height: 20 },
            }),
        );

        expect(onMove).toHaveBeenCalledTimes(1);
        const payload = onMove.mock.calls[0][0] as BacklogMovePayload;
        expect(payload.sprint).toBeNull();
        expect(payload.index).toBe(1);
        expect(payload.previousUs).toBe(2);
        expect(payload.nextUs).toBeNull();
    });

    it('emits onMove placing at the TOP (index 0) with nextUs set and previousUs null', () => {
        const { onMove } = renderDnd({ backlog: [us(1), us(2), us(3)] });
        // Dragging story 3 -> destExcl = [1, 2]; row 1 center 50, row 2 center 150.
        // Dragged center 10 lands before row 1 -> index 0.
        stubRects({ 1: { top: 0, height: 100 }, 2: { top: 100, height: 100 } });

        // Drag story 3 (so it is a real move to the top, not a same-position no-op).
        drag(
            startEvent(3, null),
            endEvent({
                activeId: 3,
                fromSprintId: null,
                over: { type: 'backlog' },
                translated: { top: 5, height: 10 },
            }),
        );

        expect(onMove).toHaveBeenCalledTimes(1);
        const payload = onMove.mock.calls[0][0] as BacklogMovePayload;
        expect(payload.index).toBe(0);
        expect(payload.previousUs).toBeNull();
        // destExcl (dragging id 3) = [1, 2]; nextUs = destExcl[0] = 1.
        expect(payload.nextUs).toBe(1);
    });

    it('does NOT emit onMove for a same-container same-position drop (no-op guard)', () => {
        const { onMove } = renderDnd({ backlog: [us(1), us(2), us(3)] });
        // destExcl = [2, 3]; dragged story 1 at index 0 is its ORIGINAL position.
        stubRects({ 2: { top: 0, height: 100 }, 3: { top: 100, height: 100 } });

        drag(
            startEvent(1, null),
            endEvent({
                activeId: 1,
                fromSprintId: null,
                over: { type: 'backlog' },
                translated: { top: 5, height: 10 }, // center 10 -> index 0 == old index
            }),
        );

        expect(onMove).not.toHaveBeenCalled();
    });

    it('drop into an EMPTY sprint yields index 0 (computeOverIndex early return)', () => {
        const emptySprint = makeMilestone({ id: 20, user_stories: [] });
        const { onMove } = renderDnd({ backlog: [us(1)], sprints: [emptySprint] });

        drag(
            startEvent(1, null),
            endEvent({ activeId: 1, fromSprintId: null, over: { type: 'sprint', sprintId: 20 } }),
        );

        expect(onMove).toHaveBeenCalledTimes(1);
        const payload = onMove.mock.calls[0][0] as BacklogMovePayload;
        expect(payload.sprint).toBe(20);
        expect(payload.index).toBe(0);
    });

    it('appends at the end when the dragged rect is unavailable and skips missing [data-id] rows', () => {
        // Sprint 30 MODEL has [4, 5] but only row 4 is rendered -> id 5 -> querySelector
        // null -> the `continue` branch in computeOverIndex; translated null -> append.
        const sprint = makeMilestone({ id: 30, user_stories: [us(4), us(5)] });
        const { onMove } = renderDnd({
            backlog: [us(1)],
            sprints: [sprint],
            renderIds: [1, 4], // deliberately omit row 5
        });

        drag(
            startEvent(1, null),
            endEvent({
                activeId: 1,
                fromSprintId: null,
                over: { type: 'sprint', sprintId: 30 },
                translated: null, // dragged center-Y = +Infinity -> append at end
            }),
        );

        expect(onMove).toHaveBeenCalledTimes(1);
        const payload = onMove.mock.calls[0][0] as BacklogMovePayload;
        // destExcl = [4, 5] -> append index = 2.
        expect(payload.index).toBe(2);
    });
});

/* ========================================================================== *
 * handleDragEnd — gates & guards (onMove must NOT fire)
 * ========================================================================== */

describe('BacklogDndContext — handleDragEnd gates', () => {
    it('does NOT emit onMove on a read-only board (canModifyUs false)', () => {
        const { onMove } = renderDnd({ canModifyUs: false });
        drag(
            startEvent(1, null),
            endEvent({ activeId: 1, fromSprintId: null, over: { type: 'backlog' } }),
        );
        expect(onMove).not.toHaveBeenCalled();
    });

    it('does NOT emit onMove on an archived board (isBoardDraggable false)', () => {
        const { onMove } = renderDnd({
            project: draggableProject({ archived_code: 'read-only' as unknown as null }),
            canModifyUs: true,
        });
        drag(
            startEvent(1, null),
            endEvent({ activeId: 1, fromSprintId: null, over: { type: 'backlog' } }),
        );
        expect(onMove).not.toHaveBeenCalled();
    });

    it('does NOT emit onMove when dropped outside any container (over === null)', () => {
        const { onMove } = renderDnd();
        drag(startEvent(1, null), endEvent({ activeId: 1, fromSprintId: null, over: null }));
        expect(onMove).not.toHaveBeenCalled();
    });

    it('does NOT emit onMove when the active data is missing (guard)', () => {
        const { onMove } = renderDnd();
        drag(
            startEvent(1, null),
            endEvent({
                activeId: 1,
                fromSprintId: null,
                over: { type: 'backlog' },
                noActiveData: true,
            }),
        );
        expect(onMove).not.toHaveBeenCalled();
    });

    it('does NOT emit onMove when the dragged id resolves to no known user story', () => {
        const { onMove } = renderDnd({ backlog: [us(1), us(2), us(3)] });
        // Drag id 999 which is absent from usById -> usList empty -> guarded return.
        drag(
            startEvent(999, null),
            endEvent({ activeId: 999, fromSprintId: null, over: { type: 'backlog' } }),
        );
        expect(onMove).not.toHaveBeenCalled();
    });

    it('falls back to resolving dragged ids from active data when onDragStart state was lost', () => {
        const { onMove } = renderDnd({ backlog: [us(1), us(2), us(3)] });
        stubRects({ 2: { top: 0, height: 100 }, 3: { top: 100, height: 100 } });
        // Fire ONLY onDragEnd (no preceding onDragStart) -> dragged state empty ->
        // handleDragEnd rebuilds finalDragged from active.data via resolveDraggedIds.
        act(() => {
            dndMock().onDragEnd?.(
                endEvent({
                    activeId: 1,
                    fromSprintId: null,
                    over: { type: 'backlog' },
                    translated: { top: 60, height: 20 },
                }),
            );
        });
        expect(onMove).toHaveBeenCalledTimes(1);
        expect((onMove.mock.calls[0][0] as BacklogMovePayload).usList.map((u) => u.id)).toEqual([1]);
    });
});
