/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BacklogTable — the backlog user-story table (composite, render-only).
 *
 * React port of the AngularJS backlog table: the header row plus the scrollable
 * body of draggable user-story rows. It reproduces, byte-for-byte in DOM and
 * class names, the following DELETE-marked AngularJS sources:
 *   - `app/partials/includes/modules/backlog-table.jade` — the
 *     `.backlog-table-header` + `.backlog-table-body` shell (this component
 *     renders exactly those two siblings; the surrounding
 *     `section.backlog-table`, the `.backlog-top` menu, forecasting, and the
 *     lightbox hosts belong to `BacklogApp`, NOT here).
 *   - `app/partials/includes/components/backlog-row.jade` — one US row, ported
 *     to the module-local {@link BacklogRow} child (one set of hooks per row).
 *   - `app/coffee/modules/backlog/main.coffee` — the `tgUsEditSelector`,
 *     `tgUsRolePointsSelector` and `tgBacklogUsPoints` directives plus the
 *     `BacklogController` methods (`getLinkParams`, `updateUserStoryStatus`,
 *     `editUserStory`, `deleteUserStory`, `moveUsToTopOfBacklog`), now surfaced
 *     as the callback props below.
 *   - `app/coffee/modules/common/popovers.coffee` — the `tgUsStatus` directive
 *     (`UsStatusDirective`, L19-92) and its template
 *     `app/partials/common/popover/popover-us-status.jade`, reproduced inline as
 *     the `.status` cell + `pop-status` popover.
 *
 * COMPOSITION
 *   - Nests {@link UsRolePointsSelector} in the header `.points` cell (the
 *     points-column role filter; it renders its OWN `.inner` root).
 *   - Nests {@link UsEditSelector} per row (the `.us-option` options popover; it
 *     renders its OWN `.us-option` root).
 *   - Registers the `.backlog-table-body` as a `@dnd-kit/core` DROPPABLE (id
 *     `'backlog'`) and each `.row.us-item-row` as a `@dnd-kit/core` DRAGGABLE.
 *     The `DndContext`, sensors and `onDragEnd` live in the sibling
 *     `../dnd/BacklogDndContext`, provided by an ancestor at runtime — it is a
 *     render-tree relationship and is deliberately NOT imported here (nor is
 *     `../state`).
 *
 * RENDER-ONLY
 *   The only local UI state is the header role filter (`selectedRoleId`, owned
 *   by {@link BacklogTable}) and each row's status-popover open flag (owned by
 *   {@link BacklogRow}). This component performs NO fetch, NO `/api/v1/` call and
 *   NO WebSocket work; status changes, points-cell clicks and checkbox selection
 *   are emitted upward as callbacks so the container (`BacklogApp`) can enact the
 *   backend mutations and reloads, exactly as the AngularJS directives delegated
 *   to their `ctrl.*` methods.
 *
 * STYLING
 *   Reuses the EXACT existing SCSS class names (verified in
 *   `app/styles/modules/backlog/backlog-table.scss`) for pixel fidelity; it
 *   neither imports nor rewrites any SCSS.
 *
 * Uses the `jsx: "react-jsx"` automatic runtime, so there is deliberately no
 * `import React` statement — only the hooks actually used are imported.
 */

import { useState, useRef, useEffect } from 'react';

import { useDroppable, useDraggable } from '@dnd-kit/core';

import { UsEditSelector } from './UsEditSelector';
import { UsRolePointsSelector } from './UsRolePointsSelector';

import { can } from '../../shared/permissions';

import type { UserStory, Status, Project, Tag } from '../../shared/types';

/*
 * Taiga renders inline SVG sprites through its `<tg-svg>` web component, which
 * is not a standard HTML element, so we widen the JSX intrinsic-element table
 * locally (mirroring the sibling backlog/kanban components). Typed `any` because
 * the element is opaque to React/TS and is resolved by the existing sprite
 * runtime at render time. (Duplicate ambient merges across sibling modules are
 * harmless.)
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'tg-svg': any;
    }
  }
}

/**
 * Render Taiga's `<tg-svg>` sprite wrapper, mirroring the AngularJS
 * `tg-svg(svg-icon="…")` markup. The inner `<svg>` carries the `icon <name>`
 * classes the retained SCSS targets, and `<use>` references the sprite by id.
 * `className` is forwarded onto the custom element for parity with the shared
 * convention. Icons used by this table: `icon-draggable` (row drag handle),
 * `icon-clock` (due-date), `icon-arrow-down` (status disclosure); the header
 * `icon-filter` and the per-row `icon-more-vertical` are rendered by the nested
 * {@link UsRolePointsSelector} / {@link UsEditSelector}.
 */
