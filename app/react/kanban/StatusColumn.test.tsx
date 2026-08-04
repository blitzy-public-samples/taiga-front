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
 * binary is launched, no network is touched and nothing here refers to any generated
 * build output. The suite therefore passes with no Chrome and no `dist/`.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * `./StatusColumn.tsx` -- the React port of `div.kanban-uses-box.taskboard-column`
 * and its five children, from `app/partials/includes/modules/kanban-table.jade`
 * L112-L175 (swimlane mode) and its twin at L189-L250 (flat mode), absorbing the
 * behaviour of `KanbanTaskboardColumnDirective` (the sticky counter) and
 * `KanbanWipLimitDirective` (the threshold marker), plus the two drag-state classes
 * `app/coffee/modules/kanban/sortable.coffee` used to apply.
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
 * WHY CLASS NAMES AND SIBLING ORDER, NOT COMPUTED STYLE
 * -----------------------------------------------------
 * Rule T1: the migration preserves every existing class name verbatim, and the
 * appearance comes wholly from the UNEDITED `app/styles/modules/kanban/kanban-table.scss`
 * and `app/styles/components/card-placeholder.scss`, which jsdom does not parse. An
 * assertion on computed style would assert nothing about this file; an assertion on the
 * class contract and on sibling order asserts exactly what can break.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE
 * --------------------------------------
 *  - Geometry. The 292 px column, its 5 px gutter, the 4 px radius, the 36 px folded
 *    rail, the counter's 32 x 22 absolute box and the WIP rule's 260 px span all live
 *    in the unedited stylesheet -- gap G-DS-3, component geometry already encoded. NO
 *    PIXEL IS ASSERTED.
 *  - The counter's internal roll state machine (`./TaskCounter.test.tsx`), the rail's
 *    internals (`./ArchivedColumn.test.tsx`), the marker's own arithmetic
 *    (`./WipLimitMarker.test.tsx`) and the card's internals. What is asserted here is
 *    the CALL SITE and the resulting sibling order.
 *  - `IntersectionObserver`. jsdom provides none, and this component never constructs
 *    one: it calls the board-level API, which is doubled here. That is the boundary
 *    this file owns.
 */

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import { fireEvent, render } from '@testing-library/react';

import type { TranslateFn } from '../bridge/useTranslate';
import type { Status } from '../shared/types/status';
import type { UserStory } from '../shared/types/userStory';
import type { InViewportApi } from '../shared/useInViewport';
import type { KanbanCardProps } from './KanbanCard';

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
 * Fixtures
 * ========================================================================== */

const STATUS_ID = 3;
const SWIMLANE_ID = 7;

/** A deterministic translator, so every translated string is assertable. */
const translate: TranslateFn = (key: string): string => `t(${key})`;

