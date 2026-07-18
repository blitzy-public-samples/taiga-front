/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * TaskboardColumn.test.tsx — browserless Jest + jsdom render spec for the single
 * Kanban status-column body component `../components/TaskboardColumn`.
 *
 * WHAT THIS SPEC PROVES (the column's OWN logic — not the card internals)
 *   1. `data-status` is emitted on EVERY column; `data-swimlane` is emitted ONLY
 *      in swimlane mode (`swimlaneId != null`) — the hard cross-folder contract
 *      the sibling `../dnd/KanbanDndContext` relies on to compute the drop target.
 *   2. The story counter (`.kanban-task-counter`) and the collapsed placeholder
 *      (`.placeholder-collapsed`, from `SquishColumnPlaceholder`) are mutually
 *      exclusive, switched by `folded`.
 *   3. The empty-board / not-found skeleton (`.card-placeholder`, plus the
 *      `.not-found` variant) renders exactly when `showPlaceholder` /
 *      `notFoundUserstories` say so.
 *   4. Each `cardIds` entry renders one card, in order, and the single WIP-limit
 *      marker (`.kanban-wip-limit`) is interleaved immediately AFTER the card at
 *      `computeWipLimit(status, cardIds.length).afterIndex` — and is ABSENT when
 *      the column has no positive `wip_limit`.
 *   5. The `moved` flag and the `onClickMoveToTop` callback are wired onto cards
 *      ONLY in swimlane mode.
 *   6. `ArchivedStatusIntro` (`.kanban-column-intro`) is rendered as the LAST
 *      child of an archived column.
 *
 * Behaviour is ported from the legacy AngularJS partial
 * `app/partials/includes/modules/kanban-table.jade` and the CoffeeScript module
 * `app/coffee/modules/kanban/main.coffee` (the `KanbanWipLimitDirective` etc.);
 * those legacy sources are READ-ONLY references and are NEVER imported here.
 *
 * TEST-LAYER CONSTRAINTS (shared by every `app/react/kanban/__tests__/**` spec):
 *   - `.tsx` using the JSX automatic runtime (`jsx: "react-jsx"` in the root
 *     `tsconfig.json`), so there is intentionally NO `import React`.
 *   - The jest-dom matchers (`toBeInTheDocument`, `toHaveAttribute`,
 *     `toHaveClass`, …) are registered globally by the Jest
 *     `setupFilesAfterEnv: ['@testing-library/jest-dom']` hook and typed via the
 *     `tsconfig` `types` array, so `@testing-library/jest-dom` is NOT imported.
 *     Likewise the Jest globals (`describe`/`it`/`expect`/`jest`) are ambient
 *     (via `@types/jest`) and are NOT imported.
 *   - No immutable / dragula / dom-autoscroller / checksley / jquery / angular /
 *     @playwright / app-coffee imports, no network, no real browser.
 *
 * WHY THE `Card` CHILD IS MOCKED
 *   `TaskboardColumn` maps each card id to a full `Card` tree. To keep this spec
 *   focused on the column's own logic (data attributes, WIP interleave position,
 *   counter/placeholder, swimlane-only wiring) and independent of the large Card
 *   DOM, `../components/Card` is mocked to a trivial stub that surfaces just the
 *   props this spec asserts: the card id (`data-card-id`), the `moved` flag
 *   (`data-moved`) and whether a move-to-top handler was supplied
 *   (`data-has-movetotop`). `WipLimit` (whose real `computeWipLimit` drives the
 *   interleave under test), `SquishColumnPlaceholder` and `ArchivedStatusIntro`
 *   are deliberately NOT mocked so their real DOM is exercised.
 *
 * The `jest.mock` factory returns JSX, which is legal in a `.tsx` under the
 * automatic runtime (no `import React` needed); it is declared BEFORE importing
 * the component under test so ts-jest hoists it above that import.
 */

