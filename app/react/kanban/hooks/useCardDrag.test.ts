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
 *
 * ===========================================================================
 * THE HARNESS, AND WHY EACH PART OF IT IS THERE
 * ===========================================================================
 *   THE BRIDGE SEAM. Every render goes through `withMockInjector(mockInjector())`
 *       — an EMPTY injector whose `get()` throws for any name — mounted through
 *       `AngularBridgeProvider`. The hook consumes no AngularJS service, and that
 *       is precisely what the empty injector proves: it runs at the same seam
 *       every other React unit runs at, and the moment it reaches for a service
 *       the wrapper fails the suite with that helper's own diagnostic instead of
 *       resolving `undefined` quietly. No AngularJS is loaded, here or anywhere.
 *
 *   THE OBSERVER STUBS. `IntersectionObserver` and `ResizeObserver` are installed
 *       on `globalThis` before EVERY test and removed after it. jsdom provides
 *       neither, the viewport latch this hook is handed is built on the first, and
 *       a collaborator constructing one must not turn a drag assertion into an
 *       environment failure.
 *
 *   THE LAYOUT STUBS. jsdom lays nothing out: every box is 0×0 and every
 *       `getBoundingClientRect()` is all zeros, so any geometry-driven assertion
 *       would pass vacuously. {@link stubElementLayout} therefore gives named
 *       elements a real box, and the autoscroll specifications drive the shared
 *       provider's own pure geometry functions against it — which is what makes
 *       "the band is 100 px, measured on the COLUMNS" a behavioural claim rather
 *       than a restatement of a literal.
 *
 *   ANIMATION EVENTS ARE DISPATCHED EXPLICITLY. jsdom runs no animation, so the
 *       `animationend` that removes the `new` class never arrives on its own;
 *       `fireEvent.animationEnd(column)` stands in for it. A specification that
 *       waited for it would hang, and one that never sent it would not notice a
 *       class left on the column for ever.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, fireEvent, renderHook } from '@testing-library/react';

