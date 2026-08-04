/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * StatusColumn.test.tsx -- co-located spec for ONE KANBAN STATUS COLUMN CELL
 * ==========================================================================
 *
 * Browserless by construction (constraint HR-5): jsdom supplies the DOM, every
 * collaborator outside the component tree is a plain function double, no browser
 * binary is launched, no network is touched, no AngularJS injector is mounted and
 * nothing here refers to any generated build output. The suite therefore passes with
 * no Chrome and no `dist/`.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * `./StatusColumn.tsx` -- the React port of `div.kanban-uses-box.taskboard-column`
 * and its five children, from `app/partials/includes/modules/kanban-table.jade`
 * L112-L175 (SWIMLANE mode) and its twin at L189-L250 (FLAT mode), absorbing the
 * behaviour of `KanbanTaskboardColumnDirective` (the sticky counter,
 * `app/coffee/modules/kanban/main.coffee` L1196-L1207) and `KanbanWipLimitDirective`
 * (the threshold marker), plus the two drag-state classes
 * `app/coffee/modules/kanban/sortable.coffee` used to apply for free.
 *
 * WHY THE REAL `KanbanCard` IS RENDERED, WRAPPED IN A RECORDING SPY
 * -----------------------------------------------------------------
 * The card is mocked with `jest.requireActual`, so the REAL component still renders --
 * which keeps every DOM-position assertion below honest, and keeps the prop contract
 * exercised at runtime rather than only at compile time -- while every prop the column
 * computes is captured for direct inspection. Two of those props are otherwise
 * unobservable: `isFirst` and `onClickMoveToTop` are declared on the card for
 * auditability and deliberately not read by its markup, so the FLAT-MODE RULE that no
 * move-to-top handler may reach the card can only be asserted at the boundary.
 *
 * WHY CLASS NAMES, ELEMENT NAMES, ATTRIBUTES AND SIBLING ORDER -- NEVER COMPUTED STYLE
 * -----------------------------------------------------------------------------------
 * Rule T1: the migration preserves every existing class name verbatim, and the
 * appearance comes wholly from the UNEDITED `app/styles/modules/kanban/kanban-table.scss`
 * and `app/styles/components/card-placeholder.scss`, which jsdom does not parse. An
 * assertion on computed style would assert nothing about this file; an assertion on the
 * class contract, on the `data-*` contract and on sibling order asserts exactly what
 * can break.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE
 * --------------------------------------
 *  - Geometry. The 292 px column, its 5 px gutter, the 4 px radius, the 36 px folded
 *    rail, the counter's absolute box and the WIP rule's 260 px span all live in the
 *    unedited stylesheet -- gap G-DS-3, component geometry already encoded, and
 *    `$column-width` / `$column-margin` at `kanban-table.scss` L1-L9. NO PIXEL AND NO
 *    COLOUR IS ASSERTED, and no token is invented for either (G-DS-4).
 *  - `display`. The `.vfold` block hides four of the five children through CSS alone
 *    (`kanban-table.scss` L75-L110), so the component must NOT gate them on the fold
 *    and this spec must NOT assert their visibility -- only that they stay MOUNTED.
 *  - The counter's internal roll state machine (`./TaskCounter.test.tsx`), the rail's
 *    internals (`./ArchivedColumn.test.tsx`), the marker's own arithmetic
 *    (`./WipLimitMarker.test.tsx`) and the card's internals (`./KanbanCard.test.tsx`).
 *    What is asserted here is the CALL SITE and the resulting sibling order.
 *  - Status, tag and epic colours. They are per-project DATABASE values (rule T2,
 *    drift entry D3) and the values visible in Figma node `1:7` are `sample_data`
 *    artefacts, so no colour is ever hardcoded in a fixture expectation.
 */

import { useState } from 'react';
import type { ReactElement } from 'react';
import { fireEvent, render } from '@testing-library/react';

import { mockInjector, withMockInjector } from '../bridge/mockInjector';
import type { TranslateFn } from '../bridge/useTranslate';
import type { Status } from '../shared/types/status';
import type { UserStory } from '../shared/types/userStory';
import type { InViewportApi } from '../shared/useInViewport';
import type { KanbanCardProps } from './KanbanCard';
import { resolveWipLimitIndex, resolveWipLimitState } from './WipLimitMarker';
import type { WipLimitState } from './WipLimitMarker';

/* --------------------------------------------------------------------------
 * The recording spy over the REAL card. See the header note.
 * -------------------------------------------------------------------------- */

type KanbanCardModule = typeof import('./KanbanCard');

const recordedCardProps: KanbanCardProps[] = [];

jest.mock('./KanbanCard', (): KanbanCardModule => {
    const actual: KanbanCardModule = jest.requireActual<KanbanCardModule>('./KanbanCard');
    const react = jest.requireActual<typeof import('react')>('react');

    const Recorder = (props: KanbanCardProps): ReactElement => {
        recordedCardProps.push(props);

        return react.createElement(actual.KanbanCard, props);
    };

    return { ...actual, KanbanCard: Recorder as unknown as KanbanCardModule['KanbanCard'] };
});

/*
 * Imported AFTER the mock above, for readability: `jest.mock` is hoisted above every
 * import regardless, so the recording spy is installed before this module is required.
 */
import { StatusColumn } from './StatusColumn';
import type {
    StatusColumnCardDetail,
    StatusColumnCardProps,
    StatusColumnProps,
} from './StatusColumn';

/* ==========================================================================
 * Fixtures -- PLAIN OBJECTS ONLY
 * ==========================================================================
 *
 * No `Immutable.fromJS(...)` anywhere: the migrated modules carry plain JavaScript
 * across the seam (`.toJS()` at the boundary is the house style) and `immer` requires
 * plain objects. Collections are arrays and records, so lengths are read with
 * `.length`, never with Immutable's `.size`.
 */

const STATUS_ID = 3;
const SWIMLANE_ID = 7;

/** A second lane, for the duplicate-id proof in §2.2. */
const OTHER_SWIMLANE_ID = 8;

/** A deterministic translator, so every translated string is assertable by key. */
const translate: TranslateFn = (key: string): string => `t(${key})`;

function makeStatus(overrides: Partial<Status> = {}): Status {
    return {
        id: STATUS_ID,
        name: 'Ready',
        // A per-project DATABASE value, never a token (rule T2, drift D3). Arbitrary here.
        color: 'rgb(1, 2, 3)',
        wip_limit: null,
        is_archived: false,
        ...overrides,
    };
}

