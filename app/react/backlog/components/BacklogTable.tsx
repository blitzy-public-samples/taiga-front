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

import { canMutate } from '../../shared/permissions';
// F-UI-02: the ONE shared SVG-sprite primitive (replaces this file's former
// local `svgIcon`/`tg-svg` declaration — icons used here: `icon-draggable`,
// `icon-clock`, `icon-arrow-down`). F-UI-06: the shared translation bridge for
// the column headers and status/points tooltips (`BACKLOG.TABLE.*`,
// `COMMON.FIELDS.*`, `BACKLOG.STATUS_NAME`). F-UI-07: the shared emoji renderer
// so `us.subject` reproduces the legacy `ng-bind-html="us.subject | emojify"`.
import { TgSvg } from '../../shared/icon';
import { translate } from '../../shared/i18n';
import { emojify } from '../../shared/emoji';

import type { UserStory, Status, Project, Tag } from '../../shared/types';

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
  /**
   * F-CQ-03 points-estimate change: the inline popover chose `pointId` for
   * `roleId`; the container PATCHes `us.points` + reloads stats. Absent → the
   * points cell renders read-only.
   */
  onUpdatePoints?: (us: UserStory, roleId: number, pointId: number) => void;
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
  onUpdatePoints?: (us: UserStory, roleId: number, pointId: number) => void;
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
 * A project estimation point option (`project.points`, `_.sortBy(…, "order")`,
 * `main.coffee:479`). `name` is the label shown in the estimate popover ("1",
 * "?", "∞", …); `value` is numeric (or `null` for the unestimated `?`).
 */
interface ProjectPoint {
  id: number;
  name: string;
  value?: number | null;
  order?: number;
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
  onUpdatePoints,
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