import type { AngularInjector } from '../../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../../bridge/mockInjector';
import {
    applyAutoScrollDelta,
    autoScrollTargetEdges,
    computeAutoScrollDelta,
    DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED,
    resolveAutoScrollTarget,
} from '../../shared/dnd/DndProvider';
import { createMultiDrag, TRANSIT_CLASS, TRANSIT_MULTI_CLASS } from '../../shared/dnd/multiDrag';
import type { MultiDragController } from '../../shared/dnd/multiDrag';
import type { InViewportApi } from '../../shared/useInViewport';
import { UNCLASSIFIED_SWIMLANE_ID } from '../state/boardReducer';
import type { CardUserStoryVm } from '../state/types';
import { KANBAN_US_MOVE_EVENT, useCardDrag } from './useCardDrag';
import type {
    KanbanBoardRootRef,
    KanbanCardLookup,
    KanbanDraggableData,
    KanbanDragProject,
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

/**
 * The placeholder class — owned by `../../shared/dnd/DndProvider`, and the one
 * KANBAN:98-L99 excludes from the neighbour scan with `tg-card:not(.gu-transit)`.
 * Restated here so a rename in the shared module fails a specification.
 */
const TRANSIT_CLASS_NAME = 'gu-transit';

/** `../../shared/dnd/multiDrag`'s reveal for `.card-transit-multi` (`card.scss`). */
const TRANSIT_MULTI_CLASS_NAME = 'gu-transit-multi';

const ANIMATION_END_EVENT = 'animationend';

const KANBAN_AUTOSCROLL_MARGIN = 100;

/**
 * The STORY LIST's autoscroll numbers — `{ margin: 20, pixels: 30 }` over
 * `[window]`, from the annotated backlog reference.
 *
 * They appear here only so the board's configuration can be asserted NOT to carry
 * them. The two screens diverge deliberately and unifying them would change how
 * the board scrolls, which rule T10 forbids.
 */
const STORY_LIST_AUTOSCROLL_MARGIN = 20;

const STORY_LIST_AUTOSCROLL_PIXELS = 30;

/** `card.jade` L45-L55 renders exactly two of these; `../KanbanCard` reproduces it. */
const FAKE_US_COUNT = 2;

/* ==========================================================================
 * THE MODULE-LEVEL MOCK REGISTRY
 * ==========================================================================
 * `move-to-sprint.controller.spec.coffee` L14 keeps one `mocks = {}` at module
 * scope and fills it in per test (`mocks.tgLightboxFactory`, L17;
 * `mocks.tgProjectService`, L24). The same shape is kept here, typed, so that the
 * four seams this hook is given have ONE declared home and a specification can
 * reach the current test's doubles without threading them through every helper.
 *
 * They are ASSIGNED by {@link renderCardDrag}, never reset by hand:
 * `jest.config.js` sets `clearMocks` and `restoreMocks`, so Jest clears the
 * recorded calls before every test itself.
 */
interface SpecMocks {
    /** The frozen move seam — `$rootscope.$broadcast` on the AngularJS side. */
    emitMove: EmitMoveMock | null;

    /** The multi-selection controller the provider is handed. */
    multiDrag: MultiDragController | null;

    /** The viewport latch, recording every registration. */
    inViewport: RecordingInViewport | null;

    /** `kanbanUserstoriesService.usMap.get(...)` — KANBAN:134. */
    getCard: KanbanCardLookup | null;

    /** The bridge injector every render is mounted under. */
    injector: AngularInjector | null;
}

const mocks: SpecMocks = {
    emitMove: null,
    multiDrag: null,
    inViewport: null,
    getCard: null,
    injector: null,
};

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

    /**
     * The ids whose card renders WITHOUT its `.card-inner` wrapper — a card that is
     * off screen.
     *
     * `card.jade` L8 puts the viewport guard on the inner wrapper
     * (`.card-inner(ng-if="vm.inViewPort")`) while the OUTER custom element carrying
     * `data-id` always renders, so this is what a virtualised card really looks like
     * in the DOM. R-DND-3 says such a card must remain a drop target and a
     * neighbour, and it is asserted as one below.
     */
    readonly offScreenCardIds?: readonly number[];

    /**
     * The ids whose card carries `ui-multisortable-multiple` — the SCREEN's
     * selection class, rendered from `ctrl.selectedUss` at `kanban-table.jade` L154
     * and L230. The hook may read it through the shared controller; it may never
     * add or remove it.
     */
    readonly selectedCardIds?: readonly number[];
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

/**
 * One `.fake-us` ghost block, as the card component renders it — `card.jade`
 * L46-L50: an `.fake-img` beside a `.column` holding two `.fake-text` lines.
 */
function makeFakeUs(): HTMLElement {
    const block = document.createElement('div');

    block.className = 'fake-us';

    const image = document.createElement('div');

    image.className = 'fake-img';
    block.appendChild(image);

    const column = document.createElement('div');

    column.className = 'column';

    for (let line = 0; line < 2; line += 1) {
        const text = document.createElement('div');

        text.className = 'fake-text';
        column.appendChild(text);
    }

    block.appendChild(column);

    return block;
}

/** How {@link makeCardElement} is asked for a virtualised or a selected card. */
interface CardElementOptions {
    /** `false` renders the outer element with NO `.card-inner` — an off-screen card. */
    readonly inner?: boolean;

    /** `true` adds the screen's `ui-multisortable-multiple` selection class. */
    readonly selected?: boolean;
}

/**
 * `kanban-table.jade` L150 / L226: `tg-card.card.ng-animate-disabled(data-id=…)`,
 * carrying the screen-owned multi-drag ghost from `card.jade` L45-L55.
 *
 * The ghost is rendered on EVERY card, always with exactly two `.fake-us` blocks,
 * because that is what the component does and because the hook must be shown never
 * to create, count or remove it — only to let the shared class lifecycle reveal it.
 */
function makeCardElement(id: number, options: CardElementOptions = {}): HTMLElement {
    const card = document.createElement(CARD_ELEMENT);

    card.className = 'card ng-animate-disabled';
    card.dataset.id = String(id);

    if (options.selected === true) {
        card.classList.add(MULTIPLE_SORTABLE_CLASS);
    }

    // `card.jade` L8: the INNER wrapper is the virtualised half. An off-screen card
    // omits it while still rendering the outer element that carries `data-id`.
    if (options.inner !== false) {
        const inner = document.createElement('div');

        inner.className = 'card-inner';
        card.appendChild(inner);
    }

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
        column.appendChild(
            makeCardElement(cardId, {
                inner: !(spec.offScreenCardIds ?? []).includes(cardId),
                selected: (spec.selectedCardIds ?? []).includes(cardId),
            }),
        );
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

/** An injector that records every name asked of it before refusing it. */
interface RecordingInjector {
    readonly injector: AngularInjector;

    /** Every service name the unit under test asked for. Expected to stay empty. */
    readonly resolved: readonly string[];
}

/**
 * The bridge seam, as an EMPTY injector.
 *
 * `mockInjector()` with no map refuses every name with its own descriptive error
 * (`mockInjector.ts` L29-L47), which is exactly the behaviour wanted here: this hook
 * consumes NO AngularJS service — the move seam, the story lookup, the viewport
 * latch and the selection controller are all passed to it as options — so any
 * resolution attempt is a defect, and it should fail loudly rather than yield
 * `undefined`. The names are recorded as well so a specification can assert the
 * absence positively instead of relying on nothing having thrown.
 *
 * No AngularJS is loaded by this: the injector is a plain object with one method.
 */
function makeBridgeInjector(): RecordingInjector {
    const empty = mockInjector();
    const resolved: string[] = [];

    return {
        resolved,
        injector: {
            get<T>(name: string): T {
                resolved.push(name);

                return empty.get<T>(name);
            },
        },
    };
}

interface Harness {
    readonly api: () => UseCardDragResult;
    readonly emitMove: EmitMoveMock;
    readonly inViewport: RecordingInViewport;
    readonly multiDrag: MultiDragController;
    /** Every AngularJS service name the hook asked the bridge for — always none. */
    readonly resolvedServices: readonly string[];
    readonly rerender: (patch: Partial<UseCardDragOptions>) => void;
    readonly unmount: () => void;
}

function renderCardDrag(overrides: Partial<UseCardDragOptions> & Pick<UseCardDragOptions, 'rootRef'>): Harness {
    const emitMove: EmitMoveMock = jest.fn();
    const inViewport = makeInViewport();
    const multiDrag = overrides.multiDrag ?? createMultiDrag();
    const bridge = makeBridgeInjector();

    const initial: UseCardDragOptions = {
        project: { my_permissions: ['modify_us'] },
        isTableLoaded: true,
        getCard: (): CardUserStoryVm | undefined => undefined,
        emitMove,
        inViewport,
        multiDrag,
        ...overrides,
    };

    /*
     * THE STANDARD BRIDGE WRAPPER. Every other React unit in this tree is rendered
     * under `AngularBridgeProvider` through `withMockInjector`
     * (`Svg.test.tsx` L220, `AngularBridgeContext.test.tsx` L207), and this hook is
     * rendered the same way even though it resolves nothing: the seam is where the
     * board mounts it, so exercising it anywhere else would test an arrangement
     * production never has.
     */
    const view = renderHook((props: UseCardDragOptions) => useCardDrag(props), {
        initialProps: initial,
        wrapper: withMockInjector(bridge.injector),
    });

    let current = initial;

    mocks.emitMove = emitMove;
    mocks.multiDrag = multiDrag;
    mocks.inViewport = inViewport;
    mocks.getCard = initial.getCard;
    mocks.injector = bridge.injector;

    return {
        api: (): UseCardDragResult => view.result.current,
        emitMove,
        inViewport,
        multiDrag,
        resolvedServices: bridge.resolved,
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

/* ==========================================================================
 * THE ENVIRONMENT — OBSERVER STUBS AND LAYOUT STUBS
 * ========================================================================== */

/**
 * The two observers jsdom does not implement, as one class satisfying both.
 *
 * `IntersectionObserver` is what `../../shared/useInViewport` is built on — the port
 * of `app/js/boards.js`'s `initBoard()` — and `ResizeObserver` is what a board
 * measuring its own columns would construct. This hook is HANDED the latch rather
 * than building one, so neither is reached from here; the stubs exist so that a
 * collaborator constructing one cannot turn a drag assertion into a
 * `ReferenceError` about the environment.
 *
 * Every method the two interfaces declare is implemented, with the real signatures
 * and no `any`, so a collaborator calling `observe(node)` or reading
 * `takeRecords()` behaves as it would in a browser rather than crashing on an
 * absent method.
 */
class StubObserver implements IntersectionObserver, ResizeObserver {
    /* `IntersectionObserver`'s read-only shape, with the values jsdom would report. */
    readonly root: Element | Document | null = null;

    readonly rootMargin: string = '0px';

    readonly thresholds: readonly number[] = [0];

    observe(): void {
        return;
    }

    unobserve(): void {
        return;
    }

    disconnect(): void {
        return;
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }
}

/** The `globalThis` slots the two stubs occupy, and what stood there before. */
type ObserverGlobals = Record<string, unknown>;

const OBSERVER_GLOBAL_NAMES = ['IntersectionObserver', 'ResizeObserver'] as const;

const previousObservers = new Map<string, unknown>();

/**
 * A box for one element, in the four numbers a drag cares about.
 *
 * `width`/`height` also feed `offsetWidth`/`offsetHeight`, which is what a
 * collision strategy reads when it measures a droppable without a rect.
 */
interface StubbedBox {
    readonly top: number;

    readonly left: number;

    readonly width: number;

    readonly height: number;
}

/**
 * Gives ONE element a real box, because jsdom gives every element none.
 *
 * ⚠️ WITHOUT THIS EVERY GEOMETRY ASSERTION PASSES VACUOUSLY. jsdom implements no
 * layout: `getBoundingClientRect()` returns all zeros, `offsetWidth` and
 * `offsetHeight` are 0, and `scrollHeight`/`clientHeight` are 0 — so a pointer test
 * against an unstubbed element is false for every point, an autoscroll band of 100 px
 * and one of 20 px behave identically, and a specification that "proves" the band
 * would prove nothing at all.
 *
 * Each override is deliberate and is applied PER ELEMENT rather than globally:
 *
 *   `getBoundingClientRect` — read by `autoScrollTargetEdges` to find a target's
 *       viewport-relative edges, and by the collision strategies to place a
 *       droppable. It returns the full `DOMRect` shape, `toJSON` included, because
 *       that is what the interface declares.
 *   `offsetWidth` / `offsetHeight` — the non-rect fallback a measurement helper
 *       reaches for; left consistent with the rect so the two can never disagree.
 *   `scrollTop` / `scrollLeft` — WRITABLE, because `applyAutoScrollDelta` scrolls an
 *       element by assigning to them (`+=`). jsdom keeps assignments to these
 *       properties, but only within the stub's own storage here, so a scroll is
 *       observable without a real layout.
 *   `scrollHeight` / `scrollWidth` / `clientHeight` / `clientWidth` — the overflow
 *       metrics that decide whether an element CAN scroll at all; a column that
 *       reports no overflow would never be chosen as a scroll target.
 */
function stubElementLayout(element: HTMLElement, box: StubbedBox): void {
    const rect: DOMRect = {
        x: box.left,
        y: box.top,
        top: box.top,
        left: box.left,
        right: box.left + box.width,
        bottom: box.top + box.height,
        width: box.width,
        height: box.height,
        toJSON: (): unknown => ({ ...box }),
    };

    element.getBoundingClientRect = (): DOMRect => rect;

    let scrollTop = 0;
    let scrollLeft = 0;

    Object.defineProperties(element, {
        offsetWidth: { configurable: true, get: (): number => box.width },
        offsetHeight: { configurable: true, get: (): number => box.height },
        clientWidth: { configurable: true, get: (): number => box.width },
        clientHeight: { configurable: true, get: (): number => box.height },
        // Twice the visible height, so the element reports vertical overflow and is
        // therefore a legitimate scroll target.
        scrollHeight: { configurable: true, get: (): number => box.height * 2 },
        scrollWidth: { configurable: true, get: (): number => box.width * 2 },
        scrollTop: {
            configurable: true,
            get: (): number => scrollTop,
            set: (value: number): void => {
                scrollTop = value;
            },
        },
        scrollLeft: {
            configurable: true,
            get: (): number => scrollLeft,
            set: (value: number): void => {
                scrollLeft = value;
            },
        },
    });
}

beforeEach(() => {
    const globals = globalThis as ObserverGlobals;

    for (const name of OBSERVER_GLOBAL_NAMES) {
        previousObservers.set(name, globals[name]);
        globals[name] = StubObserver;
    }
});

afterEach(() => {
    const globals = globalThis as ObserverGlobals;

    for (const name of OBSERVER_GLOBAL_NAMES) {
        if (previousObservers.get(name) === undefined) {
            delete globals[name];
        } else {
            globals[name] = previousObservers.get(name);
        }
    }

    previousObservers.clear();

    // The fixture is attached to the document, so it is detached again rather than
    // left for the next test to trip over. This is the one `innerHTML` in the file
    // and it writes an empty string.
    document.body.innerHTML = '';

    mocks.emitMove = null;
    mocks.multiDrag = null;
    mocks.inViewport = null;
    mocks.getCard = null;
    mocks.injector = null;
});

/* ==========================================================================
 * THE SPECIFICATIONS
 * ========================================================================== */

describe('useCardDrag — the bridge seam', () => {
    it('mounts under the AngularJS bridge provider and resolves NO service through it', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        // The hook rendered — so the provider above it did too — and it registered
        // its container without asking the injector for anything.
        expect(harness.api().getContainers()).toEqual([board.column(1)]);
        expect(harness.resolvedServices).toEqual([]);
    });

    it('drives an entire gesture without reaching the injector once', () => {
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
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1));
        gesture.over(board.column(2));
        gesture.end();

        act(() => {
            harness.unmount();
        });

        expect(harness.emitMove).toHaveBeenCalledTimes(1);
        expect(harness.resolvedServices).toEqual([]);
    });

    it('records the four seams the hook is given, so every specification reaches the same doubles', () => {
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

        // The move seam, the selection controller and the viewport latch reach the
        // provider and the result exactly as they were handed over — nothing is
        // wrapped, copied or re-created in between.
        expect(mocks.emitMove).toBe(harness.emitMove);
        expect(mocks.multiDrag).toBe(harness.api().dndProviderProps.multiDrag);
        expect(mocks.inViewport).toBe(harness.inViewport);
        expect(harness.api().visibleIds).toBe(harness.inViewport.visibleIds);

        // And the story lookup is the one consulted at drag end: the double knows
        // both cards, so the move is written rather than refused.
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1));
        gesture.over(board.column(2));
        gesture.end();

        expect(mocks.getCard?.(11)?.model.status).toBe(1);
        expect(mocks.emitMove).toHaveBeenCalledTimes(1);
    });

    it('would fail loudly rather than quietly if a service were ever asked for', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [] }] });

        renderCardDrag({ rootRef: board.rootRef });

        const injector = mocks.injector;

        if (injector === null) {
            throw new Error('the harness did not record the bridge injector');
        }

        // The seam is a REQUIRED injector, not a permissive stub: an unsupplied name
        // raises `mockInjector`'s own diagnostic instead of resolving `undefined`.
        expect(() => injector.get('$tgResources')).toThrow(/mockInjector/);
        expect(() => injector.get('$tgResources')).toThrow(/\$tgResources/);
    });
});

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

    it('reads the RAW `my_permissions` array off the project it was given', () => {
        /*
         * KANBAN:37 is `$scope.project.my_permissions.indexOf("modify_us") > -1`, and
         * the `tg-check-permission` directives read the same array. So the assertion
         * is not merely "the gate opened": it is that THE ARRAY THE BOARD PASSED is
         * the thing consulted, with no permission service, no derived permission
         * model and no cached copy in between. The accessor records every read and
         * hands back the same array instance every time, so both halves can be
         * asserted.
         */
        const permissions: readonly string[] = ['view_us', 'modify_us', 'modify_task'];
        const reads: (readonly string[])[] = [];
        const project: KanbanDragProject = {
            get my_permissions(): readonly string[] {
                reads.push(permissions);

                return permissions;
            },
        };
        const board = mountBoard({
            swimlanes: [{ swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }] }],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef, project });

        harness.api().openSwimlane(7);

        expect(reads.length).toBeGreaterThan(0);

        for (const seen of reads) {
            expect(seen).toBe(permissions);
        }

        expect(harness.api().dndProviderProps.disabled).toBe(false);
        expect(harness.api().getContainers()).toEqual([board.column(1, 7)]);

        // And nothing was resolved through the bridge: there is no permission service.
        expect(harness.resolvedServices).toEqual([]);
    });

    it('tests the exact `modify_us` string, so a neighbouring permission does not open the gate', () => {
        const board = mountBoard({
            swimlanes: [{ swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }] }],
        });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            // `modify_task` is the CARD-level permission of `kanban-table.jade` L155,
            // and `modify_us_1` would satisfy a substring test. Neither is this gate.
            project: { my_permissions: ['modify_task', 'view_us', 'modify_us_1'] },
        });

        harness.api().openSwimlane(7);

        expect(harness.api().dndProviderProps.disabled).toBe(true);
        expect(harness.api().getContainers()).toHaveLength(0);
    });

    it('honours a permission granted after mount, from that same raw array', () => {
        const board = mountBoard({
            swimlanes: [{ swimlaneId: 7, columns: [{ statusId: 1, cardIds: [] }] }],
        });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            project: { my_permissions: [] },
        });

        harness.api().openSwimlane(7);

        expect(harness.api().getContainers()).toHaveLength(0);

        act(() => {
            harness.rerender({ project: { my_permissions: ['modify_us'] } });
        });

        harness.api().openSwimlane(7);

        expect(harness.api().dndProviderProps.disabled).toBe(false);
        expect(harness.api().getContainers()).toEqual([board.column(1, 7)]);
    });
});

