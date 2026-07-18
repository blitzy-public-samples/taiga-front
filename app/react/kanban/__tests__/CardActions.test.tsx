/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * CardActions.test.tsx — browserless Jest + jsdom render spec for the Kanban
 * `CardActions` component (`../components/CardActions`): the card "actions"
 * trigger button and the popover menu it opens.
 *
 * WHAT IS UNDER TEST
 *   `CardActions` is the React 18 port of the AngularJS `tgCardActions`
 *   directive (`CardActionsDirective` in
 *   `app/coffee/modules/kanban/main.coffee:1018-1125` — READ-ONLY behavioural
 *   reference, never imported here) together with the `taiga.globalPopover`
 *   menu it launched. Behaviour is reproduced EXACTLY under the Minimal Change
 *   Clause, so these specs lock in the observable behaviours the directive
 *   produced:
 *     1. Render GATE — the whole control renders `null` unless the board is
 *        zoomed in (`zoomLevel > 0`) AND the current user can modify OR delete
 *        user stories on the project
 *        (`can(project,'modify_us') || can(project,'delete_us')`).
 *     2. POPOVER open/close — clicking the `.js-popup-button` trigger portals a
 *        `.popover.global-popover` menu into `document.body` (so card overflow
 *        never clips it) and adds the `popover-open` class to the trigger; the
 *        menu dismisses on a re-click, on an outside `mousedown`, and on a
 *        capture-phase `scroll`, clearing `popover-open` each time.
 *     3. MENU ITEMS by permission — the permission-ordered action list is
 *        rebuilt on every render: `modify_us` yields "Edit card" + "Assign To";
 *        `delete_us` yields "Delete card"; and `modify_us && !isFirst` yields
 *        "Move to top" (the first card suppresses it, mirroring `$first`).
 *     4. ACTION callbacks — activating each menu item invokes the matching
 *        `onClick*` prop with the card id (`item.id`); the React port normalises
 *        all four callbacks to be id-based (the legacy directive passed the
 *        whole item to `onClickMoveToTop`).
 *
 * PERMISSION MODEL (driven by the REAL helper, never mocked)
 *   `CardActions` gates on `can(project, perm)` from `../../shared/permissions`,
 *   which is a pure function returning `true` when `project.my_permissions`
 *   contains `perm`. These specs therefore control the gate purely by building
 *   projects with the right permission codes via
 *   `makeProject({ my_permissions: [...] })`. The factory default deliberately
 *   OMITS `modify_us`/`delete_us`, so the "no permission" case is the default.
 *   No permission mock exists (and none is needed — the helper touches no
 *   browser/network dependency).
 *
 * HARD CONSTRAINTS (shared by every kanban `__tests__` spec)
 *   - License header first (above).
 *   - `.tsx` compiled with the `jsx: "react-jsx"` automatic runtime, so there
 *     is deliberately NO `import React`.
 *   - No `@testing-library/jest-dom` import and no `describe`/`it`/`expect`/
 *     `jest` import: the Jest globals are ambient (tsconfig `types`) and the
 *     jest-dom matchers are registered globally by `jest.config.js`
 *     (`setupFilesAfterEnv`).
 *   - `isolatedModules` is on, so any type-only import would use `import type`
 *     (there are none here — only value imports).
 *   - Only three modules may be imported: `@testing-library/react`, the
 *     component under test, and the shared `./factories`. NO immutable /
 *     dragula / dom-autoscroller / checksley / jquery / angular /
 *     @playwright/test / app-coffee imports; no network; no real browser.
 *   - React Testing Library auto-cleanup unmounts every render between tests,
 *     so the popover's `document`-level dismiss listeners never leak across
 *     specs.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';

import { CardActions } from '../components/CardActions';
import { makeBoardCard, makeUserStory, makeProject } from './factories';