function makeStatus(overrides: Partial<Status> = {}): Status {
    return {
        id: STATUS_ID,
        name: 'Ready',
        // A per-project DATABASE value, never a token (rule T2). Arbitrary here.
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
 * A double for the BOARD-LEVEL virtualisation API. Its four callbacks are stable
 * across renders, exactly as `../shared/useInViewport`'s `useCallback`s are, which is
 * what lets the registration effects be asserted for "exactly once".
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

/* ==========================================================================
 * Query helpers
 * ========================================================================== */

function mustFind(container: HTMLElement, selector: string): HTMLElement {
    const found = container.querySelector<HTMLElement>(selector);

    if (found === null) {
        throw new Error(`expected to find "${selector}"`);
    }

    return found;
}

function column(container: HTMLElement): HTMLElement {
    return mustFind(container, '.taskboard-column');
}

function rootClasses(container: HTMLElement): readonly string[] {
    return (column(container).getAttribute('class') ?? '').split(' ');
}

/**
 * The cell's direct children, each reduced to a short label, so sibling ORDER can be
 * asserted -- which is the only way to check that the WIP marker lands immediately
 * after its anchor card and that the archived intro is last.
 */
function childOrder(container: HTMLElement): readonly string[] {
    return Array.from(column(container).children).map((child: Element): string => {
        const tag = child.tagName.toLowerCase();

        if (tag === 'tg-card') {
            return `card:${child.getAttribute('data-id') ?? '?'}`;
        }

        const className = child.getAttribute('class') ?? '';

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
    const rows = mustFind(container, '.kanban-task-counter').querySelectorAll<HTMLElement>(
        '.result',
    );
    const resting = rows.item(1);

    if (resting === null) {
        throw new Error('expected the counter to emit three `.result` rows');
    }

    return resting;
}

function cardIdsInDom(container: HTMLElement): readonly string[] {
    return Array.from(container.querySelectorAll('tg-card')).map(
        (card: Element): string => card.getAttribute('data-id') ?? '?',
    );
}

function lastRecordedFor(usId: number): KanbanCardProps {
    const found = recordedCardProps.filter(
        (props: KanbanCardProps): boolean => props.item.id === usId,
    );

    if (found.length === 0) {
        throw new Error(`no card props recorded for ${usId}`);
    }

    return found[found.length - 1] as KanbanCardProps;
}

beforeEach((): void => {
    recordedCardProps.length = 0;
});

/* ==========================================================================
 * THE ROOT ELEMENT
 * ========================================================================== */

describe('StatusColumn -- the root element', () => {
    it('is a `div` carrying both unconditional classes', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const root = column(container);

        expect(root.tagName.toLowerCase()).toBe('div');
        expect(root.classList.contains('kanban-uses-box')).toBe(true);
        expect(root.classList.contains('taskboard-column')).toBe(true);
    });

    it('emits `id="column-<status.id>"` and `data-status`', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        expect(column(container).getAttribute('id')).toBe(`column-${STATUS_ID}`);
        expect(column(container).dataset.status).toBe(String(STATUS_ID));
    });

    it('DUPLICATES the id across swimlanes, exactly as the source does', () => {
        // `kanban-table.jade` L115 interpolates the STATUS id alone, so in swimlane mode
        // the same id appears once per lane. Technically invalid HTML, deliberately
        // preserved (rule T10): anything reading `#column-<id>` would break otherwise.
        const first = makeHarness({ overrides: { swimlaneId: 1 } });
        const second = makeHarness({ overrides: { swimlaneId: 2 } });

        const { container } = render(
            <div>
                <StatusColumn {...first.props} />
                <StatusColumn {...second.props} />
            </div>,
        );

        const ids = Array.from(container.querySelectorAll('.taskboard-column')).map(
            (element: Element): string | null => element.getAttribute('id'),
        );

        expect(ids).toEqual([`column-${STATUS_ID}`, `column-${STATUS_ID}`]);
    });

    it('emits `data-swimlane` in SWIMLANE mode', () => {
        const { props } = makeHarness({ overrides: { swimlaneId: SWIMLANE_ID } });
        const { container } = render(<StatusColumn {...props} />);

        expect(column(container).dataset.swimlane).toBe(String(SWIMLANE_ID));
    });

    it('omits `data-swimlane` ENTIRELY in FLAT mode', () => {
        const { props } = makeHarness({ overrides: { swimlaneId: undefined } });
        const { container } = render(<StatusColumn {...props} />);

        expect(column(container).hasAttribute('data-swimlane')).toBe(false);
        expect(column(container).dataset.status).toBe(String(STATUS_ID));
    });

    it('keeps a swimlane id of -1, because the unclassified lane is a real lane', () => {
        // `-1` is TRUTHY, so the registry takes the swimlane path for it -- which is why
        // flat mode must be spelled `undefined` and never `0`.
        const { props } = makeHarness({ overrides: { swimlaneId: -1 } });
        const { container } = render(<StatusColumn {...props} />);

        expect(column(container).dataset.swimlane).toBe('-1');
    });

    it('adds `vfold` when folded and omits it when not', () => {
        const folded = render(<StatusColumn {...makeHarness({ overrides: { folded: true } }).props} />);
        expect(rootClasses(folded.container)).toContain('vfold');

        const open = render(<StatusColumn {...makeHarness().props} />);
        expect(rootClasses(open.container)).not.toContain('vfold');
    });

    it('adds `vunfold` when this status is the most recently unfolded one', () => {
        const on = render(<StatusColumn {...makeHarness({ overrides: { unfolded: true } }).props} />);
        expect(rootClasses(on.container)).toContain('vunfold');

        const off = render(<StatusColumn {...makeHarness().props} />);
        expect(rootClasses(off.container)).not.toContain('vunfold');
    });

    it('adds `target-drop` only while it is the hovered drop target', () => {
        const on = render(
            <StatusColumn {...makeHarness({ overrides: { isDropTarget: true } }).props} />,
        );
        expect(rootClasses(on.container)).toContain('target-drop');

        const off = render(<StatusColumn {...makeHarness().props} />);
        expect(rootClasses(off.container)).not.toContain('target-drop');
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
});

/* ==========================================================================
 * CHILD 1 -- THE TASK COUNTER
 * ========================================================================== */

describe('StatusColumn -- the task counter', () => {
    it('mounts the counter while UNFOLDED, titled from `KANBAN.NUMBER_US`', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const counter = mustFind(container, '.kanban-task-counter');

        expect(counter.getAttribute('title')).toBe('t(KANBAN.NUMBER_US)');
        expect(counter.querySelectorAll('tg-animated-counter')).toHaveLength(1);
    });

    it('UNMOUNTS the counter and mounts the collapsed rail when FOLDED', () => {
        const { props } = makeHarness({ overrides: { folded: true } });
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelector('.kanban-task-counter')).toBeNull();
        expect(container.querySelectorAll('.placeholder-collapsed')).toHaveLength(1);
    });

    it('mounts the counter and NOT the rail when unfolded', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelectorAll('.kanban-task-counter')).toHaveLength(1);
        expect(container.querySelector('.placeholder-collapsed')).toBeNull();
    });

    it('shows the upstream `count`, which is NOT the rendered card count', () => {
        // The counter binds the collection's `.size`; the WIP marker counts rendered
        // elements. Two different measurements, deliberately two different props.
        const { props } = makeHarness({ overrides: { count: 6 } });
        const { container } = render(<StatusColumn {...props} />);

        expect(restingCounterRow(container).textContent).toBe('6');
    });

    it('renders `count / limit` and `wip-amount` when the status has a limit', () => {
        const { props } = makeHarness({
            overrides: { status: makeStatus({ wip_limit: 4 }), count: 1 },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(mustFind(container, '.animated-counter-inner').getAttribute('class')).toContain(
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

        expect(mustFind(container, '.animated-counter-inner').getAttribute('class')).not.toContain(
            'wip-amount',
        );
        expect(restingCounterRow(container).textContent).toBe('2');
    });

    it('forwards `renderInProgress` as the counter\u2019s `disabled` flag', () => {
        // Disabled freezes the roll machine, so no count is committed and the resting row
        // falls back to 0 -- which is exactly how a suppressed counter is observable.
        const { props } = makeHarness({ overrides: { renderInProgress: true, count: 5 } });
        const { container } = render(<StatusColumn {...props} />);

        expect(restingCounterRow(container).textContent).toBe('0');
    });
});

/* ==========================================================================
 * THE STICKY COUNTER
 * ========================================================================== */

describe('StatusColumn -- the sticky counter', () => {
    it('writes `translateY(<scrollTop>px)` onto the counter as the column scrolls', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const root = column(container);
        root.scrollTop = 40;
        fireEvent.scroll(root);

        expect(mustFind(container, '.kanban-task-counter').style.transform).toBe(
            'translateY(40px)',
        );
    });

    it('tracks every subsequent scroll position, including back to zero', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        const root = column(container);

        root.scrollTop = 120;
        fireEvent.scroll(root);
        expect(mustFind(container, '.kanban-task-counter').style.transform).toBe(
            'translateY(120px)',
        );

        root.scrollTop = 0;
        fireEvent.scroll(root);
        expect(mustFind(container, '.kanban-task-counter').style.transform).toBe('translateY(0px)');
    });

    it('is a no-op while folded, because the counter is not mounted', () => {
        const { props } = makeHarness({ overrides: { folded: true } });
        const { container } = render(<StatusColumn {...props} />);

        const root = column(container);
        root.scrollTop = 40;

        expect((): void => {
            fireEvent.scroll(root);
        }).not.toThrow();
        expect(container.querySelector('.kanban-task-counter')).toBeNull();
    });
});

/* ==========================================================================
 * CHILD 3 -- THE PLACEHOLDER
 * ========================================================================== */

describe('StatusColumn -- the placeholder', () => {
    it('is absent unless `showPlaceholder`', () => {
        const { props } = makeHarness();
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelector('.card-placeholder')).toBeNull();
    });

    it('renders the full skeleton and both paragraphs when nothing is missing', () => {
        const { props } = makeHarness({ overrides: { showPlaceholder: true } });
        const { container } = render(<StatusColumn {...props} />);

        const placeholder = mustFind(container, '.card-placeholder');

        expect(placeholder.classList.contains('not-found')).toBe(false);

        // Every class from `kanban-placeholder.jade` L9-L23, in nesting order.
        expect(placeholder.querySelectorAll('.placeholder-board-card')).toHaveLength(1);
        expect(placeholder.querySelectorAll('.placeholder-board-row')).toHaveLength(3);
        expect(placeholder.querySelectorAll('.placeholder-board-text')).toHaveLength(3);
        expect(placeholder.querySelectorAll('.placeholder-board-text.small')).toHaveLength(1);
        expect(placeholder.querySelectorAll('.placeholder-board-text.big')).toHaveLength(1);
        expect(placeholder.querySelectorAll('.placeholder-board-row.avatar')).toHaveLength(1);
        expect(placeholder.querySelectorAll('.placeholder-board-avatar')).toHaveLength(1);
        expect(placeholder.querySelectorAll('.placeholder-board-user')).toHaveLength(1);
        expect(placeholder.querySelectorAll('.placeholder-titles > .text-small')).toHaveLength(1);
        expect(placeholder.querySelectorAll('.placeholder-titles > .text-large')).toHaveLength(1);
        expect(placeholder.querySelectorAll('.placeholder-avatar > .image')).toHaveLength(1);
        expect(placeholder.querySelectorAll('.placeholder-avatar > .text')).toHaveLength(1);

        const paragraphs = Array.from(placeholder.querySelectorAll('p')).map(
            (node: Element): string | null => node.textContent,
        );

        expect(paragraphs).toEqual(['t(KANBAN.PLACEHOLDER_CARD_TITLE)', 't(KANBAN.PLACEHOLDER_CARD_TEXT)']);
        expect(mustFind(placeholder, 'p.title').textContent).toBe(
            't(KANBAN.PLACEHOLDER_CARD_TITLE)',
        );
    });

    it('switches to the three NOT-FOUND paragraphs, and adds `not-found`, on one flag', () => {
        const { props } = makeHarness({
            overrides: { showPlaceholder: true, notFound: true },
        });
        const { container } = render(<StatusColumn {...props} />);

        const placeholder = mustFind(container, '.card-placeholder');

        expect(placeholder.classList.contains('not-found')).toBe(true);
        expect(placeholder.querySelector('.placeholder-board-card')).toBeNull();
        expect(placeholder.querySelector('.placeholder-titles')).toBeNull();
        expect(placeholder.querySelector('.placeholder-avatar')).toBeNull();

        expect(
            Array.from(placeholder.querySelectorAll('p')).map(
                (node: Element): string | null => node.textContent,
            ),
        ).toEqual([
            't(KANBAN.US_NOT_FOUND_TITLE)',
            't(KANBAN.US_NOT_FOUND_TEXT_P1)',
            't(KANBAN.US_NOT_FOUND_TEXT_P2)',
        ]);
    });

    it('emits NO `<ng-container>` -- drift D16, the fragment substitution', () => {
        const shown = render(
            <StatusColumn {...makeHarness({ overrides: { showPlaceholder: true } }).props} />,
        );
        expect(shown.container.querySelector('ng-container')).toBeNull();

        const notFound = render(
            <StatusColumn
                {...makeHarness({ overrides: { showPlaceholder: true, notFound: true } }).props}
            />,
        );
        expect(notFound.container.querySelector('ng-container')).toBeNull();
    });

    it('renders the placeholder even while folded, letting `.vfold` hide it', () => {
        // `.vfold .card-placeholder { display: none }` already owns the hiding; adding a
        // fold condition here would remove an element the stylesheet only means to hide.
        const { props } = makeHarness({ overrides: { folded: true, showPlaceholder: true } });
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelectorAll('.card-placeholder')).toHaveLength(1);
    });
});