function makeStory(id: number): UserStory {
    return {
        id,
        ref: id,
        subject: `Story ${id}`,
        status: STATUS_ID,
        swimlane: null,
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

function makeCardDetail(id: number): StatusColumnCardDetail {
    return {
        item: {
            id,
            model: makeStory(id),
            swimlane: null,
            foldStatusChanged: undefined,
            images: [],
            assigned_to: undefined,
            assigned_users: [],
            assigned_users_preview: [],
            colorized_tags: [],
        },
        archived: false,
        totalAttachments: 0,
    };
}

function makeCardDetails(
    ids: readonly number[],
): Readonly<Record<number, StatusColumnCardDetail | undefined>> {
    const details: Record<number, StatusColumnCardDetail | undefined> = {};

    ids.forEach((id: number): void => {
        details[id] = makeCardDetail(id);
    });

    return details;
}

function makeCardProps(): StatusColumnCardProps {
    return {
        project: { slug: 'project-1' },
        zoom: ['assigned_to'],
        zoomLevel: 1,
        type: 'us',
        permissions: ['modify_us', 'modify_task', 'view_tasks'],
        avatars: {},
        unnamedAvatarUrl: '/images/unnamed.png',
        onToggleFold: jest.fn<void, [number]>(),
        onClickEdit: jest.fn<void, [number]>(),
        onClickDelete: jest.fn<void, [number]>(),
        onClickAssignedTo: jest.fn<void, [number]>(),
        onToggleSelected: jest.fn<void, [number]>(),
    };
}

/* --------------------------------------------------------------------------
 * The board-level virtualisation double
 * -------------------------------------------------------------------------- */

type ColumnKeyArgs = [number, (number | null | undefined)?];
type ElementKeyArgs = [HTMLElement, number, (number | null | undefined)?];

interface InViewportDouble {
    readonly api: InViewportApi;
    readonly registerColumn: jest.Mock<void, ElementKeyArgs>;
    readonly unregisterColumn: jest.Mock<void, ColumnKeyArgs>;
    readonly registerCard: jest.Mock<void, ElementKeyArgs>;
    readonly unregisterCard: jest.Mock<void, ElementKeyArgs>;
}

/**
 * A double for the BOARD-LEVEL virtualisation API.
 *
 * Its four callbacks are stable across renders, exactly as `../shared/useInViewport`'s
 * `useCallback`s are, which is what lets the registration effects be asserted for
 * "exactly once". The real hook is NOT exercised here: this component's contract is the
 * CALL, and the hook has its own spec (`../shared/useInViewport.test.ts`) covering the
 * buffering, the write-once latch and the observer lifecycle.
 */
function makeInViewport(visibleIds: Readonly<Record<number, true>> = {}): InViewportDouble {
    const registerColumn = jest.fn<void, ElementKeyArgs>();
    const unregisterColumn = jest.fn<void, ColumnKeyArgs>();
    const registerCard = jest.fn<void, ElementKeyArgs>();
    const unregisterCard = jest.fn<void, ElementKeyArgs>();

    return {
        api: { visibleIds, registerColumn, unregisterColumn, registerCard, unregisterCard },
        registerColumn,
        unregisterColumn,
        registerCard,
        unregisterCard,
    };
}

interface HarnessOptions {
    readonly overrides?: Partial<StatusColumnProps>;
    readonly visibleIds?: Readonly<Record<number, true>>;
}

interface Harness {
    readonly props: StatusColumnProps;
    readonly viewport: InViewportDouble;
}

/** Swimlane mode with one card and no WIP limit -- the ordinary case. */
function makeHarness(options: HarnessOptions = {}): Harness {
    const viewport = makeInViewport(options.visibleIds);
    const cardIds: readonly number[] = [11];

    const props: StatusColumnProps = {
        status: makeStatus(),
        swimlaneId: SWIMLANE_ID,
        cardIds,
        count: cardIds.length,
        folded: false,
        unfolded: false,
        renderInProgress: false,
        showPlaceholder: false,
        notFound: false,
        isDropTarget: false,
        justDropped: false,
        inViewport: viewport.api,
        translate,
        cardDetails: makeCardDetails(cardIds),
        cardProps: makeCardProps(),
        selectedUss: {},
        movedUs: [],
        ...options.overrides,
    };

    return { props, viewport };
}

/**
 * A harness carrying an explicit list of cards, so the WIP and ordering cases read as
 * one line each.
 *
 * `count` is set from the id list here for convenience; the two are DIFFERENT
 * measurements in the component's contract (the counter binds the collection size, the
 * marker counts rendered elements), and the cases that pull them apart set `count`
 * explicitly.
 */
function makeCardsHarness(
    cardIds: readonly number[],
    overrides: Partial<StatusColumnProps> = {},
): Harness {
    return makeHarness({
        overrides: {
            cardIds,
            count: cardIds.length,
            cardDetails: makeCardDetails(cardIds),
            ...overrides,
        },
    });
}

/* ==========================================================================
 * jsdom shims
 * ==========================================================================
 *
 * jsdom implements NEITHER `IntersectionObserver` NOR `ResizeObserver`, and merely
 * referencing an absent constructor throws at construction time. Both are installed on
 * `globalThis` before every test and removed after it, so no test can leak a global into
 * the next one and so the absence of an observer can never be mistaken for a passing
 * assertion.
 *
 * ⭐ The stub exists to make a POSITIVE claim, not merely to keep the suite alive: this
 * component must construct ZERO observers of its own. The board creates exactly one per
 * column, inside `../shared/useInViewport`, and the column's whole contract is to CALL
 * that API -- see the `virtualisation registration` block. Every construction is
 * recorded so the claim is checkable rather than asserted by absence.
 */

interface ObserverConstruction {
    readonly callback: IntersectionObserverCallback;
    readonly options: IntersectionObserverInit | undefined;
}

const observerConstructions: ObserverConstruction[] = [];

class IntersectionObserverStub {
    public readonly root: Element | Document | null = null;

    public readonly rootMargin: string = '';

    public readonly thresholds: readonly number[] = [];

    public readonly observe = jest.fn<void, [Element]>();

    public readonly unobserve = jest.fn<void, [Element]>();

    public readonly disconnect = jest.fn<void, []>();

    public readonly takeRecords = jest.fn<IntersectionObserverEntry[], []>(
        (): IntersectionObserverEntry[] => [],
    );

    public constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observerConstructions.push({ callback, options });
    }
}

class ResizeObserverStub {
    public readonly observe = jest.fn<void, [Element]>();

    public readonly unobserve = jest.fn<void, [Element]>();

    public readonly disconnect = jest.fn<void, []>();
}

/**
 * The two shimmed globals, typed as optional so they can be installed and removed
 * without a cast at every site. `unknown` rather than `any`: the stubs are structural
 * stand-ins, and the cast is stated once, here.
 */
interface ObserverGlobals {
    IntersectionObserver?: typeof IntersectionObserver;
    ResizeObserver?: typeof ResizeObserver;
}

const observerGlobals: ObserverGlobals = globalThis as unknown as ObserverGlobals;

beforeEach((): void => {
    recordedCardProps.length = 0;
    observerConstructions.length = 0;

    observerGlobals.IntersectionObserver =
        IntersectionObserverStub as unknown as typeof IntersectionObserver;
    observerGlobals.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

afterEach((): void => {
    delete observerGlobals.IntersectionObserver;
    delete observerGlobals.ResizeObserver;
});

/* ==========================================================================
 * Query helpers -- strict-safe, so a missing node fails loudly at its own line
 * ========================================================================== */

/** The single match for `selector`, or a thrown error naming the selector. */
function q(container: HTMLElement, selector: string): HTMLElement {
    const found: HTMLElement | null = container.querySelector<HTMLElement>(selector);

    if (found === null) {
        throw new Error(`expected to find "${selector}"`);
    }

    return found;
}

/** Every match for `selector`, as a real array. */
function all(container: HTMLElement, selector: string): readonly HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

function column(container: HTMLElement): HTMLElement {
    return q(container, '.taskboard-column');
}

function rootClasses(container: HTMLElement): readonly string[] {
    return (column(container).getAttribute('class') ?? '').split(' ');
}

/**
 * The cell's direct children, each reduced to a short label, so sibling ORDER can be
 * asserted by index -- which is the only way to check that the WIP marker lands
 * immediately after its anchor card and that the archived intro is last.
 */
function childOrder(container: HTMLElement): readonly string[] {
    return Array.from(column(container).children).map((child: Element): string => {
        const tag: string = child.tagName.toLowerCase();

        if (tag === 'tg-card') {
            return `card:${child.getAttribute('data-id') ?? '?'}`;
        }

        const className: string = child.getAttribute('class') ?? '';

        if (className.includes('kanban-wip-limit')) {
            return `wip:${className.replace('kanban-wip-limit ', '')}`;
        }

        if (className.includes('kanban-task-counter')) {
            return 'counter';
        }

        if (className.includes('card-placeholder')) {
            return 'placeholder';
        }

        if (className.includes('placeholder-collapsed')) {
            return 'rail';
        }

        if (className.includes('kanban-column-intro')) {
            return 'intro';
        }

        return `${tag}.${className}`;
    });
}

/**
 * The counter's RESTING row.
 *
 * `./TaskCounter` always emits three `.result` rows -- the incoming-up row, the resting
 * row and the incoming-down row -- so the committed value is the middle one. Asserting
 * the first would read the empty incoming row, which renders `0` whatever the count is.
 */
function restingCounterRow(container: HTMLElement): HTMLElement {
    const rows: readonly HTMLElement[] = all(q(container, '.kanban-task-counter'), '.result');
    const resting: HTMLElement | undefined = rows[1];

    if (resting === undefined) {
        throw new Error('expected the counter to emit three `.result` rows');
    }

    return resting;
}

function cardElements(container: HTMLElement): readonly HTMLElement[] {
    return all(container, 'tg-card');
}

function cardIdsInDom(container: HTMLElement): readonly string[] {
    return cardElements(container).map(
        (card: HTMLElement): string => card.getAttribute('data-id') ?? '?',
    );
}

/**
 * The `data-id` of every sibling that FOLLOWS `element`, in document order.
 *
 * Used to prove that the WIP marker leaves the surplus cards BELOW the rule rather than
 * being appended after all of them -- which is the whole visible point of the `exceeded`
 * state, and something a "does the marker exist" assertion cannot distinguish.
 */
function followingSiblingIds(element: Element): readonly string[] {
    const ids: string[] = [];

    for (let cursor: Element | null = element.nextElementSibling; cursor !== null; ) {
        ids.push(cursor.getAttribute('data-id') ?? cursor.tagName.toLowerCase());
        cursor = cursor.nextElementSibling;
    }

    return ids;
}

/** The last props the recording spy saw for one user story. */
function lastRecordedFor(usId: number): KanbanCardProps {
    const found: readonly KanbanCardProps[] = recordedCardProps.filter(
        (props: KanbanCardProps): boolean => props.item.id === usId,
    );
    const latest: KanbanCardProps | undefined = found[found.length - 1];

    if (latest === undefined) {
        throw new Error(`no card props recorded for ${usId}`);
    }

    return latest;
}

/**
 * The state and anchor index the SHARED helpers resolve for a case.
 *
 * ⛔ The WIP arithmetic is NEVER re-derived in this spec, exactly as it is never
 * re-derived in the component: `./WipLimitMarker` owns the ladder, both gates and the
 * anchor-validity check, and `./WipLimitMarker.test.tsx` owns their proof. Calling the
 * same helpers here means an expectation can only disagree with the component about
 * PLACEMENT -- which is this file's subject -- and never about the numbers.
 */
function expectedWip(
    cardCount: number,
    wipLimit: number | null,
    isArchived = false,
): { readonly state: WipLimitState | undefined; readonly index: number } {
    const state: WipLimitState | undefined = resolveWipLimitState(cardCount, wipLimit, isArchived);

    return {
        state,
        index:
            state !== undefined && wipLimit !== null
                ? resolveWipLimitIndex(cardCount, wipLimit, state)
                : -1,
    };
}


/* ==========================================================================
 * §2.1 -- ROOT ELEMENT, CLASSES AND DATA ATTRIBUTES
 * ==========================================================================
 *
 * Three attributes on one div carry the entire drag-and-virtualisation contract:
 * `id="column-N"`, `data-status`, and -- in swimlane mode only -- `data-swimlane`.
 */

describe('StatusColumn -- root element, classes and data attributes', () => {
    it('is a `div` carrying both unconditional classes', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const root: HTMLElement = column(container);

        expect(root.tagName.toLowerCase()).toBe('div');
        expect(root.classList.contains('kanban-uses-box')).toBe(true);
        expect(root.classList.contains('taskboard-column')).toBe(true);
    });

    it('emits `id="column-<status.id>"` verbatim', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        expect(column(container).getAttribute('id')).toBe('column-3');
        expect(column(container).getAttribute('id')).toBe(`column-${STATUS_ID}`);
    });

    it('emits `data-status` as a string that ROUND-TRIPS through `Number()`', () => {
        // `sortable.coffee` L121 reads the destination status back as
        // `Number(parentEl.dataset.status)`. A missing or non-numeric value makes every
        // drop compute `NaN` for the destination status -- a silent data fault, because
        // nothing throws.
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const root: HTMLElement = column(container);

        expect(root.dataset.status).toBe(String(STATUS_ID));
        expect(Number(root.dataset.status)).toBe(STATUS_ID);
        expect(Number.isNaN(Number(root.dataset.status))).toBe(false);
    });

    it('emits `data-swimlane` in SWIMLANE mode, and it ROUND-TRIPS through `Number()`', () => {
        // `sortable.coffee` L122: `newSwimlane = Number(parentEl.dataset.swimlane)`.
        const { props } = makeHarness({ overrides: { swimlaneId: SWIMLANE_ID } });
        const { container } = render(<StatusColumn {...props} />);

        const root: HTMLElement = column(container);

        expect(root.hasAttribute('data-swimlane')).toBe(true);
        expect(root.dataset.swimlane).toBe(String(SWIMLANE_ID));
        expect(Number(root.dataset.swimlane)).toBe(SWIMLANE_ID);
    });

    it('omits `data-swimlane` ENTIRELY in FLAT mode', () => {
        // The flat markup at `kanban-table.jade` L189-L197 carries `data-status` alone.
        // react-dom omits an attribute whose value is `undefined`, so one expression
        // serves both source variants with no conditional spread.
        const { props } = makeHarness({ overrides: { swimlaneId: undefined } });
        const { container } = render(<StatusColumn {...props} />);

        expect(column(container).hasAttribute('data-swimlane')).toBe(false);
        expect(column(container).dataset.swimlane).toBeUndefined();
        expect(column(container).dataset.status).toBe(String(STATUS_ID));
    });

    it('keeps a swimlane id of -1, because the unclassified lane is a real lane', () => {
        // `-1` is TRUTHY, so the registry takes the swimlane path for it -- which is
        // precisely why flat mode must be spelled `undefined` and never `0`.
        const { props } = makeHarness({ overrides: { swimlaneId: -1 } });
        const { container } = render(<StatusColumn {...props} />);

        expect(column(container).dataset.swimlane).toBe('-1');
        expect(Number(column(container).dataset.swimlane)).toBe(-1);
    });

    it('adds `vfold` when folded and omits it when not', () => {
        const folded = render(
            <StatusColumn {...makeHarness({ overrides: { folded: true } }).props} />,
        );
        expect(rootClasses(folded.container)).toContain('vfold');

        const open = render(<StatusColumn {...makeHarness().props} />);
        expect(rootClasses(open.container)).not.toContain('vfold');
    });

    it('adds `vunfold` for the most recently unfolded status, and not for another one', () => {
        // The source condition is `unfold == s.id`, and `unfold` holds AT MOST ONE status
        // id -- `foldStatus` resets it to `null` on every toggle and only then sets it,
        // for the unfold direction alone. So "another status is unfolded" and "nothing is
        // unfolded" reach this cell as the same resolved `false`.
        const mine = render(
            <StatusColumn {...makeHarness({ overrides: { unfolded: true } }).props} />,
        );
        expect(rootClasses(mine.container)).toContain('vunfold');

        const someoneElses = render(
            <StatusColumn {...makeHarness({ overrides: { unfolded: false } }).props} />,
        );
        expect(rootClasses(someoneElses.container)).not.toContain('vunfold');
    });

    it('emits the classes in source order, with no stray whitespace', () => {
        const { props } = makeHarness({
            overrides: { folded: true, unfolded: true, isDropTarget: true },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(column(container).getAttribute('class')).toBe(
            'kanban-uses-box taskboard-column vfold vunfold target-drop',
        );
    });

    it('renders exactly ONE column element, whatever the fold state', () => {
        // The `ng-repeat` that produced one cell per status stays with the OWNER; this
        // component is one cell and must never grow a loop of its own.
        const open = render(<StatusColumn {...makeHarness().props} />);
        expect(all(open.container, '.taskboard-column')).toHaveLength(1);

        const folded = render(
            <StatusColumn {...makeHarness({ overrides: { folded: true } }).props} />,
        );
        expect(all(folded.container, '.taskboard-column')).toHaveLength(1);
    });
});

/* ==========================================================================
 * §2.2 -- THE DUPLICATED `id="column-N"` IS A PRESERVED QUIRK
 * ========================================================================== */

describe('StatusColumn -- duplicate column ids', () => {
    it('reuses the same id="column-N" in every swimlane -- duplicate ids are the source behaviour and are preserved (T10)', () => {
        // T10: `kanban-table.jade` L115 interpolates the STATUS id ALONE, so in swimlane
        // mode five lanes give five elements all carrying `id="column-3"`. That is
        // technically invalid HTML and it is reproduced rather than corrected: suffixing
        // the swimlane id to "fix" it would silently change behaviour for anything
        // reading `#column-<id>`, which is a functional change T10 forbids. The class and
        // `data-*` contracts are what the stylesheet and the drag layer actually use, and
        // `data-swimlane` is what tells the two instances apart.
        const first = makeHarness({ overrides: { swimlaneId: SWIMLANE_ID } });
        const second = makeHarness({ overrides: { swimlaneId: OTHER_SWIMLANE_ID } });

        const { container } = render(
            <div>
                <StatusColumn {...first.props} />
                <StatusColumn {...second.props} />
            </div>,
        );

        const columns: readonly HTMLElement[] = all(container, '.taskboard-column');

        expect(columns).toHaveLength(2);
        expect(
            columns.map((element: HTMLElement): string | null => element.getAttribute('id')),
        ).toEqual([`column-${STATUS_ID}`, `column-${STATUS_ID}`]);

        // The ids agree; the swimlane keys do NOT -- which is what keeps the two cells
        // distinguishable to the drag layer and to the virtualisation registry.
        expect(columns.map((element: HTMLElement): string | undefined => element.dataset.swimlane)).toEqual([
            String(SWIMLANE_ID),
            String(OTHER_SWIMLANE_ID),
        ]);
    });

    it('registers the two duplicated cells under DIFFERENT swimlane keys', () => {
        // T10: the duplicate id is harmless precisely because nothing keys off it. Both
        // the registry and the drag layer key off the (status, swimlane) pair.
        const first = makeHarness({ overrides: { swimlaneId: SWIMLANE_ID } });
        const second = makeHarness({ overrides: { swimlaneId: OTHER_SWIMLANE_ID } });

        render(
            <div>
                <StatusColumn {...first.props} />
                <StatusColumn {...second.props} />
            </div>,
        );

        expect(first.viewport.registerColumn).toHaveBeenCalledWith(
            expect.anything(),
            STATUS_ID,
            SWIMLANE_ID,
        );
        expect(second.viewport.registerColumn).toHaveBeenCalledWith(
            expect.anything(),
            STATUS_ID,
            OTHER_SWIMLANE_ID,
        );
    });
});

/* ==========================================================================
 * CHILD 1 -- THE TASK COUNTER
 * ========================================================================== */

describe('StatusColumn -- the task counter', () => {
    it('mounts the counter while UNFOLDED, titled from `KANBAN.NUMBER_US`', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const counter: HTMLElement = q(container, '.kanban-task-counter');

        expect(counter.getAttribute('title')).toBe('t(KANBAN.NUMBER_US)');
        expect(all(counter, 'tg-animated-counter')).toHaveLength(1);
    });

    it('UNMOUNTS the counter and mounts the collapsed rail when FOLDED', () => {
        const { props } = makeHarness({ overrides: { folded: true } });
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelector('.kanban-task-counter')).toBeNull();
        expect(all(container, '.placeholder-collapsed')).toHaveLength(1);
    });

    it('mounts the counter and NOT the rail when unfolded', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        expect(all(container, '.kanban-task-counter')).toHaveLength(1);
        expect(container.querySelector('.placeholder-collapsed')).toBeNull();
    });

    it('mounts EXACTLY ONE of the counter and the rail for either fold state', () => {
        // The two are mutually exclusive by construction -- `ng-if='!folds[s.id]'` and
        // `ng-if='folds[s.id]'` on the same flag -- so neither "both" nor "neither" is
        // ever a legal rendering.
        (
            [
                [false, '.kanban-task-counter', '.placeholder-collapsed'],
                [true, '.placeholder-collapsed', '.kanban-task-counter'],
            ] as const
        ).forEach(([folded, present, absent]) => {
            const { container } = render(<StatusColumn {...makeHarness({ overrides: { folded } }).props} />);

            expect(all(container, present)).toHaveLength(1);
            expect(container.querySelector(absent)).toBeNull();
        });
    });

    it('shows the upstream `count`, which is NOT the rendered card count', () => {
        // The counter binds the collection's `.size` (`kanban-table.jade` L128 / L204);
        // the WIP marker counts rendered elements. Two different measurements, and
        // deliberately two different props.
        const { props } = makeHarness({ overrides: { count: 6 } });
        const { container } = render(<StatusColumn {...props} />);

        expect(restingCounterRow(container).textContent).toBe('6');
        expect(cardIdsInDom(container)).toHaveLength(1);
    });

    it('shows the card count when the two agree, which is the ordinary projection', () => {
        const { props } = makeCardsHarness([11, 12, 13]);
        const { container } = render(<StatusColumn {...props} />);

        expect(restingCounterRow(container).textContent).toBe('3');
        expect(restingCounterRow(container).textContent).toBe(String(cardIdsInDom(container).length));
    });

    it('renders `count / limit` and `wip-amount` from `status.wip_limit`', () => {
        const { props } = makeHarness({
            overrides: { status: makeStatus({ wip_limit: 4 }), count: 1 },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(q(container, '.animated-counter-inner').getAttribute('class')).toContain(
            'wip-amount',
        );
        expect(restingCounterRow(container).textContent).toBe('1 / 4');
    });

    it('passes a `wip_limit` of 0 through UNCHANGED -- drift D13, a bare count', () => {
        // 0 is FALSY, so the counter renders a bare count with no `wip-amount`. Coercing
        // it to `null`, or to `1`, would change what the user sees.
        const { props } = makeHarness({
            overrides: { status: makeStatus({ wip_limit: 0 }), count: 2 },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(q(container, '.animated-counter-inner').getAttribute('class')).not.toContain(
            'wip-amount',
        );
        expect(restingCounterRow(container).textContent).toBe('2');
    });

    it('renders a bare count when the status has no limit at all', () => {
        const { props } = makeHarness({ overrides: { count: 2 } });
        const { container } = render(<StatusColumn {...props} />);

        expect(q(container, '.animated-counter-inner').getAttribute('class')).not.toContain(
            'wip-amount',
        );
        expect(restingCounterRow(container).textContent).toBe('2');
    });

    it('forwards `renderInProgress` as the counter\u2019s `disabled` flag', () => {
        // `disabled="ctrl.renderInProgress"` -- `kanban-table.jade` L127 / L203. Disabled
        // freezes the roll machine, so no count is committed and the resting row falls
        // back to 0, which is exactly how a suppressed counter is observable.
        const { props } = makeHarness({ overrides: { renderInProgress: true, count: 5 } });
        const { container } = render(<StatusColumn {...props} />);

        expect(restingCounterRow(container).textContent).toBe('0');
    });
});


/* ==========================================================================
 * §2.5 -- THE STICKY TASK COUNTER
 * ==========================================================================
 *
 * ⭐⭐ AXIS AND SIGN DISCIPLINE (T9). Two scroll syncs live in this one feature and they
 * are trivially transposed:
 *
 *   - THIS one, `KanbanTaskboardColumnDirective` (`main.coffee` L1199-L1202), is the
 *     VERTICAL sync of the counter INSIDE one column:
 *         scroll = event.currentTarget.scrollTop
 *         taskCounterDom.css("transform", "translateY(#{scroll}px)")
 *     -- axis Y, sign POSITIVE, no negation anywhere.
 *
 *   - The board's header band (`main.coffee` L702-L704, owned by `KanbanBoard`) is the
 *     HORIZONTAL sync of a DIFFERENT element:
 *         scroll = -1 * event.currentTarget.scrollLeft
 *         tableHeaderDom.css("transform", "translateX(#{scroll}px)")
 *     -- axis X, sign NEGATIVE.
 *
 * Different axis AND different sign. The assertions below pin the Y/positive form, so
 * transposing them fails here rather than surfacing as a counter that drifts the wrong
 * way under the finger.
 *
 * jsdom performs no layout, so `scrollTop` is always 0 and cannot be moved by scrolling:
 * it is assigned explicitly before each synthetic `scroll` event.
 */

describe('StatusColumn -- sticky task counter', () => {
    it('writes `translateY(<scrollTop>px)` onto the counter as the column scrolls', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const root: HTMLElement = column(container);

        // jsdom never moves `scrollTop` itself, so it is set before the event is fired.
        Object.defineProperty(root, 'scrollTop', {
            value: 120,
            writable: true,
            configurable: true,
        });
        fireEvent.scroll(root);

        expect(q(container, '.kanban-task-counter').style.transform).toBe('translateY(120px)');
    });

    it('uses the Y axis with a POSITIVE offset -- never `translateX`, never negated', () => {
        // T9: the header band is the one that negates and moves on X. See the block note.
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const root: HTMLElement = column(container);
        root.scrollTop = 45;
        fireEvent.scroll(root);

        const transform: string = q(container, '.kanban-task-counter').style.transform;

        expect(transform).toBe('translateY(45px)');
        expect(transform).not.toContain('translateX');
        expect(transform).not.toContain('-45');
    });

    it('tracks every subsequent scroll position, including back to zero', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const root: HTMLElement = column(container);

        root.scrollTop = 120;
        fireEvent.scroll(root);
        expect(q(container, '.kanban-task-counter').style.transform).toBe('translateY(120px)');

        root.scrollTop = 8;
        fireEvent.scroll(root);
        expect(q(container, '.kanban-task-counter').style.transform).toBe('translateY(8px)');

        root.scrollTop = 0;
        fireEvent.scroll(root);
        expect(q(container, '.kanban-task-counter').style.transform).toBe('translateY(0px)');
    });

    it('is a no-op while folded, because the counter is not mounted', () => {
        // The incumbent's `$el.find(".kanban-task-counter")` matched nothing and `.css()`
        // was a no-op on an empty jQuery set. Same outcome, and no document-wide query --
        // which would have found a SIBLING column's counter, because the ids are
        // duplicated (§2.2).
        const { props } = makeHarness({ overrides: { folded: true } });
        const { container } = render(<StatusColumn {...props} />);

        const root: HTMLElement = column(container);
        root.scrollTop = 40;

        expect((): void => {
            fireEvent.scroll(root);
        }).not.toThrow();
        expect(container.querySelector('.kanban-task-counter')).toBeNull();
    });

    it('leaves the counter untransformed until the column is actually scrolled', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        expect(q(container, '.kanban-task-counter').style.transform).toBe('');
    });

    it('detaches the listener on unmount, so a later scroll throws nothing and mutates nothing', () => {
        // The AngularJS teardown was `$scope.$on "$destroy", -> $el.off()` (`main.coffee`
        // L1204-L1205). React removes the listener with the element, so the equivalent is
        // asserted rather than written: the detached node must be inert.
        const { props } = makeHarness();
        const { container, unmount } = render(<StatusColumn {...props} />);

        const root: HTMLElement = column(container);
        const counter: HTMLElement = q(container, '.kanban-task-counter');

        unmount();

        root.scrollTop = 200;

        expect((): void => {
            fireEvent.scroll(root);
        }).not.toThrow();
        expect(counter.style.transform).toBe('');
        expect(container.querySelector('.taskboard-column')).toBeNull();
    });
});

/* ==========================================================================
 * §2.7 -- THE CARD PLACEHOLDER
 * ========================================================================== */

describe('StatusColumn -- card placeholder', () => {
    /** The placeholder's own children, reduced to their class signature, in order. */
    function placeholderChildClasses(container: HTMLElement): readonly string[] {
        return Array.from(q(container, '.card-placeholder').children).map(
            (child: Element): string =>
                `${child.tagName.toLowerCase()}.${child.getAttribute('class') ?? ''}`,
        );
    }

    it('is absent unless the resolved predicate holds', () => {
        // `ctrl.showPlaceHolder(s.id[, swimlane.id])` -- first status AND no stories at
        // all, plus first swimlane in swimlane mode (`main.coffee` L316-L323). Its arity
        // differs between the two modes, so it is resolved upstream and arrives here as
        // one boolean.
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelector('.card-placeholder')).toBeNull();
    });

    it('renders the full loading skeleton, in source order, with both paragraphs', () => {
        const { props } = makeHarness({ overrides: { showPlaceholder: true } });
        const { container } = render(<StatusColumn {...props} />);

        const placeholder: HTMLElement = q(container, '.card-placeholder');

        expect(placeholder.classList.contains('not-found')).toBe(false);

        // `kanban-placeholder.jade` L9-L26, transcribed inline: every class exactly once,
        // in the same order and nesting, so the unedited `card-placeholder.scss` applies
        // verbatim (rule T1).
        expect(placeholderChildClasses(container)).toEqual([
            'div.placeholder-board-card',
            'div.placeholder-titles',
            'div.placeholder-avatar',
            'p.title',
            'p.',
        ]);

        const boardCard: HTMLElement = q(placeholder, '.placeholder-board-card');
        const rows: readonly HTMLElement[] = all(boardCard, '.placeholder-board-row');

        expect(rows).toHaveLength(3);
        expect(rows[2]?.classList.contains('avatar')).toBe(true);
        expect(rows[0]?.classList.contains('avatar')).toBe(false);
        expect(rows[1]?.classList.contains('avatar')).toBe(false);

        expect(all(placeholder, '.placeholder-board-text')).toHaveLength(3);
        expect(all(placeholder, '.placeholder-board-text.small')).toHaveLength(1);
        expect(all(placeholder, '.placeholder-board-text.big')).toHaveLength(1);
        expect(all(rows[1] as HTMLElement, '.placeholder-board-text')).toHaveLength(1);
        expect(all(placeholder, '.placeholder-board-avatar')).toHaveLength(1);
        expect(all(placeholder, '.placeholder-board-user')).toHaveLength(1);
        expect(all(placeholder, '.placeholder-titles > .text-small')).toHaveLength(1);
        expect(all(placeholder, '.placeholder-titles > .text-large')).toHaveLength(1);
        expect(all(placeholder, '.placeholder-avatar > .image')).toHaveLength(1);
        expect(all(placeholder, '.placeholder-avatar > .text')).toHaveLength(1);
    });

    it('routes the two loading strings through the translator, hardcoding neither', () => {
        const { props } = makeHarness({ overrides: { showPlaceholder: true } });
        const { container } = render(<StatusColumn {...props} />);

        const placeholder: HTMLElement = q(container, '.card-placeholder');

        expect(
            all(placeholder, 'p').map((node: HTMLElement): string | null => node.textContent),
        ).toEqual(['t(KANBAN.PLACEHOLDER_CARD_TITLE)', 't(KANBAN.PLACEHOLDER_CARD_TEXT)']);
        expect(q(placeholder, 'p.title').textContent).toBe('t(KANBAN.PLACEHOLDER_CARD_TITLE)');
    });

    it('switches to the three NOT-FOUND paragraphs, and adds `not-found`, on ONE flag', () => {
        // `ng-class='{"not-found": ctrl.notFoundUserstories}'` and the two `ng-if`s all
        // read the same flag, so the class and the branch can never disagree.
        const { props } = makeHarness({
            overrides: { showPlaceholder: true, notFound: true },
        });
        const { container } = render(<StatusColumn {...props} />);

        const placeholder: HTMLElement = q(container, '.card-placeholder');

        expect(placeholder.classList.contains('not-found')).toBe(true);
        expect(placeholderChildClasses(container)).toEqual(['p.title', 'p.', 'p.']);
        expect(
            all(placeholder, 'p').map((node: HTMLElement): string | null => node.textContent),
        ).toEqual([
            't(KANBAN.US_NOT_FOUND_TITLE)',
            't(KANBAN.US_NOT_FOUND_TEXT_P1)',
            't(KANBAN.US_NOT_FOUND_TEXT_P2)',
        ]);
    });

    it('renders the two branches MUTUALLY EXCLUSIVELY -- no loading class survives', () => {
        const { props } = makeHarness({
            overrides: { showPlaceholder: true, notFound: true },
        });
        const { container } = render(<StatusColumn {...props} />);

        const placeholder: HTMLElement = q(container, '.card-placeholder');

        expect(placeholder.querySelector('.placeholder-board-card')).toBeNull();
        expect(placeholder.querySelector('.placeholder-board-row')).toBeNull();
        expect(placeholder.querySelector('.placeholder-board-text')).toBeNull();
        expect(placeholder.querySelector('.placeholder-board-avatar')).toBeNull();
        expect(placeholder.querySelector('.placeholder-board-user')).toBeNull();
        expect(placeholder.querySelector('.placeholder-titles')).toBeNull();
        expect(placeholder.querySelector('.placeholder-avatar')).toBeNull();
    });

    it('emits NO `<ng-container>` element in either branch', () => {
        // D16: `ng-container` is not an AngularJS directive, so AngularJS emitted it into
        // the DOM as a literal unknown element wrapping each branch. React uses a FRAGMENT
        // instead, so both wrappers are absent. Verified repo-wide that no stylesheet
        // selects `ng-container`, so nothing depends on it -- and no JSX intrinsic is
        // declared for it anywhere. Named here rather than silently resolved (rule T6).
        const loading = render(
            <StatusColumn {...makeHarness({ overrides: { showPlaceholder: true } }).props} />,
        );
        expect(loading.container.querySelector('ng-container')).toBeNull();

        const notFound = render(
            <StatusColumn
                {...makeHarness({ overrides: { showPlaceholder: true, notFound: true } }).props}
            />,
        );
        expect(notFound.container.querySelector('ng-container')).toBeNull();
    });

    it('keeps the placeholder MOUNTED while folded, letting `.vfold` hide it', () => {
        // `.vfold .card-placeholder { display: none }` -- `kanban-table.scss` L82-L84 --
        // already owns the hiding. Adding a fold condition here would remove an element
        // the stylesheet only means to hide, and authoring behaviour a rule already
        // provides is a compliance violation (G-DS-4). No `display` is asserted: jsdom
        // parses no CSS.
        const { props } = makeHarness({ overrides: { folded: true, showPlaceholder: true } });
        const { container } = render(<StatusColumn {...props} />);

        expect(all(container, '.card-placeholder')).toHaveLength(1);
    });
});


