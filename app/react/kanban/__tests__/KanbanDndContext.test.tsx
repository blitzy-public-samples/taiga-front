/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * KanbanDndContext.test.tsx — browserless Jest + jsdom spec for the Kanban
 * drag-and-drop layer `../dnd/KanbanDndContext` (the React 18 port of the
 * AngularJS `tgKanbanSortable` directive: dragula + dom-autoscroller).
 *
 * WHAT THIS SPEC PROVES
 *   1. The five PURE, browser-free helpers that are the deterministic heart of
 *      the drag fidelity contract — `resolveDraggedIds`, `computeDropIndex`,
 *      `computeNeighbors`, `buildFinalUsList`, `computeMovePayload` — behave
 *      EXACTLY as the file prompt's Validation B table specifies (multi-drag
 *      engagement, append/insert index, `afterUserstoryId`-wins neighbour
 *      priority, RAW `model.status`/`model.swimlane`, and the same-container
 *      same-position no-op guard from `sortable.coffee:124`).
 *   2. The `KanbanDndContext` provider + the `DraggableCard` / `DroppableColumn`
 *      render-prop wrappers mount in jsdom, register on a draggable board and
 *      register INERT on a read-only board (the `isBoardDraggable` gate,
 *      `sortable.coffee:37,40`).
 *   3. The drag lifecycle dispatches `onMoveUs` with the FROZEN argument order
 *      `(finalUsList, newStatus, newSwimlane, index, previousCard, nextCard)`
 *      (`main.coffee:596`). F-AAP-09: a MISSING swimlane (no `data-swimlane` in
 *      no-swimlane mode) is normalized to `null` at the boundary — never NaN — so
 *      `newSwimlane` is a clean `number | null` (a real id, `-1`, or `null`). The
 *      `-1 -> null` API mapping still lives downstream in the hook. The callback
 *      is skipped on the no-op drop, and never fires on a read-only board or a
 *      cancelled / out-of-bounds drop.
 *   4. `isTarget` (`target-drop`) appears ONLY on a container different from the
 *      drag source (`sortable.coffee:65-73`).
 *   5. The `DragOverlay` renders the single-card mirror and the
 *      `.multiple-drag-mirror` multi-card mirror, and renders nothing for a
 *      missing card.
 *   6. `useSwimlaneAutoUnfold` preserves the `1000ms` / `pending-to-open` /
 *      is-dragging semantics (`main.coffee:1153-1180`).
 *
 * TEST-LAYER ISOLATION (identical to every kanban __tests__ spec)
 *   - `.tsx` using the automatic JSX runtime (`jsx: "react-jsx"`), so there is
 *     deliberately NO `import React`.
 *   - jest globals + jest-dom matchers are AMBIENT (root `tsconfig.json` `types`
 *     + `jest.config.js` `setupFilesAfterEnv`), so neither is imported.
 *   - `@dnd-kit/core` is MOCKED to a thin render/dispatch shim so the drag
 *     lifecycle is exercised deterministically in jsdom (real pointer/keyboard
 *     sensor drags are validated by the Playwright e2e layer, not here). The
 *     mock captures the `DndContext` callbacks on `globalThis.__dndMock` so the
 *     factory references no out-of-scope module variable. No dragula /
 *     dom-autoscroller / immutable / checksley / jquery / angular imports, no
 *     network, no real browser. Node v16.19.1 compatible.
 */

/* eslint-disable @typescript-eslint/no-empty-function */

/* ---------------------------------------------------------------------------
 * @dnd-kit/core mock — a minimal shim that (a) renders `DndContext` /
 * `DragOverlay` children inline, (b) captures the four drag callbacks on
 * `globalThis.__dndMock` so tests can drive the lifecycle with fabricated
 * events, and (c) lets `useDroppable` report `isOver` for the column id stored
 * in `globalThis.__dndMock.overId`. The real value exports used by the module
 * under test are all stubbed here.
 * ------------------------------------------------------------------------- */
jest.mock('@dnd-kit/core', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const react = require('react');

    const getStore = () => {
        const g = globalThis as unknown as {
            __dndMock?: {
                onDragStart?: (e: unknown) => void;
                onDragOver?: (e: unknown) => void;
                onDragEnd?: (e: unknown) => void;
                onDragCancel?: () => void;
                overId?: string | null;
                draggableDisabled?: boolean[];
                droppableDisabled?: boolean[];
                collisionDetection?: (args: unknown) => unknown;
            };
        };
        if (!g.__dndMock) {
            g.__dndMock = {};
        }
        return g.__dndMock;
    };

    return {
        __esModule: true,
        DndContext: (props: {
            children?: unknown;
            onDragStart?: (e: unknown) => void;
            onDragOver?: (e: unknown) => void;
            onDragEnd?: (e: unknown) => void;
            onDragCancel?: () => void;
            collisionDetection?: (args: unknown) => unknown;
        }) => {
            const store = getStore();
            store.onDragStart = props.onDragStart;
            store.onDragOver = props.onDragOver;
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
        pointerWithin: () => [],
        rectIntersection: () => [],
        useDraggable: (args: {
            id: unknown;
            disabled?: boolean;
            data?: { getNode?: () => unknown };
        }) => {
            const store = getStore();
            store.draggableDisabled = store.draggableDisabled || [];
            store.draggableDisabled.push(Boolean(args.disabled));
            // Realistic: @dnd-kit reads the draggable data; exercise getNode().
            args.data?.getNode?.();
            return {
                setNodeRef: () => {},
                listeners: {},
                attributes: { role: 'button', tabIndex: 0 },
                isDragging: false,
                node: { current: null },
                transform: null,
                _args: args,
            };
        },
        useDroppable: (args: {
            id: unknown;
            disabled?: boolean;
            data?: { getNode?: () => unknown };
        }) => {
            const store = getStore();
            store.droppableDisabled = store.droppableDisabled || [];
            store.droppableDisabled.push(Boolean(args.disabled));
            // Realistic: @dnd-kit reads the droppable data; exercise getNode().
            args.data?.getNode?.();
            return {
                setNodeRef: () => {},
                isOver: store.overId != null && args.id === store.overId,
                node: { current: null },
                rect: { current: null },
                _args: args,
            };
        },
    };
});

