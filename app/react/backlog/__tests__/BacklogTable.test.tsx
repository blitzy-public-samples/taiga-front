/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest (jsdom) render spec for the Backlog `BacklogTable`
 * (`../components/BacklogTable`).
 *
 * WHAT IS UNDER TEST
 *   `BacklogTable` is the React port of the AngularJS backlog user-story table
 *   (`app/partials/includes/modules/backlog-table.jade` +
 *   `app/partials/includes/components/backlog-row.jade`, driven by the
 *   `BacklogController` and the `tgUsEditSelector` / `tgUsRolePointsSelector` /
 *   `tgUsStatus` directives). It renders TWO sibling blocks: the
 *   `.backlog-table-header` column row and the droppable `.backlog-table-body`
 *   of draggable user-story rows. Because it registers a `@dnd-kit/core`
 *   droppable (`useDroppable({ id: 'backlog' })`) and each row a draggable
 *   (`useDraggable`), it MUST be rendered inside a `<DndContext>` — the wrapper
 *   the sibling `../dnd/BacklogDndContext` provides at runtime — otherwise the
 *   hooks throw. Every render therefore goes through {@link renderInDnd}.
 *
 * RECONCILED-AGAINST-ACTUAL (mandatory)
 *   The authored component (`../components/BacklogTable.tsx`) was opened FIRST
 *   and this spec asserts ITS contract, which refines the file summary's
 *   "recorded" contract in three important ways:
 *     - The checkbox-selection prop is `checkedIds: number[]` (NOT
 *       `selectedUsIds`); a row's checkbox is `checked` when `checkedIds`
 *       contains that row's `us.id`.
 *     - `visibleUserStories` filters by the story's `ref` (the legacy
 *       `inArray:visibleUserStories:'ref'`), NOT by `id`; an `undefined`
 *       `visibleUserStories` renders every row.
 *     - Each row's stable identity attribute is `data-id={us.id}` (the value the
 *       legacy `backlog/sortable.coffee` read off `dataset.id` to compute the
 *       drop neighbours), so the `data-id` is the `id` while the visible filter
 *       keys off the `ref`.
 *   Other locked contract points, verified in the authored file:
 *     - Header: exactly SIX column cells with `modify_us`
 *       (`.draggable-us-column`, `.input`, `.user-stories`, `.status`,
 *       `.points`, `.us-header-options`); without `modify_us` the first two
 *       (`.draggable-us-column` + `.input`) are omitted, leaving FOUR.
 *     - The selection checkbox, the `.draggable-us-row` drag handle and the
 *       per-row options popover (`UsEditSelector`) render ONLY with `modify_us`;
 *       the `.us-status` anchor is always present but becomes `not-clickable`
 *       (and never opens its popover) without `modify_us`, and the whole row
 *       carries the `readonly` class.
 *     - Checkbox selection lifts `(us, checked, shiftKey)` — the native
 *       post-toggle `checked` and the native `shiftKey` — enabling the
 *       shift-range selection the container owns.
 *     - The status popover emits `onUpdateStatus(us, newStatusId)` ONLY when the
 *       chosen status differs from the story's current one.
 *   The component is NOT modified in any way by this spec.
 *
 * CONVENTIONS (enforced for this folder)
 *   - jsdom environment (configured centrally in `jest.config.js`); no
 *     `@jest-environment` docblock.
 *   - No `import React` — the project uses the automatic `jsx: "react-jsx"`
 *     runtime; only a type-only `ReactElement` is imported for the wrapper.
 *   - `describe` / `it` / `expect` / `jest` are Jest globals (typed via
 *     `@types/jest`) and are NOT imported.
 *   - `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveClass`,
 *     …) are registered globally by the Jest `setupFilesAfterEnv` entry and are
 *     NOT imported here.
 *   - `@dnd-kit/core` is exercised for REAL (never mocked); the pure
 *     `permissions.ts` helper is driven purely through
 *     `makeProject({ my_permissions })` overrides and is likewise never mocked.
 *   - Fixtures are built exclusively with the shared `./factories` builders; no
 *     `jest.mock`, no network, no fetch, no WebSocket.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';

import { DndContext } from '@dnd-kit/core';

import { BacklogTable } from '../components/BacklogTable';
import { makeUserStory, makeProject, makeStatuses } from './factories';

import type { ReactElement } from 'react';
import type { UserStory, Project, Status } from '../../shared/types';

