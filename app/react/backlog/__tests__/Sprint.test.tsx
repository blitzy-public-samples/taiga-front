/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Sprint.test.tsx
 * ---------------
 * Jest + React Testing Library unit spec for the React Backlog sprint composite
 * (`../components/Sprint`) and its module-local `MilestoneRow`. It contributes to
 * the >=70% line-coverage gate enforced over `app/react/**` (AAP 0.2.1 / 0.7.1)
 * and pins the structural + behavioural contract the component ports from the
 * legacy AngularJS `tgSprint` template (`sprint.jade`) and the `tgBacklogSprint`
 * fold/drag directives (`sprints.coffee` / `sortable.coffee`).
 *
 * COMPOSITE UNDER TEST — MOCK ONLY THE DnD LAYER, KEEP THE CHILDREN REAL:
 *   `Sprint` is the first NON-LEAF Backlog component: it composes the pure
 *   children `SprintHeader` + `ProgressBar` and owns its OWN `<SortableContext>`
 *   and `useDroppable`. This spec mocks ONLY the drag-and-drop layer
 *   (`@dnd-kit/core`, `@dnd-kit/sortable`, and the shared `../../shared/dnd/sortable`
 *   hook) so drag is inert and deterministic, but keeps `SprintHeader` and
 *   `ProgressBar` REAL — they are pure, already covered, and rendering them for
 *   real yields extra integration coverage AND lets us prove (via their rendered
 *   `.sprint-summary` / `.sprint-progress-bar` class names) that the composite
 *   actually mounts them. This is exactly the tradeoff the kanban `Column.test.tsx`
 *   makes with `WipLimit`.
 *
 * BEHAVIOURAL / MARKUP ORIGIN (reproduced by the component, NEVER imported — the
 * legacy AngularJS/CoffeeScript sources stay on the far side of the coexistence
 * boundary; referenced by short name only, never resolved or bundled):
 *   - `sprint.jade` — the EXACT DOM + class names the SCSS targets: the `<header>`,
 *     the `.summary-progress-wrapper > .sprint-progress-bar`, the `.sprint-table`
 *     (with `.sprint-empty-wrapper` when empty), the `.sprint-empty` two-span
 *     message, the `.row.milestone-us-item-row` rows, and the bottom `.btn-small`
 *     taskboard link.
 *   - `sprints.coffee:18-60` (`tgBacklogSprint`) — `toggleSprint` flips
 *     `.compact-sprint.active` AND `.sprint-table.open` together; the `.edit-sprint`
 *     click broadcasts `sprintform:edit` (here: the `onToggleFold` / `onEditSprint`
 *     props, wired through the REAL `SprintHeader`).
 *   - `backlog/sortable.coffee:39-63` — `isContainer: el.classList.contains(
 *     'sprint-table')` (the `.sprint-table` is the drop container -> `useDroppable`)
 *     and `moves: $(item).hasClass('row')` (the WHOLE row is the drag handle, so
 *     the row spreads BOTH `attributes` and `listeners`, with NO dedicated grip).
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file — AAP 0.6.2, 0.7):
 *   - Jest + jsdom ONLY. NO Playwright, NO real browser, NO network, NO timers.
 *   - The ONLY imports are `@testing-library/react`, the module under test
 *     (`../components/Sprint`), the three mocked DnD modules, and the type-only
 *     sprint/US models from `../state/backlogReducer`. No legacy AngularJS/
 *     CoffeeScript source, Jade partial, SCSS style, or compiled Angular-Elements
 *     bundle is ever pulled into the React test bundle.
 *   - React itself is NOT imported (automatic `react-jsx` runtime); `jest` is a
 *     global (`@types/jest`), never imported; `@testing-library/jest-dom` matchers
 *     (`toHaveClass`, `toBeInTheDocument`, `toHaveStyle`, `toHaveAttribute`) are
 *     auto-registered via the Jest `setupFilesAfterEnv` config, so they are
 *     available WITHOUT an import here.
 *   - `SprintHeader`, `ProgressBar`, and `../../shared/dnd/types` are deliberately
 *     NOT mocked (kept real). Only the DnD hooks/context are mocked.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock the DnD LAYER ONLY (three modules) so drag is inert and deterministic
