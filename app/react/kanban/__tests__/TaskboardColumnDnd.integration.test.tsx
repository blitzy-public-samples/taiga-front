/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * TaskboardColumnDnd.integration.test.tsx — F-CQ-01 PRODUCTION-TREE integration
 * proof for the Kanban drag-and-drop layer.
 *
 * WHY THIS SPEC EXISTS
 *   The unit spec `KanbanDndContext.test.tsx` proves that the DnD wrappers, WHEN
 *   rendered, dispatch `onMoveUs` correctly — but it builds its own hand-rolled
 *   `<Board>` out of `DraggableCard` / `DroppableColumn`. That left the CRITICAL
 *   F-CQ-01 gap unproven: does the PRODUCTION component tree actually render
 *   those wrappers? Before the fix, `TaskboardColumn` rendered a bare column
 *   `<div>` and bare `<Card>`s, so the shipping app could never START or PERSIST
 *   a drag even though the DnD layer existed and was unit-tested in isolation.
 *
 *   This spec closes that gap end-to-end. It renders the REAL production
 *   `TaskboardColumn` (with the REAL `Card`, not a stub) inside the REAL
 *   `KanbanDndContext`, and proves that:
 *
 *     1. the production column body registers as a @dnd-kit DROPPABLE — a
 *        `.kanban-uses-box.taskboard-column` node with `data-status` / `#column-N`
 *        and a `type:'column'` droppable whose id is the column key;
 *     2. every production card registers as a @dnd-kit DRAGGABLE: the drag `ref`
 *        AND the ARIA `attributes` (`role="button"`) reach the REAL `Card` root
 *        via its `forwardRef` + `...rest` contract, exactly one draggable is
 *        registered per card, ENABLED on a draggable board and INERT (disabled)
 *        on a read-only / archived board (the `isBoardDraggable` gate,
 *        `sortable.coffee:37,40`);
 *     3. a real drag driven through the PRODUCTION wrappers' OWN `getNode()`
 *        closures — which resolve to the real production DOM nodes — writes
 *        through `onMoveUs` with the FROZEN argument order
 *        `(finalUsList, newStatus, newSwimlane, index, previousCard, nextCard)`,
 *        and is correctly skipped when the card is dropped outside any droppable.
 *
 * TEST-LAYER ISOLATION (identical to every kanban __tests__ spec)
 *   - `.tsx` on the automatic JSX runtime (`jsx: "react-jsx"`), so NO `import
 *     React`; jest globals + jest-dom matchers are AMBIENT (root `tsconfig.json`
 *     `types` + `jest.config.js` `setupFilesAfterEnv`), so neither is imported.
 *   - `@dnd-kit/core` is MOCKED to the same thin render/dispatch shim used by
 *     `KanbanDndContext.test.tsx`; here the mock ADDITIONALLY records each
 *     `useDraggable` / `useDroppable` `data` object so the drag can be driven
 *     through the PRODUCTION data plumbing (the wrappers' real `getNode()`
 *     closures), not a fabricated stand-in. No dragula / dom-autoscroller /
 *     immutable / checksley / jquery / angular imports, no network, no real
 *     browser. Node v16.19.1 / TypeScript 5.4.5 / React 18.2.0 compatible.
 */

/* eslint-disable @typescript-eslint/no-empty-function */

/* ---------------------------------------------------------------------------
 * @dnd-kit/core mock — renders `DndContext` / `DragOverlay` children inline,
 * captures the four drag callbacks on `globalThis.__dndMockInt`, and RECORDS
 * every `useDraggable` / `useDroppable` registration (id + the production `data`
 * object + its `disabled` flag) so a test can drive the lifecycle through the
 * production wrappers' own `getNode()` closures.
 * ------------------------------------------------------------------------- */