/* ========================================================================== *
 * Selectors — the SCSS-faithful class names / attributes the authored
 * component renders (kept in one place so a markup change surfaces once).
 * ========================================================================== */

/** The header wrapper block (`backlog-table.jade` `.backlog-table-header`). */
const HEADER = '.backlog-table-header';
/** The header column row whose direct children are the column cells. */
const HEADER_TITLE = '.backlog-table-header .backlog-table-title';
/** The droppable body (`useDroppable({ id: 'backlog' })`). */
const BODY = '.backlog-table-body';
/** A single user-story row (`.row.us-item-row`, carries `data-id={us.id}`). */
const ROW = '.us-item-row';
/** The per-row drag handle — present ONLY with `modify_us`. */
const DRAG_HANDLE = '.draggable-us-row';
/** The always-present status anchor inside a row's `.status` cell. */
const US_STATUS = 'a.us-status';
/** The open status popover (`pop-status`) — present ONLY with `modify_us`. */
const STATUS_POPOVER = 'ul.popover.pop-status';
/** The nested `UsEditSelector` trigger — present ONLY with `modify_us`. */
const OPTIONS_TRIGGER = '.us-option-popup-button';

/* ========================================================================== *
 * Render + query helpers
 * ========================================================================== */

/**
 * Wrap `ui` in a real `<DndContext>` before rendering. `BacklogTable` calls
 * `useDroppable` / `useDraggable`, which require a `DndContext` ancestor; the
 * no-op `onDragEnd` keeps the context inert (this spec asserts render + DOM
 * callbacks, not drag mechanics, which live in `BacklogDndContext`).
 */
function renderInDnd(ui: ReactElement) {
  return render(<DndContext onDragEnd={() => {}}>{ui}</DndContext>);
}

/**
 * Optional callback overrides for {@link renderTable}. Anything omitted falls
 * back to a fresh `jest.fn()`, so specs that assert only one callback still
 * satisfy every REQUIRED prop of `BacklogTable`.
 */
interface Handlers {
  onEditUs?: (us: UserStory) => void;
  onDeleteUs?: (us: UserStory) => void;
  onMoveUsToTop?: (us: UserStory) => void;
  onToggleCheck?: (us: UserStory, checked: boolean, shiftKey: boolean) => void;
  onUpdateStatus?: (us: UserStory, newStatusId: number) => void;
  /**
   * Optional points-estimate save: the popover resolves a role + point value
   * and emits `(us, roleId, pointId)` (F-CQ-03).
   */
  onUpdatePoints?: (us: UserStory, roleId: number, pointId: number) => void;
}

/** Optional data / flag overrides for {@link renderTable}. */
interface RenderConfig {
  userstories?: UserStory[];
  statuses?: Status[];
  project?: Project;
  checkedIds?: number[];
  visibleUserStories?: number[];
  showTags?: boolean;
  /** Optional infinite-scroll sentinel callback (maps the legacy `infinite-scroll`). */
  onLoadMore?: () => void;
  handlers?: Handlers;
}

/**
 * A project that grants `modify_us` (plus the baseline view codes), so the
 * mutating affordances — checkbox, drag handle, options popover and the
 * clickable status — all render. Read-only specs use the view-only
 * `makeProject()` default instead.
 */
function makeModifyProject(): Project {
  return makeProject({
    my_permissions: ['view_project', 'view_us', 'modify_us'],
  });
}

/**
 * Render `BacklogTable` inside a `<DndContext>` with every REQUIRED prop
 * supplied. Data / flags default to a single view-modifiable fixture; each
 * callback defaults to a fresh `jest.fn()`. Returns the Testing Library result
 * so callers reach into `container` for the class / attribute queries the
 * SCSS-faithful markup relies on.
 */
function renderTable(config: RenderConfig = {}) {
  const userstories = config.userstories ?? [makeUserStory()];
  const statuses = config.statuses ?? makeStatuses();
  const project = config.project ?? makeModifyProject();
  const handlers = config.handlers ?? {};

  return renderInDnd(
    <BacklogTable
      userstories={userstories}
      statuses={statuses}
      project={project}
      checkedIds={config.checkedIds}
      visibleUserStories={config.visibleUserStories}
      showTags={config.showTags}
      onLoadMore={config.onLoadMore}
      onEditUs={handlers.onEditUs ?? jest.fn()}
      onDeleteUs={handlers.onDeleteUs ?? jest.fn()}
      onMoveUsToTop={handlers.onMoveUsToTop ?? jest.fn()}
      onToggleCheck={handlers.onToggleCheck ?? jest.fn()}
      onUpdateStatus={handlers.onUpdateStatus ?? jest.fn()}
      onUpdatePoints={handlers.onUpdatePoints}
    />,
  );
}