// under jsdom. Every factory is self-contained (references no out-of-scope
// variable) as Jest hoisting requires; the per-test return values are (re)set in
// `beforeEach` below via the module-scope default helpers.
// ---------------------------------------------------------------------------

// `@dnd-kit/core`: Sprint imports ONLY `useDroppable` (verified against
// Sprint.tsx on disk). The mock returns an inert droppable so the `.sprint-table`
// ref is a no-op and no real DnD context is required.
jest.mock('@dnd-kit/core', () => ({
  __esModule: true,
  useDroppable: jest.fn(),
}));
import { useDroppable } from '@dnd-kit/core';

// `@dnd-kit/sortable`: Sprint imports `SortableContext` (a children passthrough
// here) and `verticalListSortingStrategy` (an inert sentinel). The passthrough
// returns its children directly so the REAL `.sprint-table` div (rendered by
// Sprint) still contains the rows / empty-state for our queries.
jest.mock('@dnd-kit/sortable', () => ({
  __esModule: true,
  SortableContext: (props: { children?: unknown }) => props.children,
  verticalListSortingStrategy: 'vertical-list-sorting-strategy',
}));

// `../../shared/dnd/sortable`: mock the `useSortableRow` hook to inert props so
// each `MilestoneRow` renders WITHOUT a real `@dnd-kit` DndContext/SortableContext.
// The `attributes` bag carries a `data-dnd="row"` marker so the spec can assert
// the WHOLE-ROW drag wiring (attributes+listeners spread onto the row itself).
jest.mock('../../shared/dnd/sortable', () => ({
  __esModule: true,
  useSortableRow: jest.fn(),
}));
import { useSortableRow } from '../../shared/dnd/sortable';

// The component under test (NAMED export — verified against Sprint.tsx on disk).
import { Sprint } from '../components/Sprint';
// Type-only sprint/US models (required by `isolatedModules: true`). The reducer's
// `Sprint` type is aliased to `SprintModel` so it does not collide with the
// component's own name `Sprint`.
import type { Sprint as SprintModel, UserStory } from '../state/backlogReducer';

// ---------------------------------------------------------------------------
// Typed handles on the mocked functions so we can inspect calls / control returns.
// ---------------------------------------------------------------------------
const mockUseDroppable = useDroppable as unknown as jest.Mock;
const mockUseSortableRow = useSortableRow as unknown as jest.Mock;

/**
 * Default INERT `useDroppable` return. Mirrors the real hook's shape closely
 * enough for the component (it only destructures `setNodeRef`). A fresh object
 * (with a fresh `setNodeRef` spy) is produced on each call so tests never share
 * mutable mock state.
 */
const droppableReturn = () => ({
  setNodeRef: jest.fn(),
  isOver: false,
  node: { current: null },
  rect: { current: null },
});

/**
 * Default NON-dragging `useSortableRow` return. Mirrors the real hook's
 * `SortableItemState` shape exactly (verified against `../../shared/dnd/sortable.ts`
 * on disk): `{ setNodeRef, attributes, listeners, style, isDragging, className }`.
 * `attributes` carries a `data-dnd="row"` marker so the spec can prove the row
 * receives the drag attributes; `className` is `''` while not dragging (so
 * `MilestoneRow` appends no extra class). A fresh object is produced on each call.
 */
const sortableRowReturn = () => ({
  setNodeRef: jest.fn(),
  attributes: { 'data-dnd': 'row' },
  listeners: { onKeyDown: jest.fn() },
  style: {},
  isDragging: false,
  className: '',
});

beforeEach(() => {
  // Clear call state, then restore the inert defaults. The config's
  // `clearMocks: true` (and this `clearAllMocks`) only clear `mock.calls`, not the
  // implementation — so we (re)install the default implementations here to make
  // every test start from a known, inert DnD state regardless of prior overrides.
  // `mockImplementation` (not `mockReturnValue`) is used so EACH call gets a fresh
  // object — important because a non-empty `Sprint` renders MULTIPLE rows.
  jest.clearAllMocks();
  mockUseDroppable.mockImplementation(() => droppableReturn());
  mockUseSortableRow.mockImplementation(() => sortableRowReturn());
});

