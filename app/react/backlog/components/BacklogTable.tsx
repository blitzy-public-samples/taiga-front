/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BacklogTable — React port of the AngularJS Backlog "unassigned" table.
 *
 * Presentational container that renders the Backlog table exactly as the
 * AngularJS 1.5.10 markup did, so the existing compiled global SCSS
 * (`app/styles/layout/backlog.scss`,
 * `app/styles/modules/backlog/backlog-table.scss`) styles the React output with
 * ZERO visual change (AAP 0.3.4). It renders a fixed column-header row and a
 * scrollable, droppable body containing one `<UserStoryRow>` per backlog story.
 *
 * Markup & behavioral sources (REFERENCE ONLY — never imported; AAP 0.7 HARD RULES):
 *   - app/partials/includes/modules/backlog-table.jade:8-28 — the EXACT DOM
 *     reproduced here: the `.backlog-table-header > .row.backlog-table-title`
 *     column row and the `.backlog-table-body` with its `tg-backlog-sortable`,
 *     `ng-class="{'show-tags': …, 'active-filters': …, 'forecasted-stories': …}"`,
 *     and `infinite-scroll*` attributes, plus the trailing `tg-loading` element.
 *   - app/partials/includes/components/backlog-row.jade — the per-row DOM,
 *     implemented by the sibling `UserStoryRow` and rendered once per story.
 *   - app/coffee/modules/backlog/main.coffee:820-861 — the shift-range
 *     multi-select: `lastChecked` (the last toggled checkbox) plus a
 *     window-tracked `shiftPressed` flag; on a checkbox change with Shift held,
 *     the rows BETWEEN the previously-checked row and the current one are filled
 *     in (`nextUntil`/`prevUntil`), producing an inclusive contiguous range.
 *     Reproduced here by `handleToggleSelect` over the ordered `userstories`.
 *   - app/coffee/modules/backlog/main.coffee — `ctrl.loadUserstories()` fires as
 *     the body nears the bottom unless `ctrl.disablePagination ||
 *     !ctrl.firstLoadComplete` (the jade `infinite-scroll-disabled` expression).
 *     Reproduced here by `handleScroll`.
 *
 * COEXISTENCE BOUNDARY (AAP 0.4.2): this component is PURELY presentational —
 * every piece of data and every side-effecting callback arrives through props.
 * It performs NO `/api/v1/` calls and NO WebSocket subscriptions; the drag-end
 * handler (`createBacklogDragEndHandler`) and the multi-selection state both live
 * in `BacklogApp` (the parent), which threads the selection to the
 * move-to-sprint toolbar AND to the drag handler's `getSelectedIds`. Accordingly
 * the import surface is limited to `react`, the sibling `UserStoryRow`, the
 * type-only `UserStory`, and the two `@dnd-kit` packages — nothing from
 * `app/coffee`, `app/partials`, `app/styles`, the shared api/events/config
 * modules, or the shared `DndProvider` (the single outer `<DndContext>` is
 * rendered by `BacklogApp`).
 *
 * DnD topology: this table owns its OWN `<SortableContext>` (the ordered row
 * list) and makes its body a `useDroppable` target keyed `'backlog'` with
 * `data: { sprintId: null, isBacklog: true }` — the marker the shared backlog
 * drag-end handler maps to `targetSprintId = null` (the "move back to the
 * unassigned backlog" case). The row-level sortable wiring lives INSIDE
 * `UserStoryRow` (via its own `useSortableRow`), so this file imports no row hook.
 *
 * Uses the automatic JSX runtime (`jsx: "react-jsx"`), so React is intentionally
 * NOT imported as a value; `useRef` is the only value import.
 */

import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, UIEvent } from 'react';
import type { UserStory } from '../state/backlogReducer';
import { UserStoryRow, type RowStatusOption } from './UserStoryRow';
import type { EstimationPoint, EstimationRole } from '../../shared/estimation';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';

/**
 * Renders a Taiga sprite icon, mirroring the rendered output of the AngularJS
 * `tgSvg` directive (`tg-svg(svg-icon="icon-filter")` in the header). React maps
 * `className` -> `class`; `xlinkHref` emits the SVG 1.1 `xlink:href` attribute
 * while the extra `href` covers SVG 2 / Firefox (the Playwright engine used for
 * the migration's visual evidence, AAP 0.6.2). Kept module-local so no shared
 * asset module is imported (globals-only boundary). No `declare global`
 * `namespace JSX` augmentation is added (it would conflict with sibling files).
 */
function Svg({ icon }: { icon: string }) {
  return (
    <svg className={`icon ${icon}`}>
      <use xlinkHref={`#${icon}`} {...({ href: `#${icon}` } as Record<string, unknown>)} />
    </svg>
  );
}

