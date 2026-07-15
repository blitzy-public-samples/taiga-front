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

import { useRef } from 'react';
import type { MouseEvent, UIEvent } from 'react';
import type { UserStory } from '../state/backlogReducer';
import { UserStoryRow } from './UserStoryRow';
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
  /** Optional click on the header role-points filter icon (tg-us-role-points-selector). */
  onRolePointsFilterClick?: () => void;
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
  } = props;

  // Anchor index for an inclusive shift-range selection: the index of the last
  // row whose checkbox was toggled. Reproduces `lastChecked` (main.coffee:820-861).
  // A ref (not state) because it is read-only bookkeeping consumed on the NEXT
  // toggle and must NOT trigger a re-render on its own.
  const lastClickedIndexRef = useRef<number | null>(null);

  // The body is a @dnd-kit droppable. `data.isBacklog`/`sprintId: null` is the
  // marker the shared backlog drag-end handler reads to route a drop back to the
  // unassigned backlog (targetSprintId = null). `BacklogApp` supplies the single
  // outer <DndContext>; this component never renders one and never a nested one.
  const { setNodeRef } = useDroppable({ id: 'backlog', data: { sprintId: null, isBacklog: true } });

  // Sortable item ids for the ordered visible backlog. @dnd-kit accepts numeric
  // ids (UniqueIdentifier = string | number).
  const itemIds = userstories.map((us) => us.id);

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
            <div className="inner" onClick={onRolePointsFilterClick}>
              <span className="header-points">Points</span>
              <Svg icon="icon-filter" />
            </div>
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
            />
          ))}
        </SortableContext>
        {/* Trailing `div(tg-loading="ctrl.loadingUserstories")`: an
            otherwise-empty element that carries the spinner classes only while a
            page is loading (`tg-loading` is a reference-only Angular directive). */}
        <div className={loadingUserstories ? 'loading-spinner is-loading' : undefined} />
      </div>
    </>
  );
}
