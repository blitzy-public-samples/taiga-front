/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * UserStoryRow.test.tsx
 * ---------------------
 * Jest + React Testing Library unit spec for the React Backlog user-story row
 * (`../components/UserStoryRow`). It contributes to the >=70% line-coverage
 * gate enforced over `app/react/**` (AAP 0.2.1 / 0.7.1) and pins the
 * behavioural + structural contract the component ports from the legacy
 * AngularJS backlog row.
 *
 * BEHAVIOURAL / MARKUP ORIGIN (reproduced here, NEVER imported — the legacy
 * AngularJS/CoffeeScript sources stay on the far side of the coexistence
 * boundary; referenced by short name only, they are never resolved or bundled):
 *   - `backlog-row.jade` — the EXACT DOM + class names the SCSS targets
 *     (`.row.us-item-row`, `.us-item-row-left`, `.draggable-us-row`,
 *     `.custom-checkbox`, `.user-story-link`, `.user-story-number`,
 *     `.user-story-name`, `.tag`, `.belong-to-epic-pill`, `.us-status`,
 *     `.us-status-bind`, `.points`, `.us-option-popup-button`).
 *   - `backlog/main.coffee` — the checkbox shift-range selection handler
 *     (main.coffee:819-854: `shiftPressed`/`lastChecked`, toggling the
 *     `ui-multisortable-multiple` class), `ctrl.showTags` (main.coffee:238) and
 *     `first_us_in_backlog` (main.coffee:509).
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file — AAP 0.6.2, 0.7):
 *   - Jest + jsdom only. NO Playwright, NO real browser, NO network, NO timers.
 *   - The ONLY imports are the module under test, the mocked DnD sortable hook,
 *     the REAL shared DnD `types` (so `DND_CLASS` is authentic), the type-only
 *     `UserStory`, and `@testing-library/react`. No legacy AngularJS/CoffeeScript
 *     source, Jade partial, SCSS style, or compiled Angular-Elements bundle is
 *     ever pulled into the React test bundle.
 *   - React itself is NOT imported (automatic `react-jsx` runtime); `jest` is a
 *     global (from `@types/jest`), never imported; `@testing-library/jest-dom`
 *     is auto-registered via the Jest `setupFilesAfterEnv` config, so its
 *     matchers (`toHaveClass`, `toBeChecked`, `toBeInTheDocument`,
 *     `toHaveAttribute`) are available WITHOUT an import here.
 *   - `../../shared/dnd/sortable` (the `useSortableRow` hook) is mocked so the
 *     row renders with a controlled, deterministic, INERT drag state and
 *     WITHOUT a real `@dnd-kit` `DndContext`/`SortableContext` provider. This is
 *     the same mock boundary the kanban `Card.test.tsx` uses.
 *   - `../../shared/dnd/types` is deliberately NOT mocked — the `DND_CLASS`
 *     constant is a pure object and must stay REAL so the class-name contract
 *     (`gu-transit`, `ui-multisortable-multiple`) is asserted authentically.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';

// Mock ONLY the DnD sortable hook so the row can be rendered with a controlled,
// inert drag state (no real @dnd-kit, no DndContext). The factory is
// self-contained (references no out-of-scope variables) as Jest requires; the
// per-test return value is (re)set in `beforeEach` below via `mockReturnValue`.
jest.mock('../../shared/dnd/sortable', () => ({
  __esModule: true,
  useSortableRow: jest.fn(),
}));
import { useSortableRow } from '../../shared/dnd/sortable';

import { UserStoryRow } from '../components/UserStoryRow';
// REAL constant (NOT mocked): DND_CLASS.transit === 'gu-transit',
// DND_CLASS.selected === 'ui-multisortable-multiple'.
import { DND_CLASS } from '../../shared/dnd/types';
// Type-only import (required by `isolatedModules: true`).
import type { UserStory } from '../state/backlogReducer';

/** Typed handle on the mocked hook so we can control its per-test return. */
const mockUseSortableRow = useSortableRow as unknown as jest.Mock;

/**
 * The default, NON-dragging `useSortableRow` return. Mirrors the real hook's
 * `SortableItemState` shape exactly (verified against
 * `../../shared/dnd/sortable.ts` on disk): `{ setNodeRef, attributes, listeners,
 * style, isDragging, className }`. `className` is `''` while not dragging.
 * A fresh object (with a fresh `setNodeRef` spy) is produced on each call so
 * tests never share mutable mock state.
 */
const baseSortable = () => ({
  setNodeRef: jest.fn(),
  attributes: {},
  listeners: {},
  style: {},
  isDragging: false,
  className: '',
});

/**
 * Switch the mocked hook into the "dragging" state for the NEXT render. The real
 * hook returns `className: DND_CLASS.transit` (`'gu-transit'`) while dragging, so
 * the component appends `gu-transit` to the row's class list. Call this BEFORE
 * `renderRow(...)` inside a test; `beforeEach` resets it back to non-dragging.
 */
