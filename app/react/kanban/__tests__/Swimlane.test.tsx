/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Swimlane.test.tsx — browserless Jest + jsdom render spec for the single Kanban
 * swimlane row component `../components/Swimlane` (its `Swimlane` export) plus the
 * sibling `SwimlaneAddLink` "create more swimlanes" admin anchor.
 *
 * WHAT THIS SPEC PROVES (the swimlane's OWN logic — NOT the column internals)
 *   1. Title bar (`button.kanban-swimlane-title`): the `unclassified-swimlane`
 *      modifier + the `.unclassified-us-info` help tooltip (with its literal
 *      English copy) appear ONLY for the synthetic unclassified row
 *      (`swimlane.id === -1`); a normal row shows neither and renders its name;
 *      the `folded` modifier reflects the `folded` prop.
 *   2. The `.default-swimlane` star badge appears ONLY when this row is the
 *      project's default (`swimlane.id === project.default_swimlane`) AND the
 *      board has more than one swimlane. IMPORTANT — the component reads the total
 *      swimlane count from `project.swimlanes.length` (there is NO `swimlaneCount`
 *      prop on `Swimlane`), so these specs drive the count by setting a
 *      `project.swimlanes` array of the desired length (verified against the
 *      authored component: `((project as any).swimlanes?.length ?? 0) > 1`).
 *   3. When NOT folded the row maps EXACTLY one `<TaskboardColumn>` per status,
 *      in order, inside `.kanban-table-body > .kanban-table-inner`; when folded the
 *      columns region is not rendered at all.
 *   4. `SwimlaneAddLink` renders the admin anchor ONLY when
 *      `swimlaneCount > 0 && project.i_am_admin && swimlaneCount <= 1`, with the
 *      exact power-ups href and copy; it returns `null` in every other branch.
 *
 * Behaviour is ported from the legacy AngularJS partial
 * `app/partials/includes/modules/kanban-table.jade` and the CoffeeScript module
 * `app/coffee/modules/kanban/main.coffee` (the swimlane directive / controller);
 * those legacy sources are READ-ONLY references and are NEVER imported here.
 *
 * TEST-LAYER CONSTRAINTS (shared by every `app/react/kanban/__tests__/**` spec):
 *   - `.tsx` using the JSX automatic runtime (`jsx: "react-jsx"` in the root
 *     `tsconfig.json`), so there is intentionally NO `import React`.
 *   - The jest-dom matchers (`toBeInTheDocument`, `toHaveAttribute`,
 *     `toHaveClass`, `toHaveTextContent`, `toBeEmptyDOMElement`, …) are registered
 *     globally by the Jest `setupFilesAfterEnv: ['@testing-library/jest-dom']`
 *     hook and typed via the `tsconfig` `types` array, so `@testing-library/jest-dom`
 *     is NOT imported. Likewise the Jest globals (`describe`/`it`/`expect`/`jest`)
 *     are ambient (via `@types/jest`) and are NOT imported.
 *   - No immutable / dragula / dom-autoscroller / checksley / jquery / angular /
 *     @playwright / app-coffee imports, no network, no real browser.
 *
 * WHY THE `TaskboardColumn` CHILD IS MOCKED
 *   `Swimlane` renders one full `<TaskboardColumn>` tree per status. To keep this
 *   spec focused on the swimlane's own logic (title / tooltip / star / column
 *   count + order) and independent of the large column DOM, `../components/TaskboardColumn`
 *   is mocked to a trivial stub that surfaces just the two props this spec
 *   asserts: the status id it received (`data-status-id`) and the swimlane id it
 *   was handed in swimlane mode (`data-swimlane-id`). The `jest.mock` factory
 *   returns JSX — legal in a `.tsx` under the automatic runtime (no `import React`
 *   needed) — and is declared BEFORE importing the component under test so ts-jest
 *   hoists it above that import.
 */

