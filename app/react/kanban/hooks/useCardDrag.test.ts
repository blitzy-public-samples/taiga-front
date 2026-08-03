/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for `./useCardDrag`.
 *
 * Browserless: jsdom only, no drag library rendered, no network, no timers, no
 * snapshot. The hook's provider props ARE its lifecycle, so every scenario drives
 * them directly in the order the shared provider drives them —
 * `onDragStart` → `onDragOver`* → `onMultiDragEnd` → `onDragEnd` (or
 * `onDragCancel`) — against a fixture that reproduces the board's real markup.
 *
 * THREE CASES ARE MANDATORY rather than merely useful, and they are named in
 * capitals below: FIRST-POSITION, LAST-POSITION and CROSS-CONTAINER. Named risk
 * R-DND-2 is that an off-by-one in the ordering arithmetic SILENTLY PERSISTS A
 * WRONG ORDER — no exception, no failing request, nothing in the logs — so the two
 * ends of a container and a move between containers are asserted explicitly.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, renderHook } from '@testing-library/react';

import { createMultiDrag } from '../../shared/dnd/multiDrag';
import type { MultiDragController } from '../../shared/dnd/multiDrag';
import type { InViewportApi } from '../../shared/useInViewport';
import { UNCLASSIFIED_SWIMLANE_ID } from '../state/boardReducer';
import type { CardUserStoryVm } from '../state/types';
import { KANBAN_US_MOVE_EVENT, useCardDrag } from './useCardDrag';
import type {
    KanbanBoardRootRef,
    KanbanDraggableData,
    KanbanDroppableData,
    UseCardDragOptions,
    UseCardDragResult,
} from './useCardDrag';

/* ==========================================================================
 * THE CONTRACT LITERALS, RESTATED INDEPENDENTLY
 * ==========================================================================
 * Spelled out here rather than imported from the unit under test, so that a
 * rename in the implementation FAILS these specifications instead of travelling
 * silently into them. Every one is selected on by a stylesheet this migration
 * leaves unedited, or read by the retained AngularJS controller.
 */

const CARD_ELEMENT = 'tg-card';

const COLUMN_CLASS = 'kanban-uses-box taskboard-column';

const COLUMN_SELECTOR = '.taskboard-column';

const SWIMLANE_CLASS = 'kanban-swimlane';

const TARGET_DROP_CLASS = 'target-drop';

const NEW_COLUMN_CLASS = 'new';

const MULTIPLE_SORTABLE_CLASS = 'ui-multisortable-multiple';

const MULTIPLE_DRAG_MIRROR_CLASS = 'multiple-drag-mirror';

const TG_MULTIPLE_DRAG_MIRROR_CLASS = 'tg-multiple-drag-mirror';

const TG_MULTIPLE_DRAG_DRAGGING_CLASS = 'tg-multiple-drag-dragging';

const MAIN_DRAG_CLASS = 'main-drag-item';

const MIRROR_CLASS = 'gu-mirror';

const ANIMATION_END_EVENT = 'animationend';

const KANBAN_AUTOSCROLL_MARGIN = 100;

/** `card.jade` L45-L55 renders exactly two of these; `../KanbanCard` reproduces it. */
const FAKE_US_COUNT = 2;

/* ==========================================================================
 * PROVIDER EVENT FACTORIES
 * ========================================================================== */

type DndProps = UseCardDragResult['dndProviderProps'];

type DragStartArg = Parameters<NonNullable<DndProps['onDragStart']>>[0];

type DragOverArg = Parameters<NonNullable<DndProps['onDragOver']>>[0];

type ActiveArg = DragStartArg['active'];

type OverArg = DragOverArg['over'];

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };

function makeActive(id: number, data: KanbanDraggableData): ActiveArg {
    return {
        id,
        data: { current: { ...data } },
        rect: { current: { initial: null, translated: null } },
    };
}

function makeOver(id: number | string, data: KanbanDroppableData): OverArg {
    return { id, rect: EMPTY_RECT, disabled: false, data: { current: { ...data } } };
}

function makeDragStartEvent(active: ActiveArg): DragStartArg {
    return { active, activatorEvent: new Event('pointerdown') };
}

function makeDragEvent(active: ActiveArg, over: OverArg): DragOverArg {
    return {
        active,
        activatorEvent: new Event('pointermove'),
        collisions: null,
        delta: { x: 0, y: 0 },
        over,
    };
}

/* ==========================================================================
 * DOM FIXTURE — THE BOARD'S REAL MARKUP
 * ========================================================================== */

interface ColumnSpec {
    readonly statusId: number;

    readonly cardIds: readonly number[];
}

interface SwimlaneSpec {
    readonly swimlaneId: number;

    readonly columns: readonly ColumnSpec[];
}

interface MountedBoard {
    readonly wrapper: HTMLElement;

    readonly root: HTMLElement;

    readonly rootRef: KanbanBoardRootRef;

    column(statusId: number, swimlaneId?: number): HTMLElement;

    card(id: number): HTMLElement;
}

/** One `.fake-us` ghost block, as the card component renders it. */
function makeFakeUs(): HTMLElement {
    const block = document.createElement('div');

    block.className = 'fake-us';
    block.innerHTML = '';

    const image = document.createElement('div');

    image.className = 'fake-img';
    block.appendChild(image);

    return block;
}

/**
 * `kanban-table.jade` L150 / L226: `tg-card.card.ng-animate-disabled(data-id=…)`,
 * carrying the screen-owned multi-drag ghost from `card.jade` L45-L55.
 */
function makeCardElement(id: number): HTMLElement {
    const card = document.createElement(CARD_ELEMENT);

    card.className = 'card ng-animate-disabled';
    card.dataset.id = String(id);

    const inner = document.createElement('div');

    inner.className = 'card-inner';
    card.appendChild(inner);

    const ghost = document.createElement('div');

    ghost.className = 'card-transit-multi';

    for (let index = 0; index < FAKE_US_COUNT; index += 1) {
        ghost.appendChild(makeFakeUs());
    }

    card.appendChild(ghost);

    return card;
}

/**
 * `kanban-table.jade` L112-L121 (swimlane mode, both data attributes) and
 * L189-L197 (flat mode, `data-status` ONLY — the missing `data-swimlane` is the
 * quirk this specification pins).
 */
function makeColumn(spec: ColumnSpec, swimlaneId?: number): HTMLElement {
    const column = document.createElement('div');

    column.className = COLUMN_CLASS;
    column.id = `column-${String(spec.statusId)}`;
    column.dataset.status = String(spec.statusId);

    if (swimlaneId !== undefined) {
        column.dataset.swimlane = String(swimlaneId);
    }

    const counter = document.createElement('div');

    counter.className = 'kanban-task-counter';
    column.appendChild(counter);

    for (const cardId of spec.cardIds) {
        column.appendChild(makeCardElement(cardId));
    }

    return column;
}

function makeTableBody(columns: readonly HTMLElement[]): HTMLElement {
    const body = document.createElement('div');

    body.className = 'kanban-table-body';

    const inner = document.createElement('div');

    inner.className = 'kanban-table-inner';

    for (const column of columns) {
        inner.appendChild(column);
    }

    body.appendChild(inner);

    return body;
}

/**
 * Builds the fixture and attaches it to the document.
 *
 * The wrapper reproduces `kanban.jade` L16 — `section.main.kanban` with the
 * `swimlane` class bound to swimlane presence — because that class is an ANCESTOR
 * of the board root and the flat bootstrap reads it document-wide.
 */
