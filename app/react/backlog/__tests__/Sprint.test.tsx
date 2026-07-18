/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Sprint.test.tsx — Jest (jsdom) render spec for the Backlog `Sprint`
 * presentational component (`app/react/backlog/components/Sprint.tsx`).
 *
 * WHAT IS UNDER TEST
 *   `Sprint` renders ONE sprint block ported from the DELETE-marked AngularJS
 *   sources `app/partials/backlog/sprint.jade` +
 *   `app/partials/includes/modules/sprints.jade` +
 *   `app/coffee/modules/backlog/sprints.coffee`. It renders:
 *     - a `<header>` hosting `SprintHeader` (the sprint name + date + points);
 *     - an inline COMMON progress bar (`.summary-progress-wrapper` >
 *       `.sprint-progress-bar` > `.current-progress`);
 *     - a droppable `.sprint-table` list whose rows each carry `data-id={us.id}`
 *       (a `@dnd-kit/core` DROPPABLE registered via `useDroppable`, with each row
 *       a DRAGGABLE registered via `useDraggable`); and
 *     - a sibling taskboard link placed OUTSIDE `.sprint-table`.
 *
 * WHY <DndContext> IS REQUIRED
 *   `Sprint` calls `useDroppable` (and, per row, `useDraggable`). React throws
 *   "useDroppable must be used within DndContext" unless an ancestor provides a
 *   `DndContext`. At runtime that ancestor is `../dnd/BacklogDndContext`; the
 *   component does NOT import it. In this spec we therefore wrap every render in
 *   a REAL `<DndContext>` (the `renderInDnd` helper). `@dnd-kit/core` is jsdom
 *   safe and is deliberately NOT mocked.
 *
 * RECONCILED-AGAINST-ACTUAL (mandatory — verified against the authored file)
 *   The authored `Sprint.tsx` was opened first; this spec asserts ITS contract,
 *   which differs from the file summary's "recorded" contract:
 *     - `SprintProps` is `{ project, sprint, onEditSprint }` and `onEditSprint`
 *       is a REQUIRED prop (not optional). There is NO `expanded` /
 *       `onToggleCollapse` prop on `Sprint`; the collapse flag is owned
 *       internally via `useState(!sprint.closed)`. Every render therefore passes
 *       `onEditSprint` (a `jest.fn()`), or strict TS would reject the element.
 *     - Root class is `sprint sprint-open` when `sprint.closed === false` and
 *       `sprint sprint-closed` when `closed === true`.
 *     - The droppable list keeps its `.sprint-table` class (the DnD container
 *       detection relies on it) and gains the `open` class only while expanded.
 *     - Each user-story row is `<div class="row milestone-us-item-row"
 *       data-id={us.id}>` — exactly ONE `[data-id]` element per story (the inner
 *       us-name anchor, epic pills, and points column carry no `data-id`).
 *     - The taskboard link this component owns is `<a class="btn-small"
 *       href="/project/{slug}/taskboard/{sprintSlug}">Sprint Taskboard</a>`,
 *       gated on `view_milestones` and rendered as a SIBLING after
 *       `.sprint-table`. (A SECOND taskboard-href link — the sprint name — is
 *       rendered by the nested `SprintHeader`, without the `btn-small` class, so
 *       the Sprint-owned link is targeted unambiguously via `a.btn-small`.)
 *     - The progress bar is the COMMON `tgProgressBar` inlined with the
 *       `.sprint-progress-bar` class — NOT the backlog-summary `ProgressBar`
 *       component and NOT the `.summary-progress-bar` class.
 *   The component is NOT modified in any way by this spec.
 *
 * CONVENTIONS (enforced for this `__tests__` folder)
 *   - jsdom environment (configured centrally in `jest.config.js`); no per-file
 *     environment pragma docblock is used.
 *   - No `import React` — the root tsconfig uses the automatic `jsx: "react-jsx"`
 *     runtime. The only `react` import is the type-only `ReactElement` used by
 *     the `renderInDnd` helper (erased at compile time — this is NOT
 *     `import React`).
 *   - `describe` / `it` / `expect` / `jest` are Jest globals (typed via
 *     `@types/jest`) and are NOT imported.
 *   - `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveClass`,
 *     `toHaveAttribute`) are registered globally by the Jest
 *     `setupFilesAfterEnv` entry and are NOT imported here.
 *   - Permissions are driven exclusively through `makeProject({ my_permissions })`;
 *     the pure `can()` helper in `../../shared/permissions` is never mocked.
 *   - `@testing-library/react` auto-cleanup (RTL v14) unmounts between tests, so
 *     no manual cleanup is required.
 */

