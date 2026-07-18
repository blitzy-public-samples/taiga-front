/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * UsRolePointsSelector — backlog points-column header role filter (render-only).
 *
 * React port of the AngularJS `tgUsRolePointsSelector` directive
 * (`app/coffee/modules/backlog/main.coffee`, `UsRolePointsSelectorDirective`,
 * original lines ~995-1054) together with its popover template
 * (`app/partials/backlog/us-role-points-popover.jade`). Both AngularJS sources are
 * DELETE-marked by the migration and are reproduced here byte-for-byte in behaviour
 * and DOM.
 *
 * The directive was hosted by the backlog table header cell
 * (`app/partials/includes/modules/backlog-table.jade`):
 *
 *     div.points(title="{{'BACKLOG.TABLE.TITLE_COLUMN_POINTS' | translate}}")
 *         div.inner(tg-us-role-points-selector)          <-- THIS component renders `.inner`
 *             span.header-points(translate="COMMON.FIELDS.POINTS")
 *             tg-svg(svg-icon="icon-filter")
 *
 * The outer `.points` cell (with its title) is rendered by `BacklogTable`; this
 * component owns the `.inner` root and everything inside it. Selecting a role
 * filters which role's points every backlog row displays, so the *selected role
 * id* is a CONTROLLED prop lifted up to `BacklogTable` (`selectedRoleId` /
 * `onSelectRole`). The only state this component owns locally is the popover
 * open/close flag — matching the directive, which held no model state either
 * (it broadcast `uspoints:select` / `uspoints:clear-selection` upward).
 *
 * Pure presentational component: no fetch, no `/api/v1/` call, no WebSocket. It
 * reuses the EXACT existing SCSS class names (`inner`, `header-points`,
 * `not-clickable`, `popover-open`, `popover`, `pop-role`, `clear-selection`,
 * `active-popover`, `role`, `item-text`, verified in
 * `app/styles/modules/backlog/backlog-table.scss`) for pixel fidelity — it neither
 * imports nor rewrites any SCSS.
 *
 * Uses the `jsx: "react-jsx"` automatic runtime, so there is deliberately no
 * `import React` statement; only the hooks actually used are imported.
 */

import { useState, useRef, useEffect } from 'react';

import type { Project } from '../../shared/types';

/*
 * The board header uses Taiga's `<tg-svg>` web component to render inline SVG
 * sprites. It is not a standard HTML element, so we widen the JSX intrinsic
 * element table locally (no such declaration exists elsewhere under
 * `app/react/**`). Typed `any` because the element is opaque to React/TS and is
 * resolved by the existing sprite runtime at render time.
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
 * A project role as consumed by this selector. There is no `Role` shape in
 * `../../shared/types` (the board never modelled roles), and `Project.roles` is
 * only reachable through the interface's `[key: string]: unknown` index
 * signature. We therefore declare the minimal shape locally and read
 * `project.roles` via a safe cast. `computable` is optional because the raw
 * `/api/v1/` payload may omit it; only truthy `computable` roles are eligible.
 */
interface ComputableRole {
  id: number;
  name: string;
  computable?: boolean;
}

/**
 * Render Taiga's `<tg-svg>` sprite wrapper, mirroring the AngularJS
 * `tg-svg(svg-icon="…")` header markup. `className` is forwarded onto the custom
 * element (the sprite runtime reads it); the inner `<svg>` carries the
 * `icon <name>` classes the SCSS targets, and `<use>` references the sprite by id.
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
 * Props for {@link UsRolePointsSelector}.
 *
 * `selectedRoleId` is controlled by `BacklogTable` so that every row's points
 * column reflects the same filter; `null` means "All points" (show total /
 * unfiltered points). `onSelectRole` lifts the user's choice upward — it is the
 * React equivalent of the directive's `uspoints:select` (with the role id) and
 * `uspoints:clear-selection` (with `null`) `$rootScope` broadcasts.
 */
export interface UsRolePointsSelectorProps {
  /** The current project; `project.roles` supplies the computable-role list. */
  project: Project;
  /** Currently-filtered role id, or `null` for "All points". Controlled. */
  selectedRoleId: number | null;
  /** Lift the selection to `BacklogTable`; `null` clears the filter. */
  onSelectRole: (roleId: number | null) => void;
}

