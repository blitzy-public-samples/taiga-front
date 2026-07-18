/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SquishColumn.test.tsx — browserless Jest + jsdom render spec for the two
 * squish/fold-column presentational components exported by
 * `../components/SquishColumn`:
 *
 *   1. {@link SquishColumnPlaceholder} — the collapsed-column BODY placeholder
 *      (`.placeholder-collapsed`) rendered while a status column is folded.
 *   2. {@link SquishColumnToggle} — the board-HEADER fold/unfold buttons.
 *
 * Behaviour parity is verified against the legacy AngularJS squish-column
 * directive (`app/coffee/modules/kanban/main.coffee`, the
 * `KanbanSquishColumnDirective` + the `div.options` block of
 * `kanban-table.jade`). Those legacy sources are READ-ONLY references and are
 * NEVER imported here.
 *
 * TEST-LAYER CONSTRAINTS (shared by every `app/react/kanban/__tests__/**` spec):
 *   - `.tsx` with the JSX automatic runtime (`jsx: "react-jsx"` in the root
 *     `tsconfig.json`), so there is intentionally NO `import React`.
 *   - The jest-dom matchers (`toBeInTheDocument`, `toHaveClass`, `toHaveStyle`,
 *     `toHaveTextContent`, …) are registered globally by the Jest
 *     `setupFilesAfterEnv: ['@testing-library/jest-dom']` hook and typed via the
 *     `tsconfig` `types` array, so `@testing-library/jest-dom` is NOT imported
 *     here. Likewise the Jest globals (`describe`/`it`/`expect`/`jest`) are
 *     ambient (via `@types/jest`) and are NOT imported.
 *   - Only three modules are imported: `@testing-library/react`, the component
 *     under test, and the shared test-data factory. No immutable / dragula /
 *     dom-autoscroller / checksley / jquery / angular / @playwright / app-coffee
 *     imports, no network, and no real browser.
 *
 * DELIBERATE DEVIATION FROM THE RECORDED PROMPT CONTRACT (documented per the
 * "align to the ACTUAL component" hard constraint):
 *   The recorded contract summarised `SquishColumnToggle` for an archived status
 *   as "renders nothing" (`container.firstChild === null`). The ACTUAL component
 *   ALWAYS renders the fold button and gates ONLY the `.hunfold` unfold button
 *   behind `!status.is_archived` (see `SquishColumn.tsx`, lines ~198-218). The
 *   final suite below therefore asserts the REAL behaviour — archived columns
 *   keep the fold button but omit the unfold button — rather than the inaccurate
 *   "renders nothing" summary, so the spec passes green against the real code.
 */

import { render, screen, fireEvent } from '@testing-library/react';

import { SquishColumnPlaceholder, SquishColumnToggle } from '../components/SquishColumn';
import { makeStatus } from './factories';

/* ========================================================================== *
 * SquishColumnPlaceholder — non-archived column
 * ========================================================================== */

describe('SquishColumnPlaceholder — non-archived', () => {
    it('renders the .placeholder-collapsed wrapper structure', () => {
        const status = makeStatus({ is_archived: false, name: 'New', color: '#ff0000' });
        const { container } = render(<SquishColumnPlaceholder status={status} count={5} />);

        expect(container.querySelector('.placeholder-collapsed')).toBeInTheDocument();
        expect(container.querySelector('.placeholder-collapsed-wrapper')).toBeInTheDocument();
    });

    it('shows the [sic] .ammount counter with the count and a .vertical element', () => {
        const status = makeStatus({ is_archived: false, name: 'New', color: '#ff0000' });
        const { container } = render(<SquishColumnPlaceholder status={status} count={5} />);

        // NOTE: the class is intentionally the misspelled `ammount` — the legacy
        // SCSS class name is preserved verbatim for visual fidelity.
        const ammount = container.querySelector('.ammount');
        expect(ammount).toBeInTheDocument();
        expect(ammount).toHaveTextContent('5');
        expect(container.querySelector('.vertical')).toBeInTheDocument();
    });

    it('renders .text-holder with the status .name and no Archived label', () => {
        const status = makeStatus({ is_archived: false, name: 'New', color: '#ff0000' });
        const { container } = render(<SquishColumnPlaceholder status={status} count={5} />);

        expect(container.querySelector('.text-holder')).toBeInTheDocument();
        expect(container.querySelector('.name')).toHaveTextContent('New');
        // The Archived label is shown ONLY for archived columns.
        expect(container.querySelector('.archived')).not.toBeInTheDocument();
    });

    it('paints the .square-color with the status colour', () => {
        const status = makeStatus({ is_archived: false, name: 'New', color: '#ff0000' });
        const { container } = render(<SquishColumnPlaceholder status={status} count={5} />);

        const square = container.querySelector('.square-color');
        expect(square).toBeInTheDocument();
        // jsdom normalises the inline hex colour to its rgb() form; jest-dom's
        // toHaveStyle normalises both operands so the hex literal still matches.
        expect(square).toHaveStyle({ backgroundColor: '#ff0000' });
    });
});