/* ==========================================================================
 * CHILD 4 -- THE CARDS
 * ========================================================================== */

describe('StatusColumn -- the cards', () => {
    it('renders one `<tg-card data-id>` per id, in the order given', () => {
        // ⭐⭐ THE UPSTREAM LOOKUP KEYS ARE ASYMMETRIC AND ARE NOT NORMALISED HERE.
        // Flat mode resolves its collection with a STRING key --
        // `usByStatus.get(s.id.toString())` (`kanban-table.jade` L229) -- while swimlane
        // mode resolves it with a NUMERIC path --
        // `usByStatusSwimlanes.getIn([swimlane.id, s.id])` (L153). Conflating the two
        // silently empties columns. That asymmetry is honoured in
        // `./state/boardSelectors.ts` (`String(story.status)` when grouping, `Number(...)`
        // when re-keying a swimlane's map) and asserted by
        // `./state/boardSelectors.test.ts`. This component receives the ALREADY-RESOLVED
        // id list, so it neither knows nor can corrupt the key types -- and what is
        // asserted here is that it renders exactly the ids it was given, in order.
        const { props } = makeCardsHarness([11, 12, 13]);
        const { container } = render(<StatusColumn {...props} />);

        expect(cardIdsInDom(container)).toEqual(['11', '12', '13']);
        expect(cardElements(container).every((card: HTMLElement): boolean => card.hasAttribute('data-id'))).toBe(true);
    });

    it('renders the ids in the ORDER GIVEN even when they are not sorted', () => {
        const { props } = makeCardsHarness([31, 4, 17]);
        const { container } = render(<StatusColumn {...props} />);

        expect(cardIdsInDom(container)).toEqual(['31', '4', '17']);
    });

    it('skips an id with no resolved detail rather than throwing', () => {
        // The source's `item="usMap.get(usId)"` tolerated a miss, because AngularJS
        // expressions are null-safe. `./KanbanCard` REQUIRES `item`, so the equivalent is
        // to render no card at all rather than take the board down.
        const { props } = makeHarness({
            overrides: {
                cardIds: [11, 12, 13],
                count: 3,
                cardDetails: makeCardDetails([11, 13]),
            },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(cardIdsInDom(container)).toEqual(['11', '13']);
    });

    it('keys cards by user-story id, so reordering MOVES nodes instead of rewriting them', () => {
        // `track by s.id` had the same property. An index key would make React reuse the
        // wrong card's DOM node on an insert or a move -- and because the drag layer
        // decorates those nodes imperatively, a stale drag class would land on a different
        // story.
        const { props } = makeCardsHarness([11, 12]);
        const { container, rerender } = render(<StatusColumn {...props} />);

        const before: HTMLElement = q(container, 'tg-card[data-id="11"]');
        before.dataset.probe = 'kept';

        rerender(<StatusColumn {...props} cardIds={[12, 11]} />);

        expect(cardIdsInDom(container)).toEqual(['12', '11']);
        expect(q(container, 'tg-card[data-id="11"]').dataset.probe).toBe('kept');
    });

    it('marks only the selected story, with BOTH classes the source applies', () => {
        const { props } = makeCardsHarness([11, 12], { selectedUss: { 12: true } });
        const { container } = render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).selected).toBe(false);
        expect(lastRecordedFor(12).selected).toBe(true);

        const selected: string = q(container, 'tg-card[data-id="12"]').getAttribute('class') ?? '';

        expect(selected).toContain('kanban-task-selected');
        expect(selected).toContain('ui-multisortable-multiple');
        expect(q(container, 'tg-card[data-id="11"]').getAttribute('class')).not.toContain(
            'kanban-task-selected',
        );
    });

    it('reports `isFirst` for the first card alone -- the repeat\u2019s `$first`', () => {
        const { props } = makeCardsHarness([11, 12, 13]);
        render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).isFirst).toBe(true);
        expect(lastRecordedFor(12).isFirst).toBe(false);
        expect(lastRecordedFor(13).isFirst).toBe(false);
    });

    it('reads each card\u2019s `inViewPort` from the write-once visibility latch', () => {
        const { props } = makeHarness({
            overrides: {
                cardIds: [11, 12],
                count: 2,
                cardDetails: makeCardDetails([11, 12]),
            },
            visibleIds: { 12: true },
        });
        render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).inViewPort).toBe(false);
        expect(lastRecordedFor(12).inViewPort).toBe(true);
    });

    it('never sends `folded` to the card, because the board never binds it', () => {
        // Neither `kanban-table.jade` call site passes it, so the prop is removed from the
        // column's card contract rather than left available to a caller who might start
        // passing it and change the card's rest state (rule T10).
        const { props } = makeHarness({ overrides: { folded: true } });
        render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).folded).toBeUndefined();
    });

    it('threads the shared card props through unchanged', () => {
        const cardProps: StatusColumnCardProps = makeCardProps();
        const { props } = makeHarness({ overrides: { cardProps } });

        render(<StatusColumn {...props} />);

        const recorded: KanbanCardProps = lastRecordedFor(11);

        expect(recorded.project).toBe(cardProps.project);
        expect(recorded.zoom).toBe(cardProps.zoom);
        expect(recorded.zoomLevel).toBe(cardProps.zoomLevel);
        expect(recorded.type).toBe(cardProps.type);
        expect(recorded.permissions).toBe(cardProps.permissions);
        expect(recorded.avatars).toBe(cardProps.avatars);
        expect(recorded.unnamedAvatarUrl).toBe(cardProps.unnamedAvatarUrl);
        expect(recorded.onToggleFold).toBe(cardProps.onToggleFold);
        expect(recorded.onClickEdit).toBe(cardProps.onClickEdit);
        expect(recorded.onClickDelete).toBe(cardProps.onClickDelete);
        expect(recorded.onClickAssignedTo).toBe(cardProps.onClickAssignedTo);
        expect(recorded.onToggleSelected).toBe(cardProps.onToggleSelected);
        expect(recorded.translate).toBe(translate);
    });

    it('threads the per-card detail through unchanged', () => {
        const detail: StatusColumnCardDetail = makeCardDetail(11);
        const { props } = makeHarness({ overrides: { cardDetails: { 11: detail } } });

        render(<StatusColumn {...props} />);

        const recorded: KanbanCardProps = lastRecordedFor(11);

        expect(recorded.item).toBe(detail.item);
        expect(recorded.archived).toBe(detail.archived);
        expect(recorded.totalAttachments).toBe(detail.totalAttachments);
    });

    it('renders no card at all for an empty column', () => {
        const { props } = makeCardsHarness([]);
        const { container } = render(<StatusColumn {...props} />);

        expect(cardElements(container)).toHaveLength(0);
        expect(childOrder(container)).toEqual(['counter']);
    });

    it('renders the `<tg-card data-id>` host for OFF-SCREEN cards too -- R-DND-3', () => {
        // Virtualisation must never remove a card's host element: `@dnd-kit/core` has no
        // virtual-list support, so a card outside the viewport still has to be a valid
        // drop neighbour. Dropping the element would mean dragging toward a collapsed or
        // scrolled-away region finds NO drop target.
        const { props } = makeCardsHarness([11, 12, 13]);
        const { container } = render(<StatusColumn {...props} />);

        // Nothing has latched visible: every card is off-screen.
        expect(props.inViewport.visibleIds).toEqual({});
        expect(cardIdsInDom(container)).toEqual(['11', '12', '13']);
        [11, 12, 13].forEach((usId: number): void => {
            expect(lastRecordedFor(usId).inViewPort).toBe(false);
        });
    });
});