function mountBoard(spec: {
    readonly swimlanes?: readonly SwimlaneSpec[];
    readonly flat?: readonly ColumnSpec[];
}): MountedBoard {
    const wrapper = document.createElement('section');

    wrapper.className = spec.swimlanes === undefined ? 'main kanban' : 'main kanban swimlane';

    const root = document.createElement('div');

    root.className = 'kanban-table';
    wrapper.appendChild(root);

    for (const swimlane of spec.swimlanes ?? []) {
        const holder = document.createElement('div');

        holder.className = SWIMLANE_CLASS;
        holder.dataset.swimlane = String(swimlane.swimlaneId);
        holder.appendChild(
            makeTableBody(
                swimlane.columns.map((column) => makeColumn(column, swimlane.swimlaneId)),
            ),
        );
        root.appendChild(holder);
    }

    if (spec.flat !== undefined) {
        root.appendChild(makeTableBody(spec.flat.map((column) => makeColumn(column))));
    }

    document.body.appendChild(wrapper);

    return {
        wrapper,
        root,
        rootRef: { current: root },
        column(statusId: number, swimlaneId?: number): HTMLElement {
            const selector =
                swimlaneId === undefined
                    ? `${COLUMN_SELECTOR}[data-status="${String(statusId)}"]:not([data-swimlane])`
                    : `.${SWIMLANE_CLASS}[data-swimlane="${String(swimlaneId)}"] ` +
                      `${COLUMN_SELECTOR}[data-status="${String(statusId)}"]`;
            const column = root.querySelector(selector);

            if (!(column instanceof HTMLElement)) {
                throw new Error(`fixture has no column for selector ${selector}`);
            }

            return column;
        },
        card(id: number): HTMLElement {
            const card = root.querySelector(`${CARD_ELEMENT}[data-id="${String(id)}"]`);

            if (!(card instanceof HTMLElement)) {
                throw new Error(`fixture has no card ${String(id)}`);
            }

            return card;
        },
    };
}

/** The ids of a container's cards, in document order — the arrangement under test. */
function cardIdsIn(container: HTMLElement): readonly string[] {
    const ids: string[] = [];

    for (const card of container.querySelectorAll(CARD_ELEMENT)) {
        if (card instanceof HTMLElement && card.dataset.id !== undefined) {
            ids.push(card.dataset.id);
        }
    }

    return ids;
}

/* ==========================================================================
 * DOMAIN FIXTURE
 * ========================================================================== */

function makeStory(
    id: number,
    statusId: number,
    swimlaneId: number | null,
): CardUserStoryVm['model'] {
    return {
        id,
        ref: id,
        subject: `story ${String(id)}`,
        status: statusId,
        swimlane: swimlaneId,
        milestone: null,
        project: 1,
        is_blocked: false,
        blocked_note: '',
        is_closed: false,
        due_date: null,
        total_points: null,
        points: {},
        tags: [],
        epics: null,
        assigned_users: [],
        assigned_to: null,
        kanban_order: id,
        backlog_order: id,
        total_attachments: 0,
        total_comments: 0,
        attachments: [],
        tasks: [],
        watchers: [],
        version: 1,
    };
}

function makeCardVm(id: number, statusId: number, swimlaneId: number | null): CardUserStoryVm {
    return {
        id,
        model: makeStory(id, statusId, swimlaneId),
        swimlane: swimlaneId,
        foldStatusChanged: undefined,
        images: [],
        assigned_to: undefined,
        assigned_users: [],
        assigned_users_preview: [],
        colorized_tags: [],
    };
}

function makeCardLookup(cards: readonly CardUserStoryVm[]): (id: number) => CardUserStoryVm | undefined {
    const byId = new Map<number, CardUserStoryVm>(cards.map((card) => [card.id, card]));

    return (id: number): CardUserStoryVm | undefined => byId.get(id);
}

interface RecordingInViewport extends InViewportApi {
    readonly columnCalls: (readonly [HTMLElement, number, number | null | undefined])[];

    readonly cardCalls: (readonly [HTMLElement, number, number | null | undefined])[];

    readonly unregisterCalls: number;
}

function makeInViewport(): RecordingInViewport {
    const columnCalls: [HTMLElement, number, number | null | undefined][] = [];
    const cardCalls: [HTMLElement, number, number | null | undefined][] = [];
    let unregisterCalls = 0;

    return {
        visibleIds: {},
        columnCalls,
        cardCalls,
        get unregisterCalls(): number {
            return unregisterCalls;
        },
        registerColumn(column, statusId, swimlaneId): void {
            columnCalls.push([column, statusId, swimlaneId]);
        },
        unregisterColumn(): void {
            unregisterCalls += 1;
        },
        registerCard(card, statusId, swimlaneId): void {
            cardCalls.push([card, statusId, swimlaneId]);
        },
        unregisterCard(): void {
            unregisterCalls += 1;
        },
    };
}

/* ==========================================================================
 * HOOK HARNESS
 * ========================================================================== */

type EmitMoveMock = jest.Mock<void, Parameters<UseCardDragOptions['emitMove']>>;

interface Harness {
    readonly api: () => UseCardDragResult;
    readonly emitMove: EmitMoveMock;
    readonly inViewport: RecordingInViewport;
    readonly multiDrag: MultiDragController;
    readonly rerender: (patch: Partial<UseCardDragOptions>) => void;
    readonly unmount: () => void;
}

function renderCardDrag(overrides: Partial<UseCardDragOptions> & Pick<UseCardDragOptions, 'rootRef'>): Harness {
    const emitMove: EmitMoveMock = jest.fn();
    const inViewport = makeInViewport();
    const multiDrag = overrides.multiDrag ?? createMultiDrag();

    const initial: UseCardDragOptions = {
        project: { my_permissions: ['modify_us'] },
        isTableLoaded: true,
        getCard: (): CardUserStoryVm | undefined => undefined,
        emitMove,
        inViewport,
        multiDrag,
        ...overrides,
    };

    const view = renderHook((props: UseCardDragOptions) => useCardDrag(props), {
        initialProps: initial,
    });

    let current = initial;

    return {
        api: (): UseCardDragResult => view.result.current,
        emitMove,
        inViewport,
        multiDrag,
        rerender: (patch: Partial<UseCardDragOptions>): void => {
            current = { ...current, ...patch };
            view.rerender(current);
        },
        unmount: view.unmount,
    };
}

/** One gesture, driven exactly as the shared provider drives it. */
interface Gesture {
    readonly active: ActiveArg;
    over(node: HTMLElement | null): void;
    overById(id: number | string): void;
    end(stopped?: readonly HTMLElement[]): void;
    cancel(stopped?: readonly HTMLElement[]): void;
}

function beginGesture(harness: Harness, item: HTMLElement): Gesture {
    const api = harness.api();
    const active = makeActive(Number(item.dataset.id), api.getDraggableData(item));

    api.dndProviderProps.onDragStart?.(makeDragStartEvent(active));

    return {
        active,
        over(node: HTMLElement | null): void {
            const over = node === null ? null : makeOver(node.id, harness.api().getDroppableData(node));

            harness.api().dndProviderProps.onDragOver?.(makeDragEvent(active, over));
        },
        overById(id: number | string): void {
            harness
                .api()
                .dndProviderProps.onDragOver?.(makeDragEvent(active, makeOver(id, {})));
        },
        end(stopped: readonly HTMLElement[] = []): void {
            const props = harness.api().dndProviderProps;
            const event = makeDragEvent(active, null);

            props.onMultiDragEnd?.(stopped, event);
            props.onDragEnd?.(event);
        },
        cancel(stopped: readonly HTMLElement[] = []): void {
            const props = harness.api().dndProviderProps;
            const event = makeDragEvent(active, null);

            props.onMultiDragEnd?.(stopped, event);
            props.onDragCancel?.(event);
        },
    };
}

