/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Card.test.tsx
 * -------------
 * Jest + React Testing Library unit spec for the React Kanban user-story card
 * (`../components/Card`). It contributes to the >=70% line-coverage gate
 * enforced over `app/react/**` and pins the behavioural + structural contract
 * the component ports from the legacy AngularJS `Card` directive, its Jade
 * templates, and the `tgCardActions` / `tgCardData` / `tgCardAssignedTo`
 * directives in `kanban/main.coffee`.
 *
 * BEHAVIOURAL ORIGIN (reproduced here, NEVER imported — the AngularJS/legacy
 * sources stay on the far side of the coexistence boundary):
 *   - `card.jade` element order + the `.card-inner` `ng-class`.
 *   - `card.controller.coffee` helpers: `visible()`, `hasTasks()`,
 *     `getTagColor()`, `_setVisibility()` (fold at zoom 2), permission gating.
 *   - `card-*.jade` templates (tags, actions, epics, title, assigned-to, data,
 *     tasks, unfold) and the board-level per-card `ng-class` in
 *     `kanban-table.jade` (selected/moved).
 *   - `due-date.service.coffee` colour/title rules.
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file):
 *   - Jest + jsdom only. No Playwright, no real browser, no network.
 *   - The ONLY imports are the module under test, its sibling shared types, and
 *     the testing libraries; no legacy AngularJS/CoffeeScript source, Jade
 *     partial, SCSS style, or compiled Angular-Elements bundle is ever pulled
 *     into the React test bundle (the coexistence boundary is globals only).
 *   - React itself is not imported (automatic `react-jsx` runtime); `jest` is
 *     used as a global (provided by `@types/jest`), never imported.
 *   - `@testing-library/jest-dom` is imported for its DOM matchers.
 *   - `@dnd-kit/sortable`'s `useSortable` is mocked (matching
 *     `shared/dnd/__tests__/sortable.test.tsx`) so the card can be rendered
 *     with a controlled, deterministic drag state and WITHOUT a real
 *     `DndContext`/`SortableContext` provider.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock `@dnd-kit/sortable` so the real `useSortableCard` -> `useSortableItem`
// wrappers run against a controlled `useSortable` return (no DndContext, no
// real drag). This mirrors the approach in shared/dnd/__tests__/sortable.test.tsx.
jest.mock('@dnd-kit/sortable', () => ({
  useSortable: jest.fn(),
}));
import { useSortable } from '@dnd-kit/sortable';

import Card from '../components/Card';
import type { CardProps } from '../components/Card';
import { DND_CLASS } from '../../shared/dnd/types';
import type { UserStoryData, Project, User } from '../state/kanbanReducer';

const mockUseSortable = useSortable as unknown as jest.Mock;

/**
 * Cumulative zoom feature catalogs (mirrors `ZoomControl`/`card.controller`):
 *   L0 -> assigned_to, ref
 *   L1 -> + subject, card-data, assigned_to_extended
 *   L2 -> + tags, extra_info, unfold
 *   L3 -> + related_tasks, attachments
 */
const L0 = ['assigned_to', 'ref'];
const L1 = [...L0, 'subject', 'card-data', 'assigned_to_extended'];
const L2 = [...L1, 'tags', 'extra_info', 'unfold'];
const L3 = [...L2, 'related_tasks', 'attachments'];

/** A non-dragging `useSortable` return (the common case). */
const nonDragging = () => ({
  setNodeRef: jest.fn(),
  attributes: { role: 'button', tabIndex: 0 },
  listeners: { onPointerDown: jest.fn() },
  transform: null,
  transition: undefined,
  isDragging: false,
});

/** Build a `User` with defensive-read fields the avatar helper consumes. */
const makeUser = (over: Record<string, unknown> = {}): User =>
  ({
    id: 1,
    full_name_display: 'Ada Lovelace',
    username: 'ada',
    photo: 'https://example.test/ada.png',
    color: '#123456',
    ...over,
  } as unknown as User);

/** Build a `UserStoryData` (model fields live on the index signature). */
const makeItem = (
  opts: { model?: Record<string, unknown> } & Record<string, unknown> = {},
): UserStoryData => {
  const { model: modelOver, ...rest } = opts;
  const model = {
    id: 101,
    ref: 42,
    subject: 'Implement widget',
    is_blocked: false,
    blocked_note: '',
    is_iocaine: false,
    total_points: 8,
    due_date: null,
    total_attachments: 0,
    total_comments: 0,
    watchers: [],
    tasks: [],
    epics: [],
    attachments: [],
    ...(modelOver ?? {}),
  };
  return {
    foldStatusChanged: undefined,
    model,
    images: [],
    id: 101,
    swimlane: null,
    assigned_to: undefined,
    assigned_users: [],
    assigned_users_preview: [],
    colorized_tags: [],
    ...rest,
  } as unknown as UserStoryData;
};

/** Build a `Project` (archived_code + optional us_duedates on index signature). */
const makeProject = (over: Record<string, unknown> = {}): Project =>
  ({ id: 7, archived_code: null, ...over } as unknown as Project);