function svgIcon(icon: string, className?: string) {
  return (
    <tg-svg class={className}>
      <svg className={`icon ${icon}`}>
        <use xlinkHref={`#${icon}`} />
      </svg>
    </tg-svg>
  );
}

/**
 * Props for {@link BacklogTable}.
 *
 * The container (`BacklogApp`) supplies the data (`userstories`, `statuses`,
 * `project`) and the presentation flags, and receives every user intent through
 * the `on*` callbacks (the React equivalents of the legacy `ctrl.*` methods).
 * `selectedRoleId` is intentionally NOT a prop — it is internal state owned by
 * this component (see the body) and shared between the header selector and the
 * rows, mirroring the directive's `uspoints:select` broadcast being scoped to
 * the backlog table.
 */
export interface BacklogTableProps {
  /** The backlog-order user stories to render as rows. */
  userstories: UserStory[];
  /** Project US statuses — drive the inline status popover + status colours. */
  statuses: Status[];
  /** The owning project; supplies `my_permissions` and the computable roles. */
  project: Project;
  /** Body `show-tags` class + render the per-row tag pills. Default `false`. */
  showTags?: boolean;
  /** Body `active-filters` class. Default `false`. */
  activeFilters?: boolean;
  /** Body `forecasted-stories` class (velocity forecast). Default `false`. */
  displayVelocity?: boolean;
  /** Selected US ids → each row's checkbox `checked` state. Default `[]`. */
  checkedIds?: number[];
  /**
   * Visible-refs filter (the legacy `inArray:visibleUserStories:'ref'`): when
   * provided, only rows whose `ref` is in this list render; `undefined` shows
   * all rows.
   */
  visibleUserStories?: number[];
  /**
   * `us.id` of the first backlog US → the `first` class on its options trigger
   * (a styling nudge so the top row's popover opens downward). Defaults to the
   * first rendered story's id.
   */
  firstUsInBacklog?: number;
  /** Optional trailing loading placeholder (maps the legacy `tg-loading`). */
  loading?: boolean;
  /**
   * Optional query string appended to each US detail href (mirrors
   * `tg-nav-get-params="{{ ctrl.getLinkParams() }}"`). Default: no params.
   */
  getLinkParams?: (us: UserStory) => string;
  /** Optional infinite-scroll sentinel callback (maps `infinite-scroll`). */
  onLoadMore?: () => void;
  /** Edit a story → legacy `ctrl.editUserStory`. */
  onEditUs: (us: UserStory) => void;
  /** Delete a story → legacy `ctrl.deleteUserStory`. */
  onDeleteUs: (us: UserStory) => void;
  /** Move a story to the top of the backlog → legacy `ctrl.moveUsToTopOfBacklog`. */
  onMoveUsToTop: (us: UserStory) => void;
  /** Toggle a row's checkbox (with `shiftKey` for range selection). */
  onToggleCheck: (us: UserStory, checked: boolean, shiftKey: boolean) => void;
  /**
   * Status-popover selection → the container saves + reloads (mirrors the
   * directive's `$repo.save(us).then -> onUpdate`).
   */
  onUpdateStatus: (us: UserStory, newStatusId: number) => void;
  /** Optional points-cell click → the container opens the points editor. */
  onEditPoints?: (us: UserStory, roleId: number | null) => void;
}

/**
 * Props for the module-local {@link BacklogRow}. `BacklogTable` derives these
 * once (`canModify`, `selectedRoleId`, the per-row `isChecked` / `isFirst`) and
 * forwards the container callbacks straight through.
 */
interface BacklogRowProps {
  us: UserStory;
  project: Project;
  statuses: Status[];
  canModify: boolean;
  showTags: boolean;
  selectedRoleId: number | null;
  isChecked: boolean;
  isFirst: boolean;
  getLinkParams?: (us: UserStory) => string;
  onEditUs: (us: UserStory) => void;
  onDeleteUs: (us: UserStory) => void;
  onMoveUsToTop: (us: UserStory) => void;
  onToggleCheck: (us: UserStory, checked: boolean, shiftKey: boolean) => void;
  onUpdateStatus: (us: UserStory, newStatusId: number) => void;
  onEditPoints?: (us: UserStory, roleId: number | null) => void;
}

