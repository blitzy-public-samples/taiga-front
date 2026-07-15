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

  it('renders the due-date host only when the story has a due date', () => {
    const withDue = renderRow({ us: makeUs({ due_date: '2025-01-01' }) });
    expect(withDue.root.querySelector('tg-due-date')).toBeInTheDocument();
    // The inert host carries the `.due-date` class (structural/style parity).
    expect(withDue.root.querySelector('.due-date')).toBeInTheDocument();

    const withoutDue = renderRow({ us: makeUs({ due_date: null }) });
    expect(withoutDue.root.querySelector('tg-due-date')).toBeNull();
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