const mockDragging = () =>
  mockUseSortableRow.mockReturnValue({
    ...baseSortable(),
    isDragging: true,
    className: DND_CLASS.transit,
  });

/**
 * Build a `UserStory`-shaped fixture. Includes EVERY field the `UserStory`
 * interface declares as required (`id`, `ref`, `milestone`, `project`,
 * `backlog_order`, `sprint_order`, `total_points`) — verified against
 * `../state/backlogReducer.ts` on disk — plus the optional/index-signature
 * fields the row markup reads (`new`, `tags`, `subject`, `is_blocked`,
 * `due_date`, `epics`). `over` is `Record<string, unknown>` (matching the
 * `Card.test.tsx` fixture convention) so index-signature extras and tuple
 * `tags` overrides pass strict compilation; the result is cast to `UserStory`.
 */
const makeUs = (over: Record<string, unknown> = {}): UserStory =>
  ({
    id: 1,
    ref: 42,
    milestone: null,
    project: 7,
    backlog_order: 1,
    sprint_order: 1,
    total_points: 3,
    status: 1,
    new: false,
    tags: [['ui', '#fff']],
    subject: 'Do the thing',
    is_blocked: false,
    due_date: null,
    epics: [],
    status_extra_info: { name: 'New', color: '#999' },
    ...over,
  } as unknown as UserStory);

/**
 * Full `UserStoryRow` props with sensible defaults; override per test. The props
 * type is derived from the component itself (`Parameters<typeof UserStoryRow>[0]`)
 * so no extra import is needed and the defaults stay in lock-step with the
 * component's real signature.
 */
type RowProps = Parameters<typeof UserStoryRow>[0];

const makeProps = (over: Partial<RowProps> = {}): RowProps => ({
  us: makeUs(),
  showTags: true,
  selected: false,
  canModify: true,
  isFirstInBacklog: false,
  detailUrl: '/project/proj-slug/us/42',
  statusName: 'New',
  pointsLabel: '3',
  onToggleSelect: jest.fn(),
  onStatusClick: jest.fn(),
  onOptionsClick: jest.fn(),
  ...over,
});

/**
 * Render the row with merged defaults and return the RTL utils plus the resolved
 * `props` and the root `.us-item-row` element for convenient assertions.
 */
const renderRow = (over: Partial<RowProps> = {}) => {
  const props = makeProps(over);
  const utils = render(<UserStoryRow {...props} />);
  const root = utils.container.querySelector('.us-item-row') as HTMLElement;
  return { ...utils, props, root };
};

/** Convenience: the controlled multi-select checkbox inside a rendered row. */
const getCheckbox = (root: HTMLElement) =>
  root.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

beforeEach(() => {
  // Reset call state AND restore the non-dragging default. `jest.clearAllMocks`
  // (and the config's `clearMocks: true`) only clear `mock.calls`, NOT the
  // implementation set via `mockReturnValue`, so a prior `mockDragging()` would
  // otherwise leak into this test — hence the explicit reset here.
  jest.clearAllMocks();
  mockUseSortableRow.mockReturnValue(baseSortable());
});

/* ========================================================================== *
 * Root row element: base classes, data-id, state modifiers, drag state
 * ========================================================================== */