/**
 * The canonical "visually hidden" style — content that is available to assistive
 * technology (screen readers) but occupies NO visible space and never affects
 * layout, so the AAP 0.3.4 zero-visual-change contract holds. Applied INLINE
 * (rather than via a class) because the compiled global SCSS ships no `.sr-only`
 * / visually-hidden utility, so a class-based approach would render the label as
 * ordinary visible text. This is the standard clip-rect technique used by design
 * systems for accessible-but-invisible labels.
 */
const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * Props for {@link BacklogTable}. All data + callbacks are supplied by
 * `BacklogApp` (the presentational-split rule). These mirror the `ctrl.*` scope
 * the AngularJS `backlog-table.jade` bound against.
 */
export interface BacklogTableProps {
  /** Ordered visible backlog user stories. */
  userstories: UserStory[];
  /** ng-class 'show-tags' on the body. */
  showTags: boolean;
  /** ng-class 'active-filters' on the body. */
  activeFilters: boolean;
  /** ng-class 'forecasted-stories' on the body (velocity forecasting). */
  displayVelocity: boolean;
  /** modify_us permission -> header draggable/input columns + row readonly/drag. */
  canModifyUs: boolean;
  /** Current selection (owned by BacklogApp so the move-to-sprint toolbar + drag getSelectedIds can read it). */
  selectedIds: ReadonlySet<number>;
  /** Called with the next selection after a (possibly shift-range) checkbox toggle. */
  onSelectionChange: (next: ReadonlySet<number>) => void;
  /** tg-loading spinner state at the bottom of the body. */
  loadingUserstories: boolean;
  /** Disables infinite-scroll pagination. */
  disablePagination: boolean;
  /** Whether the first page has loaded (infinite scroll stays disabled until true). */
  firstLoadComplete: boolean;
  /** Loads the next page (ctrl.loadUserstories). */
  onLoadMore: () => void;
  /** id of the first US in the backlog -> adds the `first` class to that row's options button. */
  firstUsInBacklogId?: number;
  /** Builds the US detail URL for a row anchor. */
  buildUserStoryUrl: (us: UserStory) => string;
  /** Status display name for a row. */
  getStatusName: (us: UserStory) => string;
  /** Optional status color for a row. */
  getStatusColor?: (us: UserStory) => string | undefined;
  /** Optional points label for a row. */
  getPointsLabel?: (us: UserStory) => string | undefined;
  /** Row status-widget click. */
  onStatusClick?: (us: UserStory) => void;
  /**
   * Row options (…) button click.
   *
   * The `event` is OPTIONAL by design: the sibling `UserStoryRow` — a FIXED
   * dependency this table must consume as-is (AAP: "match UserStoryRow's actual
   * signature") — invokes its own `onOptionsClick` with only the user-story id
   * and forwards NO DOM event, so a row click cannot supply one. The parameter is
   * retained and typed as a React `MouseEvent` so a caller that DOES hold an
   * event (or a future row that forwards one) can pass it through; today it is
   * always omitted from a row-triggered invocation.
   */
  onOptionsClick?: (us: UserStory, event?: MouseEvent) => void;
  /**
   * Optional activation of the header role-points filter control
   * (`tg-us-role-points-selector` in `backlog-table.jade:14-16`, which opens the
   * per-role points popover — `us-role-points-popover.jade`).
   *
   * The DOM event is forwarded so a caller can ANCHOR the popover to the control
   * (`event.currentTarget` is the `.inner` element) and manage focus — mirroring
   * how the AngularJS `tgUsRolePointsSelector` directive positioned its popover
   * relative to the clicked element. The parameter is OPTIONAL: keyboard
   * activation forwards a `KeyboardEvent`, pointer activation a `MouseEvent`, and
   * a programmatic caller may omit it entirely.
   */
  onRolePointsFilterClick?: (
    event?: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ) => void;