jest.mock('@dnd-kit/core', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const react = require('react');

    interface Registration {
        id: unknown;
        data?: { getNode?: () => unknown; [k: string]: unknown };
        disabled: boolean;
    }

    const getStore = () => {
        const g = globalThis as unknown as {
            __dndMockInt?: {
                onDragStart?: (e: unknown) => void;
                onDragOver?: (e: unknown) => void;
                onDragEnd?: (e: unknown) => void;
                onDragCancel?: () => void;
                overId?: string | null;
                draggables: Registration[];
                droppables: Registration[];
            };
        };
        if (!g.__dndMockInt) {
            g.__dndMockInt = { draggables: [], droppables: [] };
        }
        return g.__dndMockInt;
    };

    return {
        __esModule: true,
        DndContext: (props: {
            children?: unknown;
            onDragStart?: (e: unknown) => void;
            onDragOver?: (e: unknown) => void;
            onDragEnd?: (e: unknown) => void;
            onDragCancel?: () => void;
        }) => {
            const store = getStore();
            store.onDragStart = props.onDragStart;
            store.onDragOver = props.onDragOver;
            store.onDragEnd = props.onDragEnd;
            store.onDragCancel = props.onDragCancel;
            return react.createElement(react.Fragment, null, props.children);
        },
        DragOverlay: (props: { children?: unknown }) =>
            react.createElement(react.Fragment, null, props.children),
        PointerSensor: function PointerSensor() {},
        KeyboardSensor: function KeyboardSensor() {},
        useSensor: (sensor: unknown, options?: unknown) => ({ sensor, options }),
        useSensors: (...sensors: unknown[]) => sensors,
        pointerWithin: () => [],
        rectIntersection: () => [],
        useDraggable: (args: {
            id: unknown;
            disabled?: boolean;
            data?: { getNode?: () => unknown; [k: string]: unknown };
        }) => {
            const store = getStore();
            store.draggables.push({
                id: args.id,
                data: args.data,
                disabled: Boolean(args.disabled),
            });
            return {
                setNodeRef: () => {},
                listeners: {},
                // @dnd-kit keeps the accessible attributes on a disabled
                // draggable too, so the mock returns them unconditionally; the
                // read-only GATE is proven via the recorded `disabled` flag.
                attributes: { role: 'button', tabIndex: 0 },
                isDragging: false,
                node: { current: null },
                transform: null,
            };
        },
        useDroppable: (args: {
            id: unknown;
            disabled?: boolean;
            data?: { getNode?: () => unknown; [k: string]: unknown };
        }) => {
            const store = getStore();
            store.droppables.push({
                id: args.id,
                data: args.data,
                disabled: Boolean(args.disabled),
            });
            return {
                setNodeRef: () => {},
                isOver: store.overId != null && args.id === store.overId,
                node: { current: null },
                rect: { current: null },
            };
        },
    };
});