import type { ReactElement } from 'react';

import { render, screen, within, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';

import { Sprint } from '../components/Sprint';
import { makeMilestone, makeUserStory, makeProject } from './factories';

import type { Milestone, Project, UserStory } from '../../shared/types';

/* ========================================================================== *
 * Test helpers
 * ========================================================================== */

/**
 * Render `ui` inside a REAL `@dnd-kit/core` `<DndContext>`. `Sprint`'s
 * `useDroppable` / `useDraggable` hooks connect to whichever `DndContext` an
 * ancestor provides, so this wrapper is mandatory — without it React throws
 * "useDroppable must be used within DndContext". The `onDragEnd` handler is an
 * intentional no-op: these are render-only assertions, not drag simulations.
 *
 * The parameter is typed with the type-only `ReactElement` (allowed; NOT a
 * default `React` import) so callers pass a fully-typed `<Sprint … />` element.
 */
function renderInDnd(ui: ReactElement) {
  return render(<DndContext onDragEnd={() => {}}>{ui}</DndContext>);
}

/**
 * Return the first element matching `selector` inside `root`, throwing a clear
 * message when it is absent. Throwing (rather than returning `null`) both fails
 * the test with a useful diagnostic and narrows the result to `HTMLElement`, so
 * callers can use `within(...)`, `.contains(...)`, and `.querySelectorAll(...)`
 * without a non-null assertion.
 */
function requireEl(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`Expected to find "${selector}" in the rendered Sprint`);
  }
  return el;
}

/* ========================================================================== *
 * Specs
 * ========================================================================== */

