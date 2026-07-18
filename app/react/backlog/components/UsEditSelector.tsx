/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * UsEditSelector — per-row user-story "options" popover for the backlog table
 * (render-only).
 *
 * React port of the AngularJS `tgUsEditSelector` directive
 * (`app/coffee/modules/backlog/main.coffee`, `UsEditSelector` / directive
 * `tgUsEditSelector`, original lines ~966-989) together with its popover
 * template (`app/partials/backlog/us-edit-popover.jade`). Both AngularJS sources
 * are DELETE-marked by the migration and are reproduced here byte-for-byte in
 * DOM and behaviour.
 *
 * The directive was hosted by the backlog row's `.us-option` cell
 * (`app/partials/backlog/backlog-row.jade`):
 *
 *     .us-option(tg-us-edit-selector, tg-check-permission="modify_us")
 *         button.us-option-popup-button.js-popup-button(
 *             ng-class="{first: us.id === first_us_in_backlog}")
 *             tg-svg(svg-icon="icon-more-vertical")
 *
 * On click the directive appended the popover template into the same `.us-option`
 * host (`$el.append(...)`), added `popover-open` to the trigger button and — when
 * the trigger carried the `first` class — added `first` to the popover `ul` too.
 * The popover closed on an outside click, which removed both the popover element
 * and the `popover-open` class.
 *
 * RENDER-ONLY. This component owns exactly ONE piece of local UI state — the
 * popover open/close flag. It performs NO fetch, NO `/api/v1/` call and NO
 * WebSocket work; the three actions (edit / delete / move-to-top) are emitted
 * upward as callbacks so `BacklogTable` (the container) can enact them, exactly
 * as the directive delegated to `ctrl.editUserStory` / `ctrl.deleteUserStory` /
 * `ctrl.moveUsToTopOfBacklog`. It reuses the EXACT existing SCSS class names
 * (`us-option`, `us-option-popup-button`, `js-popup-button`, `first`,
 * `popover-open`, `popover`, `us-option-popup`, `e2e-edit`, `edit-story`,
 * `e2e-delete`, `move-to-top` — verified in
 * `app/styles/modules/backlog/backlog-table.scss`) for pixel fidelity; it
 * neither imports nor rewrites any SCSS.
 *
 * Uses the `jsx: "react-jsx"` automatic runtime, so there is deliberately no
 * `import React` statement — only the hooks actually used are imported.
 */

import { useState, useRef, useEffect } from 'react';

import type { UserStory, Project } from '../../shared/types';
import { can } from '../../shared/permissions';

/*
 * The backlog markup uses Taiga's `<tg-svg>` web component to render inline SVG
 * sprites (so CSS selectors such as `tg-svg svg.icon` keep matching). It is not
 * a standard HTML element, so we widen the JSX intrinsic-element table locally.
 * Typed `any` because the element is opaque to React/TS and is resolved by the
 * existing sprite runtime at render time. (The same local declaration exists in
 * the sibling `UsRolePointsSelector`; duplicate ambient merges are harmless.)
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
 * classes the SCSS targets, and `<use>` references the sprite by id. `className`
 * is forwarded onto the custom element for parity with the shared convention.
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
 * Props for {@link UsEditSelector}.
 *
 * The component is fully controlled by `BacklogTable`, which renders one instance
 * per backlog row inside the row's `.us-option` cell. The three `on*` callbacks
 * are the React equivalents of the directive's `ctrl.*` delegations (see below);
 * each fires with the row's `us` and then the popover self-closes.
 */
export interface UsEditSelectorProps {
  /** The user story this row represents. Passed straight back on each action. */
  us: UserStory;
  /** The owning project; supplies `my_permissions` for the per-item gates. */
  project: Project;
  /**
   * `true` when `us.id === firstUsInBacklog` — mirrors the trigger's legacy
   * `ng-class="{first: …}"`. Adds the `first` class to BOTH the trigger button
   * and the popover `ul` (a styling nudge so the top row's popover opens
   * downward rather than clipping above the table).
   */
  isFirst: boolean;
  /** Edit action → legacy `ctrl.editUserStory(us.project, us.ref, $event)`. */
  onEdit: (us: UserStory) => void;
  /** Delete action → legacy `ctrl.deleteUserStory(us)`. */
  onDelete: (us: UserStory) => void;
  /** Move-to-top action → legacy `ctrl.moveUsToTopOfBacklog(us)`. */
  onMoveToTop: (us: UserStory) => void;
}