// ---------------------------------------------------------------------------
// Fixtures + render helper
// ---------------------------------------------------------------------------

/**
 * Build a `UserStory`-shaped fixture. Includes EVERY field the `UserStory`
 * interface declares as required (`id`, `ref`, `milestone`, `project`,
 * `backlog_order`, `sprint_order`, `total_points`) — verified against
 * `../state/backlogReducer.ts` on disk — plus the index-signature fields the row
 * markup reads (`subject`, `is_closed`, `is_blocked`, `due_date`, `epics`).
 * `milestone` defaults to a truthy id so the row anchor (`ng-if="us.milestone"`)
 * renders by default. `over` is `Record<string, unknown>` (matching the sibling
 * `UserStoryRow.test.tsx` / `Card.test.tsx` convention) so index-signature extras
 * pass strict compilation; the result is cast to `UserStory`.
 */
const makeUs = (over: Record<string, unknown> = {}): UserStory =>
  ({
    id: 101,
    ref: 42,
    milestone: 1,
    project: 7,
    backlog_order: 1,
    sprint_order: 1,
    total_points: 3,
    subject: 'Do the thing',
    is_closed: false,
    is_blocked: false,
    due_date: null,
    epics: null,
    ...over,
  } as unknown as UserStory);

/**
 * Build a `Sprint` (reducer model) fixture. `Sprint extends Milestone`, so the
 * required `id`/`name`/`project`/`estimated_start`/`estimated_finish`/`closed`/
 * `total_points`/`user_stories` are provided explicitly; `closed_points` arrives
 * through the model's `[key: string]: unknown` index signature (read by the
 * component as `Number(sprint.closed_points) || 0`). `user_stories` defaults to
 * `[]` (empty sprint); pass `{ user_stories: [...] }` for the non-empty cases.
 */
const makeSprint = (over: Record<string, unknown> = {}): SprintModel =>
  ({
    id: 1,
    name: 'Sprint 1',
    project: 7,
    estimated_start: '2021-01-01',
    estimated_finish: '2021-01-15',
    closed: false,
    total_points: 20,
    closed_points: 5,
    user_stories: [],
    ...over,
  } as unknown as SprintModel);

/** The component's own props type, derived from its signature (no extra import). */
type SprintTestProps = Parameters<typeof Sprint>[0];

/**
 * Render `Sprint` with sensible defaults, merging per-test overrides. The three
 * callbacks and the URL builder are ALWAYS owned by this helper (assigned BEFORE
 * the `...over` spread but the spread can override them), so the returned `props`
 * expose the exact spies wired into the rendered component. Defaults model an
 * OPEN sprint the current user may view/edit/modify.
 */
const renderSprint = (over: Partial<SprintTestProps> = {}) => {
  const onToggleFold = jest.fn();
  const onEditSprint = jest.fn();
  const buildUserStoryUrl = jest.fn((us: UserStory) => `/project/proj/us/${us.ref}`);

  const props: SprintTestProps = {
    sprint: makeSprint(),
    isOpen: true,
    canViewMilestones: true,
    canEditSprint: true,
    canModifyUs: true,
    taskboardUrl: '/project/proj/taskboard/sprint-1',
    buildUserStoryUrl,
    onToggleFold,
    onEditSprint,
    ...over,
  };

  const utils = render(<Sprint {...props} />);
  return { ...utils, props };
};

/** The `.sprint-table` droppable container within a rendered Sprint fragment. */
const sprintTable = (container: HTMLElement): HTMLElement =>
  container.querySelector('.sprint-table') as HTMLElement;

/* ========================================================================== *
 * Phase C — Sprint fragment structure + `.sprint-table` classes / style
 * ========================================================================== */