  /* ------------------- inline controls (finding #12) ------------------- */
  /** All project user-story statuses -> each row's inline status dropdown. */
  statuses?: RowStatusOption[];
  /** Project estimation points -> each row's inline points editor. */
  points?: EstimationPoint[];
  /** Project roles -> each row's points editor + the header role-view popover. */
  roles?: EstimationRole[];
  /** Current "view points per Role" selection (`null` = totals). */
  pointsViewRoleId?: number | null;
  /** `delete_us` permission -> gates each row's ⋮ "Delete" item. */
  canDeleteUs?: boolean;
  /** Row status selected -> PATCH status (owned by BacklogApp). */
  onChangeStatus?: (us: UserStory, statusId: number) => void;
  /** Row per-role point selected -> PATCH points (owned by BacklogApp). */
  onChangePoints?: (us: UserStory, roleId: number, pointId: number) => void;
  /** Row ⋮ "Edit" -> open/navigate to the story editor. */
  onEditStory?: (us: UserStory) => void;
  /** Row ⋮ "Delete" -> confirm + delete. */
  onDeleteStory?: (us: UserStory) => void;
  /** Row ⋮ "Move to top" -> bulk backlog-order move. */
  onMoveToTop?: (us: UserStory) => void;
  /**
   * Header "view points per Role" selection changed (`null` = All roles). Drives
   * the reducer `pointsViewRoleId`; reproduces the legacy `uspoints:select` /
   * `uspoints:clear-selection` broadcast the header directive fired.
   */
  onSelectRoleView?: (roleId: number | null) => void;
}

/**
 * The Backlog table. See the module doc comment for the full source mapping
 * (backlog-table.jade:8-28 + backlog-row.jade + main.coffee:820-861).
 */