/* ==========================================================================
 * CHILD 4 -- THE CARDS
 * ========================================================================== */

describe('StatusColumn -- the cards', () => {
    it('renders one `<tg-card data-id>` per id, in order', () => {
        const cardIds: readonly number[] = [11, 12, 13];
        const { props } = makeHarness({
            overrides: { cardIds, count: cardIds.length, cardDetails: makeCardDetails(cardIds) },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(cardIdsInDom(container)).toEqual(['11', '12', '13']);
    });

    it('skips an id with no resolved detail rather than throwing', () => {
        const cardIds: readonly number[] = [11, 12, 13];
        const { props } = makeHarness({
            overrides: {
                cardIds,
                count: cardIds.length,
                cardDetails: makeCardDetails([11, 13]),
            },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(cardIdsInDom(container)).toEqual(['11', '13']);
    });

    it('keys cards by user-story id, so reordering MOVES nodes instead of rewriting them', () => {
        const cardIds: readonly number[] = [11, 12];
        const { props } = makeHarness({
            overrides: { cardIds, count: 2, cardDetails: makeCardDetails(cardIds) },
        });
        const { container, rerender } = render(<StatusColumn {...props} />);

        const before = mustFind(container, 'tg-card[data-id="11"]');
        before.dataset.probe = 'kept';

        rerender(<StatusColumn {...props} cardIds={[12, 11]} />);

        expect(cardIdsInDom(container)).toEqual(['12', '11']);
        expect(mustFind(container, 'tg-card[data-id="11"]').dataset.probe).toBe('kept');
    });

    it('marks only the selected story, with BOTH classes the source applies', () => {
        const cardIds: readonly number[] = [11, 12];
        const { props } = makeHarness({
            overrides: {
                cardIds,
                count: 2,
                cardDetails: makeCardDetails(cardIds),
                selectedUss: { 12: true },
            },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).selected).toBe(false);
        expect(lastRecordedFor(12).selected).toBe(true);

        const selected = mustFind(container, 'tg-card[data-id="12"]').getAttribute('class') ?? '';
        expect(selected).toContain('kanban-task-selected');
        expect(selected).toContain('ui-multisortable-multiple');
    });

    it('reports `isFirst` for the first card alone -- the repeat\u2019s `$first`', () => {
        const cardIds: readonly number[] = [11, 12];
        const { props } = makeHarness({
            overrides: { cardIds, count: 2, cardDetails: makeCardDetails(cardIds) },
        });
        render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).isFirst).toBe(true);
        expect(lastRecordedFor(12).isFirst).toBe(false);
    });

    it('applies `kanban-moved` in SWIMLANE mode', () => {
        const { props } = makeHarness({ overrides: { movedUs: [11] } });
        const { container } = render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).moved).toBe(true);
        expect(mustFind(container, 'tg-card[data-id="11"]').getAttribute('class')).toContain(
            'kanban-moved',
        );
    });

    it('FORCES `moved` to false in FLAT mode, whatever `movedUs` holds', () => {
        // The flat markup (`kanban-table.jade` L230) has no `kanban-moved` binding at all.
        const { props } = makeHarness({ overrides: { swimlaneId: undefined, movedUs: [11] } });
        const { container } = render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).moved).toBe(false);
        expect(mustFind(container, 'tg-card[data-id="11"]').getAttribute('class')).not.toContain(
            'kanban-moved',
        );
    });

    it('forwards `onClickMoveToTop` in SWIMLANE mode', () => {
        const onClickMoveToTop = jest.fn<void, [number]>();
        const { props } = makeHarness({ overrides: { onClickMoveToTop } });

        render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).onClickMoveToTop).toBe(onClickMoveToTop);
    });

    it('sends NO move-to-top handler to the card in FLAT mode', () => {
        const onClickMoveToTop = jest.fn<void, [number]>();
        const { props } = makeHarness({
            overrides: { swimlaneId: undefined, onClickMoveToTop },
        });

        render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).onClickMoveToTop).toBeUndefined();
    });

    it('reads each card\u2019s `inViewPort` from the write-once visibility latch', () => {
        const cardIds: readonly number[] = [11, 12];
        const { props } = makeHarness({
            overrides: { cardIds, count: 2, cardDetails: makeCardDetails(cardIds) },
            visibleIds: { 12: true },
        });
        render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).inViewPort).toBe(false);
        expect(lastRecordedFor(12).inViewPort).toBe(true);
    });

    it('never sends `folded` to the card, because the board never binds it', () => {
        const { props } = makeHarness({ overrides: { folded: true } });
        render(<StatusColumn {...props} />);

        expect(lastRecordedFor(11).folded).toBeUndefined();
    });

    it('threads the shared card props through unchanged', () => {
        const cardProps = makeCardProps();
        const { props } = makeHarness({ overrides: { cardProps } });

        render(<StatusColumn {...props} />);

        const recorded = lastRecordedFor(11);

        expect(recorded.project).toBe(cardProps.project);
        expect(recorded.zoom).toBe(cardProps.zoom);
        expect(recorded.zoomLevel).toBe(cardProps.zoomLevel);
        expect(recorded.permissions).toBe(cardProps.permissions);
        expect(recorded.avatars).toBe(cardProps.avatars);
        expect(recorded.onToggleFold).toBe(cardProps.onToggleFold);
        expect(recorded.onClickEdit).toBe(cardProps.onClickEdit);
        expect(recorded.onClickDelete).toBe(cardProps.onClickDelete);
        expect(recorded.onClickAssignedTo).toBe(cardProps.onClickAssignedTo);
        expect(recorded.onToggleSelected).toBe(cardProps.onToggleSelected);
        expect(recorded.translate).toBe(translate);
    });

    it('threads the per-card detail through unchanged', () => {
        const detail = makeCardDetail(11);
        const { props } = makeHarness({ overrides: { cardDetails: { 11: detail } } });

        render(<StatusColumn {...props} />);

        const recorded = lastRecordedFor(11);

        expect(recorded.item).toBe(detail.item);
        expect(recorded.archived).toBe(detail.archived);
        expect(recorded.totalAttachments).toBe(detail.totalAttachments);
    });

    it('renders no card at all for an empty column', () => {
        const { props } = makeHarness({
            overrides: { cardIds: [], count: 0, cardDetails: {} },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelectorAll('tg-card')).toHaveLength(0);
        expect(childOrder(container)).toEqual(['counter']);
    });
});