describe('Sprint — fragment structure', () => {
  it('renders the four fragment siblings, mounting the REAL SprintHeader + ProgressBar', () => {
    // A couple of stories so every branch of the body renders.
    const { container } = renderSprint({
      sprint: makeSprint({ user_stories: [makeUs({ id: 201, ref: 1 }), makeUs({ id: 202, ref: 2 })] }),
    });

    // (1) `<header>` wrapping the REAL SprintHeader. The `.sprint-summary` class is
    // rendered by SprintHeader itself, so its presence proves the real child
    // mounted (not a stub). // adjusted per Sprint.tsx on disk
    const header = container.querySelector('header');
    expect(header).toBeInTheDocument();
    expect(header!.querySelector('.sprint-summary')).toBeInTheDocument();

    // (2) `.summary-progress-wrapper` containing the REAL ProgressBar, whose
    // `variant="sprint"` render is the `.sprint-progress-bar` host.
    const progressWrapper = container.querySelector('.summary-progress-wrapper');
    expect(progressWrapper).toBeInTheDocument();
    expect(progressWrapper!.querySelector('.sprint-progress-bar')).toBeInTheDocument();

    // (3) `.sprint-table` (the droppable + sortable body).
    expect(sprintTable(container)).toBeInTheDocument();

    // (4) the bottom `a.btn-small` view-milestones link (present because
    // canViewMilestones defaults to true).
    const link = container.querySelector('a.btn-small');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/project/proj/taskboard/sprint-1');
    // Single render in this test, so `screen` queries are unambiguous; the link
    // wraps the "Sprint Taskboard" label span.
    expect(link).toContainElement(screen.getByText('Sprint Taskboard'));
  });

  it('when OPEN: `.sprint-table` has the `open` class and inline display:block', () => {
    const { container } = renderSprint({ isOpen: true });
    const table = sprintTable(container);
    expect(table).toHaveClass('sprint-table', 'open');
    expect(table).toHaveStyle({ display: 'block' });
  });

  it('when CLOSED: `.sprint-table` has NO `open` class and inline display:none', () => {
    const { container } = renderSprint({ isOpen: false });
    const table = sprintTable(container);
    expect(table).toHaveClass('sprint-table');
    expect(table).not.toHaveClass('open');
    expect(table).toHaveStyle({ display: 'none' });
  });

  it('an EMPTY sprint adds `sprint-empty-wrapper` and renders `.sprint-empty` (no rows)', () => {
    const { container } = renderSprint({ sprint: makeSprint({ user_stories: [] }) });
    const table = sprintTable(container);
    expect(table).toHaveClass('sprint-table', 'sprint-empty-wrapper');

    // The empty-state message with its two (permission-gated) spans.
    const empty = table.querySelector('.sprint-empty');
    expect(empty).toBeInTheDocument();
    expect(empty!.querySelectorAll('span')).toHaveLength(2);

    // No milestone rows are rendered for an empty sprint.
    expect(table.querySelector('.milestone-us-item-row')).not.toBeInTheDocument();
  });

  it('a NON-EMPTY sprint renders one `.milestone-us-item-row` per story and NO `.sprint-empty`', () => {
    const { container } = renderSprint({
      sprint: makeSprint({
        user_stories: [makeUs({ id: 301, ref: 11 }), makeUs({ id: 302, ref: 12 }), makeUs({ id: 303, ref: 13 })],
      }),
    });
    const table = sprintTable(container);
    expect(table.querySelectorAll('.milestone-us-item-row')).toHaveLength(3);
    expect(table.querySelector('.sprint-empty')).not.toBeInTheDocument();
  });

  it('does NOT add `sprint-empty-wrapper` when the sprint has stories', () => {
    const { container } = renderSprint({
      sprint: makeSprint({ user_stories: [makeUs({ id: 401 })] }),
    });
    expect(sprintTable(container)).not.toHaveClass('sprint-empty-wrapper');
  });

  it('registers the droppable with the `sprint-<id>` id + { sprintId, isBacklog:false } data', () => {
    // This locks the drop-target contract the shared drag-end handler relies on to
    // route a drop into a SPRINT (isBacklog:false) vs the backlog list
    // (see shared/dnd/types `BacklogDragResult` + backlog/sortable.coffee isContainer).
    renderSprint({ sprint: makeSprint({ id: 7 }) });
    const arg = mockUseDroppable.mock.calls[0][0];
    expect(arg.id).toBe('sprint-7');
    expect(arg.data).toEqual({ sprintId: 7, isBacklog: false });
  });
});

/* ========================================================================== *
 * Phase D — `MilestoneRow` contracts (the `.row.milestone-us-item-row` rows)
 * ========================================================================== */