/**
 * The points-column header role filter.
 *
 * Behaviour reproduced from `UsRolePointsSelectorDirective`:
 *  - On init the directive computed `roles = _.filter(project.roles, "computable")`
 *    and `numberOfRoles = _.size(roles)`.
 *      * `numberOfRoles > 1`  -> the selector is interactive: it appends the
 *        `ul.popover.pop-role` template and shows the filter icon.
 *      * otherwise (`<= 1`)   -> the selector is inert: the directive removed the
 *        icon (`$el.find(".icon-arrow-down").remove()`) and added `not-clickable`
 *        to `.header-points`.
 *  - Clicking the header added `popover-open` to `.inner` and opened the popover.
 *  - Clicking `.clear-selection` broadcast `uspoints:clear-selection` (role id
 *    `null`), reset the header text to "Points", moved `active-popover` onto the
 *    clear anchor, and closed the popover.
 *  - Clicking a `.role` anchor broadcast `uspoints:select` with the anchor's
 *    `data-role-id` and text, set the header text to the role name, moved
 *    `active-popover` onto that anchor, and closed the popover.
 *
 * NOTE (intentional discrepancy preserved): the directive's inert branch removed
 * `.icon-arrow-down`, but the actual header template (`backlog-table.jade`)
 * renders `tg-svg(svg-icon="icon-filter")` — there is no `.icon-arrow-down` in the
 * markup, so the removal was effectively a no-op on the arrow and the intent was
 * simply "hide the filter affordance". We reproduce that intent faithfully by
 * OMITTING the `icon-filter` (and the popover) entirely when there is `<= 1`
 * computable role, and by adding `not-clickable` to `.header-points`.
 */
export const UsRolePointsSelector = ({
  project,
  selectedRoleId,
  onSelectRole,
}: UsRolePointsSelectorProps): JSX.Element => {
  // Local UI state ONLY: whether the role popover is open. The selected role id
  // is controlled by the parent (see props).
  const [open, setOpen] = useState(false);
  // Root `.inner` element, used for the outside-click containment check — the
  // React equivalent of the directive appending the popover into `$el` and the
  // popover plugin closing on an outside click.
  const rootRef = useRef<HTMLDivElement>(null);

  // `project.roles` is only reachable through the `Project` index signature
  // (typed `unknown`), so cast to the minimal local shape, then keep only the
  // computable roles — exactly `_.filter(project.roles, "computable")`.
  const roles = ((project?.roles as ComputableRole[] | undefined) ?? []).filter(
    (r) => r.computable,
  );
  // The selector is interactive only when more than one computable role exists,
  // mirroring the directive's `numberOfRoles > 1` gate.
  const hasSelector = roles.length > 1;

  // Header label: the selected role's name when a real role is filtered,
  // otherwise the default "Points" (i18n: COMMON.FIELDS.POINTS).
  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const headerText =
    selectedRoleId != null && selectedRole ? selectedRole.name : 'Points';

  // Outside-click + Escape closing, gated on `open` so listeners exist only while
  // the popover is shown. The popover is rendered inline inside `.inner` (no
  // `createPortal`), matching the directive appending the template into `$el`;
  // a `mousedown` outside `rootRef` — or the Escape key — closes it.
  useEffect(() => {
    if (!open) {
      return;
    }

    const onDocumentMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={`inner${open ? ' popover-open' : ''}`} ref={rootRef}>
      {/*
        Header label. When interactive, clicking it toggles the popover (the
        directive's whole-`$el` click that added `popover-open` and opened the
        popover). When inert (`<= 1` computable role) it carries `not-clickable`
        and has no click handler.
      */}
      <span
        className={`header-points${hasSelector ? '' : ' not-clickable'}`}
        onClick={hasSelector ? () => setOpen((o) => !o) : undefined}
      >
        {headerText}
      </span>

      {/* Filter affordance — shown only when the selector is interactive. */}
      {hasSelector && svgIcon('icon-filter')}

      {/*
        Role popover (`us-role-points-popover.jade`): a "clear selection" entry
        followed by one anchor per computable role. `active-popover` marks the
        current selection (the clear anchor when `selectedRoleId` is null).
      */}
      {hasSelector && open && (
        <ul className="popover pop-role">
          <li>
            {/* i18n: COMMON.ROLES.ALL -> "All points". Clears the filter. */}
            <a
              className={`clear-selection${
                selectedRoleId == null ? ' active-popover' : ''
              }`}
              title="All points"
              onClick={(e) => {
                e.preventDefault();
                onSelectRole(null);
                setOpen(false);
              }}
            >
              All points
            </a>
          </li>
          {roles.map((role) => (
            <li key={role.id}>
              <a
                className={`role${
                  selectedRoleId === role.id ? ' active-popover' : ''
                }`}
                title={role.name}
                data-role-id={role.id}
                onClick={(e) => {
                  e.preventDefault();
                  onSelectRole(role.id);
                  setOpen(false);
                }}
              >
                <span className="item-text">{role.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