describe('root row element and drag state', () => {
  it('renders a .row.us-item-row with data-id equal to the story id', () => {
    const { root } = renderRow({ us: makeUs({ id: 1 }) });
    expect(root).toBeInTheDocument();
    expect(root).toHaveClass('row', 'us-item-row');
    // `data-id` is set from the numeric `us.id`; React stringifies it to "1".
    expect(root).toHaveAttribute('data-id', '1');
  });

  it('adds the "blocked" class when the story is blocked', () => {
    const { root } = renderRow({ us: makeUs({ is_blocked: true }) });
    expect(root).toHaveClass('blocked');
  });

  it('adds the "new" class for a newly-created story', () => {
    const { root } = renderRow({ us: makeUs({ new: true }) });
    expect(root).toHaveClass('new');
  });

  it('adds the "readonly" class only when the user cannot modify', () => {
    expect(renderRow({ canModify: false }).root).toHaveClass('readonly');
    expect(renderRow({ canModify: true }).root).not.toHaveClass('readonly');
  });

  it('marks a selected row with ui-multisortable-multiple + is-checked', () => {
    const { root } = renderRow({ selected: true });
    // `DND_CLASS.selected` is the REAL constant ('ui-multisortable-multiple').
    expect(root).toHaveClass(DND_CLASS.selected, 'is-checked');
  });

  it('carries neither selection class when not selected', () => {
    const { root } = renderRow({ selected: false });
    expect(root).not.toHaveClass(DND_CLASS.selected);
    expect(root).not.toHaveClass('is-checked');
  });

  it('appends gu-transit while dragging', () => {
    // gu-transit applied via useSortableRow className when dragging.
    mockDragging();
    const { root } = renderRow();
    expect(root).toHaveClass('gu-transit');
  });

  it('does not carry gu-transit when not dragging', () => {
    const { root } = renderRow();
    expect(root).not.toHaveClass('gu-transit');
  });

  it('calls useSortableRow with the story id and the { usId } data bag', () => {
    renderRow({ us: makeUs({ id: 1 }) });
    expect(mockUseSortableRow).toHaveBeenCalledWith(1, { usId: 1 });
  });

  it('M-18/M-19: the drag grip carries NO false-affordance ARIA (role/roledescription/tabindex)', () => {
    // The row grip must match the legacy inert `.draggable-us-row` div. The real
    // `useSortableRow` suppresses the @dnd-kit `role="button"`/`aria-roledescription`
    // /`tabindex`/`aria-describedby` (proven in shared/dnd/__tests__/sortable.test.tsx);
    // here we lock in that the component itself hardcodes none of them on the grip.
    const { root } = renderRow({ canModify: true });
    const grip = root.querySelector('.draggable-us-row') as HTMLElement;
    expect(grip).toBeInTheDocument();
    expect(grip.getAttribute('role')).toBeNull();
    expect(grip.getAttribute('tabindex')).toBeNull();
    expect(grip.getAttribute('aria-roledescription')).toBeNull();
    expect(grip.getAttribute('aria-describedby')).toBeNull();
  });
});

/* ========================================================================== *
 * Left cell: drag handle + multi-select checkbox (canModify gate + shift-click)
 * ========================================================================== */

describe('left cell: drag handle and checkbox', () => {
  it('renders the drag handle and the checkbox when the user can modify', () => {
    const { root } = renderRow({ canModify: true });
    const leftCell = root.querySelector('.us-item-row-left') as HTMLElement;
    expect(leftCell).toBeInTheDocument();

    // The `.draggable-us-row` grip carries the @dnd-kit attributes/listeners and
    // renders the draggable icon (matching backlog-row.jade:16-17).
    const handle = leftCell.querySelector('.draggable-us-row');
    expect(handle).toBeInTheDocument();
    expect(handle!.querySelector('svg.icon-draggable')).toBeInTheDocument();

    // The custom checkbox lives in the same cell.
    expect(leftCell.querySelector('.custom-checkbox')).toBeInTheDocument();
    expect(within(leftCell).getByRole('checkbox')).toBeInTheDocument();
  });

  it('hides BOTH the handle and the checkbox when the user cannot modify', () => {
    const { root } = renderRow({ canModify: false });
    expect(root.querySelector('.draggable-us-row')).toBeNull();
    expect(getCheckbox(root)).toBeNull();
    // ...and the whole row is marked readonly.
    expect(root).toHaveClass('readonly');
  });

  it('reflects `selected` on the controlled checkbox (checked)', () => {
    const { root } = renderRow({ selected: true });
    expect(getCheckbox(root)).toBeChecked();
  });

  it('reflects `selected` on the controlled checkbox (unchecked)', () => {
    const { root } = renderRow({ selected: false });
    expect(getCheckbox(root)).not.toBeChecked();
  });

  it('shift-clicking the checkbox calls onToggleSelect(id, true)', () => {
    // shift-range selection origin: tgBacklog checkbox handler main.coffee.
    const onToggleSelect = jest.fn();
    const { root } = renderRow({ us: makeUs({ id: 1 }), onToggleSelect });
    const checkbox = getCheckbox(root) as HTMLInputElement;
    fireEvent.click(checkbox, { shiftKey: true });
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onToggleSelect).toHaveBeenCalledWith(1, true);
  });

  it('plain-clicking the checkbox calls onToggleSelect(id, false)', () => {
    const onToggleSelect = jest.fn();
    const { root } = renderRow({ us: makeUs({ id: 1 }), onToggleSelect });
    const checkbox = getCheckbox(root) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onToggleSelect).toHaveBeenCalledWith(1, false);
  });
});

/* ========================================================================== *
 * Main data: US link (#ref + name), due-date badge, tag pills, epic pills
 * ========================================================================== */

