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
import { canMutate } from '../../shared/permissions';
// F-UI-02: the ONE shared SVG-sprite primitive (replaces this file's former
// local `svgIcon`/`tg-svg` declaration). F-UI-06: the shared translation bridge
// so the option-popover copy reads the same `COMMON.EDIT` / `COMMON.DELETE` /
// `COMMON.MOVE_TO_TOP` keys the AngularJS `us-edit-popover.jade` used.
import { TgSvg } from '../../shared/icon';
import { translate } from '../../shared/i18n';

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
 * ALSO hold `delete_us` — exactly the AngularJS gating. The per-item
 * archive-aware `canMutate()` checks (F-REG-03) are kept regardless so the
 * component is self-correct if reused, and every action is hidden on an
 * archived project even when the permission is held.
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
        aria-label={translate('BACKLOG.US_OPTIONS', undefined, 'User story options')}
        onClick={() => setOpen((o) => !o)}
      >
        <TgSvg icon="icon-more-vertical" />
      </button>

      {/*
        Options popover (`us-edit-popover.jade`). Rendered inline within
        `.us-option` only while `open`. Carries the `first` class alongside
        `isFirst`, mirroring the directive adding `first` to `.us-option-popup`.
        Each action is permission-gated and, on click, fires its callback and
        then closes the popover.
      */}
      {open && (
        // F-UI-04: expose the option popover as an ARIA menu (matching the
        // kanban `CardActions` popover pattern); the visible
        // `.popover.us-option-popup` classes are unchanged.
        <ul
          className={`popover us-option-popup${isFirst ? ' first' : ''}`}
          role="menu"
          aria-label={translate('BACKLOG.US_OPTIONS', undefined, 'User story options')}
        >
          {canMutate(project, 'modify_us') && (
            <li role="none">
              {/* Edit → ctrl.editUserStory. F-UI-06: COMMON.EDIT. */}
              <button
                type="button"
                className="e2e-edit edit-story"
                role="menuitem"
                onClick={() => {
                  onEdit(us);
                  setOpen(false);
                }}
              >
                <TgSvg icon="icon-edit" />
                <span>{translate('COMMON.EDIT', undefined, 'Edit')}</span>
              </button>
            </li>
          )}
          {canMutate(project, 'delete_us') && (
            <li role="none">
              {/* Delete → ctrl.deleteUserStory. F-UI-06: COMMON.DELETE. */}
              <button
                type="button"
                className="e2e-delete"
                role="menuitem"
                onClick={() => {
                  onDelete(us);
                  setOpen(false);
                }}
              >
                <TgSvg icon="icon-trash" />
                <span>{translate('COMMON.DELETE', undefined, 'Delete')}</span>
              </button>
            </li>
          )}
          {canMutate(project, 'modify_us') && (
            <li role="none">
              {/* Move to top → ctrl.moveUsToTopOfBacklog. F-UI-06: COMMON.MOVE_TO_TOP. */}
              <button
                type="button"
                className="e2e-edit move-to-top"
                role="menuitem"
                onClick={() => {
                  onMoveToTop(us);
                  setOpen(false);
                }}
              >
                <TgSvg icon="icon-move-to-top" />
                <span>{translate('COMMON.MOVE_TO_TOP', undefined, 'Move to top')}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};
