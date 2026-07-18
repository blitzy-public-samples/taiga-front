/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * ArchivedStatus.test.tsx — browserless Jest + jsdom render spec for the two
 * archived-status Kanban components:
 *
 *   - `ArchivedStatusHeader` (`../components/ArchivedStatusHeader`)
 *   - `ArchivedStatusIntro`  (`../components/ArchivedStatusIntro`)
 *
 * These React components port the AngularJS archived-status directives from
 * `app/coffee/modules/kanban/main.coffee` (`tgKanbanArchivedShowStatusHeader`,
 * lines 723-748, and `tgKanbanArchivedStatusIntro`, lines 754-770) together with
 * the archived unfold button + intro spacer declared in
 * `app/partials/includes/modules/kanban-table.jade`. Those legacy sources are
 * treated as READ-ONLY behavioural references and are NEVER imported here.
 *
 * WHAT THIS SPEC PROVES
 *   1. `ArchivedStatusHeader` fires `onMountArchived(status)` EXACTLY ONCE after
 *      mount and never re-fires it across re-renders — the React equivalent of
 *      the directive's one-time (post-initial-load) `addArchivedStatus` +
 *      `hideStatus` registration, enforced by a `useRef` guard.
 *   2. The hosting `button.btn-board.option.hunfold` carries the `hidden` class
 *      only when the column is NOT folded (`ng-class='{hidden:!folds[s.id]}'`),
 *      i.e. `folded={false}` => `.hidden`, `folded={true}` => no `.hidden`.
 *   3. A single click fires BOTH `onToggleFold(status)` (host `foldStatus(s)`)
 *      and `onShowArchived(status)` (the guarded broadcast + `showStatus`), each
 *      once with the status.
 *   4. `ArchivedStatusIntro` renders exactly one empty `div.kanban-column-intro`
 *      spacer, invariant of any `status` prop.
 *
 * TEST-LAYER ISOLATION (hard constraints — identical to every kanban __tests__ spec)
 *   - `.tsx` using the automatic JSX runtime (`jsx: "react-jsx"`), so there is
 *     deliberately NO `import React`.
 *   - jest globals (`describe`/`it`/`expect`/`jest`) and the extended jest-dom
 *     matchers (`toHaveClass`, `toBeInTheDocument`) are AMBIENT — provided by the
 *     root `tsconfig.json` `types` and `jest.config.js` `setupFilesAfterEnv` —
 *     so neither `@testing-library/jest-dom` nor the jest globals are imported.
 *   - Only `@testing-library/react`, the two components under test, and the
 *     shared `./factories` builder are imported. No immutable/dragula/
 *     dom-autoscroller/checksley/jquery/angular/@playwright/test imports, no
 *     network access, and no real browser. Kept Node v16.19.1 compatible.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { ArchivedStatusHeader } from '../components/ArchivedStatusHeader';
import { ArchivedStatusIntro } from '../components/ArchivedStatusIntro';
import { makeStatus } from './factories';

describe('ArchivedStatusHeader — mount-once onMountArchived', () => {
    it('fires onMountArchived exactly once with the status and never re-fires on re-render', () => {
        const onMountArchived = jest.fn();
        // An archived column ("Archived") — the only kind the parent renders this
        // control for (the legacy `ng-if="s.is_archived"`).
        const status = makeStatus({ is_archived: true, name: 'Archived' });

        const { rerender } = render(
            <ArchivedStatusHeader
                status={status}
                folded={true}
                onMountArchived={onMountArchived}
            />,
        );

        // Registered exactly once, with the archived status, right after mount.
        expect(onMountArchived).toHaveBeenCalledTimes(1);
        expect(onMountArchived).toHaveBeenCalledWith(status);

        // Force a re-render with CHANGED props (folded flips true -> false). The
        // `useRef` guard must keep the mount callback pinned at a single call,
        // reproducing the directive's `$watch` + `unwatch()` "run once" semantics.
        rerender(
            <ArchivedStatusHeader
                status={status}
                folded={false}
                onMountArchived={onMountArchived}
            />,
        );

        expect(onMountArchived).toHaveBeenCalledTimes(1);
    });
});

describe('ArchivedStatusHeader — folded class + toggle/show', () => {
    it('does NOT add .hidden to the unfold button when folded=true', () => {
        const status = makeStatus({ is_archived: true });

        render(<ArchivedStatusHeader status={status} folded={true} />);

        const button = screen.getByRole('button');
        // The shape/classes match the source template's unfold button exactly.
        expect(button).toHaveClass('btn-board', 'option', 'hunfold');
        // Visible (not hidden) precisely because the column IS folded.
        expect(button).not.toHaveClass('hidden');
    });

    it('adds .hidden to the unfold button when folded=false', () => {
        const status = makeStatus({ is_archived: true });

        render(<ArchivedStatusHeader status={status} folded={false} />);

        const button = screen.getByRole('button');
        expect(button).toHaveClass('btn-board', 'option', 'hunfold');
        // Hidden because the column is NOT folded (`ng-class='{hidden:!folds[s.id]}'`).
        expect(button).toHaveClass('hidden');
    });

    it('fires onToggleFold and onShowArchived once each with the status on click', () => {
        const status = makeStatus({ is_archived: true });
        const onToggleFold = jest.fn();
        const onShowArchived = jest.fn();

        render(
            <ArchivedStatusHeader
                status={status}
                folded={true}
                onToggleFold={onToggleFold}
                onShowArchived={onShowArchived}
            />,
        );

        fireEvent.click(screen.getByRole('button'));

        // The source element carried BOTH `ng-click='foldStatus(s)'` and the
        // directive's own show-archived click handler, so one click did both.
        expect(onToggleFold).toHaveBeenCalledTimes(1);
        expect(onToggleFold).toHaveBeenCalledWith(status);
        expect(onShowArchived).toHaveBeenCalledTimes(1);
        expect(onShowArchived).toHaveBeenCalledWith(status);
    });
});

describe('ArchivedStatusIntro', () => {
    it('renders a single empty .kanban-column-intro spacer div', () => {
        const { container } = render(<ArchivedStatusIntro />);

        const intro = container.querySelector('.kanban-column-intro');
        expect(intro).toBeInTheDocument();
        // The spacer is the sole rendered node and is a <div>.
        expect(container.firstChild).toBe(intro);
        expect((intro as HTMLElement).tagName).toBe('DIV');
        // Byte-for-byte equivalent of the legacy empty host element: no children
        // and no text content — its entire appearance comes from the SCSS class.
        expect(intro?.childNodes.length).toBe(0);
        expect(intro?.textContent).toBe('');
    });

    it('renders the same empty spacer even when a status prop is provided', () => {
        const status = makeStatus({ is_archived: true, name: 'Archived' });

        const { container } = render(<ArchivedStatusIntro status={status} />);

        const intro = container.querySelector('.kanban-column-intro');
        expect(intro).toBeInTheDocument();
        // Output is invariant of the status prop (the legacy template emitted a
        // single empty `div.kanban-column-intro` regardless of the status).
        expect(intro?.childNodes.length).toBe(0);
        expect(intro?.textContent).toBe('');
    });
});