describe('useCardDrag — container registration', () => {
    it('registers the match set of KANBAN:31\'s selector, character for character', () => {
        /*
         * KANBAN:31 is
         *
         *     $('.kanban-swimlane[data-swimlane="' + id + '"] .taskboard-column')
         *
         * so the assertion evaluates that selector INDEPENDENTLY, with the id the hook
         * was given, and requires the registration to be exactly its match set in
         * document order. A selector that drifted — a different attribute, a different
         * descendant, a missing space — would register the wrong columns, and every
         * drop would then land in a column the user was not pointing at.
         */
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: 3,
                    columns: [
                        { statusId: 7, cardIds: [11] },
                        { statusId: 8, cardIds: [] },
                    ],
                },
                { swimlaneId: 4, columns: [{ statusId: 7, cardIds: [] }] },
            ],
        });
        const harness = renderCardDrag({ rootRef: board.rootRef });

        harness.api().openSwimlane(3);

        const expected = [
            ...board.root.querySelectorAll('.kanban-swimlane[data-swimlane="3"] .taskboard-column'),
        ];

        expect(expected).toHaveLength(2);
        expect(harness.api().getContainers()).toEqual(expected);

        // The column really does carry both attributes in swimlane mode —
        // `kanban-table.jade` L112-L121.
        const column = board.column(7, 3);

        expect(column.dataset.status).toBe('7');
        expect(column.dataset.swimlane).toBe('3');
        expect(harness.api().getContainers()).not.toContain(board.column(7, 4));
    });

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

    it('rejects a `div.card` carrying a story id — the predicate is the ELEMENT NAME', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11] }] });
        const harness = renderCardDrag({ rootRef: board.rootRef });
        const impostor = document.createElement('div');

        /*
         * KANBAN:60 is `$(item).is('tg-card')`. `.card` is on other things — the
         * placeholder, the ghost, the taskboard's own rows — and a `data-id` probe
         * would match the rows of a different screen, so neither is the test.
         */
        impostor.className = 'card ng-animate-disabled';
        impostor.dataset.id = '11';
        board.column(1).appendChild(impostor);

        expect(harness.api().canMove(impostor)).toBe(false);
        expect(harness.api().canMove(board.card(11))).toBe(true);
        expect(board.card(11).localName).toBe(CARD_ELEMENT);
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

    it('captures the start index for the PRIMARY of the selection, not for the grabbed card', () => {
        /*
         * KANBAN:84-L85 measures `dragMultipleItems[0]` INSIDE the grabbed card's
         * column:
         *
         *     parentEl = item.parentNode
         *     oldIndex = $(parentEl).find('tg-card').index(firstElement)
         *
         * and KANBAN:120 measures the same element again at drag end. The two
         * arguments are NOT interchangeable, and this is the case that proves it: card
         * 11 is the first SELECTED card and card 13 is the one GRABBED, so the index
         * both times is card 11's. Card 13 is dropped ahead of card 12, which changes
         * the arrangement — yet card 11 has not moved, so the index is unchanged, the
         * container is the same, and KANBAN:124's guard suppresses the write.
         *
         * A hook that re-derived the index for the grabbed card would measure 1 against
         * a captured 0 and would emit here. That is the duplicated arithmetic R-DND-2
         * forbids, and this specification is what catches it.
         */
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: 7,
                    columns: [{ statusId: 1, cardIds: [11, 12, 13], selectedCardIds: [11, 13] }],
                },
            ],
        });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: makeCardLookup([
                makeCardVm(11, 1, 7),
                makeCardVm(12, 1, 7),
                makeCardVm(13, 1, 7),
            ]),
        });

        harness.api().openSwimlane(7);

        const primary = board.card(11);
        const grabbed = board.card(13);
        const gesture = beginGesture(harness, grabbed);

        gesture.over(board.column(1, 7));
        gesture.over(board.card(12));

        expect(cardIdsIn(board.column(1, 7))).toEqual(['11', '13', '12']);

        gesture.end([primary, grabbed]);

        expect(harness.emitMove).not.toHaveBeenCalled();
    });

    it('measures the anchors for the GRABBED card while the index tracks the primary', () => {
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: 7,
                    columns: [{ statusId: 1, cardIds: [11, 12, 13], selectedCardIds: [11, 13] }],
                },
            ],
        });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: makeCardLookup([
                makeCardVm(11, 1, 7),
                makeCardVm(12, 1, 7),
                makeCardVm(13, 1, 7),
            ]),
        });

        harness.api().openSwimlane(7);

        const primary = board.card(11);
        const grabbed = board.card(13);
        const gesture = beginGesture(harness, grabbed);

        gesture.over(board.column(1, 7));
        gesture.over(primary);

        expect(cardIdsIn(board.column(1, 7))).toEqual(['13', '11', '12']);

        gesture.end([primary, grabbed]);

        const call = harness.emitMove.mock.calls[0];

        expect(harness.emitMove).toHaveBeenCalledTimes(1);
        // The index is card 11's — now second, so 1 — while the anchors are card 13's:
        // nothing precedes it, and card 11 follows it. Two different elements measured
        // in one emission, exactly as KANBAN:98-L99 and KANBAN:120 do.
        expect(call[4]).toBe(1);
        expect(call[5]).toBeNull();
        expect(call[6]).toBe(11);
        expect(call[1]).toEqual([
            { id: 11, oldStatusId: 1, oldSwimlaneId: 7 },
            { id: 13, oldStatusId: 1, oldSwimlaneId: 7 },
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
 * CLASS BOOKKEEPING — for the ownership specifications below.
 * -------------------------------------------------------------------------- */

/** Every element inside `root`, with the classes it carries right now. */
function snapshotClasses(root: HTMLElement): Map<Element, ReadonlySet<string>> {
    const snapshot = new Map<Element, ReadonlySet<string>>();

    snapshot.set(root, new Set<string>(root.classList));

    for (const element of root.querySelectorAll('*')) {
        snapshot.set(element, new Set<string>(element.classList));
    }

    return snapshot;
}

/**
 * What has been ADDED to each still-connected element since the snapshot.
 *
 * The whole point of rule T9's ownership map is that a class added by the wrong
 * layer is invisible: nothing throws and nothing warns, the board simply stops
 * looking right. So the assertion is made exhaustive rather than element by element
 * — anything this hook writes anywhere in the board shows up here.
 */
function classesAddedSince(
    snapshot: Map<Element, ReadonlySet<string>>,
): (readonly [Element, readonly string[]])[] {
    const added: (readonly [Element, readonly string[]])[] = [];

    for (const [element, before] of snapshot) {
        if (!element.isConnected) {
            continue;
        }

        const now = [...element.classList].filter((name) => !before.has(name)).sort();

        if (now.length > 0) {
            added.push([element, now]);
        }
    }

    return added;
}

describe('useCardDrag — the class contract (T9)', () => {
    it('agrees with the shared modules on the two classes it must never write', () => {
        // Restated locally AND compared, so a rename on either side fails here rather
        // than removing a visual from the board in silence.
        expect(TRANSIT_CLASS).toBe(TRANSIT_CLASS_NAME);
        expect(TRANSIT_MULTI_CLASS).toBe(TRANSIT_MULTI_CLASS_NAME);
    });

    it('adds `target-drop` to the hovered column, and nothing else anywhere', () => {
        const { board, harness } = mountOrderingFixture();
        const destination = board.column(2, 7);
        const before = snapshotClasses(board.wrapper);
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(destination);

        expect(classesAddedSince(before)).toEqual([[destination, [TARGET_DROP_CLASS]]]);
    });

    it('adds `new` to the destination column at drag end, and nothing else anywhere', () => {
        const { board, harness } = mountOrderingFixture();
        const destination = board.column(2, 7);
        const before = snapshotClasses(board.wrapper);
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(destination);
        gesture.end();

        // `target-drop` is swept at drag end, exactly as the retired library's final
        // `out` swept it, so the flash is the only class left standing.
        expect(classesAddedSince(before)).toEqual([[destination, [NEW_COLUMN_CLASS]]]);

        fireEvent.animationEnd(destination);

        expect(classesAddedSince(before)).toEqual([]);
    });

    it('never writes the placeholder class the drag context owns', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));

        expect(board.wrapper.querySelectorAll(`.${TRANSIT_CLASS_NAME}`)).toHaveLength(0);

        gesture.over(board.column(2, 7));
        gesture.end();

        expect(board.wrapper.querySelectorAll(`.${TRANSIT_CLASS_NAME}`)).toHaveLength(0);
    });

    it('never writes either mirror class — the drag context and the selection own them', () => {
        const { board, harness } = mountOrderingFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.column(2, 7));
        gesture.end();

        for (const owned of [
            MIRROR_CLASS,
            MULTIPLE_DRAG_MIRROR_CLASS,
            TG_MULTIPLE_DRAG_MIRROR_CLASS,
            TG_MULTIPLE_DRAG_DRAGGING_CLASS,
            MAIN_DRAG_CLASS,
        ]) {
            expect(document.querySelectorAll(`.${owned}`)).toHaveLength(0);
        }
    });

    it('reveals the screen-owned ghost through the shared transit-multi class only', () => {
        const board = mountBoard({
            flat: [{ statusId: 1, cardIds: [11, 12], selectedCardIds: [11, 12] }],
        });
        const controller = createMultiDrag();
        const harness = renderCardDrag({ rootRef: board.rootRef, multiDrag: controller });
        const main = board.card(11);

        // The placeholder is the DRAG CONTEXT's: the specification puts it on the
        // source node in the provider's stead, which is the only way the shared
        // multi-drag controller can find something to reveal.
        main.classList.add(TRANSIT_CLASS_NAME);

        const mirror = document.createElement('div');

        mirror.className = MIRROR_CLASS;
        document.body.appendChild(mirror);

        const gesture = beginGesture(harness, main);

        controller.start(main, harness.api().getContainers());
        document.documentElement.dispatchEvent(new Event('mousemove'));

        expect(main.classList.contains(TRANSIT_MULTI_CLASS_NAME)).toBe(true);
        expect(main.querySelectorAll('.card-transit-multi')).toHaveLength(1);
        expect(main.querySelectorAll('.card-transit-multi > .fake-us')).toHaveLength(
            FAKE_US_COUNT,
        );

        gesture.end(controller.stop());

        // The reveal is undone by the shared controller; the ghost MARKUP is the
        // screen's and is neither created nor removed by any of this.
        expect(main.classList.contains(TRANSIT_MULTI_CLASS_NAME)).toBe(false);
        expect(main.classList.contains(TRANSIT_CLASS_NAME)).toBe(true);
        expect(main.querySelectorAll('.card-transit-multi > .fake-us')).toHaveLength(
            FAKE_US_COUNT,
        );
    });

    it('leaves the ghost markup untouched before, during and after a plain drag', () => {
        const { board, harness } = mountOrderingFixture();
        const card = board.card(13);

        expect(card.querySelectorAll('.card-transit-multi > .fake-us')).toHaveLength(
            FAKE_US_COUNT,
        );

        const gesture = beginGesture(harness, card);

        gesture.over(board.card(11));

        expect(card.querySelectorAll('.card-transit-multi > .fake-us')).toHaveLength(
            FAKE_US_COUNT,
        );

        gesture.end();

        expect(card.querySelectorAll('.card-transit-multi > .fake-us')).toHaveLength(
            FAKE_US_COUNT,
        );
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

/**
 * A two-swimlane, two-status board whose FOUR columns are all populated.
 *
 * The ordering fixture above leaves the destination columns empty, which cannot
 * distinguish "no anchor because the column is empty" from "no anchor because the
 * arithmetic looked in the wrong column". Every destination here already holds
 * cards, so each of the three mandatory CROSS-CONTAINER cases asserts a real
 * neighbour taken from the DESTINATION:
 *
 *   swimlane 7 · status 1 → 11, 12, 13     swimlane 7 · status 2 → 31, 32
 *   swimlane 8 · status 1 → 21, 22         swimlane 8 · status 2 → 41
 */
function mountCrossContainerFixture(): OrderingFixture {
    const board = mountBoard({
        swimlanes: [
            {
                swimlaneId: 7,
                columns: [
                    { statusId: 1, cardIds: [11, 12, 13] },
                    { statusId: 2, cardIds: [31, 32] },
                ],
            },
            {
                swimlaneId: 8,
                columns: [
                    { statusId: 1, cardIds: [21, 22] },
                    { statusId: 2, cardIds: [41] },
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
            makeCardVm(31, 2, 7),
            makeCardVm(32, 2, 7),
            makeCardVm(21, 1, 8),
            makeCardVm(22, 1, 8),
            makeCardVm(41, 2, 8),
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

    it('CROSS-CONTAINER (cross-status, same swimlane): reports the destination status and its neighbour', () => {
        const { board, harness } = mountCrossContainerFixture();
        const card = board.card(11);
        const destination = board.column(2, 7);
        const gesture = beginGesture(harness, card);

        // The retired library emitted `over` for the source column immediately after
        // the drag began (KANBAN:63-L67), so the source is hovered first here too.
        gesture.over(board.column(1, 7));
        gesture.over(board.card(31));

        expect(cardIdsIn(destination)).toEqual(['11', '31', '32']);

        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        expect(harness.emitMove).toHaveBeenCalledTimes(1);
        expect(call).toHaveLength(7);
        expect(call[1]).toEqual([{ id: 11, oldStatusId: 1, oldSwimlaneId: 7 }]);
        expect(call[2]).toBe(2);
        expect(call[3]).toBe(7);
        expect(call[4]).toBe(0);
        expect(call[5]).toBeNull();
        expect(call[6]).toBe(31);

        // KANBAN:147-L151 — the status changed, so the element is removed and the
        // destination flashes.
        expect(card.isConnected).toBe(false);
        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);
    });

    it('CROSS-CONTAINER (same status, cross-swimlane): reports the destination swimlane and its neighbour', () => {
        const { board, harness } = mountCrossContainerFixture();
        const card = board.card(11);
        const destination = board.column(1, 8);
        const gesture = beginGesture(harness, card);

        gesture.over(board.column(1, 7));
        gesture.over(board.card(22));

        expect(cardIdsIn(destination)).toEqual(['21', '11', '22']);

        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        expect(harness.emitMove).toHaveBeenCalledTimes(1);
        expect(call[1]).toEqual([{ id: 11, oldStatusId: 1, oldSwimlaneId: 7 }]);
        // The status is UNCHANGED and the swimlane is not: the sameness test at
        // KANBAN:147 is a conjunction, so this still counts as a changed container.
        expect(call[2]).toBe(1);
        expect(call[3]).toBe(8);
        expect(call[4]).toBe(1);
        expect(call[5]).toBe(21);
        expect(call[6]).toBeNull();
        expect(card.isConnected).toBe(false);
        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);
    });

    it('CROSS-CONTAINER (cross-status AND cross-swimlane): reports both, with the destination anchor', () => {
        const { board, harness } = mountCrossContainerFixture();
        const card = board.card(11);
        const destination = board.column(2, 8);
        const gesture = beginGesture(harness, card);

        gesture.over(board.column(1, 7));
        gesture.over(destination);

        expect(cardIdsIn(destination)).toEqual(['41', '11']);

        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        expect(harness.emitMove).toHaveBeenCalledTimes(1);
        expect(call[1]).toEqual([{ id: 11, oldStatusId: 1, oldSwimlaneId: 7 }]);
        expect(call[2]).toBe(2);
        expect(call[3]).toBe(8);
        expect(call[4]).toBe(1);
        expect(call[5]).toBe(41);
        expect(call[6]).toBeNull();
        expect(card.isConnected).toBe(false);
        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);
    });

    it('CROSS-CONTAINER: emits at the SAME index when only the container changed', () => {
        const { board, harness } = mountCrossContainerFixture();
        const card = board.card(11);
        const gesture = beginGesture(harness, card);

        gesture.over(board.column(1, 7));
        gesture.over(board.card(21));

        // Index 0 in the destination is the index it already had in the source, so
        // the guard's FIRST half holds and only its second half — the container
        // identity test of KANBAN:124 — keeps this drop alive.
        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        expect(harness.emitMove).toHaveBeenCalledTimes(1);
        expect(call[3]).toBe(8);
        expect(call[4]).toBe(0);
        expect(call[5]).toBeNull();
        expect(call[6]).toBe(21);
    });

    it('FIRST-POSITION: keeps a multi-card selection in dragged order at index 0', () => {
        const { board, harness } = mountCrossContainerFixture();
        const first = board.card(12);
        const second = board.card(13);
        const gesture = beginGesture(harness, first);

        gesture.over(board.column(1, 7));
        gesture.over(board.card(11));
        gesture.end([first, second]);

        const call = harness.emitMove.mock.calls[0];

        // The anchors are measured for the PRIMARY of the selection — KANBAN:117-L120
        // measures `dragMultipleItems[0]` — and the payload keeps the dragged order.
        expect(call[1]).toEqual([
            { id: 12, oldStatusId: 1, oldSwimlaneId: 7 },
            { id: 13, oldStatusId: 1, oldSwimlaneId: 7 },
        ]);
        expect(call[4]).toBe(0);
        expect(call[5]).toBeNull();
        expect(call[6]).toBe(11);
    });

    it('excludes a `gu-transit` sibling from the neighbour scan while still counting it in the index', () => {
        const { board, harness } = mountCrossContainerFixture();
        const placeholder = board.card(12);

        // The drag context puts this class on the source node; the specification does
        // it here in the provider's stead. KANBAN:98-L99 scans
        // `tg-card:not(.gu-transit)`, while KANBAN:120's index expression carries NO
        // such exclusion — an asymmetry that is in the incumbent and is preserved.
        placeholder.classList.add(TRANSIT_CLASS_NAME);

        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.card(13));

        expect(cardIdsIn(board.column(1, 7))).toEqual(['12', '11', '13']);

        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        // Index 1 PROVES the placeholder was counted; a previous anchor of `null`
        // PROVES it was skipped as a neighbour. Reporting 12 here would order the
        // write against a placeholder, and index 0 would be an off-by-one.
        expect(call[4]).toBe(1);
        expect(call[5]).toBeNull();
        expect(call[6]).toBe(13);
    });

    it('never turns a neighbour with no `data-id` into a not-a-number anchor', () => {
        const { board, harness } = mountCrossContainerFixture();
        const column = board.column(1, 7);
        const idless = document.createElement(CARD_ELEMENT);

        idless.className = 'card';
        column.insertBefore(idless, board.card(13));

        const gesture = beginGesture(harness, board.card(11));

        gesture.over(column);
        gesture.over(board.card(13));

        expect(cardIdsIn(column)).toEqual(['12', '11', '13']);

        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        // KANBAN:102's guard is `prev.length && prev[0].dataset.id`: an id-less
        // neighbour leaves the anchor null rather than becoming `Number(undefined)`.
        // A not-a-number anchor would be serialised as an ABSENT field and the server
        // would reorder the board around it, with no error anywhere.
        expect(call[5]).toBeNull();
        expect(Number.isNaN(call[5])).toBe(false);
        // Because the previous anchor is falsy, the next one is computed — TRAP 2.
        expect(call[6]).toBe(13);
    });

    it('never turns a neighbour with an EMPTY `data-id` into an anchor either', () => {
        const { board, harness } = mountCrossContainerFixture();
        const column = board.column(1, 7);
        const blank = board.card(12);

        blank.dataset.id = '';

        const gesture = beginGesture(harness, board.card(11));

        gesture.over(column);
        gesture.over(board.card(13));

        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        expect(call[5]).toBeNull();
        expect(call[6]).toBe(13);
    });

    it('treats a `0` neighbour as no anchor, keeping the shared previous-wins semantics', () => {
        const { board, harness } = mountCrossContainerFixture();
        const column = board.column(1, 7);
        const zero = board.card(12);

        zero.dataset.id = '0';

        const gesture = beginGesture(harness, board.card(11));

        gesture.over(column);
        gesture.over(board.card(13));

        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        /*
         * Zero is not a valid identifier — server keys start at 1 — and the anchor
         * test downstream is FALSY (`!previousId`), so a `0` anchor would read as
         * present in one place and absent in another. It stays `null`, and because
         * that is falsy the next anchor is computed, which is TRAP 3 preserved rather
         * than "fixed".
         */
        expect(call[5]).not.toBe(0);
        expect(call[5]).toBeNull();
        expect(call[6]).toBe(13);
    });

    it('counts a hidden, virtualised card as a neighbour, because registration ignores visibility', () => {
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: 7,
                    columns: [
                        { statusId: 1, cardIds: [11, 12, 13], offScreenCardIds: [12] },
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
            ]),
        });

        harness.api().openSwimlane(7);

        const hidden = board.card(12);

        // Off screen in both senses the board can express it: no inner wrapper, and
        // no box. R-DND-3 says neither may remove it from the arrangement.
        hidden.style.display = 'none';

        expect(hidden.querySelector('.card-inner')).toBeNull();

        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.card(13));

        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        expect(call[4]).toBe(1);
        expect(call[5]).toBe(12);
        expect(call[6]).toBeNull();
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
        /*
         * `useCardDrag.ts`'s `readColumnSwimlaneId` is `Number(column.dataset.swimlane)`
         * WITH NO DEFAULT — the port of KANBAN:122 — and a flat column carries no
         * `data-swimlane` at all: `kanban-table.jade` L189-L197 renders `data-status`
         * and nothing else, while the swimlane-mode column at L112-L121 renders both.
         *
         * So the value really is `Number(undefined)`, i.e. not-a-number, and the
         * quirk is PINNED here rather than smoothed over. Defaulting it to `0`, `-1`
         * or `null` would make two different flat columns compare EQUAL at KANBAN:147
         * and the removal guard would start firing where the incumbent never lets it;
         * reading the attribute with `getAttribute` would do the same by accident,
         * because `Number(null)` is zero. The retained controller and the api facade
         * already gate the swimlane on truthiness
         * (`resources/userstories.coffee` L126-L127), which is why a not-a-number value
         * never reaches the wire as a swimlane id.
         */
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
        expect(board.column(2).getAttribute('data-swimlane')).toBeNull();

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

        fireEvent.animationEnd(destination);

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(false);

        destination.classList.add(NEW_COLUMN_CLASS);
        fireEvent.animationEnd(destination);

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

    it('never collapses the six payloads into a single options object', () => {
        const { board, harness } = mountCrossContainerFixture();
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1, 7));
        gesture.over(board.card(31));
        gesture.end();

        const call = harness.emitMove.mock.calls[0];

        /*
         * The retained listener is `@.moveUs`, whose signature is POSITIONAL
         * (`ctx, usList, newStatusId, newSwimlaneId, index, previousCard, nextCard`)
         * and whose write is position-relative. An object-shaped payload would be
         * accepted by a JavaScript listener without complaint and would then reorder
         * the board around `undefined` anchors, so the shape is asserted rather than
         * assumed: seven arguments, one string, one array, three numbers and two
         * nullable numbers — and NOT ONE plain object anywhere among them.
         */
        expect(call).toHaveLength(7);
        expect(typeof call[0]).toBe('string');
        expect(Array.isArray(call[1])).toBe(true);
        expect(typeof call[2]).toBe('number');
        expect(typeof call[3]).toBe('number');
        expect(typeof call[4]).toBe('number');
        expect(
            call.filter(
                (argument: unknown): boolean =>
                    typeof argument === 'object' && argument !== null && !Array.isArray(argument),
            ),
        ).toEqual([]);

        // Each moved story carries EXACTLY the three fields KANBAN:137-L141 builds.
        expect(Object.keys(call[1][0]).sort()).toEqual(['id', 'oldStatusId', 'oldSwimlaneId']);
    });

    it('removes a card natively, detaching nothing the screen attached to it', () => {
        const { board, harness } = mountCrossContainerFixture();
        const card = board.card(11);
        const clicks: string[] = [];

        card.addEventListener('click', (): void => {
            clicks.push('screen');
        });

        /*
         * KANBAN:52-L54's `deleteElement` was `itemEl.off(); itemEl.remove()`, and
         * `off()` detached EVERY jQuery handler on the node. This hook attaches no
         * handler to a card — its only listener is the one-shot `animationend` on a
         * COLUMN — so the faithful native equivalent removes the element and touches
         * nobody else's listeners. A probe that throws if the AngularJS scope accessor
         * is ever reached for stands in for the story list's `scope().$destroy()`,
         * which this screen deliberately does NOT do.
         */
        Object.defineProperty(card, 'scope', {
            configurable: true,
            value: (): never => {
                throw new Error('useCardDrag reached for an AngularJS scope');
            },
        });

        const gesture = beginGesture(harness, card);

        gesture.over(board.column(1, 7));
        gesture.over(board.card(31));
        gesture.end();

        expect(card.isConnected).toBe(false);

        card.dispatchEvent(new Event('click'));

        expect(clicks).toEqual(['screen']);
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
        fireEvent.animationEnd(destination);

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

    it('accumulates nothing across repeated mount, open, drag and unmount cycles', () => {
        const board = mountBoard({
            swimlanes: [
                {
                    swimlaneId: 7,
                    columns: [
                        { statusId: 1, cardIds: [11, 12, 13] },
                        { statusId: 2, cardIds: [] },
                    ],
                },
            ],
        });
        const cards = makeCardLookup([
            makeCardVm(11, 1, 7),
            makeCardVm(12, 1, 7),
            makeCardVm(13, 1, 7),
        ]);
        const destination = board.column(2, 7);
        const attached = jest.spyOn(destination, 'addEventListener');
        const detached = jest.spyOn(destination, 'removeEventListener');

        /*
         * The board mounts and unmounts this hook every time the user navigates away
         * and back, and a swimlane opens on every table-body load. Each cycle below is
         * a complete life: register, drag across containers, tear down. Nothing may
         * survive a cycle — not a container, not a class, not a listener — because a
         * leak here is silent and only shows up as a column that has stopped
         * flashing, or one that flashes twice.
         */
        for (let cycle = 0; cycle < 3; cycle += 1) {
            const harness = renderCardDrag({ rootRef: board.rootRef, getCard: cards });

            harness.api().openSwimlane(7);

            expect(harness.api().getContainers()).toEqual([board.column(1, 7), destination]);

            const gesture = beginGesture(harness, board.card(11));

            gesture.over(board.column(1, 7));
            gesture.over(destination);
            gesture.end();

            expect(harness.emitMove).toHaveBeenCalledTimes(1);
            expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);

            act(() => {
                harness.unmount();
            });

            expect(harness.api().getContainers()).toHaveLength(0);
            expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(false);

            // The card that changed container was removed, so it is put back for the
            // next cycle. This is the SCREEN's job in production: React re-renders the
            // card into its new column from the state the emission updated.
            board.column(1, 7).insertBefore(makeCardElement(11), board.card(12));
        }

        const animationListeners = (calls: [string, ...unknown[]][]): number =>
            calls.filter(([name]) => name === ANIMATION_END_EVENT).length;

        expect(animationListeners(attached.mock.calls as [string, ...unknown[]][])).toBe(3);
        expect(animationListeners(detached.mock.calls as [string, ...unknown[]][])).toBe(3);

        // And no listener from any cycle is still armed: a class added by hand now
        // survives an animation end, because nothing is listening for it any more.
        destination.classList.add(NEW_COLUMN_CLASS);
        fireEvent.animationEnd(destination);

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(true);
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

        // KANBAN:155-L160's option object, in full and with nothing else in it.
        expect({
            enabled: autoScroll.enabled,
            margin: autoScroll.margin,
            scrollWhenOutside: autoScroll.scrollWhenOutside,
        }).toEqual({ enabled: true, margin: KANBAN_AUTOSCROLL_MARGIN, scrollWhenOutside: true });
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

    it('never carries the story list\'s numbers', () => {
        const { harness } = mountOrderingFixture();
        const { autoScroll } = harness.api().dndProviderProps;

        /*
         * ⚠️ THE TWO SCREENS DIVERGE AND MUST NOT BE UNIFIED. The story list passes
         * `{ margin: 20, pixels: 30 }` over `[window]`; the board passes `margin: 100`
         * over its COLUMNS and no `pixels` at all. `pixels` was never read by the
         * installed library, so implementing it would speed the story list up seven and
         * a half fold — a functional change dressed as a bug fix.
         */
        expect(autoScroll.margin).not.toBe(STORY_LIST_AUTOSCROLL_MARGIN);
        expect(autoScroll.margin).toBe(KANBAN_AUTOSCROLL_MARGIN);
        expect(autoScroll.pixels).not.toBe(STORY_LIST_AUTOSCROLL_PIXELS);
        expect('pixels' in autoScroll).toBe(false);
    });

    it('measures the board\'s 100px band on the COLUMNS, not on the window', () => {
        const { board, harness } = mountOrderingFixture();
        const { autoScroll } = harness.api().dndProviderProps;
        const column = board.column(1, 7);

        // jsdom lays nothing out, so the column is given a real box before any
        // geometry is asserted — see `stubElementLayout`. 600×800 at (200, 100).
        stubElementLayout(column, { top: 100, left: 200, width: 600, height: 800 });

        const edges = autoScrollTargetEdges(column);

        expect(edges).toEqual({ top: 100, left: 200, right: 800, bottom: 900 });

        // One pixel inside the band's inner lip scrolls: `floor(-0.01 × 4) = -1`, so
        // the band has no dead zone. This is the shared provider's own arithmetic,
        // driven with the margin THIS hook supplies.
        const insideBand = computeAutoScrollDelta(
            { x: 500, y: edges.bottom - KANBAN_AUTOSCROLL_MARGIN + 1 },
            edges,
            autoScroll.margin,
        );

        expect(insideBand.y).toBeGreaterThan(0);

        // Exactly `margin` pixels in is OUTSIDE the band — the tests are strict.
        expect(
            computeAutoScrollDelta(
                { x: 500, y: edges.bottom - KANBAN_AUTOSCROLL_MARGIN },
                edges,
                autoScroll.margin,
            ).y,
        ).toBe(0);

        // And the story list's 20px band would NOT scroll at the same point, which is
        // what makes the board's number load-bearing rather than decorative.
        expect(
            computeAutoScrollDelta(
                { x: 500, y: edges.bottom - KANBAN_AUTOSCROLL_MARGIN + 1 },
                edges,
                STORY_LIST_AUTOSCROLL_MARGIN,
            ).y,
        ).toBe(0);

        // The magnitude is clamped to the library's default maximum speed, because
        // neither screen passes `maxSpeed`.
        expect(autoScroll.maxSpeed).toBeUndefined();
        expect(
            computeAutoScrollDelta({ x: 500, y: edges.bottom + 5000 }, edges, autoScroll.margin).y,
        ).toBe(DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED);
    });

    it('retains a target the pointer has left, and scrolls the column rather than the page', () => {
        const { board, harness } = mountOrderingFixture();
        const { autoScroll } = harness.api().dndProviderProps;
        const column = board.column(1, 7);
        const other = board.column(2, 7);

        stubElementLayout(column, { top: 0, left: 0, width: 300, height: 800 });
        stubElementLayout(other, { top: 0, left: 400, width: 300, height: 800 });

        const targets = autoScroll.getTargets().filter((target): target is Element =>
            target instanceof Element,
        );
        const inside = { x: 150, y: 400 };
        const outside = { x: 2000, y: 400 };

        expect(resolveAutoScrollTarget(inside, targets, null, autoScroll.scrollWhenOutside)).toBe(
            column,
        );

        // `scrollWhenOutside: true` is why the column is still scrolled once the
        // pointer has been dragged clear of every column.
        expect(resolveAutoScrollTarget(outside, targets, column, autoScroll.scrollWhenOutside)).toBe(
            column,
        );
        expect(resolveAutoScrollTarget(outside, targets, column, false)).toBeNull();

        const pageBefore = window.scrollY;

        applyAutoScrollDelta(column, { x: 0, y: 4 });

        // The COLUMN scrolled; the page did not. Handing the loop `[window]` — the
        // story list's target — would scroll the page while the column stood still.
        expect(column.scrollTop).toBe(4);
        expect(window.scrollY).toBe(pageBefore);
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

    it('yields a card that sits in no column with no container at all', () => {
        const { board, harness } = mountOrderingFixture();
        const orphan = makeCardElement(99);

        // A card outside every `.taskboard-column` — the shape a card has for the
        // instant between being created and being attached. The container field is
        // reported ABSENT rather than as a null, because the drop resolver treats an
        // absent container as "look at the item instead" and a null one identically;
        // reporting the node itself would place a drop into nothing.
        expect(harness.api().getDroppableData(orphan)).toEqual({
            containerNode: undefined,
            itemNode: orphan,
        });

        // The same card inside a column reports that column, so the two cases differ by
        // the arrangement alone.
        board.column(1, 7).appendChild(orphan);

        expect(harness.api().getDroppableData(orphan)).toEqual({
            containerNode: board.column(1, 7),
            itemNode: orphan,
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

        fireEvent.animationEnd(destination);

        expect(destination.classList.contains(NEW_COLUMN_CLASS)).toBe(false);

        destination.classList.add(NEW_COLUMN_CLASS);
        fireEvent.animationEnd(destination);

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

    it('leaves a card that had nowhere to return to where the drop put it', () => {
        /*
         * A card whose element is not in the tree when the gesture begins — the shape a
         * re-render mid-drag can leave behind — has no origin anchor to capture, so an
         * abandoned gesture has nothing to undo. The element stays where the drop put
         * it and nothing throws: `insertBefore` against a parent that was never
         * recorded would, and a cancelled drag must never take the board down.
         */
        const { board, harness } = mountOrderingFixture();
        const detached = makeCardElement(99);
        const destination = board.column(2, 7);

        expect(detached.parentElement).toBeNull();

        const gesture = beginGesture(harness, detached);

        gesture.over(board.column(1, 7));

        expect(detached.parentElement).toBe(board.column(1, 7));

        gesture.over(destination);

        expect(detached.parentElement).toBe(destination);

        expect(() => {
            gesture.cancel();
        }).not.toThrow();

        expect(detached.parentElement).toBe(destination);
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
        ['a digest request', '$apply'],
        ['the AngularJS promise service', '$q'],
        ['an AngularJS module registration', 'angular.'],
        ['the retired collection library', 'Immutable'],
        ['a deep immutable read', 'getIn('],
        ['an immutable size probe', '.size'],
        ['a flattening call', '.toJS('],
        ['the end-to-end runner', 'playwright'],
        ['a snapshot assertion', 'toMatchSnapshot'],
        ['markup assembled as a string', 'innerHTML'],
        ['a shadow root query', 'shadowRoot'],
        ['a resource facade', '$tgResources'],
        ['a repository facade', '$tgRepo'],
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
        expect(code).toContain(`'${ANIMATION_END_EVENT}'`);
    });

    it('delegates every index and neighbour computation, keeping no second algorithm', () => {
        /*
         * R-DND-2: only the drag core is pinned, so ordering is computed by hand — and
         * combined with a POSITION-RELATIVE write API an off-by-one silently persists a
         * wrong order. The mitigation is that the arithmetic exists in exactly ONE
         * place, so these gates assert both halves: the three shared calls are made and
         * their results are what travel into the emission, and none of the sibling
         * scanning or id parsing they own is spelled here a second time.
         */
        expect(code).toContain('sortable.beginDrag(item, dragged)');
        expect(code).toContain('sortable.recordNeighbours(item)');
        expect(code).toContain('sortable.endDrag(item, dragged, parentEl)');
        expect(code).toContain('result.index');
        expect(code).toContain('result.previousId');
        expect(code).toContain('result.nextId');

        for (const spelling of [
            'previousElementSibling',
            'prevAll',
            'nextAll',
            'computeNeighbours',
            'indexWithinContainer',
            'parseItemId',
            'readDatasetIds',
        ]) {
            expect(code).not.toContain(spelling);
        }
    });

    it('writes NEITHER of the two classes the shared modules own', () => {
        // The runtime specifications above prove it behaviourally; this proves the
        // literals are not even present, so no future branch can start writing them.
        expect(code).not.toContain(`'${TRANSIT_CLASS_NAME}'`);
        expect(code).not.toContain(`'${TRANSIT_MULTI_CLASS_NAME}'`);
        expect(code).not.toContain(`'${MIRROR_CLASS}'`);
        expect(code).not.toContain(`'${MULTIPLE_SORTABLE_CLASS}'`);
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
 * THE DOCUMENTATION GATES — RULE T9
 * ==========================================================================
 * T9 requires every technology-specific change to be commented AT THE POINT OF
 * CHANGE, and the seam between AngularJS and React most of all. These read the
 * source WITH its comments — the gates above strip them — and assert that the four
 * facts a maintainer cannot recover from the code alone are actually written down:
 * the frozen event name, the six positional arguments, the board's own autoscroll
 * band, and who owns each lifecycle class. Each of them is a contract with code
 * this migration does not touch, so losing the note is how the next change breaks
 * something invisible.
 */

/** Every lifecycle class, with the module the header must name as its owner. */
const CLASS_OWNERSHIP: readonly (readonly [string, string])[] = [
    [TRANSIT_CLASS_NAME, './DndProvider'],
    [MIRROR_CLASS, './DndProvider'],
    [TRANSIT_MULTI_CLASS_NAME, './multiDrag'],
    [MULTIPLE_DRAG_MIRROR_CLASS, './multiDrag'],
    [TG_MULTIPLE_DRAG_MIRROR_CLASS, './multiDrag'],
    [TG_MULTIPLE_DRAG_DRAGGING_CLASS, './multiDrag'],
    [MAIN_DRAG_CLASS, './multiDrag'],
    [TARGET_DROP_CLASS, 'THIS HOOK'],
    [NEW_COLUMN_CLASS, 'THIS HOOK'],
    [MULTIPLE_SORTABLE_CLASS, 'THE SCREEN'],
];

describe('useCardDrag — documentation gates (T9)', () => {
    const documentation = readHookSource();

    it('documents the frozen emission: the event name, its origin and its six arguments in order', () => {
        expect(documentation).toContain(`"${KANBAN_US_MOVE_EVENT}"`);
        expect(documentation).toContain('KANBAN:153');

        const seam = documentation.slice(documentation.indexOf('KanbanMoveEmitter = ('));
        const positions = [
            'finalUsList',
            'newStatus',
            'newSwimlane',
            'index',
            'previousCard',
            'nextCard',
        ];
        const offsets = positions.map((name) => seam.indexOf(name));

        // Every argument is declared, and each one AFTER the previous: the retained
        // listener's signature is positional and its write is position-relative.
        for (const offset of offsets) {
            expect(offset).toBeGreaterThan(-1);
        }

        expect([...offsets].sort((left, right) => left - right)).toEqual(offsets);
    });

    it('documents the board autoscroll band, and the story list divergence it must not adopt', () => {
        expect(documentation).toContain(`margin: ${String(KANBAN_AUTOSCROLL_MARGIN)}`);
        expect(documentation).toContain('scrollWhenOutside');
        expect(documentation).toContain(
            `margin: ${String(STORY_LIST_AUTOSCROLL_MARGIN)}, pixels: ${String(
                STORY_LIST_AUTOSCROLL_PIXELS,
            )}`,
        );
        expect(documentation).toContain('MUST NOT BE UNIFIED');
    });

    /**
     * The ownership map itself, isolated from the prose around it.
     *
     * Slicing the block first is what makes the per-class assertions below exact: the
     * header mentions several of these classes in passing while explaining the scope
     * split, and a search across the whole file would happily match one of those
     * sentences and report a map that no longer exists.
     */
    const ownershipMap = ((): string => {
        const start = documentation.indexOf('The complete map:');
        const end = documentation.indexOf('The ghost markup itself', start);

        if (start === -1 || end <= start) {
            throw new Error('useCardDrag.ts no longer documents the class-ownership map');
        }

        return documentation.slice(start, end);
    })();

    it.each(CLASS_OWNERSHIP)('names %s as owned by %s', (className: string, owner: string) => {
        const line = ownershipMap
            .split('\n')
            .find((candidate) => new RegExp(`^\\s*\\*\\s+\`${className}\``).test(candidate));

        expect(line).toBeDefined();
        expect(line).toContain(owner);
    });

    it('documents the flat-column swimlane quirk rather than leaving it to be discovered', () => {
        expect(documentation).toContain('NO `data-swimlane`');
        expect(documentation).toContain('L189-L197');
        expect(documentation).toContain('NaN');
    });
});

/* ==========================================================================
 * THE ENVIRONMENT, ASSERTED
 * ==========================================================================
 * Neither observer is reached by this hook — the viewport latch is injected — but
 * both are installed before every test so that a collaborator which DOES construct
 * one cannot fall over in an environment that provides neither, and both are
 * removed afterwards so no other specification inherits them. jsdom's zero layout
 * is stubbed the same way, per element. These specifications assert that the
 * harness really is in place, because a stub that silently stopped being installed
 * would leave the geometry assertions passing vacuously again.
 */

describe('useCardDrag — the environment harness', () => {
    it('installs both observers on globalThis, with every method the interfaces declare', () => {
        const globals = globalThis as ObserverGlobals;

        for (const name of OBSERVER_GLOBAL_NAMES) {
            expect(globals[name]).toBe(StubObserver);
        }

        const target = document.createElement('div');
        const intersection = new IntersectionObserver(() => undefined);
        const resize = new ResizeObserver(() => undefined);

        intersection.observe(target);
        intersection.unobserve(target);
        resize.observe(target);
        resize.unobserve(target);

        expect(intersection.takeRecords()).toEqual([]);
        expect(intersection.root).toBeNull();
        expect(intersection.rootMargin).toBe('0px');
        expect(intersection.thresholds).toEqual([0]);
        expect(() => {
            intersection.disconnect();
            resize.disconnect();
        }).not.toThrow();
    });

    it('drives a whole gesture with the stubs installed', () => {
        const board = mountBoard({ flat: [{ statusId: 1, cardIds: [11, 12] }] });
        const harness = renderCardDrag({
            rootRef: board.rootRef,
            getCard: makeCardLookup([makeCardVm(11, 1, null), makeCardVm(12, 1, null)]),
        });
        const gesture = beginGesture(harness, board.card(11));

        gesture.over(board.column(1));
        gesture.end();

        expect(harness.emitMove).toHaveBeenCalledTimes(1);
    });

    it('gives a stubbed element a real box, which jsdom never does on its own', () => {
        const plain = document.createElement('div');
        const stubbed = document.createElement('div');

        document.body.append(plain, stubbed);

        // The control: jsdom lays nothing out, so every number is zero and any
        // geometry assertion made against it would hold for any configuration.
        expect(plain.getBoundingClientRect().width).toBe(0);
        expect(plain.offsetHeight).toBe(0);

        stubElementLayout(stubbed, { top: 10, left: 20, width: 300, height: 400 });

        const rect = stubbed.getBoundingClientRect();

        expect([rect.top, rect.left, rect.right, rect.bottom]).toEqual([10, 20, 320, 410]);
        expect([rect.x, rect.y, rect.width, rect.height]).toEqual([20, 10, 300, 400]);
        expect(rect.toJSON()).toEqual({ top: 10, left: 20, width: 300, height: 400 });
        expect([stubbed.offsetWidth, stubbed.offsetHeight]).toEqual([300, 400]);
        expect([stubbed.clientWidth, stubbed.clientHeight]).toEqual([300, 400]);

        // Overflow is reported, so the element is a legitimate scroll target, and the
        // scroll offsets are writable because that is how a scroll is applied.
        expect(stubbed.scrollHeight).toBeGreaterThan(stubbed.clientHeight);
        expect(stubbed.scrollWidth).toBeGreaterThan(stubbed.clientWidth);

        stubbed.scrollTop = 25;
        stubbed.scrollLeft = 35;

        expect([stubbed.scrollTop, stubbed.scrollLeft]).toEqual([25, 35]);
    });
});