  // F-CQ-03 points-estimate popover state (reproduces `tgBacklogUsPoints` /
  // `renderRolesSelector` + `renderPointsSelector`). `pointsOpen` is the
  // popover flag; `pointsEditRole` is the role currently being estimated —
  // `null` means the role picker is still showing (multiple computable roles,
  // none pre-selected), matching the directive's two-step flow.
  const [pointsOpen, setPointsOpen] = useState(false);
  const [pointsEditRole, setPointsEditRole] = useState<number | null>(null);
  const pointsRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape closing for the points popover (same pattern as the
  // status popover; listeners exist only while it is open).
  useEffect(() => {
    if (!pointsOpen) {
      return;
    }

    const onDocumentMouseDown = (event: globalThis.MouseEvent) => {
      const root = pointsRef.current;
      if (root && !root.contains(event.target as Node)) {
        setPointsOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPointsOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pointsOpen]);

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

  // F-CQ-03 points-estimate popover data. Point OPTIONS come from
  // `project.points` (`_.sortBy(…, "order")`, main.coffee:479) — no estimation
  // service needed. When there is exactly one computable role it is
  // pre-resolved (the directive's single-role preselect); otherwise the popover
  // shows a role picker first.
  const projectPoints = (
    (project.points as ProjectPoint[] | undefined) ?? []
  )
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const singleRoleId = computableRoles.length === 1 ? computableRoles[0].id : null;
  // Role resolved for editing: the header filter selection, else the sole role.
  const resolvedEditRole = selectedRoleId ?? singleRoleId;

  const openPointsPopover = (): void => {
    setPointsEditRole(resolvedEditRole);
    setPointsOpen(true);
  };
  const choosePoint = (roleId: number, pointId: number): void => {
    setPointsOpen(false);
    onUpdatePoints?.(us, roleId, pointId);
  };

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
            <TgSvg icon="icon-draggable" />
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
                /*
                  F-UI-04: the legacy `<label for>` carried NO text, so the
                  bulk-select checkbox had no accessible name. Give it one via a
                  localised `aria-label` (forward-compatible key + descriptive
                  English fallback) referencing the story it selects.
                */
                aria-label={translate(
                  'BACKLOG.SELECT_US',
                  { ref: us.ref },
                  `Select user story #${us.ref}`,
                )}
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
          {/*
            F-UI-07: the original bound `us.subject | emojify` via ng-bind-html
            (`backlog-row.jade`). `emojify()` reproduces that filter — parsing
            `:shortcode:` tokens into `<img class="emoji">` React nodes — WITHOUT
            `dangerouslySetInnerHTML`: it emits safe React elements, so the story
            subject renders emoji exactly as the AngularJS screen did while
            remaining XSS-safe.
          */}
          <span className="user-story-name">{emojify(us.subject)}</span>
        </a>
        {/*
          Due date — simplified `tgDueDate` reproduction (render-only): preserves
          the `.due-date` / `.due-date-icon` SCSS hooks and shows the raw date as
          the tooltip. Rendered only when the story has a due date.
        */}
        {dueDate && (
          <span className="due-date" title={dueDate}>
            <TgSvg icon="icon-clock" className="due-date-icon" />
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
          /* F-UI-06: BACKLOG.STATUS_NAME. */
          title={translate('BACKLOG.STATUS_NAME', undefined, 'Status Name')}
          style={{ color: currentStatus?.color }}
          /*
            F-UI-04: when editable this anchor is a disclosure control — expose
            the popup relationship + open state to assistive tech (invisible; no
            visual change). The `<a href="#">` is already keyboard-focusable.
          */
          aria-haspopup={canModify ? 'menu' : undefined}
          aria-expanded={canModify ? statusOpen : undefined}
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
          {canModify && <TgSvg icon="icon-arrow-down" />}
        </a>
        {canModify && statusOpen && (
          <ul
            className="popover pop-status"
            role="menu"
            aria-label={translate('COMMON.FIELDS.STATUS', undefined, 'Status')}
          >
            {statuses.map((status) => (
              <li className="popover-status" key={status.id} role="none">
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
                  role="menuitem"
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
        F-CQ-03: the estimate is now EDITABLE. Clicking the cell (with
        `modify_us` + ≥1 computable role) opens the two-step popover — a role
        picker (`pop-role`) when >1 role and none pre-selected, then a
        point-value list (`pop-points`) from `project.points`. Picking a value
        calls `onUpdatePoints(us, roleId, pointId)`; the container PATCHes
        `us.points` + reloads stats. When not editable the cell stays
        `not-clickable` (display only). `us.points` is `Record<string, number>`
        (role id → point id); the display renders the numeric value.
      */}
      <div className="points" ref={pointsRef}>
        <button
          type="button"
          className={`us-points${editable ? '' : ' not-clickable'}`}
          onClick={editable ? openPointsPopover : undefined}
          aria-haspopup={editable ? 'menu' : undefined}
          aria-expanded={editable ? pointsOpen : undefined}
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
        {editable && pointsOpen && pointsEditRole == null && (
          /* Step 1 — role picker (renderRolesSelector): only when >1 computable
             role and none pre-selected via the header filter. */
          <ul
            className="popover pop-role"
            role="menu"
            aria-label={translate(
              'BACKLOG.TABLE.TITLE_COLUMN_POINTS',
              undefined,
              'Select view per Role',
            )}
          >
            {computableRoles.map((role) => (
              <li key={role.id} role="none">
                <a
                  className="role"
                  href="#"
                  role="menuitem"
                  title={role.name}
                  data-role-id={role.id}
                  onClick={(e) => {
                    e.preventDefault();
                    setPointsEditRole(role.id);
                  }}
                >
                  <span className="item-text">{role.name}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {editable && pointsOpen && pointsEditRole != null && (
          /* Step 2 — point-value list (renderPointsSelector) for the resolved
             role. */
          <ul
            className="popover pop-points"
            role="menu"
            aria-label={translate('COMMON.FIELDS.POINTS', undefined, 'Points')}
          >
            {projectPoints.map((point) => (
              <li key={point.id} role="none">
                <a
                  className={`point${
                    us.points?.[String(pointsEditRole)] === point.id
                      ? ' active-popover'
                      : ''
                  }`}
                  href="#"
                  role="menuitem"
                  title={point.name}
                  data-point-id={point.id}
                  onClick={(e) => {
                    e.preventDefault();
                    choosePoint(pointsEditRole, point.id);
                  }}
                >
                  <span className="item-text">{point.name}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
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
  onUpdatePoints,
}: BacklogTableProps): JSX.Element => {
  // Whether the current user may modify user stories — computed once and passed
  // down to every row (drives the drag handle, checkbox, options and the
  // clickable status). Mirrors the legacy `tg-check-permission="modify_us"`.
  // F-REG-03: story-editing affordance -> archive-aware mutation gate.
  const canModify = canMutate(project, 'modify_us');

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
            {/* F-UI-06: BACKLOG.TABLE.COLUMN_US */}
            {translate('BACKLOG.TABLE.COLUMN_US', undefined, 'User Story')}
          </div>
          <div className="status">
            {/* F-UI-06: COMMON.FIELDS.STATUS */}
            {translate('COMMON.FIELDS.STATUS', undefined, 'Status')}
          </div>
          {/* F-UI-06: BACKLOG.TABLE.TITLE_COLUMN_POINTS */}
          <div
            className="points"
            title={translate(
              'BACKLOG.TABLE.TITLE_COLUMN_POINTS',
              undefined,
              'Select view per Role',
            )}
          >
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
            onUpdatePoints={onUpdatePoints}
          />
        ))}
        {loading && <div className="loading" />}
        {onLoadMore && <div ref={sentinelRef} />}
      </div>
    </>
  );
};