afterEach(() => {
    document.body.innerHTML = '';
});

/* ==========================================================================
 * THE SPECIFICATIONS
 * ========================================================================== */

describe('useCardDrag — permission gates', () => {
    it('returns without registering anything when `modify_us` is absent', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            project: { my_permissions: ['view_us'] },
        });

        expect(harness.api().dndProviderProps.disabled).toBe(true);
        expect(harness.api().getContainers()).toHaveLength(0);
    });

    it('returns on the SECOND gate when the project is archived, even with `modify_us`', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            project: { my_permissions: ['modify_us'], archived_code: 'archived' },
        });

        expect(harness.api().dndProviderProps.disabled).toBe(true);
        expect(harness.api().getContainers()).toHaveLength(0);
    });

    it('registers and enables when `modify_us` is present and the project is live', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        expect(harness.api().dndProviderProps.disabled).toBe(false);
        expect(harness.api().getContainers()).toEqual([board.column(1)]);
    });

    it('emits nothing for a gated board even when a whole gesture is driven', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11, 12] }] });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            project: { my_permissions: [] },
            getCard: makeCardLookup([makeCardVm(11, 1, null), makeCardVm(12, 1, null)]),
        });

        const gesture = beginGesture(harness, board.card(12));

        gesture.over(board.column(1));
        gesture.end();

        expect(harness.emitMove).not.toHaveBeenCalled();
    });

    it('keeps the two gates independent — an archived project alone does not enable the drag', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            project: { my_permissions: [], archived_code: null },
        });

        expect(harness.api().dndProviderProps.disabled).toBe(true);
    });
});

describe('useCardDrag — container registration', () => {
    it('registers exactly the requested swimlane, by the exact selector', () => {
        const board = mountBoard({
            swimlanes: [
                { swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }, { statusId: 2, cardIds: [] }] },
                { swimlaneId: 8, columns: [{ statusId: 1, cardIds: [] }] },
            ],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        harness.api().openSwimlane(7);

        expect(harness.api().getContainers()).toEqual([board.column(1, 7), board.column(2, 7)]);
        expect(harness.api().getContainers()).not.toContain(board.column(1, 8));
    });

    it('appends a newly opened swimlane to the SAME registration, in DOM order', () => {
        const board = mountBoard({
            swimlanes: [
                { swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }] },
                { swimlaneId: 8, columns: [{ statusId: 1, cardIds: [] }] },
            ],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        harness.api().openSwimlane(7);
        harness.api().openSwimlane(8);

        expect(harness.api().getContainers()).toEqual([board.column(1, 7), board.column(1, 8)]);
    });

    it('never records a duplicate container when a swimlane is re-opened', () => {
        const board = mountBoard({
            swimlanes: [{ swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }] }],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        harness.api().openSwimlane(7);
        harness.api().openSwimlane(7);
        harness.api().openSwimlane(7);

        expect(harness.api().getContainers()).toEqual([board.column(1, 7)]);
    });

    it('registers nothing for a swimlane that is not in the board', () => {
        const board = mountBoard({
            swimlanes: [{ swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }] }],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        harness.api().openSwimlane(99);

        expect(harness.api().getContainers()).toHaveLength(0);
    });

    it('registers the unclassified swimlane, whose id is negative', () => {
        const board = mountBoard({
            swimlanes: [
                { swimlaneId: UNCLASSIFIED_SWIMLANE_ID, columns: [{ statusId: 1, cardIds: [] }] },
            ],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        harness.api().openSwimlane(UNCLASSIFIED_SWIMLANE_ID);

        expect(harness.api().getContainers()).toEqual([
            board.column(1, UNCLASSIFIED_SWIMLANE_ID),
        ]);
    });

    it('refuses a non-finite swimlane id rather than composing a selector from it', () => {
        const board = mountBoard({
            swimlanes: [{ swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }] }],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        expect(() => {
            harness.api().openSwimlane(Number.NaN);
        }).not.toThrow();
        expect(harness.api().getContainers()).toHaveLength(0);
    });
});

describe('useCardDrag — flat bootstrap', () => {
    it('registers every flat column once the table has loaded', () => {
        const board = mountBoard({
            flat: [
                { statusId: 1, cardIds: [11] },
                { statusId: 2, cardIds: [] },
                { statusId: 3, cardIds: [] },
            ],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        expect(harness.api().getContainers()).toEqual([
            board.column(1),
            board.column(2),
            board.column(3),
        ]);
    });

    it('registers nothing until the table reports itself loaded', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef, isTableLoaded: false });

        expect(harness.api().getContainers()).toHaveLength(0);

        act(() => {
            harness.rerender({ isTableLoaded: true });
        });

        expect(harness.api().getContainers()).toEqual([board.column(1)]);
    });

    it('returns early in swimlane mode, because each swimlane registers itself', () => {
        const board = mountBoard({
            swimlanes: [{ swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }] }],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        expect(harness.api().getContainers()).toHaveLength(0);

        harness.api().openSwimlane(7);

        expect(harness.api().getContainers()).toEqual([board.column(1, 7)]);
    });

    it('keeps watching in swimlane mode, so a board that loses its swimlanes still bootstraps', () => {
        const board = mountBoard({
            swimlanes: [{ swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }] }],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        expect(harness.api().getContainers()).toHaveLength(0);

        board.wrapper.classList.remove('swimlane');

        act(() => {
            harness.rerender({ isTableLoaded: false });
        });
        act(() => {
            harness.rerender({ isTableLoaded: true });
        });

        expect(harness.api().getContainers()).toEqual([board.column(1, 7)]);
    });

    it('bootstraps at most once, so re-registration cannot duplicate a container', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        act(() => {
            harness.rerender({ isTableLoaded: false });
        });
        act(() => {
            harness.rerender({ isTableLoaded: true });
        });

        expect(harness.api().getContainers()).toEqual([board.column(1)]);
    });

    it('registers nothing when the board root is not mounted yet', () => {
        const harness = renderCardDrag({ rootRef: { current: null } });

        expect(harness.api().getContainers()).toHaveLength(0);
    });
});

describe('useCardDrag — the moves predicate', () => {
    it('accepts a card element and rejects everything else', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef });
        const { canMove } = harness.api();

        expect(canMove(board.card(11))).toBe(true);
        expect(canMove(board.column(1))).toBe(false);
        expect(canMove(document.createElement('div'))).toBe(false);
        expect(canMove(null)).toBe(false);
        expect(canMove(undefined)).toBe(false);
        expect(canMove('tg-card')).toBe(false);
    });

    it('tracks no gesture whose subject is not a card, and emits nothing for it', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11, 12] }] });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: makeCardLookup([makeCardVm(11, 1, null), makeCardVm(12, 1, null)]),
        });
        const api = harness.api();
        const impostor = document.createElement('div');

        impostor.dataset.id = '12';
        board.column(1).appendChild(impostor);

        const active = makeActive(12, api.getDraggableData(impostor));

        api.dndProviderProps.onDragStart?.(makeDragStartEvent(active));
        api.dndProviderProps.onDragOver?.(
            makeDragEvent(active, makeOver(board.column(1).id, api.getDroppableData(board.column(1)))),
        );
        api.dndProviderProps.onMultiDragEnd?.([], makeDragEvent(active, null));
        api.dndProviderProps.onDragEnd?.(makeDragEvent(active, null));

        expect(harness.emitMove).not.toHaveBeenCalled();
    });
});

