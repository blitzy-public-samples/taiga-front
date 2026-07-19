/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintHeader.test.tsx — Jest (jsdom) render spec for the Backlog
 * `SprintHeader` presentational component
 * (`app/react/backlog/components/SprintHeader.tsx`).
 *
 * WHAT IS UNDER TEST
 *   `SprintHeader` is the per-sprint summary header ported from the deleted
 *   AngularJS `tgBacklogSprintHeader` directive (`BacklogSprintHeaderDirective`
 *   in `app/coffee/modules/backlog/sprints.coffee`) and its template
 *   `app/partials/backlog/sprint-header.jade`. It is pure/presentational — it
 *   receives `sprint` + `project` + two callbacks via props, derives every
 *   displayed value and both permission gates from them, and renders static DOM
 *   reusing the existing SCSS class names (`sprint-summary`, `sprint-name`,
 *   `sprint-date`, `sprint-points`, `edit-sprint`, `compact-sprint`, …). There
 *   is no network, WebSocket, timer, or drag-and-drop, so no `<DndContext>`
 *   wrapper and no `jest.mock` are needed.
 *
 * RECONCILED-AGAINST-ACTUAL (mandatory)
 *   The authored component was opened first and this spec asserts ITS contract,
 *   which differs from the file summary's "recorded" contract:
 *     - The edit callback is `onEditSprint(sprint)`, NOT `onEdit`. Both
 *       `onEditSprint` and `onToggleCollapse` are REQUIRED props.
 *     - There is NO `expanded` prop and NO `onCreateSprint` prop. The header
 *       does not own any `expanded` state (that lives in the parent `Sprint`),
 *       so no such prop is passed here (strict TS would reject an unknown prop).
 *     - The sprint NAME (and its taskboard link) is gated behind
 *       `view_milestones` (`isVisible`), so it is asserted present only when
 *       that permission is granted and absent when it is withheld.
 *     - The edit pencil is gated behind `!archived_code && modify_milestone`
 *       (`isEditable`); the archived-project branch is exercised explicitly.
 *     - The `.compact-sprint` toggle is ALWAYS rendered and wired to
 *       `onToggleCollapse` — the "collapse toggle" block is therefore kept (the
 *       affordance IS owned by this component) but driven solely by
 *       `onToggleCollapse`, with no `expanded` prop.
 *   The component is NOT modified in any way by this spec.
 *
 * CONVENTIONS (enforced for this `__tests__` folder)
 *   - jsdom environment (configured centrally in `jest.config.js`); no
 *     `@jest-environment` docblock.
 *   - No `import React` — the project uses the automatic `jsx: "react-jsx"`
 *     runtime.
 *   - `describe` / `it` / `expect` / `jest` are Jest globals (typed via
 *     `@types/jest`) and are NOT imported.
 *   - `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveClass`,
 *     `toHaveAttribute`, `toHaveTextContent`) are registered globally by the
 *     Jest `setupFilesAfterEnv` entry and are NOT imported here.
 *   - Permissions are driven exclusively through `makeProject({ my_permissions })`;
 *     the pure `can()` helper in `../../shared/permissions` is never mocked.
 *   - `@testing-library/react` auto-cleanup (RTL v14) unmounts between tests, so
 *     no manual cleanup is required.
 */

import { render, screen, fireEvent } from '@testing-library/react';

import { SprintHeader } from '../components/SprintHeader';
import { makeMilestone, makeProject } from './factories';

import type { Milestone, Project } from '../../shared/types';

/* ========================================================================== *
 * Test helper
 * ========================================================================== */

/**
 * Options for {@link renderHeader}. Every field is optional; unspecified props
 * fall back to a realistic default (`makeMilestone()` / `makeProject()` and
 * fresh `jest.fn()` callbacks) so each spec overrides only what it exercises.
 * Callback props are typed as `jest.Mock` so returned handles can be asserted
 * with `toHaveBeenCalled*` directly.
 */
interface RenderHeaderOptions {
  sprint?: Milestone;
  project?: Project;
  onEditSprint?: jest.Mock;
  onToggleCollapse?: jest.Mock;
}

/**
 * Render `SprintHeader` with all four required props resolved. Returns the
 * standard Testing Library result plus the resolved `sprint` / `project` and
 * the two callback mocks, so callers can reach into `container` for the
 * class-based queries the SCSS-faithful markup relies on and assert on the
 * lifted callbacks.
 */