jest.mock('../components/Card', () => ({
    // A minimal stub standing in for the real `Card`. It surfaces exactly the
    // three prop facets this column spec asserts, as string data-* attributes:
    //   • data-card-id       — `props.item.id` (the ordered card id)
    //   • data-moved         — `props.moved` boolean (swimlane-only `kanban-moved`)
    //   • data-has-movetotop — whether `props.onClickMoveToTop` was supplied
    //                          (swimlane-only wiring)
    Card: (props: {
        item?: { id?: number };
        moved?: boolean;
        onClickMoveToTop?: unknown;
    }) => (
        <div
            data-testid="card"
            data-card-id={String(props.item?.id)}
            data-moved={String(!!props.moved)}
            data-has-movetotop={String(!!props.onClickMoveToTop)}
        />
    ),
}));

import { render, within } from '@testing-library/react';

import { TaskboardColumn } from '../components/TaskboardColumn';
import type { TaskboardColumnProps } from '../components/TaskboardColumn';
import {
    makeStatus,
    makeProject,
    makeUserStory,
    makeBoardCard,
    makeUsMap,
} from './factories';

/* ========================================================================== *
 * Shared render helpers
 * ========================================================================== */

/**
 * Build a COMPLETE, type-safe {@link TaskboardColumnProps} object with neutral
 * defaults (no cards, not folded, no placeholder, flat/no-swimlane mode) and
 * `jest.fn()` callbacks. Individual specs override only the fields they exercise
 * via the shallow-merge `overrides` argument (caller values win).
 */
function baseProps(overrides: Partial<TaskboardColumnProps> = {}): TaskboardColumnProps {
    return {
        status: makeStatus(),
        swimlaneId: null,
        cardIds: [],
        usMap: {},
        project: makeProject(),
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
        ...overrides,
    };
}

/**
 * Render `TaskboardColumn` with `baseProps(overrides)` and return the RTL utils
 * plus the resolved `props` and the column ROOT element. `TaskboardColumn`
 * renders a single root `<div>`, so `container.firstElementChild` is that root.
 */
function renderColumn(overrides: Partial<TaskboardColumnProps> = {}) {
    const props = baseProps(overrides);
    const utils = render(<TaskboardColumn {...props} />);
    const root = utils.container.firstElementChild as HTMLElement;

    return { ...utils, props, root };
}

/**
 * Build an ordered list of derived {@link makeBoardCard} cards whose ids (and
 * whose `model.id`) equal the supplied ids, so `makeUsMap` keys them predictably
 * and the mocked card stub's `data-card-id` matches the ordered id.
 */
function makeCards(ids: number[]) {
    return ids.map((id) => makeBoardCard({ model: makeUserStory({ id }) }));
}

/**
 * Convenience: the ordered `data-card-id` values of every rendered card stub
 * inside `root`, in document order.
 */
function cardIdOrder(root: HTMLElement): string[] {
    return within(root)
        .getAllByTestId('card')
        .map((stub) => stub.getAttribute('data-card-id') ?? '');
}

/* ========================================================================== *
 * 1. data-status (always) / data-swimlane (swimlane mode only) + root id
 * ========================================================================== */

describe('data-status / data-swimlane', () => {
    it('flat mode: sets data-status and omits data-swimlane entirely', () => {
        const status = makeStatus({ id: 100 });
        const { root } = renderColumn({ status, swimlaneId: null });

        expect(root).toHaveAttribute('data-status', '100');
        // `data-swimlane` must be ABSENT (not just empty) in no-swimlane mode.
        expect(root).not.toHaveAttribute('data-swimlane');
    });

    it('swimlane mode: sets both data-status and data-swimlane (as strings)', () => {
        const status = makeStatus({ id: 100 });
        const { root } = renderColumn({ status, swimlaneId: 10 });

        expect(root).toHaveAttribute('data-status', '100');
        expect(root).toHaveAttribute('data-swimlane', '10');
    });

    it('roots the column at id `column-${status.id}`', () => {
        const status = makeStatus({ id: 42 });
        const { root } = renderColumn({ status });

        expect(root).toHaveAttribute('id', 'column-42');
        // The fixed base class the unchanged SCSS keys off is always present.
        expect(root).toHaveClass('kanban-uses-box', 'taskboard-column');
    });
});