/** Render a sprint containing exactly one story and return its row element. */
const renderSingleRow = (usOver: Record<string, unknown> = {}, propsOver: Partial<SprintTestProps> = {}) => {
  const us = makeUs(usOver);
  const { container, props } = renderSprint({
    sprint: makeSprint({ user_stories: [us] }),
    ...propsOver,
  });
  const row = container.querySelector('.milestone-us-item-row') as HTMLElement;
  return { container, props, us, row };
};

describe('MilestoneRow — row element + state modifiers', () => {
  it('renders `.row.milestone-us-item-row` with `data-id` equal to the story id', () => {
    const { row } = renderSingleRow({ id: 555 });
    expect(row).toBeInTheDocument();
    expect(row).toHaveClass('row', 'milestone-us-item-row');
    // `data-id` is set from the numeric `us.id`; React stringifies it.
    expect(row).toHaveAttribute('data-id', '555');
  });

  it('adds `closedRow` when the story is closed', () => {
    const { row } = renderSingleRow({ is_closed: true });
    expect(row).toHaveClass('closedRow');
  });

  it('adds `blockedRow` when the story is blocked', () => {
    const { row } = renderSingleRow({ is_blocked: true });
    expect(row).toHaveClass('blockedRow');
  });

  it('adds `readonly` only when the user cannot modify user stories', () => {
    expect(renderSingleRow({}, { canModifyUs: false }).row).toHaveClass('readonly');
    expect(renderSingleRow({}, { canModifyUs: true }).row).not.toHaveClass('readonly');
  });

  it('carries neither state class for a plain open, unblocked story', () => {
    const { row } = renderSingleRow({ is_closed: false, is_blocked: false });
    expect(row).not.toHaveClass('closedRow');
    expect(row).not.toHaveClass('blockedRow');
    expect(row).not.toHaveClass('readonly');
  });

  it('spreads the drag attributes/listeners onto the ROW itself with NO separate handle', () => {
    // whole-row drag: listeners on row, no handle (parity with sprint.jade milestone rows)
    // The mocked `useSortableRow` returns `attributes: { 'data-dnd': 'row' }`; that
    // marker must land on the `.milestone-us-item-row` element (proving the row is
    // the drag handle). Unlike the backlog body rows there is NO `.draggable-us-row`
    // grip inside the row.
    const { row } = renderSingleRow();
    expect(row).toHaveAttribute('data-dnd', 'row');
    expect(row.querySelector('.draggable-us-row')).not.toBeInTheDocument();
  });

  it('calls useSortableRow with the story id and the { usId } data bag', () => {
    renderSingleRow({ id: 909 });
    expect(mockUseSortableRow).toHaveBeenCalledWith(909, { usId: 909 });
  });
});

describe('MilestoneRow — `.column-us` anchor', () => {
  it('renders `a.us-name.clickable` (with the detail href + title) when assigned to a milestone', () => {
    const { row, us } = renderSingleRow({ milestone: 1, ref: 42, subject: 'Do the thing' });
    const anchor = row.querySelector('.column-us a.us-name.clickable') as HTMLElement;
    expect(anchor).toBeInTheDocument();
    // `detailUrl` comes from the `buildUserStoryUrl(us)` spy (`/project/proj/us/<ref>`).
    expect(anchor).toHaveAttribute('href', `/project/proj/us/${us.ref}`);
    // `title` reproduces `tg-bo-title="'#' + us.ref + ' ' + us.subject"`.
    expect(anchor).toHaveAttribute('title', '#42 Do the thing');
  });

  it('adds `closed` / `blocked` modifier classes on the anchor matching the story state', () => {
    const closed = renderSingleRow({ is_closed: true }).row.querySelector('a.us-name');
    expect(closed).toHaveClass('closed');
    const blocked = renderSingleRow({ is_blocked: true }).row.querySelector('a.us-name');
    expect(blocked).toHaveClass('blocked');
  });

  it('renders NO anchor (empty `.column-us`) when the story is NOT assigned to a milestone', () => {
    // The anchor is guarded by `ng-if="us.milestone"`; a falsy milestone (null)
    // leaves `.column-us` empty. // adjusted per Sprint.tsx on disk
    const { row } = renderSingleRow({ milestone: null });
    const columnUs = row.querySelector('.column-us') as HTMLElement;
    expect(columnUs).toBeInTheDocument();
    expect(columnUs.querySelector('a.us-name')).not.toBeInTheDocument();
  });

  it('renders `.us-ref-text` as "#<ref> " INCLUDING the trailing space', () => {
    // #ref with TRAILING SPACE — exact parity (tgBoRef renders `"#<ref> "`; the
    // trailing space is the load-bearing separator, there is NO CSS margin on
    // `.us-ref-text`). Use an exact `.textContent` compare — `toHaveTextContent`
    // TRIMS and would hide a regression here.
    const { row } = renderSingleRow({ ref: 42 });
    const refText = row.querySelector('.us-ref-text') as HTMLElement;
    expect(refText).toBeInTheDocument();
    expect(refText.textContent).toBe('#42 ');
  });

  it('renders `.us-name-text` with the story subject', () => {
    const { row } = renderSingleRow({ subject: 'Refine the widget' });
    const nameText = row.querySelector('.us-name-text') as HTMLElement;
    expect(nameText).toBeInTheDocument();
    expect(nameText.textContent).toBe('Refine the widget');
  });
});