/**
 * The per-row user-story options popover.
 *
 * Behaviour reproduced from `UsEditSelectorDirective`:
 *  - Clicking the trigger button toggles the popover open/closed. While open the
 *    trigger carries the `popover-open` class (legacy:
 *    `$el.find(".js-popup-button").addClass('popover-open')`).
 *  - When `isFirst` is set, the `first` class is added to the trigger AND to the
 *    popover `ul.us-option-popup` (legacy: `if event.target.parentNode.classList
 *    .contains('first') → $el.find(".us-option-popup").addClass('first')`).
 *  - An outside click — or the Escape key — closes the popover, which drops the
 *    `popover-open` class and removes the popover from the DOM (legacy
 *    `removePopupOpenState`).
 *
 * The popover is rendered INLINE inside the `.us-option` host (NOT via
 * `createPortal`), faithfully matching the directive's `$el.append(html)`: the
 * SCSS `.popover` positions it absolutely relative to the `position: relative`
 * `.us-option` cell.
 *
 * The three actions are permission-gated individually (edit / move-to-top →
 * `modify_us`, delete → `delete_us`), mirroring each legacy button's
 * `tg-check-permission`. `BacklogTable` already renders this component only when
 * the user holds `modify_us` on the project (the `.us-option` cell's own
 * `tg-check-permission="modify_us"`), so delete is reachable only for users who
 * ALSO hold `delete_us` — exactly the AngularJS gating. The per-item `can()`
 * checks are kept regardless so the component is self-correct if reused.
 */
export const UsEditSelector = ({
  us,
  project,
  isFirst,
  onEdit,
  onDelete,
  onMoveToTop,
}: UsEditSelectorProps): JSX.Element => {
  // Local UI state ONLY: whether the options popover is open.
  const [open, setOpen] = useState(false);
  // Root `.us-option` element, used for the outside-click containment check —
  // the React equivalent of the directive appending the popover into `$el` and
  // the popover plugin closing on an outside click.
  const rootRef = useRef<HTMLDivElement>(null);

  // Outside-click + Escape closing, gated on `open` so the listeners exist only
  // while the popover is shown. A `mousedown` whose target is NOT inside
  // `rootRef` — or the Escape key — closes the popover; the cleanup removes both
  // listeners when the popover closes or the component unmounts (parity with the
  // directive's `$scope.$on("$destroy", -> $el.off())`).
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
    <div className="us-option" ref={rootRef}>
      {/*
        Trigger button. Reproduces `button.us-option-popup-button.js-popup-button`
        with the legacy `first` toggle and the directive's `popover-open` class
        added while the popover is open. `aria-haspopup` / `aria-expanded`
        describe the disclosure relationship for assistive technology (invisible
        accessibility — no visual change).
      */}
      <button
        type="button"
        className={`us-option-popup-button js-popup-button${
          isFirst ? ' first' : ''
        }${open ? ' popover-open' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {svgIcon('icon-more-vertical')}
      </button>

      {/*
        Options popover (`us-edit-popover.jade`). Rendered inline within
        `.us-option` only while `open`. Carries the `first` class alongside
        `isFirst`, mirroring the directive adding `first` to `.us-option-popup`.
        Each action is permission-gated and, on click, fires its callback and
        then closes the popover.
      */}
      {open && (
        <ul className={`popover us-option-popup${isFirst ? ' first' : ''}`}>
          {can(project, 'modify_us') && (
            <li>
              {/* Edit → ctrl.editUserStory. i18n: COMMON.EDIT. */}
              <button
                type="button"
                className="e2e-edit edit-story"
                onClick={() => {
                  onEdit(us);
                  setOpen(false);
                }}
              >
                {svgIcon('icon-edit')}
                <span>Edit</span>
              </button>
            </li>
          )}
          {can(project, 'delete_us') && (
            <li>
              {/* Delete → ctrl.deleteUserStory. i18n: COMMON.DELETE. */}
              <button
                type="button"
                className="e2e-delete"
                onClick={() => {
                  onDelete(us);
                  setOpen(false);
                }}
              >
                {svgIcon('icon-trash')}
                <span>Delete</span>
              </button>
            </li>
          )}
          {can(project, 'modify_us') && (
            <li>
              {/* Move to top → ctrl.moveUsToTopOfBacklog. i18n: COMMON.MOVE_TO_TOP. */}
              <button
                type="button"
                className="e2e-edit move-to-top"
                onClick={() => {
                  onMoveToTop(us);
                  setOpen(false);
                }}
              >
                {svgIcon('icon-move-to-top')}
                <span>Move to top</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};