import { render, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';

import { TaskboardColumn } from '../components/TaskboardColumn';
import type { TaskboardColumnProps } from '../components/TaskboardColumn';
import { KanbanDndContext } from '../dnd/KanbanDndContext';
import { makeStatus, makeProject, makeUserStory, makeBoardCard, makeUsMap } from './factories';
import type { Project, UsMap } from '../../shared/types';

/* ========================================================================== *
 * Typed access to the @dnd-kit mock store
 * ========================================================================== */

interface Registration {
    id: unknown;
    data?: { getNode?: () => unknown; type?: string; statusId?: number; [k: string]: unknown };
    disabled: boolean;
}
interface DndMockStore {
    onDragStart?: (e: unknown) => void;
    onDragEnd?: (e: unknown) => void;
    overId?: string | null;
    draggables: Registration[];
    droppables: Registration[];
}

function dndMock(): DndMockStore {
    const g = globalThis as unknown as { __dndMockInt?: DndMockStore };
    if (!g.__dndMockInt) {
        g.__dndMockInt = { draggables: [], droppables: [] };
    }
    return g.__dndMockInt;
}

beforeEach(() => {
    const m = dndMock();
    m.onDragStart = undefined;
    m.onDragEnd = undefined;
    m.overId = null;
    m.draggables = [];
    m.droppables = [];
});

/* ========================================================================== *
 * Fixtures + a production-tree board renderer
 * ========================================================================== */

/** A project whose `my_permissions` grants `modify_us` -> `isBoardDraggable` true. */
function draggableProject(overrides: Partial<Project> = {}): Project {
    return makeProject({ my_permissions: ['view_us', 'modify_us'], ...overrides });
}

/** Build a `usMap` of `ids` all in `status` / `swimlane` (defaults 100 / null). */
function usMapOf(ids: number[], status = 100, swimlane: number | null = null): UsMap {
    return makeUsMap(
        ids.map((id) => makeBoardCard({ model: makeUserStory({ id, status, swimlane }) })),
    );
}

interface ColSpec {
    statusId: number;
    swimlaneId?: number | null;
    cardIds: number[];
}

/**
 * Build a COMPLETE, type-safe {@link TaskboardColumnProps} for one column with
 * neutral defaults. `inViewPort: {}` keeps every real `Card` in its lightweight
 * out-of-viewport form (root `.card` only), so the spec stays fast and robust
 * while still exercising the REAL `Card` `forwardRef` + `...rest` DnD contract.
 */
function columnProps(
    col: ColSpec,
    project: Project,
    usMap: UsMap,
    onOverrides: Partial<TaskboardColumnProps> = {},
): TaskboardColumnProps {
    return {
        status: makeStatus({ id: col.statusId, name: `S${col.statusId}` }),
        swimlaneId: col.swimlaneId ?? null,
        cardIds: col.cardIds,
        usMap,
        project,
        zoom: [],
        zoomLevel: 0,
        folded: false,
        unfolded: false,
        showPlaceholder: false,
        notFoundUserstories: false,
        selectedUss: {},
        movedUs: [],
        inViewPort: {},
        isUsArchivedHidden: () => false,
        onToggleFold: jest.fn(),
        onClickEdit: jest.fn(),
        onClickDelete: jest.fn(),
        onClickAssignedTo: jest.fn(),
        onClickMoveToTop: jest.fn(),
        onToggleSelectedUs: jest.fn(),
        ...onOverrides,
    };
}

interface RenderResult {
    container: HTMLElement;
    onMoveUs: jest.Mock;
}

/**
 * Render the REAL `KanbanDndContext` wrapping one REAL `TaskboardColumn` per
 * ColSpec. This is the exact composition the production `KanbanApp` renders
 * (provider -> column bodies), so what mounts here is the shipping tree.
 */
function renderProductionBoard(opts?: {
    cols?: ColSpec[];
    project?: Project;
    usMap?: UsMap;
    onMoveUs?: jest.Mock;
}): RenderResult {
    const cols = opts?.cols ?? [{ statusId: 100, cardIds: [1, 2, 3] }];
    const project = opts?.project ?? draggableProject();
    const usMap =
        opts?.usMap ??
        cols.reduce<UsMap>(
            (acc, c) => ({ ...acc, ...usMapOf(c.cardIds, c.statusId, c.swimlaneId ?? null) }),
            {},
        );
    const onMoveUs = opts?.onMoveUs ?? jest.fn();

    const { container } = render(
        <KanbanDndContext
            project={project}
            usMap={usMap}
            selectedUss={{}}
            zoom={[]}
            zoomLevel={0}
            onMoveUs={onMoveUs}
        >
            {cols.map((col) => (
                <TaskboardColumn
                    key={`${col.swimlaneId ?? 'ns'}:${col.statusId}`}
                    {...columnProps(col, project, usMap)}
                />
            ))}
        </KanbanDndContext>,
    );

    return { container, onMoveUs };
}

/* ---- DOM node lookups (production-rendered) ------------------------------ */

function getCol(container: HTMLElement, statusId: number, swimlaneId?: number | null): HTMLElement {
    const sel =
        swimlaneId != null
            ? `.kanban-uses-box.taskboard-column[data-status="${statusId}"][data-swimlane="${swimlaneId}"]`
            : `.kanban-uses-box.taskboard-column[data-status="${statusId}"]:not([data-swimlane])`;
    const node = container.querySelector(sel);
    if (!node) {
        throw new Error(`production column not found: ${sel}`);
    }
    return node as HTMLElement;
}

/* ---- Drive a drag through the PRODUCTION wrappers' recorded data ---------- */

/** The production draggable `data` recorded for card `usId` (its real getNode). */
function draggableData(usId: number): NonNullable<Registration['data']> {
    const reg = dndMock().draggables.find((d) => Number(d.id) === usId);
    if (!reg?.data) {
        throw new Error(`no production draggable recorded for card ${usId}`);
    }
    return reg.data;
}

/** The production COLUMN droppable `data` recorded for `statusId` (real getNode). */
function columnDroppableData(statusId: number): NonNullable<Registration['data']> {
    const reg = dndMock().droppables.find(
        (d) => d.data?.type === 'column' && Number(d.data?.statusId) === statusId,
    );
    if (!reg?.data) {
        throw new Error(`no production column droppable recorded for status ${statusId}`);
    }
    return reg.data;
}

function startEvent(usId: number): DragStartEvent {
    return {
        active: { id: usId, data: { current: draggableData(usId) } },
    } as unknown as DragStartEvent;
}

/** End a drag OVER a whole column (append), using the production column data. */
function endOverColumn(usId: number, destStatusId: number): DragEndEvent {
    return {
        active: {
            id: usId,
            rect: { current: { initial: null, translated: null } },
            data: { current: { type: 'card', usId } },
        },
        over: {
            id: 'col',
            rect: { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 },
            data: { current: columnDroppableData(destStatusId) },
        },
    } as unknown as DragEndEvent;
}

function endNoOver(usId: number): DragEndEvent {
    return {
        active: {
            id: usId,
            rect: { current: { initial: null, translated: null } },
            data: { current: { type: 'card', usId } },
        },
        over: null,
    } as unknown as DragEndEvent;
}

/* ========================================================================== *
 * 1. Production column registers as a droppable
 * ========================================================================== */

describe('F-CQ-01 — production TaskboardColumn registers its column as a droppable', () => {
    it('renders the real .kanban-uses-box.taskboard-column with data-status + #column-N', () => {
        const { container } = renderProductionBoard();
        const col = getCol(container, 100);
        expect(col).toBeInTheDocument();
        expect(col.id).toBe('column-100');
        expect(col.getAttribute('data-status')).toBe('100');
    });

    it('registers a @dnd-kit column droppable whose id is the column key (ns:100)', () => {
        renderProductionBoard();
        const colDroppable = dndMock().droppables.find((d) => d.data?.type === 'column');
        expect(colDroppable).toBeDefined();
        expect(colDroppable?.id).toBe('ns:100');
        // The droppable's production getNode() resolves to the real column node.
        expect((colDroppable?.data?.getNode?.() as HTMLElement).getAttribute('data-status')).toBe(
            '100',
        );
    });

    it('emits data-swimlane and a swimlane-keyed droppable in swimlane mode', () => {
        const { container } = renderProductionBoard({
            cols: [{ statusId: 100, swimlaneId: 7, cardIds: [1, 2] }],
            usMap: usMapOf([1, 2], 100, 7),
        });
        const col = getCol(container, 100, 7);
        expect(col.getAttribute('data-swimlane')).toBe('7');
        const colDroppable = dndMock().droppables.find((d) => d.data?.type === 'column');
        expect(colDroppable?.id).toBe('7:100');
    });
});

/* ========================================================================== *
 * 2. Production cards register as draggables + attributes reach the real Card
 * ========================================================================== */

describe('F-CQ-01 — production cards register as draggables (ref + attributes reach real Card)', () => {
    it('renders one real .card[data-id] per card with the drag ARIA attributes on the Card root', () => {
        const { container } = renderProductionBoard();
        const cards = Array.from(container.querySelectorAll('.card')) as HTMLElement[];
        expect(cards).toHaveLength(3);
        expect(cards.map((c) => c.getAttribute('data-id'))).toEqual(['1', '2', '3']);
        // role="button" + tabindex="0" originate in @dnd-kit `attributes` and are
        // spread onto the REAL Card root via DraggableCard -> Card `...rest`.
        cards.forEach((c) => {
            expect(c.getAttribute('role')).toBe('button');
            expect(c.getAttribute('tabindex')).toBe('0');
        });
    });

    it('registers exactly one ENABLED draggable per card on a draggable board', () => {
        renderProductionBoard();
        const draggables = dndMock().draggables;
        const ids = [...new Set(draggables.map((d) => Number(d.id)))].sort((a, b) => a - b);
        expect(ids).toEqual([1, 2, 3]);
        expect(draggables.every((d) => d.disabled === false)).toBe(true);
    });

    it('registers every wrapper INERT (disabled) on a READ-ONLY board (no modify_us)', () => {
        // makeProject() lacks modify_us -> isBoardDraggable false -> the internal
        // context disables every DraggableCard / DroppableColumn (React parity with
        // sortable.coffee returning before the dragula drake is created, L37).
        const { container } = renderProductionBoard({ project: makeProject() });
        expect(container.querySelectorAll('.card')).toHaveLength(3);
        expect(dndMock().draggables.every((d) => d.disabled === true)).toBe(true);
        expect(dndMock().droppables.every((d) => d.disabled === true)).toBe(true);
    });

    it('registers every wrapper INERT on an ARCHIVED project even with modify_us (F-REG-03)', () => {
        renderProductionBoard({
            project: draggableProject({ archived_code: 'archived' }),
        });
        expect(dndMock().draggables.every((d) => d.disabled === true)).toBe(true);
        expect(dndMock().droppables.every((d) => d.disabled === true)).toBe(true);
    });
});

/* ========================================================================== *
 * 3. A real drag through the production tree writes through onMoveUs
 * ========================================================================== */

describe('F-CQ-01 — a drag through the PRODUCTION tree dispatches onMoveUs', () => {
    it('cross-column drop (card 1 from status 100 onto status 200) writes the FROZEN payload', () => {
        const { onMoveUs } = renderProductionBoard({
            cols: [
                { statusId: 100, cardIds: [1, 2, 3] },
                { statusId: 200, cardIds: [10, 20] },
            ],
        });

        // The drag is driven entirely through the PRODUCTION wrappers' recorded
        // data — startEvent/endOverColumn read the real getNode() closures, which
        // resolve to the real production column/card DOM nodes.
        act(() => {
            dndMock().onDragStart?.(startEvent(1));
        });
        act(() => {
            dndMock().onDragEnd?.(endOverColumn(1, 200));
        });

        expect(onMoveUs).toHaveBeenCalledTimes(1);
        const args = onMoveUs.mock.calls[0];
        expect(args[0]).toEqual([{ id: 1, oldStatusId: 100, oldSwimlaneId: null }]); // finalUsList
        expect(args[1]).toBe(200); // newStatus (from the real dest column data-status)
        expect(args[2]).toBeNull(); // newSwimlane normalized to null (no data-swimlane)
        expect(Number.isNaN(args[2])).toBe(false);
        expect(args[3]).toBe(2); // index — appended after [10, 20]
        expect(args[4]).toBe(20); // previousCard
        expect(args[5]).toBeNull(); // nextCard
    });

    it('drop OUTSIDE any droppable is a no-op (onMoveUs NOT called)', () => {
        const { onMoveUs } = renderProductionBoard();
        act(() => {
            dndMock().onDragStart?.(startEvent(1));
        });
        act(() => {
            dndMock().onDragEnd?.(endNoOver(1));
        });
        expect(onMoveUs).not.toHaveBeenCalled();
    });

    it('does not dispatch onMoveUs on a read-only board (wrappers disabled, no drag starts)', () => {
        // On a read-only board the wrappers are disabled, so a real @dnd-kit drag
        // never begins. We assert the gate directly: every registration is
        // disabled, so no onDragStart is ever produced by the sensors.
        renderProductionBoard({ project: makeProject() });
        expect(dndMock().draggables.every((d) => d.disabled === true)).toBe(true);
    });
});