/* ==========================================================================
 * THE WIP-LIMIT MARKER
 * ========================================================================== */

describe('StatusColumn -- the WIP-limit marker', () => {
    function harnessWith(cardIds: readonly number[], wipLimit: number | null, isArchived = false) {
        return makeHarness({
            overrides: {
                status: makeStatus({ wip_limit: wipLimit, is_archived: isArchived }),
                cardIds,
                count: cardIds.length,
                cardDetails: makeCardDetails(cardIds),
            },
        });
    }

    it('renders `one-left` after the LAST card when one slot remains', () => {
        // The frame's `autem quas / NEW` cell: 2 cards, limit 3.
        const { props } = harnessWith([11, 12], 3);
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual(['counter', 'card:11', 'card:12', 'wip:one-left']);
    });

    it('renders `reached` after the last card when the limit is met', () => {
        // The frame's `hic ut / NEW` cell: 2 cards, limit 2.
        const { props } = harnessWith([11, 12], 2);
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual(['counter', 'card:11', 'card:12', 'wip:reached']);
    });

    it('renders `exceeded` after `cards[wip_limit - 1]`, leaving the surplus below it', () => {
        const { props } = harnessWith([11, 12, 13, 14], 2);
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual([
            'counter',
            'card:11',
            'card:12',
            'wip:exceeded',
            'card:13',
            'card:14',
        ]);
    });

    it('renders NO marker when the status has no limit', () => {
        const { props } = harnessWith([11, 12], null);
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelector('.kanban-wip-limit')).toBeNull();
    });

    it('renders NO marker for an ARCHIVED status, however the counts fall', () => {
        // `if status and not status.is_archived` -- the retired directive never even
        // subscribed for an archived column.
        const { props } = harnessWith([11, 12], 2, true);
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelector('.kanban-wip-limit')).toBeNull();
    });

    it('renders NO marker below the threshold -- the frame\u2019s three unmarked cells', () => {
        // `1 / 4` and `0 / 2` both resolve to no marker, which is why only 2 of the 5
        // limited cells in Figma node 1:7 show a rule.
        const oneOfFour = render(<StatusColumn {...harnessWith([11], 4).props} />);
        expect(oneOfFour.container.querySelector('.kanban-wip-limit')).toBeNull();

        const noneOfTwo = render(<StatusColumn {...harnessWith([], 2).props} />);
        expect(noneOfTwo.container.querySelector('.kanban-wip-limit')).toBeNull();
    });

    it('renders NO marker for a limit of 0, which addresses no card', () => {
        const { props } = harnessWith([11, 12], 0);
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelector('.kanban-wip-limit')).toBeNull();
    });

    it('counts the RENDERED cards, so a skipped id does not shift the threshold', () => {
        // The retired directive counted `$el.find("tg-card")`, i.e. the live DOM.
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

    it('keeps the marker mounted while folded, letting `.vfold` hide it', () => {
        const { props } = makeHarness({
            overrides: {
                status: makeStatus({ wip_limit: 2 }),
                cardIds: [11, 12],
                count: 2,
                cardDetails: makeCardDetails([11, 12]),
                folded: true,
            },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelectorAll('.kanban-wip-limit')).toHaveLength(1);
    });

    it('carries the hardcoded label the source emitted -- drift D5', () => {
        const { props } = harnessWith([11, 12], 2);
        const { container } = render(<StatusColumn {...props} />);

        expect(mustFind(container, '.kanban-wip-limit span').textContent).toBe('WIP Limit');
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
        expect(onIntroShown).toHaveBeenCalledWith(STATUS_ID);
    });

    it('is absent for an ordinary status, and announces nothing', () => {
        const onIntroShown = jest.fn<void, [number]>();
        const { props } = makeHarness({ overrides: { onIntroShown } });
        const { container } = render(<StatusColumn {...props} />);

        expect(container.querySelector('.kanban-column-intro')).toBeNull();
        expect(onIntroShown).not.toHaveBeenCalled();
    });

    it('stays last behind the collapsed rail when an archived column is folded', () => {
        const { props } = makeHarness({
            overrides: { status: makeStatus({ is_archived: true }), folded: true },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual(['rail', 'card:11', 'intro']);
    });
});

/* ==========================================================================
 * THE FULL CHILD ORDER
 * ========================================================================== */

describe('StatusColumn -- child order', () => {
    it('emits all five children in the order the source declares them', () => {
        const { props } = makeHarness({
            overrides: {
                status: makeStatus({ wip_limit: 2, is_archived: false }),
                cardIds: [11, 12],
                count: 2,
                cardDetails: makeCardDetails([11, 12]),
                showPlaceholder: true,
            },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(childOrder(container)).toEqual([
            'counter',
            'placeholder',
            'card:11',
            'card:12',
            'wip:reached',
        ]);
    });
});

/* ==========================================================================
 * VIRTUALISATION REGISTRATION
 * ========================================================================== */

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

    it('registers with `undefined` for the swimlane in FLAT mode -- never 0', () => {
        const { props, viewport } = makeHarness({ overrides: { swimlaneId: undefined } });
        const { container } = render(<StatusColumn {...props} />);

        expect(viewport.registerColumn).toHaveBeenCalledWith(column(container), STATUS_ID, undefined);
    });

    it('registers every rendered card element', () => {
        const cardIds: readonly number[] = [11, 12];
        const { props, viewport } = makeHarness({
            overrides: { cardIds, count: 2, cardDetails: makeCardDetails(cardIds) },
        });
        const { container } = render(<StatusColumn {...props} />);

        expect(viewport.registerCard).toHaveBeenCalledTimes(2);
        expect(viewport.registerCard.mock.calls.map((call: ElementKeyArgs): string | null =>
            call[0].getAttribute('data-id'),
        )).toEqual(['11', '12']);
        expect(viewport.registerCard).toHaveBeenCalledWith(
            mustFind(container, 'tg-card[data-id="11"]'),
            STATUS_ID,
            SWIMLANE_ID,
        );
    });

    it('registers nothing for a card element without `data-id`, because none exists', () => {
        // The selector is `tg-card[data-id]`: the card always emits the attribute, and
        // without it `entry.target.dataset.id` would be NaN and virtualisation would
        // silently never fire.
        const { props, viewport } = makeHarness();
        render(<StatusColumn {...props} />);

        expect(viewport.registerCard).toHaveBeenCalledTimes(1);
        expect(viewport.registerCard.mock.calls[0]?.[0].hasAttribute('data-id')).toBe(true);
    });

    it('unregisters the column and every card on unmount', () => {
        const cardIds: readonly number[] = [11, 12];
        const { props, viewport } = makeHarness({
            overrides: { cardIds, count: 2, cardDetails: makeCardDetails(cardIds) },
        });
        const { unmount } = render(<StatusColumn {...props} />);

        unmount();

        expect(viewport.unregisterColumn).toHaveBeenCalledTimes(1);
        expect(viewport.unregisterColumn).toHaveBeenCalledWith(STATUS_ID, SWIMLANE_ID);
        expect(viewport.unregisterCard).toHaveBeenCalledTimes(2);
    });

    it('re-registers the cards when the id list changes, and only then', () => {
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
        // rather than on its stable callbacks would tear down every registration.
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
});

/* ==========================================================================
 * THE TRANSIENT `new` FLASH
 * ========================================================================== */

describe('StatusColumn -- the `new` flash', () => {
    it('is absent until a drop lands', () => {
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

    it('removes `new` on `animationend` and reports back EXACTLY ONCE', () => {
        // jsdom never fires `animationend` by itself, so it is dispatched here -- which
        // is also the only way the one-shot `.one()` semantics can be checked.
        const onNewAnimationEnd = jest.fn<void, []>();
        const { props } = makeHarness({
            overrides: { justDropped: true, onNewAnimationEnd },
        });
        const { container } = render(<StatusColumn {...props} />);

        fireEvent.animationEnd(column(container));

        expect(rootClasses(container)).not.toContain('new');
        expect(onNewAnimationEnd).toHaveBeenCalledTimes(1);

        fireEvent.animationEnd(column(container));

        expect(onNewAnimationEnd).toHaveBeenCalledTimes(1);
    });

    it('does not re-add `new` on a later re-render while the flag stays raised', () => {
        const { props } = makeHarness({ overrides: { justDropped: true } });
        const { container, rerender } = render(<StatusColumn {...props} />);

        fireEvent.animationEnd(column(container));
        expect(rootClasses(container)).not.toContain('new');

        rerender(<StatusColumn {...props} justDropped isDropTarget />);

        expect(rootClasses(container)).not.toContain('new');
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
});

/* ==========================================================================
 * MEMOISATION AND THE PUBLIC SURFACE
 * ========================================================================== */

describe('StatusColumn -- memoisation and the public surface', () => {
    it('is memoised, and named for the React devtools', () => {
        expect(StatusColumn.displayName).toBe('StatusColumn');
    });

    it('does not re-render when its owner re-renders with identical props', () => {
        // Not an ornament: `../shared/dnd` decorates this element imperatively while a
        // gesture is in flight, and a re-render rewrites `class` wholesale.
        const { props } = makeHarness();

        function Owner(): ReactElement {
            const [, setTick] = useState<number>(0);

            return (
                <div>
                    <button
                        type="button"
                        onClick={(): void => {
                            setTick((tick: number): number => tick + 1);
                        }}
                    >
                        tick
                    </button>
                    <StatusColumn {...props} />
                </div>
            );
        }

        const { container } = render(createElement(Owner));
        const renderCount = recordedCardProps.length;

        fireEvent.click(mustFind(container, 'button'));

        expect(recordedCardProps).toHaveLength(renderCount);
    });
});