/* ========================================================================== *
 * 2. counter (not folded) XOR collapsed placeholder (folded)
 * ========================================================================== */

describe('counter vs placeholder', () => {
    it('folded=false renders the counter and NOT the collapsed placeholder', () => {
        const { root } = renderColumn({ folded: false });

        expect(root.querySelector('.kanban-task-counter')).toBeInTheDocument();
        expect(root.querySelector('.placeholder-collapsed')).not.toBeInTheDocument();
    });

    it('folded=true renders the collapsed placeholder and NOT the counter', () => {
        const { root } = renderColumn({ folded: true });

        // `.placeholder-collapsed` comes from the real (un-mocked)
        // `SquishColumnPlaceholder`.
        expect(root.querySelector('.placeholder-collapsed')).toBeInTheDocument();
        expect(root.querySelector('.kanban-task-counter')).not.toBeInTheDocument();
    });
});

/* ========================================================================== *
 * 3. empty-board / not-found card placeholder
 * ========================================================================== */

describe('card placeholder', () => {
    it('showPlaceholder + !notFound: renders .card-placeholder without .not-found', () => {
        const { root } = renderColumn({ showPlaceholder: true, notFoundUserstories: false });

        const placeholder = root.querySelector('.card-placeholder');
        expect(placeholder).toBeInTheDocument();
        expect(placeholder).not.toHaveClass('not-found');
    });

    it('showPlaceholder + notFound: renders .card-placeholder.not-found', () => {
        const { root } = renderColumn({ showPlaceholder: true, notFoundUserstories: true });

        const placeholder = root.querySelector('.card-placeholder');
        expect(placeholder).toBeInTheDocument();
        expect(placeholder).toHaveClass('not-found');
    });

    it('showPlaceholder=false: renders no .card-placeholder', () => {
        const { root } = renderColumn({ showPlaceholder: false });

        expect(root.querySelector('.card-placeholder')).not.toBeInTheDocument();
    });
});


/* ========================================================================== *
 * 4. ordered cards + interleaved WIP-limit marker
 * ========================================================================== */

describe('cards + WIP interleave', () => {
    it('renders one card stub per id, in the supplied order', () => {
        const ids = [1, 2, 3];
        const usMap = makeUsMap(makeCards(ids));
        const status = makeStatus({ wip_limit: 3, is_archived: false });

        const { root } = renderColumn({ status, cardIds: ids, usMap });

        const stubs = within(root).getAllByTestId('card');
        expect(stubs).toHaveLength(3);
        expect(cardIdOrder(root)).toEqual(['1', '2', '3']);
    });

    it('interleaves the `reached` WIP badge immediately AFTER the last card (afterIndex:2)', () => {
        const ids = [1, 2, 3];
        const usMap = makeUsMap(makeCards(ids));
        // wip_limit:3 with 3 cards -> computeWipLimit returns { className:'reached',
        // afterIndex:2 }, so the marker is rendered after the card at index 2.
        const status = makeStatus({ wip_limit: 3, is_archived: false });

        const { root } = renderColumn({ status, cardIds: ids, usMap });

        const badge = root.querySelector('.kanban-wip-limit');
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveClass('reached');
        // The real (un-mocked) WipLimit renders its literal label.
        expect(badge).toHaveTextContent('WIP Limit');

        // Card + badge nodes, in document order. querySelectorAll preserves the
        // rendered order, so the badge (the last node) must directly follow the
        // 3rd card (afterIndex:2).
        const nodes = Array.from(
            root.querySelectorAll('[data-testid="card"], .kanban-wip-limit'),
        );
        const badgeIndex = nodes.findIndex((n) => n.classList.contains('kanban-wip-limit'));
        const lastCardIndex = nodes.findIndex(
            (n) => n.getAttribute('data-card-id') === '3',
        );
        expect(badgeIndex).toBeGreaterThan(lastCardIndex);
        // It is the final interleaved node (nothing renders between card 3 and it).
        expect(badgeIndex).toBe(nodes.length - 1);
        expect(lastCardIndex).toBe(nodes.length - 2);
    });

    it('renders NO WIP badge when wip_limit is null, regardless of card count', () => {
        const ids = [1, 2, 3, 4, 5];
        const usMap = makeUsMap(makeCards(ids));
        const status = makeStatus({ wip_limit: null, is_archived: false });

        const { root } = renderColumn({ status, cardIds: ids, usMap });

        expect(root.querySelector('.kanban-wip-limit')).not.toBeInTheDocument();
        // Sanity: every card still renders even without a WIP marker.
        expect(within(root).getAllByTestId('card')).toHaveLength(5);
    });
});

