/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * CardActions — the Kanban card "actions" button and the popover menu it opens.
 *
 * This module is the React 18 replacement for the legacy AngularJS
 * `tgCardActions` directive (`CardActionsDirective`, kanban `main` module,
 * lines 1018-1125) together with the `taiga.globalPopover` menu it launched
 * (`common/popovers.coffee`, lines 256-337) of the in-place screen migration.
 * Behaviour is reproduced EXACTLY under the Minimal Change Clause — zero
 * feature change.
 *
 * WHAT THE LEGACY DIRECTIVE DID
 *   `card-actions.jade` rendered a `.card-actions > button.js-popup-button`
 *   holding the `icon-more-vertical` sprite, but ONLY when the board was zoomed
 *   in (`zoomLevel > 0`) and the current user could either modify OR delete user
 *   stories on the project. Clicking the button added the `popover-open` class
 *   and opened `taiga.globalPopover` with a permission-ordered action list:
 *     1. `modify_us`  -> "Edit card"  (icon-edit)  + "Assign To" (icon-assign-to)
 *     2. `delete_us`  -> "Delete card" (icon-trash)
 *     3. `modify_us` && not the first card -> "Move to top" (icon-move-to-top)
 *   The popover was appended to `document.body` (so card overflow never clipped
 *   it), positioned just under the button's bottom-right corner, and dismissed
 *   on outside click and on scroll — at which point the `popover-open` class was
 *   removed.
 *
 * HOW THIS MAPS TO REACT
 *   - The permission-ordered action list is rebuilt on every render from the
 *     `can(...)` gates (see `../../shared/permissions`), byte-for-byte in the
 *     same order the directive pushed them.
 *   - The `document.body`-appended popover is reproduced with `createPortal`, so
 *     it likewise escapes the card's overflow clipping.
 *   - Positioning mirrors `elementPosition()` exactly: `top = rect.top + height`,
 *     `left = rect.right - width`, `width = 170` (the `options.width` default).
 *   - Outside-click and capture-phase scroll dismissal mirror the globalPopover
 *     plugin's own dismissal, and the `popover-open` class toggles with the open
 *     state exactly as `addClass`/`removeClass('popover-open')` did.
 *
 * RESPONSIBILITY SPLIT (presentational + intent-emitting ONLY)
 *   This component performs NO data fetching, network/socket access, state
 *   mutation, immer/reducer work or direct jQuery/Angular DOM manipulation. It
 *   emits pure user intent through the `onClick*` callback props and NEVER opens
 *   a lightbox/dialog itself — the owning container (`./Card` / `KanbanApp`)
 *   decides what each intent does. The only local state is the popover's
 *   open/close UI state plus its computed screen position; the only effects are
 *   the outside-click and scroll dismissal listeners. That keeps the component
 *   trivially unit-testable and indistinguishable from the AngularJS screen to
 *   the unchanged Django `/api/v1/` backend.
 *
 * NOTE ON THE `onClickMoveToTop` CONTRACT
 *   The legacy directive passed the whole `item` to `onClickMoveToTop`; here all
 *   four callbacks are id-based (`item.id`, a `number`) for a single consistent
 *   contract with `Card` / `KanbanApp`, which resolve the card from the id.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { BoardCard, Project } from '../../shared/types';
import { can } from '../../shared/permissions';

/*
 * `<tg-svg>` is the AngularJS icon custom element registered globally by the
 * still-running AngularJS shell; the SVG sprite it references is already loaded
 * into the document, so `<use xlinkHref="#icon-...">` resolves at runtime. It
 * has no React type, so it is declared here as an intrinsic JSX element. The
 * declaration is `any` (identical to the sibling components' declaration), so
 * merging with any other module's identical augmentation is conflict-free.
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
 * The default popover width, in CSS pixels. Mirrors `options.width || 170` in
 * `globalPopover`'s `elementPosition()` — the directive opened the popover with
 * an empty `options` object, so the 170px default always applied.
 */
const POPOVER_WIDTH = 170;

/**
 * Props for {@link CardActions}.
 *
 * `item` and `project` mirror the directive's isolate-scope `item` / `vm`
 * inputs; `zoomLevel` gates rendering exactly as `vm.zoomLevel` did; `isFirst`
 * is the `$first` flag from the card `ng-repeat` that disabled "Move to top" for
 * the first card. Every action is surfaced as an OPTIONAL id-based callback so
 * the component can be dropped into any container without wiring all four.
 */
