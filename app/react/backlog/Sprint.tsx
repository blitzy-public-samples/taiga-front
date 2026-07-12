/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Sprint.tsx
 * ----------
 * React 18.2 + TypeScript reproduction of the content of ONE sprint card in the
 * Backlog sidebar — the DOM the AngularJS `tg-sprint` directive rendered through
 * `app/partials/backlog/sprint.jade` (compiled to `sprint.html`).
 *
 * This is a presentational, DOM-preserving leaf component consumed by
 * `./SprintList.tsx`. It emits the exact element tree, class names and `data-*`
 * attributes that the (unchanged) Taiga SCSS
 * (`app/styles/modules/backlog/sprints.scss`) targets, so the migrated React
 * screen is styled pixel-identically without editing any stylesheet. No
 * behavior, endpoint, styling or authorization change is introduced
 * (AAP §0.7.1 — DOM/visual parity + honor backend authorization).
 *
 * IMPORTANT — the wrapper is NOT emitted here: the `<div class="sprint
 * sprint-open">` / `sprint-closed` wrapper (which carried the legacy
 * `tg-backlog-sprint="sprint"` attribute) is emitted by `./SprintList.tsx`.
 * This component renders only the wrapper's CHILDREN, so it returns a Fragment
 * whose top-level children are, in order: the header, the progress-bar wrapper,
 * the `.sprint-table` (story list or empty-drop placeholder), and the taskboard
 * link.
 *
 * Source lineage (reference-only AngularJS originals this reproduces; never edited):
 *   - app/partials/backlog/sprint.jade                       -> the element tree below.
 *   - app/coffee/modules/backlog/sprints.coffee (L18-59)     -> BacklogSprintDirective:
 *       OPEN sprints render expanded (`.sprint-table.open` + `.compact-sprint.active`),
 *       CLOSED sprints render collapsed (the `.sprint-closed` wrapper is owned by
 *       SprintList); the `.compact-sprint` click folds the table (jQuery
 *       `slideToggle`) and the `.edit-sprint` click broadcasts `sprintform:edit`.
 *       Here the fold is local `expanded` state and the edit is the `onEditSprint`
 *       callback (both surfaced through `./SprintHeader.tsx`).
 *   - app/coffee/modules/common/components.coffee (L433-452) -> TgProgressBarDirective:
 *       `_.max([0, pct])` then `_.min([100, pct])` clamp; reproduced as
 *       `Math.min(100, Math.max(0, rawPct))` with a `total === 0` divide-by-zero guard.
 *   - app/partials/common/components/progress-bar.jade       -> the `.current-progress`
 *       element whose inline `width: <pct>%` drives the bar fill.
 *   - app/coffee/modules/base/bind.coffee (BindOnceRefDirective, L28-32) ->
 *       `$el.html("##{val} ")`, i.e. the `.us-ref-text` node renders `#<ref> `
 *       (hash + value + a single trailing space); `tg-bo-title` sets the anchor
 *       `title`, and `tg-bo-bind` sets the `.points-container` text.
 *
 * Migration notes (technology-specific changes vs. the AngularJS original):
 *   - Jade template -> JSX; CoffeeScript directive DOM manipulation -> declarative
 *     React state + conditional rendering.
 *   - AngularJS `ng-if` / `ng-class` / `tg-class-permission` / `tg-check-permission`
 *     -> React conditional rendering, computed `className`, and permission-gated
 *     rendering driven by `project.my_permissions` (`modify_us`, `view_milestones`).
 *     There is NO parallel authorization: these flags only decide which controls
 *     render; the backend remains the single enforcement point (AAP §0.6.4).
 *   - The legacy `tg-bind-html="us.subject | emojify"` becomes a plain, ESCAPED
 *     React text node (no `dangerouslySetInnerHTML`) preserving XSS-safety
 *     (AAP §0.6.4). The only user-supplied values rendered are `us.subject`,
 *     `us.ref` and `sprint.name`, all through React's default text nodes.
 *   - The shared widgets the legacy row embedded as custom elements
 *     (`tg-belong-to-epics`, `tg-due-date`) are reproduced as their rendered DOM
 *     (`.us-epic-container` / `.belong-to-epic-pill`, `.due-date`) rather than
 *     imported from `app/modules/components/**` (AAP §0.6.5 — no ngUpgrade bridge).
 *   - Visible copy uses the resolved English values from
 *     `app/locales/taiga/locale-en.json` ("This sprint has no user stories",
 *     "Drop here Stories from your backlog to start a new sprint",
 *     "Sprint Taskboard") so the rendered output matches the AngularJS `translate`
 *     output exactly (there is no React i18n runtime in scope for this POC).
 *
 * @dnd-kit interop: `./Backlog.tsx` owns the `DndContext`. It may make each sprint
 * a droppable (a US dropped onto the `.sprint-table` is moved into the sprint) and
 * each story row a sortable item. That wiring is passed down through the OPTIONAL
 * `dropRef` / `isOver` / `getStoryRowProps` props; when absent (e.g. in unit
 * tests) the component renders plainly with no drag behavior.
 */