describe('useCardDrag — multi-selection integration', () => {
    it('declares the board call order: the selection is read BEFORE the gesture is armed', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        expect(harness.api().dndProviderProps.multiDragCallOrder).toBe('elements-then-start');
    });

    it('reads the selection at drag start and never arms the gesture itself', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11, 12] }] });
        const order: string[] = [];
        const controller = createMultiDrag();
        const spied: MultiDragController = {
            ...controller,
            getElements: (): readonly HTMLElement[] => {
                order.push('getElements');

                return controller.getElements();
            },
            start: (item: HTMLElement, container: HTMLElement | readonly HTMLElement[]): void => {
                order.push('start');
                controller.start(item, container);
            },
            stop: (): readonly HTMLElement[] => {
                order.push('stop');

                return controller.stop();
            },
        };
        const harness = renderCardDrag({ rootRef: board.rootRef, multiDrag: spied });

        beginGesture(harness, board.card(11));

        expect(order).toEqual(['getElements']);
    });

    it('never calls stop() itself — the provider owns it, exactly once', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11, 12] }] });
        const controller = createMultiDrag();
        let stops = 0;
        const spied: MultiDragController = {
            ...controller,
            stop: (): readonly HTMLElement[] => {
                stops += 1;

                return controller.stop();
            },
        };
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            multiDrag: spied,
            getCard: makeCardLookup([makeCardVm(11, 1, null), makeCardVm(12, 1, null)]),
        });

        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1));
        gesture.end();

        expect(stops).toBe(0);
    });

    it('falls back to the single dragged element when the selection is empty', () => {
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: 7,
                    columns: [
                        { statusId: 1, cardIds: [11, 12] },
                        { statusId: 2, cardIds: [] },
                    ],
                },
            ],
        });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: makeCardLookup([makeCardVm(11, 1, 7), makeCardVm(12, 1, 7)]),
        });

        harness.api().openSwimlane(7);

        const gesture = beginGesture(harness, board.card(12));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.end([]);

        expect(harness.emitMove).toHaveBeenCalledTimes(1);
        expect(harness.emitMove.mock.calls[0][1]).toEqual([
            { id: 12, oldStatusId: 1, oldSwimlaneId: 7 },
        ]);
    });

    it('hands the FULL registered container list to the draggable data', () => {
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: 7,
                    columns: [
                        { statusId: 1, cardIds: [11] },
                        { statusId: 2, cardIds: [] },
                    ],
                },
            ],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        harness.api().openSwimlane(7);

        const data = harness.api().getDraggableData(board.card(11));

        expect(data.sourceNode).toBe(board.card(11));
        expect(data.multiDragContainer).toEqual([board.column(1, 7), board.column(2, 7)]);
    });

    it('reveals the screen-owned ghost through the shared class lifecycle, and cleans it up', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11, 12] }] });
        const controller = createMultiDrag();
        const harness = renderCardDrag({ rootRef: board.rootRef, multiDrag: controller });
        const main = board.card(11);
        const other = board.card(12);

        main.classList.add(MULTIPLE_SORTABLE_CLASS);
        other.classList.add(MULTIPLE_SORTABLE_CLASS);

        const mirror = document.createElement('div');

        mirror.className = MIRROR_CLASS;
        document.body.appendChild(mirror);

        const gesture = beginGesture(harness, main);

        controller.start(main, harness.api().getContainers());
        document.documentElement.dispatchEvent(new Event('mousemove'));

        const clones = document.querySelectorAll(`.${MULTIPLE_DRAG_MIRROR_CLASS}`);

        expect(clones).toHaveLength(1);
        expect(clones[0].classList.contains(TG_MULTIPLE_DRAG_MIRROR_CLASS)).toBe(true);
        expect(main.classList.contains(MAIN_DRAG_CLASS)).toBe(true);
        expect(other.classList.contains(TG_MULTIPLE_DRAG_DRAGGING_CLASS)).toBe(true);

        const ghost = clones[0].querySelector('.card-transit-multi');

        expect(ghost).not.toBeNull();
        expect(ghost?.querySelectorAll('.fake-us')).toHaveLength(FAKE_US_COUNT);

        gesture.end(controller.stop());

        expect(document.querySelectorAll(`.${MULTIPLE_DRAG_MIRROR_CLASS}`)).toHaveLength(0);
        expect(document.querySelectorAll(`.${TG_MULTIPLE_DRAG_MIRROR_CLASS}`)).toHaveLength(0);
        expect(main.classList.contains(MAIN_DRAG_CLASS)).toBe(false);
        expect(other.classList.contains(TG_MULTIPLE_DRAG_DRAGGING_CLASS)).toBe(false);
    });

    it('adds and removes NEITHER the selection class — the screen owns it', () => {
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: 7,
                    columns: [
                        { statusId: 1, cardIds: [11] },
                        { statusId: 2, cardIds: [] },
                    ],
                },
            ],
        });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: makeCardLookup([makeCardVm(11, 1, 7)]),
        });

        harness.api().openSwimlane(7);

        const card = board.card(11);

        card.classList.add(MULTIPLE_SORTABLE_CLASS);

        const gesture = beginGesture(harness, card);

        gesture.over(board.column(1, 7));
        gesture.end();

        expect(card.classList.contains(MULTIPLE_SORTABLE_CLASS)).toBe(true);
    });
});

/* --------------------------------------------------------------------------
 * A three-column, two-swimlane fixture reused by the ordering specifications.
 * -------------------------------------------------------------------------- */

interface OrderingFixture {
    readonly board: MountedBoard;
    readonly harness: Harness;
}

function mountOrderingFixture(): OrderingFixture {
    const board = mountBoard({
        swimlanes: [
            {
                swimlaneId: 7,
                columns: [
                    { statusId: 1, cardIds: [11, 12, 13] },
                    { statusId: 2, cardIds: [] },
                ],
            },
            {
                swimlaneId: 8,
                columns: [
                    { statusId: 1, cardIds: [21] },
                    { statusId: 2, cardIds: [] },
                ],
            },
        ],
    });
    const harness = renderCardDrag({
        rootRef: board.rootRef,
        getCard: makeCardLookup([
            makeCardVm(11, 1, 7),
            makeCardVm(12, 1, 7),
            makeCardVm(13, 1, 7),
            makeCardVm(21, 1, 8),
        ]),
    });

    harness.api().openSwimlane(7);
    harness.api().openSwimlane(8);

    return { board, harness };
}

describe('useCardDrag — target-drop', () => {
    it('does NOT highlight the first container hovered, which is where the drag began', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));

        expect(board.column(1, 7).classList.contains(TARGET_DROP_CLASS)).toBe(false);
    });

    it('highlights a container that differs from the first one hovered', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));

        expect(board.column(2, 7).classList.contains(TARGET_DROP_CLASS)).toBe(true);
    });

    it('removes the highlight when the pointer leaves for another container', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.over(board.column(2, 8));

        expect(board.column(2, 7).classList.contains(TARGET_DROP_CLASS)).toBe(false);
        expect(board.column(2, 8).classList.contains(TARGET_DROP_CLASS)).toBe(true);
    });

    it('removes the highlight when the pointer leaves every container', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.over(null);

        expect(board.column(2, 7).classList.contains(TARGET_DROP_CLASS)).toBe(false);
    });

    it('leaves no highlight behind after the drag ends', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.end();

        expect(document.querySelectorAll(`.${TARGET_DROP_CLASS}`)).toHaveLength(0);
    });
});