export interface CardActionsProps {
    /** The board card whose actions this menu operates on. */
    item: BoardCard;
    /** The owning project — drives the `modify_us` / `delete_us` permission gates. */
    project: Project;
    /** Board zoom level; the actions button renders only when `> 0`. */
    zoomLevel: number;
    /** `$first` in the legacy `ng-repeat`: disables "Move to top" for the first card. */
    isFirst?: boolean;
    /** Fired with `item.id` when "Edit card" is chosen. */
    onClickEdit?: (id: number) => void;
    /** Fired with `item.id` when "Assign To" is chosen. */
    onClickAssignedTo?: (id: number) => void;
    /** Fired with `item.id` when "Delete card" is chosen. */
    onClickDelete?: (id: number) => void;
    /** Fired with `item.id` when "Move to top" is chosen. */
    onClickMoveToTop?: (id: number) => void;
}

/**
 * A single popover menu entry, mirroring the `{ text, icon, event }` objects the
 * directive pushed into its `actions` array before handing them to
 * `taiga.globalPopover`.
 */
interface PopoverAction {
    /** Visible label (English literal; see the i18n note on each push site). */
    text: string;
    /** Sprite icon name, e.g. `icon-edit` — resolved via `<use xlinkHref>`. */
    icon: string;
    /** Intent handler fired when the entry is activated. */
    event: () => void;
}

/**
 * The computed on-screen position of the popover, mirroring the three inline
 * styles `globalPopover` set on its wrapper (`top`, `left`, `width`). `position`
 * itself is intentionally NOT set inline — the reused `.popover.global-popover`
 * stylesheet class governs it, exactly as in the original.
 */
interface PopoverPosition {
    /** Distance from the viewport top, in CSS pixels (`rect.top + rect.height`). */
    top: number;
    /** Distance from the viewport left, in CSS pixels (`rect.right - width`). */
    left: number;
    /** Popover width, in CSS pixels (the 170px default). */
    width: number;
}

/**
 * Render an inline sprite icon, reproducing the repo's `<tg-svg>` markup.
 *
 * Two shapes are produced, matching the two legacy sources EXACTLY:
 *   - The card-actions button uses `CardSvgTemplate`, whose `<svg>` carries both
 *     the base `icon` class AND the icon-name class (`icon icon-more-vertical`).
 *     Call with `{ withNameClass: true }`.
 *   - The popover menu items use `globalPopover`'s `createSvg`, whose `<svg>`
 *     carries ONLY the base `icon` class (no icon-name class). Call with no opts.
 *
 * The non-standard `attr-href` attribute (kept for DOM parity with the original
 * sprite markup, which set both `xlink:href` and `attr-href`) is applied through
 * a `Record<string, string>` cast spread because React's SVG prop types have no
 * string index signature.
 *
 * @param icon The sprite icon name (without the leading `#`).
 * @param opts `withNameClass: true` appends the icon-name class to `icon`.
 * @returns The `<tg-svg>` icon element.
 */
function svgIcon(icon: string, opts?: { withNameClass?: boolean }): JSX.Element {
    const cls = opts?.withNameClass ? `icon ${icon}` : 'icon';
    const extraUseAttrs = { 'attr-href': `#${icon}` } as Record<string, string>;
    return (
        <tg-svg>
            <svg className={cls}>
                <use xlinkHref={`#${icon}`} {...extraUseAttrs} />
            </svg>
        </tg-svg>
    );
}

/**
 * The Kanban card actions button plus its popover menu.
 *
 * Renders `null` unless the board is zoomed in and the user can modify or delete
 * user stories — the same top-level gate `card-actions.jade` enforced. When
 * gated in, it always shows the `.card-actions > button.js-popup-button` and,
 * while the menu is open, portals the `.popover.global-popover` menu to
 * `document.body`.
 */
