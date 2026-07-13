
/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BacklogRow.tsx
 * --------------
 * React 18.2 + TypeScript reproduction of ONE Backlog user-story row.
 *
 * This is a presentational, DOM-preserving leaf component consumed by
 * `./Backlog.tsx`. It emits the exact element tree, class names and `data-*`
 * attributes that the AngularJS `BacklogController` produced through
 * `app/partials/includes/components/backlog-row.jade`, so the migrated React
 * screen is styled pixel-identically by the UNCHANGED Taiga SCSS
 * (`app/styles/modules/backlog/backlog-table.scss`) without editing any
 * stylesheet. No behavior, endpoint, styling or authorization change is
 * introduced (AAP §0.7.1 — DOM/visual parity + honor backend authorization).
 *
 * The row reproduces every legacy affordance:
 *   - the drag handle (`.draggable-us-row`, `@dnd-kit` activator),
 *   - the multiselect checkbox (`.custom-checkbox > input#us-check-<ref>`) with
 *     shift-range selection (shift+click selects the contiguous range from the
 *     last-clicked anchor, matching the legacy backlog multiselect),
 *   - the user-story link (`#<ref>` + escaped subject), due-date, tags and
 *     epic pills,
 *   - the inline STATUS editor (`tg-us-status` -> `.us-status` + `.pop-status`
 *     popover), from `app/coffee/modules/common/popovers.coffee` UsStatusDirective,
 *   - the inline POINTS editor (`tg-backlog-us-points` -> `.us-points` +
 *     `.pop-role` / `.pop-points-open` two-step popover), reproducing the
 *     `UsPointsDirective` / `EstimationProcess` of
 *     `app/coffee/modules/backlog/main.coffee` + `common/estimation.coffee`,
 *   - the row OPTIONS popup (`tg-us-edit-selector` -> `.us-option-popup` with
 *     edit / delete / move-to-top), from `app/partials/backlog/us-edit-popover.jade`.
 *
 * Popover behavior (the M4 root-cause fix): all three inline popovers use the
 * shared {@link usePopover} hook, which enforces a GLOBAL single-active
 * invariant (opening any popover — in THIS row or any OTHER row — closes the
 * previously open one), closes on outside pointer-down and on Escape (restoring
 * focus to the trigger), and moves focus to the first actionable item on open.
 * This replaces the previous row-local `useState` flags that only guaranteed a
 * single active popover WITHIN a row and had no dismissal/focus semantics.
 *
 * Points display (the second M4 fix): the points value is computed with the
 * legacy estimation rules ({@link calculateTotalPoints}) so an UNESTIMATED
 * story (`us.points` empty, or every role's point value null) renders the
 * literal `"?"` — never `0`. When a header role is selected (the `displayRoleId`
 * prop broadcast by the `.backlog-table-header` role selector) and the project
 * has more than one computable role, the value renders in the legacy
 * `"{point name} / <span>{total}</span>"` split form; otherwise it renders the
 * bare total. The per-role popover entries render `"{role name} ({points})"`
 * exactly as `common/estimation/us-points-roles-popover.jade` did.
 *
 * @dnd-kit interop: `./Backlog.tsx` makes each row a sortable item and passes
 * the sortable wiring down via the optional {@link BacklogRowDnd} `dnd` prop.
 * The `setNodeRef` is applied to THIS row root (there is NO intermediate wrapper
 * `div`), and the `setActivatorNodeRef` + drag `attributes`/`listeners` are
 * applied to the drag handle — matching the legacy dragula "drag from the
 * handle" semantics of `app/coffee/modules/backlog/sortable.coffee`.
 *
 * Migration notes (technology-specific changes vs. the AngularJS original):
 *   - Jade template -> JSX; CoffeeScript directive DOM manipulation -> declarative
 *     React state + conditional rendering.
 *   - AngularJS `ng-if`/`ng-class`/`ng-click`/`ng-model`/`tg-check-permission`
 *     -> React conditional rendering, computed `className`, `onClick`, controlled
 *     inputs and permission-gated rendering (`modify_us` / `delete_us`).
 *   - The legacy `ng-bind-html="us.subject | emojify"` becomes a plain, ESCAPED
 *     React text node (no `dangerouslySetInnerHTML`) preserving XSS-safety
 *     (AAP §0.6.4).
 *   - Visible action text is resolved at render time through the i18n helper
 *     `t(...)` against the compiled `app/locales/taiga/locale-en.json` bundle so
 *     the rendered output matches the AngularJS `translate` output exactly.
 *
 * The literal `ng-repeat="us in userstories"` attribute on the row root is a
 * STATIC string (NOT AngularJS behavior) required by the ported e2e selector
 * `.backlog-table-body > div[ng-repeat]`; React passes dashed attributes through
 * verbatim.
 */

// jsx automatic runtime => NO `import React`. The type-only namespace import
// provides the `React.*` types used by the `declare global` JSX augmentation.
import type * as React from "react";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { UserStory, Project, Status, Tag } from "../shared/types";
import { userStoryUrl } from "../shared/nav/routes";
import { t } from "../shared/i18n/translate";
import { usePopover } from "../shared/popover/usePopover";
import {
  UNESTIMATED,
  buildPointsById,
  calculateTotalPoints,
  computableRoles as computeComputableRoles,
  roleDisplayPoints,
} from "../shared/estimation/points";

/**
 * Custom-element JSX typing. The AngularJS `tg-svg` custom element that this
 * component emits (to reproduce the `tg-svg` directive DOM the SCSS targets) is
 * unknown to React's intrinsic element table, so we augment the global
 * `JSX.IntrinsicElements` interface. The right-hand side is kept byte-identical
 * to the sibling React screen files so the `declare global` blocks merge cleanly
 * across the esbuild bundle.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "tg-svg": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> &
        Record<string, unknown>;
    }
  }
}

/**
 * Module-local reproduction of the AngularJS `tg-svg` directive output
 * (`app/coffee/modules/common.coffee` — the directive has NO `replace`, so the
 * rendered DOM is `<tg-svg><svg class="icon <name>"><use xlink:href="#<name>"/>
 * </svg></tg-svg>`). Wrapping in `<tg-svg>` is REQUIRED for visual parity: the
 * unchanged `backlog-table.scss` sizes and fills these icons via descendant
 * selectors such as `.draggable-us-row tg-svg svg` and `.us-status tg-svg`.
 *
 * @param props.name     Icon id (e.g. `"icon-draggable"`) — used for both the
 *                       `icon <name>` class and the `#<name>` sprite reference.
 * @param props.svgClass Optional extra class placed on the `<svg>` (e.g. the
 *                       `icon-drag` e2e hook on the drag handle).
 */
function Icon(props: { name: string; svgClass?: string }): JSX.Element {
  const { name, svgClass } = props;
  const svgClassName = "icon " + name + (svgClass ? " " + svgClass : "");
  return (
    <tg-svg>
      <svg className={svgClassName}>
        <use xlinkHref={"#" + name} />
      </svg>
    </tg-svg>
  );
}

/**
 * `@dnd-kit` sortable wiring passed down from `./Backlog.tsx`. Every member is
 * optional so the row also renders standalone (e.g. in unit tests) with no drag
 * behavior. Applied EXACTLY as documented per member:
 *   - `setNodeRef` -> the ROW ROOT (`.row.us-item-row`); there is NO intermediate
 *     wrapper node, so the sortable node IS the styled row.
 *   - `setActivatorNodeRef` + `attributes` + `listeners` -> the drag handle
 *     (`.draggable-us-row`), so dragging only starts from the handle.
 *   - `style` -> the row root (dnd transform/transition).
 *   - `isDragging` -> toggles the `dragging` modifier class on the row root.
 */
export interface BacklogRowDnd {
  /** Applied to the ROW ROOT (`.row.us-item-row`) — no intermediate wrapper div. */
  setNodeRef?: (el: HTMLElement | null) => void;
  /** Applied to the drag handle (`.draggable-us-row`). */
  setActivatorNodeRef?: (el: HTMLElement | null) => void;
  /** Inline style (dnd transform/transition) applied to the row root. */
  style?: CSSProperties;
  /** Whether this row is the one currently being dragged. */
  isDragging?: boolean;
  /** ARIA/dnd attributes spread on the drag handle. */
  attributes?: Record<string, unknown>;
  /** Pointer/keyboard listeners spread on the drag handle. */
  listeners?: Record<string, unknown>;
}

/**
 * Props contract for {@link BacklogRow}. The component is fully controlled: it
 * owns no cross-row state and mirrors the bindings the legacy directives used.
 * The only internal state is the transient point-value step of the points
 * popover; open/closed state is owned by the shared {@link usePopover} hook.
 */
export interface BacklogRowProps {
  /** The user story rendered by this row. */
  us: UserStory;
  /** Project context — drives permission gating, status color, roles & points. */
  project: Project;
  /** Ordered US statuses (from `project.us_statuses` via the hook) for the status popover. */
  statuses: Status[];
  /** Whether tags are shown (mirrors the `#show-tags` backlog toggle). */
  showTags: boolean;
  /** Multiselect checkbox state (owned by `./Backlog.tsx`). */
  selected: boolean;
  /** Adds the `first` class to the options button (legacy `first_us_in_backlog`). */
  isFirstInBacklog?: boolean;
  /**
   * Header-selected role broadcast by the `.backlog-table-header` role selector
   * (legacy `uspoints:select` / `uspoints:clear-selection`). `null`/`undefined`
   * means "All points" (show the bare total); a role id switches every row's
   * points display to the `"{point} / {total}"` split form when the project has
   * more than one computable role.
   */
  displayRoleId?: number | null;
  /**
   * When `true` a mutation for this story is in flight; interactive controls are
   * disabled and popovers cannot be opened (mirrors the legacy `$qqueue` guard
   * that serialized per-story saves).
   */
  saving?: boolean;
  /**
   * Toggle the multiselect checkbox for this story. `shiftKey` is forwarded so
   * `./Backlog.tsx` can implement contiguous range selection from the anchor.
   */
  onToggleSelected: (us: UserStory, checked: boolean, shiftKey: boolean) => void;
  /** Change this story's status (single `bulk`/PATCH persisted by the hook). */
  onUpdateStatus: (us: UserStory, statusId: number) => void;
  /** Set the point value for a role on this story (`roleId` null when single role). */
  onUpdatePoints: (us: UserStory, roleId: number | null, pointId: number) => void;
  /** Open the shared edit-story lightbox for this story. */
  onEdit: (us: UserStory) => void;
  /** Delete this story. */
  onDelete: (us: UserStory) => void;
  /** Move this story to the top of the backlog. */
  onMoveToTop: (us: UserStory) => void;
  /** Optional `@dnd-kit` sortable wiring (see {@link BacklogRowDnd}). */
  dnd?: BacklogRowDnd;
}

/**
 * Renders one Backlog user-story row (the `.row.us-item-row` element tree of
 * `app/partials/includes/components/backlog-row.jade`).
 *
 * @param props - See {@link BacklogRowProps}.
 * @returns The row element tree, DOM/class-identical to the AngularJS original.
 */
export function BacklogRow(props: BacklogRowProps): JSX.Element {
  const { us, project } = props;
  const saving = props.saving === true;

  // --- Permission gating (mirrors `tg-check-permission` / `tg-class-permission`).
  // There is NO parallel authorization: these flags only gate which controls
  // render; the backend remains the single enforcement point (AAP §0.6.4). ---
  const modifyUs = project.my_permissions.indexOf("modify_us") !== -1;
  const canDelete = project.my_permissions.indexOf("delete_us") !== -1;

  // --- Derived projections ---
  const statusById = new Map<number, Status>(props.statuses.map((status) => [status.id, status]));
  const currentStatus = us.status != null ? statusById.get(us.status) : undefined;
  const tags: Tag[] = us.tags ?? [];
  const epics = us.epics ?? [];
  // `due_date` and `new` are legacy view fields not present on the strict
  // UserStory model; read them defensively without widening the shared type.
  const dueDate = (us as { due_date?: string }).due_date;
  const isNew = (us as { new?: boolean }).new === true;

  // --- Estimation projections (legacy `EstimationProcess`). Only `computable`
  // roles participate; `calculateTotalPoints` yields `"?"` for an unestimated
  // story so the points value is NEVER a fabricated `0`. ---
  const computableRoles = computeComputableRoles(project);
  const pointsById = buildPointsById(project);
  const totalPoints = calculateTotalPoints(us, pointsById);
  // When the header broadcasts a specific role AND more than one computable role
  // exists, the legacy `render()` shows "{that role's point} / {total}".
  const headerRoleId = props.displayRoleId ?? null;
  const showRoleSplit = headerRoleId !== null && computableRoles.length > 1;
  // The points editor is not clickable with no modify permission or no
  // computable roles (legacy `roles.length == 0 -> addClass("not-clickable")`).
  const pointsNotClickable = !modifyUs || computableRoles.length === 0;

  // --- Shared inline popovers (status / points / options). The hook enforces a
  // GLOBAL single-active invariant and provides outside-click / Escape / focus. ---
  const statusPop = usePopover();
  const pointsPop = usePopover();
  const optionsPop = usePopover();

  // Which role's point values are being chosen inside the points popover:
  // `null` shows the role-selection step, a role id shows the point-value step
  // (legacy `UsPointsDirective` `selectedRoleId` / `updatingSelectedRoleId`).
  const [pointStepRoleId, setPointStepRoleId] = useState<number | null>(null);

  /** Toggle the STATUS popover (no-op without modify permission or while saving). */
  const onStatusTriggerClick = (event: React.MouseEvent): void => {
    event.preventDefault();
    if (!modifyUs || saving) {
      return;
    }
    statusPop.toggle();
  };

  /**
   * Toggle the POINTS popover. On open, seed the point-value step exactly as the
   * legacy directive did: a single computable role is preselected (jumping
   * straight to the point step), otherwise a header-selected role is honored,
   * otherwise the role-selection step is shown first.
   */
  const onPointsTriggerClick = (event: React.MouseEvent): void => {
    event.preventDefault();
    if (pointsNotClickable || saving) {
      return;
    }
    if (pointsPop.open) {
      pointsPop.close();
      setPointStepRoleId(null);
      return;
    }
    const seed =
      computableRoles.length === 1
        ? computableRoles[0].id
        : headerRoleId !== null
        ? headerRoleId
        : null;
    setPointStepRoleId(seed);
    pointsPop.toggle();
  };

  /** Toggle the row OPTIONS popup (no-op while saving). */
  const onOptionsTriggerClick = (event: React.MouseEvent): void => {
    event.preventDefault();
    if (saving) {
      return;
    }
    optionsPop.toggle();
  };

  // --- Row root modifier classes (legacy `ng-class` + `tg-class-permission`). ---
  const rowClassName =
    "row us-item-row" +
    (us.is_blocked ? " blocked" : "") +
    (isNew ? " new" : "") +
    (!modifyUs ? " readonly" : "") +
    (props.dnd?.isDragging ? " dragging" : "");

  return (
    <div
      ref={props.dnd?.setNodeRef}
      style={props.dnd?.style}
      className={rowClassName}
      ng-repeat="us in userstories"
      data-id={String(us.id)}
    >
      <div className="us-item-row-left">
        {modifyUs ? (
          <div
            className="draggable-us-row"
            ref={props.dnd?.setActivatorNodeRef}
            {...(props.dnd?.attributes ?? {})}
            {...(props.dnd?.listeners ?? {})}
          >
            <Icon name="icon-draggable" svgClass="icon-drag" />
          </div>
        ) : null}
        {modifyUs ? (
          <div className="input">
            <div
              className="custom-checkbox"
              onMouseDown={(event) => {
                // When a prior row is focused, a Shift+click initiates a native
                // text-selection extension across the intervening rows, and the
                // browser then swallows the label -> checkbox activation so the
                // `change` event never fires. Suppressing the default only for
                // the Shift gesture stops that selection from starting, letting
                // the subsequent click toggle the checkbox and drive the
                // contiguous range selection. Non-Shift clicks are untouched, so
                // ordinary text remains selectable.
                if (event.shiftKey) {
                  event.preventDefault();
                }
              }}
            >
              <input
                type="checkbox"
                name="filter-mode"
                id={`us-check-${us.ref}`}
                checked={props.selected}
                disabled={saving}
                onChange={(event) => {
                  // The checkbox `change` is fired by the click, so its
                  // `nativeEvent` carries the `shiftKey` modifier used for
                  // contiguous range selection.
                  const native = event.nativeEvent as unknown as { shiftKey?: boolean };
                  props.onToggleSelected(us, event.target.checked, native.shiftKey === true);
                }}
              />
              <label htmlFor={`us-check-${us.ref}`} tabIndex={0} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="user-stories user-story-main-data">
        <a className="user-story-link" href={userStoryUrl(project.slug, us.ref ?? "")}>
          <span className="user-story-number" tg-bo-ref="us.ref">{`#${us.ref} `}</span>
          <span className="user-story-name">{us.subject ?? ""}</span>
        </a>
        {dueDate ? <div className="due-date">{String(dueDate)}</div> : null}
        {props.showTags
          ? tags.map((tag, index) => (
              <div
                key={index}
                className={"tag" + (index === tags.length - 1 ? " last" : "")}
                title={tag[0]}
                style={{ background: tag[1] ?? undefined }}
              >
                {tag[0]}
              </div>
            ))
          : null}
        {epics.map((epic, index) => (
          <div
            key={index}
            className="belong-to-epic-pill"
            style={{ background: epic.color ?? undefined }}
            title={`#${epic.ref} ${epic.subject ?? ""}`}
          />
        ))}
      </div>

      {/* INLINE STATUS EDITOR (tg-us-status + popover-us-status) */}
      <div className="status">
        <a
          ref={(el) => {
            statusPop.triggerRef.current = el;
          }}
          className={"us-status" + (!modifyUs || saving ? " not-clickable" : "")}
          href=""
          title={t("BACKLOG.STATUS_NAME")}
          aria-haspopup="true"
          aria-expanded={statusPop.open}
          aria-disabled={saving ? true : undefined}
          style={{ color: currentStatus?.color }}
          onClick={onStatusTriggerClick}
        >
          <span className="us-status-bind">{currentStatus?.name ?? ""}</span>
          {modifyUs ? <Icon name="icon-arrow-down" /> : null}
        </a>
        {statusPop.open ? (
          <ul
            ref={(el) => {
              statusPop.contentRef.current = el;
            }}
            className="popover pop-status active"
          >
            {props.statuses.map((status) => (
              <li key={status.id} className="popover-status">
                <a
                  className={"status" + (us.status === status.id ? " active-popover" : "")}
                  href=""
                  title={status.name}
                  data-status-id={String(status.id)}
                  onClick={(event) => {
                    event.preventDefault();
                    props.onUpdateStatus(us, status.id);
                    statusPop.close();
                  }}
                >
                  <span className="item-text">{status.name}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* INLINE POINTS EDITOR (tg-backlog-us-points -> us-estimation-total + role/points popover) */}
      <div className="points">
        <button
          ref={(el) => {
            pointsPop.triggerRef.current = el;
          }}
          type="button"
          className={"us-points" + (pointsNotClickable ? " not-clickable" : "")}
          disabled={saving}
          aria-haspopup="true"
          aria-expanded={pointsPop.open}
          onClick={onPointsTriggerClick}
        >
          <span className="points-value">
            {showRoleSplit ? (
              <>
                {roleDisplayPoints(us, headerRoleId as number, pointsById)}
                {" / "}
                <span>{String(totalPoints)}</span>
              </>
            ) : (
              String(totalPoints)
            )}
          </span>
        </button>
        {pointsPop.open && pointStepRoleId === null ? (
          <ul
            ref={(el) => {
              pointsPop.contentRef.current = el;
            }}
            className="popover pop-role active"
          >
            {computableRoles.map((role) => (
              <li key={role.id}>
                <a
                  className="role"
                  href=""
                  title={role.name}
                  data-role-id={String(role.id)}
                  onClick={(event) => {
                    event.preventDefault();
                    setPointStepRoleId(role.id);
                  }}
                >
                  <span className="item-text">
                    {(role.name ?? "") + " (" + roleDisplayPoints(us, role.id, pointsById) + ")"}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {pointsPop.open && pointStepRoleId !== null
          ? (() => {
              // The point-value step (`common/estimation/us-estimation-points.jade`).
              // `horizontal` when any point name is longer than 5 chars; the
              // currently-assigned point for this role is marked `.active`.
              const activeRoleId = pointStepRoleId;
              const allPoints = project.points ?? [];
              const horizontal = allPoints.some((point) => (point.name ?? "").length > 5);
              const currentPointId = us.points ? us.points[String(activeRoleId)] : null;
              return (
                <ul
                  ref={(el) => {
                    pointsPop.contentRef.current = el;
                  }}
                  className={"popover pop-points-open active" + (horizontal ? " horizontal" : "")}
                >
                  {allPoints.map((point) => {
                    const isCurrent = currentPointId === point.id;
                    return (
                      <li key={point.id}>
                        <a
                          className={"point" + (isCurrent ? " active" : "")}
                          href=""
                          title={point.name}
                          data-point-id={String(point.id)}
                          data-role-id={String(activeRoleId)}
                          onClick={(event) => {
                            event.preventDefault();
                            props.onUpdatePoints(us, activeRoleId, point.id);
                            pointsPop.close();
                            setPointStepRoleId(null);
                          }}
                        >
                          <span className="item-text">{point.name ?? ""}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              );
            })()
          : null}
      </div>

      {/* ROW OPTIONS POPUP (tg-us-edit-selector + us-edit-popover) — gated on modify_us */}
      {modifyUs ? (
        <div className="us-option">
          <button
            ref={(el) => {
              optionsPop.triggerRef.current = el;
            }}
            type="button"
            className={
              "us-option-popup-button js-popup-button" + (props.isFirstInBacklog ? " first" : "")
            }
            disabled={saving}
            aria-haspopup="true"
            aria-expanded={optionsPop.open}
            onClick={onOptionsTriggerClick}
          >
            <Icon name="icon-more-vertical" />
          </button>
          {optionsPop.open ? (
            <ul
              ref={(el) => {
                optionsPop.contentRef.current = el;
              }}
              className="popover us-option-popup active"
            >
              <li>
                <button
                  type="button"
                  className="e2e-edit edit-story"
                  onClick={() => {
                    props.onEdit(us);
                    optionsPop.close();
                  }}
                >
                  <Icon name="icon-edit" />
                  <span>{t("COMMON.EDIT")}</span>
                </button>
              </li>
              {canDelete ? (
                <li>
                  <button
                    type="button"
                    className="e2e-delete"
                    onClick={() => {
                      props.onDelete(us);
                      optionsPop.close();
                    }}
                  >
                    <Icon name="icon-trash" />
                    <span>{t("COMMON.DELETE")}</span>
                  </button>
                </li>
              ) : null}
              <li>
                <button
                  type="button"
                  className="e2e-edit move-to-top"
                  onClick={() => {
                    props.onMoveToTop(us);
                    optionsPop.close();
                  }}
                >
                  <Icon name="icon-move-to-top" />
                  <span>{t("COMMON.MOVE_TO_TOP")}</span>
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Re-exported so consumers can reference the legacy "?" unestimated sentinel. */
export { UNESTIMATED };