function renderHeader(options: RenderHeaderOptions = {}) {
  const sprint = options.sprint ?? makeMilestone();
  const project = options.project ?? makeProject();
  const onEditSprint = options.onEditSprint ?? jest.fn();
  const onToggleCollapse = options.onToggleCollapse ?? jest.fn();

  const utils = render(
    <SprintHeader
      sprint={sprint}
      project={project}
      onEditSprint={onEditSprint}
      onToggleCollapse={onToggleCollapse}
    />,
  );

  return { ...utils, sprint, project, onEditSprint, onToggleCollapse };
}

/* ========================================================================== *
 * Specs
 * ========================================================================== */

describe('SprintHeader', () => {
  describe('rendering & date range', () => {
    it('renders the .sprint-summary host with its name / date / points regions', () => {
      const { container } = renderHeader();

      // These exact class names ARE the visual-fidelity contract (reused SCSS).
      expect(container.querySelector('.sprint-summary')).toBeInTheDocument();
      expect(container.querySelector('.sprint-name-container')).toBeInTheDocument();
      expect(container.querySelector('.sprint-name')).toBeInTheDocument();
      expect(container.querySelector('.sprint-date')).toBeInTheDocument();
      expect(container.querySelector('.sprint-points')).toBeInTheDocument();
      expect(container.querySelector('.sprint-info')).toBeInTheDocument();
    });

    it('renders the sprint name (view_milestones granted by the default project)', () => {
      renderHeader({ sprint: makeMilestone({ name: 'Sprint 42' }) });

      expect(screen.getByText('Sprint 42')).toBeInTheDocument();
    });

    it('renders the estimated date range EXACTLY as "01 Jan 2021-15 Jan 2021" (no space around the hyphen)', () => {
      const { container } = renderHeader({
        sprint: makeMilestone({
          name: 'Sprint 42',
          estimated_start: '2021-01-01',
          estimated_finish: '2021-01-15',
        }),
      });

      // The range is a single text node in `.sprint-date`.
      expect(screen.getByText('01 Jan 2021-15 Jan 2021')).toBeInTheDocument();

      // Lock it to the `.sprint-date` region and confirm the separator is a bare
      // hyphen with NO surrounding whitespace (verbatim `"#{start}-#{finish}"`).
      const dateEl = container.querySelector('.sprint-date');
      expect(dateEl).toBeInTheDocument();
      expect(dateEl?.textContent).toBe('01 Jan 2021-15 Jan 2021');
      expect(dateEl?.textContent).not.toMatch(/\s-\s/);
    });

    it('renders the taskboard link to /project/{slug}/taskboard/{sprintSlug}', () => {
      renderHeader({
        sprint: makeMilestone({ name: 'Sprint 42', slug: 'sprint-1' }),
        project: makeProject({ slug: 'project-1' }),
      });

      const link = screen.getByTitle('Go to the taskboard of Sprint 42');
      expect(link).toHaveAttribute('href', '/project/project-1/taskboard/sprint-1');
    });

    it('guards a missing sprint slug with an empty segment (sprint.slug ?? "")', () => {
      // A raw `/api/v1/` milestone may omit `slug`; the URL must stay well-formed
      // (trailing `/taskboard/`) rather than emit `undefined`.
      renderHeader({
        sprint: makeMilestone({ name: 'Sprint 42', slug: undefined }),
        project: makeProject({ slug: 'project-1' }),
      });

      const link = screen.getByTitle('Go to the taskboard of Sprint 42');
      expect(link).toHaveAttribute('href', '/project/project-1/taskboard/');
    });

    it('renders closed and total points with the "closed" / "total" descriptions in order', () => {
      const { container } = renderHeader({
        sprint: makeMilestone({ closed_points: 5, total_points: 10 }),
      });

      // Distinct values (5 / 10) so each `.number` node is unambiguous.
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('closed')).toBeInTheDocument();
      expect(screen.getByText('total')).toBeInTheDocument();

      // Closed is the first points row, total the second (verbatim source order).
      const numbers = container.querySelectorAll('.sprint-info .number');
      expect(numbers).toHaveLength(2);
      expect(numbers[0]).toHaveTextContent('5');
      expect(numbers[1]).toHaveTextContent('10');
    });

    it('falls back to 0 for absent closed / total points (sprint.x || 0)', () => {
      const { container } = renderHeader({
        sprint: makeMilestone({ closed_points: null, total_points: null }),
      });

      const numbers = container.querySelectorAll('.sprint-info .number');
      expect(numbers).toHaveLength(2);
      expect(numbers[0]).toHaveTextContent('0');
      expect(numbers[1]).toHaveTextContent('0');
    });
  });

  describe('permission gates', () => {
    // ---- edit pencil: isEditable = !archived_code && modify_milestone -------

    it('hides the edit-sprint control without modify_milestone (default view-only project)', () => {
      const { container } = renderHeader();

      expect(screen.queryByTitle('Edit Sprint')).toBeNull();
      expect(container.querySelector('.edit-sprint')).not.toBeInTheDocument();
    });

    it('shows the edit-sprint control with modify_milestone and lifts onEditSprint(sprint) on click', () => {
      const onEditSprint = jest.fn();
      const { sprint } = renderHeader({
        project: makeProject({
          my_permissions: ['view_project', 'view_milestones', 'modify_milestone'],
        }),
        onEditSprint,
      });

      const edit = screen.getByTitle('Edit Sprint');
      expect(edit).toBeInTheDocument();
      expect(edit).toHaveClass('edit-sprint');

      fireEvent.click(edit);

      // The directive's `$rootScope.$broadcast("sprintform:edit", sprint)`.
      expect(onEditSprint).toHaveBeenCalledTimes(1);
      expect(onEditSprint).toHaveBeenCalledWith(sprint);
    });

    it('hides the edit-sprint control on an archived project even with modify_milestone', () => {
      const onEditSprint = jest.fn();
      renderHeader({
        project: makeProject({
          my_permissions: ['view_project', 'view_milestones', 'modify_milestone'],
          archived_code: 'blocked',
        }),
        onEditSprint,
      });

      // A truthy `archived_code` disables the edit affordance regardless of perms.
      expect(screen.queryByTitle('Edit Sprint')).toBeNull();
      expect(onEditSprint).not.toHaveBeenCalled();
    });

    // ---- name / taskboard link: isVisible = view_milestones -----------------

    it('shows the sprint name and taskboard link when view_milestones is granted', () => {
      renderHeader({
        sprint: makeMilestone({ name: 'Sprint 42' }),
        project: makeProject({ my_permissions: ['view_project', 'view_milestones'] }),
      });

      expect(screen.getByText('Sprint 42')).toBeInTheDocument();
      expect(screen.getByTitle('Go to the taskboard of Sprint 42')).toBeInTheDocument();
    });

    it('hides the sprint name and taskboard link when view_milestones is absent', () => {
      renderHeader({
        sprint: makeMilestone({ name: 'Sprint 42' }),
        project: makeProject({ my_permissions: ['view_project'] }),
      });

      expect(screen.queryByText('Sprint 42')).toBeNull();
      expect(screen.queryByTitle('Go to the taskboard of Sprint 42')).toBeNull();
    });

    it('keeps the compact toggle, date, and points visible regardless of view_milestones', () => {
      const { container } = renderHeader({
        sprint: makeMilestone({ name: 'Sprint 42', closed_points: 5, total_points: 10 }),
        project: makeProject({ my_permissions: ['view_project'] }),
      });

      // Name is gated off…
      expect(screen.queryByText('Sprint 42')).toBeNull();
      // …but the always-present chrome (toggle, date, points) still renders.
      expect(screen.getByTitle('Compact Sprint')).toBeInTheDocument();
      expect(screen.getByText('01 Jan 2021-15 Jan 2021')).toBeInTheDocument();
      expect(container.querySelectorAll('.sprint-info .number')).toHaveLength(2);
    });
  });

  describe('collapse toggle', () => {
    it('always renders the compact-sprint <button type="button">', () => {
      renderHeader();

      const toggle = screen.getByTitle('Compact Sprint');
      expect(toggle).toBeInTheDocument();
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle).toHaveAttribute('type', 'button');
      expect(toggle).toHaveClass('compact-sprint');
    });

    it('lifts onToggleCollapse when the compact-sprint arrow is clicked', () => {
      const onToggleCollapse = jest.fn();
      renderHeader({ onToggleCollapse });

      fireEvent.click(screen.getByTitle('Compact Sprint'));

      expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    });

    it('renders the compact toggle even with no permissions at all', () => {
      renderHeader({ project: makeProject({ my_permissions: [] }) });

      expect(screen.getByTitle('Compact Sprint')).toBeInTheDocument();
    });

    it('F-UI-02: the compact-sprint toggle renders the shared `<tg-svg>` arrow sprite', () => {
      const { container } = renderHeader();

      // The retained SCSS targets the `tg-svg` host + `svg.icon`, so the icon must
      // be a real custom element wrapping an `<svg class="icon icon-arrow-right">`
      // with a sprite `<use>` — not a bare span.
      const svg = container.querySelector('.compact-sprint tg-svg svg.icon.icon-arrow-right');
      expect(svg).not.toBeNull();
      expect(svg?.querySelector('use')).not.toBeNull();
    });
  });
});