/* -------------------------------------------------------------------------- *
 * Shared helpers
 *
 * The trigger button carries no text (only an SVG icon), so it is located by
 * its stable `.js-popup-button` class rather than by role/name. The popover is
 * portaled to `document.body`, so it is located there — never inside the RTL
 * `container` — which also proves the `createPortal` escape hatch is in use.
 * -------------------------------------------------------------------------- */

/** Return the actions trigger button rendered inside the RTL container. */
function getTrigger(container: HTMLElement): HTMLElement {
    return container.querySelector('button.js-popup-button') as HTMLElement;
}

/** Return the portaled popover menu root, or `null` when the menu is closed. */
function queryPopover(): HTMLElement | null {
    return document.body.querySelector('.popover.global-popover');
}

/** Click the trigger open and return the (asserted-present) popover root. */
function openPopover(container: HTMLElement): HTMLElement {
    const trigger = getTrigger(container);
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger);

    const popover = queryPopover();
    expect(popover).not.toBeNull();
    return popover as HTMLElement;
}

/* ========================================================================== *
 * describe('gate')
 * ------------------------------------------------------------------------
 * Nothing renders unless `zoomLevel > 0` AND the user can modify OR delete
 * user stories. Both negative branches must mount NO DOM at all.
 * ========================================================================== */
describe('gate', () => {
    it('renders nothing when zoomLevel is 0, even with full permissions', () => {
        // Full modify + delete permissions, but a zoomed-out board (level 0)
        // still suppresses the control entirely — the zoom gate wins.
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['modify_us', 'delete_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={0} />,
        );

        // The component returns `null`, so React mounts no DOM in the container
        // and nothing (trigger or portaled popover) leaks into document.body.
        expect(container.firstChild).toBeNull();
        expect(document.body.querySelector('.card-actions')).toBeNull();
        expect(queryPopover()).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders nothing without modify_us or delete_us permission (default project)', () => {
        // The default project grants only `view_us`; with neither `modify_us`
        // nor `delete_us` the permission half of the gate is false.
        const item = makeBoardCard();

        const { container } = render(
            <CardActions item={item} project={makeProject()} zoomLevel={1} />,
        );

        expect(container.firstChild).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders the .js-popup-button trigger with modify_us at zoomLevel 1', () => {
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['modify_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={1} />,
        );

        const trigger = getTrigger(container);
        expect(trigger).toBeInTheDocument();
        // The menu is closed until the trigger is clicked.
        expect(trigger).not.toHaveClass('popover-open');
        expect(queryPopover()).toBeNull();
    });

    it('renders the trigger with only delete_us at zoomLevel 1 (gate is modify OR delete)', () => {
        // Proves the gate uses OR: `delete_us` alone is sufficient to show the
        // control even without `modify_us`.
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['delete_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={1} />,
        );

        expect(getTrigger(container)).toBeInTheDocument();
    });
});

/* ========================================================================== *
 * describe('popover open/close')
 * ------------------------------------------------------------------------
 * The menu is portaled to `document.body` on open and torn down on every
 * dismiss path; the `.popover-open` class on the trigger tracks the open state
 * exactly as the directive's addClass/removeClass('popover-open') did.
 * ========================================================================== */