describe('useCardDrag — R-DND-2 ordering', () => {
    it('FIRST-POSITION: reports no previous anchor and the following card as the next', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(13));

        gesture.over(board.card(11));
        gesture.end();

        expect(cardIdsIn(board.column(1, 7))).toEqual(['13', '11', '12']);
        expect(harness.emitMove).toHaveBeenCalledTimes(1);

        const call = harness.emitMove.mock.calls[0];

        expect(call[4]).toBe(0);
        expect(call[5]).toBeNull();
        expect(call[6]).toBe(11);
    });

    it('LAST-POSITION: reports the preceding card as the previous anchor and no next', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.end();

        expect(cardIdsIn(board.column(1, 7))).toEqual(['12', '13', '11']);

        const call = harness.emitMove.mock.calls[0];

        expect(call[4]).toBe(2);
        expect(call[5]).toBe(13);
        expect(call[6]).toBeNull();
    });

    it('MIDDLE-POSITION: previous wins, so the next anchor is not reported at all', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(13));

        gesture.over(board.card(12));
        gesture.end();

        expect(cardIdsIn(board.column(1, 7))).toEqual(['11', '13', '12']);

        const call = harness.emitMove.mock.calls[0];

        expect(call[4]).toBe(1);
        expect(call[5]).toBe(11);
        expect(call[6]).toBeNull();
    });

    it('CROSS-CONTAINER: reports the destination status AND swimlane, with no anchors', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 8));
        gesture.end();

        expect(harness.emitMove).toHaveBeenCalledTimes(1);

        const call = harness.emitMove.mock.calls[0];

        expect(call[2]).toBe(2);
        expect(call[3]).toBe(8);
        expect(call[4]).toBe(0);
        expect(call[5]).toBeNull();
        expect(call[6]).toBeNull();
    });

    it('CROSS-CONTAINER: orders against the destination card, never the origin one', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(12));

        gesture.over(board.column(1, 7));
        gesture.over(board.card(21));

        // Measured BEFORE the drop is settled: the element is removed once the
        // destination swimlane is found to differ, which is the very next step.
        expect(cardIdsIn(board.column(1, 8))).toEqual(['12', '21']);

        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        expect(call[2]).toBe(1);
        expect(call[3]).toBe(8);
        expect(call[4]).toBe(0);
        expect(call[5]).toBeNull();
        expect(call[6]).toBe(21);
    });

    it('emits nothing at all for a drop that changed neither index nor container', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        // Hovering the card that already follows it: the arrangement it describes is
        // the one that already stands, so nothing is moved and the guard fires.
        gesture.over(board.card(12));
        gesture.end();

        expect(cardIdsIn(board.column(1, 7))).toEqual(['11', '12', '13']);
        expect(harness.emitMove).not.toHaveBeenCalled();
    });

    it('emits nothing when the card is dropped back onto its own position', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(13));

        gesture.over(board.card(11));
        gesture.over(board.card(13));
        gesture.end();

        expect(cardIdsIn(board.column(1, 7))).toEqual(['11', '12', '13']);
        expect(harness.emitMove).not.toHaveBeenCalled();
    });

    it('refuses a drop naming a story the board does not hold, and emits nothing', () => {
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: 7,
                    columns: [
                        { statusId: 1, cardIds: [11, 12] },
                        { statusId: 2, cardIds: [] },
                    ],
                },
            ],
        });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: makeCardLookup([makeCardVm(11, 1, 7)]),
        });

        harness.api().openSwimlane(7);

        const gesture = beginGesture(harness, board.card(12));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.end();

        expect(harness.emitMove).not.toHaveBeenCalled();
    });
});

describe('useCardDrag — the destination column', () => {
    it('reads the status and swimlane off the destination column', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        expect(call[2]).toBe(2);
        expect(call[3]).toBe(7);
    });

    it('reports a not-a-number swimlane on a FLAT board, because the column carries none', () => {
        const board = mountBoard({
            flat: [
                { statusId: 1, cardIds: [11, 12] },
                { statusId: 2, cardIds: [] },
            ],
        });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: makeCardLookup([makeCardVm(11, 1, null), makeCardVm(12, 1, null)]),
        });

        expect(board.column(2).dataset.swimlane).toBeUndefined();

        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1));
        gesture.over(board.column(2));
        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        expect(call[2]).toBe(2);
        expect(Number.isNaN(call[3])).toBe(true);
    });

    it('flashes the destination column and clears the flash on the first animation end', () => {
        const { board, harness } = mountOrderingFixture();
        const destination = board.column(2, 7);
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(destination);
        gesture.end();

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);

        destination.dispatchEvent(new Event(ANIMATION_END_EVENT));

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(false);

        destination.classList.add(NEW_COLUMN_CLASS);
        destination.dispatchEvent(new Event(ANIMATION_END_EVENT));

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);
    });

    it('does not flash a column when the drag never left it', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.end();

        expect(board.column(1, 7).classList.contains(NEW_COLUMN_CLASS)).toBe(false);
    });
});

describe('useCardDrag — the moved-story payload', () => {
    it('carries `model.swimlane` with NO fallback, so an unclassified story reports null', () => {
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
                    columns: [
                        { statusId: 1, cardIds: [11, 12] },
                        { statusId: 2, cardIds: [] },
                    ],
                },
            ],
        });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: makeCardLookup([makeCardVm(11, 1, null), makeCardVm(12, 1, null)]),
        });

        harness.api().openSwimlane(UNCLASSIFIED_SWIMLANE_ID);

        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, UNCLASSIFIED_SWIMLANE_ID));
        gesture.over(board.column(2, UNCLASSIFIED_SWIMLANE_ID));
        gesture.end();

        expect(harness.emitMove.mock.calls[0][1]).toEqual([
            { id: 11, oldStatusId: 1, oldSwimlaneId: null },
        ]);
    });

    it('keeps the element in place when the comparison collapses null to the sentinel', () => {
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: UNCLASSIFIED_SWIMLANE_ID,
                    columns: [{ statusId: 1, cardIds: [11, 12, 13] }],
                },
            ],
        });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: makeCardLookup([
                makeCardVm(11, 1, null),
                makeCardVm(12, 1, null),
                makeCardVm(13, 1, null),
            ]),
        });

        harness.api().openSwimlane(UNCLASSIFIED_SWIMLANE_ID);

        const card = board.card(11);
        const gesture = beginGesture(harness, card);

        gesture.over(board.column(1, UNCLASSIFIED_SWIMLANE_ID));
        gesture.end();

        expect(harness.emitMove).toHaveBeenCalledTimes(1);
        expect(card.isConnected).toBe(true);
    });

    it('removes the element when the destination status differs, without destroying a scope', () => {
        const { board, harness } = mountOrderingFixture();
        const card = board.card(11);
        const gesture = beginGesture(harness, card);

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.end();

        expect(card.isConnected).toBe(false);
        expect(harness.emitMove).toHaveBeenCalledTimes(1);
    });

    it('removes the element when only the destination SWIMLANE differs', () => {
        const { board, harness } = mountOrderingFixture();
        const card = board.card(11);
        const gesture = beginGesture(harness, card);

        gesture.over(board.column(1, 7));
        gesture.over(board.column(1, 8));
        gesture.end();

        expect(card.isConnected).toBe(false);
    });

    it('preserves the dragged order across a multi-card move', () => {
        const { board, harness } = mountOrderingFixture();
        const first = board.card(11);
        const second = board.card(12);

        first.classList.add(MULTIPLE_SORTABLE_CLASS);
        second.classList.add(MULTIPLE_SORTABLE_CLASS);

        const gesture = beginGesture(harness, first);

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.end([first, second]);

        expect(harness.emitMove.mock.calls[0][1]).toEqual([
            { id: 11, oldStatusId: 1, oldSwimlaneId: 7 },
            { id: 12, oldStatusId: 1, oldSwimlaneId: 7 },
        ]);
        expect(first.isConnected).toBe(false);
        expect(second.isConnected).toBe(false);
    });
});