describe('Sprint', () => {
  describe('open / closed root class', () => {
    it('renders the root `.sprint` with `sprint-open` when the sprint is not closed', () => {
      const sprint: Milestone = makeMilestone({ closed: false });

      const { container } = renderInDnd(
        <Sprint sprint={sprint} project={makeProject()} onEditSprint={jest.fn()} />,
      );

      const root = requireEl(container, '.sprint');
      expect(root).toHaveClass('sprint-open');
      expect(root).not.toHaveClass('sprint-closed');
    });

    it('renders the root `.sprint` with `sprint-closed` when the sprint is closed', () => {
      const sprint: Milestone = makeMilestone({ closed: true });

      const { container } = renderInDnd(
        <Sprint sprint={sprint} project={makeProject()} onEditSprint={jest.fn()} />,
      );

      const root = requireEl(container, '.sprint');
      expect(root).toHaveClass('sprint-closed');
      expect(root).not.toHaveClass('sprint-open');
    });
  });

  describe('sprint-table droppable & rows', () => {
    it('renders the droppable `.sprint-table` with one `[data-id]` row per user story', () => {
      const stories: UserStory[] = [
        makeUserStory({ id: 101, ref: 11, subject: 'First story', milestone: 1 }),
        makeUserStory({ id: 102, ref: 12, subject: 'Second story', milestone: 1 }),
      ];
      const sprint: Milestone = makeMilestone({ closed: false, user_stories: stories });

      const { container } = renderInDnd(
        <Sprint sprint={sprint} project={makeProject()} onEditSprint={jest.fn()} />,
      );

      const sprintTable = requireEl(container, '.sprint-table');
      expect(sprintTable).toBeInTheDocument();
      // An open sprint starts expanded, so the table carries the `open` class.
      expect(sprintTable).toHaveClass('open');

      // DnD contract: each story row is addressable by its `data-id` — the
      // ancestor `BacklogDndContext` locates candidate rows this way to compute
      // the drop neighbours (`previousUs` / `nextUs`, read from `dataset.id`).
      expect(
        container.querySelector('.sprint-table [data-id="101"]'),
      ).toBeInTheDocument();
      expect(
        container.querySelector('.sprint-table [data-id="102"]'),
      ).toBeInTheDocument();

      // Exactly one `[data-id]` element per story, scoped to the table, each
      // carrying the SCSS-faithful row classes.
      const rows = sprintTable.querySelectorAll('[data-id]');
      expect(rows).toHaveLength(stories.length);
      rows.forEach((row) => {
        expect(row).toHaveClass('row', 'milestone-us-item-row');
      });

      // Scope with within(): every row renders its us-name link INSIDE the
      // table (one link per row); the sibling taskboard links live outside it.
      expect(within(sprintTable).getAllByRole('link')).toHaveLength(stories.length);
    });

    it('renders an empty (but still droppable) `.sprint-table` for a sprint with no stories', () => {
      const sprint: Milestone = makeMilestone({ closed: false, user_stories: [] });

      const { container } = renderInDnd(
        <Sprint sprint={sprint} project={makeProject()} onEditSprint={jest.fn()} />,
      );

      const sprintTable = requireEl(container, '.sprint-table');
      expect(sprintTable).toBeInTheDocument();
      // No rows: the droppable stays, but there are zero `[data-id]` rows.
      expect(sprintTable.querySelectorAll('[data-id]')).toHaveLength(0);
      // The empty-state message renders inside the still-present droppable.
      expect(sprintTable.querySelector('.sprint-empty')).toBeInTheDocument();
      expect(within(sprintTable).queryAllByRole('link')).toHaveLength(0);
    });

    it('keeps rows addressable by `data-id` but marks a closed sprint table collapsed (no `open`)', () => {
      const stories: UserStory[] = [makeUserStory({ id: 201, ref: 21, milestone: 1 })];
      const sprint: Milestone = makeMilestone({ closed: true, user_stories: stories });

      const { container } = renderInDnd(
        <Sprint sprint={sprint} project={makeProject()} onEditSprint={jest.fn()} />,
      );

      const sprintTable = requireEl(container, '.sprint-table');
      // A closed sprint starts collapsed, so the table lacks the `open` class…
      expect(sprintTable).not.toHaveClass('open');
      // …yet the row is still rendered and addressable by `data-id`.
      expect(
        container.querySelector('.sprint-table [data-id="201"]'),
      ).toBeInTheDocument();
    });
  });

  describe('taskboard link placement', () => {
    it('renders the sprint taskboard link (btn-small) as a sibling OUTSIDE the `.sprint-table`', () => {
      const { container } = renderInDnd(
        <Sprint
          sprint={makeMilestone({ slug: 'sprint-1' })}
          project={makeProject({ slug: 'project-1' })}
          onEditSprint={jest.fn()}
        />,
      );

      // The Sprint-owned link is the `.btn-small` one (the SprintHeader's
      // taskboard link, which shows the sprint name, has no such class).
      const link = requireEl(container, 'a.btn-small');
      expect(link).toHaveAttribute(
        'href',
        '/project/project-1/taskboard/sprint-1',
      );
      expect(screen.getByText('Sprint Taskboard')).toBeInTheDocument();

      // It must NOT be treated as a draggable row, i.e. it is not a descendant
      // of the droppable `.sprint-table`.
      const sprintTable = requireEl(container, '.sprint-table');
      expect(sprintTable.contains(link)).toBe(false);
    });

    it('omits the taskboard link when `view_milestones` is not granted', () => {
      const project: Project = makeProject({ my_permissions: ['view_project'] });

      const { container } = renderInDnd(
        <Sprint sprint={makeMilestone()} project={project} onEditSprint={jest.fn()} />,
      );

      expect(container.querySelector('a.btn-small')).toBeNull();
      expect(screen.queryByText('Sprint Taskboard')).toBeNull();
    });
  });

  describe('child composition', () => {
    it('renders the nested SprintHeader (sprint name) and the inline progress bar', () => {
      const { container } = renderInDnd(
        <Sprint
          sprint={makeMilestone({ name: 'Sprint Alpha' })}
          project={makeProject()}
          onEditSprint={jest.fn()}
        />,
      );

      // SprintHeader renders the sprint name (the default project grants
      // `view_milestones`, so the header's name/taskboard link is visible).
      expect(screen.getByText('Sprint Alpha')).toBeInTheDocument();
      expect(container.querySelector('.sprint-summary')).toBeInTheDocument();

      // Inline COMMON progress bar — the authored classes, NOT the separate
      // backlog-summary `ProgressBar` component (which uses `.summary-progress-bar`).
      expect(container.querySelector('.summary-progress-wrapper')).toBeInTheDocument();
      expect(container.querySelector('.sprint-progress-bar')).toBeInTheDocument();
      expect(container.querySelector('.current-progress')).toBeInTheDocument();
    });
  });

  describe('user-story row content', () => {
    it('renders the points column when the story carries `total_points`', () => {
      const stories: UserStory[] = [
        makeUserStory({ id: 301, ref: 31, milestone: 1, total_points: 8 }),
      ];
      const sprint: Milestone = makeMilestone({ closed: false, user_stories: stories });

      const { container } = renderInDnd(
        <Sprint sprint={sprint} project={makeProject()} onEditSprint={jest.fn()} />,
      );

      const row = requireEl(container, '.sprint-table [data-id="301"]');
      const points = row.querySelector('.column-points');
      expect(points).toBeInTheDocument();
      // `tg-bo-bind="us.total_points"` — the value is rendered verbatim.
      expect(points).toHaveTextContent('8');
    });

    it('renders the due-date badge and epic pills for a story that carries them', () => {
      // `due_date` and `epics` are real `/api/v1/` fields read through the
      // component's documented `& Record<string, any>` cast; the trimmed
      // `UserStory` type accepts them via its `[key: string]: unknown` index
      // signature, so no cast is needed on the fixture.
      const stories: UserStory[] = [
        makeUserStory({
          id: 302,
          ref: 32,
          milestone: 1,
          due_date: '2021-05-05',
          epics: [{ id: 7, ref: 70, subject: 'Epic Seven', color: '#ff0000' }],
        }),
      ];
      const sprint: Milestone = makeMilestone({ closed: false, user_stories: stories });

      const { container } = renderInDnd(
        <Sprint sprint={sprint} project={makeProject()} onEditSprint={jest.fn()} />,
      );

      const row = requireEl(container, '.sprint-table [data-id="302"]');

      // Due-date badge (the `icon-clock` sprite) with the raw date as its title.
      const due = row.querySelector('.due-date');
      expect(due).toBeInTheDocument();
      expect(due).toHaveAttribute('title', '2021-05-05');

      // Exactly one epic pill, coloured by `epic.color`.
      const pills = row.querySelectorAll('.belong-to-epic-pill');
      expect(pills).toHaveLength(1);
    });
  });

  describe('collapse toggle', () => {
    it('toggles the `.sprint-table` `open` class when the compact-sprint arrow is clicked', () => {
      const { container } = renderInDnd(
        <Sprint
          sprint={makeMilestone({ closed: false })}
          project={makeProject()}
          onEditSprint={jest.fn()}
        />,
      );

      const sprintTable = requireEl(container, '.sprint-table');
      // An open sprint starts expanded (the `open` class is present).
      expect(sprintTable).toHaveClass('open');

      // The nested SprintHeader's compact-sprint arrow lifts `onToggleCollapse`,
      // which this component wires to `setExpanded((e) => !e)`. Clicking it
      // collapses the table (removes `open`); clicking again re-expands it.
      fireEvent.click(screen.getByTitle('Compact Sprint'));
      expect(sprintTable).not.toHaveClass('open');

      fireEvent.click(screen.getByTitle('Compact Sprint'));
      expect(sprintTable).toHaveClass('open');
    });
  });
});
