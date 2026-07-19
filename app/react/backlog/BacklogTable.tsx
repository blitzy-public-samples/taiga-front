/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BacklogTable — the draggable backlog user-story table.
 *
 * This is a straight port of the AngularJS backlog board markup
 * (`app/partials/includes/modules/backlog-table.jade` +
 * `app/partials/includes/components/backlog-row.jade`) together with the
 * per-row interactions that used to be provided by directives:
 *
 *  - the status popover (`tgUsStatus`, `common/popovers.coffee`),
 *  - the points cell + header role selector (`tgBacklogUsPoints` /
 *    `tgUsRolePointsSelector`, `backlog/main.coffee`), and
 *  - the row options popover (`tgUsEditSelector`, `backlog/main.coffee`).
 *
 * It renders the backlog table header plus a scrolling body of draggable user
 * story rows with infinite-scroll pagination. The component is intentionally
 * PRESENTATIONAL: every mutation is delegated to handler props owned by
 * `BacklogApp` (via the {@link UserStoryActions} contract), and the
 * drag-and-drop `DndContext` is provided by an ancestor (`BacklogApp` through
 * `../shared/dnd/DndProvider`), so this file only consumes `useDraggable` /
 * `useDroppable`.
 *
 * Visual fidelity is achieved by reproducing the EXACT DOM structure and CSS
 * class names emitted by the original Jade templates so the already-compiled
 * SCSS themes the output unchanged — including the `<tg-svg>` custom-element
 * wrapper around each icon, which several SCSS rules target directly.
 */

import { createElement, Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import type { Id, Project, ProjectStats, UserStory, UserStoryActions } from "./types";
import { emojify } from "../shared/emoji/emojify";
import { t } from "../shared/i18n/translate";
import { projectUserStoryUrl } from "../shared/nav/urls";
import { Icon } from "../shared/ui/Icon";
import { dueDateColor, dueDateTitle } from "../shared/duedate/dueDate";
import type { DueDateAppearance } from "../shared/duedate/dueDate";

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * [M-21] Visually-hidden style for the native selection checkbox.
 *
 * The out-of-scope `app/styles/core/forms.scss` rule
 * `.custom-checkbox input { display: none; }` removes the real control from the
 * accessibility tree AND the keyboard tab order, leaving only an empty
 * `<label>` that a keyboard/screen-reader user cannot operate. Rather than edit
 * that shared stylesheet, we VISUALLY HIDE the native checkbox with an inline
 * style (which wins over the class rule) using the standard clip technique: it
 * stays in the a11y tree and tab order (so it is focusable and Space toggles
 * it) while occupying no visible space. `display: "block"` explicitly overrides
 * the `display: none` from the stylesheet; the label's `::after` still draws the
 * visual checkmark via the `input:not(:checked) + label::after` sibling rule,
 * which is unaffected by the input's positioning.
 */
const VISUALLY_HIDDEN_CHECKBOX: CSSProperties = {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
    display: "block",
};

/**
 * Reproduces the AngularJS `tgSvg` directive output verbatim: an inline
 * `<svg class="icon icon-...">` that references the shared SVG sprite by id,
 * wrapped in a `<tg-svg>` custom element.
 *
 * The `<tg-svg>` wrapper is NOT cosmetic — the compiled backlog SCSS targets
 * the `tg-svg` element directly to size/position icons (e.g.
 * `.draggable-us-row tg-svg svg`, `.points tg-svg`, `.us-status tg-svg`), so it
 * must be present for the icons to render at the correct size.
 *
 * `createElement` is used (instead of a literal `<tg-svg>` JSX tag) so we do
 * not have to augment the global `JSX.IntrinsicElements` interface, which would
 * risk a duplicate-declaration collision with sibling React modules that also
 * emit `tg-svg`.
 */
function Svg({ icon }: { icon: string }): JSX.Element {
    return createElement(
        "tg-svg",
        null,
        // Decorative icon: hidden from assistive tech (the surrounding control
        // carries the accessible label/text). This is invisible accessibility
        // and does not affect the class-driven SCSS theming.
        <svg className={`icon ${icon}`} aria-hidden="true" focusable="false">
            <use xlinkHref={`#${icon}`} href={`#${icon}`} />
        </svg>,
    );
}

/**
 * The shape returned by {@link usePopover}.
 */
interface PopoverController {
    /** Whether the popover is currently open. */
    open: boolean;
    /** Imperatively set the open state. */
    setOpen: (value: boolean) => void;
    /** Toggle the open state. */
    toggle: () => void;
    /**
     * Ref for the element that contains BOTH the trigger and the popover list.
     * A `mousedown` outside this element (or an Escape keypress) closes the
     * popover, mirroring the AngularJS popovers' click-outside behavior.
     */
    ref: RefObject<HTMLDivElement>;
}

/**
 * A minimal, generic popover controller shared by the header role selector and
 * each row's status / points / options popovers. Listeners are only attached
 * while the popover is open, and are torn down on close/unmount.
 */
function usePopover(): PopoverController {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        const handleMouseDown = (event: MouseEvent): void => {
            const root = ref.current;
            if (root && event.target instanceof Node && !root.contains(event.target)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                setOpen(false);
            }
        };

        document.addEventListener("mousedown", handleMouseDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleMouseDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open]);

    const toggle = useCallback((): void => {
        setOpen((previous) => !previous);
    }, []);

    return { open, setOpen, toggle, ref };
}

/**
 * The shape returned by {@link useMenuA11y}.
 */