describe('main data: link, due-date, tags and epics', () => {
  it('renders the US link with #ref, the subject, and the resolved href', () => {
    const { root } = renderRow({
      us: makeUs({ ref: 42, subject: 'Do the thing' }),
      detailUrl: '/project/proj-slug/us/42',
    });
    const link = root.querySelector('a.user-story-link') as HTMLAnchorElement;
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/project/proj-slug/us/42');
    // `#` + ref for the number; plain subject for the name.
    expect(screen.getByText('#42')).toHaveClass('user-story-number');
    expect(root.querySelector('.user-story-name')).toHaveTextContent('Do the thing');
  });

  it('renders one .tag per tag (with the LAST one flagged) when showTags is on', () => {
    const { root } = renderRow({
      us: makeUs({
        tags: [
          ['ui', '#fff'],
          ['bug', '#f00'],
        ],
      }),
      showTags: true,
    });
    const tags = root.querySelectorAll('.tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]).not.toHaveClass('last');
    expect(tags[1]).toHaveClass('tag', 'last');
    // The tag label is both the title attribute and the text content.
    expect(tags[0]).toHaveAttribute('title', 'ui');
    expect(tags[0]).toHaveTextContent('ui');
  });

  it('renders NO tags when showTags is off', () => {
    const { container } = renderRow({ showTags: false });
    expect(container.querySelectorAll('.tag')).toHaveLength(0);
  });

  it('renders a belong-to-epic pill per epic with the "#ref subject" title', () => {
    const { root } = renderRow({
      us: makeUs({ epics: [{ ref: 7, subject: 'Epic A', color: '#abcdef' }] }),
    });
    const pills = root.querySelectorAll('.belong-to-epic-pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveAttribute('title', '#7 Epic A');
  });

  it('renders no epic pill when the story has no epics', () => {
    const { root } = renderRow({ us: makeUs({ epics: [] }) });
    expect(root.querySelector('.belong-to-epic-pill')).toBeNull();
  });

  it('renders the NATIVE due-date badge (clock icon + fill + tooltip) only when the story has a due date (M-11)', () => {
    // M-11: the backlog row now renders the due-date NATIVELY via the shared
    // `DueDateBadge` (the legacy `tg-due-date` directive never $compiled inside
    // the React host, so no clock badge appeared). Reproduces `due-date-icon.jade`:
    // `tg-due-date.due-date > tg-svg.due-date-icon > svg.icon.icon-clock`.
    const withDue = renderRow({ us: makeUs({ due_date: '2025-01-01' }) });
    const host = withDue.root.querySelector('.due-date');
    expect(host).toBeInTheDocument();
    expect(host!.tagName.toLowerCase()).toBe('tg-due-date');

    const icon = host!.querySelector('.due-date-icon');
    expect(icon).toBeInTheDocument();
    const svg = icon!.querySelector('svg.icon.icon-clock');
    expect(svg).toBeInTheDocument();
    // A far-past due date resolves to the "past due" appearance (#E44057).
    // `toHaveStyle` normalises the colour on both sides (jsdom hex/rgb quirk).
    expect(svg).toHaveStyle({ fill: '#E44057' });
    // Tooltip via COMMON.CARD.DUE_DATE ("Due date: <formatted> (past due)").
    const title = svg!.querySelector('title');
    expect(title!.textContent).toContain('Due date:');
    expect(title!.textContent).toContain('(past due)');

    // No due date -> the badge is absent (parity with `ng-if="us.due_date"`).
    const withoutDue = renderRow({ us: makeUs({ due_date: null }) });
    expect(withoutDue.root.querySelector('tg-due-date')).toBeNull();
    expect(withoutDue.root.querySelector('.due-date')).toBeNull();
  });
});

/* ========================================================================== *
 * Status link, points cell and options (⋮) button
 * ========================================================================== */

describe('status, points and options', () => {
  it('renders the status name inside .us-status > .us-status-bind', () => {
    const { root } = renderRow({ statusName: 'In progress' });
    const status = root.querySelector('.status a.us-status') as HTMLElement;
    expect(status).toBeInTheDocument();
    expect(root.querySelector('.us-status-bind')).toHaveTextContent('In progress');
  });

  it('shows the status dropdown arrow only when the user can modify', () => {
    expect(
      renderRow({ canModify: true }).root.querySelector('.us-status svg.icon-arrow-down'),
    ).toBeInTheDocument();
    expect(
      renderRow({ canModify: false }).root.querySelector('.us-status svg.icon-arrow-down'),
    ).toBeNull();
  });

  it('applies the status colour as an inline style when provided', () => {
    const { root } = renderRow({ statusColor: '#123456' });
    const status = root.querySelector('a.us-status') as HTMLElement;
    // The exact serialised colour is jsdom-dependent; assert the style is set.
    expect(status.getAttribute('style') ?? '').toContain('color');
  });

  it('threads a status-link click to onStatusClick(id) (default prevented)', () => {
    const onStatusClick = jest.fn();
    const { root } = renderRow({ us: makeUs({ id: 1 }), onStatusClick });
    fireEvent.click(root.querySelector('a.us-status') as HTMLElement);
    expect(onStatusClick).toHaveBeenCalledWith(1);
  });

  it('renders the points label in the .points cell', () => {
    const { root } = renderRow({ pointsLabel: '8' });
    expect(root.querySelector('.points')).toHaveTextContent('8');
  });

  it('renders the options button only when the user can modify', () => {
    const canModify = renderRow({ canModify: true });
    expect(
      canModify.root.querySelector('button.us-option-popup-button.js-popup-button'),
    ).toBeInTheDocument();

    const readOnly = renderRow({ canModify: false });
    expect(readOnly.root.querySelector('.us-option')).toBeNull();
    expect(readOnly.root.querySelector('.us-option-popup-button')).toBeNull();
  });

  it('adds the "first" class to the options button for the first backlog row', () => {
    const first = renderRow({ isFirstInBacklog: true });
    expect(first.root.querySelector('.us-option-popup-button')).toHaveClass('first');

    const notFirst = renderRow({ isFirstInBacklog: false });
    expect(notFirst.root.querySelector('.us-option-popup-button')).not.toHaveClass('first');
  });

  it('threads an options-button click to onOptionsClick(id)', () => {
    const onOptionsClick = jest.fn();
    const { root } = renderRow({ us: makeUs({ id: 1 }), onOptionsClick });
    fireEvent.click(root.querySelector('.us-option-popup-button') as HTMLElement);
    expect(onOptionsClick).toHaveBeenCalledWith(1);
  });
});

/* ========================================================================== *
 * Defensive fallbacks — nullable fields and OPTIONAL callbacks.
 * These lock the component's tolerant reads (the `UserStory` index-signature
 * fields are coerced, and `onStatusClick`/`onOptionsClick` are optional props).
 * ========================================================================== */

describe('defensive fallbacks (nullable fields and optional callbacks)', () => {
  it('renders a tag with a null colour and no background style', () => {
    const { root } = renderRow({ us: makeUs({ tags: [['ui', null]] }) });
    const tag = root.querySelector('.tag') as HTMLElement;
    expect(tag).toHaveTextContent('ui');
    // `tag[1]` is null -> the `background` style branch is skipped.
    expect(tag.style.background).toBe('');
  });

  it('renders an epic pill with no colour when the epic has none', () => {
    const { root } = renderRow({
      us: makeUs({ epics: [{ ref: 9, subject: 'Colourless epic' }] }),
    });
    const pill = root.querySelector('.belong-to-epic-pill') as HTMLElement;
    expect(pill).toHaveAttribute('title', '#9 Colourless epic');
    expect(pill.style.background).toBe('');
  });

  it('renders an empty .points cell when no points label is supplied', () => {
    const { root } = renderRow({ pointsLabel: undefined });
    expect(root.querySelector('.points')).toHaveTextContent('');
  });

  it('renders an empty name when the story has no subject', () => {
    const { root } = renderRow({ us: makeUs({ subject: undefined }) });
    expect(root.querySelector('.user-story-name')).toHaveTextContent('');
  });

  it('renders no tags when the story has no tags array (showTags on)', () => {
    const { container } = renderRow({ us: makeUs({ tags: undefined }), showTags: true });
    expect(container.querySelectorAll('.tag')).toHaveLength(0);
  });

  it('renders no epic pills when the story has no epics array', () => {
    const { root } = renderRow({ us: makeUs({ epics: undefined }) });
    expect(root.querySelector('.belong-to-epic-pill')).toBeNull();
  });

  it('does not throw when the status link is clicked without an onStatusClick handler', () => {
    const { root } = renderRow({ onStatusClick: undefined });
    expect(() =>
      fireEvent.click(root.querySelector('a.us-status') as HTMLElement),
    ).not.toThrow();
  });

  it('does not throw when the options button is clicked without an onOptionsClick handler', () => {
    const { root } = renderRow({ onOptionsClick: undefined });
    expect(() =>
      fireEvent.click(root.querySelector('.us-option-popup-button') as HTMLElement),
    ).not.toThrow();
  });
});

/* ========================================================================== *
 * Inline row controls (finding #12): status dropdown, per-role points editor,
 * and ⋮ options menu. These are rendered ONLY when the reference-data props
 * (`statuses` / `points` / `roles`) are supplied — the baseline (inert) tests
 * above never supply them, so they keep exercising the pre-#12 behaviour.
 *
 * BEHAVIOURAL ORIGIN (reproduced, never imported):
 *   - `popover-us-status.jade` + `common/popovers.coffee` (status widget).
 *   - `us-points-roles-popover.jade` + `us-estimation-points.jade` +
 *     `common/estimation.coffee` (per-role points editor).
 *   - `us-edit-popover.jade` + `backlog/main.coffee:653-684` (Edit/Delete/Move).
 * ========================================================================== */

/** Project status option list (mirrors `project.us_statuses`). */
const STATUSES = [
  { id: 1, name: 'New', color: '#999' },
  { id: 2, name: 'Ready', color: '#E44057' },
  { id: 3, name: 'In progress', color: '#E47C40' },
];
/** Project estimation points (the "?" point carries value null). */
const POINTS = [
  { id: 25, name: '?', value: null },
  { id: 28, name: '1', value: 1 },
  { id: 29, name: '2', value: 2 },
];
/** Project roles: two computable (UX, Front) + one non-computable (PO). */
const ROLES = [
  { id: 13, name: 'UX', computable: true },
  { id: 15, name: 'Front', computable: true },
  { id: 17, name: 'Product Owner', computable: false },
];

describe('inline status dropdown', () => {
  it('opens the .pop-status popover with one option per status on status click', () => {
    const { root } = renderRow({ statuses: STATUSES, us: makeUs({ status: 1 }) });
    // No popover before the click.
    expect(root.querySelector('.pop-status')).toBeNull();
    fireEvent.click(root.querySelector('a.us-status') as HTMLElement);
    const popover = root.querySelector('.pop-status') as HTMLElement;
    expect(popover).toBeInTheDocument();
    expect(popover.querySelectorAll('li.popover-status')).toHaveLength(3);
  });

  it('marks the current status option with active-popover', () => {
    const { root } = renderRow({ statuses: STATUSES, us: makeUs({ status: 2 }) });
    fireEvent.click(root.querySelector('a.us-status') as HTMLElement);
    const active = root.querySelector('.pop-status a.status.active-popover') as HTMLElement;
    expect(active).toBeInTheDocument();
    expect(within(active).getByText('Ready')).toBeInTheDocument();
  });

  it('calls onChangeStatus(us, statusId) and closes when an option is selected', () => {
    const onChangeStatus = jest.fn();
    const us = makeUs({ id: 7, status: 1 });
    const { root } = renderRow({ statuses: STATUSES, us, onChangeStatus });
    fireEvent.click(root.querySelector('a.us-status') as HTMLElement);
    // Select "In progress" (id 3).
    const options = Array.from(root.querySelectorAll('.pop-status a.status')) as HTMLElement[];
    const inProgress = options.find((a) => a.textContent?.includes('In progress'))!;
    fireEvent.click(inProgress);
    expect(onChangeStatus).toHaveBeenCalledTimes(1);
    expect(onChangeStatus).toHaveBeenCalledWith(us, 3);
    // Popover closes after selection.
    expect(root.querySelector('.pop-status')).toBeNull();
  });

  it('still fires the onStatusClick signal when opening the dropdown', () => {
    const onStatusClick = jest.fn();
    const { root } = renderRow({ statuses: STATUSES, us: makeUs({ id: 7 }), onStatusClick });
    fireEvent.click(root.querySelector('a.us-status') as HTMLElement);
    expect(onStatusClick).toHaveBeenCalledWith(7);
  });

  it('does NOT open a dropdown when statuses are not supplied (baseline preserved)', () => {
    const onStatusClick = jest.fn();
    const { root } = renderRow({ statuses: undefined, onStatusClick });
    fireEvent.click(root.querySelector('a.us-status') as HTMLElement);
    expect(root.querySelector('.pop-status')).toBeNull();
    // The click signal still fires.
    expect(onStatusClick).toHaveBeenCalled();
  });

  it('does NOT open a dropdown when the user cannot modify', () => {
    const { root } = renderRow({ statuses: STATUSES, canModify: false });
    fireEvent.click(root.querySelector('a.us-status') as HTMLElement);
    expect(root.querySelector('.pop-status')).toBeNull();
  });
});

describe('inline per-role points editor', () => {
  it('shows the live total computed from us.points when points+roles are supplied', () => {
    // UX->1 (value 1) + Front->2 (value 2) => total 3, overriding pointsLabel.
    const { root } = renderRow({
      points: POINTS,
      roles: ROLES,
      pointsLabel: 'IGNORED',
      us: makeUs({ points: { 13: 28, 15: 29 } }),
    });
    expect(root.querySelector('.points-value')).toHaveTextContent('3');
  });

  it('opens the .pop-role role picker (2+ computable roles, no header selection)', () => {
    const { root } = renderRow({
      points: POINTS,
      roles: ROLES,
      us: makeUs({ points: { 13: 28, 15: 29 } }),
    });
    fireEvent.click(root.querySelector('.us-points') as HTMLElement);
    const rolePopover = root.querySelector('.pop-role') as HTMLElement;
    expect(rolePopover).toBeInTheDocument();
    // Only the two COMPUTABLE roles are listed (Product Owner excluded).
    expect(rolePopover.querySelectorAll('a.role')).toHaveLength(2);
    expect(rolePopover).toHaveTextContent('UX (1)');
    expect(rolePopover).toHaveTextContent('Front (2)');
  });

  it('drills into the .pop-points-open point picker after choosing a role', () => {
    const { root } = renderRow({
      points: POINTS,
      roles: ROLES,
      us: makeUs({ points: { 13: 28, 15: 29 } }),
    });
    fireEvent.click(root.querySelector('.us-points') as HTMLElement);
    // Choose UX.
    const ux = Array.from(root.querySelectorAll('.pop-role a.role')).find((a) =>
      a.textContent?.includes('UX'),
    ) as HTMLElement;
    fireEvent.click(ux);
    const pointPopover = root.querySelector('.pop-points-open') as HTMLElement;
    expect(pointPopover).toBeInTheDocument();
    expect(pointPopover.querySelectorAll('a.point')).toHaveLength(3);
  });

  it('inverts the active class: the currently-selected point omits active', () => {
    const { root } = renderRow({
      points: POINTS,
      roles: ROLES,
      // UX currently at point id 28 ("1").
      us: makeUs({ points: { 13: 28, 15: 29 } }),
    });
    fireEvent.click(root.querySelector('.us-points') as HTMLElement);
    fireEvent.click(
      Array.from(root.querySelectorAll('.pop-role a.role')).find((a) =>
        a.textContent?.includes('UX'),
      ) as HTMLElement,
    );
    const selected = root.querySelector('.pop-points-open a[data-point-id="28"]') as HTMLElement;
    const other = root.querySelector('.pop-points-open a[data-point-id="29"]') as HTMLElement;
    // Selected point: class "point" (NO active); others: "point active".
    expect(selected).toHaveClass('point');
    expect(selected).not.toHaveClass('active');
    expect(other).toHaveClass('point', 'active');
  });

  it('calls onChangePoints(us, roleId, pointId) and closes when a point is picked', () => {
    const onChangePoints = jest.fn();
    const us = makeUs({ points: { 13: 28, 15: 29 } });
    const { root } = renderRow({ points: POINTS, roles: ROLES, us, onChangePoints });
    fireEvent.click(root.querySelector('.us-points') as HTMLElement);
    fireEvent.click(
      Array.from(root.querySelectorAll('.pop-role a.role')).find((a) =>
        a.textContent?.includes('Front'),
      ) as HTMLElement,
    );
    // Pick point "2" (id 29) for Front (id 15).
    fireEvent.click(root.querySelector('.pop-points-open a[data-point-id="29"]') as HTMLElement);
    expect(onChangePoints).toHaveBeenCalledTimes(1);
    expect(onChangePoints).toHaveBeenCalledWith(us, 15, 29);
    expect(root.querySelector('.pop-points-open')).toBeNull();
  });

  it('jumps straight to the point picker when there is a single computable role', () => {
    const singleRole = [
      { id: 15, name: 'Front', computable: true },
      { id: 17, name: 'Product Owner', computable: false },
    ];
    const { root } = renderRow({
      points: POINTS,
      roles: singleRole,
      us: makeUs({ points: { 15: 29 } }),
    });
    fireEvent.click(root.querySelector('.us-points') as HTMLElement);
    // No intermediate role picker; the point picker opens directly.
    expect(root.querySelector('.pop-role')).toBeNull();
    expect(root.querySelector('.pop-points-open')).toBeInTheDocument();
  });

  it('jumps straight to the point picker for the header-selected role (pointsViewRoleId)', () => {
    const { root } = renderRow({
      points: POINTS,
      roles: ROLES,
      pointsViewRoleId: 15,
      us: makeUs({ points: { 13: 28, 15: 29 } }),
    });
    fireEvent.click(root.querySelector('.us-points') as HTMLElement);
    expect(root.querySelector('.pop-role')).toBeNull();
    const pointPopover = root.querySelector('.pop-points-open') as HTMLElement;
    expect(pointPopover).toBeInTheDocument();
    // The picker targets the header-selected role id 15.
    expect(pointPopover.querySelector('a.point')).toHaveAttribute('data-role-id', '15');
  });

  it('shows "{rolePointName} / {total}" when a header role is selected and >1 role', () => {
    // Header views role 15 (Front -> point "2"); total is 1+2 = 3 -> "2 / 3".
    const { root } = renderRow({
      points: POINTS,
      roles: ROLES,
      pointsViewRoleId: 15,
      us: makeUs({ points: { 13: 28, 15: 29 } }),
    });
    expect(root.querySelector('.points-value')).toHaveTextContent('2 / 3');
  });

  it('renders a non-clickable points cell that does not open when not editable', () => {
    const { root } = renderRow({
      points: POINTS,
      roles: ROLES,
      canModify: false,
      us: makeUs({ points: { 13: 28 } }),
    });
    const cell = root.querySelector('.us-points') as HTMLElement;
    expect(cell).toHaveClass('not-clickable');
    fireEvent.click(cell);
    expect(root.querySelector('.pop-role')).toBeNull();
    expect(root.querySelector('.pop-points-open')).toBeNull();
  });
});

describe('inline ⋮ options menu', () => {
  const optionProps = {
    statuses: STATUSES,
    onEditStory: jest.fn(),
    onDeleteStory: jest.fn(),
    onMoveToTop: jest.fn(),
  };

  it('opens the .us-option-popup with Edit + Move-to-top on options click', () => {
    const { root } = renderRow({ ...optionProps, canDelete: false });
    fireEvent.click(root.querySelector('.us-option-popup-button') as HTMLElement);
    const menu = root.querySelector('.us-option-popup') as HTMLElement;
    expect(menu).toBeInTheDocument();
    expect(menu.querySelector('.e2e-edit.edit-story')).toBeInTheDocument();
    expect(menu.querySelector('.e2e-edit.move-to-top')).toBeInTheDocument();
    // No Delete item without the delete_us permission.
    expect(menu.querySelector('.e2e-delete')).toBeNull();
  });

  it('N-12: the options (⋮) trigger has an accessible name + truthful popup ARIA', () => {
    // The icon-only trigger previously had no accessible name and announced
    // neither that it opens a popup nor whether it is open. It now carries
    // `aria-label="Options"`, `aria-haspopup="true"`, and an `aria-expanded`
    // that follows the popover state. Invisible; no behaviour change.
    const { root } = renderRow({ ...optionProps });
    const button = root.querySelector('.us-option-popup-button') as HTMLElement;
    expect(button).toHaveAttribute('aria-label', 'Options');
    expect(button).toHaveAttribute('aria-haspopup', 'true');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('N-12: the options popover carries NO false ARIA menu roles (legacy globalPopover parity)', () => {
    // VERIFY-AGAINST-LEGACY: the legacy `us-edit-popover` was a plain
    // `ul.popover > li > button` list with no menu roles. Assert the React
    // popover adds none (so no unimplemented arrow-key roving is promised),
    // consistent with the Kanban card N-07 fix.
    const { root } = renderRow({ ...optionProps, canDelete: true });
    fireEvent.click(root.querySelector('.us-option-popup-button') as HTMLElement);
    const menu = root.querySelector('.us-option-popup') as HTMLElement;
    expect(menu).toBeInTheDocument();
    expect(menu.getAttribute('role')).toBeNull();
    expect(menu.querySelector('[role="menu"]')).toBeNull();
    expect(menu.querySelector('[role="menuitem"]')).toBeNull();
  });

  it('shows the Delete item only when canDelete is true', () => {
    const { root } = renderRow({ ...optionProps, canDelete: true });
    fireEvent.click(root.querySelector('.us-option-popup-button') as HTMLElement);
    expect(root.querySelector('.us-option-popup .e2e-delete')).toBeInTheDocument();
  });

  it('calls onEditStory(us) and closes when Edit is clicked', () => {
    const onEditStory = jest.fn();
    const us = makeUs({ id: 7 });
    const { root } = renderRow({ ...optionProps, us, onEditStory });
    fireEvent.click(root.querySelector('.us-option-popup-button') as HTMLElement);
    fireEvent.click(root.querySelector('.us-option-popup .e2e-edit.edit-story') as HTMLElement);
    expect(onEditStory).toHaveBeenCalledWith(us);
    expect(root.querySelector('.us-option-popup')).toBeNull();
  });

  it('calls onDeleteStory(us) and closes when Delete is clicked', () => {
    const onDeleteStory = jest.fn();
    const us = makeUs({ id: 7 });
    const { root } = renderRow({ ...optionProps, canDelete: true, us, onDeleteStory });
    fireEvent.click(root.querySelector('.us-option-popup-button') as HTMLElement);
    fireEvent.click(root.querySelector('.us-option-popup .e2e-delete') as HTMLElement);
    expect(onDeleteStory).toHaveBeenCalledWith(us);
    expect(root.querySelector('.us-option-popup')).toBeNull();
  });

  it('calls onMoveToTop(us) and closes when Move-to-top is clicked', () => {
    const onMoveToTop = jest.fn();
    const us = makeUs({ id: 7 });
    const { root } = renderRow({ ...optionProps, us, onMoveToTop });
    fireEvent.click(root.querySelector('.us-option-popup-button') as HTMLElement);
    fireEvent.click(root.querySelector('.us-option-popup .e2e-edit.move-to-top') as HTMLElement);
    expect(onMoveToTop).toHaveBeenCalledWith(us);
    expect(root.querySelector('.us-option-popup')).toBeNull();
  });

  it('still fires the onOptionsClick signal with the story id', () => {
    const onOptionsClick = jest.fn();
    const { root } = renderRow({ ...optionProps, us: makeUs({ id: 7 }), onOptionsClick });
    fireEvent.click(root.querySelector('.us-option-popup-button') as HTMLElement);
    expect(onOptionsClick).toHaveBeenCalledWith(7);
  });
});
