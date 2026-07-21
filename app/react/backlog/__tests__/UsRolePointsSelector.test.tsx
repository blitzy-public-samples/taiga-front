/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest (jsdom) render spec for the Backlog `UsRolePointsSelector`
 * (`../components/UsRolePointsSelector`).
 *
 * WHAT IS UNDER TEST
 *   `UsRolePointsSelector` is the React port of the AngularJS
 *   `tgUsRolePointsSelector` directive (`app/coffee/modules/backlog/main.coffee`
 *   `UsRolePointsSelectorDirective`, original lines ~995-1054) together with its
 *   popover template (`app/partials/backlog/us-role-points-popover.jade`). It is
 *   the points-column HEADER role FILTER: it lists the project's *computable*
 *   roles and lets the user pick which role's points every backlog row should
 *   display. It is pure/presentational — no @dnd-kit, no fetch, no WebSocket — so
 *   no `<DndContext>` wrapper is required.
 *
 * RECONCILED-AGAINST-ACTUAL (mandatory)
 *   The authored component was opened first and this spec asserts ITS contract,
 *   which differs from the file summary's "recorded" contract:
 *     - Props are `{ project, selectedRoleId, onSelectRole }` — the SELECTED ROLE
 *       is a controlled prop lifted to `BacklogTable`. There is NO `us` prop, NO
 *       `onSelectPoints(roleId, pointsId)` callback, and NO `editable`/`modify_us`
 *       gate. The selection callback is `onSelectRole(roleId | null)`:
 *       a role id selects that role, `null` clears the filter.
 *     - Because there is no permission/`editable` gate on the authored component,
 *       the "editable gating" scenario is intentionally OMITTED (there is nothing
 *       to gate). The component is NOT modified in any way by this spec.
 *   Behavioural parity with the AngularJS directive is preserved: the directive's
 *   `uspoints:select` broadcast maps to `onSelectRole(role.id)` and its
 *   `uspoints:clear-selection` broadcast maps to `onSelectRole(null)`; the
 *   `numberOfRoles > 1` gate maps to `hasSelector`.
 *
 * CONVENTIONS (enforced for this folder)
 *   - jsdom environment (configured centrally in `jest.config.js`); no
 *     `@jest-environment` docblock.
 *   - No `import React` — the project uses the automatic `jsx: "react-jsx"`
 *     runtime.
 *   - `describe` / `it` / `expect` / `jest` are Jest globals (typed via
 *     `@types/jest`) and are NOT imported.
 *   - `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveClass`,
 *     `toHaveTextContent`) are registered globally by the Jest `setupFilesAfterEnv`
 *     entry and are NOT imported here.
 *   - Fixtures are built exclusively with the shared `./factories` builders; no
 *     `jest.mock`, no network, no fetch, no WebSocket. Role/point configuration is
 *     controlled purely through `makeProject({ roles })` overrides.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';

import { UsRolePointsSelector } from '../components/UsRolePointsSelector';
import { makeProject } from './factories';

import type { Project } from '../../shared/types';

/* ========================================================================== *
 * Test helpers
 * ========================================================================== */

/**
 * Render the selector with the three controlled props. Returns the standard
 * Testing Library result so callers can reach into `container` for the
 * class-based queries the SCSS-faithful markup relies on.
 */
function renderSelector(
  project: Project,
  selectedRoleId: number | null,
  onSelectRole: (roleId: number | null) => void,
) {
  return render(
    <UsRolePointsSelector
      project={project}
      selectedRoleId={selectedRoleId}
      onSelectRole={onSelectRole}
    />,
  );
}

/** Resolve the always-present `.inner` root, throwing if the markup changed. */
function getRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('.inner');
  if (!root) {
    throw new Error('Expected the `.inner` root element to be rendered');
  }
  return root;
}

/** Resolve the `.header-points` label, throwing if the markup changed. */
function getHeader(container: HTMLElement): HTMLElement {
  const header = container.querySelector<HTMLElement>('.header-points');
  if (!header) {
    throw new Error('Expected the `.header-points` label to be rendered');
  }
  return header;
}