describe('MilestoneRow — `.column-points` cell (total_points guard)', () => {
  it('renders `.column-points.width-1 > .points-container` with the points when present', () => {
    const { row } = renderSingleRow({ total_points: 8 });
    const points = row.querySelector('.column-points.width-1') as HTMLElement;
    expect(points).toBeInTheDocument();
    const container = points.querySelector('.points-container') as HTMLElement;
    expect(container).toBeInTheDocument();
    expect(container.textContent).toBe('8');
  });

  it('omits the points cell entirely when the story has no points', () => {
    // `ng-if="us.total_points"` -> a falsy (0) total renders no `.column-points`.
    const { row } = renderSingleRow({ total_points: 0 });
    expect(row.querySelector('.column-points')).not.toBeInTheDocument();
  });

  it('mirrors `closed` / `blocked` onto the points cell', () => {
    const closed = renderSingleRow({ total_points: 5, is_closed: true }).row.querySelector('.column-points');
    expect(closed).toHaveClass('closed');
    const blocked = renderSingleRow({ total_points: 5, is_blocked: true }).row.querySelector('.column-points');
    expect(blocked).toHaveClass('blocked');
  });
});

describe('MilestoneRow — inert custom-element hosts + drag class', () => {
  it('renders the inert `tg-belong-to-epics.us-epic-container` host only when the story has epics', () => {
    const withEpics = renderSingleRow({ epics: [{ id: 1 }] }).row.querySelector('.us-epic-container');
    expect(withEpics).toBeInTheDocument();
    expect(withEpics!.tagName.toLowerCase()).toBe('tg-belong-to-epics');
    expect(withEpics).toHaveAttribute('format', 'pill');

    // No epics -> the host is absent (parity with `ng-if="us.epics"`).
    expect(renderSingleRow({ epics: null }).row.querySelector('.us-epic-container')).not.toBeInTheDocument();
  });

  it('renders the inert `tg-due-date.due-date` host only when the story has a due date', () => {
    const withDue = renderSingleRow({ due_date: '2021-02-01' }).row.querySelector('.due-date');
    expect(withDue).toBeInTheDocument();
    expect(withDue!.tagName.toLowerCase()).toBe('tg-due-date');

    // No due date -> the host is absent (parity with `ng-if="us.due_date"`).
    expect(renderSingleRow({ due_date: null }).row.querySelector('.due-date')).not.toBeInTheDocument();
  });

  it('appends the hook `className` (e.g. `gu-transit`) onto the row while dragging', () => {
    // The real `useSortableRow` returns `className: 'gu-transit'` while dragging;
    // MilestoneRow appends it (`if (dndClassName) rowClasses.push(dndClassName)`).
    // The mock is overridden for the single row rendered by this test.
    mockUseSortableRow.mockImplementationOnce(() => ({
      ...sortableRowReturn(),
      isDragging: true,
      className: 'gu-transit',
    }));
    const { row } = renderSingleRow();
    expect(row).toHaveClass('milestone-us-item-row', 'gu-transit');
  });
});

