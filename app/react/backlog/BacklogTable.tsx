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

import { createElement, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import type { Id, Project, ProjectStats, UserStory, UserStoryActions } from "./types";
import { emojify } from "../shared/emoji/emojify";
import { t } from "../shared/i18n/translate";

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

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

        let skippedInitialCheck = false;
        const observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (!entry) {
                return;
            }
            // Mirror infinite-scroll-immediate-check='false': ignore the initial
            // synchronous callback fired by observe() so we never load on mount.
            if (!skippedInitialCheck) {
                skippedInitialCheck = true;
                return;
            }
            if (entry.isIntersecting && canLoadMoreRef.current && !loadingRef.current) {
                onLoadMoreRef.current();
            }
        });
        observer.observe(node);
        return () => {
            observer.disconnect();
        };
    }, [canLoadMore]);

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
                            />
                        </Fragment>
                    );
                })}
                {/* Infinite-scroll sentinel (replaces the AngularJS infinite-scroll directive). */}
                <div ref={sentinelRef} className="infinite-scroll-sentinel" aria-hidden="true" />
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
                        <div className="custom-checkbox">
                            <input
                                type="checkbox"
                                id={`us-check-${us.ref}`}
                                checked={selected}
                                onChange={(event) =>
                                    onToggleSelection(
                                        us.ref,
                                        event.target.checked,
                                        (event.nativeEvent as MouseEvent).shiftKey,
                                    )
                                }
                            />
                            <label htmlFor={`us-check-${us.ref}`} tabIndex={0} />
                        </div>
                    </div>
                )}
            </div>

            <div className="user-stories user-story-main-data">
                <a className="user-story-link" href={`#/project/${project.slug}/us/${us.ref}`}>
                    <span className="user-story-number">#{us.ref}</span>
                    {/* XSS-safe: `subjectText` is the emojified subject as a PLAIN
                        string (shortcodes → unicode chars), rendered as React
                        auto-escaped text. NEVER use dangerouslySetInnerHTML here — the
                        AngularJS `ng-bind-html="us.subject | emojify"` HTML injection
                        is deliberately NOT reproduced ([T]). */}
                    <span className="user-story-name">{subjectText}</span>
                </a>
                {us.due_date && (
                    // Placeholder for the shared tg-due-date widget (out of scope);
                    // the `.due-date` class is preserved for SCSS fidelity.
                    <span className="due-date" />
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
                    <ul className="popover pop-status" style={{ display: "block" }}>
                        {project.us_statuses.map((usStatus) => (
                            <li key={usStatus.id}>
                                <a
                                    className="popover-status"
                                    href=""
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
                    className="us-points"
                    href=""
                    // [R] Same as us-status: this is a popover trigger, not a link.
                    role="button"
                    aria-haspopup="menu"
                    aria-expanded={pointsPopover.open}
                    aria-disabled={!canModifyUs}
                    aria-label={t("US.POINTS_LABEL", "Points: {{points}}", { points: pointsDisplay })}
                    onClick={(event) => {
                        event.preventDefault();
                        if (canModifyUs) {
                            pointsPopover.toggle();
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === " ") {
                            event.preventDefault();
                            if (canModifyUs) {
                                pointsPopover.toggle();
                            }
                        }
                    }}
                >
                    {pointsDisplay}
                </a>
                {pointsPopover.open && (
                    // [S] reveal: inline `display:block` mirrors AngularJS `fadeIn()`.
                    <ul className="popover pop-points" style={{ display: "block" }}>
                        {computableRoles.map((role) => (
                            <li key={role.id}>
                                <span className="item-text">{role.name}</span>
                                <ul>
                                    {project.points.map((point) => (
                                        <li key={point.id}>
                                            <a
                                                href=""
                                                onClick={(event) => {
                                                    event.preventDefault();
                                                    actions.onChangePoints(us, role.id, point.id);
                                                    pointsPopover.setOpen(false);
                                                }}
                                            >
                                                {point.name}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* OPTIONS popup (tg-us-edit-selector) */}
            {canModifyUs && (
                <div className="us-option" ref={optionsPopover.ref}>
                    <button
                        type="button"
                        className={
                            "us-option-popup-button js-popup-button" + (isFirst ? " first" : "")
                        }
                        // [Q] Icon-only kebab button had no accessible name — screen
                        // readers announced only "button". Routed through the shared
                        // catalog ([i18n]); US.OPTIONS_LABEL is net-new (English fallback).
                        aria-label={t("US.OPTIONS_LABEL", "User story options")}
                        aria-haspopup="menu"
                        aria-expanded={optionsPopover.open}
                        onClick={optionsPopover.toggle}
                    >
                        <Svg icon="icon-more-vertical" />
                    </button>
                    {optionsPopover.open && (
                        // `.first` on the popup hides "move to top" via SCSS
                        // (`.us-option-popup.first .move-to-top { display: none }`);
                        // we ALSO omit the action entirely for the first story.
                        <ul
                            className={"popover us-option-popup" + (isFirst ? " first" : "")}
                            // [S] reveal: inline `display:block` mirrors AngularJS `fadeIn()`.
                            style={{ display: "block" }}
                        >
                            <li>
                                <button
                                    type="button"
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
                                <li>
                                    <button
                                        type="button"
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
                                <li>
                                    <button
                                        type="button"
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