describe('popover open/close', () => {
    it('opens the .popover.global-popover portal into document.body and toggles .popover-open', () => {
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['modify_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={1} />,
        );

        const trigger = getTrigger(container);

        // Closed initially: no popover in the body and no open-state class.
        expect(queryPopover()).toBeNull();
        expect(trigger).not.toHaveClass('popover-open');

        fireEvent.click(trigger);

        // Open: the popover exists in document.body (NOT inside the RTL
        // container — proving the createPortal escape hatch), and the trigger
        // gains the `popover-open` class.
        const popover = queryPopover();
        expect(popover).toBeInTheDocument();
        expect(container.querySelector('.popover.global-popover')).toBeNull();
        expect(trigger).toHaveClass('popover-open');
    });

    it('closes the popover when the trigger is clicked again', () => {
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['modify_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={1} />,
        );

        const trigger = getTrigger(container);
        fireEvent.click(trigger);
        expect(queryPopover()).toBeInTheDocument();

        // Re-clicking the trigger toggles the menu closed.
        fireEvent.click(trigger);
        expect(queryPopover()).toBeNull();
        expect(trigger).not.toHaveClass('popover-open');
    });

    it('dismisses on an outside mousedown on document', () => {
        // The globalPopover plugin dismissed on any pointer press outside the
        // button and the menu; the React port registers a document-level
        // `mousedown` listener while open. A press on document.body is outside
        // both, so it closes the menu.
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['modify_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={1} />,
        );

        const trigger = getTrigger(container);
        fireEvent.click(trigger);
        expect(queryPopover()).toBeInTheDocument();

        fireEvent.mouseDown(document.body);

        expect(queryPopover()).toBeNull();
        expect(trigger).not.toHaveClass('popover-open');
    });

    it('dismisses on a capture-phase scroll', () => {
        // Mirrors `document.addEventListener('scroll', close, true)` — scrolling
        // any ancestor closes the menu. Dispatching a scroll on `document`
        // triggers the capture-phase listener at target.
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['modify_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={1} />,
        );

        const trigger = getTrigger(container);
        fireEvent.click(trigger);
        expect(queryPopover()).toBeInTheDocument();

        fireEvent.scroll(document);

        expect(queryPopover()).toBeNull();
        expect(trigger).not.toHaveClass('popover-open');
    });
});

/* ========================================================================== *
 * describe('menu items by permission')
 * ------------------------------------------------------------------------
 * The action list is rebuilt from the `can(...)` gates in a fixed order:
 *   modify_us            -> "Edit card" + "Assign To"
 *   delete_us            -> "Delete card"
 *   modify_us && !isFirst -> "Move to top"
 * Each item is a `<button>` scoped to the portaled popover; queries use
 * `within(popover)` so the (text-less) trigger button is never matched.
 * ========================================================================== */
describe('menu items by permission', () => {
    it('modify_us, not first: shows Edit, Assign To and Move to top; hides Delete', () => {
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['modify_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={1} isFirst={false} />,
        );

        const menu = within(openPopover(container));
        expect(menu.getByRole('button', { name: /edit card/i })).toBeInTheDocument();
        expect(menu.getByRole('button', { name: /assign to/i })).toBeInTheDocument();
        expect(menu.getByRole('button', { name: /move to top/i })).toBeInTheDocument();
        // `delete_us` is absent, so no delete entry.
        expect(menu.queryByRole('button', { name: /delete card/i })).toBeNull();
    });

    it('modify_us, first card: suppresses Move to top but keeps Edit and Assign To', () => {
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['modify_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={1} isFirst />,
        );

        const menu = within(openPopover(container));
        expect(menu.getByRole('button', { name: /edit card/i })).toBeInTheDocument();
        expect(menu.getByRole('button', { name: /assign to/i })).toBeInTheDocument();
        // `$first` disables "Move to top" for the first card.
        expect(menu.queryByRole('button', { name: /move to top/i })).toBeNull();
    });

    it('delete_us only: shows Delete; hides Edit, Assign To and Move to top', () => {
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['delete_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={1} isFirst={false} />,
        );

        const menu = within(openPopover(container));
        expect(menu.getByRole('button', { name: /delete card/i })).toBeInTheDocument();
        // The modify-gated entries stay hidden without `modify_us`.
        expect(menu.queryByRole('button', { name: /edit card/i })).toBeNull();
        expect(menu.queryByRole('button', { name: /assign to/i })).toBeNull();
        expect(menu.queryByRole('button', { name: /move to top/i })).toBeNull();
    });

    it('modify_us + delete_us, not first: shows all four items', () => {
        const item = makeBoardCard();
        const project = makeProject({ my_permissions: ['modify_us', 'delete_us'] });

        const { container } = render(
            <CardActions item={item} project={project} zoomLevel={1} isFirst={false} />,
        );

        const menu = within(openPopover(container));
        expect(menu.getByRole('button', { name: /edit card/i })).toBeInTheDocument();
        expect(menu.getByRole('button', { name: /assign to/i })).toBeInTheDocument();
        expect(menu.getByRole('button', { name: /delete card/i })).toBeInTheDocument();
        expect(menu.getByRole('button', { name: /move to top/i })).toBeInTheDocument();
    });
});