/**
 * Query `selector` under `root`, throwing a descriptive error when it is
 * absent so a markup drift fails loudly at the exact assertion site (the
 * pattern the sibling `UsEditSelector.test.tsx` uses for its trigger lookup).
 */
function mustQuery(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`Expected to find "${selector}"`);
  }
  return el;
}

/** Resolve a row by its `data-id` (`us.id`) under the droppable body. */
function getRow(container: HTMLElement, id: number): HTMLElement {
  return mustQuery(container, `${BODY} [data-id="${id}"]`);
}

/* ========================================================================== *
 * Specs
 * ========================================================================== */

describe('BacklogTable', () => {
  describe('header & structure', () => {
    it('renders the six-column header and the droppable body with modify_us', () => {
      const { container } = renderTable({
        userstories: [
          makeUserStory({ id: 1, ref: 1 }),
          makeUserStory({ id: 2, ref: 2 }),
          makeUserStory({ id: 3, ref: 3 }),
        ],
        project: makeModifyProject(),
        statuses: makeStatuses(),
      });

      // The header column row exposes EXACTLY six direct children with
      // `modify_us`: the two mutating columns (`.draggable-us-column`,
      // `.input`) plus the four always-present ones.
      const headerTitle = mustQuery(container, HEADER_TITLE);
      expect(headerTitle.children).toHaveLength(6);

      // …and each of the six expected column cells is present by class.
      expect(mustQuery(container, `${HEADER_TITLE} > .draggable-us-column`)).toBeInTheDocument();
      expect(mustQuery(container, `${HEADER_TITLE} > .input`)).toBeInTheDocument();
      expect(mustQuery(container, `${HEADER_TITLE} > .user-stories`)).toBeInTheDocument();
      expect(mustQuery(container, `${HEADER_TITLE} > .status`)).toBeInTheDocument();
      expect(mustQuery(container, `${HEADER_TITLE} > .points`)).toBeInTheDocument();
      expect(mustQuery(container, `${HEADER_TITLE} > .us-header-options`)).toBeInTheDocument();

      // The two labelled header cells carry their legacy column titles (these
      // strings appear only in the header, so a global `screen` query is safe).
      expect(screen.getByText('User Story')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();

      // The scrollable body — the `@dnd-kit` drop target — is present.
      expect(mustQuery(container, BODY)).toBeInTheDocument();
    });

    it('marks the points header cell with the legacy role-filter title', () => {
      const { container } = renderTable({ project: makeModifyProject() });

      // `tg-attr-title="{{'BACKLOG.TABLE.TITLE_COLUMN_POINTS'|…}}"` parity.
      expect(mustQuery(container, `${HEADER_TITLE} > .points`)).toHaveAttribute(
        'title',
        'Select view per Role',
      );
    });
  });

  describe('rows & data-id', () => {
    it('renders one row per visible story, each keyed by data-id={us.id}', () => {
      // `data-id` is the `id`; the visible filter keys off the `ref`. Passing
      // all three refs keeps every row (and, since the filter is ref-based, an
      // id-based filter would instead show zero rows — this doubly locks it).
      const { container } = renderTable({
        userstories: [
          makeUserStory({ id: 1, ref: 11 }),
          makeUserStory({ id: 2, ref: 12 }),
          makeUserStory({ id: 3, ref: 13 }),
        ],
        visibleUserStories: [11, 12, 13],
        project: makeModifyProject(),
      });

      const body = mustQuery(container, BODY);
      expect(body.querySelector('[data-id="1"]')).toBeInTheDocument();
      expect(body.querySelector('[data-id="2"]')).toBeInTheDocument();
      expect(body.querySelector('[data-id="3"]')).toBeInTheDocument();
      // Exactly three rows, all under the droppable body.
      expect(body.querySelectorAll(ROW)).toHaveLength(3);
    });

    it('places every rendered row inside the droppable body', () => {
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 7, ref: 7 })],
        project: makeModifyProject(),
      });

      const row = getRow(container, 7);
      // The row is a descendant of the `.backlog-table-body` drop target.
      expect(mustQuery(container, BODY).contains(row)).toBe(true);
      expect(row).toHaveClass('us-item-row');
    });
  });

  describe('visibleUserStories filtering', () => {
    it('renders only stories whose ref is in visibleUserStories (ref-based, not id)', () => {
      const { container } = renderTable({
        userstories: [
          makeUserStory({ id: 1, ref: 11 }),
          makeUserStory({ id: 2, ref: 12 }),
          makeUserStory({ id: 3, ref: 13 }),
        ],
        // Only refs 11 and 13 are visible → rows id 1 and 3 render; the story
        // with ref 12 (id 2) is filtered OUT.
        visibleUserStories: [11, 13],
        project: makeModifyProject(),
      });

      const body = mustQuery(container, BODY);
      expect(body.querySelector('[data-id="1"]')).toBeInTheDocument();
      expect(body.querySelector('[data-id="3"]')).toBeInTheDocument();
      expect(body.querySelector('[data-id="2"]')).toBeNull();
      expect(body.querySelectorAll(ROW)).toHaveLength(2);
    });

    it('renders every row when visibleUserStories is undefined', () => {
      const { container } = renderTable({
        userstories: [
          makeUserStory({ id: 1, ref: 11 }),
          makeUserStory({ id: 2, ref: 12 }),
        ],
        // No `visibleUserStories` → the filter is inert; all rows render.
        project: makeModifyProject(),
      });

      expect(mustQuery(container, BODY).querySelectorAll(ROW)).toHaveLength(2);
    });
  });

  describe('checkbox shift-select', () => {
    it('lifts (us, true, false) on a plain checkbox click', () => {
      const onToggleCheck = jest.fn();
      const us = makeUserStory({ id: 1, ref: 1 });
      const { container } = renderTable({
        userstories: [us],
        project: makeModifyProject(),
        handlers: { onToggleCheck },
      });

      // One checkbox per row; a fresh (unchecked) render means the native
      // post-toggle `checked` the handler reads is `true`.
      const checkbox = within(getRow(container, 1)).getByRole('checkbox');
      fireEvent.click(checkbox);

      expect(onToggleCheck).toHaveBeenCalledTimes(1);
      // Exact tuple: the row story, the post-toggle checked value, no shift.
      expect(onToggleCheck).toHaveBeenCalledWith(us, true, false);
      // Lock the third argument explicitly — the shift-range-select signal.
      expect(onToggleCheck.mock.calls[0][2]).toBe(false);
    });

    it('lifts (us, true, true) on a shift+click, locking the shiftKey argument', () => {
      const onToggleCheck = jest.fn();
      const us = makeUserStory({ id: 1, ref: 1 });
      const { container } = renderTable({
        userstories: [us],
        project: makeModifyProject(),
        handlers: { onToggleCheck },
      });

      // A fresh render again starts unchecked, so `checked` reads `true`; the
      // native `shiftKey` is threaded straight through as the third argument.
      const checkbox = within(getRow(container, 1)).getByRole('checkbox');
      fireEvent.click(checkbox, { shiftKey: true });

      expect(onToggleCheck).toHaveBeenCalledTimes(1);
      expect(onToggleCheck).toHaveBeenCalledWith(us, true, true);
      // The shift bit is what distinguishes a range-select from a single toggle.
      expect(onToggleCheck.mock.calls[0][2]).toBe(true);
    });

    it('reflects checkedIds in the checkbox checked state', () => {
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 1 })],
        checkedIds: [1],
        project: makeModifyProject(),
      });

      // `checked` is derived from `checkedIds.includes(us.id)`.
      const checkbox = within(getRow(container, 1)).getByRole('checkbox');
      expect(checkbox).toBeChecked();
    });
  });

  describe('status popover -> onUpdateStatus', () => {
    it('opens the status popover and emits (us, newStatusId) for a different status', () => {
      const onUpdateStatus = jest.fn();
      const us = makeUserStory({ id: 1, ref: 1, status: 1 });
      const { container } = renderTable({
        userstories: [us],
        statuses: makeStatuses(), // ids 1, 2, 3
        project: makeModifyProject(),
        handlers: { onUpdateStatus },
      });

      const row = getRow(container, 1);
      // The popover is closed until the status anchor is clicked.
      expect(row.querySelector(STATUS_POPOVER)).toBeNull();

      fireEvent.click(mustQuery(row, US_STATUS));
      const popover = mustQuery(row, STATUS_POPOVER);

      // Pick status id 2 (different from the current id 1) → the update fires.
      fireEvent.click(mustQuery(popover, 'a.status[data-status-id="2"]'));

      expect(onUpdateStatus).toHaveBeenCalledTimes(1);
      expect(onUpdateStatus).toHaveBeenCalledWith(us, 2);
    });

    it('does not emit onUpdateStatus when the current status is re-selected', () => {
      const onUpdateStatus = jest.fn();
      const us = makeUserStory({ id: 1, ref: 1, status: 1 });
      const { container } = renderTable({
        userstories: [us],
        statuses: makeStatuses(),
        project: makeModifyProject(),
        handlers: { onUpdateStatus },
      });

      const row = getRow(container, 1);
      fireEvent.click(mustQuery(row, US_STATUS));
      const popover = mustQuery(row, STATUS_POPOVER);

      // Clicking the CURRENT status (id 1 === us.status) is a no-op update
      // (the authored `status.id !== us.status` guard), though it still closes.
      fireEvent.click(mustQuery(popover, 'a.status[data-status-id="1"]'));

      expect(onUpdateStatus).not.toHaveBeenCalled();
      expect(row.querySelector(STATUS_POPOVER)).toBeNull();
    });

    it('renders one popover option per status', () => {
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 1, status: 1 })],
        statuses: makeStatuses(), // three statuses
        project: makeModifyProject(),
      });

      const row = getRow(container, 1);
      fireEvent.click(mustQuery(row, US_STATUS));
      const popover = mustQuery(row, STATUS_POPOVER);

      // One `a.status[data-status-id]` option per project status.
      expect(popover.querySelectorAll('a.status[data-status-id]')).toHaveLength(3);
    });
  });

  describe('modify_us gating', () => {
    it('view-only project: omits mutating affordances and never fires onToggleCheck', () => {
      const onToggleCheck = jest.fn();
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 1 })],
        // `makeProject()` grants only view codes (no `modify_us`).
        project: makeProject(),
        handlers: { onToggleCheck },
      });

      const row = getRow(container, 1);

      // No selection checkbox, no drag handle, no options popover trigger.
      expect(within(row).queryByRole('checkbox')).toBeNull();
      expect(row.querySelector(DRAG_HANDLE)).toBeNull();
      expect(row.querySelector(OPTIONS_TRIGGER)).toBeNull();
      // The row is flagged read-only.
      expect(row).toHaveClass('readonly');

      // The status anchor is still present but `not-clickable`, and clicking it
      // does NOT open the popover.
      const statusAnchor = mustQuery(row, US_STATUS);
      expect(statusAnchor).toHaveClass('not-clickable');
      fireEvent.click(statusAnchor);
      expect(row.querySelector(STATUS_POPOVER)).toBeNull();

      // The header collapses to FOUR columns (no draggable / input columns).
      const headerTitle = mustQuery(container, HEADER_TITLE);
      expect(headerTitle.children).toHaveLength(4);
      expect(container.querySelector(`${HEADER} .draggable-us-column`)).toBeNull();
      expect(container.querySelector(`${HEADER_TITLE} > .input`)).toBeNull();

      // Nothing was ever able to fire the selection callback.
      expect(onToggleCheck).not.toHaveBeenCalled();
    });

    it('modify_us project: mutating affordances render and are interactive', () => {
      const onToggleCheck = jest.fn();
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 1 })],
        project: makeModifyProject(),
        handlers: { onToggleCheck },
      });

      const row = getRow(container, 1);

      // Checkbox, drag handle and options trigger are all present…
      const checkbox = within(row).getByRole('checkbox');
      expect(checkbox).toBeInTheDocument();
      expect(row.querySelector(DRAG_HANDLE)).toBeInTheDocument();
      expect(row.querySelector(OPTIONS_TRIGGER)).toBeInTheDocument();
      // …the status anchor is clickable (no `not-clickable` modifier)…
      expect(mustQuery(row, US_STATUS)).not.toHaveClass('not-clickable');
      // …and the row is not flagged read-only.
      expect(row).not.toHaveClass('readonly');

      // The checkbox is interactive: a click lifts the selection callback.
      fireEvent.click(checkbox);
      expect(onToggleCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe('row rendering details', () => {
    it('renders tag pills (with showTags), the due-date badge, and epic pills', () => {
      // `due_date` and `epics` are read through the `UserStory` index signature
      // (they are not declared fields), so they are supplied as extra keys.
      const us = makeUserStory({
        id: 1,
        ref: 1,
        tags: [
          ['urgent', '#ff0000'],
          ['backend', '#00ff00'],
        ],
        due_date: '2021-05-05',
        epics: [{ id: 9, ref: 42, subject: 'Checkout epic', color: '#123456' }],
      });
      const { container } = renderTable({
        userstories: [us],
        project: makeModifyProject(),
        showTags: true,
      });

      const row = getRow(container, 1);

      // Both tag pills render, the last one flagged `last`, each carrying its
      // name as text + title.
      const tagPills = row.querySelectorAll('.tag');
      expect(tagPills).toHaveLength(2);
      expect(within(row).getByText('urgent')).toBeInTheDocument();
      expect(within(row).getByText('backend')).toBeInTheDocument();
      expect(tagPills[tagPills.length - 1]).toHaveClass('last');

      // The due-date badge is present and titled with the raw date.
      expect(mustQuery(row, '.due-date')).toHaveAttribute('title', '2021-05-05');

      // One epic pill, titled `#<ref> <subject>`.
      const epicPill = mustQuery(row, '.belong-to-epic-pill');
      expect(epicPill).toHaveAttribute('title', '#42 Checkout epic');
    });

    it('omits tag pills when showTags is false (default)', () => {
      const us = makeUserStory({ id: 1, ref: 1, tags: [['urgent', '#ff0000']] });
      const { container } = renderTable({
        userstories: [us],
        project: makeModifyProject(),
        // showTags omitted → defaults to false.
      });

      expect(getRow(container, 1).querySelector('.tag')).toBeNull();
    });

    it('opens the role picker first when >1 computable role and none is filtered', () => {
      const us = makeUserStory({ id: 1, ref: 1 });
      const { container } = renderTable({
        userstories: [us],
        // Default fixture has TWO computable roles (Back, Front) and no header
        // filter → the two-step flow starts at the role picker.
        project: makeModifyProject(),
        handlers: { onUpdatePoints: jest.fn() },
      });

      const row = getRow(container, 1);
      fireEvent.click(mustQuery(row, 'button.us-points'));

      // Step 1 — the role picker (`pop-role`), NOT the point list, is shown.
      const rolePicker = mustQuery(row, '.pop-role');
      expect(rolePicker).toBeInTheDocument();
      expect(row.querySelector('.pop-points')).toBeNull();
      // One entry per COMPUTABLE role (2 of the 3 fixture roles).
      expect(rolePicker.querySelectorAll('a.role')).toHaveLength(2);
    });

    it('emits onUpdatePoints(us, roleId, pointId) after picking a role then a point value', () => {
      const onUpdatePoints = jest.fn();
      const us = makeUserStory({ id: 1, ref: 1 });
      const { container } = renderTable({
        userstories: [us],
        project: makeModifyProject(),
        handlers: { onUpdatePoints },
      });

      const row = getRow(container, 1);
      fireEvent.click(mustQuery(row, 'button.us-points'));

      // Pick the "Back" role (id 1).
      fireEvent.click(mustQuery(row, 'a.role[data-role-id="1"]'));

      // Step 2 — the point-value list is now shown, ordered by `order`.
      const pointList = mustQuery(row, '.pop-points');
      expect(pointList).toBeInTheDocument();
      const options = pointList.querySelectorAll('a.point');
      expect(options).toHaveLength(2);

      // Pick point id 11 ("1"): emits (us, roleId=1, pointId=11) and closes.
      fireEvent.click(mustQuery(row, 'a.point[data-point-id="11"]'));

      expect(onUpdatePoints).toHaveBeenCalledTimes(1);
      expect(onUpdatePoints).toHaveBeenCalledWith(us, 1, 11);
      expect(row.querySelector('.pop-points')).toBeNull();
    });

    it('skips the role picker and shows point values directly when a header role is filtered', () => {
      const onUpdatePoints = jest.fn();
      const us = makeUserStory({ id: 1, ref: 1 });
      const { container } = renderTable({
        userstories: [us],
        project: makeModifyProject(),
        handlers: { onUpdatePoints },
      });

      const row = getRow(container, 1);

      // Filter the header role selector to "Front" (id 2): the row's
      // `selectedRoleId` prop becomes 2, so the points popover resolves that
      // role immediately (no role-picker step).
      fireEvent.click(mustQuery(container, `${HEADER_TITLE} .points .header-points`));
      fireEvent.click(
        mustQuery(container, `${HEADER_TITLE} .points a.role[data-role-id="2"]`),
      );

      fireEvent.click(mustQuery(row, 'button.us-points'));
      expect(row.querySelector('.pop-role')).toBeNull();
      expect(mustQuery(row, '.pop-points')).toBeInTheDocument();

      fireEvent.click(mustQuery(row, 'a.point[data-point-id="10"]'));
      expect(onUpdatePoints).toHaveBeenCalledWith(us, 2, 10);
    });

    it('goes straight to point values when there is exactly one computable role', () => {
      const onUpdatePoints = jest.fn();
      const us = makeUserStory({ id: 1, ref: 1 });
      const { container } = renderTable({
        userstories: [us],
        // A project with a single computable role → the popover pre-resolves it.
        project: makeProject({
          my_permissions: ['view_project', 'view_us', 'modify_us'],
          roles: [{ id: 5, name: 'Only', slug: 'only', computable: true, order: 1 }],
        }),
        handlers: { onUpdatePoints },
      });

      const row = getRow(container, 1);
      fireEvent.click(mustQuery(row, 'button.us-points'));

      expect(row.querySelector('.pop-role')).toBeNull();
      expect(mustQuery(row, '.pop-points')).toBeInTheDocument();

      fireEvent.click(mustQuery(row, 'a.point[data-point-id="11"]'));
      expect(onUpdatePoints).toHaveBeenCalledWith(us, 5, 11);
    });

    it('does not open the points popover when the project is view-only', () => {
      const us = makeUserStory({ id: 1, ref: 1 });
      const { container } = renderTable({
        userstories: [us],
        project: makeProject(), // view-only → no `modify_us`
        handlers: { onUpdatePoints: jest.fn() },
      });

      const row = getRow(container, 1);
      const button = mustQuery(row, 'button.us-points');
      expect(button).toHaveClass('not-clickable');
      fireEvent.click(button);
      expect(row.querySelector('.pop-role')).toBeNull();
      expect(row.querySelector('.pop-points')).toBeNull();
    });

    it('closes an open points popover on an outside mousedown', () => {
      const us = makeUserStory({ id: 1, ref: 1 });
      const { container } = renderTable({
        userstories: [us],
        project: makeModifyProject(),
        handlers: { onUpdatePoints: jest.fn() },
      });

      const row = getRow(container, 1);
      fireEvent.click(mustQuery(row, 'button.us-points'));
      expect(row.querySelector('.pop-role')).toBeInTheDocument();

      fireEvent.mouseDown(document.body);
      expect(row.querySelector('.pop-role')).toBeNull();
    });
  });

  describe('status popover close behaviors', () => {
    it('closes the open status popover on an outside mousedown', () => {
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 1, status: 1 })],
        statuses: makeStatuses(),
        project: makeModifyProject(),
      });

      const row = getRow(container, 1);
      fireEvent.click(mustQuery(row, US_STATUS));
      expect(row.querySelector(STATUS_POPOVER)).toBeInTheDocument();

      // A mousedown outside the `.status` root closes the popover.
      fireEvent.mouseDown(document.body);
      expect(row.querySelector(STATUS_POPOVER)).toBeNull();
    });

    it('closes the open status popover when Escape is pressed', () => {
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 1, status: 1 })],
        statuses: makeStatuses(),
        project: makeModifyProject(),
      });

      const row = getRow(container, 1);
      fireEvent.click(mustQuery(row, US_STATUS));
      expect(row.querySelector(STATUS_POPOVER)).toBeInTheDocument();

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(row.querySelector(STATUS_POPOVER)).toBeNull();
    });
  });

  describe('infinite scroll (onLoadMore)', () => {
    it('invokes onLoadMore when the trailing sentinel intersects', () => {
      // jsdom ships no IntersectionObserver, so the component's effect no-ops
      // without one. Install a minimal stub that captures the callback, then
      // fire an intersecting entry to drive the `onLoadMore` path. The captured
      // callback is held on an object so a null-guard (not a cast) narrows it.
      const captured: { callback: IntersectionObserverCallback | null } = {
        callback: null,
      };

      class StubIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          captured.callback = callback;
        }
        observe(): void {
          /* no-op: intersection is simulated manually below */
        }
        unobserve(): void {
          /* no-op */
        }
        disconnect(): void {
          /* no-op */
        }
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
      }

      const globalScope = globalThis as { IntersectionObserver?: unknown };
      const original = globalScope.IntersectionObserver;
      globalScope.IntersectionObserver =
        StubIntersectionObserver as unknown as typeof IntersectionObserver;

      try {
        const onLoadMore = jest.fn();
        renderTable({
          userstories: [makeUserStory({ id: 1, ref: 1 })],
          project: makeModifyProject(),
          onLoadMore,
        });

        const { callback } = captured;
        if (!callback) {
          throw new Error(
            'Expected the IntersectionObserver callback to be captured',
          );
        }

        // Simulate the sentinel scrolling into view.
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );

        expect(onLoadMore).toHaveBeenCalledTimes(1);
      } finally {
        globalScope.IntersectionObserver = original;
      }
    });
  });

  /* ------------------------------------------------------------------ *
   * F-UI-02 / F-UI-04 / F-UI-06 / F-UI-07 — icons, a11y, i18n, emoji
   * ------------------------------------------------------------------ */
  describe('F-UI-02 sprite icons (shared TgSvg)', () => {
    it('renders the row drag handle, due-date and status icons as <tg-svg> hosts', () => {
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 1, due_date: '2025-02-01' })],
      });
      const row = getRow(container, 1);

      expect(
        row.querySelector('.draggable-us-row tg-svg svg.icon.icon-draggable use'),
      ).not.toBeNull();
      expect(
        row.querySelector('.due-date tg-svg svg.icon.icon-clock use'),
      ).not.toBeNull();
      expect(
        row.querySelector('a.us-status tg-svg svg.icon.icon-arrow-down use'),
      ).not.toBeNull();
    });
  });

  describe('F-UI-04 accessibility', () => {
    it('gives the bulk-select checkbox an accessible name', () => {
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 42 })],
      });
      const checkbox = mustQuery(getRow(container, 1), 'input[type="checkbox"]');
      expect(checkbox).toHaveAttribute('aria-label', 'Select user story #42');
    });

    it('exposes the status disclosure state and menu semantics', () => {
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 1 })],
      });
      const row = getRow(container, 1);
      const statusLink = mustQuery(row, US_STATUS);
      expect(statusLink).toHaveAttribute('aria-haspopup', 'menu');
      expect(statusLink).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(statusLink);
      expect(mustQuery(row, US_STATUS)).toHaveAttribute('aria-expanded', 'true');
      const popover = mustQuery(row, STATUS_POPOVER);
      expect(popover).toHaveAttribute('role', 'menu');
      expect(popover.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
    });
  });

  describe('F-UI-06 localized headers and status tooltip', () => {
    it('renders the localized column headers', () => {
      const { container } = renderTable();
      const header = mustQuery(container, HEADER_TITLE);

      expect(mustQuery(header, '.user-stories')).toHaveTextContent('User Story');
      expect(mustQuery(header, '.status')).toHaveTextContent('Status');
      expect(mustQuery(header, '.points')).toHaveAttribute(
        'title',
        'Select view per Role',
      );
    });

    it('localizes the row status tooltip', () => {
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 1 })],
      });
      expect(mustQuery(getRow(container, 1), US_STATUS)).toHaveAttribute(
        'title',
        'Status Name',
      );
    });
  });

  describe('F-UI-07 emojified story subject', () => {
    /** Publish a stub shell emoji table + version (as `app.coffee` does). */
    function installEmojiTable(): void {
      (window as unknown as { taiga?: unknown }).taiga = {
        emojis: [{ id: 'smile', name: 'smile', image: 'smile.png' }],
      };
      (window as unknown as { _version?: string })._version = 'v9';
    }

    afterEach(() => {
      delete (window as unknown as { taiga?: unknown }).taiga;
      delete (window as unknown as { _version?: string })._version;
    });

    it('renders `:shortcode:` tokens in the subject as <img class="emoji">', () => {
      installEmojiTable();
      const { container } = renderTable({
        userstories: [makeUserStory({ id: 1, ref: 1, subject: 'Do :smile: it' })],
      });
      const name = mustQuery(getRow(container, 1), '.user-story-name');
      const img = name.querySelector('img.emoji');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('/v9/emojis/smile.png');
    });
  });
});