describe('Sprint — point coercion fallbacks', () => {
  it('coerces missing closed_points / total_points to 0 (ProgressBar renders 0%)', () => {
    // `closedPoints = Number(sprint.closed_points) || 0`, likewise total_points.
    // With both absent the REAL sprint ProgressBar renders `.current-progress` at
    // width 0% (guarded `total > 0 ? ... : 0`).
    const { container } = renderSprint({
      sprint: makeSprint({ closed_points: undefined, total_points: undefined }),
    });
    const bar = container.querySelector('.sprint-progress-bar .current-progress') as HTMLElement;
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveStyle({ width: '0%' });
  });
});

/* ========================================================================== *
 * Phase E — Permission gates + interaction wiring (through the REAL SprintHeader)
 * ========================================================================== */

describe('Sprint — permission gates', () => {
  it('shows the bottom `a.btn-small` view link ONLY when canViewMilestones is true', () => {
    expect(renderSprint({ canViewMilestones: true }).container.querySelector('a.btn-small')).toBeInTheDocument();
    expect(
      renderSprint({ canViewMilestones: false }).container.querySelector('a.btn-small'),
    ).not.toBeInTheDocument();
  });

  it('gates the empty-state spans: editor hides the anonymous msg, reader hides the drop hint', () => {
    // `tg-class-permission="{'hidden': 'modify_us'}"` -> the anonymous "no user
    // stories" message is `hidden` for users who CAN modify (editors); the "Drop
    // here..." hint is `hidden` for users who CANNOT modify (readers).
    const anon = 'This sprint has no user stories';
    const dropHint = 'Drop here Stories from your backlog to start a new sprint';

    // Editor (canModifyUs=true): anonymous message hidden, drop hint visible.
    const editor = renderSprint({ sprint: makeSprint({ user_stories: [] }), canModifyUs: true });
    expect(within(sprintTable(editor.container)).getByText(anon)).toHaveClass('hidden');
    expect(within(sprintTable(editor.container)).getByText(dropHint)).not.toHaveClass('hidden');

    // Reader (canModifyUs=false): anonymous message visible, drop hint hidden.
    const reader = renderSprint({ sprint: makeSprint({ user_stories: [] }), canModifyUs: false });
    expect(within(sprintTable(reader.container)).getByText(anon)).not.toHaveClass('hidden');
    expect(within(sprintTable(reader.container)).getByText(dropHint)).toHaveClass('hidden');
  });

  it('applies the row `readonly` gate from canModifyUs on the milestone rows', () => {
    const readonly = renderSingleRow({}, { canModifyUs: false });
    expect(readonly.row).toHaveClass('readonly');
    const editable = renderSingleRow({}, { canModifyUs: true });
    expect(editable.row).not.toHaveClass('readonly');
  });
});

describe('Sprint — interaction wiring (through the real SprintHeader)', () => {
  it('clicking the `.compact-sprint` fold toggle invokes onToggleFold', () => {
    // The toggle button is rendered by the REAL SprintHeader; Sprint wires its
    // onClick to the `onToggleFold` prop (declarative form of sprints.coffee
    // `toggleSprint`). This exercises the composite -> child callback path.
    const { container, props } = renderSprint();
    const toggle = container.querySelector('.compact-sprint') as HTMLElement;
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(props.onToggleFold).toHaveBeenCalledTimes(1);
  });

  it('clicking the `.edit-sprint` pencil (when editable) invokes onEditSprint', () => {
    // The edit pencil is rendered by the REAL SprintHeader only when canEditSprint
    // is true; Sprint wires its onClick to `onEditSprint` (declarative form of the
    // sprints.coffee `sprintform:edit` broadcast).
    const { container, props } = renderSprint({ canEditSprint: true });
    const edit = container.querySelector('.edit-sprint') as HTMLElement;
    expect(edit).toBeInTheDocument();
    fireEvent.click(edit);
    expect(props.onEditSprint).toHaveBeenCalledTimes(1);
  });

  it('does not render the `.edit-sprint` pencil when canEditSprint is false', () => {
    const { container } = renderSprint({ canEditSprint: false });
    expect(container.querySelector('.edit-sprint')).not.toBeInTheDocument();
  });
});
