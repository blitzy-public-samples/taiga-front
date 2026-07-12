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
 *   - the multiselect checkbox (`.custom-checkbox > input#us-check-<ref>`),
 *   - the user-story link (`#<ref>` + escaped subject), due-date, tags and
 *     epic pills,
 *   - the inline STATUS editor (`tg-us-status` -> `.us-status` + `.pop-status`
 *     popover), from `app/coffee/modules/common/popovers.coffee` UsStatusDirective,
 *   - the inline POINTS editor (`tg-backlog-us-points` -> `.us-points` +
 *     `.pop-role` popover with the two-step role -> point selection), from the
 *     `UsPointsDirective` / `EstimationProcess` of
 *     `app/coffee/modules/backlog/main.coffee` + `common/estimation.coffee`,
 *   - the row OPTIONS popup (`tg-us-edit-selector` -> `.us-option-popup` with
 *     edit / delete / move-to-top), from `app/partials/backlog/us-edit-popover.jade`.
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
 *   - Visible action text uses the English values from
 *     `app/locales/taiga/locale-en.json` ("Status Name", "Edit", "Delete",
 *     "Move to top") so the rendered output matches the AngularJS `translate`
 *     output exactly.
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
 * The only internal state is the transient open/closed flags of the three
 * inline popovers (status / points / options).
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
  /** Toggle the multiselect checkbox for this story. */
  onToggleSelected: (us: UserStory, checked: boolean) => void;
  /** Change this story's status (single `bulk`/PATCH persisted by the hook). */
  onUpdateStatus: (us: UserStory, statusId: number) => void;
  /** Set the point value for a role on this story (`roleId` null when single role). */
  onUpdatePoints: (us: UserStory, roleId: number | null, pointId: number) => void;
  /** Open the (AngularJS) edit-story lightbox via the hook's window CustomEvent bridge. */
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
  // Only `computable` roles participate in estimation (legacy
  // `EstimationProcess.calculateRoles` = `_.filter(project.roles, "computable")`).
  const computableRoles = (project.roles ?? []).filter((role) => role.computable !== false);

  // --- Inline-popover open state. At most ONE popover is open at any time so
  // the DOM never contains more than a single `.popover.active` element (the
  // ported Playwright helper asserts `.popover.active` count === 1). ---
  const [statusOpen, setStatusOpen] = useState<boolean>(false);
  const [pointsOpen, setPointsOpen] = useState<boolean>(false);
  const [optionsOpen, setOptionsOpen] = useState<boolean>(false);
  // Which role's point values are being chosen inside the points popover:
  // `null` shows the role-selection step, a role id shows the point-value step.
  // Mirrors `UsPointsDirective.selectedRoleId`.
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);

  /** Open/close the STATUS popover, closing the others (single-active invariant). */
  const toggleStatus = (): void => {
    if (!modifyUs) {
      return;
    }
    setPointsOpen(false);
    setSelectedRoleId(null);
    setOptionsOpen(false);
    setStatusOpen((open) => !open);
  };

  /**
   * Open/close the POINTS popover, closing the others. On open, preselect the
   * single computable role (legacy `roles.length === 1` preselects, jumping
   * straight to the point-value step); otherwise start at the role step.
   */
  const togglePoints = (): void => {
    if (!modifyUs) {
      return;
    }
    setStatusOpen(false);
    setOptionsOpen(false);
    if (pointsOpen) {
      setPointsOpen(false);
      setSelectedRoleId(null);
      return;
    }
    const onlyRole = computableRoles.length === 1 ? computableRoles[0] : undefined;
    setSelectedRoleId(onlyRole ? onlyRole.id : null);
    setPointsOpen(true);
  };

  /** Open/close the row OPTIONS popup, closing the others. */
  const toggleOptions = (): void => {
    setStatusOpen(false);
    setPointsOpen(false);
    setSelectedRoleId(null);
    setOptionsOpen((open) => !open);
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
            <div className="custom-checkbox">
              <input
                type="checkbox"
                name="filter-mode"
                id={`us-check-${us.ref}`}
                checked={props.selected}
                onChange={(event) => props.onToggleSelected(us, event.target.checked)}
              />
              <label htmlFor={`us-check-${us.ref}`} tabIndex={0} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="user-stories user-story-main-data">
        <a className="user-story-link" href={`#/project/${project.slug}/us/${us.ref}`}>
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
          className={"us-status" + (!modifyUs ? " not-clickable" : "")}
          href=""
          title="Status Name"
          style={{ color: currentStatus?.color }}
          onClick={(event) => {
            event.preventDefault();
            toggleStatus();
          }}
        >
          <span className="us-status-bind">{currentStatus?.name ?? ""}</span>
          {modifyUs ? <Icon name="icon-arrow-down" /> : null}
        </a>
        {statusOpen ? (
          <ul className="popover pop-status active">
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
                    setStatusOpen(false);
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
          type="button"
          className={"us-points" + (!modifyUs ? " not-clickable" : "")}
          onClick={(event) => {
            event.preventDefault();
            togglePoints();
          }}
        >
          <span className="points-value">{us.total_points ?? 0}</span>
        </button>
        {pointsOpen ? (
          <ul className="popover pop-role active">
            {selectedRoleId == null
              ? computableRoles.map((role) => (
                  <li key={role.id}>
                    <a
                      className="role"
                      href=""
                      title={role.name}
                      data-role-id={String(role.id)}
                      onClick={(event) => {
                        event.preventDefault();
                        setSelectedRoleId(role.id);
                      }}
                    >
                      <span className="item-text">{role.name ?? ""}</span>
                    </a>
                  </li>
                ))
              : (project.points ?? []).map((point) => {
                  // The currently-assigned point for this role is highlighted
                  // (legacy `us-estimation-points.jade`: the selected point gets
                  // the `active` class).
                  const isCurrent = us.points ? us.points[selectedRoleId] === point.id : false;
                  return (
                    <li key={point.id}>
                      <a
                        className={"point" + (isCurrent ? " active" : "")}
                        href=""
                        title={point.name}
                        data-point-id={String(point.id)}
                        data-role-id={String(selectedRoleId)}
                        onClick={(event) => {
                          event.preventDefault();
                          props.onUpdatePoints(us, selectedRoleId, point.id);
                          setPointsOpen(false);
                          setSelectedRoleId(null);
                        }}
                      >
                        <span className="item-text">{point.name ?? ""}</span>
                      </a>
                    </li>
                  );
                })}
          </ul>
        ) : null}
      </div>

      {/* ROW OPTIONS POPUP (tg-us-edit-selector + us-edit-popover) — gated on modify_us */}
      {modifyUs ? (
        <div className="us-option">
          <button
            type="button"
            className={
              "us-option-popup-button js-popup-button" + (props.isFirstInBacklog ? " first" : "")
            }
            onClick={(event) => {
              event.preventDefault();
              toggleOptions();
            }}
          >
            <Icon name="icon-more-vertical" />
          </button>
          {optionsOpen ? (
            <ul className="popover us-option-popup active">
              <li>
                <button
                  type="button"
                  className="e2e-edit edit-story"
                  onClick={() => {
                    props.onEdit(us);
                    setOptionsOpen(false);
                  }}
                >
                  <Icon name="icon-edit" />
                  <span>Edit</span>
                </button>
              </li>
              {canDelete ? (
                <li>
                  <button
                    type="button"
                    className="e2e-delete"
                    onClick={() => {
                      props.onDelete(us);
                      setOptionsOpen(false);
                    }}
                  >
                    <Icon name="icon-trash" />
                    <span>Delete</span>
                  </button>
                </li>
              ) : null}
              <li>
                <button
                  type="button"
                  className="e2e-edit move-to-top"
                  onClick={() => {
                    props.onMoveToTop(us);
                    setOptionsOpen(false);
                  }}
                >
                  <Icon name="icon-move-to-top" />
                  <span>Move to top</span>
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