/* ==========================================================================
 * §2.4 -- THE WIP-LIMIT MARKER IS INTERLEAVED, NOT APPENDED
 * ==========================================================================
 *
 * The marker is a SIBLING of the cards, inserted immediately after one specific card --
 * which is where the retired directive's imperative
 * `angular.element(element).after("<div class='kanban-wip-limit …'>…")` put it:
 *
 *   - `one-left` and `reached` anchor after the LAST card;
 *   - `exceeded` anchors after `cards[wipLimit - 1]`, leaving the surplus BELOW the rule.
 *
 * Every expectation below takes its state and index from the SHARED pure helpers
 * (`expectedWip`), never from arithmetic written here.
 *
 * ⛔ NO `display` IS ASSERTED, and the component does NOT gate the marker on the fold:
 * `.vfold .kanban-wip-limit { display: none }` at `kanban-table.scss` L79-L81 already
 * hides it through CSS, and jsdom parses no CSS.
 */

describe('StatusColumn -- WIP marker interleaving', () => {
    function harnessWith(
        cardIds: readonly number[],
        wipLimit: number | null,
        isArchived = false,
    ): Harness {
        return makeCardsHarness(cardIds, {
            status: makeStatus({ wip_limit: wipLimit, is_archived: isArchived }),
        });
    }

    it('renders `one-left` after the LAST card when one slot remains', () => {
        // Figma node `1:7`, swimlane "autem quas" / NEW: the cell reading "2 / 3".
        const cardIds: readonly number[] = [11, 12];
        const { state, index } = expectedWip(cardIds.length, 3);

        expect(state).toBe('one-left');
        expect(index).toBe(cardIds.length - 1);

        const { container } = render(<StatusColumn {...harnessWith(cardIds, 3).props} />);

        expect(childOrder(container)).toEqual(['counter', 'card:11', 'card:12', 'wip:one-left']);
    });

    it('renders `reached` as the LAST child when the limit is exactly met', () => {
        // Asserted positionally with four cards over a limit of four. Figma node `1:7`'s
        // own `reached` cell -- swimlane "hic ut" / NEW, reading "2 / 2" -- is the SAME
        // state at a different size, confirmed against the shared helper below so the
        // frame's case is covered by the same assertion.
        expect(expectedWip(2, 2).state).toBe('reached');

        const cardIds: readonly number[] = [11, 12, 13, 14];
        const { state, index } = expectedWip(cardIds.length, 4);

        expect(state).toBe('reached');
        expect(index).toBe(cardIds.length - 1);

        const { container } = render(<StatusColumn {...harnessWith(cardIds, 4).props} />);

        const marker: HTMLElement = q(container, '.kanban-wip-limit');
        const root: HTMLElement = column(container);

        expect(marker).toBe(root.lastElementChild);
        expect(marker.previousElementSibling?.tagName.toLowerCase()).toBe('tg-card');
        expect(marker.previousElementSibling?.getAttribute('data-id')).toBe('14');
        expect(marker.nextElementSibling).toBeNull();
    });

    it('renders `exceeded` after `cards[wipLimit - 1]` with 5 cards over a limit of 4', () => {
        // The anchor is the FOURTH card, and the surplus -- everything the limit does not
        // permit -- stays visibly below the rule. The trailing count is read off the
        // helper's own index, never recomputed here.
        const cardIds: readonly number[] = [11, 12, 13, 14, 15];
        const { state, index } = expectedWip(cardIds.length, 4);

        expect(state).toBe('exceeded');
        expect(index).toBe(3);

        const { container } = render(<StatusColumn {...harnessWith(cardIds, 4).props} />);

        const marker: HTMLElement = q(container, '.kanban-wip-limit');
        const cards: readonly HTMLElement[] = cardElements(container);

        expect(marker.classList.contains('exceeded')).toBe(true);
        expect(marker.previousElementSibling).toBe(cards[index]);
        expect(marker.previousElementSibling?.tagName.toLowerCase()).toBe('tg-card');
        expect(marker.previousElementSibling?.getAttribute('data-id')).toBe('14');

        expect(followingSiblingIds(marker)).toEqual(['15']);
        expect(followingSiblingIds(marker)).toHaveLength(cards.length - (index + 1));
    });

    it('leaves TWO card siblings below the rule with 6 cards over a limit of 4', () => {
        // The same anchor -- `cards[wipLimit - 1]`, the fourth card -- with a longer
        // column, so the surplus below the rule is two cards rather than one. Anchoring by
        // the card count instead of the limit would push the rule to the bottom and hide
        // the overrun entirely.
        const cardIds: readonly number[] = [11, 12, 13, 14, 15, 16];
        const { state, index } = expectedWip(cardIds.length, 4);

        expect(state).toBe('exceeded');
        expect(index).toBe(3);

        const { container } = render(<StatusColumn {...harnessWith(cardIds, 4).props} />);

        const marker: HTMLElement = q(container, '.kanban-wip-limit');
        const cards: readonly HTMLElement[] = cardElements(container);

        expect(marker.previousElementSibling).toBe(cards[3]);
        expect(marker.previousElementSibling?.getAttribute('data-id')).toBe('14');
        expect(followingSiblingIds(marker)).toEqual(['15', '16']);
        expect(followingSiblingIds(marker)).toHaveLength(cards.length - (index + 1));
    });

    it('places `exceeded` by the LIMIT, not by the card count', () => {
        // Four cards over a limit of two anchors after the SECOND card; four cards over a
        // limit of three anchors after the THIRD. Anchoring by count instead would put the
        // rule at the bottom in both cases and hide the overrun entirely.
        const cardIds: readonly number[] = [11, 12, 13, 14];

        expect(expectedWip(cardIds.length, 2).index).toBe(1);
        expect(expectedWip(cardIds.length, 3).index).toBe(2);

        const overTwo = render(<StatusColumn {...harnessWith(cardIds, 2).props} />);
        expect(childOrder(overTwo.container)).toEqual([
            'counter',
            'card:11',
            'card:12',
            'wip:exceeded',
            'card:13',
            'card:14',
        ]);

        const overThree = render(<StatusColumn {...harnessWith(cardIds, 3).props} />);
        expect(childOrder(overThree.container)).toEqual([
            'counter',
            'card:11',
            'card:12',
            'card:13',
            'wip:exceeded',
            'card:14',
        ]);
    });

    it('renders EXACTLY ONE marker, never one per card', () => {
        const { container } = render(<StatusColumn {...harnessWith([11, 12, 13, 14], 2).props} />);

        expect(all(container, '.kanban-wip-limit')).toHaveLength(1);
    });

    it('renders NO marker when the status has no limit', () => {
        expect(expectedWip(2, null).state).toBeUndefined();

        const { container } = render(<StatusColumn {...harnessWith([11, 12], null).props} />);

        expect(container.querySelector('.kanban-wip-limit')).toBeNull();
    });

    it('renders NO marker for a limit of 0, which addresses no card -- drift D13', () => {
        // A limit of zero resolves an anchor index of -1, which addresses no card, so the
        // column stays silent while the counter still shows the bare count.
        expect(expectedWip(2, 0).state).toBeUndefined();

        const { container } = render(<StatusColumn {...harnessWith([11, 12], 0).props} />);

        expect(container.querySelector('.kanban-wip-limit')).toBeNull();
    });

    it('renders NO marker for an ARCHIVED status, however the counts fall', () => {
        // `if status and not status.is_archived` -- the retired directive never even
        // subscribed for an archived column.
        expect(expectedWip(2, 2, true).state).toBeUndefined();

        const { container } = render(<StatusColumn {...harnessWith([11, 12], 2, true).props} />);

        expect(container.querySelector('.kanban-wip-limit')).toBeNull();
    });

    it('renders NO marker below the threshold -- the frame\u2019s three unmarked cells', () => {
        // "1 / 4" and "0 / 2" both resolve to no marker, which is why only two of the five
        // limited cells in Figma node `1:7` show a rule at all.
        expect(expectedWip(1, 4).state).toBeUndefined();
        expect(expectedWip(0, 2).state).toBeUndefined();

        const oneOfFour = render(<StatusColumn {...harnessWith([11], 4).props} />);
        expect(oneOfFour.container.querySelector('.kanban-wip-limit')).toBeNull();

        const noneOfTwo = render(<StatusColumn {...harnessWith([], 2).props} />);
        expect(noneOfTwo.container.querySelector('.kanban-wip-limit')).toBeNull();
    });

    it('counts the RENDERED cards, so a skipped id does not shift the threshold', () => {
        // The retired directive counted `$el.find("tg-card")`, i.e. the live DOM, not a
        // model collection -- so three ids with only two resolvable details is a column of
        // TWO for threshold purposes.
        expect(expectedWip(2, 3).state).toBe('one-left');

        const { props } = makeHarness({
            overrides: {
                status: makeStatus({ wip_limit: 3 }),
                cardIds: [11, 12, 13],
                count: 3,
                cardDetails: makeCardDetails([11, 12]),
            },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual(['counter', 'card:11', 'card:12', 'wip:one-left']);
    });

    it('ignores the counter\u2019s `count` when placing the marker', () => {
        // The counter's number and the marker's threshold are different measurements, and
        // substituting one for the other is how the two contracts get crossed. Two rendered
        // cards with an upstream count of 99 is still a `reached` column at a limit of two.
        const { props } = makeHarness({
            overrides: {
                status: makeStatus({ wip_limit: 2 }),
                cardIds: [11, 12],
                count: 99,
                cardDetails: makeCardDetails([11, 12]),
            },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual(['counter', 'card:11', 'card:12', 'wip:reached']);
        expect(restingCounterRow(container).textContent).toBe('99 / 2');
    });

    it('keeps the marker MOUNTED while folded, letting `.vfold` hide it', () => {
        // `.vfold .kanban-wip-limit { display: none }` -- `kanban-table.scss` L79-L81 --
        // owns the hiding through CSS. The component must therefore NOT gate the marker on
        // the fold, and this spec must not assert `display`: jsdom parses no stylesheet.
        const { props } = makeCardsHarness([11, 12], {
            status: makeStatus({ wip_limit: 2 }),
            folded: true,
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(all(container, '.kanban-wip-limit')).toHaveLength(1);
    });

    it('carries the hardcoded label the source emitted -- drift D5', () => {
        // `./WipLimitMarker` emits `<span>WIP Limit</span>` as an untranslated English
        // literal, reproducing the incumbent's interpolated HTML string exactly. Locale
        // keys with this text exist nearby, so the omission is visible rather than
        // inevitable -- but wiring one in would alter rendered copy, which rule T10
        // forbids. Preserved and named, not silently resolved.
        const { container } = render(<StatusColumn {...harnessWith([11, 12], 2).props} />);

        expect(q(container, '.kanban-wip-limit span').textContent).toBe('WIP Limit');
    });
});


/* ==========================================================================
 * CHILD 5 -- THE ARCHIVED-STATUS INTRO
 * ========================================================================== */

describe('StatusColumn -- the archived-status intro', () => {
    it('renders LAST, and only for an archived status', () => {
        const onIntroShown = jest.fn<void, [number]>();
        const { props } = makeHarness({
            overrides: { status: makeStatus({ is_archived: true }), onIntroShown },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual(['counter', 'card:11', 'intro']);
        expect(q(container, '.kanban-column-intro')).toBe(column(container).lastElementChild);
        expect(onIntroShown).toHaveBeenCalledTimes(1);
        expect(onIntroShown).toHaveBeenCalledWith(STATUS_ID);
    });

    it('is a `div.kanban-column-intro`, as the source declares it', () => {
        const { props } = makeHarness({
            overrides: { status: makeStatus({ is_archived: true }) },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(q(container, '.kanban-column-intro').tagName.toLowerCase()).toBe('div');
    });

    it('is absent for an ordinary status, and announces nothing', () => {
        const onIntroShown = jest.fn<void, [number]>();
        const { props } = makeHarness({ overrides: { onIntroShown } });
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelector('.kanban-column-intro')).toBeNull();
        expect(onIntroShown).not.toHaveBeenCalled();
    });

    it('stays MOUNTED and LAST when an archived column is folded', () => {
        // `.vfold .kanban-column-intro { display: none }` -- `kanban-table.scss` L106-L108
        // -- owns the hiding, so the gate here is `is_archived` ALONE and must never grow a
        // folded condition.
        const { props } = makeHarness({
            overrides: { status: makeStatus({ is_archived: true }), folded: true },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual(['rail', 'card:11', 'intro']);
    });
});

/* ==========================================================================
 * §2.3 -- CHILD ORDER (T1 NESTING)
 * ==========================================================================
 *
 * Source order inside the column: the task counter (unfolded) or the collapsed rail
 * (folded), then the card placeholder, then the cards with the WIP marker interleaved,
 * then the archived-status intro LAST. All five are `ng-if` in the source, so each is
 * ABSENT from the DOM rather than merely invisible -- which is why order is asserted by
 * INDEX and not by presence.
 */

describe('StatusColumn -- child order', () => {
    it('emits counter, placeholder, cards and the WIP marker in source order', () => {
        const { props } = makeCardsHarness([11, 12], {
            status: makeStatus({ wip_limit: 2 }),
            showPlaceholder: true,
        });
        const { container } = render(<StatusColumn {...props} />);

        const order: readonly string[] = childOrder(container);

        expect(order).toEqual(['counter', 'placeholder', 'card:11', 'card:12', 'wip:reached']);
        expect(order[0]).toBe('counter');
        expect(order[1]).toBe('placeholder');
        expect(order[order.length - 1]).toBe('wip:reached');
    });

    it('puts the archived intro LAST in the maximal archived case', () => {
        // An archived status suppresses the WIP marker entirely (the retired directive
        // never subscribed for one), so the maximal archived column is
        // counter -> placeholder -> cards -> intro.
        const { props } = makeCardsHarness([11, 12], {
            status: makeStatus({ is_archived: true, wip_limit: 2 }),
            showPlaceholder: true,
        });
        const { container } = render(<StatusColumn {...props} />);

        const order: readonly string[] = childOrder(container);

        expect(order).toEqual(['counter', 'placeholder', 'card:11', 'card:12', 'intro']);
        expect(order[order.length - 1]).toBe('intro');
        expect(order).not.toContain('rail');
    });

    it('swaps the counter for the rail in the maximal FOLDED case, keeping every other index', () => {
        const { props } = makeCardsHarness([11, 12], {
            status: makeStatus({ wip_limit: 2 }),
            showPlaceholder: true,
            folded: true,
        });
        const { container } = render(<StatusColumn {...props} />);

        const order: readonly string[] = childOrder(container);

        expect(order).toEqual(['rail', 'placeholder', 'card:11', 'card:12', 'wip:reached']);
        expect(order[0]).toBe('rail');
        expect(order).not.toContain('counter');
    });

    it('emits the FOLDED archived column as rail, placeholder, cards, intro', () => {
        const { props } = makeCardsHarness([11], {
            status: makeStatus({ is_archived: true }),
            showPlaceholder: true,
            folded: true,
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual(['rail', 'placeholder', 'card:11', 'intro']);
    });

    it('emits the counter alone for the minimal column', () => {
        const { props } = makeCardsHarness([]);
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual(['counter']);
    });
});

/* ==========================================================================
 * §2.8 -- VIRTUALISATION REGISTRATION (R-DND-3)
 * ==========================================================================
 *
 * The column is the IntersectionObserver ROOT and its cards are the targets, but neither
 * observer is built here: `../shared/useInViewport` owns them at board level and this
 * component's whole contract is the CALL. FINDING E -- the registration order INVERTS
 * relative to the source, because AngularJS linked a column before its cards while React
 * runs child effects before the parent's -- and the hook absorbs that by buffering an
 * early card and flushing it when its column registers. ⛔ No ordering workaround belongs
 * here.
 */

describe('StatusColumn -- virtualisation registration', () => {
    it('registers itself as the observer root, keyed by status AND swimlane', () => {
        const { props, viewport } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        expect(viewport.registerColumn).toHaveBeenCalledTimes(1);
        expect(viewport.registerColumn).toHaveBeenCalledWith(
            column(container),
            STATUS_ID,
            SWIMLANE_ID,
        );
    });

    it('registers with `undefined` for the swimlane in FLAT mode -- NEVER 0', () => {
        // ⭐⭐ THE SUBTLEST BUG AVAILABLE HERE. `useInViewport`'s `columnKey` branches on
        // `swimlaneId ? …` and the incumbent `app/js/boards.js` guards with a bare
        // `if (swimlaneId)` and no existence check, so BOTH discriminate the two modes by
        // TRUTHINESS. A `0` is falsy: it would silently take the FLAT path, and a card
        // would register against a key its column never claims -- virtualisation then
        // quietly never fires, with no error anywhere. `-1`, the synthetic unclassified
        // lane, is truthy and correctly takes the swimlane path.
        const { props, viewport } = makeHarness({ overrides: { swimlaneId: undefined } });
        const { container } = render(<StatusColumn {...props} />);

        expect(viewport.registerColumn).toHaveBeenCalledTimes(1);
        expect(viewport.registerColumn).toHaveBeenCalledWith(
            column(container),
            STATUS_ID,
            undefined,
        );

        const call: ElementKeyArgs | undefined = viewport.registerColumn.mock.calls[0];

        expect(call?.[2]).toBeUndefined();
        expect(call?.[2]).not.toBe(0);
        expect(call?.[2]).not.toBeNull();
    });

    it('registers the real unclassified lane id of -1 rather than dropping it', () => {
        const { props, viewport } = makeHarness({ overrides: { swimlaneId: -1 } });
        render(<StatusColumn {...props} />);

        expect(viewport.registerColumn.mock.calls[0]?.[2]).toBe(-1);
    });

    it('registers every rendered card element, in order, as a `tg-card[data-id]`', () => {
        // Cards are collected with `querySelectorAll('tg-card[data-id]')` -- the same
        // element-name idiom the source used (`$el.find("tg-card")`), chosen so the
        // must-not-modify `./KanbanCard` needs no callback-ref prop added to it.
        const { props, viewport } = makeCardsHarness([11, 12, 13]);
        const { container } = render(<StatusColumn {...props} />);

        expect(viewport.registerCard).toHaveBeenCalledTimes(3);
        expect(
            viewport.registerCard.mock.calls.map((call: ElementKeyArgs): string | null =>
                call[0].getAttribute('data-id'),
            ),
        ).toEqual(['11', '12', '13']);

        viewport.registerCard.mock.calls.forEach((call: ElementKeyArgs): void => {
            expect(call[0].tagName.toLowerCase()).toBe('tg-card');
            expect(call[0].hasAttribute('data-id')).toBe(true);
            expect(call[1]).toBe(STATUS_ID);
            expect(call[2]).toBe(SWIMLANE_ID);
        });

        expect(viewport.registerCard).toHaveBeenCalledWith(
            q(container, 'tg-card[data-id="11"]'),
            STATUS_ID,
            SWIMLANE_ID,
        );
    });

    it('registers OFF-SCREEN cards too, so their drop targets stay valid -- R-DND-3', () => {
        // `@dnd-kit/core` has no virtual-list support, so a card outside the viewport must
        // still be a registered, droppable neighbour. Registering only the visible cards
        // would make dragging toward a scrolled-away region find no drop target.
        const { props, viewport } = makeCardsHarness([11, 12, 13]);
        const { container } = render(<StatusColumn {...props} />);

        expect(props.inViewport.visibleIds).toEqual({});
        expect(viewport.registerCard).toHaveBeenCalledTimes(3);
        expect(cardIdsInDom(container)).toEqual(['11', '12', '13']);
    });

    it('registers a card element only when it carries `data-id`', () => {
        // Without the attribute the registry's `entry.target.dataset.id` would be `NaN` and
        // virtualisation would silently never fire, so the selector requires it -- and
        // `./KanbanCard` always emits it.
        const { props, viewport } = makeCardsHarness([11]);
        render(<StatusColumn {...props} />);

        expect(viewport.registerCard).toHaveBeenCalledTimes(1);
        expect(viewport.registerCard.mock.calls[0]?.[0].hasAttribute('data-id')).toBe(true);
    });

    it('registers nothing for a column with no cards', () => {
        const { props, viewport } = makeCardsHarness([]);
        render(<StatusColumn {...props} />);

        expect(viewport.registerColumn).toHaveBeenCalledTimes(1);
        expect(viewport.registerCard).not.toHaveBeenCalled();
    });

    it('unregisters the column and every card on unmount, with the same keys', () => {
        const { props, viewport } = makeCardsHarness([11, 12]);
        const { unmount } = render(<StatusColumn {...props} />);

        unmount();

        expect(viewport.unregisterColumn).toHaveBeenCalledTimes(1);
        expect(viewport.unregisterColumn).toHaveBeenCalledWith(STATUS_ID, SWIMLANE_ID);
        expect(viewport.unregisterCard).toHaveBeenCalledTimes(2);
        viewport.unregisterCard.mock.calls.forEach((call: ElementKeyArgs): void => {
            expect(call[0].tagName.toLowerCase()).toBe('tg-card');
            expect(call[1]).toBe(STATUS_ID);
            expect(call[2]).toBe(SWIMLANE_ID);
        });
    });

    it('unregisters with `undefined` for the swimlane in FLAT mode', () => {
        const { props, viewport } = makeHarness({ overrides: { swimlaneId: undefined } });
        const { unmount } = render(<StatusColumn {...props} />);

        unmount();

        expect(viewport.unregisterColumn).toHaveBeenCalledWith(STATUS_ID, undefined);
        expect(viewport.unregisterCard.mock.calls[0]?.[2]).toBeUndefined();
    });

    it('re-registers the cards when the id list changes, and ONLY then', () => {
        const { props, viewport } = makeHarness();
        const { rerender } = render(<StatusColumn {...props} />);

        expect(viewport.registerCard).toHaveBeenCalledTimes(1);

        // A re-render that changes no card must not churn the registry.
        rerender(<StatusColumn {...props} isDropTarget />);
        expect(viewport.registerCard).toHaveBeenCalledTimes(1);
        expect(viewport.unregisterCard).not.toHaveBeenCalled();

        rerender(
            <StatusColumn
                {...props}
                cardIds={[11, 12]}
                count={2}
                cardDetails={makeCardDetails([11, 12])}
            />,
        );

        expect(viewport.unregisterCard).toHaveBeenCalledTimes(1);
        expect(viewport.registerCard).toHaveBeenCalledTimes(3);
    });

    it('does not re-register when only the visibility latch advances', () => {
        // `visibleIds` changes identity on every latch, so depending on the API OBJECT
        // rather than on its stable callbacks would tear down and rebuild every
        // registration on each card that scrolls into view.
        const { props, viewport } = makeHarness();
        const { rerender } = render(<StatusColumn {...props} />);

        rerender(
            <StatusColumn
                {...props}
                inViewport={{ ...props.inViewport, visibleIds: { 11: true } }}
            />,
        );

        expect(viewport.registerColumn).toHaveBeenCalledTimes(1);
        expect(viewport.registerCard).toHaveBeenCalledTimes(1);
        expect(lastRecordedFor(11).inViewPort).toBe(true);
    });

    it('constructs ZERO `IntersectionObserver`s of its own', () => {
        // The stub records every construction. The board builds exactly one observer per
        // column inside `../shared/useInViewport`; this component must only ever CALL that
        // API, so a construction here would mean a second, competing observer -- and would
        // also make the component untestable without a real browser (constraint HR-5).
        const { props, viewport } = makeCardsHarness([11, 12]);
        const { unmount } = render(<StatusColumn {...props} />);

        expect(observerConstructions).toHaveLength(0);

        unmount();

        expect(observerConstructions).toHaveLength(0);
        expect(viewport.registerColumn).toHaveBeenCalledTimes(1);
    });
});

/* ==========================================================================
 * §2.10 -- THE LOADED NOTIFICATION
 * ==========================================================================
 *
 * `tg-loaded="taskColumnLoaded($event, s.id, swimlane.id)"` (`kanban-table.jade` L116)
 * and its one-argument flat twin `taskColumnLoaded($event, s.id)` (L193) exist for
 * exactly one purpose: to hand the linked column element to the board so it can become an
 * observer root. `registerColumn` IS that notification in React, so its arity and its
 * once-per-mount discipline are the contract asserted here.
 */

describe('StatusColumn -- loaded notification', () => {
    it('fires ONCE per mount, with the element, in SWIMLANE mode', () => {
        const { props, viewport } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        expect(viewport.registerColumn).toHaveBeenCalledTimes(1);
        expect(viewport.registerColumn.mock.calls[0]).toEqual([
            column(container),
            STATUS_ID,
            SWIMLANE_ID,
        ]);
    });

    it('fires ONCE per mount, with a two-argument shape, in FLAT mode', () => {
        const { props, viewport } = makeHarness({ overrides: { swimlaneId: undefined } });
        const { container } = render(<StatusColumn {...props} />);

        expect(viewport.registerColumn).toHaveBeenCalledTimes(1);
        expect(viewport.registerColumn.mock.calls[0]).toEqual([
            column(container),
            STATUS_ID,
            undefined,
        ]);
    });

    it('hands over the COLUMN element itself, not a child of it', () => {
        // `boards.js` uses the handed-over element as the observer ROOT, so a counter or a
        // card would silently scope visibility to the wrong box.
        const { props, viewport } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const handedOver: HTMLElement | undefined = viewport.registerColumn.mock.calls[0]?.[0];

        expect(handedOver).toBe(column(container));
        expect(handedOver?.classList.contains('taskboard-column')).toBe(true);
        expect(handedOver?.getAttribute('id')).toBe(`column-${STATUS_ID}`);
    });

    it('does NOT fire again on a re-render that leaves status and swimlane alone', () => {
        const { props, viewport } = makeHarness();
        const { rerender } = render(<StatusColumn {...props} />);

        rerender(<StatusColumn {...props} folded />);
        rerender(<StatusColumn {...props} folded={false} isDropTarget />);

        expect(viewport.registerColumn).toHaveBeenCalledTimes(1);
        expect(viewport.unregisterColumn).not.toHaveBeenCalled();
    });

    it('re-fires when the column moves to a different swimlane, unregistering the old key first', () => {
        const { props, viewport } = makeHarness();
        const { rerender } = render(<StatusColumn {...props} />);

        rerender(<StatusColumn {...props} swimlaneId={OTHER_SWIMLANE_ID} />);

        expect(viewport.unregisterColumn).toHaveBeenCalledWith(STATUS_ID, SWIMLANE_ID);
        expect(viewport.registerColumn).toHaveBeenCalledTimes(2);
        expect(viewport.registerColumn.mock.calls[1]?.[2]).toBe(OTHER_SWIMLANE_ID);
    });
});


/* ==========================================================================
 * §2.6 -- `target-drop` AND `new`: dnd-kit EMITS NEITHER FOR FREE (FINDING C)
 * ==========================================================================
 *
 * `@dnd-kit/core` emits NONE of the retired library's classes -- not `gu-transit`, not
 * `gu-mirror`, not `multiple-drag-mirror`, not `tg-multiple-drag-mirror`, and not the two
 * that belong to THIS element -- so React has to apply them explicitly at the right
 * lifecycle moments or the drag visuals silently vanish.
 *
 * ⭐ `target-drop`: dragula added it on `over` and removed it on `out`, BUT ONLY WHEN
 * `container != initialContainer` (`sortable.coffee` L65-L73). A column that IS the
 * drag's own origin must therefore NEVER receive it -- otherwise the source column
 * highlights itself as its own drop target, which the incumbent never did. That exclusion
 * needs the single per-drag `initialContainer`, so it is computed in
 * `./hooks/useCardDrag` / `../shared/dnd` and NOT here: this component receives the
 * already-resolved boolean and does nothing but apply the class. The rule is quoted here
 * so whoever wires the flag cannot get it wrong.
 *
 * ⭐ `new`: on `dragend`, and again only when `initialContainer != parentEl`,
 * `sortable.coffee` L127-L131 does `$(parentEl).addClass('new')` and then registers a
 * ONE-SHOT `$(parentEl).one('animationend', -> $(parentEl).removeClass('new'))`.
 * `kanban-table.scss` L241-L245 declares `.new` as PURELY an animation trigger
 * (`animation: new-us-status-blink .5s ease-in`, and a two-iteration variant for a folded
 * column) with no static declaration at all -- left on, the column never blinks again.
 * ⚠ jsdom never fires `animationend` on its own, so every case below dispatches it.
 */

describe('StatusColumn -- target-drop and the new class', () => {
    it('adds `target-drop` while it is the hovered drop target', () => {
        const { props } = makeHarness({ overrides: { isDropTarget: true } });
        const { container } = render(<StatusColumn {...props} />);

        expect(rootClasses(container)).toContain('target-drop');
    });

    it('omits `target-drop` when it is not the hovered drop target', () => {
        // Which includes the case that matters most: the column the drag STARTED in. The
        // `container != initialContainer` exclusion is resolved upstream, so "not a drop
        // target" and "is the origin" arrive here as the same `false`.
        const { props } = makeHarness({ overrides: { isDropTarget: false } });
        const { container } = render(<StatusColumn {...props} />);

        expect(rootClasses(container)).not.toContain('target-drop');
    });

    it('adds and removes `target-drop` as the flag moves, without touching the other classes', () => {
        const { props } = makeHarness();
        const { container, rerender } = render(<StatusColumn {...props} />);

        rerender(<StatusColumn {...props} isDropTarget />);
        expect(column(container).getAttribute('class')).toBe(
            'kanban-uses-box taskboard-column target-drop',
        );

        rerender(<StatusColumn {...props} isDropTarget={false} />);
        expect(column(container).getAttribute('class')).toBe('kanban-uses-box taskboard-column');
    });

    it('is absent of `new` until a drop lands', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        expect(rootClasses(container)).not.toContain('new');
    });

    it('adds `new` when `justDropped` rises', () => {
        const { props } = makeHarness();
        const { container, rerender } = render(<StatusColumn {...props} />);

        rerender(<StatusColumn {...props} justDropped />);

        expect(rootClasses(container)).toContain('new');
    });

    it('adds `new` when the column mounts already flagged', () => {
        const { props } = makeHarness({ overrides: { justDropped: true } });
        const { container } = render(<StatusColumn {...props} />);

        expect(rootClasses(container)).toContain('new');
    });

    it('removes the new class on the FIRST animationend only -- the source binds with jQuery .one (sortable.coffee)', () => {
        // `$(parentEl).one 'animationend', -> $(parentEl).removeClass('new')` is strictly
        // one-shot. A non-one-shot listener would leave a permanent flash-on-every-animation
        // artefact, and would report the flash finished once per animation rather than once
        // per drop.
        const onNewAnimationEnd = jest.fn<void, []>();
        const { props } = makeHarness({
            overrides: { justDropped: true, onNewAnimationEnd },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(rootClasses(container)).toContain('new');

        fireEvent.animationEnd(column(container));

        expect(rootClasses(container)).not.toContain('new');
        expect(onNewAnimationEnd).toHaveBeenCalledTimes(1);

        // The second event must be inert: no class change, no second report.
        fireEvent.animationEnd(column(container));

        expect(rootClasses(container)).not.toContain('new');
        expect(onNewAnimationEnd).toHaveBeenCalledTimes(1);

        // And a third, for good measure -- the guard is a latch, not a parity bit.
        fireEvent.animationEnd(column(container));

        expect(onNewAnimationEnd).toHaveBeenCalledTimes(1);
    });

    it('does not re-add `new` on a later re-render while the flag stays raised', () => {
        // Edge-triggered, not level-triggered: the class is added when `justDropped` RISES,
        // so a re-render while it stays raised does not restart a finished flash.
        const { props } = makeHarness({ overrides: { justDropped: true } });
        const { container, rerender } = render(<StatusColumn {...props} />);

        fireEvent.animationEnd(column(container));
        expect(rootClasses(container)).not.toContain('new');

        rerender(<StatusColumn {...props} justDropped isDropTarget />);

        expect(rootClasses(container)).not.toContain('new');
        expect(rootClasses(container)).toContain('target-drop');
    });

    it('flashes again on the NEXT drop, after the owner has cleared its flag', () => {
        const { props } = makeHarness();
        const { container, rerender } = render(<StatusColumn {...props} />);

        rerender(<StatusColumn {...props} justDropped />);
        fireEvent.animationEnd(column(container));
        expect(rootClasses(container)).not.toContain('new');

        rerender(<StatusColumn {...props} justDropped={false} />);
        rerender(<StatusColumn {...props} justDropped />);

        expect(rootClasses(container)).toContain('new');
    });

    it('tolerates an absent `onNewAnimationEnd`', () => {
        // Optional by contract: an owner that never sets `justDropped` never needs it, and
        // the imperative drag path does its own bookkeeping.
        const { props } = makeHarness({ overrides: { justDropped: true } });
        const { container } = render(<StatusColumn {...props} />);

        expect((): void => {
            fireEvent.animationEnd(column(container));
        }).not.toThrow();
        expect(rootClasses(container)).not.toContain('new');
    });

    it('calls the LATEST `onNewAnimationEnd`, not the one captured at mount', () => {
        const first = jest.fn<void, []>();
        const second = jest.fn<void, []>();
        const { props } = makeHarness({
            overrides: { justDropped: true, onNewAnimationEnd: first },
        });
        const { container, rerender } = render(<StatusColumn {...props} />);

        rerender(<StatusColumn {...props} justDropped onNewAnimationEnd={second} />);
        fireEvent.animationEnd(column(container));

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('reports nothing when `animationend` arrives with no flash in progress', () => {
        const onNewAnimationEnd = jest.fn<void, []>();
        const { props } = makeHarness({ overrides: { onNewAnimationEnd } });
        const { container } = render(<StatusColumn {...props} />);

        fireEvent.animationEnd(column(container));

        expect(onNewAnimationEnd).not.toHaveBeenCalled();
        expect(rootClasses(container)).not.toContain('new');
    });

    it('emits NONE of the retired drag library\u2019s other classes', () => {
        // FINDING C: `gu-transit`, `gu-mirror` and the two multi-drag mirror classes are
        // applied to the DRAGGED ITEM and its mirror by `../shared/dnd`, never to the
        // column. Asserted so nobody "helpfully" adds one here.
        const { props } = makeHarness({ overrides: { isDropTarget: true, justDropped: true } });
        const { container } = render(<StatusColumn {...props} />);

        const classes: readonly string[] = rootClasses(container);

        ['gu-transit', 'gu-mirror', 'multiple-drag-mirror', 'tg-multiple-drag-mirror'].forEach(
            (name: string): void => {
                expect(classes).not.toContain(name);
            },
        );
    });
});

/* ==========================================================================
 * §2.9 -- FLAT MODE VERSUS SWIMLANE MODE
 * ==========================================================================
 *
 * Everything that differs between `kanban-table.jade`'s two variants keys off ONE
 * discriminator, `swimlaneId !== undefined`:
 *
 *   | concern                       | swimlane mode                  | flat mode        |
 *   | data-swimlane on the column   | present                        | ABSENT           |
 *   | registration key              | (status, swimlane)             | (status, undef)  |
 *   | `kanban-moved` on a card      | bound (L154)                   | NOT BOUND (L230) |
 *   | on-click-move-to-top          | bound (L160)                   | NOT BOUND        |
 *   | loaded-notification arity     | ($event, s.id, swimlane.id)    | ($event, s.id)   |
 *
 * The attribute ORDER also differs (`tg-kanban-taskboard-column` before
 * `tg-kanban-wip-limit` in swimlane mode, reversed in flat mode); that is cosmetic in the
 * source and deliberately NOT asserted.
 */

describe('StatusColumn -- flat mode versus swimlane mode', () => {
    it('applies `kanban-moved` in SWIMLANE mode', () => {
        const { props } = makeHarness({ overrides: { movedUs: [11] } });
        const { container } = render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).moved).toBe(true);
        expect(q(container, 'tg-card[data-id="11"]').getAttribute('class')).toContain(
            'kanban-moved',
        );
    });

    it('FORCES `moved` to false in FLAT mode, whatever `movedUs` holds', () => {
        // The flat card `ng-class` map (`kanban-table.jade` L230) has no `kanban-moved`
        // entry at all, so honouring `movedUs` here would be a phantom feature -- a
        // highlight the incumbent never showed in flat mode.
        const { props } = makeHarness({ overrides: { swimlaneId: undefined, movedUs: [11] } });
        const { container } = render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).moved).toBe(false);
        expect(q(container, 'tg-card[data-id="11"]').getAttribute('class')).not.toContain(
            'kanban-moved',
        );
    });

    it('forwards `onClickMoveToTop` in SWIMLANE mode', () => {
        const onClickMoveToTop = jest.fn<void, [number]>();
        const { props } = makeHarness({ overrides: { onClickMoveToTop } });

        render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).onClickMoveToTop).toBe(onClickMoveToTop);
    });

    it('sends NO move-to-top handler to the card in FLAT mode, even when one is supplied', () => {
        // `on-click-move-to-top` is absent from the flat markup, so the affordance must not
        // exist there. Passing `undefined` is how the flat call site's omission is expressed.
        const onClickMoveToTop = jest.fn<void, [number]>();
        const { props } = makeHarness({
            overrides: { swimlaneId: undefined, onClickMoveToTop },
        });

        render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).onClickMoveToTop).toBeUndefined();
        expect(onClickMoveToTop).not.toHaveBeenCalled();
    });

    it('renders exactly the resolved id list in either mode, normalising no key type', () => {
        // ⭐⭐ The upstream keys are ASYMMETRIC -- flat resolves its collection with
        // `String(statusId)` and swimlane mode with a NUMERIC path inside the swimlane's map
        // -- and conflating them silently empties columns. That asymmetry is honoured in
        // `./state/boardSelectors.ts` and proven by `./state/boardSelectors.test.ts`; this
        // component receives the ALREADY-RESOLVED array, so what it owes is to render
        // exactly the ids it was given, in order, in both modes.
        const cardIds: readonly number[] = [11, 12, 13];

        const swimlane = render(<StatusColumn {...makeCardsHarness(cardIds).props} />);
        expect(cardIdsInDom(swimlane.container)).toEqual(['11', '12', '13']);

        const flat = render(
            <StatusColumn {...makeCardsHarness(cardIds, { swimlaneId: undefined }).props} />,
        );
        expect(cardIdsInDom(flat.container)).toEqual(['11', '12', '13']);
    });

    it('renders the same five children, in the same order, in both modes', () => {
        const overrides: Partial<StatusColumnProps> = {
            status: makeStatus({ wip_limit: 2 }),
            showPlaceholder: true,
        };

        const swimlane = render(<StatusColumn {...makeCardsHarness([11, 12], overrides).props} />);
        const flat = render(
            <StatusColumn
                {...makeCardsHarness([11, 12], { ...overrides, swimlaneId: undefined }).props}
            />,
        );

        expect(childOrder(flat.container)).toEqual(childOrder(swimlane.container));
    });

    it('differs ONLY in `data-swimlane` on the root, class-for-class', () => {
        const swimlane = render(<StatusColumn {...makeHarness().props} />);
        const flat = render(
            <StatusColumn {...makeHarness({ overrides: { swimlaneId: undefined } }).props} />,
        );

        expect(column(flat.container).getAttribute('class')).toBe(
            column(swimlane.container).getAttribute('class'),
        );
        expect(column(flat.container).getAttribute('id')).toBe(
            column(swimlane.container).getAttribute('id'),
        );
        expect(column(swimlane.container).hasAttribute('data-swimlane')).toBe(true);
        expect(column(flat.container).hasAttribute('data-swimlane')).toBe(false);
    });
});

/* ==========================================================================
 * MEMOISATION, THE PUBLIC SURFACE AND THE INJECTOR-FREE CONTRACT
 * ========================================================================== */

describe('StatusColumn -- memoisation, the public surface and the injector-free contract', () => {
    it('is memoised, and named for the React devtools', () => {
        expect(StatusColumn.displayName).toBe('StatusColumn');
    });

    it('does not re-render when its owner re-renders with identical props', () => {
        // Not an ornament: `../shared/dnd` decorates this very element imperatively while a
        // gesture is in flight, and React rewrites `class` wholesale on every render -- so a
        // re-render mid-gesture would strip a class the drag layer owns. The memo boundary
        // is what keeps an in-flight column still.
        const { props } = makeHarness();

        function Owner(): ReactElement {
            const [tick, setTick] = useState<number>(0);

            return (
                <div>
                    <button
                        type="button"
                        onClick={(): void => {
                            setTick((current: number): number => current + 1);
                        }}
                    >
                        {`tick ${tick}`}
                    </button>
                    <StatusColumn {...props} />
                </div>
            );
        }

        const { container } = render(<Owner />);
        const rendersBefore: number = recordedCardProps.length;

        fireEvent.click(q(container, 'button'));

        expect(q(container, 'button').textContent).toBe('tick 1');
        expect(recordedCardProps).toHaveLength(rendersBefore);
    });

    it('renders with NO AngularJS injector available at all', () => {
        // T5 / I7 / HR-5. Every string this cell shows arrives through the injected
        // `translate` prop, and no service, transport, realtime subscription or
        // `$rootScope.$apply()` is reachable from it -- which is exactly what lets the
        // board's most-repeated container be asserted in jsdom with no browser and no
        // bridge. `withMockInjector(null)` mounts the bridge context with NOTHING behind it:
        // any `useAngularService` call in this subtree would throw.
        const { props } = makeHarness();

        expect((): void => {
            render(<StatusColumn {...props} />, { wrapper: withMockInjector(null) });
        }).not.toThrow();
    });

    it('never asks the injector for a service, even with one mounted above it', () => {
        // A live injector whose `get` is spied on: the assertion is that it is never
        // consulted, which is a stronger claim than "the render did not throw".
        const injector = mockInjector({});
        const getService = jest.spyOn(injector, 'get');
        const { props } = makeCardsHarness([11, 12], {
            status: makeStatus({ wip_limit: 2 }),
            showPlaceholder: true,
        });

        const { container } = render(<StatusColumn {...props} />, {
            wrapper: withMockInjector(injector),
        });

        expect(getService).not.toHaveBeenCalled();
        expect(q(container, '.kanban-task-counter').getAttribute('title')).toBe(
            't(KANBAN.NUMBER_US)',
        );
        expect(all(container, '.kanban-wip-limit')).toHaveLength(1);
    });

    it('renders light DOM only -- no shadow root anywhere in the cell (I6)', () => {
        // A shadow root would sever the single global stylesheet loaded at
        // `app/index.jade` L25, so `kanban-table.scss` and `card-placeholder.scss` would
        // stop applying, and would break `<use href="#icon-…">` against the sprite inlined
        // at L96.
        const { props } = makeCardsHarness([11, 12], { showPlaceholder: true });
        const { container } = render(<StatusColumn {...props} />);

        const root: HTMLElement = column(container);

        expect(root.shadowRoot).toBeNull();
        Array.from(root.querySelectorAll('*')).forEach((element: Element): void => {
            expect((element as HTMLElement).shadowRoot).toBeNull();
        });
    });
});