import { useState } from "react";
import type { CSSProperties } from "react";
import type { Milestone, Project, UserStory } from "../shared/types";
import { SprintHeader } from "./SprintHeader";

/**
 * `@dnd-kit` sortable wiring for a single story row, supplied per-story by the
 * `DndContext` owner (`./Backlog.tsx`) via {@link SprintProps.getStoryRowProps}.
 * Every member is optional so a row also renders standalone (unit tests) with no
 * drag behavior. Applied EXACTLY as documented per member:
 *   - `setNodeRef` -> the ROW ROOT (`.row.milestone-us-item-row`); there is NO
 *     intermediate wrapper node, so the sortable node IS the styled row.
 *   - `style` -> the row root (dnd transform / transition).
 *   - `isDragging` -> toggles the `dragging` modifier class on the row root.
 *   - `attributes` + `listeners` -> spread on the row root (drag activation),
 *     matching the legacy dragula "drag the whole row" semantics of
 *     `app/coffee/modules/backlog/sortable.coffee`.
 */
export interface StoryRowDndProps {
    /** Applied to the ROW ROOT (`.row.milestone-us-item-row`) — no wrapper div. */
    setNodeRef?: (el: HTMLElement | null) => void;
    /** Inline style (dnd transform / transition) applied to the row root. */
    style?: CSSProperties;
    /** Whether this row is the one currently being dragged. */
    isDragging?: boolean;
    /** ARIA / dnd attributes spread on the row root. */
    attributes?: Record<string, unknown>;
    /** Pointer / keyboard listeners spread on the row root. */
    listeners?: Record<string, unknown>;
}

/**
 * Props contract for {@link Sprint}. The component is fully controlled apart from
 * the local `expanded` (fold) state; it owns no story/sprint data and mirrors the
 * bindings the legacy `tg-sprint` directive read off its scope.
 */
export interface SprintProps {
    /** The sprint (milestone) whose card content this renders. */
    sprint: Milestone;
    /** Project context — drives permission gating and the story/taskboard URLs. */
    project: Project;
    /** Open the create/edit-sprint lightbox for this sprint (legacy `sprintform:edit`). */
    onEditSprint: (sprint: Milestone) => void;
    /**
     * Optional `@dnd-kit` droppable ref for the `.sprint-table`, so dropping a
     * user story onto this sprint moves it into the sprint. Absent in unit tests.
     */
    dropRef?: (el: HTMLElement | null) => void;
    /** True while a draggable hovers this sprint (adds the `drag-over` class). */
    isOver?: boolean;
    /** Optional per-row sortable wiring (see {@link StoryRowDndProps}). */
    getStoryRowProps?: (us: UserStory) => StoryRowDndProps | undefined;
}

/**
 * Renders one sprint card's content: header, progress bar, the story list (or an
 * empty-drop placeholder) and the taskboard link.
 *
 * @param props - See {@link SprintProps}.
 * @returns The sprint-card content as a Fragment, DOM/class-identical to the
 *          AngularJS `tg-sprint` template.
 */