describe('useCardDrag — the frozen emission', () => {
    it('exports the exact event name the retained controller listens for', () => {
        expect(KANBAN_US_MOVE_EVENT).toBe('kanban:us:move');
    });

    it('emits the event name followed by exactly six positional arguments, in order', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.card(21));
        gesture.end();

        expect(harness.emitMove).toHaveBeenCalledTimes(1);

        const call = harness.emitMove.mock.calls[0];

        expect(call).toHaveLength(7);
        expect(call[0]).toBe('kanban:us:move');
        expect(call[1]).toEqual([{ id: 11, oldStatusId: 1, oldSwimlaneId: 7 }]);
        expect(call[2]).toBe(1);
        expect(call[3]).toBe(8);
        expect(call[4]).toBe(0);
        expect(call[5]).toBeNull();
        expect(call[6]).toBe(21);
    });

    it('emits after the elements that changed container have been removed', () => {
        const { board, harness } = mountOrderingFixture();
        const card = board.card(11);
        let connectedAtEmit: boolean | null = null;

        harness.emitMove.mockImplementation((): void => {
            connectedAtEmit = card.isConnected;
        });

        const gesture = beginGesture(harness, card);

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.end();

        expect(connectedAtEmit).toBe(false);
    });
});

describe('useCardDrag — cancellation and teardown', () => {
    it('emits nothing when the gesture is cancelled, and restores the element', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.cancel();

        expect(harness.emitMove).not.toHaveBeenCalled();
        expect(cardIdsIn(board.column(1, 7))).toEqual(['11', '12', '13']);
        expect(cardIdsIn(board.column(2, 7))).toEqual([]);
        expect(document.querySelectorAll(`.${TARGET_DROP_CLASS}`)).toHaveLength(0);
    });

    it('leaves nothing behind when the subtree unmounts mid-drag', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));

        expect(board.column(2, 7).classList.contains(TARGET_DROP_CLASS)).toBe(true);

        act(() => {
            harness.unmount();
        });

        expect(document.querySelectorAll(`.${TARGET_DROP_CLASS}`)).toHaveLength(0);
        expect(document.querySelectorAll(`.${NEW_COLUMN_CLASS}`)).toHaveLength(0);
        expect(cardIdsIn(board.column(1, 7))).toEqual(['11', '12', '13']);
        expect(harness.emitMove).not.toHaveBeenCalled();
    });

    it('strips a pending flash and its listener on unmount', () => {
        const { board, harness } = mountOrderingFixture();
        const destination = board.column(2, 7);
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(destination);
        gesture.end();

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);

        act(() => {
            harness.unmount();
        });

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(false);

        destination.classList.add(NEW_COLUMN_CLASS);
        destination.dispatchEvent(new Event(ANIMATION_END_EVENT));

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);
    });

    it('clears the registered containers on unmount', () => {
        const { board, harness } = mountOrderingFixture();

        expect(harness.api().getContainers()).toHaveLength(4);

        const containers = harness.api().getContainers();

        act(() => {
            harness.unmount();
        });

        expect(containers).toHaveLength(4);
        expect(board.root.isConnected).toBe(true);
    });

    it('survives a second cancellation with no gesture in flight', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.cancel();

        expect(() => {
            gesture.cancel();
        }).not.toThrow();
        expect(harness.emitMove).not.toHaveBeenCalled();
    });

    it('re-opening a swimlane after a cancelled gesture leaks no duplicate container', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(2, 7));
        gesture.cancel();
        harness.api().openSwimlane(7);
        harness.api().openSwimlane(8);

        expect(harness.api().getContainers()).toHaveLength(4);
    });
});

describe('useCardDrag — autoscroll', () => {
    it('supplies the board configuration exactly, and never the story list\'s', () => {
        const { board, harness } = mountOrderingFixture();
        const { autoScroll } = harness.api().dndProviderProps;

        expect(autoScroll.enabled).toBe(true);
        expect(autoScroll.margin).toBe(KANBAN_AUTOSCROLL_MARGIN);
        expect(autoScroll.scrollWhenOutside).toBe(true);
        expect(autoScroll.pixels).toBeUndefined();
        expect(autoScroll.maxSpeed).toBeUndefined();
        expect(Object.keys(autoScroll).sort()).toEqual([
            'enabled',
            'getTargets',
            'margin',
            'scrollWhenOutside',
        ]);
        expect(autoScroll.getTargets()).toEqual([
            board.column(1, 7),
            board.column(2, 7),
            board.column(1, 8),
            board.column(2, 8),
        ]);
    });

    it('never targets the window', () => {
        const { harness } = mountOrderingFixture();
        const targets = harness.api().dndProviderProps.autoScroll.getTargets();

        for (const target of targets) {
            expect(target).not.toBe(window);
            expect(target instanceof HTMLElement).toBe(true);
        }
    });

    it('keeps one stable configuration object across renders', () => {
        const { harness } = mountOrderingFixture();
        const before = harness.api().dndProviderProps.autoScroll;

        act(() => {
            harness.rerender({ isTableLoaded: true });
        });

        expect(harness.api().dndProviderProps.autoScroll).toBe(before);
    });

    it('resolves its targets live, so a swimlane opened later is scrollable', () => {
        const board = mountBoard({
            swimlanes: [
                { swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }] },
                { swimlaneId: 8, columns: [{ statusId: 1, cardIds: [] }] },
            ],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });
        const { getTargets } = harness.api().dndProviderProps.autoScroll;

        expect(getTargets()).toHaveLength(0);

        harness.api().openSwimlane(7);

        expect(getTargets()).toHaveLength(1);

        harness.api().openSwimlane(8);

        expect(getTargets()).toHaveLength(2);
    });
});