/** Full props with sensible defaults; override per test. */
const makeProps = (over: Partial<CardProps> = {}): CardProps => ({
  usId: 101,
  item: makeItem(),
  project: makeProject(),
  type: 'us',
  zoom: L3,
  zoomLevel: 3,
  isFirst: false,
  archived: false,
  inViewPort: true,
  statusId: 3,
  swimlaneId: null,
  index: 0,
  selected: false,
  moved: false,
  canModify: true,
  canDelete: true,
  canViewTasks: true,
  onToggleFold: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onAssignedTo: jest.fn(),
  onMoveToTop: jest.fn(),
  onSelect: jest.fn(),
  ...over,
});

const renderCard = (over: Partial<CardProps> = {}) => {
  const props = makeProps(over);
  const utils = render(<Card {...props} />);
  return { ...utils, props };
};

beforeEach(() => {
  mockUseSortable.mockImplementation(() => nonDragging());
});

/* ========================================================================== *
 * Host element + drag wiring
 * ========================================================================== */

describe('<tg-card> host element and drag wiring', () => {
  it('renders the tg-card host with base classes and data-id', () => {
    const { container } = renderCard({ usId: 101 });
    const host = container.querySelector('tg-card') as HTMLElement;
    expect(host).toBeInTheDocument();
    expect(host.getAttribute('data-id')).toBe('101');
    const cls = host.getAttribute('class') ?? '';
    expect(cls).toContain('card');
    expect(cls).toContain('ng-animate-disabled');
  });

  it('M-15/M-16: does NOT emit the @dnd-kit false-affordance ARIA on the card host', () => {
    // The `useSortable` mock supplies `role="button"`/`tabIndex` (see nonDragging),
    // but `useSortableItem` suppresses them so `<tg-card>` matches the legacy inert
    // drag div — no focusable "sortable button" that no-ops on Enter/Space. Pointer
    // drag is unaffected (listeners + ref remain).
    const { container } = renderCard({ usId: 101 });
    const host = container.querySelector('tg-card') as HTMLElement;
    expect(host.getAttribute('role')).toBeNull();
    expect(host.getAttribute('tabindex')).toBeNull();
    expect(host.getAttribute('aria-roledescription')).toBeNull();
    expect(host.getAttribute('aria-describedby')).toBeNull();
    expect(host.getAttribute('aria-pressed')).toBeNull();
  });

  it('passes { usId, statusId, swimlaneId, oldIndex } + disabled:false as the drag config to useSortable', () => {
    // index:4 -> drag-data oldIndex:4 (F-WRITE-1); canModify defaults true -> disabled:false (F-WRITE-3).
    renderCard({ usId: 55, statusId: 9, swimlaneId: 2, index: 4 });
    expect(mockUseSortable).toHaveBeenCalledWith({
      id: 55,
      data: { usId: 55, statusId: 9, swimlaneId: 2, oldIndex: 4 },
      disabled: false,
    });
  });

  it('F-WRITE-1: wires the column index as the drag-data oldIndex', () => {
    renderCard({ usId: 55, index: 7 });
    const call = mockUseSortable.mock.calls.find(
      (c: unknown[]) => (c[0] as { id?: number }).id === 55,
    )?.[0] as { data?: Record<string, unknown> } | undefined;
    expect(call?.data).toEqual(expect.objectContaining({ oldIndex: 7 }));
  });

  it('F-WRITE-3: disables the sortable (drag) for a readonly user (canModify=false)', () => {
    renderCard({ usId: 55, canModify: false });
    const call = mockUseSortable.mock.calls.find(
      (c: unknown[]) => (c[0] as { id?: number }).id === 55,
    )?.[0] as { disabled?: boolean } | undefined;
    expect(call?.disabled).toBe(true);
  });

  it('F-WRITE-3: keeps the sortable enabled for an editor (canModify=true)', () => {
    renderCard({ usId: 55, canModify: true });
    const call = mockUseSortable.mock.calls.find(
      (c: unknown[]) => (c[0] as { id?: number }).id === 55,
    )?.[0] as { disabled?: boolean } | undefined;
    expect(call?.disabled).toBe(false);
  });

  it('appends the gu-transit class to tg-card while dragging', () => {
    mockUseSortable.mockImplementationOnce(() => ({
      ...nonDragging(),
      isDragging: true,
      transform: { x: 1, y: 2, scaleX: 1, scaleY: 1 },
      transition: 'transform 200ms ease',
    }));
    const { container } = renderCard();
    const host = container.querySelector('tg-card') as HTMLElement;
    expect(host.getAttribute('class')).toContain(DND_CLASS.transit); // 'gu-transit'
  });

  it('adds kanban-task-selected + the multi-select marker when selected', () => {
    const { container } = renderCard({ selected: true });
    const cls = (container.querySelector('tg-card') as HTMLElement).getAttribute('class') ?? '';
    expect(cls).toContain('kanban-task-selected');
    expect(cls).toContain(DND_CLASS.selected); // 'ui-multisortable-multiple'
  });

  it('adds the kanban-moved class when moved', () => {
    const { container } = renderCard({ moved: true });
    const cls = (container.querySelector('tg-card') as HTMLElement).getAttribute('class') ?? '';
    expect(cls).toContain(DND_CLASS.moved); // 'kanban-moved'
  });

  it('does NOT emit the dead maximized/minimized classes', () => {
    const { container } = renderCard({ maximized: true, minimized: true });
    const cls = (container.querySelector('tg-card') as HTMLElement).getAttribute('class') ?? '';
    expect(cls).not.toContain('kanban-task-maximized');
    expect(cls).not.toContain('kanban-task-minimized');
  });

  it('ctrl/meta-click toggles multi-selection via onSelect', () => {
    const onSelect = jest.fn();
    const { container } = renderCard({ onSelect, usId: 101 });
    const host = container.querySelector('tg-card') as HTMLElement;
    fireEvent.click(host, { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledWith(101);
  });

  it('plain click does NOT toggle multi-selection', () => {
    const onSelect = jest.fn();
    const { container } = renderCard({ onSelect });
    fireEvent.click(container.querySelector('tg-card') as HTMLElement);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not throw on ctrl-click when onSelect is omitted', () => {
    const { container } = renderCard({ onSelect: undefined });
    expect(() =>
      fireEvent.click(container.querySelector('tg-card') as HTMLElement, { ctrlKey: true }),
    ).not.toThrow();
  });
});

/* ========================================================================== *
 * .card-inner viewport gate + inner classes
 * ========================================================================== */

describe('.card-inner viewport gate', () => {
  it('renders .card-inner with zoom-/type- classes when inViewPort', () => {
    const { container } = renderCard({ inViewPort: true, zoomLevel: 3, type: 'us' });
    const inner = container.querySelector('.card-inner') as HTMLElement;
    expect(inner).toBeInTheDocument();
    expect(inner).toHaveClass('zoom-3');
    expect(inner).toHaveClass('type-us');
  });

  it('omits .card-inner but keeps .card-transit-multi when NOT inViewPort', () => {
    const { container } = renderCard({ inViewPort: false });
    expect(container.querySelector('.card-inner')).toBeNull();
    expect(container.querySelector('.card-transit-multi')).toBeInTheDocument();
  });

  it('adds card-blocked + renders the lock when the story is blocked', () => {
    const { container } = renderCard({ item: makeItem({ model: { is_blocked: true } }) });
    expect(container.querySelector('.card-inner')).toHaveClass('card-blocked');
    expect(container.querySelector('.card-lock')).toBeInTheDocument();
  });

  it('adds the archived class when archived', () => {
    const { container } = renderCard({ archived: true });
    expect(container.querySelector('.card-inner')).toHaveClass('archived');
  });

  it('adds with-assigned-user when the story has assigned users', () => {
    const { container } = renderCard({
      item: makeItem({ assigned_users: [makeUser()], assigned_users_preview: [makeUser()] }),
    });
    expect(container.querySelector('.card-inner')).toHaveClass('with-assigned-user');
  });

  it('adds with-fold-action when unfold is visible and there are tasks', () => {
    const { container } = renderCard({
      item: makeItem({ model: { tasks: [{ ref: 1, subject: 'T', is_closed: false }] } }),
    });
    expect(container.querySelector('.card-inner')).toHaveClass('with-fold-action');
  });
});

/* ========================================================================== *
 * card-tags
 * ========================================================================== */

describe('card-tags', () => {
  it('renders tag swatches with names at zoom 3', () => {
    const { container } = renderCard({
      item: makeItem({
        colorized_tags: [
          { name: 'backend', color: '#ff0000' },
          { name: 'urgent', color: null },
        ],
      }),
    });
    const tags = container.querySelectorAll('.card-tags .card-tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]).toHaveTextContent('backend');
    // null tag colour falls back to the default swatch colour.
    expect(tags[1]).toHaveStyle({ backgroundColor: '#A9AABC' });
  });

  it('renders swatches WITHOUT names below zoom 3', () => {
    const { container } = renderCard({
      zoom: L2,
      zoomLevel: 2,
      item: makeItem({ colorized_tags: [{ name: 'backend', color: '#ff0000' }] }),
    });
    const tag = container.querySelector('.card-tags .card-tag') as HTMLElement;
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveTextContent('');
  });

  it('omits card-tags when there are no tags', () => {
    const { container } = renderCard();
    expect(container.querySelector('.card-tags')).toBeNull();
  });

  it('omits card-tags when tags feature is not visible (zoom 1)', () => {
    const { container } = renderCard({
      zoom: L1,
      zoomLevel: 1,
      item: makeItem({ colorized_tags: [{ name: 'x', color: '#000' }] }),
    });
    expect(container.querySelector('.card-tags')).toBeNull();
  });
});

/* ========================================================================== *
 * card-actions popover + permission gating (tgCardActions)
 * ========================================================================== */

describe('card-actions popover', () => {
  it('is hidden entirely at zoom 0', () => {
    const { container } = renderCard({ zoom: L0, zoomLevel: 0 });
    expect(container.querySelector('.card-actions')).toBeNull();
  });

  it('is hidden when the user can neither modify nor delete', () => {
    const { container } = renderCard({ canModify: false, canDelete: false });
    expect(container.querySelector('.card-actions')).toBeNull();
  });

  it('opens on button click and shows all four actions (full perms, not first)', () => {
    const { container } = renderCard({ canModify: true, canDelete: true, isFirst: false });
    const button = container.querySelector('.card-actions .js-popup-button') as HTMLElement;
    expect(button).not.toHaveClass('popover-open');
    fireEvent.click(button);
    expect(button).toHaveClass('popover-open');
    // The menu reproduces `taiga.globalPopover`: a `.popover.global-popover
    // .active` body-portaled div (not an inline child of `.card-actions`).
    const menu = document.querySelector('.popover.global-popover.active') as HTMLElement;
    expect(menu).toBeInTheDocument();
    // N-07: the popover reproduces the legacy `taiga.globalPopover` PLAIN
    // `ul > li > button` structure with NO `role="menu"`/`menuitem` (those
    // announced an arrow-key roving pattern that is not implemented). The items
    // are plain buttons, queried by their button role / label.
    const items = within(menu).getAllByRole('button');
    expect(items.map((i) => i.textContent?.trim())).toEqual(
      // Verbatim from the AngularJS `tgCardActions` menu (`COMMON.CARD.*`):
      // "Edit card" / "Assign To" / "Delete card" / "Move to top".
      expect.arrayContaining(['Edit card', 'Assign To', 'Delete card', 'Move to top']),
    );
    expect(items).toHaveLength(4);
  });

  it('N-07: the options popover carries NO false ARIA menu roles (legacy globalPopover parity)', () => {
    // VERIFY-AGAINST-LEGACY: `taiga.globalPopover` [popovers.coffee:256-322]
    // built a PLAIN `div.popover.global-popover > ul > li > button` with no
    // `role="menu"`/`menuitem`/`none`. The migration had wrongly added those
    // roles, promising arrow-key roving that is not implemented. Assert the
    // false affordance is gone so it cannot regress.
    const { container } = renderCard({ canModify: true, canDelete: true });
    fireEvent.click(container.querySelector('.js-popup-button') as HTMLElement);
    const menu = document.querySelector('.popover.global-popover.active') as HTMLElement;
    expect(menu).toBeInTheDocument();
    expect(menu.getAttribute('role')).toBeNull();
    expect(menu.querySelector('[role="menu"]')).toBeNull();
    expect(menu.querySelector('[role="menuitem"]')).toBeNull();
    expect(menu.querySelector('[role="none"]')).toBeNull();
  });

  it('N-06: the options (⋮) trigger has an accessible name + truthful popup ARIA', () => {
    // The icon-only disclosure button previously had no accessible name. It now
    // carries `aria-label="Options"` (COMMON.CARD.OPTIONS) plus truthful
    // `aria-haspopup`/`aria-expanded`. These are INVISIBLE and add no behavior.
    const { container } = renderCard({ canModify: true, canDelete: true });
    const button = container.querySelector('.card-actions .js-popup-button') as HTMLElement;
    expect(button).toHaveAttribute('aria-label', 'Options');
    expect(button).toHaveAttribute('aria-haspopup', 'true');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('hides Move to top for the first card', () => {
    const { container } = renderCard({ isFirst: true });
    fireEvent.click(container.querySelector('.js-popup-button') as HTMLElement);
    expect(screen.queryByText('Move to top')).toBeNull();
    expect(screen.getByText('Edit card')).toBeInTheDocument();
  });

  it('shows only Delete card when the user can delete but not modify', () => {
    const { container } = renderCard({ canModify: false, canDelete: true });
    fireEvent.click(container.querySelector('.js-popup-button') as HTMLElement);
    expect(screen.getByText('Delete card')).toBeInTheDocument();
    expect(screen.queryByText('Edit card')).toBeNull();
    expect(screen.queryByText('Assign To')).toBeNull();
    expect(screen.queryByText('Move to top')).toBeNull();
  });

  it('shows Edit card/Assign To/Move to top but not Delete card when modify-only', () => {
    const { container } = renderCard({ canModify: true, canDelete: false });
    fireEvent.click(container.querySelector('.js-popup-button') as HTMLElement);
    expect(screen.getByText('Edit card')).toBeInTheDocument();
    expect(screen.getByText('Assign To')).toBeInTheDocument();
    expect(screen.getByText('Move to top')).toBeInTheDocument();
    expect(screen.queryByText('Delete card')).toBeNull();
  });

  it('invokes the mapped callback and closes on action click', () => {
    const onEdit = jest.fn();
    const { container } = renderCard({ onEdit, usId: 101 });
    fireEvent.click(container.querySelector('.js-popup-button') as HTMLElement);
    fireEvent.click(screen.getByText('Edit card'));
    expect(onEdit).toHaveBeenCalledWith(101);
    expect(document.querySelector('.popover.global-popover')).toBeNull();
  });

  it('routes Delete / Assign to / Move to top to their callbacks', () => {
    const onDelete = jest.fn();
    const item = makeItem();
    const onMoveToTop = jest.fn();
    const onAssignedTo = jest.fn();

    const { container, rerender } = render(
      <Card {...makeProps({ item, onDelete, onMoveToTop, onAssignedTo })} />,
    );
    // Delete card
    fireEvent.click(container.querySelector('.js-popup-button') as HTMLElement);
    fireEvent.click(screen.getByText('Delete card'));
    expect(onDelete).toHaveBeenCalledWith(101);

    // Move to top passes the whole item
    fireEvent.click(container.querySelector('.js-popup-button') as HTMLElement);
    fireEvent.click(screen.getByText('Move to top'));
    expect(onMoveToTop).toHaveBeenCalledWith(item);

    // Assign To (from the popover) passes the id
    fireEvent.click(container.querySelector('.js-popup-button') as HTMLElement);
    fireEvent.click(screen.getByText('Assign To'));
    expect(onAssignedTo).toHaveBeenCalledWith(101);

    rerender(<Card {...makeProps({ item, onDelete, onMoveToTop, onAssignedTo })} />);
  });

  it('closes on Escape and on an outside pointer-down', () => {
    const { container } = renderCard();
    const button = container.querySelector('.js-popup-button') as HTMLElement;

    fireEvent.click(button);
    expect(document.querySelector('.popover.global-popover.active')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.popover.global-popover')).toBeNull();

    fireEvent.click(button);
    expect(document.querySelector('.popover.global-popover.active')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(document.querySelector('.popover.global-popover')).toBeNull();
  });
});

/* ========================================================================== *
 * card-epics (wrapper at zoom>0 + compact at zoom 0)
 * ========================================================================== */

describe('card-epics', () => {
  const epicItem = () =>
    makeItem({
      model: {
        epics: [
          { id: 1, color: '#abcdef', subject: 'Epic One', ref: 900 },
          { id: 2, color: '#fedcba', subject: 'Epic Two', ref: 901 },
        ],
      },
    });

  it('renders epics with the first name shown at zoom > 0', () => {
    const { container } = renderCard({ item: epicItem(), zoomLevel: 3, zoom: L3 });
    const epics = container.querySelectorAll('.card-epics .card-epic');
    expect(epics).toHaveLength(2);
    expect(container.querySelector('.epic-color')).toHaveStyle({ backgroundColor: '#abcdef' });
    // Only the FIRST epic renders a name (and only when zoomLevel != 0).
    const names = container.querySelectorAll('.epic-name');
    expect(names).toHaveLength(1);
    expect(names[0]).toHaveTextContent('Epic One');
  });

  it('renders compact epics WITHOUT names at zoom 0', () => {
    const { container } = renderCard({ item: epicItem(), zoomLevel: 0, zoom: L0 });
    expect(container.querySelector('.card-compact-epics .card-epics')).toBeInTheDocument();
    expect(container.querySelector('.epic-name')).toBeNull();
  });

  it('omits the epics container when there are no epics', () => {
    const { container } = renderCard();
    expect(container.querySelector('.card-epics')).toBeNull();
  });

  it('N-01: epic pills link to the real epic destination /project/:slug/epic/:ref', () => {
    // VERIFY-AGAINST-LEGACY: `card-epics.jade` rendered `a.card-epic` with a
    // real `tg-nav="project-epics-detail:..."` link. The route
    // (`base.coffee:71`) is `/project/:project/epic/:ref`. The migration had
    // left the anchor inert (`href="#"`); this asserts the real destination so
    // AngularJS html5Mode intercepts it for client-side navigation.
    const { container } = renderCard({
      item: epicItem(),
      zoomLevel: 3,
      zoom: L3,
      project: makeProject({ slug: 'proj-x' }),
    });
    const epics = container.querySelectorAll('.card-epics .card-epic');
    expect(epics).toHaveLength(2);
    expect(epics[0]).toHaveAttribute('href', '/project/proj-x/epic/900');
    expect(epics[1]).toHaveAttribute('href', '/project/proj-x/epic/901');
  });

  it('N-01: epic pill falls back to "#" when the project slug is unavailable', () => {
    // Defensive parity: with no slug on the project the href degrades to "#"
    // (never a broken/undefined URL) exactly as the guard specifies.
    const { container } = renderCard({ item: epicItem(), zoomLevel: 3, zoom: L3 });
    const epic = container.querySelector('.card-epics .card-epic') as HTMLElement;
    expect(epic).toHaveAttribute('href', '#');
  });
});

/* ========================================================================== *
 * card-title
 * ========================================================================== */

describe('card-title', () => {
  it('renders ref + subject at zoom 3', () => {
    const { container } = renderCard();
    expect(container.querySelector('.card-title .card-ref')).toHaveTextContent('#42');
    const subject = container.querySelector('.card-subject.e2e-title') as HTMLElement;
    expect(subject).toBeInTheDocument();
    expect(subject).toHaveTextContent('Implement widget');
  });

  it('at zoom 0 shows the ref, hides the subject span, and sets the anchor title', () => {
    const { container } = renderCard({ zoom: L0, zoomLevel: 0 });
    expect(container.querySelector('.card-ref')).toHaveTextContent('#42');
    expect(container.querySelector('.card-subject')).toBeNull();
    const anchor = container.querySelector('.card-title a') as HTMLElement;
    expect(anchor.getAttribute('title')).toBe('#42 Implement widget');
  });

  // KB-1: the title links to the AngularJS US detail route (not an inert '#').
  it('KB-1: renders a real US-detail href /project/:slug/us/:ref on the title anchor', () => {
    const { container } = renderCard({ project: makeProject({ slug: 'proj' }) });
    const anchor = container.querySelector('.card-title a') as HTMLAnchorElement;
    expect(anchor).toBeInTheDocument();
    expect(anchor.getAttribute('href')).toBe('/project/proj/us/42');
  });

  // KB-1 defensive: without a resolvable slug the anchor falls back to '#'
  // (never a malformed `/project//us/...`).
  it('KB-1: falls back to href="#" when the project slug is unavailable', () => {
    const { container } = renderCard({ project: makeProject() });
    const anchor = container.querySelector('.card-title a') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('#');
  });
});

/* ========================================================================== *
 * card-assigned-to (tgCardAssignedTo)
 * ========================================================================== */

describe('card-assigned-to', () => {
  it('renders the not-assigned avatar + extended title at zoom 3', () => {
    const { container } = renderCard();
    const notAssigned = container.querySelector('.card-assigned-to .card-not-assigned') as HTMLElement;
    expect(notAssigned).toBeInTheDocument();
    expect(notAssigned.querySelector('img')?.getAttribute('title')).toBe('Not assigned');
    expect(container.querySelector('.card-not-assigned-title')).toHaveTextContent('Not assigned');
  });

  it('omits the extended not-assigned title when the extended feature is off (zoom 0)', () => {
    const { container } = renderCard({ zoom: L0, zoomLevel: 0 });
    expect(container.querySelector('.card-not-assigned')).toBeInTheDocument();
    expect(container.querySelector('.card-not-assigned-title')).toBeNull();
  });

  it('is hidden for an archived project', () => {
    const { container } = renderCard({ project: makeProject({ archived_code: 'archived' }) });
    expect(container.querySelector('.card-assigned-to')).toBeNull();
  });

  it('renders avatars for an assigned preview of exactly three', () => {
    const users = [makeUser({ id: 1 }), makeUser({ id: 2 }), makeUser({ id: 3 })];
    const { container } = renderCard({
      item: makeItem({ assigned_users: users, assigned_users_preview: users }),
    });
    const avatars = container.querySelectorAll('.card-assigned-to .card-user-avatar');
    expect(avatars).toHaveLength(3);
    expect(container.querySelectorAll('.card-user-avatar img')).toHaveLength(3);
    expect(container.querySelector('.extra-assigned')).toBeNull();
  });

  it('renders the extra-assigned "+N" badge when more than three are assigned', () => {
    const five = [1, 2, 3, 4, 5].map((id) => makeUser({ id }));
    const preview = five.slice(0, 3);
    const { container } = renderCard({
      item: makeItem({ assigned_users: five, assigned_users_preview: preview }),
    });
    const extra = container.querySelector('.extra-assigned') as HTMLElement;
    expect(extra).toBeInTheDocument();
    expect(extra).toHaveTextContent('3+');
    // index 0 and 1 render an <img>, index 2 renders the badge only.
    expect(container.querySelectorAll('.card-user-avatar img')).toHaveLength(2);
  });

  it('renders a single avatar (no preview array) with the iocaine background', () => {
    const { container } = renderCard({
      item: makeItem({
        model: { is_iocaine: true },
        assigned_to: makeUser(),
        assigned_users: [makeUser()],
        assigned_users_preview: undefined,
      }),
    });
    expect(container.querySelectorAll('.card-user-avatar img')).toHaveLength(1);
    expect(container.querySelector('.card-iocaine-user-bg')).toBeInTheDocument();
    expect(container.querySelector('.card-assigned-to')).toHaveClass('is_iocaine');
  });

  it('calls onAssignedTo when an avatar is clicked', () => {
    const onAssignedTo = jest.fn();
    const { container } = renderCard({ onAssignedTo, usId: 101 });
    fireEvent.click(container.querySelector('.card-user-avatar') as HTMLElement);
    expect(onAssignedTo).toHaveBeenCalledWith(101);
  });

  it('does NOT call onAssignedTo when the avatar is ctrl-clicked', () => {
    const onAssignedTo = jest.fn();
    const { container } = renderCard({ onAssignedTo });
    fireEvent.click(container.querySelector('.card-user-avatar') as HTMLElement, { ctrlKey: true });
    expect(onAssignedTo).not.toHaveBeenCalled();
  });
});

/* ========================================================================== *
 * card-data (tgCardData) + due-date service
 * ========================================================================== */

describe('card-data', () => {
  it('is gated by BOTH card-data and extra_info visibility (hidden at zoom 1)', () => {
    const { container } = renderCard({ zoom: L1, zoomLevel: 1 });
    // 'card-data' is visible at L1 but 'extra_info' is not -> no .card-data.
    expect(container.querySelector('.card-data')).toBeNull();
  });

  it('renders the estimation when the story has points', () => {
    const { container } = renderCard({ item: makeItem({ model: { total_points: 13 } }) });
    const est = container.querySelector('.card-estimation') as HTMLElement;
    expect(est).toHaveTextContent('13');
    expect(est.getAttribute('title')).toBe('Estimation');
  });

  it('renders an empty estimation span when there are no points', () => {
    const { container } = renderCard({ item: makeItem({ model: { total_points: 0 } }) });
    const est = container.querySelector('.card-estimation') as HTMLElement;
    expect(est).toBeInTheDocument();
    expect(est).toHaveTextContent('');
  });

  it('adds empty-tasks to card-data when there are no tasks', () => {
    const { container } = renderCard();
    expect(container.querySelector('.card-data')).toHaveClass('empty-tasks');
  });

  it('renders attachment / watcher / comment statistics with counts', () => {
    const { container } = renderCard({
      item: makeItem({
        model: { total_attachments: 4, watchers: [1, 2, 3], total_comments: 2 },
      }),
    });
    expect(container.querySelector('.card-attachments span')).toHaveTextContent('4');
    expect(container.querySelector('.card-watchers span')).toHaveTextContent('3');
    expect(container.querySelector('.card-comments span')).toHaveTextContent('2');
  });

  it('renders completed-tasks with the completed modifier only when all are closed', () => {
    const partial = renderCard({
      item: makeItem({
        model: {
          tasks: [
            { ref: 1, subject: 'a', is_closed: true },
            { ref: 2, subject: 'b', is_closed: false },
          ],
        },
      }),
    });
    const partialStat = partial.container.querySelector('.card-completed-tasks') as HTMLElement;
    expect(partialStat).toHaveTextContent('1 / 2');
    expect(partialStat).not.toHaveClass('completed');

    const all = renderCard({
      item: makeItem({
        model: {
          tasks: [
            { ref: 1, subject: 'a', is_closed: true },
            { ref: 2, subject: 'b', is_closed: true },
          ],
        },
      }),
    });
    const allStat = all.container.querySelector('.card-completed-tasks') as HTMLElement;
    expect(allStat).toHaveTextContent('2 / 2');
    expect(allStat).toHaveClass('completed');
  });

  it('renders the iocaine indicator when the story is iocaine', () => {
    const { container } = renderCard({ item: makeItem({ model: { is_iocaine: true } }) });
    expect(container.querySelector('.card-data .card-iocaine')).toBeInTheDocument();
  });

  it('uses the task attachment count for a task-type card', () => {
    const { container } = renderCard({
      type: 'task',
      item: makeItem({ model: { attachments: [{}, {}], total_attachments: 99 } }),
    });
    // type !== 'us' -> no estimation span, and attachments come from model.attachments.
    expect(container.querySelector('.card-estimation')).toBeNull();
    expect(container.querySelector('.card-attachments span')).toHaveTextContent('2');
  });

  describe('due-date colour/title (due-date.service parity)', () => {
    const iso = (offsetDays: number) =>
      new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

    it('is "normal due" for a far-future date', () => {
      const { container } = renderCard({ item: makeItem({ model: { due_date: iso(100) } }) });
      expect((container.querySelector('.card-due-date') as HTMLElement).getAttribute('title')).toContain(
        '(normal due)',
      );
    });

    it('is "due soon" within the 14-day window', () => {
      const { container } = renderCard({ item: makeItem({ model: { due_date: iso(7) } }) });
      expect((container.querySelector('.card-due-date') as HTMLElement).getAttribute('title')).toContain(
        '(due soon)',
      );
    });

    it('is "past due" for a date in the past', () => {
      const { container } = renderCard({ item: makeItem({ model: { due_date: iso(-5) } }) });
      expect((container.querySelector('.card-due-date') as HTMLElement).getAttribute('title')).toContain(
        '(past due)',
      );
    });

    it('honours a per-project us_duedates override', () => {
      const project = makeProject({
        us_duedates: [{ color: '#000000', name: 'custom deadline', days_to_due: 0, by_default: true }],
      });
      const { container } = renderCard({ project, item: makeItem({ model: { due_date: iso(-2) } }) });
      expect((container.querySelector('.card-due-date') as HTMLElement).getAttribute('title')).toContain(
        '(custom deadline)',
      );
    });
  });
});

/* ========================================================================== *
 * card-tasks + card-unfold + slideshow + transit ghost
 * ========================================================================== */

describe('card-tasks, card-unfold and the transit ghost', () => {
  const twoTasks = () =>
    makeItem({
      model: {
        tasks: [
          { ref: 11, subject: 'first task', is_closed: false, is_blocked: false },
          { ref: 12, subject: 'second task', is_closed: true, is_blocked: true },
        ],
      },
    });

  it('renders the related tasks list when permitted and visible', () => {
    const { container } = renderCard({ canViewTasks: true, item: twoTasks() });
    const tasks = container.querySelectorAll('.card-tasks .card-task');
    expect(tasks).toHaveLength(2);
    expect(container.querySelector('.card-task-ref')).toHaveTextContent('#11');
    expect(container.querySelector('.card-task-subject')).toHaveTextContent('first task');
    // closed/blocked modifier classes on the anchor.
    const anchors = container.querySelectorAll('.card-task a');
    expect(anchors[1].getAttribute('class')).toContain('closed-task');
    expect(anchors[1].getAttribute('class')).toContain('blocked-task');
  });

  it('hides the related tasks list without the view_tasks permission', () => {
    const { container } = renderCard({ canViewTasks: false, item: twoTasks() });
    expect(container.querySelector('.card-tasks')).toBeNull();
  });

  it('at zoom != 2, a NOT-fold-changed card keeps its related tasks unfolded', () => {
    // _setVisibility else-branch: relatedVisible = !foldStatusChanged.
    const item = twoTasks();
    (item as unknown as { foldStatusChanged: boolean }).foldStatusChanged = false;
    const { container } = renderCard({ item, zoomLevel: 3, zoom: L3, canViewTasks: true });
    expect(container.querySelector('.card-tasks')).toBeInTheDocument();
  });

  it('at zoom != 2, a fold-changed card folds its related tasks away', () => {
    // _setVisibility else-branch: relatedVisible = !foldStatusChanged -> false.
    const item = twoTasks();
    (item as unknown as { foldStatusChanged: boolean }).foldStatusChanged = true;
    const { container } = renderCard({ item, zoomLevel: 3, zoom: L3, canViewTasks: true });
    expect(container.querySelector('.card-tasks')).toBeNull();
  });

  it('renders card-unfold (down arrow at zoom != 2, unfolded) and always the loading-extra hook', () => {
    const { container } = renderCard({ item: twoTasks(), zoomLevel: 3, zoom: L3 });
    const unfold = container.querySelector('.card-unfold') as HTMLElement;
    expect(unfold).toBeInTheDocument();
    // zoomLevel != 2 and foldStatusChanged undefined -> icon-arrow-up.
    expect(unfold.querySelector('svg.icon-arrow-up')).toBeInTheDocument();
    expect(container.querySelector('.loading-extra')).toBeInTheDocument();
  });

  it('at zoom 2 the arrow flips to down when not fold-changed', () => {
    const { container } = renderCard({ item: twoTasks(), zoomLevel: 2, zoom: L2 });
    const unfold = container.querySelector('.card-unfold') as HTMLElement;
    expect(unfold.querySelector('svg.icon-arrow-down')).toBeInTheDocument();
  });

  it('at zoom 2 with foldStatusChanged=true the arrow is up', () => {
    const item = twoTasks();
    (item as unknown as { foldStatusChanged: boolean }).foldStatusChanged = true;
    const { container } = renderCard({ item, zoomLevel: 2, zoom: L2 });
    expect((container.querySelector('.card-unfold') as HTMLElement).querySelector('svg.icon-arrow-up')).toBeInTheDocument();
  });

  it('calls onToggleFold when the unfold control is clicked', () => {
    const onToggleFold = jest.fn();
    const { container } = renderCard({ item: twoTasks(), onToggleFold, usId: 101 });
    fireEvent.click(container.querySelector('.card-unfold') as HTMLElement);
    expect(onToggleFold).toHaveBeenCalledWith(101);
  });

  it('does NOT call onToggleFold when the unfold control is ctrl-clicked', () => {
    const onToggleFold = jest.fn();
    const { container } = renderCard({ item: twoTasks(), onToggleFold });
    fireEvent.click(container.querySelector('.card-unfold') as HTMLElement, { metaKey: true });
    expect(onToggleFold).not.toHaveBeenCalled();
  });

  it('omits the unfold control when there are no tasks and no attachments', () => {
    const { container } = renderCard();
    expect(container.querySelector('.card-unfold')).toBeNull();
    // loading-extra is still present (it has no ng-if in the source template).
    expect(container.querySelector('.loading-extra')).toBeInTheDocument();
  });

  it('renders the slideshow host with a single image (no arrows) only when attachments are visible and tasks are permitted (finding #10)', () => {
    const withImages = renderCard({
      canViewTasks: true,
      item: makeItem({ images: [{ thumbnail_card_url: 'https://x/t.png' }] }),
    });
    expect(withImages.container.querySelector('tg-card-slideshow')).toBeInTheDocument();
    // The single image is shown in the wrapper.
    const img = withImages.container.querySelector(
      '.card-slideshow-wrapper img',
    ) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://x/t.png');
    // A lone image has NO prev/next arrows (legacy `ng-if="vm.images.size > 1"`).
    expect(withImages.container.querySelector('.slideshow-left')).toBeNull();
    expect(withImages.container.querySelector('.slideshow-right')).toBeNull();

    const withoutImages = renderCard({ canViewTasks: true });
    expect(withoutImages.container.querySelector('tg-card-slideshow')).toBeNull();
  });

  it('shows prev/next arrows and cycles through images with wrap-around (finding #10)', () => {
    const { container } = renderCard({
      canViewTasks: true,
      item: makeItem({
        images: [
          { thumbnail_card_url: 'https://x/a.png' },
          { thumbnail_card_url: 'https://x/b.png' },
          { thumbnail_card_url: 'https://x/c.png' },
        ],
      }),
    });
    const src = (): string | null =>
      (container.querySelector('.card-slideshow-wrapper img') as HTMLImageElement).getAttribute(
        'src',
      );
    const left = (): HTMLElement => container.querySelector('.slideshow-left') as HTMLElement;
    const right = (): HTMLElement => container.querySelector('.slideshow-right') as HTMLElement;

    // With >1 image the arrows render; the carousel starts on the first image.
    expect(left()).toBeInTheDocument();
    expect(right()).toBeInTheDocument();
    expect(src()).toBe('https://x/a.png');

    // next(): a -> b -> c -> wraps back to a (index++ then 0 once past the end).
    fireEvent.click(right());
    expect(src()).toBe('https://x/b.png');
    fireEvent.click(right());
    expect(src()).toBe('https://x/c.png');
    fireEvent.click(right());
    expect(src()).toBe('https://x/a.png');

    // previous(): from a wraps to c (index-- then size-1 below 0), then to b.
    fireEvent.click(left());
    expect(src()).toBe('https://x/c.png');
    fireEvent.click(left());
    expect(src()).toBe('https://x/b.png');
  });

  it('does not render the slideshow when the view_tasks permission is absent (finding #10)', () => {
    const { container } = renderCard({
      canViewTasks: false,
      item: makeItem({ images: [{ thumbnail_card_url: 'https://x/t.png' }] }),
    });
    expect(container.querySelector('tg-card-slideshow')).toBeNull();
  });

  it('always renders the multi-drag transit ghost skeleton', () => {
    const { container } = renderCard();
    const ghost = container.querySelector('.card-transit-multi') as HTMLElement;
    expect(ghost).toBeInTheDocument();
    expect(ghost.querySelectorAll('.fake-us')).toHaveLength(2);
    expect(ghost.querySelectorAll('.fake-img')).toHaveLength(2);
    expect(ghost.querySelectorAll('.fake-text')).toHaveLength(4);
  });
});