jest.mock('../components/TaskboardColumn', () => ({
    // Minimal stub standing in for the real `TaskboardColumn`. It surfaces exactly
    // the two prop facets this swimlane spec asserts, as string data-* attributes:
    //   • data-status-id   — `props.status.id` (one column is mapped per status)
    //   • data-swimlane-id — `props.swimlaneId` (Swimlane always mounts columns in
    //                        swimlane mode, forwarding its own id)
    TaskboardColumn: (props: { status?: { id?: number }; swimlaneId?: number | null }) => (
        <div
            data-testid="column"
            data-status-id={String(props.status?.id)}
            data-swimlane-id={String(props.swimlaneId)}
        />
    ),
}));

import { fireEvent, render, screen, within } from '@testing-library/react';

import { Swimlane, SwimlaneAddLink } from '../components/Swimlane';
import type { SwimlaneProps } from '../components/Swimlane';
import { makeStatus, makeSwimlane, makeProject } from './factories';

/* ========================================================================== *
 * Shared render helpers
 * ========================================================================== */

/**
 * Build a COMPLETE, type-safe {@link SwimlaneProps} object with neutral defaults
 * (a normal swimlane, no statuses, not folded, empty forwarded maps) and
 * `jest.fn()` callbacks. Because `TaskboardColumn` is mocked, none of the
 * forwarded board data/flags affect what this spec asserts — they exist only to
 * satisfy the component's (strict) required props. Individual specs override only
 * the fields they exercise via the shallow-merge `overrides` argument (caller
 * values win).
 */
function baseProps(overrides: Partial<SwimlaneProps> = {}): SwimlaneProps {
    return {
        swimlane: makeSwimlane(),
        statuses: [],
        project: makeProject(),
        folded: false,
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
        ...overrides,
    };
}

/**
 * Render `Swimlane` with `baseProps(overrides)` and return the RTL utils plus the
 * resolved `props` and the swimlane ROOT element. `Swimlane` renders a single
 * root `<div class="kanban-swimlane">`, so `container.firstElementChild` is that
 * root.
 */
function renderSwimlane(overrides: Partial<SwimlaneProps> = {}) {
    const props = baseProps(overrides);
    const utils = render(<Swimlane {...props} />);
    const root = utils.container.firstElementChild as HTMLElement;

    return { ...utils, props, root };
}

/** The title bar button — always the single `button.kanban-swimlane-title`. */
function titleOf(root: HTMLElement): HTMLElement {
    return root.querySelector('.kanban-swimlane-title') as HTMLElement;
}

/* ========================================================================== *
 * 1. Swimlane title — unclassified modifier + tooltip, normal name, folded
 * ========================================================================== */

describe('Swimlane title', () => {
    it('unclassified row (id === -1): title carries `unclassified-swimlane` and shows the help tooltip copy', () => {
        const { root } = renderSwimlane({
            swimlane: makeSwimlane({ id: -1, name: 'Unclassified user stories' }),
        });

        // The title button gets the `unclassified-swimlane` modifier.
        expect(titleOf(root)).toHaveClass('kanban-swimlane-title', 'unclassified-swimlane');

        // The help tooltip is present ONLY for the unclassified row and carries the
        // exact shipped English of `KANBAN.UNCLASSIFIED_USER_STORIES_TOOLTIP`.
        const info = root.querySelector('.unclassified-us-info');
        expect(info).toBeInTheDocument();
        expect(info).toHaveTextContent(
            'The user stories that are not part of any swimlane are here.',
        );
    });

    it('normal row: NO `unclassified-swimlane`, NO tooltip, and the name is rendered', () => {
        const { root } = renderSwimlane({
            swimlane: makeSwimlane({ id: 10, name: 'Swimlane A' }),
        });

        expect(titleOf(root)).not.toHaveClass('unclassified-swimlane');
        expect(root.querySelector('.unclassified-us-info')).not.toBeInTheDocument();

        // The swimlane name renders inside `h2.title-name`.
        expect(root.querySelector('.title-name')).toHaveTextContent('Swimlane A');
    });

    it('reflects `folded` on the title button', () => {
        const foldedRoot = renderSwimlane({ folded: true }).root;
        expect(titleOf(foldedRoot)).toHaveClass('folded');

        const openRoot = renderSwimlane({ folded: false }).root;
        expect(titleOf(openRoot)).not.toHaveClass('folded');
    });
});

