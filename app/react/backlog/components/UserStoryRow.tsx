/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * UserStoryRow — React port of the AngularJS backlog user-story row.
 *
 * Presentational (stateless) leaf that renders ONE `.row.us-item-row` of the
 * Backlog: the drag handle, the multi-select checkbox, the user-story link
 * (`#ref` + name), the due-date badge, the tag pills, the epic pills, the status
 * link, the points cell, and the options (⋮) button. It is rendered by
 * `BacklogTable.tsx` and it is a `@dnd-kit` SORTABLE ITEM using the drag-handle
 * pattern (only `.draggable-us-row` starts a drag; the whole `.row` moves).
 *
 * The component reproduces the EXACT DOM structure and CSS class names of the
 * original AngularJS markup so the existing compiled global SCSS renders it with
 * ZERO visual change (AAP 0.3.4). No stylesheet or asset is imported; every class
 * name below is byte-identical to the reference markup so the
 * backlog-table stylesheet (`.us-item-row`, `.us-item-row.gu-transit`,
 * `.us-item-row-left`, `.draggable-us-row`, `.custom-checkbox`,
 * `.user-story-main-data`, `.user-story-link`, `.user-story-number`,
 * `.user-story-name`, `.tag`, `.belong-to-epic-pill`, `.us-status`,
 * `.us-status-bind`, `.points`, `.us-option`, `.us-option-popup-button`) styles
 * the React output unchanged.
 *
 * Behavioral & markup sources (REFERENCE ONLY — never imported):
 *  - backlog-row.jade:8-74 — the EXACT DOM reproduced here, verbatim class names.
 *  - backlog/sortable.coffee — the drag semantics: the legacy sortable's `moves`
 *    predicate accepts only elements with the `row` class, so the whole row is the
 *    draggable item, while the `.draggable-us-row` grip (the `icon-draggable`
 *    handle) is what the user grabs. `useSortableRow` supplies `setNodeRef`/`style`
 *    for the row node and `attributes`/`listeners` for that handle; its `className`
 *    carries `gu-transit` while the row is being dragged, reproducing the
 *    placeholder class the legacy drag library applied so the existing
 *    `.us-item-row.gu-transit` styling applies.
 *  - backlog/main.coffee — `ctrl.showTags` toggles the `.tag` pills (main.coffee:238);
 *    `first_us_in_backlog = userstories[0].id` (main.coffee:509) marks the first
 *    row's options button with the `first` class; `updateUserStoryStatus`
 *    (main.coffee:646) is the status-change callback, threaded here via
 *    `onStatusClick`.
 *
 * INLINE CONTROLS (finding #12) — the row hosts three self-contained AngularJS
 * directives whose behavior is now FULLY reproduced here so the controls are
 * functional (the QA gate required they not be inert no-ops):
 *   - `tgUsStatus` (status dropdown, `common/popovers.coffee:19-92`): clicking
 *     `.us-status` opens the `pop-status` popover; selecting an option calls
 *     `onChangeStatus(us, statusId)` which PATCHes the status upstream.
 *   - `tgBacklogUsPoints` (per-role points editor, `main.coffee:1057-1160` +
 *     `estimation.coffee`): clicking `.us-points` opens the role picker
 *     (`pop-role`) then the point picker (`pop-points-open`); selecting a point
 *     calls `onChangePoints(us, roleId, pointId)`. The displayed total is
 *     computed live from `us.points` via the shared estimation helpers, honoring
 *     the header "view per role" selection.
 *   - `tgUsEditSelector` (⋮ options menu, `main.coffee:966-989` +
 *     `us-edit-popover.jade`): clicking the `.us-option-popup-button` opens the
 *     Edit / Delete / Move-to-top menu, routing to `onEditStory` / `onDeleteStory`
 *     / `onMoveToTop`.
 * `tg-due-date` remains an INERT structural host (there is no editing affordance
 * for it in the backlog row). Every popover reproduces the exact template class
 * names so the existing compiled SCSS renders them with zero visual change; the
 * `display:'block'` inline style overrides the `.popover` mixin's default
 * `display:none` exactly as the jQuery popover plugin did on `.open()`. All
 * PATCH/DELETE side effects are owned upstream (the hook), keeping the row's only
 * effect its local open/close popover state.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration of the Backlog
 * screen (AAP Section 0). Uses the automatic JSX runtime (`jsx: "react-jsx"`), so
 * React is intentionally NOT imported as a value; event parameter types are
 * inferred from the JSX attribute signatures. `useSortableRow` is the only hook
 * this component calls.
 */

// `useState` drives the row's inline popover open/close state (finding #12: the
// status dropdown, per-role points editor, and ⋮ options menu are now
// FUNCTIONAL, reproducing the AngularJS `tgUsStatus` / `tgBacklogUsPoints` /
// `tgUsEditSelector` directives that each appended their popover into the row).
import { useMemo, useState } from 'react';
// `UserStory` is a TYPE-only import — required by `isolatedModules: true`.
import type { UserStory } from '../state/backlogReducer';
// Runtime values (a hook and a constant object) -> normal imports.
import { useSortableRow } from '../../shared/dnd/sortable';
import { DND_CLASS } from '../../shared/dnd/types';
// Pure estimation helpers reproducing `$tgEstimationsService`
// (`estimation.coffee`): the per-role points math the points widget displays.
import {
  buildPointsById,
  calculateTotalPoints,
  calculateRoles,
  type EstimationPoint,
  type EstimationRole,
} from '../../shared/estimation';

/**
 * A user-story status option for the inline status dropdown. Mirrors the fields
 * the `popover-us-status` template read from `project.us_statuses`
 * (`{ id, name, color }`, `popover-us-status.jade:10-16`).
 */
export interface RowStatusOption {
  id: number;
  name: string;
  color?: string;
}

/**
 * Module-local references to the AngularJS custom-element host tags.
 *
 * React owns the entire subtree inside `<tg-react-backlog>`, so it renders the
 * SVG sprite `<svg><use>` itself (mirroring the compiled output of the `tgSvg`
 * directive) rather than relying on AngularJS to compile `<tg-svg>`. `<tg-due-date>`
 * is likewise emitted as an INERT custom-element host that carries only the
 * `.due-date` class for structural/style parity (see the SCOPE NOTE above).
 *
 * The `as unknown as any` cast lets these custom-element tags be used in JSX
 * WITHOUT a cross-file `declare global { namespace JSX }` augmentation, which
 * would conflict with the sibling React files that use this same established
 * pattern (see SprintHeader.tsx).
 */
const TgSvg = 'tg-svg' as unknown as any;
const TgDueDate = 'tg-due-date' as unknown as any;

/**
 * Renders a Taiga sprite icon, mirroring the rendered output of the AngularJS
 * `tgSvg` directive. React maps `className` -> `class`; `xlinkHref` renders the
 * SVG 1.1 `xlink:href` attribute while the extra `href` covers SVG 2 / Firefox
 * (the Playwright engine used for the migration's visual evidence).
 */
function Svg({ icon, className }: { icon: string; className?: string }) {
  return (
    <TgSvg svg-icon={icon} className={className}>
      <svg className={`icon ${icon}`}>
        <use xlinkHref={`#${icon}`} {...({ href: `#${icon}` } as any)} />
      </svg>
    </TgSvg>
  );
}

/**
 * Props for {@link UserStoryRow}. These mirror the per-row data the AngularJS
 * `backlog-row.jade` template read from its `us` scope plus the controller
 * flags (`ctrl.showTags`, `first_us_in_backlog`, the `modify_us` permission),
 * with every interaction expressed as an inline-typed callback (no
 * `BacklogActions` import — the parent owns the handlers).
 */
export interface UserStoryRowProps {
  /** The user story (id + ref required; other fields read via index signature, coerced safely). */
  us: UserStory;
  /** `ctrl.showTags` — render the `.tag` pills. */
  showTags: boolean;
  /** True when `us.id` is in the multi-selection -> row gets `ui-multisortable-multiple` + `is-checked`, checkbox checked. */
  selected: boolean;
  /** `project.my_permissions` includes `modify_us` — gates the drag handle, checkbox, status arrow, and options button; otherwise the row gets `readonly`. */
  canModify: boolean;
  /** `us.id === first_us_in_backlog` — adds the `first` class to the options button. */
  isFirstInBacklog: boolean;
  /** Resolved US-detail href (route `project-userstories-detail`: `/project/{pslug}/us/{ref}`). */
  detailUrl: string;
  /** Resolved status display name (from `project.us_statuses[us.status]`). */
  statusName: string;
  /** Resolved status color (applied as an inline style to `.us-status`), optional. */
  statusColor?: string;
  /**
   * Display label for `div.points` — the FALLBACK shown when the estimation
   * inputs (`points`/`roles`) are not supplied (e.g. in unit tests). When they
   * ARE supplied, the label is computed live from `us.points` via the estimation
   * helpers so it reflects the per-role "view" selection (finding #12). Optional.
   */
  pointsLabel?: string;
  /** Checkbox click -> `(usId, shiftKey)`. `BacklogTable` owns the shift-range computation. */
  onToggleSelect: (usId: number, shiftKey: boolean) => void;
  /**
   * Click the status link -> also fires this "status widget activated" signal
   * (kept for parity/telemetry; the dropdown itself opens inline). Optional.
   */
  onStatusClick?: (usId: number) => void;
  /**
   * Click the options (⋮) button -> also fires this signal; the options popover
   * opens inline. Optional.
   */
  onOptionsClick?: (usId: number) => void;

  /* ------------------- inline controls (finding #12) ------------------- */
  /**
   * All project user-story statuses for the inline status dropdown
   * (`project.us_statuses`). When present AND `canModify`, clicking `.us-status`
   * opens the `pop-status` popover; selecting an option calls `onChangeStatus`.
   * Absent -> the status link is display-only (legacy read-only parity).
   */
  statuses?: RowStatusOption[];
  /** Project estimation points (`project.points`) for the inline points editor. */
  points?: EstimationPoint[];
  /** Project roles (`project.roles`); only `computable` ones participate in points. */
  roles?: EstimationRole[];
  /**
   * "View points per Role" header selection (`null` = totals). When a role is
   * selected AND there is more than one computable role, the points cell shows
   * `"{rolePointName} / {total}"` (legacy `estimation` render, main.coffee:1104).
   */
  pointsViewRoleId?: number | null;
  /** `delete_us` permission — gates the ⋮ menu "Delete" item. */
  canDelete?: boolean;
  /** Select a status from the dropdown -> PATCH status (owned upstream). */
  onChangeStatus?: (us: UserStory, statusId: number) => void;
  /** Select a per-role point -> PATCH points (owned upstream). */
  onChangePoints?: (us: UserStory, roleId: number, pointId: number) => void;
  /** ⋮ "Edit" -> open/navigate to the story editor (owned upstream). */
  onEditStory?: (us: UserStory) => void;
  /** ⋮ "Delete" -> confirm + delete (owned upstream; confirm lives in BacklogApp). */
  onDeleteStory?: (us: UserStory) => void;
  /** ⋮ "Move to top" -> bulk backlog-order move (owned upstream). */
  onMoveToTop?: (us: UserStory) => void;
}

/**
 * One Backlog user-story row. See the module doc comment for the full source
 * mapping (backlog-row.jade:8-74 + backlog/sortable.coffee + backlog/main.coffee)
 * and the SCOPE NOTE for the status/points/due-date sub-widgets.
 */
export function UserStoryRow(props: UserStoryRowProps) {
  const {
    us,
    showTags,
    selected,
    canModify,
    isFirstInBacklog,
    detailUrl,
    statusName,
    statusColor,
    pointsLabel,
    onToggleSelect,
    onStatusClick,
    onOptionsClick,
    statuses,
    points,
    roles,
    pointsViewRoleId = null,
    canDelete = false,
    onChangeStatus,
    onChangePoints,
    onEditStory,
    onDeleteStory,
    onMoveToTop,
  } = props;

  // Which inline popover (if any) is open. Only ONE opens at a time, matching the
  // legacy single-popover behavior. `points-roles` is the intermediate role
  // picker; `points` is the point picker for `pointsRoleId`.
  const [openPopover, setOpenPopover] = useState<
    'status' | 'options' | 'points-roles' | 'points' | null
  >(null);
  // The role currently being estimated in the `points` popover.
  const [pointsRoleId, setPointsRoleId] = useState<number | null>(null);

  const closePopover = () => {
    setOpenPopover(null);
    setPointsRoleId(null);
  };

  // pointId -> point lookup (reproduces groupBy(project.points, id)).
  const pointsById = useMemo(
    () => (points ? buildPointsById(points) : {}),
    [points],
  );
  // Computable roles annotated with their selected point name (calculateRoles).
  const usPoints = (us as Record<string, unknown>).points as
    | Record<string, number | null | undefined>
    | undefined;
  const computableRoles = useMemo(
    () => (roles ? calculateRoles(roles, usPoints, pointsById) : []),
    [roles, usPoints, pointsById],
  );
  // Whether the points editor is usable: needs points, at least one computable
  // role, AND modify permission (estimation.coffee:144 isEditable + :182 roles).
  const pointsEditable = Boolean(points && canModify && computableRoles.length > 0);

  // @dnd-kit sortable wiring. The row itself is the draggable node (setNodeRef +
  // style); the `.draggable-us-row` grip below receives attributes + listeners
  // (drag-handle pattern, matching the legacy sortable's `moves` restriction in
  // backlog/sortable.coffee). `data` carries the moved id for the drag-end
  // handler (event.active.data.current.usId).
  const sortable = useSortableRow(us.id, { usId: us.id });

  // Field coercion: `UserStory` types only `id`, `ref`, `new`, and `tags`
  // explicitly; everything else arrives through the reducer's
  // `[key: string]: unknown` index signature, so these reads MUST be coerced to
  // the concrete shape the markup needs (a bare `us.is_blocked` would be typed
  // `unknown` and fail strict compilation / could render `"undefined"`).
  const isBlocked = Boolean((us as Record<string, unknown>).is_blocked);
  const isNew = Boolean(us.new);
  const subject = String((us as Record<string, unknown>).subject ?? '');
  const dueDate = (us as Record<string, unknown>).due_date;
  const epics =
    ((us as Record<string, unknown>).epics as
      | Array<{ ref: number | string; subject: string; color?: string }>
      | undefined) ?? [];
  const tags = us.tags ?? [];

  // Row class list. `blocked`/`new` reproduce `ng-class="{blocked: us.is_blocked,
  // new: us.new}"`; `readonly` reproduces `tg-class-permission="{'readonly':
  // '!modify_us'}"`; the multi-select pair `ui-multisortable-multiple` +
  // `is-checked` marks a selected row (DND_CLASS.selected is the class
  // window.dragMultiple reads); the hook's `className` appends `gu-transit`
  // while the row is being dragged so the existing placeholder SCSS applies.
  const rowClasses = ['row', 'us-item-row'];
  if (isBlocked) rowClasses.push('blocked');
  if (isNew) rowClasses.push('new');
  if (!canModify) rowClasses.push('readonly');
  if (selected) rowClasses.push(DND_CLASS.selected, 'is-checked');
  if (sortable.className) rowClasses.push(sortable.className);

  // Points display value. When estimation inputs are provided, compute live from
  // `us.points` (reproduces the estimation `render`, main.coffee:1101-1108):
  // with a selected role AND >1 computable role show "{rolePointName} / {total}",
  // else just the total. Otherwise fall back to the `pointsLabel` prop.
  const totalPoints =
    points ? calculateTotalPoints(usPoints, pointsById) : undefined;
  let pointsDisplay: string;
  if (points) {
    if (
      pointsViewRoleId != null &&
      computableRoles.length > 1 &&
      usPoints &&
      usPoints[pointsViewRoleId] != null
    ) {
      const pid = usPoints[pointsViewRoleId] as number;
      const name = pointsById[pid]?.name ?? '?';
      pointsDisplay = `${name} / ${String(totalPoints)}`;
    } else {
      pointsDisplay = String(totalPoints);
    }
  } else {
    pointsDisplay = pointsLabel ?? '';
  }

  // --- inline control handlers (finding #12) ---

  // Status link: fire the legacy "activated" signal, then (when editable) toggle
  // the status dropdown. Reproduces `$el.on "click", ".us-status"` open
  // (common/popovers.coffee:46-49).
  const handleStatusClick = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    onStatusClick?.(us.id);
    if (canModify && statuses && statuses.length > 0) {
      setOpenPopover((cur) => (cur === 'status' ? null : 'status'));
    }
  };

  // Pick a status: PATCH via the upstream handler, then close (the widget's
  // debounced save + close, common/popovers.coffee:51-67).
  const handleSelectStatus = (statusId: number) => {
    closePopover();
    onChangeStatus?.(us, statusId);
  };

  // Options (⋮): fire the signal, then toggle the options popover
  // (tgUsEditSelector open, main.coffee:975-982).
  const handleOptionsClick = () => {
    onOptionsClick?.(us.id);
    setOpenPopover((cur) => (cur === 'options' ? null : 'options'));
  };

  // Points cell: open the role picker, or (single role / preselected header
  // role) jump straight to the point picker (estimation bindClickElements +
  // main.coffee:1135-1141).
  const handlePointsClick = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pointsEditable) {
      return;
    }
    // Preselect: the header "view per role" role, else the single computable role.
    const preselected =
      pointsViewRoleId != null
        ? pointsViewRoleId
        : computableRoles.length === 1
          ? computableRoles[0].id
          : null;
    if (preselected != null) {
      setPointsRoleId(preselected);
      setOpenPopover('points');
    } else {
      setOpenPopover('points-roles');
    }
  };

  // Pick a role in the role popover -> show that role's point picker.
  const handleSelectRole = (roleId: number) => {
    setPointsRoleId(roleId);
    setOpenPopover('points');
  };

  // Pick a point -> PATCH via the upstream handler, then close.
  const handleSelectPoint = (roleId: number, pointId: number) => {
    closePopover();
    onChangePoints?.(us, roleId, pointId);
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={sortable.style}
      className={rowClasses.join(' ')}
      data-id={us.id}
    >
      <div className="us-item-row-left">
        {/* Drag handle (grip) — only rendered with `modify_us`; carries the
            @dnd-kit attributes/listeners so the drag starts from the grip while
            the whole `.row` is the moved node (backlog/sortable.coffee). */}
        {canModify && (
          <div className="draggable-us-row" {...sortable.attributes} {...sortable.listeners}>
            <Svg icon="icon-draggable" />
          </div>
        )}
        {/* Multi-select checkbox — controlled by `selected`. The toggle is
            handled in `onClick` (not `onChange`) so the shift-key state can be
            read; `onChange` is a noop purely to keep the input controlled and
            silence React's uncontrolled-input warning. */}
        {canModify && (
          <div className="input">
            <div className="custom-checkbox">
              <input
                type="checkbox"
                name="filter-mode"
                id={`us-check-${String(us.ref)}`}
                checked={selected}
                onChange={() => undefined}
                onClick={(e) => onToggleSelect(us.id, e.shiftKey)}
              />
              <label htmlFor={`us-check-${String(us.ref)}`} tabIndex={0} />
            </div>
          </div>
        )}
      </div>

      <div className="user-stories user-story-main-data">
        {/* US-detail link — `href` is the pre-resolved route URL (detailUrl). The
            number renders as a literal `#` + ref; the name is the plain subject
            (the AngularJS `| emojify` transform is a text-content concern outside
            this presentational leaf's three-import boundary). */}
        <a className="user-story-link" href={detailUrl}>
          <span className="user-story-number">{`#${String(us.ref)}`}</span>
          <span className="user-story-name">{subject}</span>
        </a>
        {/* Due-date badge — INERT `<tg-due-date>` host with the `.due-date` class
            for structural/style parity (see SCOPE NOTE). Rendered only when the
            story has a due date (the AngularJS `ng-if="us.due_date"`).
            NOTE: the class is passed as `class` (NOT `className`) inside the spread.
            React does not apply its `className` -> `class` mapping to a custom
            element whose type is a string tag (`tg-due-date`); `className` would
            emit a bogus `classname` attribute and the existing `.due-date` SCSS
            would never match, breaking the zero-visual-change guarantee. Passing
            `class` directly makes React set the real `class="due-date"` attribute. */}
        {Boolean(dueDate) && (
          <TgDueDate
            {...({ class: 'due-date', 'due-date': String(dueDate), 'obj-type': 'us' } as any)}
          />
        )}
        {/* Tag pills — gated by `showTags`. `ng-class="{'last':$last}"` -> the
            final tag additionally gets the `last` class; `tag[0]` is the label,
            `tag[1]` is the (nullable) background color. */}
        {showTags &&
          tags.map((tag, i) => (
            <div
              key={`${tag[0]}-${i}`}
              className={i === tags.length - 1 ? 'tag last' : 'tag'}
              title={tag[0]}
              style={tag[1] ? { background: tag[1] } : undefined}
            >
              {tag[0]}
            </div>
          ))}
        {/* Epic pills — one per epic. Title reproduces the Jade
            `#{hash}{{epic.ref}} {{epic.subject}}` (a literal `#`, the ref, a
            space, then the subject). The pill has no text content; its color is
            the epic color. */}
        {epics.map((epic, i) => (
          <div
            key={`epic-${i}`}
            className="belong-to-epic-pill"
            title={`#${String(epic.ref)} ${epic.subject}`}
            style={epic.color ? { background: epic.color } : undefined}
          />
        ))}
      </div>

      {/* Status container (SCOPE NOTE: outer structure only). The `.us-status-bind`
          span holds the resolved status name; the arrow-down icon is gated by
          `modify_us`. The click is threaded to `onStatusClick` (the React
          equivalent of the `tg-us-status` `on-update` -> `updateUserStoryStatus`
          wiring); the popover/dropdown itself lives upstream. `title` mirrors the
          AngularJS `{{'BACKLOG.STATUS_NAME' | translate}}` binding. */}
      <div className="status">
        <a
          className="us-status"
          href=""
          title="Status"
          style={statusColor ? { color: statusColor } : undefined}
          onClick={handleStatusClick}
        >
          <span className="us-status-bind">{statusName}</span>
          {canModify && <Svg icon="icon-arrow-down" />}
        </a>
        {/* Status dropdown (`popover-us-status.jade`): rendered inline only when
            open. `display:'block'` overrides the `.popover` mixin's default
            `display:none` (the jQuery popover plugin did the same on `.open()`).
            Each option carries `active-popover` when it is the current status,
            byte-identical to the template's `data-status-id` + `.item-text`. */}
        {openPopover === 'status' && statuses && (
          <ul className="popover pop-status" style={{ display: 'block' }}>
            {statuses.map((s) => (
              <li className="popover-status" key={s.id}>
                <a
                  id="js-status-btn"
                  className={us.status === s.id ? 'status active-popover' : 'status'}
                  href=""
                  title={s.name}
                  data-status-id={s.id}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSelectStatus(s.id);
                  }}
                >
                  <span className="item-text">{s.name}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Points cell (`div.points(tg-backlog-us-points="us")`, finding #12).
          Now FUNCTIONAL: when the estimation inputs are supplied and the user can
          modify, the total is a clickable `.us-points` button that opens the
          per-role points editor (reproducing `UsPointsDirective` +
          `$tgEstimationsService`, main.coffee:1057-1160 / estimation.coffee).
          The `.points-value` span + `.us-points`/`not-clickable` classes match
          `us-estimation-total.jade`. When estimation inputs are absent (unit
          tests / read-only), it degrades to the plain display value. */}
      <div className="points">
        {points ? (
          <button
            type="button"
            className={pointsEditable ? 'us-points' : 'us-points not-clickable'}
            onClick={handlePointsClick}
          >
            <span className="points-value">{pointsDisplay}</span>
          </button>
        ) : (
          pointsDisplay
        )}

        {/* Role picker (`us-points-roles-popover.jade` -> `.pop-role`): shown when
            more than one computable role and none preselected. Each role shows
            "name (points)" and drills into the point picker. */}
        {openPopover === 'points-roles' && (
          <ul className="popover pop-role" style={{ display: 'block' }}>
            {computableRoles.map((role) => (
              <li key={role.id}>
                <a
                  className="role"
                  href=""
                  title={role.name}
                  data-role-id={role.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectRole(role.id);
                  }}
                >
                  <span className="item-text">
                    {role.name} ({role.points})
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}

        {/* Point picker (`us-estimation-points.jade` -> `.pop-points-open`):
            lists every project point; the currently-selected one omits the
            `active` class (matching the template's `point.selected` inversion).
            Selecting a point calls `onChangePoints(us, roleId, pointId)`. */}
        {openPopover === 'points' && pointsRoleId != null && points && (
          <ul className="popover pop-points-open" style={{ display: 'block' }}>
            {points.map((p) => {
              const isSelected = usPoints ? usPoints[pointsRoleId] === p.id : false;
              return (
                <li key={p.id}>
                  <a
                    className={isSelected ? 'point' : 'point active'}
                    href=""
                    title={p.name}
                    data-point-id={p.id}
                    data-role-id={pointsRoleId}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelectPoint(pointsRoleId, p.id);
                    }}
                  >
                    <span className="item-text">{p.name}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Options (⋮) button — gated by `modify_us`. Reproduces
          `ng-class="{first: us.id === first_us_in_backlog}"`: the first backlog
          row's button additionally gets the `first` class. Click is threaded to
          `onOptionsClick` (the US options popover lives upstream). */}
      {canModify && (
        <div className="us-option">
          <button
            type="button"
            className={
              isFirstInBacklog
                ? 'us-option-popup-button js-popup-button first popover-open'
                : 'us-option-popup-button js-popup-button'
            }
            onClick={handleOptionsClick}
          >
            <Svg icon="icon-more-vertical" />
          </button>
          {/* Options popover (`us-edit-popover.jade`): Edit / Delete / Move-to-top.
              Byte-identical `ul.popover.us-option-popup` + `li > button` classes
              (`e2e-edit edit-story`, `e2e-delete`, `e2e-edit move-to-top`), each
              gated by permission exactly as the AngularJS `tg-check-permission`
              did (Edit/Move need `modify_us` -> `canModify`; Delete needs
              `delete_us` -> `canDelete`). Selecting an item routes to the upstream
              handler. */}
          {openPopover === 'options' && (
            <ul
              className={isFirstInBacklog ? 'popover us-option-popup first' : 'popover us-option-popup'}
              style={{ display: 'block' }}
            >
              <li>
                <button
                  type="button"
                  className="e2e-edit edit-story"
                  onClick={() => {
                    closePopover();
                    onEditStory?.(us);
                  }}
                >
                  <Svg icon="icon-edit" />
                  <span>Edit</span>
                </button>
              </li>
              {canDelete && (
                <li>
                  <button
                    type="button"
                    className="e2e-delete"
                    onClick={() => {
                      closePopover();
                      onDeleteStory?.(us);
                    }}
                  >
                    <Svg icon="icon-trash" />
                    <span>Delete</span>
                  </button>
                </li>
              )}
              <li>
                <button
                  type="button"
                  className="e2e-edit move-to-top"
                  onClick={() => {
                    closePopover();
                    onMoveToTop?.(us);
                  }}
                >
                  <Svg icon="icon-move-to-top" />
                  <span>Move to top</span>
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