interface MenuA11yController {
    /** Ref for the `<ul role="menu">` list element. */
    menuRef: RefObject<HTMLUListElement>;
    /** `onKeyDown` handler to spread onto the `<ul role="menu">`. */
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

/**
 * [M-21] Completes the ARIA menu pattern for a popover that advertises
 * `aria-haspopup="menu"`. Layered ON TOP of {@link usePopover} (which owns
 * open/close, click-outside, and document-level Escape), it adds the
 * keyboard/focus behavior a real menu requires:
 *
 *  - focus moves to the first `[role="menuitem"]` when the menu opens (post-
 *    paint, so the item exists and is focusable);
 *  - ArrowDown / ArrowUp move a roving focus between items (wrapping), and
 *    Home / End jump to the first / last item;
 *  - Escape closes the menu AND returns focus to the trigger (the plain
 *    document-level Escape in `usePopover` only closes it);
 *  - Tab dismisses the menu, letting focus proceed naturally.
 *
 * The item lookup is a live `querySelectorAll` so it transparently supports
 * grouped menus (e.g. the points popover's role→points grouping), where the
 * menuitems are nested inside `role="group"` sub-lists.
 */
function useMenuA11y(
    open: boolean,
    close: () => void,
    triggerRef: RefObject<HTMLElement>,
): MenuA11yController {
    const menuRef = useRef<HTMLUListElement>(null);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            const items = menuRef.current?.querySelectorAll<HTMLElement>(
                '[role="menuitem"]',
            );
            items?.[0]?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [open]);

    const onKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLElement>): void => {
            const items = Array.from(
                menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
            );
            if (items.length === 0) {
                return;
            }
            const currentIndex = items.indexOf(document.activeElement as HTMLElement);
            switch (event.key) {
                case "ArrowDown": {
                    event.preventDefault();
                    event.stopPropagation();
                    const next = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
                    items[next].focus();
                    break;
                }
                case "ArrowUp": {
                    event.preventDefault();
                    event.stopPropagation();
                    const prev = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
                    items[prev].focus();
                    break;
                }
                case "Home": {
                    event.preventDefault();
                    event.stopPropagation();
                    items[0].focus();
                    break;
                }
                case "End": {
                    event.preventDefault();
                    event.stopPropagation();
                    items[items.length - 1].focus();
                    break;
                }
                case "Escape": {
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                    triggerRef.current?.focus();
                    break;
                }
                case "Tab": {
                    // Tab dismisses the menu; focus proceeds naturally.
                    close();
                    break;
                }
                default:
                    break;
            }
        },
        [close, triggerRef],
    );

    return { menuRef, onKeyDown };
}

/* -------------------------------------------------------------------------- */
/* Doomline                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Compute the index (into the full, ordered `userstories` list) of the FIRST
 * story at which the running backlog total exceeds the project's total points —
 * i.e. the story before which the "Project Scope [Doomline]" banner is drawn.
 *
 * Faithful port of `linkDoomLine`/`reloadDoomLine`
 * (app/coffee/modules/backlog/main.coffee L727-748):
 *  - only when NOT forecasting (`!displayVelocity`) and `stats.total_points` is
 *    a non-zero number,
 *  - the running sum starts at `stats.assigned_points` (points already
 *    committed to sprints) and accumulates each story's `total_points`,
 *  - the doomline is placed before the first story whose accumulation makes the
 *    running sum strictly greater than `total_points`.
 *
 * Returns `-1` when no doomline should be drawn.
 */
export function computeDoomlineBreakIndex(
    userstories: readonly UserStory[],
    stats: ProjectStats | null,
    displayVelocity: boolean,
): number {
    if (displayVelocity || !stats) {
        return -1;
    }
    const totalPoints = stats.total_points;
    if (totalPoints == null || totalPoints === 0) {
        return -1;
    }
    let currentSum = stats.assigned_points ?? 0;
    for (let i = 0; i < userstories.length; i += 1) {
        currentSum += userstories[i].total_points ?? 0;
        if (currentSum > totalPoints) {
            return i;
        }
    }
    return -1;
}

/**
 * The doomline banner row. Reproduces the AngularJS
 * `<div class="doom-line"><span>…</span></div>` template (main.coffee L723-724)
 * so the compiled SCSS (`.backlog-table-body .doom-line`) themes it unchanged.
 * i18n: BACKLOG.DOOMLINE.
 */