/** Nullable lookup of the role popover — used for presence/absence assertions. */
function queryPopover(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.popover.pop-role');
}

/** Non-null lookup of the role popover for `within(...)` scoping. */
function getPopover(container: HTMLElement): HTMLElement {
  const popover = queryPopover(container);
  if (!popover) {
    throw new Error('Expected the `.popover.pop-role` element to be rendered');
  }
  return popover;
}

/** Open the popover by clicking the interactive header label. */
function openPopover(container: HTMLElement): void {
  fireEvent.click(getHeader(container));
}

/* ========================================================================== *
 * Specs
 * ========================================================================== */

describe('UsRolePointsSelector', () => {
  describe('computable-role filtering', () => {
    it('lists only computable roles, excluding the non-computable "Design"', () => {
      // Default project: Back + Front are computable, Design is not.
      const { container } = renderSelector(makeProject(), null, jest.fn());

      openPopover(container);
      const popover = getPopover(container);

      // dest#CRITICAL popover-visibility fix: the shared `popover` SCSS mixin
      // declares `display:none`; the legacy jQuery `.popover().open()` revealed
      // it via `fadeIn()` (an inline `display:block`). Assert the component now
      // sets that inline reveal itself (jsdom reflects inline styles only).
      expect(popover.style.display).toBe('block');

      // The two computable roles are present…
      expect(within(popover).getByText('Back')).toBeInTheDocument();
      expect(within(popover).getByText('Front')).toBeInTheDocument();
      // …and the non-computable role is filtered out entirely.
      expect(within(popover).queryByText('Design')).toBeNull();

      // Exactly one `.role` anchor per computable role (Back, Front).
      expect(container.querySelectorAll('.popover.pop-role a.role')).toHaveLength(2);
    });
  });

  describe('hasSelector threshold', () => {
    it('is interactive when more than one computable role exists', () => {
      // Default project has two computable roles -> hasSelector === true.
      const { container } = renderSelector(makeProject(), null, jest.fn());

      // The header is clickable (no `not-clickable` modifier)…
      expect(getHeader(container)).not.toHaveClass('not-clickable');
      // …the filter affordance is shown…
      expect(container.querySelector('.icon-filter')).toBeInTheDocument();

      // …and clicking the header opens the popover.
      openPopover(container);
      expect(queryPopover(container)).toBeInTheDocument();
    });

    it('is inert with a single computable role (not-clickable, no icon, no popover)', () => {
      const project = makeProject({
        roles: [{ id: 1, name: 'Back', slug: 'back', computable: true, order: 1 }],
      });
      const { container } = renderSelector(project, null, jest.fn());

      // A single computable role -> hasSelector === false.
      expect(getHeader(container)).toHaveClass('not-clickable');
      expect(container.querySelector('.icon-filter')).not.toBeInTheDocument();

      // The header has no click handler, so "clicking" it opens nothing.
      openPopover(container);
      expect(queryPopover(container)).toBeNull();
    });

    it('is inert when there are zero computable roles', () => {
      // Only a non-computable role -> the computable filter yields an empty list.
      const project = makeProject({
        roles: [{ id: 3, name: 'Design', slug: 'design', computable: false, order: 3 }],
      });
      const { container } = renderSelector(project, null, jest.fn());

      expect(getHeader(container)).toHaveClass('not-clickable');
      expect(container.querySelector('.icon-filter')).not.toBeInTheDocument();
    });

    it('is inert (and does not throw) when the project has no roles field at all', () => {
      // Defensive: the raw `/api/v1/` payload may omit `roles`; the component's
      // `project?.roles ?? []` fallback must treat that as an empty role list
      // rather than crashing.
      const project = makeProject({ roles: undefined });
      const { container } = renderSelector(project, null, jest.fn());

      expect(getHeader(container)).toHaveClass('not-clickable');
      expect(container.querySelector('.icon-filter')).not.toBeInTheDocument();
      expect(queryPopover(container)).toBeNull();
    });
  });

  describe('popover & role selection', () => {
    it('renders `.popover.pop-role` with a clear-selection entry plus one anchor per computable role', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      openPopover(container);

      expect(queryPopover(container)).toBeInTheDocument();
      expect(
        container.querySelector('.popover.pop-role .clear-selection'),
      ).toBeInTheDocument();
      expect(container.querySelectorAll('.popover.pop-role a.role')).toHaveLength(2);
    });

    it('fires onSelectRole with the chosen role id ("Back" -> 1)', () => {
      const onSelectRole = jest.fn();
      const { container } = renderSelector(makeProject(), null, onSelectRole);

      openPopover(container);
      fireEvent.click(within(getPopover(container)).getByText('Back'));

      expect(onSelectRole).toHaveBeenCalledTimes(1);
      expect(onSelectRole).toHaveBeenCalledWith(1);
    });

    it('fires onSelectRole with the chosen role id ("Front" -> 2)', () => {
      const onSelectRole = jest.fn();
      const { container } = renderSelector(makeProject(), null, onSelectRole);

      openPopover(container);
      fireEvent.click(within(getPopover(container)).getByText('Front'));

      expect(onSelectRole).toHaveBeenCalledTimes(1);
      expect(onSelectRole).toHaveBeenCalledWith(2);
    });

    it('closes the popover after a role is selected', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      openPopover(container);
      fireEvent.click(within(getPopover(container)).getByText('Back'));

      expect(queryPopover(container)).toBeNull();
      expect(getRoot(container)).not.toHaveClass('popover-open');
    });

    it('fires onSelectRole(null) when the clear-selection control is triggered', () => {
      const onSelectRole = jest.fn();
      // Start with a role already filtered so "clear" is a meaningful action.
      const { container } = renderSelector(makeProject(), 1, onSelectRole);

      openPopover(container);
      const clear = container.querySelector<HTMLElement>(
        '.popover.pop-role .clear-selection',
      );
      expect(clear).toBeInTheDocument();
      fireEvent.click(clear as HTMLElement);

      expect(onSelectRole).toHaveBeenCalledTimes(1);
      expect(onSelectRole).toHaveBeenCalledWith(null);
    });
  });

  describe('header label & active-popover state', () => {
    it('shows the default "Points" header label when no role is selected', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      // "Points" is unique to the header in the closed default render.
      expect(screen.getByText('Points')).toBeInTheDocument();
      expect(getHeader(container)).toHaveTextContent('Points');
    });

    it('shows the selected role name as the header label', () => {
      // selectedRoleId 1 === "Back".
      const { container } = renderSelector(makeProject(), 1, jest.fn());

      expect(getHeader(container)).toHaveTextContent('Back');
    });

    it('marks the clear-selection anchor active when no role is selected', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      openPopover(container);

      expect(
        container.querySelector('.popover.pop-role .clear-selection'),
      ).toHaveClass('active-popover');
      // No role anchor is active while the filter is cleared.
      expect(
        container.querySelector('.popover.pop-role a.role.active-popover'),
      ).toBeNull();
    });

    it('marks the selected role anchor active when a role is selected', () => {
      // selectedRoleId 2 === "Front".
      const { container } = renderSelector(makeProject(), 2, jest.fn());

      openPopover(container);

      const activeRole = container.querySelector<HTMLElement>(
        '.popover.pop-role a.role.active-popover',
      );
      expect(activeRole).toBeInTheDocument();
      expect(activeRole).toHaveTextContent('Front');
      // The clear-selection anchor is NOT active while a role is filtered.
      expect(
        container.querySelector('.popover.pop-role .clear-selection.active-popover'),
      ).toBeNull();
    });
  });

  describe('closing behaviour', () => {
    it('closes the popover on an outside mousedown', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      openPopover(container);
      expect(queryPopover(container)).toBeInTheDocument();

      // A mousedown outside the `.inner` root closes the popover.
      fireEvent.mouseDown(document.body);

      expect(queryPopover(container)).toBeNull();
      expect(getRoot(container)).not.toHaveClass('popover-open');
    });

    it('keeps the popover open on a mousedown inside it', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      openPopover(container);
      const popover = getPopover(container);

      // A mousedown inside the root (on the popover itself) must NOT close it.
      fireEvent.mouseDown(popover);

      expect(queryPopover(container)).toBeInTheDocument();
    });

    it('closes the popover when Escape is pressed', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      openPopover(container);
      expect(queryPopover(container)).toBeInTheDocument();

      fireEvent.keyDown(document.body, { key: 'Escape' });

      expect(queryPopover(container)).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ *
   * F-UI-02 / F-UI-04 / F-UI-06 — sprite icon, accessibility, i18n
   * ------------------------------------------------------------------ */
  describe('F-UI-04 accessible disclosure control', () => {
    it('renders the interactive header as a native <button> with disclosure semantics', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      const header = getHeader(container);
      // Was a clickable <span>; now a real <button> — focusable + Enter/Space-operable.
      expect(header.tagName).toBe('BUTTON');
      expect(header).toHaveAttribute('type', 'button');
      expect(header).toHaveAttribute('aria-haspopup', 'true');
      expect(header).toHaveAttribute('aria-expanded', 'false');
      // Accessible name from BACKLOG.TABLE.TITLE_COLUMN_POINTS.
      expect(header).toHaveAttribute('aria-label', 'Select view per Role');
    });

    it('reflects the open/closed state through aria-expanded', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      const header = getHeader(container);
      expect(header).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(header);
      expect(getHeader(container)).toHaveAttribute('aria-expanded', 'true');

      fireEvent.click(getHeader(container));
      expect(getHeader(container)).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders the inert header as a plain non-button <span>', () => {
      const project = makeProject({
        roles: [{ id: 1, name: 'Back', slug: 'back', computable: true, order: 1 }],
      });
      const { container } = renderSelector(project, null, jest.fn());

      const header = getHeader(container);
      expect(header.tagName).toBe('SPAN');
      expect(header).toHaveClass('not-clickable');
    });

    it('exposes the popover as an ARIA menu with keyboard-operable menuitems', () => {
      const onSelectRole = jest.fn();
      const { container } = renderSelector(makeProject(), null, onSelectRole);

      openPopover(container);
      const popover = getPopover(container);
      expect(popover).toHaveAttribute('role', 'menu');

      // Every entry is a focusable menuitem (tabIndex 0).
      const items = popover.querySelectorAll<HTMLElement>('[role="menuitem"]');
      expect(items.length).toBe(3); // clear-selection + Back + Front
      items.forEach((item) => expect(item).toHaveAttribute('tabindex', '0'));

      // Pressing Enter on a role entry selects it (keyboard activation).
      const backRole = within(popover).getByText('Back');
      fireEvent.keyDown(backRole, { key: 'Enter' });
      expect(onSelectRole).toHaveBeenCalledWith(1);
      // …and closes the popover.
      expect(queryPopover(container)).toBeNull();
    });
  });

  describe('F-UI-02 sprite icon (shared TgSvg)', () => {
    it('renders the filter affordance as a <tg-svg> sprite host', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      const host = container.querySelector('tg-svg');
      expect(host).toBeInTheDocument();
      const use = host?.querySelector('svg.icon.icon-filter use');
      expect(use).toBeInTheDocument();
      expect(use).toHaveAttribute('href', '#icon-filter');
    });
  });

  describe('F-UI-06 localized copy', () => {
    it('shows the localized default "Points" header and "All points" clear entry', () => {
      const { container } = renderSelector(makeProject(), null, jest.fn());

      // Default header label reads COMMON.FIELDS.POINTS.
      expect(getHeader(container)).toHaveTextContent('Points');

      openPopover(container);
      const clear = container.querySelector<HTMLElement>(
        '.popover.pop-role .clear-selection',
      );
      // Clear entry reads COMMON.ROLES.ALL for both its text and title.
      expect(clear).toHaveTextContent('All points');
      expect(clear).toHaveAttribute('title', 'All points');
    });
  });
});