/* ========================================================================== *
 * describe('action callbacks')
 * ------------------------------------------------------------------------
 * Activating a menu item fires the matching `onClick*` prop with the card id
 * (`item.id`, normalised to a number for all four handlers) and then closes the
 * menu. The card id is fixed at 42 (derived from `model.id`) so the argument
 * assertion is unambiguous.
 * ========================================================================== */
describe('action callbacks', () => {
    it('fires onClickEdit with item.id and closes the menu when Edit is clicked', () => {
        const onClickEdit = jest.fn();
        const item = makeBoardCard({ model: makeUserStory({ id: 42 }) });
        const project = makeProject({ my_permissions: ['modify_us'] });

        const { container } = render(
            <CardActions
                item={item}
                project={project}
                zoomLevel={1}
                isFirst={false}
                onClickEdit={onClickEdit}
            />,
        );

        const menu = within(openPopover(container));
        fireEvent.click(menu.getByRole('button', { name: /edit card/i }));

        expect(onClickEdit).toHaveBeenCalledTimes(1);
        expect(onClickEdit).toHaveBeenCalledWith(42);
        // Selecting an action dismisses the popover.
        expect(queryPopover()).toBeNull();
    });

    it('fires onClickAssignedTo with item.id when Assign To is clicked', () => {
        const onClickAssignedTo = jest.fn();
        const item = makeBoardCard({ model: makeUserStory({ id: 42 }) });
        const project = makeProject({ my_permissions: ['modify_us'] });

        const { container } = render(
            <CardActions
                item={item}
                project={project}
                zoomLevel={1}
                isFirst={false}
                onClickAssignedTo={onClickAssignedTo}
            />,
        );

        const menu = within(openPopover(container));
        fireEvent.click(menu.getByRole('button', { name: /assign to/i }));

        expect(onClickAssignedTo).toHaveBeenCalledTimes(1);
        expect(onClickAssignedTo).toHaveBeenCalledWith(42);
    });

    it('fires onClickDelete with item.id when Delete is clicked (needs delete_us)', () => {
        const onClickDelete = jest.fn();
        const item = makeBoardCard({ model: makeUserStory({ id: 42 }) });
        const project = makeProject({ my_permissions: ['delete_us'] });

        const { container } = render(
            <CardActions
                item={item}
                project={project}
                zoomLevel={1}
                isFirst={false}
                onClickDelete={onClickDelete}
            />,
        );

        const menu = within(openPopover(container));
        fireEvent.click(menu.getByRole('button', { name: /delete card/i }));

        expect(onClickDelete).toHaveBeenCalledTimes(1);
        expect(onClickDelete).toHaveBeenCalledWith(42);
    });

    it('fires onClickMoveToTop with item.id when Move to top is clicked (needs modify_us && !isFirst)', () => {
        const onClickMoveToTop = jest.fn();
        const item = makeBoardCard({ model: makeUserStory({ id: 42 }) });
        const project = makeProject({ my_permissions: ['modify_us'] });

        const { container } = render(
            <CardActions
                item={item}
                project={project}
                zoomLevel={1}
                isFirst={false}
                onClickMoveToTop={onClickMoveToTop}
            />,
        );

        const menu = within(openPopover(container));
        fireEvent.click(menu.getByRole('button', { name: /move to top/i }));

        expect(onClickMoveToTop).toHaveBeenCalledTimes(1);
        // The React port passes item.id (a number), not the whole item, to
        // onClickMoveToTop — the one contract change documented in the component.
        expect(onClickMoveToTop).toHaveBeenCalledWith(42);
    });
});