/* ========================================================================== *
 * 1b. Title interactions — "events up" (the title bar emits intent only)
 * ========================================================================== *
 * `Swimlane` is a pure presentational leaf: it holds no fold state and merely
 * EMITS intent through its `on*` callbacks (see the component header). These
 * specs assert the title bar forwards click/hover to the right callback with the
 * swimlane id, and that the OPTIONAL hover callbacks are safely no-ops when the
 * container omits them (the `?.` optional-chaining guards).
 */

describe('title interactions', () => {
    it('clicking the title emits `onToggleSwimlane` with the swimlane id', () => {
        const { root, props } = renderSwimlane({ swimlane: makeSwimlane({ id: 42 }) });

        fireEvent.click(titleOf(root));

        expect(props.onToggleSwimlane).toHaveBeenCalledTimes(1);
        expect(props.onToggleSwimlane).toHaveBeenCalledWith(42);
    });

    it('hovering the title emits the optional `onMouseOverSwimlane` / `onMouseLeaveSwimlane` with the id', () => {
        const onMouseOverSwimlane = jest.fn();
        const onMouseLeaveSwimlane = jest.fn();
        const { root } = renderSwimlane({
            swimlane: makeSwimlane({ id: 7 }),
            onMouseOverSwimlane,
            onMouseLeaveSwimlane,
        });

        fireEvent.mouseOver(titleOf(root));
        expect(onMouseOverSwimlane).toHaveBeenCalledWith(7);

        fireEvent.mouseLeave(titleOf(root));
        expect(onMouseLeaveSwimlane).toHaveBeenCalledWith(7);
    });

    it('hovering the title does NOT throw when the optional hover callbacks are omitted', () => {
        // `baseProps` deliberately leaves `onMouseOver/LeaveSwimlane` undefined, so
        // this exercises the `?.` short-circuit (the undefined branch).
        const { root } = renderSwimlane();

        expect(() => {
            fireEvent.mouseOver(titleOf(root));
            fireEvent.mouseLeave(titleOf(root));
        }).not.toThrow();
    });
});

/* ========================================================================== *
 * 2. default-swimlane star — default match AND more than one swimlane
 * ========================================================================== *
 * The component derives the total swimlane count from `project.swimlanes.length`
 * (NOT a prop on `Swimlane`), so the count is driven by the `swimlanes` array
 * length on the project fixture.
 */

describe('default-swimlane star', () => {
    it('present when this row is the project default AND there is more than one swimlane', () => {
        const { root } = renderSwimlane({
            swimlane: makeSwimlane({ id: 10 }),
            // default_swimlane matches the row id; swimlanes.length === 2 (> 1).
            project: makeProject({ default_swimlane: 10, swimlanes: [{}, {}] }),
        });

        expect(root.querySelector('.default-swimlane')).toBeInTheDocument();
    });

    it('absent when the board has only one swimlane (count === 1)', () => {
        const { root } = renderSwimlane({
            swimlane: makeSwimlane({ id: 10 }),
            // default matches, but swimlanes.length === 1 (not > 1).
            project: makeProject({ default_swimlane: 10, swimlanes: [{}] }),
        });

        expect(root.querySelector('.default-swimlane')).not.toBeInTheDocument();
    });

    it('absent when this row is NOT the project default', () => {
        const { root } = renderSwimlane({
            swimlane: makeSwimlane({ id: 10 }),
            // default_swimlane differs from the row id, even with count > 1.
            project: makeProject({ default_swimlane: 999, swimlanes: [{}, {}] }),
        });

        expect(root.querySelector('.default-swimlane')).not.toBeInTheDocument();
    });
});

/* ========================================================================== *
 * 2b. F-UI-02 — icons render through the shared `<tg-svg>` sprite primitive
 * ========================================================================== */