export function BacklogTable(props: BacklogTableProps) {
  const {
    userstories,
    showTags,
    activeFilters,
    displayVelocity,
    canModifyUs,
    selectedIds,
    onSelectionChange,
    loadingUserstories,
    disablePagination,
    firstLoadComplete,
    onLoadMore,
    firstUsInBacklogId,
    buildUserStoryUrl,
    getStatusName,
    getStatusColor,
    getPointsLabel,
    onStatusClick,
    onOptionsClick,
    onRolePointsFilterClick,
    statuses,
    points,
    roles,
    pointsViewRoleId = null,
    canDeleteUs = false,
    onChangeStatus,
    onChangePoints,
    onEditStory,
    onDeleteStory,
    onMoveToTop,
    onSelectRoleView,
  } = props;

  // Local open/close state for the header "view points per Role" popover
  // (reproduces the `UsRolePointsSelectorDirective` open/close on the header
  // control, main.coffee:1024-1030). Only the header popover lives here; each
  // row owns its own status/points/options popovers.
  const [roleViewOpen, setRoleViewOpen] = useState(false);
  // Computable roles for the header popover (the header only lists roles that
  // participate in estimation — filter mirrors estimation.coffee:182).
  const computableRolesForHeader = (roles ?? []).filter((r) => Boolean(r.computable));

  // Anchor index for an inclusive shift-range selection: the index of the last
  // row whose checkbox was toggled. Reproduces `lastChecked` (main.coffee:820-861).
  // A ref (not state) because it is read-only bookkeeping consumed on the NEXT
  // toggle and must NOT trigger a re-render on its own.
  const lastClickedIndexRef = useRef<number | null>(null);

  // Sortable item ids for the ordered visible backlog. @dnd-kit accepts numeric
  // ids (UniqueIdentifier = string | number). Computed BEFORE the droppable
  // registration below so the same authoritative order can be attached to the
  // container's drag data (see `orderedIds` on `useDroppable`).
  const itemIds = userstories.map((us) => us.id);

  // The body is a @dnd-kit droppable. `data.isBacklog`/`sprintId: null` is the
  // marker the shared backlog drag-end handler reads to route a drop back to the
  // unassigned backlog (targetSprintId = null). `BacklogApp` supplies the single
  // outer <DndContext>; this component never renders one and never a nested one.
  //
  // `orderedIds` carries the CURRENT ordered id list of this container's rows
  // (C-02 fix). When a story is dropped onto the backlog BODY itself — rather
  // than onto a specific `<UserStoryRow>` sortable — `over` is THIS droppable,
  // so `over.data.current` is the ONLY place the shared drag-end handler can
  // recover the destination order. `createBacklogDragEndHandler`'s data path
  // reads it via `readOrderedIds(overData)` (`shared/dnd/sortable.ts`), which
  // prefers an explicit `orderedIds: number[]` and otherwise finds nothing on a
  // bare `useDroppable` (which, unlike `useSortable`, attaches no
  // `sortable.items`). Without it the handler computes `index = -1` and null
  // neighbors, corrupting the drop position; with it the handler derives the
  // correct `previousUs`/`nextUs`/`index` for the frozen
  // `/userstories/bulk_update_backlog_order` call. The field is drag metadata
  // only — it is never rendered, so visual output is unchanged.
  const { setNodeRef } = useDroppable({
    id: 'backlog',
    data: { sprintId: null, isBacklog: true, orderedIds: itemIds },
  });

  // Body class list: the base class plus the three `ng-class` toggles from the
  // jade (kept as a joined string so the exact class names reach the SCSS).
  const bodyClasses = ['backlog-table-body'];
  if (showTags) bodyClasses.push('show-tags');
  if (activeFilters) bodyClasses.push('active-filters');
  if (displayVelocity) bodyClasses.push('forecasted-stories');

  /**
   * Inclusive shift-range multi-select over the ordered `userstories` list
   * (main.coffee:820-861). With Shift held and a previous anchor present, every
   * row between the anchor and the clicked row (inclusive) is ADDED; otherwise
   * the clicked row toggles on/off. Selection state is owned by `BacklogApp`, so
   * this reads `selectedIds` and emits `onSelectionChange` with a NEW `Set` — it
   * never mutates the incoming (readonly) set.
   */
  const handleToggleSelect = (usId: number, shiftKey: boolean) => {
    const orderedIds = userstories.map((us) => us.id);
    const clickedIndex = orderedIds.indexOf(usId);
    const next = new Set(selectedIds);

    if (shiftKey && lastClickedIndexRef.current !== null && clickedIndex !== -1) {
      const start = Math.min(lastClickedIndexRef.current, clickedIndex);
      const end = Math.max(lastClickedIndexRef.current, clickedIndex);
      for (let i = start; i <= end; i += 1) {
        next.add(orderedIds[i]); // inclusive range -> add
      }
    } else if (next.has(usId)) {
      next.delete(usId);
    } else {
      next.add(usId);
    }

    lastClickedIndexRef.current = clickedIndex;
    onSelectionChange(next);
  };

  /**
   * Infinite-scroll trigger. Fires `onLoadMore` when the body is scrolled within
   * 100px of the bottom, gated by `disablePagination || !firstLoadComplete` —
   * the React equivalent of the jade `infinite-scroll-disabled` expression.
   */
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (disablePagination || !firstLoadComplete) {
      return;
    }
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 100) {
      onLoadMore();
    }
  };

  /**
   * Keyboard activation for the role-points filter control (M-25 accessibility).
   * The control is a non-`<button>` element (kept a `<div>` so the existing
   * class-based SCSS renders it identically — see the JSX comment), so it does
   * NOT get the browser's built-in Enter/Space activation. This handler restores
   * it: Enter or Space activate the control and forward the event to
   * `onRolePointsFilterClick` so the caller can anchor/focus the popover, exactly
   * as a pointer click does. `preventDefault` on Space stops the page from
   * scrolling on activation.
   */
  const handleRolePointsKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      handleRolePointsActivate(event);
    }
  };

  /**
   * Activate the header "view points per Role" control (finding #12). Fires the
   * legacy "activated" signal (kept for parity/telemetry) AND toggles the
   * role-view popover when the role list + selection handler are supplied.
   */
  const handleRolePointsActivate = (
    event?: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ) => {
    onRolePointsFilterClick?.(event);
    if (onSelectRoleView && computableRolesForHeader.length > 0) {
      setRoleViewOpen((cur) => !cur);
    }
  };

  // Header label: "Points" when no role is selected, else the selected role name
  // (reproduces `header-points` text set by uspoints:select/clear-selection,
  // main.coffee:1013-1020).
  const selectedRoleName =
    pointsViewRoleId != null
      ? (computableRolesForHeader.find((r) => r.id === pointsViewRoleId)?.name ?? 'Points')
      : 'Points';

  return (
    <>
      <div className="backlog-table-header">
        <div className="row backlog-table-title">
          {/* `tg-check-permission="modify_us"` -> the drag-handle and checkbox
              header columns render only when the user can modify user stories. */}
          {canModifyUs ? <div className="draggable-us-column" /> : null}
          {canModifyUs ? <div className="input" /> : null}
          <div className="user-stories">User Story</div>
          <div className="status">Status</div>
          <div className="points" title="Select view per Role">
            {/* Role-points filter control (`div.inner(tg-us-role-points-selector)`
                in backlog-table.jade:14). It STAYS a `<div>` — not a `<button>` —
                so the class-based SCSS (`.points .inner { display: flex }`,
                `backlog-table.scss`) renders it byte-identically and no
                user-agent button chrome (border/background/font) leaks in,
                preserving the AAP 0.3.4 zero-visual-change contract. Accessibility
                (M-25) is added WITHOUT a visual change: `role="button"` +
                `tabIndex=0` make it a focusable, screen-reader-announced control;
                `aria-haspopup="dialog"` tells AT it opens the role-points popover;
                `aria-label` gives it the accessible name the AngularJS `title`
                conveyed only visually. The DOM event is forwarded to
                `onRolePointsFilterClick` (M-09) so the caller can anchor the
                popover to `event.currentTarget`. Keyboard Enter/Space activation
                is restored by `handleRolePointsKeyDown`. */}
            <div
              className="inner"
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              aria-expanded={roleViewOpen}
              aria-label="Select view per Role"
              onClick={handleRolePointsActivate}
              onKeyDown={handleRolePointsKeyDown}
            >
              <span className="header-points">{selectedRoleName}</span>
              <Svg icon="icon-filter" />
            </div>
            {/* Role-view popover (`us-role-points-popover.jade` -> `.pop-role`):
                "All roles" (clear) + one entry per computable role. Selecting an
                entry drives the reducer `pointsViewRoleId` via `onSelectRoleView`
                so every row's points cell switches display together. */}
            {roleViewOpen && onSelectRoleView && (
              <ul className="popover pop-role" style={{ display: 'block' }}>
                <li>
                  <a
                    className={
                      pointsViewRoleId == null
                        ? 'clear-selection active-popover'
                        : 'clear-selection'
                    }
                    href=""
                    title="All roles"
                    onClick={(e) => {
                      e.preventDefault();
                      setRoleViewOpen(false);
                      onSelectRoleView(null);
                    }}
                  >
                    <span className="item-text">All roles</span>
                  </a>
                </li>
                {computableRolesForHeader.map((role) => (
                  <li key={role.id}>
                    <a
                      className={pointsViewRoleId === role.id ? 'role active-popover' : 'role'}
                      href=""
                      title={role.name}
                      data-role-id={role.id}
                      onClick={(e) => {
                        e.preventDefault();
                        setRoleViewOpen(false);
                        onSelectRoleView(role.id);
                      }}
                    >
                      <span className="item-text">{role.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="us-header-options" />
        </div>
      </div>

      <div ref={setNodeRef} className={bodyClasses.join(' ')} onScroll={handleScroll}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {userstories.map((us) => (
            <UserStoryRow
              key={us.id}
              us={us}
              showTags={showTags}
              selected={selectedIds.has(us.id)}
              canModify={canModifyUs}
              isFirstInBacklog={us.id === firstUsInBacklogId}
              detailUrl={buildUserStoryUrl(us)}
              statusName={getStatusName(us)}
              statusColor={getStatusColor?.(us)}
              pointsLabel={getPointsLabel?.(us)}
              onToggleSelect={handleToggleSelect}
              // Adapters bridge BacklogTable's UserStory-based public callbacks to
              // UserStoryRow's (usId)-based slots (see the `onOptionsClick` prop
              // doc). The `us` is captured from this map iteration; UserStoryRow's
              // own `us.id` argument is intentionally ignored. Passing `undefined`
              // when the outer handler is absent preserves the row's no-op path.
              onStatusClick={onStatusClick ? () => onStatusClick(us) : undefined}
              onOptionsClick={onOptionsClick ? () => onOptionsClick(us) : undefined}
              // Inline controls (finding #12): pass the project reference data +
              // the (us)-based action handlers straight through. The row owns its
              // own popover open/close state; these handlers perform the writes.
              statuses={statuses}
              points={points}
              roles={roles}
              pointsViewRoleId={pointsViewRoleId}
              canDelete={canDeleteUs}
              onChangeStatus={onChangeStatus}
              onChangePoints={onChangePoints}
              onEditStory={onEditStory}
              onDeleteStory={onDeleteStory}
              onMoveToTop={onMoveToTop}
            />
          ))}
        </SortableContext>
        {/* Trailing `div(tg-loading="ctrl.loadingUserstories")`: carries the
            spinner classes only while a page is loading (`tg-loading` is a
            reference-only Angular directive), so the VISUAL output is unchanged
            (empty when idle, spinner classes when loading — AAP 0.3.4).

            Accessibility (M-27): the element is ALWAYS a live status region
            (`role="status"` + `aria-live="polite"`) so assistive technology
            registers it up front and announces changes without stealing focus.
            `aria-busy` communicates the loading state independently of the
            purely-visual spinner (color/animation), and a visually-hidden label
            gives screen-reader users the same "loading more user stories"
            information a sighted user infers from the spinner. The visually-hidden
            span is rendered ONLY while loading and uses the inline
            {@link VISUALLY_HIDDEN} clip-rect style, so it adds no visible box. */}
        <div
          role="status"
          aria-live="polite"
          aria-busy={loadingUserstories}
          className={loadingUserstories ? 'loading-spinner is-loading' : undefined}
        >
          {loadingUserstories ? (
            <span style={VISUALLY_HIDDEN}>Loading more user stories…</span>
          ) : null}
        </div>
      </div>
    </>
  );
}