/**
 * The minimal `project.roles` entry this table reads. There is no `Role` shape
 * in `../../shared/types` (the board never modelled roles) and `Project.roles`
 * is only reachable through the interface's `[key: string]: unknown` index
 * signature, so we declare the minimal shape locally and read `project.roles`
 * via a safe cast — exactly as the sibling {@link UsRolePointsSelector} does.
 */
interface ComputableRole {
  id: number;
  name: string;
  computable?: boolean;
}

/**
 * The minimal epic pill shape read off a story's `us.epics`, which is not part
 * of the trimmed `UserStory` type and is therefore read through the index
 * signature (see below).
 */
interface EpicPill {
  id: number;
  ref: number;
  subject: string;
  color: string;
}

/**
 * A single backlog user-story row (`backlog-row.jade`).
 *
 * Extracted as its own component because every row needs its OWN hooks — the
 * `@dnd-kit` `useDraggable` registration and the status-popover
 * `useState`/`useRef`/`useEffect` — which React's rules of hooks forbid from
 * running inside a `.map(...)` callback in the parent. One `BacklogRow`
 * instance therefore owns exactly one set of hooks.
 *
 * Behaviour reproduced faithfully from the AngularJS row + `tgUsStatus`:
 *  - The row is a `@dnd-kit` draggable (`moves: hasClass('row')` in the legacy
 *    `backlog/sortable.coffee`), gated by `modify_us`; only the visible
 *    `.draggable-us-row` handle activates the drag, keeping the checkbox and
 *    links clickable.
 *  - `data-id={us.id}` is REQUIRED — the sibling `BacklogDndContext` computes
 *    the drop neighbours (`previousUs` / `nextUs`) by reading it off the DOM.
 *  - The `.status` cell reproduces `tgUsStatus`: the anchor is coloured with the
 *    current status colour and shows its name; clicking it opens the
 *    `pop-status` popover; picking a status emits `onUpdateStatus`; when the
 *    user lacks `modify_us` the anchor is `not-clickable` and never opens.
 *  - The `.points` cell reproduces `tgBacklogUsPoints` display: the total, or
 *    (when a role is filtered and >1 computable role exists) the per-role value
 *    followed by the total in a nested `<span>`.
 */