import { render, fireEvent, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core';

import {
    resolveDraggedIds,
    computeDropIndex,
    computeNeighbors,
    buildFinalUsList,
    computeMovePayload,
    KanbanDndContext,
    DraggableCard,
    DroppableColumn,
    useSwimlaneAutoUnfold,
} from '../dnd/KanbanDndContext';
import {
    makeProject,
    makeUserStory,
    makeBoardCard,
    makeUsMap,
    makeStatus,
    makeSwimlane,
} from './factories';
import type { Project, UsMap, BoardCard, Status, Swimlane as SwimlaneModel } from '../../shared/types';
import { Swimlane } from '../components/Swimlane';

/* ========================================================================== *
 * Shared fixtures + typed access to the @dnd-kit mock store
 * ========================================================================== */

interface DndMockStore {
    onDragStart?: (e: unknown) => void;
    onDragOver?: (e: unknown) => void;
    onDragEnd?: (e: unknown) => void;
    onDragCancel?: () => void;
    overId?: string | null;
    draggableDisabled?: boolean[];
    droppableDisabled?: boolean[];
    collisionDetection?: (args: unknown) => unknown;
}

/** Typed accessor onto the callback/overId store the mock writes to. */
function dndMock(): DndMockStore {
    const g = globalThis as unknown as { __dndMock?: DndMockStore };
    if (!g.__dndMock) {
        g.__dndMock = {};
    }
    return g.__dndMock;
}

/** A project whose `my_permissions` grants `modify_us` -> `isBoardDraggable` true. */
function draggableProject(overrides: Partial<Project> = {}): Project {
    return makeProject({ my_permissions: ['view_us', 'modify_us'], ...overrides });
}

/** Build a `usMap` of `ids` all in `status`/`swimlane` (defaults: 100 / null). */
function usMapOf(ids: number[], status = 100, swimlane: number | null = null): UsMap {
    return makeUsMap(
        ids.map((id) => makeBoardCard({ model: makeUserStory({ id, status, swimlane }) })),
    );
}

beforeEach(() => {
    // Reset the mock store between tests so stale callbacks / overId never leak.
    const m = dndMock();
    m.onDragStart = undefined;
    m.onDragOver = undefined;
    m.onDragEnd = undefined;
    m.onDragCancel = undefined;
    m.overId = null;
    m.draggableDisabled = [];
    m.droppableDisabled = [];
    m.collisionDetection = undefined;
});

/* ========================================================================== *
 * Phase B — PURE helpers (browser-free; the Validation B table)
 * ========================================================================== */

describe('resolveDraggedIds', () => {
    it('engages multi-drag only when the grabbed card is selected AND >1 selected', () => {
        // Grabbed card selected + a second selected -> multi.
        expect(resolveDraggedIds(5, { 5: true, 7: true, 9: false })).toEqual([5, 7]);
        // Grabbed card NOT selected -> single, even though another is selected.
        expect(resolveDraggedIds(5, { 5: false, 7: true })).toEqual([5]);
        // Only the grabbed card selected (length 1) -> single.
        expect(resolveDraggedIds(5, { 5: true })).toEqual([5]);
        // Nothing selected -> single.
        expect(resolveDraggedIds(5, {})).toEqual([5]);
    });

    it('orders a multi-drag set by the provided board/DOM order', () => {
        expect(resolveDraggedIds(5, { 5: true, 7: true, 9: true }, [9, 7, 5, 1])).toEqual([
            9, 7, 5,
        ]);
    });

    it('guarantees the grabbed card is included even if missing from orderedIds', () => {
        // orderedIds filters to [7]; the grabbed card 5 is appended.
        expect(resolveDraggedIds(5, { 5: true, 7: true }, [7])).toEqual([7, 5]);
    });
});

describe('computeDropIndex', () => {
    it('appends when there is no over-card (empty body / below all cards)', () => {
        expect(computeDropIndex([1, 2, 4, 5], null, false)).toBe(4);
    });

    it('appends when the over-card is not present in destExcl', () => {
        expect(computeDropIndex([1, 2, 4, 5], 99, false)).toBe(4);
    });

    it('returns the over-card position, +1 when dropping AFTER it', () => {
        // Same-container move-to-end of [A,B,C,D,E] moving C: destExcl=[A,B,D,E],
        // drop after E -> indexOf(E)=3, +1 => 4.
        expect(computeDropIndex([1, 2, 4, 5], 5, true)).toBe(4);
        // Drop BEFORE D -> indexOf(D)=2.
        expect(computeDropIndex([1, 2, 4, 5], 4, false)).toBe(2);
    });
});

describe('computeNeighbors', () => {
    it('move-to-end: previousCard is the last card, nextCard is null', () => {
        expect(computeNeighbors([1, 2, 4, 5], 4)).toEqual({
            previousCard: 5,
            nextCard: null,
        });
    });

    it('drop at top (index 0): previousCard null, nextCard is destExcl[0]', () => {
        expect(computeNeighbors([10, 20], 0)).toEqual({
            previousCard: null,
            nextCard: 10,
        });
    });

    it('mid insertion: previousCard set, nextCard null (afterUserstoryId wins)', () => {
        expect(computeNeighbors([10, 20, 30], 2)).toEqual({
            previousCard: 20,
            nextCard: null,
        });
    });

    it('empty destination: both neighbours null', () => {
        expect(computeNeighbors([], 0)).toEqual({ previousCard: null, nextCard: null });
    });
});

describe('buildFinalUsList', () => {
    it('preserves input order and reads RAW model.status / model.swimlane', () => {
        const usMap = makeUsMap([
            makeBoardCard({ model: makeUserStory({ id: 3, status: 100, swimlane: null }) }),
            makeBoardCard({ model: makeUserStory({ id: 5, status: 100, swimlane: 7 }) }),
        ]);

        expect(buildFinalUsList([3, 5], usMap)).toEqual([
            { id: 3, oldStatusId: 100, oldSwimlaneId: null },
            { id: 5, oldStatusId: 100, oldSwimlaneId: 7 },
        ]);
    });

    it('drops ids that are missing from the usMap', () => {
        const usMap = usMapOf([3]);
        expect(buildFinalUsList([3, 999], usMap)).toEqual([
            { id: 3, oldStatusId: 100, oldSwimlaneId: null },
        ]);
    });
});

describe('computeMovePayload', () => {
    const usMap = usMapOf([1, 2, 3, 4, 5]);

    it('returns null on the same-container same-position no-op (sortable L124)', () => {
        // Move C ([A,B,C,D,E], oldIndex 2) dropped BEFORE D -> index 2 == oldIndex.
        const payload = computeMovePayload({
            draggedIds: [3],
            destExcl: [1, 2, 4, 5],
            overCardId: 4,
            insertAfter: false,
            newStatus: 100,
            newSwimlane: 100,
            oldIndex: 2,
            sameContainer: true,
            usMap,
        });
        expect(payload).toBeNull();
    });

    it('same-container move to a NEW position returns the payload', () => {
        // Move C to end (after E) -> index 4, previousCard E, nextCard null.
        const payload = computeMovePayload({
            draggedIds: [3],
            destExcl: [1, 2, 4, 5],
            overCardId: 5,
            insertAfter: true,
            newStatus: 100,
            newSwimlane: 100,
            oldIndex: 2,
            sameContainer: true,
            usMap,
        });
        expect(payload).toEqual({
            finalUsList: [{ id: 3, oldStatusId: 100, oldSwimlaneId: null }],
            newStatus: 100,
            newSwimlane: 100,
            index: 4,
            previousCard: 5,
            nextCard: null,
        });
    });

    it('cross-container drop at top surfaces RAW newSwimlane and sets nextCard', () => {
        // Different container -> never a no-op; drop over first dest card -> index 0.
        const payload = computeMovePayload({
            draggedIds: [3],
            destExcl: [1, 2],
            overCardId: 1,
            insertAfter: false,
            newStatus: 200,
            newSwimlane: -1, // RAW synthetic "Unclassified" id — passed through as-is.
            oldIndex: 0,
            sameContainer: false,
            usMap,
        });
        expect(payload).toEqual({
            finalUsList: [{ id: 3, oldStatusId: 100, oldSwimlaneId: null }],
            newStatus: 200,
            newSwimlane: -1,
            index: 0,
            previousCard: null,
            nextCard: 1,
        });
    });
});

/* ========================================================================== *
 * Component test harness — a board built from the real DraggableCard /
 * DroppableColumn wrappers so their bodies run, plus fabricated @dnd-kit events
 * (cast to the real event types) that drive the captured lifecycle callbacks.
 * ========================================================================== */

interface ColSpec {
    statusId: number;
    swimlaneId?: number | null;
    cardIds: number[];
}

/** Render a board region: one `.kanban-uses-box.taskboard-column` per ColSpec. */
function Board({ cols }: { cols: ColSpec[] }): ReactElement {
    return (
        <>
            {cols.map((col) => (
                <DroppableColumn
                    key={`${col.swimlaneId ?? 'ns'}:${col.statusId}`}
                    statusId={col.statusId}
                    swimlaneId={col.swimlaneId}
                >
                    {({ setNodeRef, isTarget }) => (
                        <div
                            ref={setNodeRef}
                            className={`kanban-uses-box taskboard-column${
                                isTarget ? ' target-drop' : ''
                            }`}
                            data-status={String(col.statusId)}
                            {...(col.swimlaneId != null
                                ? { 'data-swimlane': String(col.swimlaneId) }
                                : {})}
                        >
                            {col.cardIds.map((id) => (
                                <DraggableCard
                                    key={id}
                                    id={id}
                                    statusId={col.statusId}
                                    swimlaneId={col.swimlaneId}
                                >
                                    {({ setNodeRef: cardRef }) => (
                                        <div
                                            ref={cardRef}
                                            className="card"
                                            data-id={String(id)}
                                        />
                                    )}
                                </DraggableCard>
                            ))}
                        </div>
                    )}
                </DroppableColumn>
            ))}
        </>
    );
}

interface RenderBoardResult {
    container: HTMLElement;
    onMoveUs: jest.Mock;
    usMap: UsMap;
    project: Project;
}

function renderBoard(opts?: {
    project?: Project;
    selectedUss?: Record<number, boolean>;
    usMap?: UsMap;
    cols?: ColSpec[];
    onMoveUs?: jest.Mock;
    onRequestUnfoldSwimlane?: (swimlaneId: number) => void;
}): RenderBoardResult {
    const project = opts?.project ?? draggableProject();
    const selectedUss = opts?.selectedUss ?? {};
    const cols = opts?.cols ?? [{ statusId: 100, cardIds: [1, 2, 3, 4, 5] }];
    const usMap = opts?.usMap ?? usMapOf([1, 2, 3, 4, 5]);
    const onMoveUs = opts?.onMoveUs ?? jest.fn();

    const { container } = render(
        <KanbanDndContext
            project={project}
            usMap={usMap}
            selectedUss={selectedUss}
            zoom={[]}
            zoomLevel={0}
            onMoveUs={onMoveUs}
            onRequestUnfoldSwimlane={opts?.onRequestUnfoldSwimlane}
        >
            <Board cols={cols} />
        </KanbanDndContext>,
    );

    return { container, onMoveUs, usMap, project };
}

/* ---- DOM node lookups ---------------------------------------------------- */

function getCol(
    container: HTMLElement,
    statusId: number,
    swimlaneId?: number | null,
): HTMLElement {
    const sel =
        swimlaneId != null
            ? `.kanban-uses-box.taskboard-column[data-status="${statusId}"][data-swimlane="${swimlaneId}"]`
            : `.kanban-uses-box.taskboard-column[data-status="${statusId}"]:not([data-swimlane])`;
    const node = container.querySelector(sel);
    if (!node) {
        throw new Error(`column not found: ${sel}`);
    }
    return node as HTMLElement;
}

function getCard(col: HTMLElement, id: number): HTMLElement {
    const node = col.querySelector(`.card[data-id="${id}"]`);
    if (!node) {
        throw new Error(`card not found: ${id}`);
    }
    return node as HTMLElement;
}

/* ---- Fabricated @dnd-kit events (cast to the real event types) ----------- */

function startEvent(activeId: number, columnKey: string, node: HTMLElement): DragStartEvent {
    return {
        active: {
            id: activeId,
            data: {
                current: {
                    type: 'card',
                    usId: activeId,
                    columnKey,
                    getNode: () => node,
                },
            },
        },
    } as unknown as DragStartEvent;
}

function rectAt(top: number, height: number) {
    return { top, left: 0, width: 100, height, right: 100, bottom: top + height };
}

function endOverCard(params: {
    activeId: number;
    overUsId: number;
    overNode: HTMLElement;
    translated: { top: number; height: number } | null;
    overRect: { top: number; height: number };
}): DragEndEvent {
    return {
        active: {
            id: params.activeId,
            rect: {
                current: {
                    initial: null,
                    translated: params.translated
                        ? rectAt(params.translated.top, params.translated.height)
                        : null,
                },
            },
            data: { current: { type: 'card', usId: params.activeId } },
        },
        over: {
            id: 'over',
            rect: rectAt(params.overRect.top, params.overRect.height),
            data: {
                current: {
                    type: 'card',
                    usId: params.overUsId,
                    columnKey: 'x',
                    getNode: () => params.overNode,
                },
            },
        },
    } as unknown as DragEndEvent;
}

function endOverColumn(activeId: number, colNode: HTMLElement): DragEndEvent {
    return {
        active: {
            id: activeId,
            rect: { current: { initial: null, translated: null } },
            data: { current: { type: 'card', usId: activeId } },
        },
        over: {
            id: 'col',
            rect: rectAt(0, 100),
            data: {
                current: {
                    type: 'column',
                    statusId: 0,
                    swimlaneId: null,
                    getNode: () => colNode,
                },
            },
        },
    } as unknown as DragEndEvent;
}

function endNoOver(activeId: number): DragEndEvent {
    return {
        active: {
            id: activeId,
            rect: { current: { initial: null, translated: null } },
            data: { current: {} },
        },
        over: null,
    } as unknown as DragEndEvent;
}

function overColumnEvent(statusId: number, swimlaneId: number | null): DragOverEvent {
    return {
        over: {
            id: 'k',
            rect: rectAt(0, 0),
            data: { current: { type: 'column', statusId, swimlaneId } },
        },
    } as unknown as DragOverEvent;
}

/* ========================================================================== *
 * Phase C/D — KanbanDndContext: mount & permission gate
 * ========================================================================== */

describe('KanbanDndContext — mount & gate', () => {
    it('mounts the board (draggable), with no overlay and no target-drop at rest', () => {
        const { container } = renderBoard();
        expect(container.querySelectorAll('.card')).toHaveLength(5);
        expect(container.querySelector('.target-drop')).toBeNull();
        expect(container.querySelector('.multiple-drag-mirror')).toBeNull();
    });

    it('registers every wrapper as ENABLED on a draggable board', () => {
        renderBoard();
        const m = dndMock();
        // 5 draggable cards + 5 card-droppables + 1 column-droppable.
        expect(m.draggableDisabled).toHaveLength(5);
        expect(m.draggableDisabled?.every((d) => d === false)).toBe(true);
        expect(m.droppableDisabled?.every((d) => d === false)).toBe(true);
    });

    it('registers every wrapper as INERT (disabled) on a READ-ONLY board (gate false)', () => {
        // makeProject() (no modify_us) -> isBoardDraggable false -> draggable:false,
        // so the internal context makes every DraggableCard/DroppableColumn disabled.
        // This is the React equivalent of sortable.coffee returning before the
        // dragula `drake` is ever created (L37 + L40).
        const { container } = renderBoard({ project: makeProject() });
        expect(container.querySelectorAll('.card')).toHaveLength(5);

        const m = dndMock();
        expect(m.draggableDisabled).toHaveLength(5);
        expect(m.draggableDisabled?.every((d) => d === true)).toBe(true);
        expect(m.droppableDisabled?.every((d) => d === true)).toBe(true);
    });

    it('honours an explicit archived project (archived_code set) as read-only', () => {
        renderBoard({
            project: draggableProject({ archived_code: 'archived' }),
        });
        const m = dndMock();
        // modify_us granted but archived_code truthy -> isBoardDraggable false.
        expect(m.draggableDisabled?.every((d) => d === true)).toBe(true);
    });
});

/* ========================================================================== *
 * Phase D — drag lifecycle -> onMoveUs (Validation D)
 * ========================================================================== */

describe('KanbanDndContext — drag lifecycle dispatch', () => {
    it('same-container move-to-end fires onMoveUs with the FROZEN arg order + null swimlane (F-AAP-09)', () => {
        const { container, onMoveUs } = renderBoard();
        const col = getCol(container, 100);

        act(() => {
            dndMock().onDragStart?.(startEvent(3, 'ns:100', getCard(col, 3)));
        });
        act(() => {
            // Dragged center-Y below the over-card center-Y -> insertAfter true.
            dndMock().onDragEnd?.(
                endOverCard({
                    activeId: 3,
                    overUsId: 5,
                    overNode: getCard(col, 5),
                    translated: { top: 100, height: 50 }, // center 125
                    overRect: { top: 0, height: 50 }, // center 25
                }),
            );
        });

        expect(onMoveUs).toHaveBeenCalledTimes(1);
        const args = onMoveUs.mock.calls[0];
        expect(args[0]).toEqual([{ id: 3, oldStatusId: 100, oldSwimlaneId: null }]); // finalUsList
        expect(args[1]).toBe(100); // newStatus
        // F-AAP-09: the destination column has NO `data-swimlane` (no-swimlane
        // mode), so `Number(undefined)` -> NaN is normalized to `null` at the
        // onDragEnd boundary. It must be a real null, never NaN, so the value
        // cannot corrupt the reducer state or the API body downstream.
        expect(args[2]).toBeNull(); // newSwimlane normalized to null
        expect(Number.isNaN(args[2])).toBe(false);
        expect(args[3]).toBe(4); // index
        expect(args[4]).toBe(5); // previousCard
        expect(args[5]).toBeNull(); // nextCard
    });

    it('drop into a swimlane column surfaces the REAL swimlane id, not null (F-AAP-09)', () => {
        // Swimlane mode: the destination column carries `data-swimlane="7"`. The
        // F-AAP-09 boundary normalization only touches a MISSING/NaN swimlane, so
        // a real id (here 7) must pass straight through to `onMoveUs`.
        const usMap: UsMap = {
            ...usMapOf([1, 2, 3], 100, 7),
            ...usMapOf([10, 20], 200, 7),
        };
        const { container, onMoveUs } = renderBoard({
            usMap,
            cols: [
                { statusId: 100, swimlaneId: 7, cardIds: [1, 2, 3] },
                { statusId: 200, swimlaneId: 7, cardIds: [10, 20] },
            ],
        });
        const src = getCol(container, 100, 7);
        const dest = getCol(container, 200, 7);

        act(() => {
            dndMock().onDragStart?.(startEvent(1, '7:100', getCard(src, 1)));
        });
        act(() => {
            dndMock().onDragEnd?.(endOverColumn(1, dest));
        });

        expect(onMoveUs).toHaveBeenCalledTimes(1);
        const args = onMoveUs.mock.calls[0];
        expect(args[1]).toBe(200); // newStatus
        expect(args[2]).toBe(7); // newSwimlane — the REAL id, unchanged
    });

    it('same-container same-position drop is a no-op (onMoveUs NOT called)', () => {
        const { container, onMoveUs } = renderBoard();
        const col = getCol(container, 100);

        act(() => {
            dndMock().onDragStart?.(startEvent(3, 'ns:100', getCard(col, 3))); // oldIndex 2
        });
        act(() => {
            // Over card 4, dragged center ABOVE over center -> insertAfter false ->
            // index 2 == oldIndex 2 -> no-op.
            dndMock().onDragEnd?.(
                endOverCard({
                    activeId: 3,
                    overUsId: 4,
                    overNode: getCard(col, 4),
                    translated: { top: 0, height: 50 }, // center 25
                    overRect: { top: 100, height: 50 }, // center 125
                }),
            );
        });

        expect(onMoveUs).not.toHaveBeenCalled();
    });

    it('same-container move-UP with translated rect unavailable -> insertAfter false', () => {
        const { container, onMoveUs } = renderBoard();
        const col = getCol(container, 100);

        act(() => {
            dndMock().onDragStart?.(startEvent(3, 'ns:100', getCard(col, 3))); // oldIndex 2
        });
        act(() => {
            // translated null -> insertAfter defaults false; over card 1 -> index 0.
            dndMock().onDragEnd?.(
                endOverCard({
                    activeId: 3,
                    overUsId: 1,
                    overNode: getCard(col, 1),
                    translated: null,
                    overRect: { top: 0, height: 50 },
                }),
            );
        });

        expect(onMoveUs).toHaveBeenCalledTimes(1);
        const args = onMoveUs.mock.calls[0];
        expect(args[3]).toBe(0); // index
        expect(args[4]).toBeNull(); // previousCard
        expect(args[5]).toBe(1); // nextCard = destExcl[0]
    });

    it('cross-container drop over a COLUMN appends and reports the destination status', () => {
        const usMap: UsMap = {
            ...usMapOf([1, 2, 3], 100, null),
            ...usMapOf([10, 20], 200, null),
        };
        const { container, onMoveUs } = renderBoard({
            usMap,
            cols: [
                { statusId: 100, cardIds: [1, 2, 3] },
                { statusId: 200, cardIds: [10, 20] },
            ],
        });
        const src = getCol(container, 100);
        const dest = getCol(container, 200);

        act(() => {
            dndMock().onDragStart?.(startEvent(1, 'ns:100', getCard(src, 1)));
        });
        act(() => {
            dndMock().onDragEnd?.(endOverColumn(1, dest));
        });

        expect(onMoveUs).toHaveBeenCalledTimes(1);
        const args = onMoveUs.mock.calls[0];
        expect(args[0]).toEqual([{ id: 1, oldStatusId: 100, oldSwimlaneId: null }]);
        expect(args[1]).toBe(200); // newStatus
        expect(args[3]).toBe(2); // appended at end of [10,20]
        expect(args[4]).toBe(20); // previousCard = last dest card
        expect(args[5]).toBeNull();
    });

    it('does not fire onMoveUs when dropped outside any droppable (over == null)', () => {
        const { container, onMoveUs } = renderBoard();
        const col = getCol(container, 100);
        act(() => {
            dndMock().onDragStart?.(startEvent(3, 'ns:100', getCard(col, 3)));
        });
        act(() => {
            dndMock().onDragEnd?.(endNoOver(3));
        });
        expect(onMoveUs).not.toHaveBeenCalled();
    });

    it('does not fire onMoveUs when the destination column cannot be resolved', () => {
        const { container, onMoveUs } = renderBoard();
        const col = getCol(container, 100);
        const detached = document.createElement('div'); // not inside any column
        act(() => {
            dndMock().onDragStart?.(startEvent(3, 'ns:100', getCard(col, 3)));
        });
        act(() => {
            dndMock().onDragEnd?.(
                endOverCard({
                    activeId: 3,
                    overUsId: 4,
                    overNode: detached,
                    translated: { top: 0, height: 10 },
                    overRect: { top: 0, height: 10 },
                }),
            );
        });
        expect(onMoveUs).not.toHaveBeenCalled();
    });
});

/* ========================================================================== *
 * Phase C/D — the non-source-only target-drop highlight (sortable L65-73)
 * ========================================================================== */

describe('KanbanDndContext — target-drop highlight', () => {
    it('suppresses target-drop on the SOURCE column while highlighting a different column', () => {
        const usMap: UsMap = {
            ...usMapOf([1, 2, 3], 100, null),
            ...usMapOf([10, 20], 200, null),
        };
        // Start with the source column reported as "over": isTarget must stay false.
        dndMock().overId = 'ns:100';
        const { container } = renderBoard({
            usMap,
            cols: [
                { statusId: 100, cardIds: [1, 2, 3] },
                { statusId: 200, cardIds: [10, 20] },
            ],
        });
        const src = getCol(container, 100);

        act(() => {
            dndMock().onDragStart?.(startEvent(1, 'ns:100', getCard(src, 1)));
        });
        // Source column is "over" but equals the source key -> NO target-drop.
        expect(container.querySelector('.target-drop')).toBeNull();

        // Now report a DIFFERENT column as over and nudge a re-render via onDragOver.
        dndMock().overId = 'ns:200';
        act(() => {
            dndMock().onDragOver?.(overColumnEvent(200, null));
        });
        expect(getCol(container, 200).classList.contains('target-drop')).toBe(true);
        expect(getCol(container, 100).classList.contains('target-drop')).toBe(false);
    });
});

/* ========================================================================== *
 * Phase D.11 — the DragOverlay mirror
 * ========================================================================== */

describe('KanbanDndContext — DragOverlay', () => {
    it('renders a single-card mirror (no multi wrapper) for a single drag', () => {
        const { container } = renderBoard();
        const col = getCol(container, 100);
        act(() => {
            dndMock().onDragStart?.(startEvent(3, 'ns:100', getCard(col, 3)));
        });
        // No multi wrapper; the overlay adds exactly one more `.card` (5 -> 6).
        expect(container.querySelector('.multiple-drag-mirror')).toBeNull();
        expect(container.querySelectorAll('.card')).toHaveLength(6);
    });

    it('renders the .multiple-drag-mirror wrapper for a multi-card drag', () => {
        const { container } = renderBoard({ selectedUss: { 3: true, 5: true } });
        const col = getCol(container, 100);
        act(() => {
            dndMock().onDragStart?.(startEvent(3, 'ns:100', getCard(col, 3)));
        });
        const mirror = container.querySelector('.multiple-drag-mirror.tg-multiple-drag-mirror');
        expect(mirror).not.toBeNull();
        // The mirror wraps the active card clone.
        expect(mirror?.querySelector('.card')).not.toBeNull();
    });

    it('renders nothing in the overlay when the active card is missing from usMap', () => {
        const { container } = renderBoard();
        const col = getCol(container, 100);
        act(() => {
            // active id 999 has no BoardCard -> renderOverlay returns null.
            dndMock().onDragStart?.(startEvent(999, 'ns:100', getCard(col, 1)));
        });
        expect(container.querySelector('.multiple-drag-mirror')).toBeNull();
        expect(container.querySelectorAll('.card')).toHaveLength(5); // no overlay card
    });
});

/* ========================================================================== *
 * Phase D.7 / D.9 — onDragOver branches, onDragCancel, and no-in-flight guards
 * ========================================================================== */

describe('KanbanDndContext — onDragOver / onDragCancel', () => {
    it('handles onDragOver for column, card and empty-over without throwing', () => {
        const { container } = renderBoard();
        const col = getCol(container, 100);
        act(() => {
            dndMock().onDragStart?.(startEvent(3, 'ns:100', getCard(col, 3)));
        });
        // column over
        act(() => {
            dndMock().onDragOver?.(overColumnEvent(100, null));
        });
        // card over (key derived from the card's columnKey)
        act(() => {
            dndMock().onDragOver?.({
                over: {
                    id: 'k',
                    rect: rectAt(0, 0),
                    data: { current: { type: 'card', usId: 2, columnKey: 'ns:100' } },
                },
            } as unknown as DragOverEvent);
        });
        // empty over (early return)
        act(() => {
            dndMock().onDragOver?.({ over: null } as unknown as DragOverEvent);
        });
        expect(container.querySelectorAll('.card')).toHaveLength(6); // overlay still up
    });

    it('onDragCancel clears state, removes the overlay and never calls onMoveUs', () => {
        const { container, onMoveUs } = renderBoard();
        const col = getCol(container, 100);
        act(() => {
            dndMock().onDragStart?.(startEvent(3, 'ns:100', getCard(col, 3)));
        });
        expect(container.querySelectorAll('.card')).toHaveLength(6); // overlay up
        act(() => {
            dndMock().onDragCancel?.();
        });
        expect(container.querySelectorAll('.card')).toHaveLength(5); // overlay gone
        expect(onMoveUs).not.toHaveBeenCalled();
    });

    it('onDragEnd with no drag in flight is a safe no-op', () => {
        const { container, onMoveUs } = renderBoard();
        const col = getCol(container, 100);
        // End without a preceding start -> draggedIds empty / activeId null -> no-op.
        act(() => {
            dndMock().onDragEnd?.(endOverColumn(3, col));
        });
        expect(onMoveUs).not.toHaveBeenCalled();
    });

    it('tolerates a drag start whose source column node cannot be resolved', () => {
        const { onMoveUs } = renderBoard();
        // getNode returns null -> resolveColumnNode(null) hits the null guard;
        // sourceFullIds is empty and oldIndex is -1, with no crash.
        act(() => {
            dndMock().onDragStart?.({
                active: {
                    id: 3,
                    data: {
                        current: {
                            type: 'card',
                            usId: 3,
                            columnKey: 'ns:100',
                            getNode: () => null,
                        },
                    },
                },
            } as unknown as DragStartEvent);
        });
        expect(onMoveUs).not.toHaveBeenCalled();
    });

    it('composes pointerWithin then rectIntersection as the collision fallback', () => {
        renderBoard();
        const collision = dndMock().collisionDetection;
        expect(typeof collision).toBe('function');
        // Both mocked detectors return [] -> the composed detector returns [].
        expect(collision?.({})).toEqual([]);
    });
});

/* ========================================================================== *
 * Phase E — useSwimlaneAutoUnfold (main.coffee:1153-1180)
 * ========================================================================== */

function UnfoldProbe({
    swimlaneId,
    folded,
}: {
    swimlaneId: number;
    folded: boolean;
}): ReactElement {
    const { onMouseOverSwimlane, onMouseLeaveSwimlane } = useSwimlaneAutoUnfold(
        swimlaneId,
        folded,
    );
    return (
        <div
            data-testid="sl"
            onMouseOver={(e) => onMouseOverSwimlane(e.currentTarget)}
            onMouseLeave={() => onMouseLeaveSwimlane()}
        />
    );
}

describe('useSwimlaneAutoUnfold', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    function renderUnfold(opts: {
        folded: boolean;
        onReq: jest.Mock;
        swimlaneId?: number;
        startDrag?: boolean;
    }): { container: HTMLElement; sl: HTMLElement } {
        const swimlaneId = opts.swimlaneId ?? 10;
        const { container, getByTestId } = render(
            <KanbanDndContext
                project={draggableProject()}
                usMap={usMapOf([1])}
                selectedUss={{}}
                zoom={[]}
                zoomLevel={0}
                onMoveUs={jest.fn()}
                onRequestUnfoldSwimlane={opts.onReq}
            >
                <Board cols={[{ statusId: 100, cardIds: [1] }]} />
                <UnfoldProbe swimlaneId={swimlaneId} folded={opts.folded} />
            </KanbanDndContext>,
        );
        if (opts.startDrag !== false) {
            const col = getCol(container, 100);
            act(() => {
                dndMock().onDragStart?.(startEvent(1, 'ns:100', getCard(col, 1)));
            });
        }
        return { container, sl: getByTestId('sl') };
    }

    it('unfolds a folded swimlane after 1000ms while dragging (pending-to-open)', () => {
        const onReq = jest.fn();
        const { sl } = renderUnfold({ folded: true, onReq, swimlaneId: 42 });

        act(() => {
            fireEvent.mouseOver(sl);
        });
        expect(sl.classList.contains('pending-to-open')).toBe(true);
        expect(onReq).not.toHaveBeenCalled();

        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(onReq).toHaveBeenCalledTimes(1);
        expect(onReq).toHaveBeenCalledWith(42);
        expect(sl.classList.contains('pending-to-open')).toBe(false);
    });

    it('does nothing when no drag is in flight', () => {
        const onReq = jest.fn();
        const { sl } = renderUnfold({ folded: true, onReq, startDrag: false });
        act(() => {
            fireEvent.mouseOver(sl);
        });
        expect(sl.classList.contains('pending-to-open')).toBe(false);
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(onReq).not.toHaveBeenCalled();
    });

    it('does nothing when the swimlane is not folded', () => {
        const onReq = jest.fn();
        const { sl } = renderUnfold({ folded: false, onReq });
        act(() => {
            fireEvent.mouseOver(sl);
        });
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(onReq).not.toHaveBeenCalled();
    });

    it('cancels the pending unfold on mouse leave', () => {
        const onReq = jest.fn();
        const { sl } = renderUnfold({ folded: true, onReq });
        act(() => {
            fireEvent.mouseOver(sl);
        });
        expect(sl.classList.contains('pending-to-open')).toBe(true);
        act(() => {
            fireEvent.mouseLeave(sl);
        });
        expect(sl.classList.contains('pending-to-open')).toBe(false);
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(onReq).not.toHaveBeenCalled();
    });

    it('ignores a second hover while an unfold is already pending', () => {
        const onReq = jest.fn();
        const { sl } = renderUnfold({ folded: true, onReq, swimlaneId: 7 });
        act(() => {
            fireEvent.mouseOver(sl);
            fireEvent.mouseOver(sl); // second hover: timer already pending -> ignored
        });
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(onReq).toHaveBeenCalledTimes(1);
        expect(onReq).toHaveBeenCalledWith(7);
    });
});