/* ========================================================================== *
 * 5. swimlane-only `moved` / `onClickMoveToTop` wiring
 * ========================================================================== */

describe('swimlane-only wiring', () => {
    it('flat mode: cards get NO move-to-top handler and moved=false (even with movedUs set)', () => {
        const ids = [1, 2, 3];
        const usMap = makeUsMap(makeCards(ids));

        const { root } = renderColumn({
            swimlaneId: null,
            cardIds: ids,
            usMap,
            movedUs: [2],
            onClickMoveToTop: jest.fn(),
        });

        for (const stub of within(root).getAllByTestId('card')) {
            // Difference #3: move-to-top + kanban-moved are suppressed in no-swimlane mode.
            expect(stub).toHaveAttribute('data-has-movetotop', 'false');
            expect(stub).toHaveAttribute('data-moved', 'false');
        }
    });

    it('swimlane mode: cards get the move-to-top handler and moved reflects movedUs membership', () => {
        const ids = [1, 2, 3];
        const usMap = makeUsMap(makeCards(ids));

        const { root } = renderColumn({
            swimlaneId: 10,
            cardIds: ids,
            usMap,
            movedUs: [2],
            onClickMoveToTop: jest.fn(),
        });

        const byId = (id: string): HTMLElement =>
            within(root)
                .getAllByTestId('card')
                .find((stub) => stub.getAttribute('data-card-id') === id) as HTMLElement;

        // Every card is wired with the move-to-top handler in swimlane mode.
        for (const stub of within(root).getAllByTestId('card')) {
            expect(stub).toHaveAttribute('data-has-movetotop', 'true');
        }

        // `moved` is true only for the card whose id is in `movedUs`.
        expect(byId('2')).toHaveAttribute('data-moved', 'true');
        expect(byId('1')).toHaveAttribute('data-moved', 'false');
        expect(byId('3')).toHaveAttribute('data-moved', 'false');
    });
});

/* ========================================================================== *
 * 6. archived-column intro spacer (last child)
 * ========================================================================== */

describe('archived intro', () => {
    it('renders ArchivedStatusIntro (.kanban-column-intro) as the LAST child of an archived column', () => {
        const status = makeStatus({ is_archived: true });

        const { root } = renderColumn({ status });

        const intro = root.querySelector('.kanban-column-intro');
        expect(intro).toBeInTheDocument();
        // It is the final child of the column, matching the legacy Jade order.
        expect(root.lastElementChild).toBe(intro);
    });

    it('renders NO .kanban-column-intro for a non-archived column', () => {
        const status = makeStatus({ is_archived: false });

        const { root } = renderColumn({ status });

        expect(root.querySelector('.kanban-column-intro')).not.toBeInTheDocument();
    });
});