describe('F-UI-02 sprite icons (shared TgSvg)', () => {
    it('unfolded row renders the unfold icon as `<tg-svg class="unfold-action"><svg class="icon icon-unfolded-swimlane"><use/></svg>`', () => {
        const { root } = renderSwimlane({
            swimlane: makeSwimlane({ id: 10 }),
            folded: false,
        });

        // The retained SCSS targets `tg-svg.unfold-action` + `svg.icon`
        // (`app/styles/modules/kanban/kanban-table.scss`), so the host must be the
        // real `tg-svg` TAG carrying a `class` attribute (NOT a `classname`), and
        // the sprite must be referenced via `<use href="#…">` — an empty span
        // would paint nothing.
        const host = root.querySelector('tg-svg.unfold-action');
        expect(host).not.toBeNull();
        const svg = host?.querySelector('svg.icon.icon-unfolded-swimlane');
        expect(svg).not.toBeNull();
        const use = svg?.querySelector('use');
        expect(use).not.toBeNull();
        expect(use?.getAttribute('href') ?? use?.getAttribute('xlink:href')).toBe(
            '#icon-unfolded-swimlane',
        );
    });

    it('folded row swaps to the folded icon via the same shared primitive', () => {
        const { root } = renderSwimlane({
            swimlane: makeSwimlane({ id: 10 }),
            folded: true,
        });

        expect(root.querySelector('tg-svg.unfold-action')).toBeNull();
        const host = root.querySelector('tg-svg.fold-action');
        expect(host).not.toBeNull();
        expect(
            host?.querySelector('svg.icon.icon-folded-swimlane'),
        ).not.toBeNull();
    });
});

/* ========================================================================== *
 * 3. columns mapping — one <TaskboardColumn> per status, only when unfolded
 * ========================================================================== */

describe('columns mapping', () => {
    it('unfolded: renders one column per status, in order, inside `.kanban-table-body .kanban-table-inner`', () => {
        const { root } = renderSwimlane({
            swimlane: makeSwimlane({ id: 10 }),
            statuses: [makeStatus({ id: 100 }), makeStatus({ id: 200 }), makeStatus({ id: 300 })],
            folded: false,
        });

        // Columns live inside `.kanban-table-body > .kanban-table-inner`.
        const inner = root.querySelector('.kanban-table-body .kanban-table-inner') as HTMLElement;
        expect(inner).toBeInTheDocument();

        const columns = within(inner).getAllByTestId('column');
        expect(columns).toHaveLength(3);

        // Exactly one column per status, in the supplied order, each forwarded this
        // swimlane's id (swimlane mode).
        expect(columns.map((c) => c.getAttribute('data-status-id'))).toEqual(['100', '200', '300']);
        columns.forEach((c) => expect(c).toHaveAttribute('data-swimlane-id', '10'));
    });

    it('folded: the columns region is NOT rendered and no columns exist', () => {
        const { root } = renderSwimlane({
            statuses: [makeStatus({ id: 100 }), makeStatus({ id: 200 }), makeStatus({ id: 300 })],
            folded: true,
        });

        expect(root.querySelector('.kanban-table-body')).not.toBeInTheDocument();
        expect(within(root).queryAllByTestId('column')).toHaveLength(0);
    });
});

/* ========================================================================== *
 * 4. SwimlaneAddLink visibility — admin gate + at-most-one-swimlane gate
 * ========================================================================== */

describe('SwimlaneAddLink visibility', () => {
    it('renders the admin anchor when swimlaneCount === 1 and the user is admin', () => {
        render(
            <SwimlaneAddLink
                project={makeProject({ i_am_admin: true, slug: 'proj' })}
                swimlaneCount={1}
            />,
        );

        const link = screen.getByRole('link');
        expect(link).toHaveAttribute(
            'href',
            '/project/proj/admin/project-values/kanban-power-ups',
        );
        expect(link).toHaveTextContent('Create more swimlanes');
    });

    it('returns null when swimlaneCount === 0', () => {
        const { container } = render(
            <SwimlaneAddLink project={makeProject({ i_am_admin: true })} swimlaneCount={0} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('returns null when swimlaneCount > 1', () => {
        const { container } = render(
            <SwimlaneAddLink project={makeProject({ i_am_admin: true })} swimlaneCount={2} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('returns null when the user is not a project admin', () => {
        const { container } = render(
            <SwimlaneAddLink project={makeProject({ i_am_admin: false })} swimlaneCount={1} />,
        );

        expect(container).toBeEmptyDOMElement();
    });
});