describe('useCardDrag — droppable and draggable data', () => {
    it('yields the column alone for a column droppable', () => {
        const { board, harness } = mountOrderingFixture();

        expect(harness.api().getDroppableData(board.column(1, 7))).toEqual({
            containerNode: board.column(1, 7),
        });
    });

    it('yields the card and its column for a card droppable', () => {
        const { board, harness } = mountOrderingFixture();

        expect(harness.api().getDroppableData(board.card(12))).toEqual({
            containerNode: board.column(1, 7),
            itemNode: board.card(12),
        });
    });

    it('resolves a droppable that carries no data at all by its positional attribute', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(13));

        gesture.overById(11);
        gesture.end();

        expect(cardIdsIn(board.column(1, 7))).toEqual(['13', '11', '12']);
        expect(harness.emitMove.mock.calls[0][4]).toBe(0);
    });

    it('leaves the arrangement untouched when the droppable matches nothing', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(13));

        gesture.overById('nothing-here');

        expect(cardIdsIn(board.column(1, 7))).toEqual(['11', '12', '13']);
        expect(document.querySelectorAll(`.${TARGET_DROP_CLASS}`)).toHaveLength(0);
    });

    it('reproduces the incumbent quirk: the guard cannot fire with no container ever hovered', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(13));

        // The retired library captured its initial container from the FIRST hover, so a
        // gesture released before any hover left that value unset — and an unset value
        // equals no real column, which is why the unchanged-drop guard could not fire
        // and the move was broadcast with an index equal to the start index. Preserved
        // verbatim under rule T10, quirk and all.
        gesture.end();

        expect(cardIdsIn(board.column(1, 7))).toEqual(['11', '12', '13']);
        expect(harness.emitMove).toHaveBeenCalledTimes(1);
        expect(harness.emitMove.mock.calls[0][4]).toBe(2);
        expect(board.column(1, 7).classList.contains(NEW_COLUMN_CLASS)).toBe(true);
    });

    it('forwards the overlay renderer and the collision strategy untouched', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [] }] });
        const renderOverlay = (): null => null;
        const collisionDetection = (): [] => [];
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            renderOverlay,
            collisionDetection,
        });

        expect(harness.api().dndProviderProps.renderOverlay).toBe(renderOverlay);
        expect(harness.api().dndProviderProps.collisionDetection).toBe(collisionDetection);
    });

    it('hands the provider the very controller it queries', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [] }] });
        const controller = createMultiDrag();
        const harness = renderCardDrag({ rootRef: board.rootRef, multiDrag: controller });

        expect(harness.api().dndProviderProps.multiDrag).toBe(controller);
    });
});

describe('useCardDrag — viewport registration (R-DND-3)', () => {
    it('registers a column and a card without consulting visibility', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef });
        const column = board.column(1);
        const card = board.card(11);

        card.style.display = 'none';

        harness.api().registerColumn(column, 1, 7);
        harness.api().registerCard(card, 1, 7);

        expect(harness.inViewport.columnCalls).toEqual([[column, 1, 7]]);
        expect(harness.inViewport.cardCalls).toEqual([[card, 1, 7]]);
    });

    it('registers an off-screen card whose inner wrapper has not rendered', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef });
        const card = board.card(11);
        const inner = card.querySelector('.card-inner');

        inner?.remove();

        harness.api().registerCard(card, 1);

        expect(card.querySelector('.card-inner')).toBeNull();
        expect(harness.inViewport.cardCalls).toEqual([[card, 1, undefined]]);
    });

    it('never unregisters anything of its own accord', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        harness.api().registerCard(board.card(12), 1, 7);
        gesture.over(board.column(2, 7));
        gesture.end();

        act(() => {
            harness.unmount();
        });

        expect(harness.inViewport.unregisterCalls).toBe(0);
    });

    it('refuses a null ref rather than forwarding it', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        harness.api().registerColumn(null, 1);
        harness.api().registerCard(null, 1);

        expect(harness.inViewport.columnCalls).toHaveLength(0);
        expect(harness.inViewport.cardCalls).toHaveLength(0);
    });

    it('re-exposes the write-once latch verbatim', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        expect(harness.api().visibleIds).toBe(harness.inViewport.visibleIds);
    });

    it('keeps an off-screen card as a legitimate drop neighbour', () => {
        const { board, harness } = mountOrderingFixture();
        const offScreen = board.card(11);

        offScreen.querySelector('.card-inner')?.remove();

        const gesture = beginGesture(harness, board.card(13));

        gesture.over(offScreen);
        gesture.end();

        expect(offScreen.querySelector('.card-inner')).toBeNull();
        expect(harness.emitMove.mock.calls[0][5]).toBeNull();
        expect(harness.emitMove.mock.calls[0][6]).toBe(11);
    });
});

describe('useCardDrag — defensive paths', () => {
    it('creates its own multi-selection controller when none is supplied', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const emitMove: EmitMoveMock = jest.fn();
        const view = renderHook((props: UseCardDragOptions) => useCardDrag(props), {
            initialProps: {
                project: { my_permissions: ['modify_us'] },
                rootRef: board.rootRef,
                isTableLoaded: true,
                getCard: makeCardLookup([makeCardVm(11, 1, null)]),
                emitMove,
                inViewport: makeInViewport(),
            },
        });

        const { multiDrag } = view.result.current.dndProviderProps;

        expect(multiDrag).toBeDefined();
        expect(multiDrag?.getElements()).toEqual([]);
        expect(view.result.current.dndProviderProps.multiDrag).toBe(multiDrag);
    });

    it('re-flashes a column whose previous flash had not finished, without stacking listeners', () => {
        const { board, harness } = mountOrderingFixture();
        const destination = board.column(2, 7);

        const first = beginGesture(harness, board.card(11));

        first.over(board.column(1, 7));
        first.over(destination);
        first.end();

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);

        const second = beginGesture(harness, board.card(12));

        second.over(board.column(1, 7));
        second.over(destination);
        second.end();

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);

        destination.dispatchEvent(new Event(ANIMATION_END_EVENT));

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(false);

        destination.classList.add(NEW_COLUMN_CLASS);
        destination.dispatchEvent(new Event(ANIMATION_END_EVENT));

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);
    });

    it('emits nothing when the dragged element is not inside a column at drag end', () => {
        const { board, harness } = mountOrderingFixture();
        const card = board.card(11);
        const gesture = beginGesture(harness, card);

        gesture.over(board.column(1, 7));
        board.root.appendChild(card);
        gesture.end();

        expect(harness.emitMove).not.toHaveBeenCalled();
    });

    it('aborts rather than half-applying a move when the story map contradicts itself', () => {
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: 7,
                    columns: [
                        { statusId: 1, cardIds: [11, 12] },
                        { statusId: 2, cardIds: [] },
                    ],
                },
            ],
        });
        const known = makeCardLookup([makeCardVm(11, 1, 7), makeCardVm(12, 1, 7)]);
        let membershipChecks = 0;
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: (id: number): CardUserStoryVm | undefined => {
                membershipChecks += 1;

                return membershipChecks > 2 ? undefined : known(id);
            },
        });

        harness.api().openSwimlane(7);

        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.end();

        expect(harness.emitMove).not.toHaveBeenCalled();
        expect(board.card(11).isConnected).toBe(true);
    });

    it('resolves the dragged element from its positional attribute when none is nominated', () => {
        const { board, harness } = mountOrderingFixture();
        const api = harness.api();
        const active = makeActive(13, {
            sourceNode: board.card(13),
            multiDragContainer: api.getContainers(),
        });

        active.data.current = {};

        api.dndProviderProps.onDragStart?.(makeDragStartEvent(active));
        api.dndProviderProps.onDragOver?.(
            makeDragEvent(active, makeOver(11, api.getDroppableData(board.card(11)))),
        );
        api.dndProviderProps.onMultiDragEnd?.([], makeDragEvent(active, null));
        api.dndProviderProps.onDragEnd?.(makeDragEvent(active, null));

        expect(cardIdsIn(board.column(1, 7))).toEqual(['13', '11', '12']);
        expect(harness.emitMove).toHaveBeenCalledTimes(1);
    });

    it('tolerates a droppable whose data is not an object at all', () => {
        const { board, harness } = mountOrderingFixture();
        const api = harness.api();
        const active = makeActive(13, api.getDraggableData(board.card(13)));

        api.dndProviderProps.onDragStart?.(makeDragStartEvent(active));

        const over = makeOver(13, {});

        if (over !== null) {
            over.data.current = undefined;
        }

        expect(() => {
            api.dndProviderProps.onDragOver?.(makeDragEvent(active, over));
        }).not.toThrow();
        expect(cardIdsIn(board.column(1, 7))).toEqual(['11', '12', '13']);
    });

    it('discards an insertion reference that is not a child of the resolved column', () => {
        const { board, harness } = mountOrderingFixture();
        const api = harness.api();
        const active = makeActive(13, api.getDraggableData(board.card(13)));

        api.dndProviderProps.onDragStart?.(makeDragStartEvent(active));
        api.dndProviderProps.onDragOver?.(
            makeDragEvent(
                active,
                makeOver(21, {
                    containerNode: board.column(2, 7),
                    itemNode: board.card(21),
                }),
            ),
        );

        expect(cardIdsIn(board.column(2, 7))).toEqual(['13']);
        expect(cardIdsIn(board.column(1, 8))).toEqual(['21']);
    });

    it('ignores a drag-over that arrives with no gesture in flight', () => {
        const { board, harness } = mountOrderingFixture();
        const api = harness.api();
        const active = makeActive(11, api.getDraggableData(board.card(11)));

        expect(() => {
            api.dndProviderProps.onDragOver?.(
                makeDragEvent(active, makeOver(11, api.getDroppableData(board.card(12)))),
            );
        }).not.toThrow();
        expect(cardIdsIn(board.column(1, 7))).toEqual(['11', '12', '13']);
    });

    it('ignores a drag-end that arrives with no gesture in flight', () => {
        const { board, harness } = mountOrderingFixture();
        const api = harness.api();
        const active = makeActive(11, api.getDraggableData(board.card(11)));

        api.dndProviderProps.onMultiDragEnd?.([], makeDragEvent(active, null));
        api.dndProviderProps.onDragEnd?.(makeDragEvent(active, null));

        expect(harness.emitMove).not.toHaveBeenCalled();
    });

    it('restores a displaced element even when its remembered sibling has gone', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        board.card(12).remove();
        board.card(13).remove();
        gesture.cancel();

        expect(cardIdsIn(board.column(1, 7))).toEqual(['11']);
    });
});