export function Sprint(props: SprintProps): JSX.Element {
    const { sprint, project } = props;

    // --- Derived projections (mirror the legacy directive scope bindings). ---

    // `sprint.user_stories` is optional on the model; treat a missing list as empty.
    const stories: UserStory[] = sprint.user_stories ?? [];

    // Permission gating (mirrors `tg-class-permission` / `tg-check-permission`).
    // NO parallel authorization: these flags only gate which controls render;
    // the backend stays the single enforcement point (AAP §0.6.4).
    const modifyUs = project.my_permissions.indexOf("modify_us") !== -1;
    const viewMilestones = project.my_permissions.indexOf("view_milestones") !== -1;

    // resolve("project-taskboard", {project: slug, sprint: sprint.slug}) -> hashbang.
    const taskboardUrl = `#/project/${project.slug}/taskboard/${sprint.slug ?? ""}`;

    // Progress bar: `tg-progress-bar="100 * sprint.closed_points / sprint.total_points"`
    // clamped to [0, 100] by TgProgressBarDirective, with a guard so a zero total
    // (an unestimated sprint) renders an empty bar instead of NaN/Infinity.
    const total = sprint.total_points ?? 0;
    const rawPct = total === 0 ? 0 : (100 * (sprint.closed_points ?? 0)) / total;
    const progressPct = Math.min(100, Math.max(0, rawPct));

    // Fold state: OPEN sprints are expanded by default, CLOSED sprints collapsed
    // (BacklogSprintDirective: open -> `toggleSprint` opens; closed -> stays shut).
    const [expanded, setExpanded] = useState<boolean>(!sprint.closed);

    // `.sprint-table` class list: the `sprint-empty-wrapper` modifier when there
    // are no stories, the `open` modifier while expanded (kept for DOM parity even
    // though the fold itself is driven by the inline `display` below, mirroring the
    // legacy jQuery `slideToggle`), and `drag-over` while a draggable hovers.
    const sprintTableClassName =
        "sprint-table" +
        (stories.length === 0 ? " sprint-empty-wrapper" : "") +
        (expanded ? " open" : "") +
        (props.isOver ? " drag-over" : "");

    return (
        <>
            <header>
                <SprintHeader
                    sprint={sprint}
                    project={project}
                    expanded={expanded}
                    onToggleCompact={() => setExpanded((value) => !value)}
                    onEdit={() => props.onEditSprint(sprint)}
                />
            </header>

            <div className="summary-progress-wrapper">
                <div className="sprint-progress-bar">
                    <div className="current-progress" style={{ width: `${progressPct}%` }} />
                </div>
            </div>

            <div
                ref={props.dropRef}
                className={sprintTableClassName}
                style={expanded ? undefined : { display: "none" }}
            >
                {stories.length === 0 ? (
                    <div className="sprint-empty">
                        {/* WARNING_EMPTY_SPRINT_ANONYMOUS — shown to users WITHOUT
                            modify_us (the legacy `tg-class-permission` added `hidden`
                            when the user HAD modify_us). */}
                        <span className={modifyUs ? "hidden" : ""}>
                            This sprint has no user stories
                        </span>
                        {/* WARNING_EMPTY_SPRINT — shown to users WITH modify_us. */}
                        <span className={!modifyUs ? "hidden" : ""}>
                            Drop here Stories from your backlog to start a new sprint
                        </span>
                    </div>
                ) : null}

                {stories.map((us) => {
                    // Optional per-row sortable wiring (undefined outside a DndContext).
                    const dnd = props.getStoryRowProps ? props.getStoryRowProps(us) : undefined;
                    // `due_date` is a legacy view field not present on the strict
                    // UserStory model; read it defensively without widening the type.
                    const dueDate = (us as { due_date?: string | null }).due_date;
                    const epics = us.epics ?? [];

                    const rowClassName =
                        "row milestone-us-item-row" +
                        (us.is_closed ? " closedRow" : "") +
                        (us.is_blocked ? " blockedRow" : "") +
                        (dnd?.isDragging ? " dragging" : "");

                    const usNameClassName =
                        "us-name clickable" +
                        (us.is_closed ? " closed" : "") +
                        (us.is_blocked ? " blocked" : "");

                    const usHref =
                        `#/project/${project.slug}/us/${us.ref}` +
                        (us.milestone != null ? `?milestone=${us.milestone}` : "");

                    return (
                        <div
                            key={us.id}
                            ref={dnd?.setNodeRef}
                            style={dnd?.style}
                            data-id={String(us.id)}
                            className={rowClassName}
                            {...(dnd?.attributes ?? {})}
                            {...(dnd?.listeners ?? {})}
                        >
                            <div className="column-us">
                                <a
                                    className={usNameClassName}
                                    href={usHref}
                                    title={`#${us.ref} ${us.subject ?? ""}`}
                                >
                                    <span className="us-ref-text">{`#${us.ref} `}</span>
                                    <span className="us-name-text">{us.subject ?? ""}</span>
                                    {epics.length > 0 ? (
                                        <span className="us-epic-container">
                                            {epics.map((epic) => (
                                                <span
                                                    key={epic.id}
                                                    className="belong-to-epic-pill"
                                                    style={{ background: epic.color ?? undefined }}
                                                    title={`#${epic.ref} ${epic.subject ?? ""}`}
                                                />
                                            ))}
                                        </span>
                                    ) : null}
                                    {dueDate ? (
                                        <div className="due-date">{String(dueDate)}</div>
                                    ) : null}
                                </a>
                            </div>
                            {us.total_points ? (
                                <div
                                    className={
                                        "column-points width-1" +
                                        (us.is_closed ? " closed" : "") +
                                        (us.is_blocked ? " blocked" : "")
                                    }
                                >
                                    <span className="points-container">{us.total_points}</span>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            {viewMilestones ? (
                <a
                    className="btn-small"
                    href={taskboardUrl}
                    title={`Go to Taskboard of "${sprint.name}"`}
                >
                    <span>Sprint Taskboard</span>
                </a>
            ) : null}
        </>
    );
}