export function CardActions({
    item,
    project,
    zoomLevel,
    isFirst = false,
    onClickEdit,
    onClickAssignedTo,
    onClickDelete,
    onClickMoveToTop,
}: CardActionsProps): JSX.Element | null {
    // Popover UI state only (never business data): whether the menu is open and,
    // when open, where on screen it sits. `position` is computed once per open,
    // which is faithful because the menu closes on scroll (see the effect below).
    const [open, setOpen] = useState<boolean>(false);
    const [position, setPosition] = useState<PopoverPosition | null>(null);

    // `buttonRef` anchors the popover position (replacing the directive's
    // `event.currentTarget`); `menuRef` lets the outside-click handler tell a
    // click on the menu apart from a click elsewhere.
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Permission gates, evaluated through the shared helper so the rule is
    // identical to `kanban/sortable.coffee` and the AngularJS card template.
    const canModify = can(project, 'modify_us');
    const canDelete = can(project, 'delete_us');

    // Outside-click + scroll dismissal, registered ONLY while the menu is open.
    // Registering inside the effect (which runs after the opening click has fully
    // propagated) guarantees the click that opened the menu never closes it.
    useEffect(() => {
        if (!open) {
            return undefined;
        }

        // Mirror the globalPopover plugin's outside-click dismissal: any pointer
        // press outside BOTH the button and the menu closes the popover. Presses
        // on the button itself fall through to `toggleOpen`; presses on a menu
        // item fall through to that item's own handler.
        const handleOutsidePointerDown = (nativeEvent: Event): void => {
            const target = nativeEvent.target as Node | null;
            if (!target) {
                return;
            }
            if (buttonRef.current && buttonRef.current.contains(target)) {
                return;
            }
            if (menuRef.current && menuRef.current.contains(target)) {
                return;
            }
            setOpen(false);
        };

        // Mirror `document.addEventListener('scroll', close, true)` — a
        // capture-phase scroll listener so scrolling ANY ancestor closes the menu.
        const handleScroll = (): void => {
            setOpen(false);
        };

        document.addEventListener('mousedown', handleOutsidePointerDown);
        document.addEventListener('scroll', handleScroll, true);

        return () => {
            document.removeEventListener('mousedown', handleOutsidePointerDown);
            document.removeEventListener('scroll', handleScroll, true);
        };
    }, [open]);

    // Top-level render gate (card-actions.jade): nothing renders unless the board
    // is zoomed in and the user can modify OR delete user stories.
    if (!(zoomLevel > 0 && (canModify || canDelete))) {
        return null;
    }

    // Build the popover action list in the EXACT order the directive pushed them,
    // respecting the same permission gates. Each `event` fires the matching
    // id-based callback; the menu-item click handler closes the popover afterward.
    const actions: PopoverAction[] = [];

    if (canModify) {
        // COMMON.CARD.EDIT
        actions.push({
            text: 'Edit card',
            icon: 'icon-edit',
            event: () => onClickEdit?.(item.id),
        });
        // COMMON.CARD.ASSIGN_TO
        actions.push({
            text: 'Assign To',
            icon: 'icon-assign-to',
            event: () => onClickAssignedTo?.(item.id),
        });
    }

    if (canDelete) {
        // COMMON.CARD.DELETE
        actions.push({
            text: 'Delete card',
            icon: 'icon-trash',
            event: () => onClickDelete?.(item.id),
        });
    }

    if (canModify && !isFirst) {
        // COMMON.CARD.MOVE_TO_TOP
        actions.push({
            text: 'Move to top',
            icon: 'icon-move-to-top',
            event: () => onClickMoveToTop?.(item.id),
        });
    }

    /**
     * Toggle the popover. Opening computes the anchor position from the button's
     * bounding rect, mirroring `elementPosition()`: the menu sits just under the
     * button (`rect.top + rect.height`) and is right-aligned to it
     * (`rect.right - width`). Clicking the button while open closes the menu.
     */
    const toggleOpen = (): void => {
        if (open) {
            setOpen(false);
            return;
        }

        const buttonEl = buttonRef.current;
        if (buttonEl) {
            const rect = buttonEl.getBoundingClientRect();
            setPosition({
                top: rect.top + rect.height,
                left: rect.right - POPOVER_WIDTH,
                width: POPOVER_WIDTH,
            });
        }

        setOpen(true);
    };

    return (
        <div className="card-actions">
            <button
                type="button"
                ref={buttonRef}
                // The directive added/removed `popover-open` on the button as the
                // menu opened/closed; the class tracks `open` here 1:1.
                className={open ? 'js-popup-button popover-open' : 'js-popup-button'}
                onClick={toggleOpen}
            >
                {svgIcon('icon-more-vertical', { withNameClass: true })}
            </button>

            {open
                ? createPortal(
                      // `.popover.global-popover` reuses the existing stylesheet
                      // class verbatim; only top/left/width are set inline (as
                      // globalPopover did), leaving `position` to the CSS class.
                      <div
                          className="popover global-popover"
                          ref={menuRef}
                          style={{
                              top: `${position ? position.top : 0}px`,
                              left: `${position ? position.left : 0}px`,
                              width: `${position ? position.width : POPOVER_WIDTH}px`,
                          }}
                      >
                          <ul>
                              {actions.map((action) => (
                                  <li key={action.text}>
                                      <button
                                          type="button"
                                          onClick={() => {
                                              action.event();
                                              setOpen(false);
                                          }}
                                      >
                                          {svgIcon(action.icon)}
                                          {action.text}
                                      </button>
                                  </li>
                              ))}
                          </ul>
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}