/* ==========================================================================
 * STATIC GATES
 * ==========================================================================
 * Read the implementation's own source and assert that the forbidden tokens
 * appear nowhere in its CODE. Several of them appear legitimately in its
 * documentation — the whole file explains what it is a port of — so comments are
 * stripped first.
 */

function readHookSource(): string {
    return readFileSync(join(__dirname, 'useCardDrag.ts'), 'utf8');
}

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('useCardDrag — static gates', () => {
    const code = stripComments(readHookSource());

    it.each([
        ['a legacy script import', 'app/js/'],
        ['jQuery', 'jquery'],
        ['a jQuery call', '$('],
        ['the retired drag library', 'dragula'],
        ['the retired autoscroller', 'dom-autoscroller'],
        ['the ordering companion package', '@dnd-kit/sortable'],
        ['a fetch call', 'fetch('],
        ['an XHR', 'XMLHttpRequest'],
        ['an http client', 'axios'],
        ['the AngularJS http service', '$http'],
        ['a socket', 'WebSocket'],
        ['a multipart body', 'FormData'],
        ['the root scope', '$rootScope'],
        ['a scope', '$scope'],
        ['a scope teardown', '$destroy'],
        ['a scope accessor', '.scope()'],
        ['a timer', 'setTimeout'],
        ['a repeating timer', 'setInterval'],
        ['an animation frame', 'requestAnimationFrame'],
        ['an unsafe annotation', ': any'],
        ['an unsafe cast', 'as any'],
        ['a compiler suppression', '@ts-'],
        ['unsafe markup', 'dangerouslySetInnerHTML'],
        ['a shadow root', 'attachShadow'],
        ['a default React import', 'import React'],
        ['the story list autoscroll knob', 'pixels'],
        ['deferred work', 'TODO'],
        ['a known defect marker', 'FIXME'],
    ])('contains no %s', (_description: string, token: string) => {
        expect(code).not.toContain(token);
    });

    it('imports only React and the six sibling modules it depends on, values and types apart', () => {
        const specifiers = [...code.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

        expect(specifiers.sort()).toEqual([
            '../../shared/dnd/DndProvider',
            '../../shared/dnd/multiDrag',
            '../../shared/dnd/multiDrag',
            '../../shared/dnd/useSortableList',
            '../../shared/dnd/useSortableList',
            '../../shared/useInViewport',
            '../state/boardReducer',
            '../state/types',
            'react',
        ]);
    });

    it('states the frozen event name only as a literal type and a single constant', () => {
        expect(code.match(/'kanban:us:move'/g)).toHaveLength(2);
        expect(code).toContain("export type KanbanMoveEventName = 'kanban:us:move';");
        expect(code).toContain(
            "export const KANBAN_US_MOVE_EVENT: KanbanMoveEventName = 'kanban:us:move';",
        );
    });

    it('states the board autoscroll margin as the board\'s own number', () => {
        expect(code).toContain(`KANBAN_AUTOSCROLL_MARGIN = ${String(KANBAN_AUTOSCROLL_MARGIN)}`);
    });

    it('spells every runtime class contract verbatim', () => {
        expect(code).toContain(`'${TARGET_DROP_CLASS}'`);
        expect(code).toContain(`'${NEW_COLUMN_CLASS}'`);
        expect(code).toContain(`'${CARD_ELEMENT}'`);
        expect(code).toContain(`'${COLUMN_SELECTOR}'`);
    });

    it('never spells the unclassified sentinel as a bare number', () => {
        expect(code).toContain('UNCLASSIFIED_SWIMLANE_ID');
        expect(code).not.toContain('|| -1');
    });

    it('exports no default', () => {
        expect(code).not.toContain('export default');
    });
});

/* ==========================================================================
 * OBSERVER STUBS
 * ==========================================================================
 * Neither observer is reached by this hook — the viewport latch is injected — but
 * the stubs are installed so that a specification exercising a collaborator which
 * DOES construct one cannot fall over in an environment that provides neither.
 */

describe('useCardDrag — environment stubs', () => {
    it('runs with stubbed intersection and resize observers installed', () => {
        class StubObserver {
            observe(): void {
                return;
            }

            unobserve(): void {
                return;
            }

            disconnect(): void {
                return;
            }

            takeRecords(): [] {
                return [];
            }
        }

        const globals = globalThis as unknown as Record<string, unknown>;
        const previousIntersection = globals['IntersectionObserver'];
        const previousResize = globals['ResizeObserver'];

        globals['IntersectionObserver'] = StubObserver;
        globals['ResizeObserver'] = StubObserver;

        try {
            const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11, 12] }] });
            const harness = renderCardDrag({
                rootRef: board.rootRef,
                getCard: makeCardLookup([makeCardVm(11, 1, null), makeCardVm(12, 1, null)]),
            });
            const gesture = beginGesture(harness, board.card(11));

            gesture.over(board.column(1));
            gesture.end();

            expect(harness.emitMove).toHaveBeenCalledTimes(1);
        } finally {
            globals['IntersectionObserver'] = previousIntersection;
            globals['ResizeObserver'] = previousResize;
        }
    });
});