function DoomLine(): JSX.Element {
    return (
        <div className="doom-line">
            <span>{t("BACKLOG.DOOMLINE", "Project Scope [Doomline]")}</span>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* Public props                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Props for {@link BacklogTable}. All state is owned by `BacklogApp`; this
 * component only renders it and reports user intent back through callbacks.
 */
export interface BacklogTableProps {
    /** The current project (permissions, roles, points, statuses). */
    project: Project;
    /** The full, unfiltered list of user stories in backlog order. */
    userstories: UserStory[];
    /**
     * The refs of the user stories that pass the current filters
     * (`visibleUserStories`). Rows are filtered to those whose `ref` is
     * included, reproducing `inArray:visibleUserStories:'ref'`.
     */
    visibleRefs: number[];
    /** When true, per-story tags are rendered. */
    showTags: boolean;
    /** When true, the body gets the `active-filters` class. */
    activeFilters: boolean;
    /** When true, the body gets the `forecasted-stories` class. */
    displayVelocity: boolean;
    /**
     * Project stats, used to place the "Project Scope [Doomline]" banner ([A]).
     * When `null` (not yet loaded) no doomline is drawn.
     */
    stats: ProjectStats | null;
    /**
     * The `us.id` of the first story in the backlog; its options popup hides the
     * "move to top" action (there is nowhere higher to move it).
     */
    firstUsInBacklog: number | null;
    /** Whether a page of user stories is currently being loaded. */
    loadingUserstories: boolean;
    /** Whether drag-and-drop reordering is enabled (disabled when archived). */
    dragEnabled: boolean;
    /** Checkbox selection state keyed by ref (stringified). */
    selectedRefs: Readonly<Record<string, boolean>>;
    /** `!disablePagination && firstLoadComplete` — gates infinite scroll. */
    canLoadMore: boolean;
    /** Infinite-scroll trigger → `BacklogApp.loadUserstories()`. */
    onLoadMore: () => void;
    /** Toggle the selection checkbox for a given ref. */
    onToggleSelection: (ref: number, checked: boolean, shiftKey: boolean) => void;
    /** User-story mutation callbacks, owned by `BacklogApp`. */
    actions: UserStoryActions;
}

/**
 * Props for the internal {@link BacklogStoryRow}. Extracted so that
 * `useDraggable` can be called once per row at the top level of a component
 * (hooks may not be called inside a `.map` callback of the parent).
 */
interface BacklogStoryRowProps {
    us: UserStory;
    project: Project;
    canModifyUs: boolean;
    canDeleteUs: boolean;
    dragEnabled: boolean;
    showTags: boolean;
    selected: boolean;
    firstUsInBacklog: number | null;
    actions: UserStoryActions;
    onToggleSelection: (ref: number, checked: boolean, shiftKey: boolean) => void;
    /** Pre-formatted points display string computed by the parent table. */
    pointsDisplay: string;
    /**
     * [BL-07] The header role filter (`activeRoleId`). When set, the points
     * popover opens directly on that role's options (mirrors the AngularJS
     * `selectedRoleId`, which tracks the header role selector); when `null`, the
     * popover opens on the compact role list.
     */
    headerRoleId: Id | null;
}

/* -------------------------------------------------------------------------- */
/* BacklogTable                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The backlog user-story table: header row + a droppable, scrolling body of
 * draggable story rows with infinite-scroll pagination.
 */
export function BacklogTable(props: BacklogTableProps): JSX.Element {
    const {
        project,
        userstories,
        visibleRefs,
        showTags,
        activeFilters,
        displayVelocity,
        stats,
        firstUsInBacklog,
        loadingUserstories,
        dragEnabled,
        selectedRefs,
        canLoadMore,
        onLoadMore,
        onToggleSelection,
        actions,
    } = props;

    // Permission gates (mirror tg-check-permission / tg-class-permission).
    const canModifyUs = project.my_permissions.includes("modify_us");
    const canDeleteUs = project.my_permissions.includes("delete_us");

    // Roles that participate in estimation (mirror _.filter(project.roles, "computable")).
    const computableRoles = useMemo(
        () => project.roles.filter((role) => role.computable),
        [project.roles],
    );

    // pointId -> point value (nullable; the special "?" point carries value: null).
    const pointValueById = useMemo(() => {
        const map: Record<number, number | null> = {};
        for (const point of project.points) {
            map[point.id] = point.value;
        }
        return map;
    }, [project.points]);

    // Header role selector state: null means "all points" (show the total).
    // This is a DISPLAY filter only — it never persists to the server.
    const [activeRoleId, setActiveRoleId] = useState<Id | null>(null);
    const rolePopover = usePopover();

    /**
     * Port of `tgBacklogUsPoints` total calculation (`estimation.coffee`
     * `calculateTotalPoints`). Prefer the server-computed `total_points`;
     * otherwise sum the computable roles' point values, ignoring nulls. Returns
     * `null` when the story is unestimated (rendered as "?").
     */
    const computeTotalPoints = useCallback(
        (us: UserStory): number | null => {
            if (us.total_points != null) {
                return us.total_points;
            }
            const values: number[] = [];
            for (const role of computableRoles) {
                const pointId = us.points[String(role.id)];
                const value = pointId == null ? undefined : pointValueById[pointId];
                if (value != null) {
                    values.push(value);
                }
            }
            if (values.length === 0) {
                return null;
            }
            return values.reduce((total, value) => total + value, 0);
        },
        [computableRoles, pointValueById],
    );

    // Format a nullable points value; unestimated → "?" (mirrors calculateTotalPoints).
    const formatPoints = (value: number | null | undefined): string =>
        value == null ? "?" : String(value);

    // Rows visible after filtering (mirror `inArray:visibleUserStories:'ref'`).
    const rows = useMemo(
        () => userstories.filter((us) => visibleRefs.includes(us.ref)),
        [userstories, visibleRefs],
    );

    // [A] Doomline placement: compute the break index against the FULL ordered
    // list (as the AngularJS directive did), then resolve it to the id of the
    // first VISIBLE row at or after that index, so the banner lands correctly
    // even when filters hide some rows.
    const doomBeforeRowId = useMemo<Id | null>(() => {
        const breakIndex = computeDoomlineBreakIndex(userstories, stats, displayVelocity);
        if (breakIndex < 0) {
            return null;
        }
        const fullIndexById = new Map<Id, number>();
        userstories.forEach((us, index) => fullIndexById.set(us.id, index));
        for (const row of rows) {
            const fullIndex = fullIndexById.get(row.id);
            if (fullIndex !== undefined && fullIndex >= breakIndex) {
                return row.id;
            }
        }
        return null;
    }, [userstories, rows, stats, displayVelocity]);

    // Backlog drop target; rows carry data-id so BacklogApp's resolveDrop can
    // read the resulting DOM order after a drop.
    const { setNodeRef: setBacklogDroppableRef } = useDroppable({ id: "backlog" });

    // ---- Infinite scroll (replaces the AngularJS infinite-scroll directive) ----
    const sentinelRef = useRef<HTMLDivElement>(null);
    // Keep the latest values in refs so the observer never needs to be
    // re-subscribed on every render (only when `canLoadMore` flips).
    const onLoadMoreRef = useRef(onLoadMore);
    const canLoadMoreRef = useRef(canLoadMore);
    const loadingRef = useRef(loadingUserstories);
    onLoadMoreRef.current = onLoadMore;
    canLoadMoreRef.current = canLoadMore;
    loadingRef.current = loadingUserstories;

    useEffect(() => {
        const node = sentinelRef.current;
        // jsdom (unit tests) has no IntersectionObserver; guard so the component
        // renders without requiring a global mock.
        if (!node || typeof IntersectionObserver === "undefined") {
            return;
        }
        // Only observe once pagination is enabled (post first load), mirroring
        // infinite-scroll-disabled="disablePagination || !firstLoadComplete".
        if (!canLoadMore) {
            return;
        }

        // A generous rootMargin makes the sentinel trigger *before* it is fully
        // scrolled into view. Without it, a zero-height sentinel sitting exactly
        // at the viewport's bottom edge (top === innerHeight) never registers as
        // intersecting, so onLoadMore is never called and the list stays capped
        // at the first page. Re-running the effect whenever the number of
        // rendered rows changes (see the dependency array) re-evaluates the
        // observer after every append: this both handles the "sentinel keeps
        // intersecting after a load" case (IntersectionObserver does not fire
        // again while continuously intersecting) and lets a short first page
        // chain-load until the viewport is filled. The `loadingRef`/
        // `canLoadMoreRef` guards keep this bounded to one in-flight request per
        // page and stop it once the last page arrives. Combined with the
        // non-zero sentinel height below, page 2+ reliably loads on scroll.
        // [F-BACKLOG-INFINITE-SCROLL]
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (!entry) {
                    return;
                }
                if (entry.isIntersecting && canLoadMoreRef.current && !loadingRef.current) {
                    onLoadMoreRef.current();
                }
            },
            { rootMargin: "200px 0px" },
        );
        observer.observe(node);
        return () => {
            observer.disconnect();
        };
    }, [canLoadMore, rows.length]);

    const bodyClassName =
        "backlog-table-body" +
        (showTags ? " show-tags" : "") +
        (activeFilters ? " active-filters" : "") +
        (displayVelocity ? " forecasted-stories" : "");

    return (
        <>
            {/* BACKLOG TABLE HEADER — ported from backlog-table.jade */}
            <div className="backlog-table-header">
                <div className="row backlog-table-title">
                    {canModifyUs && <div className="draggable-us-column" />}
                    {canModifyUs && <div className="input" />}
                    <div className="user-stories">{t("BACKLOG.TABLE.COLUMN_US", "User Story")}</div>
                    <div className="status">{t("COMMON.FIELDS.STATUS", "Status")}</div>
                    <div
                        className="points"
                        title={t("BACKLOG.TABLE.TITLE_COLUMN_POINTS", "Select view per Role")}
                        ref={rolePopover.ref}
                    >
                        <div
                            className="inner"
                            role="button"
                            tabIndex={0}
                            onClick={rolePopover.toggle}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    rolePopover.toggle();
                                }
                            }}
                        >
                            <span className="header-points">{t("COMMON.FIELDS.POINTS", "Points")}</span>
                            <Svg icon="icon-filter" />
                        </div>
                        {rolePopover.open && (
                            // [S] reveal: the `.popover` SCSS mixin sets `display:none`
                            // as the base and provides NO `.active`/`.open` rule that
                            // flips it back. The AngularJS popovers were revealed by
                            // jQuery `fadeIn()`, which writes an inline `display:block`.
                            // We reproduce that inline style so the compiled CSS renders
                            // the list visible (jsdom cannot compute this; verified in a
                            // real browser against theme-taiga.css).
                            <ul className="popover pop-role" style={{ display: "block" }}>
                                <li>
                                    <a
                                        className={
                                            "clear-selection" +
                                            (activeRoleId == null ? " active-popover" : "")
                                        }
                                        href=""
                                        onClick={(event) => {
                                            event.preventDefault();
                                            setActiveRoleId(null);
                                            rolePopover.setOpen(false);
                                        }}
                                    >
                                        {t("COMMON.ROLES.ALL", "All points")}
                                    </a>
                                </li>
                                {computableRoles.map((role) => (
                                    <li key={role.id}>
                                        <a
                                            className="role"
                                            href=""
                                            data-role-id={role.id}
                                            title={role.name}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                setActiveRoleId(role.id);
                                                rolePopover.setOpen(false);
                                            }}
                                        >
                                            <span className="item-text">{role.name}</span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className="us-header-options" />
                </div>
            </div>

            {/* BACKLOG TABLE BODY — the "backlog" drop target */}
            <div ref={setBacklogDroppableRef} className={bodyClassName}>
                {rows.map((us) => {
                    // Points cell display: the active role's value, or the total
                    // across all computable roles when "all points" is selected.
                    const roleValue =
                        activeRoleId == null
                            ? undefined
                            : pointValueById[us.points[String(activeRoleId)]];
                    const pointsDisplay =
                        activeRoleId == null
                            ? formatPoints(computeTotalPoints(us))
                            : formatPoints(roleValue);
                    return (
                        <Fragment key={us.ref}>
                            {/* [A] Doomline banner drawn immediately BEFORE the story
                                where the cumulative backlog scope exceeds the project
                                total points. */}
                            {doomBeforeRowId === us.id && <DoomLine />}
                            <BacklogStoryRow
                                us={us}
                                project={project}
                                canModifyUs={canModifyUs}
                                canDeleteUs={canDeleteUs}
                                dragEnabled={dragEnabled}
                                showTags={showTags}
                                selected={Boolean(selectedRefs[String(us.ref)])}
                                firstUsInBacklog={firstUsInBacklog}
                                actions={actions}
                                onToggleSelection={onToggleSelection}
                                pointsDisplay={pointsDisplay}
                                headerRoleId={activeRoleId}
                            />
                        </Fragment>
                    );
                })}
                {/* Infinite-scroll sentinel (replaces the AngularJS infinite-scroll directive).
                    A non-zero height plus the observer's rootMargin ensures it reliably
                    intersects the viewport near the bottom of the list so the next page
                    loads as the user scrolls (Issue 1). */}
                <div
                    ref={sentinelRef}
                    className="infinite-scroll-sentinel"
                    aria-hidden="true"
                    // A non-zero height gives the sentinel a real layout box the
                    // IntersectionObserver can intersect. The compiled stylesheet
                    // declares no rule for `.infinite-scroll-sentinel`, so without
                    // this inline height the element collapses to 0px and the
                    // observer never fires — page 2 would never load on scroll.
                    // [F-BACKLOG-INFINITE-SCROLL]
                    style={{ height: 1 }}
                />
                {/* tg-loading="loadingUserstories" */}
                {loadingUserstories && <div className="loading-spinner" />}
            </div>
        </>
    );
}


/* -------------------------------------------------------------------------- */
/* BacklogStoryRow                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A single draggable backlog row, ported from `backlog-row.jade`. Manages its
 * own status / points / options popovers; every mutation is delegated to the
 * {@link UserStoryActions} callbacks.
 */
function BacklogStoryRow({
    us,
    project,
    canModifyUs,
    canDeleteUs,
    dragEnabled,
    showTags,
    selected,
    firstUsInBacklog,
    actions,
    onToggleSelection,
    pointsDisplay,
    headerRoleId,
}: BacklogStoryRowProps): JSX.Element {
    // The whole row is the draggable node; the .draggable-us-row handle carries
    // the activator listeners. useDraggable MUST be called unconditionally.
    const { attributes, listeners, setNodeRef } = useDraggable({ id: us.id });
    // [N] The row is ALSO a droppable (same numeric id) so a drop — pointer or
    // keyboard — can land at THIS row's position (single-step keyboard reorder).
    const { setNodeRef: setRowDroppableRef } = useDroppable({ id: us.id });
    // Merge the draggable + droppable node refs onto the single row element.
    const setRowRef = useCallback(
        (node: HTMLElement | null): void => {
            setNodeRef(node);
            setRowDroppableRef(node);
        },
        [setNodeRef, setRowDroppableRef],
    );

    const statusPopover = usePopover();
    const pointsPopover = usePopover();
    const optionsPopover = usePopover();

    // [M-21] Trigger refs so Escape can return focus to the control that opened
    // each menu, and the ARIA-menu keyboard controllers for the three popovers
    // that advertise `aria-haspopup="menu"`. `rowMenuIds` gives this row's menus
    // instance-unique ids for the triggers' `aria-controls`.
    const rowMenuIds = useId();
    const statusTriggerRef = useRef<HTMLAnchorElement>(null);
    const pointsTriggerRef = useRef<HTMLAnchorElement>(null);
    const optionsTriggerRef = useRef<HTMLButtonElement>(null);
    const statusMenu = useMenuA11y(
        statusPopover.open,
        () => statusPopover.setOpen(false),
        statusTriggerRef,
    );
    const pointsMenu = useMenuA11y(
        pointsPopover.open,
        () => pointsPopover.setOpen(false),
        pointsTriggerRef,
    );
    const optionsMenu = useMenuA11y(
        optionsPopover.open,
        () => optionsPopover.setOpen(false),
        optionsTriggerRef,
    );

    // Status name/color (mirror usStatusById[us.status]).
    const status = project.us_statuses.find((candidate) => candidate.id === us.status);
    const statusName = status ? status.name : "";
    const statusColor = status ? status.color : undefined;

    const isFirst = us.id === firstUsInBacklog;

    // [T] Emoji parity: the AngularJS row rendered `us.subject | emojify`
    // (backlog-row.jade:39) via `ng-bind-html`. We instead run a SAFE, non-HTML
    // transform that swaps `:shortcode:` for the unicode emoji CHARACTER and
    // render the result as plain, auto-escaped React text (no
    // dangerouslySetInnerHTML) — restoring emoji rendering without reopening the
    // XSS surface. When `window.emojis` is unavailable this is a no-op.
    const subjectText = emojify(us.subject);

    // Computable roles for the points popover (mirror _.filter(roles, "computable")).
    const computableRoles = project.roles.filter((role) => role.computable);

    // [BL-07] Two-step points popover state, faithfully porting `tgBacklogUsPoints`
    // (backlog/main.coffee) + `EstimationProcess` (common/estimation.coffee).
    //
    // The AngularJS popover was NEVER "all roles expanded". It rendered in two
    // stages:
    //   1. `.pop-role`  — a COMPACT list of the computable roles, each shown as
    //      "<RoleName> (<currentPoint>)" (`us-points-roles-popover.jade`).
    //   2. `.pop-points-open` — after a role is picked, the point options for THAT
    //      role only (`us-estimation-points.jade`).
    // `pointsRoleId === null` renders stage 1; a role id renders stage 2. When a
    // project has a single computable role the directive preselects it
    // (`roles.length == 1` branch), so we jump straight to stage 2 on open.
    const [pointsRoleId, setPointsRoleId] = useState<Id | null>(null);

    // pointId -> point NAME (e.g. "13", "½", "?"). The role list shows the point
    // NAME next to each role (estimation.coffee `calculateRoles` sets
    // `role.points = pointObj.name`), which is distinct from the numeric value.
    const pointNameById = useMemo(() => {
        const map: Record<string, string> = {};
        for (const point of project.points) {
            map[String(point.id)] = point.name;
        }
        return map;
    }, [project.points]);

    // [BL-07] `horizontal` flag mirrors estimation.coffee `renderPointsSelector`:
    // `_.some(points, (p) => p.name.length > 5)` adds the `.horizontal` class.
    const pointsHorizontal = useMemo(
        () => project.points.some((point) => point.name.length > 5),
        [project.points],
    );

    // [BL-07] Open/toggle the points popover, reproducing the directive's
    // preselect-when-single-role behavior: opening resets to the role list unless
    // there is exactly one computable role (then jump straight to its points).
    // The trigger is inert when there are no computable roles (the directive adds
    // `.not-clickable` and drops the arrow in the `roles.length == 0` branch).
    const openOrTogglePoints = useCallback((): void => {
        if (!canModifyUs || computableRoles.length === 0) {
            return;
        }
        if (!pointsPopover.open) {
            // Single computable role → preselect it (directive `roles.length == 1`
            // branch). Otherwise honor the header role filter (`selectedRoleId`):
            // when a role is filtered in the header, jump straight to its points;
            // when none is (null), open the compact role list.
            setPointsRoleId(
                computableRoles.length === 1 ? computableRoles[0].id : headerRoleId,
            );
        }
        pointsPopover.toggle();
    }, [canModifyUs, computableRoles, pointsPopover, headerRoleId]);

    // [M-08] Project-level due-date threshold configuration (`us_duedates`),
    // falling back to the service defaults when the project doesn't define one
    // (mirrors `DueDateService.getStatus`, which reads `project["us_duedates"]`).
    const dueDateConfig = Array.isArray(project.us_duedates)
        ? (project.us_duedates as DueDateAppearance[])
        : undefined;

    const rowClassName =
        "row us-item-row" +
        (us.is_blocked ? " blocked" : "") +
        (us.new ? " new" : "") +
        (!canModifyUs ? " readonly" : "");

    return (
        <div ref={setRowRef} data-id={us.id} className={rowClassName}>
            <div className="us-item-row-left">
                {canModifyUs && (
                    // Drag activator: spread @dnd-kit attributes/listeners only when
                    // drag is enabled; the row node itself is always registered via
                    // setNodeRef so `data-id` ordering is preserved.
                    <div
                        className="draggable-us-row"
                        {...(dragEnabled ? attributes : {})}
                        {...(dragEnabled ? listeners : {})}
                        // [P] Accessible name for the draggable handle. @dnd-kit's
                        // `attributes` give it `role="button"` +
                        // `aria-roledescription="draggable"` but NO name; without a
                        // name screen readers announce only "button". Placed AFTER
                        // the spreads so it always wins. Routed through the shared
                        // catalog ([i18n]); US.DRAG_BUTTON_LABEL is net-new so the
                        // template fallback below is interpolated locally.
                        aria-label={t("US.DRAG_BUTTON_LABEL", "Reorder user story #{{ref}} {{subject}}", {
                            ref: us.ref,
                            subject: subjectText,
                        })}
                    >
                        <Svg icon="icon-draggable" />
                    </div>
                )}
                {canModifyUs && (
                    <div className="input">
                        <div
                            className="custom-checkbox"
                            // [shift-range parity] The selection checkbox is
                            // VISUALLY HIDDEN, so a real pointer click lands on the
                            // adjacent <label>. Browsers do NOT forward a
                            // Shift+click on a <label> to its associated control —
                            // the input's `change` event never fires — which made
                            // the shift-range-select (setSelection's inclusive
                            // range, unit-tested in useBacklogState) unreachable by
                            // mouse. Handle that one gesture here, where the click
                            // reliably lands: when Shift is held on a <label> click,
                            // suppress the (already dropped) default forwarding and
                            // drive the SAME selection API with the toggled state.
                            // Non-shift clicks forward normally and are handled by
                            // the input's `onChange`; direct/keyboard input clicks
                            // have target=INPUT and are ignored here — so this
                            // handler fires exactly once per gesture and never
                            // double-toggles.
                            onClick={(event) => {
                                const target = event.target as HTMLElement;
                                if (event.shiftKey && target.tagName === "LABEL") {
                                    event.preventDefault();
                                    onToggleSelection(us.ref, !selected, true);
                                }
                            }}
                        >
                            {/* [M-21] The native checkbox is the real, keyboard-
                                operable control: visually hidden (not `display:none`)
                                so it stays focusable and in the a11y tree, and given
                                an explicit accessible name. The `<label>` keeps its
                                `htmlFor` link (so a pointer click on the visual box
                                still toggles selection and its `::after` draws the
                                check state) but no longer carries `tabIndex` — the
                                input, not the empty label, is now the focus target. */}
                            <input
                                type="checkbox"
                                id={`us-check-${us.ref}`}
                                checked={selected}
                                style={VISUALLY_HIDDEN_CHECKBOX}
                                aria-label={t(
                                    "US.SELECT",
                                    "Select user story #{{ref}} {{subject}}",
                                    { ref: us.ref, subject: subjectText },
                                )}
                                onChange={(event) => {
                                    // Non-shift label clicks forward here and
                                    // keyboard Space fires a change too; read the
                                    // event's own shiftKey for the direct-input and
                                    // keyboard cases. Shift+label clicks never reach
                                    // this handler (browsers drop that forwarding)
                                    // and are handled by the container's onClick.
                                    onToggleSelection(
                                        us.ref,
                                        event.target.checked,
                                        (event.nativeEvent as MouseEvent).shiftKey,
                                    );
                                }}
                            />
                            <label htmlFor={`us-check-${us.ref}`} aria-hidden="true" />
                        </div>
                    </div>
                )}
            </div>

            <div className="user-stories user-story-main-data">
                {/* [M-07] baseHref-aware HTML5 route (NOT a `#`-fragment): the
                    legacy `tg-nav="project-userstories-detail"` resolved to a
                    real navigation under HTML5 mode. `projectUserStoryUrl`
                    reproduces the exact `$navUrls` template + baseHref prefix. */}
                <a className="user-story-link" href={projectUserStoryUrl(project.slug, us.ref)}>
                    <span className="user-story-number">#{us.ref}</span>
                    {/* XSS-safe: `subjectText` is the emojified subject as a PLAIN
                        string (shortcodes → unicode chars), rendered as React
                        auto-escaped text. NEVER use dangerouslySetInnerHTML here — the
                        AngularJS `ng-bind-html="us.subject | emojify"` HTML injection
                        is deliberately NOT reproduced ([T]). */}
                    <span className="user-story-name">{subjectText}</span>
                </a>
                {us.due_date && (
                    // [M-08] Due-date parity — reproduces the legacy
                    // `tg-due-date.due-date` (icon-only variant, `due-date-icon.jade`):
                    // an `icon-clock` whose fill is the severity color and whose
                    // tooltip is the formatted date + status name. `.due-date`
                    // (wrapper) and `.due-date-icon` (icon) class names match the
                    // compiled SCSS (backlog-table.scss L369-375) so it themes
                    // unchanged. Color/title come from the shared due-date helpers
                    // (extracted from the working Kanban card).
                    <span className="due-date">
                        <Icon
                            name="icon-clock"
                            wrapperClass="due-date-icon"
                            fill={dueDateColor(us.due_date, dueDateConfig) ?? undefined}
                            title={t("COMMON.CARD.DUE_DATE", "Due date: {{date}}", {
                                date: dueDateTitle(us.due_date, dueDateConfig),
                            })}
                        />
                    </span>
                )}
                {showTags &&
                    us.tags &&
                    us.tags.map((tag, index, tags) => (
                        <div
                            key={index}
                            className={"tag" + (index === tags.length - 1 ? " last" : "")}
                            title={tag[0]}
                            style={{ background: tag[1] ?? undefined }}
                        >
                            {tag[0]}
                        </div>
                    ))}
                {us.epics &&
                    us.epics.map((epic) => (
                        <div
                            key={epic.ref}
                            className="belong-to-epic-pill"
                            style={{ background: epic.color }}
                            title={`#${epic.ref} ${epic.subject}`}
                        />
                    ))}
            </div>

            {/* STATUS cell + popover (tg-us-status) */}
            <div className="status" ref={statusPopover.ref}>
                <a
                    ref={statusTriggerRef}
                    className="us-status"
                    href=""
                    title={statusName}
                    // [R] The legacy markup was a bare `<a href="">` that behaves as
                    // a menu trigger, not a navigational link. Expose the correct
                    // semantics: `role="button"` + popover state so assistive tech
                    // announces it as an (expandable) control. `aria-disabled`
                    // reflects the read-only (no modify_us) case.
                    role="button"
                    aria-haspopup="menu"
                    aria-expanded={statusPopover.open}
                    aria-controls={statusPopover.open ? `${rowMenuIds}-status` : undefined}
                    aria-disabled={!canModifyUs}
                    onClick={(event) => {
                        event.preventDefault();
                        if (canModifyUs) {
                            statusPopover.toggle();
                        }
                    }}
                    onKeyDown={(event) => {
                        // Anchors already activate on Enter; add Space for button parity.
                        if (event.key === " ") {
                            event.preventDefault();
                            if (canModifyUs) {
                                statusPopover.toggle();
                            }
                        }
                    }}
                >
                    <span className="us-status-bind" style={{ color: statusColor }}>
                        {statusName}
                    </span>
                    {canModifyUs && <Svg icon="icon-arrow-down" />}
                </a>
                {statusPopover.open && (
                    // [S] reveal: inline `display:block` mirrors the AngularJS
                    // jQuery `fadeIn()` (the `.popover` mixin's base is `display:none`
                    // with no class-based reveal in the compiled CSS).
                    // [BL-06] `textAlign:left`: the `.pop-status` popover is nested
                    // inside the `.status` cell which is `text-align:right`, and the
                    // backlog `.pop-status` mixin call omits `$align` so it compiles to
                    // the ignored `text-align:""` and inherits the cell's right
                    // alignment. The AngularJS baseline renders the option list
                    // left-aligned, so we restore left alignment here (a structural
                    // layout override, not a theme value).
                    <ul
                        className="popover pop-status"
                        style={{ display: "block", textAlign: "left" }}
                        id={`${rowMenuIds}-status`}
                        ref={statusMenu.menuRef}
                        role="menu"
                        aria-label={statusName || t("COMMON.FIELDS.STATUS", "Status")}
                        onKeyDown={statusMenu.onKeyDown}
                    >
                        {project.us_statuses.map((usStatus) => (
                            <li key={usStatus.id} role="none">
                                <a
                                    className="popover-status"
                                    href=""
                                    role="menuitem"
                                    tabIndex={-1}
                                    data-status-id={usStatus.id}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        actions.onChangeStatus(us, usStatus.id);
                                        statusPopover.setOpen(false);
                                    }}
                                >
                                    {usStatus.name}
                                </a>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* POINTS cell + popover (tg-backlog-us-points) */}
            <div className="points" ref={pointsPopover.ref}>
                <a
                    ref={pointsTriggerRef}
                    className="us-points"
                    href=""
                    // [R] Same as us-status: this is a popover trigger, not a link.
                    role="button"
                    aria-haspopup="menu"
                    aria-expanded={pointsPopover.open}
                    aria-controls={pointsPopover.open ? `${rowMenuIds}-points` : undefined}
                    aria-disabled={!canModifyUs}
                    aria-label={t("US.POINTS_LABEL", "Points: {{points}}", { points: pointsDisplay })}
                    onClick={(event) => {
                        event.preventDefault();
                        // [BL-07] Route through the two-step opener so the popover
                        // starts on the compact role list (or the single role's
                        // points) instead of rendering every role expanded.
                        openOrTogglePoints();
                    }}
                    onKeyDown={(event) => {
                        if (event.key === " ") {
                            event.preventDefault();
                            openOrTogglePoints();
                        }
                    }}
                >
                    {pointsDisplay}
                </a>
                {pointsPopover.open && pointsRoleId == null && (
                    // [BL-07] STAGE 1 — compact role list (`.pop-role`,
                    // `us-points-roles-popover.jade`). Each computable role is one
                    // line "<RoleName> (<currentPoint>)". Picking a role advances to
                    // stage 2. Inline `display:block` mirrors AngularJS `fadeIn()`
                    // (the `.popover` mixin's base is `display:none`).
                    <ul
                        className="popover pop-role"
                        style={{ display: "block" }}
                        id={`${rowMenuIds}-points`}
                        ref={pointsMenu.menuRef}
                        role="menu"
                        aria-label={t("COMMON.FIELDS.POINTS", "Points")}
                        onKeyDown={pointsMenu.onKeyDown}
                    >
                        {computableRoles.map((role) => {
                            const currentPointId = us.points[String(role.id)];
                            // estimation.coffee `calculateRoles`: role.points =
                            // pointObj.name ?? "?".
                            const currentPointName =
                                currentPointId != null &&
                                pointNameById[String(currentPointId)] != null
                                    ? pointNameById[String(currentPointId)]
                                    : "?";
                            return (
                                <li key={role.id} role="none">
                                    <a
                                        className="role"
                                        href=""
                                        role="menuitem"
                                        tabIndex={-1}
                                        data-role-id={role.id}
                                        title={role.name}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            // Advance to this role's point options
                                            // (renderPointsSelector(roleId)).
                                            setPointsRoleId(role.id);
                                        }}
                                    >
                                        <span className="item-text">
                                            {role.name} ({currentPointName})
                                        </span>
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {pointsPopover.open && pointsRoleId != null && (
                    // [BL-07] STAGE 2 — the selected role's point options
                    // (`.pop-points-open`, `us-estimation-points.jade`). The
                    // CURRENTLY-selected point carries `.point.active` (SCSS
                    // highlights it via `a.active`); every other option is plain
                    // `.point`. This mirrors estimation.coffee's `point.selected`
                    // inversion: `selected = (us.points[roleId] == point.id) ? false
                    // : true`, and jade rendering `selected ? "point" : "point
                    // active"`.
                    <ul
                        className={"popover pop-points-open" + (pointsHorizontal ? " horizontal" : "")}
                        style={{ display: "block" }}
                        id={`${rowMenuIds}-points`}
                        ref={pointsMenu.menuRef}
                        role="menu"
                        aria-label={t("COMMON.FIELDS.POINTS", "Points")}
                        onKeyDown={pointsMenu.onKeyDown}
                    >
                        {project.points.map((point) => {
                            const isCurrent = us.points[String(pointsRoleId)] === point.id;
                            return (
                                <li key={point.id} role="none">
                                    <a
                                        href=""
                                        className={"point" + (isCurrent ? " active" : "")}
                                        role="menuitem"
                                        tabIndex={-1}
                                        data-point-id={point.id}
                                        data-role-id={pointsRoleId}
                                        title={point.name}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            actions.onChangePoints(us, pointsRoleId, point.id);
                                            pointsPopover.setOpen(false);
                                        }}
                                    >
                                        <span className="item-text">{point.name}</span>
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* OPTIONS popup (tg-us-edit-selector) */}
            {canModifyUs && (
                <div className="us-option" ref={optionsPopover.ref}>
                    <button
                        type="button"
                        ref={optionsTriggerRef}
                        className={
                            "us-option-popup-button js-popup-button" + (isFirst ? " first" : "")
                        }
                        // [Q] Icon-only kebab button had no accessible name — screen
                        // readers announced only "button". Routed through the shared
                        // catalog ([i18n]); US.OPTIONS_LABEL is net-new (English fallback).
                        aria-label={t("US.OPTIONS_LABEL", "User story options")}
                        aria-haspopup="menu"
                        aria-expanded={optionsPopover.open}
                        aria-controls={optionsPopover.open ? `${rowMenuIds}-options` : undefined}
                        onClick={optionsPopover.toggle}
                    >
                        <Svg icon="icon-more-vertical" />
                    </button>
                    {optionsPopover.open && (
                        // `.first` on the popup hides "move to top" via SCSS
                        // (`.us-option-popup.first .move-to-top { display: none }`);
                        // we ALSO omit the action entirely for the first story.
                        <ul
                            id={`${rowMenuIds}-options`}
                            ref={optionsMenu.menuRef}
                            // [Q][M-21] The trigger claims `aria-haspopup="menu"`, so the
                            // popup must expose a real menu: `role="menu"` + `role="menuitem"`
                            // children, focus-on-open, roving arrow keys, Escape/Tab close
                            // (all via the shared `useMenuA11y` controller).
                            role="menu"
                            aria-label={t("US.OPTIONS_LABEL", "User story options")}
                            onKeyDown={optionsMenu.onKeyDown}
                            className={"popover us-option-popup" + (isFirst ? " first" : "")}
                            // [S] reveal: inline `display:block` mirrors AngularJS `fadeIn()`.
                            style={{ display: "block" }}
                        >
                            <li role="none">
                                <button
                                    type="button"
                                    role="menuitem"
                                    tabIndex={-1}
                                    className="e2e-edit edit-story"
                                    onClick={() => {
                                        actions.onEditUserStory(us);
                                        optionsPopover.setOpen(false);
                                    }}
                                >
                                    <Svg icon="icon-edit" />
                                    <span>{t("COMMON.EDIT", "Edit")}</span>
                                </button>
                            </li>
                            {canDeleteUs && (
                                <li role="none">
                                    <button
                                        type="button"
                                        role="menuitem"
                                        tabIndex={-1}
                                        className="e2e-delete"
                                        onClick={() => {
                                            actions.onDeleteUserStory(us);
                                            optionsPopover.setOpen(false);
                                        }}
                                    >
                                        <Svg icon="icon-trash" />
                                        <span>{t("COMMON.DELETE", "Delete")}</span>
                                    </button>
                                </li>
                            )}
                            {!isFirst && (
                                <li role="none">
                                    <button
                                        type="button"
                                        role="menuitem"
                                        tabIndex={-1}
                                        className="e2e-edit move-to-top"
                                        onClick={() => {
                                            actions.onMoveToTop(us);
                                            optionsPopover.setOpen(false);
                                        }}
                                    >
                                        <Svg icon="icon-move-to-top" />
                                        <span>{t("COMMON.MOVE_TO_TOP", "Move to top")}</span>
                                    </button>
                                </li>
                            )}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