/* ========================================================================== *
 * SquishColumnPlaceholder — archived column
 * ========================================================================== */

describe('SquishColumnPlaceholder — archived', () => {
    it('shows the Archived label, hides the counter, and keeps the name', () => {
        const status = makeStatus({ is_archived: true, name: 'Done' });
        const { container } = render(<SquishColumnPlaceholder status={status} count={7} />);

        const archived = container.querySelector('.archived');
        expect(archived).toBeInTheDocument();
        expect(archived).toHaveTextContent('Archived');

        // The counter block is suppressed for archived columns.
        expect(container.querySelector('.ammount')).not.toBeInTheDocument();
        expect(container.querySelector('.vertical')).not.toBeInTheDocument();

        // The name and colour square are still shown.
        expect(container.querySelector('.name')).toHaveTextContent('Done');
        expect(container.querySelector('.square-color')).toBeInTheDocument();
    });
});

/* ========================================================================== *
 * SquishColumnToggle — non-archived fold/unfold buttons
 * ========================================================================== */

describe('SquishColumnToggle — non-archived fold/unfold', () => {
    it('folded=false: fold button visible, unfold (.hunfold) button hidden', () => {
        const status = makeStatus({ is_archived: false });
        render(<SquishColumnToggle status={status} folded={false} onToggleFold={() => undefined} />);

        const foldBtn = screen.getByTitle('Fold');
        expect(foldBtn).toHaveClass('btn-board', 'option');
        expect(foldBtn).not.toHaveClass('hidden');

        const unfoldBtn = screen.getByTitle('Unfold');
        expect(unfoldBtn).toHaveClass('btn-board', 'option', 'hunfold');
        expect(unfoldBtn).toHaveClass('hidden');
    });

    it('folded=true: fold button hidden, unfold (.hunfold) button visible', () => {
        const status = makeStatus({ is_archived: false });
        render(<SquishColumnToggle status={status} folded={true} onToggleFold={() => undefined} />);

        const foldBtn = screen.getByTitle('Fold');
        expect(foldBtn).toHaveClass('btn-board', 'option');
        expect(foldBtn).toHaveClass('hidden');

        const unfoldBtn = screen.getByTitle('Unfold');
        expect(unfoldBtn).toHaveClass('btn-board', 'option', 'hunfold');
        expect(unfoldBtn).not.toHaveClass('hidden');
    });

    it('invokes onToggleFold(status) when either button is clicked', () => {
        const onToggleFold = jest.fn();
        const status = makeStatus({ is_archived: false });
        render(<SquishColumnToggle status={status} folded={false} onToggleFold={onToggleFold} />);

        fireEvent.click(screen.getByTitle('Fold'));
        expect(onToggleFold).toHaveBeenCalledTimes(1);
        expect(onToggleFold).toHaveBeenCalledWith(status);

        fireEvent.click(screen.getByTitle('Unfold'));
        expect(onToggleFold).toHaveBeenCalledTimes(2);
        expect(onToggleFold).toHaveBeenLastCalledWith(status);
    });
});

/* ========================================================================== *
 * SquishColumnToggle — archived column
 *
 * DEVIATION (see file header): the archived column keeps the fold button and
 * omits ONLY the `.hunfold` unfold button — it does NOT render nothing. The
 * archived unfold/hide affordance lives in `ArchivedStatusHeader.tsx`.
 * ========================================================================== */

describe('SquishColumnToggle — archived (fold button only, no unfold)', () => {
    it('renders the fold button, omits the .hunfold unfold button, and still emits onToggleFold', () => {
        const onToggleFold = jest.fn();
        const status = makeStatus({ is_archived: true });
        const { container } = render(
            <SquishColumnToggle status={status} folded={false} onToggleFold={onToggleFold} />,
        );

        // The fold button is rendered for archived columns too.
        const foldBtn = screen.getByTitle('Fold');
        expect(foldBtn).toBeInTheDocument();
        expect(foldBtn).toHaveClass('btn-board', 'option');

        // The unfold (.hunfold) button is suppressed for archived columns.
        expect(screen.queryByTitle('Unfold')).not.toBeInTheDocument();
        expect(container.querySelector('.hunfold')).not.toBeInTheDocument();

        // Clicking the fold button still signals the user's toggle intent.
        fireEvent.click(foldBtn);
        expect(onToggleFold).toHaveBeenCalledTimes(1);
        expect(onToggleFold).toHaveBeenCalledWith(status);
    });
});