/* ========================================================================== *
 * Phase E (F-CQ-07) — the PRODUCTION `Swimlane` wires `useSwimlaneAutoUnfold`.
 *
 * The block above proves the hook via a synthetic `UnfoldProbe`. This block
 * closes the F-CQ-07 gap: it renders the REAL production `Swimlane` (folded, so
 * only its `.kanban-swimlane-title` bar renders — no columns/cards) inside the
 * REAL `KanbanDndContext` given an `onRequestUnfoldSwimlane`, and proves that
 * hovering the PRODUCTION title bar during a drag drives the hook end-to-end:
 * `pending-to-open` toggles on the real title node and the unfold is requested
 * after 1000ms — with the wiring living entirely in shipping code.
 * ========================================================================== */

/** Build a COMPLETE, neutral `SwimlaneProps` for a FOLDED swimlane (title only). */
function foldedSwimlaneProps(
    swimlaneId: number,
    project: Project,
): Parameters<typeof Swimlane>[0] {
    const swimlane: SwimlaneModel = makeSwimlane({ id: swimlaneId, name: `S${swimlaneId}` });
    const statuses: Status[] = [makeStatus({ id: 100 })];
    return {
        swimlane,
        statuses,
        project,
        folded: true, // folded -> Swimlane renders ONLY the title bar
        usMap: {},
        zoom: [],
        zoomLevel: 0,
        getColumnCardIds: () => [],
        statusFolds: {},
        unfoldStatusId: null,
        showPlaceholderFor: () => false,
        notFoundUserstories: false,
        selectedUss: {},
        movedUs: [],
        inViewPort: {},
        isUsArchivedHidden: () => false,
        onToggleSwimlane: jest.fn(),
        onToggleFold: jest.fn(),
        onClickEdit: jest.fn(),
        onClickDelete: jest.fn(),
        onClickAssignedTo: jest.fn(),
        onClickMoveToTop: jest.fn(),
        onToggleSelectedUs: jest.fn(),
    };
}