const BacklogRow = ({
  us,
  project,
  statuses,
  canModify,
  showTags,
  selectedRoleId,
  isChecked,
  isFirst,
  getLinkParams,
  onEditUs,
  onDeleteUs,
  onMoveUsToTop,
  onToggleCheck,
  onUpdateStatus,
  onEditPoints,
}: BacklogRowProps): JSX.Element => {
  // Draggable registration. `disabled: !canModify` reproduces the legacy
  // `modify_us` gate on `backlog/sortable.coffee`. The row is the draggable
  // node (`setNodeRef`); the `.draggable-us-row` handle is the activator
  // (`setActivatorNodeRef` + `listeners`), so only the handle starts a drag.
  const { setNodeRef, setActivatorNodeRef, attributes, listeners } = useDraggable({
    id: `us-${us.id}`,
    data: { type: 'us', usId: us.id, fromSprintId: null },
    disabled: !canModify,
  });

  // Local UI state ONLY: whether this row's status popover is open.
  const [statusOpen, setStatusOpen] = useState(false);
  // Root `.status` element, used for the outside-click containment check — the
  // React equivalent of the AngularJS `$el`-appended popover closing on an
  // outside click.
  const statusRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape closing, gated on `statusOpen` so the document
  // listeners exist only while the popover is shown. A `mousedown` outside
  // `statusRef` — or the Escape key — closes the popover; the cleanup removes
  // both listeners on close/unmount (parity with the directive's `$el.off()`).
  useEffect(() => {
    if (!statusOpen) {
      return;
    }

    const onDocumentMouseDown = (event: globalThis.MouseEvent) => {
      const root = statusRef.current;
      if (root && !root.contains(event.target as Node)) {
        setStatusOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setStatusOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [statusOpen]);

  // Fields that are NOT on the trimmed `UserStory` type (`is_blocked`, `new`,
  // `due_date`, `epics`) are read through the type's `[key: string]: unknown`
  // index signature via a single documented cast.
  const extra = us as UserStory & Record<string, unknown>;
  const isBlocked = Boolean(extra.is_blocked);
  const isNew = Boolean(extra.new);
  const dueDate = extra.due_date as string | undefined;
  const epics = extra.epics as EpicPill[] | undefined;
  const tags: Tag[] = us.tags ?? [];

  // Current status → drives the anchor colour + the `us-status-bind` text and
  // the `active-popover` marker inside the popover (mirrors `render(us)`).
  const currentStatus = statuses.find((s) => s.id === us.status);

  // Points cell (mirrors `tgBacklogUsPoints` + `us-estimation-total.jade`).
  // `computableRoles` = `_.filter(project.roles, "computable")`; the cell is
  // editable only with `modify_us` AND at least one computable role.
  const computableRoles = (
    (project.roles as ComputableRole[] | undefined) ?? []
  ).filter((r) => r.computable);
  const totalPoints = us.total_points ?? 0;
  const editable = canModify && computableRoles.length > 0;

  // The US detail href (mirrors `tg-nav="project-userstories-detail:…"` with the
  // optional `tg-nav-get-params`). The subject is rendered as PLAIN TEXT: the
  // original used the `| emojify` filter, but we deliberately do NOT use
  // `dangerouslySetInnerHTML` (render-only + safe).
  const baseHref = `/project/${project.slug}/us/${us.ref}`;
  const linkParams = getLinkParams ? getLinkParams(us) : '';
  const usHref = linkParams ? `${baseHref}${linkParams}` : baseHref;

  return (
    <div
      ref={setNodeRef}
      className={`row us-item-row${isBlocked ? ' blocked' : ''}${
        isNew ? ' new' : ''
      }${!canModify ? ' readonly' : ''}`}
      data-id={us.id}
    >
      <div className="us-item-row-left">
        {/*
          Drag handle — only rendered with `modify_us` (legacy
          `tg-check-permission="modify_us"`). It is the drag ACTIVATOR: the
          `@dnd-kit` listeners/attributes live here so grabbing the handle (not
          the whole row) starts the drag, keeping the checkbox + links usable.
        */}
        {canModify && (
          <div
            className="draggable-us-row"
            ref={setActivatorNodeRef}
            {...attributes}
            {...(listeners ?? {})}
          >
            {svgIcon('icon-draggable')}
          </div>
        )}
        {/* Selection checkbox — only rendered with `modify_us`. */}
        {canModify && (
          <div className="input">
            <div className="custom-checkbox">
              {/*
                Controlled checkbox. `onClick` captures the browser's post-toggle
                `checked` value AND the native `shiftKey` (for shift-range
                selection) and lifts them up; the no-op `onChange` keeps React's
                controlled-input contract satisfied. `id`/`for` are kept verbatim
                (`us-check-{ref}`) because the SCSS + e2e selectors depend on them.
              */}
              <input
                type="checkbox"
                name="filter-mode"
                id={`us-check-${us.ref}`}
                checked={isChecked}
                onClick={(e) =>
                  onToggleCheck(us, e.currentTarget.checked, e.nativeEvent.shiftKey)
                }
                onChange={() => {
                  /* controlled input: state is lifted via onClick */
                }}
              />
              <label htmlFor={`us-check-${us.ref}`} tabIndex={0} />
            </div>
          </div>
        )}
      </div>

      <div className="user-stories user-story-main-data">
        <a className="user-story-link" href={usHref}>
          {/* Ref number (mirrors `tg-bo-ref="us.ref"`). */}
          <span className="user-story-number">{`#${us.ref}`}</span>
          {/* Subject as PLAIN TEXT — original `| emojify`; no dangerouslySetInnerHTML. */}
          <span className="user-story-name">{us.subject}</span>
        </a>
        {/*
          Due date — simplified `tgDueDate` reproduction (render-only): preserves
          the `.due-date` / `.due-date-icon` SCSS hooks and shows the raw date as
          the tooltip. Rendered only when the story has a due date.
        */}
        {dueDate && (
          <span className="due-date" title={dueDate}>
            {svgIcon('icon-clock', 'due-date-icon')}
          </span>
        )}
        {/* Tag pills — only when `showTags`; the final tag also carries `last`. */}
        {showTags &&
          tags.map((tag, i) => (
            <span
              className={`tag${i === tags.length - 1 ? ' last' : ''}`}
              title={tag[0]}
              style={{ background: tag[1] ?? undefined }}
              key={i}
            >
              {tag[0]}
            </span>
          ))}
        {/*
          Epic pills — rendered directly here as `.belong-to-epic-pill` spans
          (guarded: no epics → nothing). Read via the index signature since
          `epics` is not on the trimmed `UserStory` type.
        */}
        {epics &&
          epics.map((epic) => (
            <span
              className="belong-to-epic-pill"
              key={epic.id}
              style={{ background: epic.color }}
              title={`#${epic.ref} ${epic.subject}`}
            />
          ))}
      </div>

      {/*
        Status cell (inline `tgUsStatus`). The anchor is coloured with the
        current status colour and shows its name; when `modify_us` is absent it
        is `not-clickable` and clicking only prevents navigation.
      */}
      <div className="status" ref={statusRef}>
        <a
          className={`us-status${canModify ? '' : ' not-clickable'}`}
          href="#"
          /* i18n: BACKLOG.STATUS_NAME */
          title="Status Name"
          style={{ color: currentStatus?.color }}
          onClick={
            canModify
              ? (e) => {
                  e.preventDefault();
                  setStatusOpen((o) => !o);
                }
              : (e) => e.preventDefault()
          }
        >
          <span className="us-status-bind">{currentStatus?.name}</span>
          {canModify && svgIcon('icon-arrow-down')}
        </a>
        {canModify && statusOpen && (
          <ul className="popover pop-status">
            {statuses.map((status) => (
              <li className="popover-status" key={status.id}>
                {/*
                  DEVIATION: the original `popover-us-status.jade` put
                  `id="js-status-btn"` on EVERY `a.status`; reproducing that would
                  create duplicate DOM ids across rows (invalid HTML). We OMIT the
                  id and keep `className="status"` + `data-status-id` +
                  `span.item-text`, which is what the SCSS actually targets.
                */}
                <a
                  className={`status${
                    currentStatus && currentStatus.id === status.id
                      ? ' active-popover'
                      : ''
                  }`}
                  href="#"
                  title={status.name}
                  data-status-id={status.id}
                  onClick={(e) => {
                    e.preventDefault();
                    setStatusOpen(false);
                    if (status.id !== us.status) {
                      onUpdateStatus(us, status.id);
                    }
                  }}
                >
                  <span className="item-text">{status.name}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Points cell (inline `tgBacklogUsPoints` display). Render-only: NO inline
        points-edit popover (the full `pop-role`/`pop-points` editing flow is out
        of scope per the AAP); the optional `onEditPoints` callback lets the
        container own editing later. `us.points` is `Record<string, number>` in
        the trimmed type (role id → numeric points), so we render the numeric
        value — the original resolved a point NAME via `pointsById`.
      */}
      <div className="points">
        <button
          type="button"
          className={`us-points${editable ? '' : ' not-clickable'}`}
          onClick={
            editable && onEditPoints
              ? () => onEditPoints(us, selectedRoleId)
              : undefined
          }
        >
          <span className="points-value">
            {selectedRoleId == null || computableRoles.length <= 1 ? (
              totalPoints
            ) : (
              <>
                {us.points?.[String(selectedRoleId)] ?? 0} /{' '}
                <span>{totalPoints}</span>
              </>
            )}
          </span>
        </button>
      </div>

      {/*
        Options cell — only with `modify_us` (legacy `.us-option`
        `tg-check-permission="modify_us"`). `UsEditSelector` renders the
        `.us-option` root + trigger + popover itself, so it is NOT wrapped in
        another `.us-option`. `isFirst` adds the `first` class to the trigger.
      */}
      {canModify && (
        <UsEditSelector
          us={us}
          project={project}
          isFirst={isFirst}
          onEdit={onEditUs}
          onDelete={onDeleteUs}
          onMoveToTop={onMoveUsToTop}
        />
      )}
    </div>
  );
};

/**
 * The backlog user-story table: the header row + the droppable body of
 * draggable rows.
 *
 * State ownership: `selectedRoleId` (the header points-column role filter) is
 * INTERNAL state owned here and shared between the header {@link
 * UsRolePointsSelector} and every {@link BacklogRow} (so a role pick instantly
 * reflows every row's points display) — the React equivalent of the legacy
 * `uspoints:select` broadcast being scoped to the backlog table. Each row owns
 * its own status-popover flag.
 *
 * Drag-and-drop: the `.backlog-table-body` registers as the `'backlog'`
 * droppable (a story dropped here → backlog reorder / removal from a sprint);
 * the rows register as draggables (see {@link BacklogRow}). The `DndContext`
 * itself is provided by an ancestor (`../dnd/BacklogDndContext`) at runtime.
 */
export const BacklogTable = ({
  userstories,
  statuses,
  project,
  showTags = false,
  activeFilters = false,
  displayVelocity = false,
  checkedIds = [],
  visibleUserStories,
  firstUsInBacklog,
  loading = false,
  getLinkParams,
  onLoadMore,
  onEditUs,
  onDeleteUs,
  onMoveUsToTop,
  onToggleCheck,
  onUpdateStatus,
  onEditPoints,
}: BacklogTableProps): JSX.Element => {
  // Whether the current user may modify user stories — computed once and passed
  // down to every row (drives the drag handle, checkbox, options and the
  // clickable status). Mirrors the legacy `tg-check-permission="modify_us"`.
  const canModify = can(project, 'modify_us');

  // Header role filter — INTERNAL state (NOT a prop). `null` = "All points".
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);

  // Visible-refs filter (legacy `inArray:visibleUserStories:'ref'`): keep only
  // rows whose `ref` is in `visibleUserStories`; `undefined` shows every row.
  const rows = visibleUserStories
    ? userstories.filter(
        (us) => us.ref != null && visibleUserStories.includes(us.ref),
      )
    : userstories;

  // First backlog US id → the `first` class on its options trigger. Defaults to
  // the first rendered story (mirrors `first_us_in_backlog`).
  const resolvedFirstUsId = firstUsInBacklog ?? userstories[0]?.id;

  // The `.backlog-table-body` is a `@dnd-kit` DROP TARGET (id `'backlog'`).
  const { setNodeRef: setBodyDropRef } = useDroppable({
    id: 'backlog',
    data: { type: 'backlog' },
  });

  // Optional infinite-scroll sentinel: when `onLoadMore` is supplied, observe a
  // trailing sentinel and call it as the sentinel scrolls into view (maps the
  // legacy `infinite-scroll="ctrl.loadUserstories()"`). Guarded so a jsdom /
  // SSR environment without `IntersectionObserver` never throws; omitted
  // entirely when no `onLoadMore` is provided (the component is fully
  // functional render-only without it).
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onLoadMore || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const node = sentinelRef.current;
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          onLoadMore();
        }
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onLoadMore]);

  return (
    <>
      {/* Header (`backlog-table.jade` `.backlog-table-header`). */}
      <div className="backlog-table-header">
        <div className="row backlog-table-title">
          {/* draggable-us-column + input columns exist only with `modify_us`. */}
          {canModify && <div className="draggable-us-column" />}
          {canModify && <div className="input" />}
          <div className="user-stories">
            {/* i18n: BACKLOG.TABLE.COLUMN_US */}User Story
          </div>
          <div className="status">
            {/* i18n: COMMON.FIELDS.STATUS */}Status
          </div>
          {/* i18n: BACKLOG.TABLE.TITLE_COLUMN_POINTS */}
          <div className="points" title="Select view per Role">
            {/*
              `UsRolePointsSelector` renders the `.inner` root itself (inner +
              header-points + icon-filter + popover), so it is mounted directly
              as the `.points` child — no separate `.inner` wrapper.
            */}
            <UsRolePointsSelector
              project={project}
              selectedRoleId={selectedRoleId}
              onSelectRole={setSelectedRoleId}
            />
          </div>
          <div className="us-header-options" />
        </div>
      </div>

      {/*
        Body (`backlog-table.jade` `.backlog-table-body`). Registers the drop
        ref and mirrors the legacy `ng-class` flags. Renders the filtered rows,
        then the optional loading placeholder and infinite-scroll sentinel.
      */}
      <div
        ref={setBodyDropRef}
        className={`backlog-table-body${showTags ? ' show-tags' : ''}${
          activeFilters ? ' active-filters' : ''
        }${displayVelocity ? ' forecasted-stories' : ''}`}
      >
        {rows.map((us) => (
          <BacklogRow
            key={us.ref ?? us.id}
            us={us}
            project={project}
            statuses={statuses}
            canModify={canModify}
            showTags={showTags}
            selectedRoleId={selectedRoleId}
            isChecked={checkedIds.includes(us.id)}
            isFirst={us.id === resolvedFirstUsId}
            getLinkParams={getLinkParams}
            onEditUs={onEditUs}
            onDeleteUs={onDeleteUs}
            onMoveUsToTop={onMoveUsToTop}
            onToggleCheck={onToggleCheck}
            onUpdateStatus={onUpdateStatus}
            onEditPoints={onEditPoints}
          />
        ))}
        {loading && <div className="loading" />}
        {onLoadMore && <div ref={sentinelRef} />}
      </div>
    </>
  );
};