describe('F-CQ-07 — production Swimlane wires useSwimlaneAutoUnfold', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    function renderProductionSwimlane(opts: {
        onReq: jest.Mock;
        swimlaneId?: number;
        startDrag?: boolean;
    }): { title: HTMLElement } {
        const swimlaneId = opts.swimlaneId ?? 42;
        const { container } = render(
            <KanbanDndContext
                project={draggableProject()}
                usMap={usMapOf([1])}
                selectedUss={{}}
                zoom={[]}
                zoomLevel={0}
                onMoveUs={jest.fn()}
                onRequestUnfoldSwimlane={opts.onReq}
            >
                {/* A drag SOURCE column so a real onDragStart flips `isDragging`. */}
                <Board cols={[{ statusId: 100, cardIds: [1] }]} />
                {/* The REAL production Swimlane under test (folded -> title only). */}
                <Swimlane {...foldedSwimlaneProps(swimlaneId, draggableProject())} />
            </KanbanDndContext>,
        );
        if (opts.startDrag !== false) {
            const col = getCol(container, 100);
            act(() => {
                dndMock().onDragStart?.(startEvent(1, 'ns:100', getCard(col, 1)));
            });
        }
        const title = container.querySelector('.kanban-swimlane-title') as HTMLElement;
        if (!title) {
            throw new Error('production .kanban-swimlane-title not found');
        }
        return { title };
    }

    it('hovering the PRODUCTION title bar mid-drag adds pending-to-open then unfolds after 1000ms', () => {
        const onReq = jest.fn();
        const { title } = renderProductionSwimlane({ onReq, swimlaneId: 42 });

        act(() => {
            fireEvent.mouseOver(title);
        });
        // The class lands on the REAL production title node (the SCSS target).
        expect(title.classList.contains('pending-to-open')).toBe(true);
        expect(onReq).not.toHaveBeenCalled();

        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(onReq).toHaveBeenCalledTimes(1);
        expect(onReq).toHaveBeenCalledWith(42);
        expect(title.classList.contains('pending-to-open')).toBe(false);
    });

    it('mouseleave on the PRODUCTION title cancels the pending unfold', () => {
        const onReq = jest.fn();
        const { title } = renderProductionSwimlane({ onReq });
        act(() => {
            fireEvent.mouseOver(title);
        });
        expect(title.classList.contains('pending-to-open')).toBe(true);
        act(() => {
            fireEvent.mouseLeave(title);
        });
        expect(title.classList.contains('pending-to-open')).toBe(false);
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(onReq).not.toHaveBeenCalled();
    });

    it('does NOT unfold when no drag is in flight (production title hover)', () => {
        const onReq = jest.fn();
        const { title } = renderProductionSwimlane({ onReq, startDrag: false });
        act(() => {
            fireEvent.mouseOver(title);
        });
        expect(title.classList.contains('pending-to-open')).toBe(false);
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(onReq).not.toHaveBeenCalled();
    });
});
