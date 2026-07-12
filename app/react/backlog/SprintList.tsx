/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintList
 * ----------
 * React 18.2 + TypeScript reproduction of the Backlog sidebar's sprint list —
 * the DOM the AngularJS Backlog screen rendered through
 * `app/partials/includes/modules/sprints.jade`. It emits the `section.sprints`
 * container with, in order:
 *   1. the `header.sprint-header` (the milestone COUNT + the "add sprint" button),
 *   2. an `.empty-small` empty-state (shown only when there are zero milestones),
 *   3. the OPEN sprint cards,
 *   4. the `.filter-closed-sprints` show/hide-closed-sprints toggle, and
 *   5. the CLOSED sprint cards (rendered only while `closedSprintsVisible`).
 *
 * It is a presentational, DOM-preserving container consumed by `./Backlog.tsx`.
 * It emits the exact element tree, class names and literal `tg-*` attributes that
 * the UNCHANGED Taiga SCSS (`app/styles/modules/backlog/sprints.scss`) and the
 * Protractor/Playwright selectors target, so the migrated React screen is styled
 * and located pixel-identically without editing any stylesheet (AAP §0.7.1 —
 * DOM / visual parity). No behavior, endpoint, styling or authorization change is
 * introduced.
 *
 * Source lineage (reference-only AngularJS originals this reproduces; never edited):
 *   - app/partials/includes/modules/sprints.jade            -> the element tree below
 *     (`section.sprints`, `header.sprint-header`, `.empty-small`, the
 *     `div.sprint.sprint-open` / `.sprint-closed` `ng-repeat`s carrying
 *     `tg-backlog-sprint="sprint"` + `tg-sprint-sortable`, and the
 *     `.filter-closed-sprints` toggle).
 *   - app/coffee/modules/backlog/sprints.coffee (L124-167)  ->
 *     ToggleExcludeClosedSprintsVisualization: the `.filter-closed-sprints` click
 *     flips the "show/hide closed sprints" label and requests the closed sprints
 *     be loaded/unloaded. Here that is the `onToggleClosedSprints` callback and
 *     the `closedSprintsVisible` flag that flips the `.text` label between
 *     "Show closed sprints" / "Hide closed sprints".
 *   - app/coffee/modules/backlog/sprints.coffee (L18-60)    ->
 *     BacklogSprintDirective adds the `sprint-closed` modifier for a closed
 *     sprint; here the modifier is chosen from the OPEN vs CLOSED list the card
 *     is rendered in (`isClosed`), matching the jade's hardcoded
 *     `.sprint-open` / `.sprint-closed` repeats.
 *   - app/coffee/modules/backlog/main.coffee (`addNewSprint`) -> the add-sprint
 *     controls, surfaced here as the `onAddSprint` callback.
 *
 * Migration notes (technology-specific changes vs. the AngularJS original):
 *   - Jade template -> JSX; the `ng-repeat` sprint lists -> `Array.prototype.map`.
 *   - The legacy `tg-svg(svg-icon="icon-*")` custom element compiled to a plain
 *     `<svg class="icon icon-*"><use xlink:href="#icon-*"/></svg>` sprite; that
 *     compiled DOM is emitted directly here (the SCSS targets the bare `svg` /
 *     `.icon` selectors, not a `tg-svg` host), matching `./SprintHeader.tsx`.
 *   - AngularJS `tg-check-permission="add_milestone"` -> the `canAddMilestone`
 *     gate computed from `project.my_permissions`. There is NO parallel
 *     authorization: this flag only decides whether the add-sprint control
 *     renders; the backend remains the single enforcement point (AAP §0.6.4).
 *   - The AngularJS `translate` keys are rendered as their resolved English copy
 *     from `app/locales/taiga/locale-en.json` ("SPRINTS",
 *     "There are no sprints yet", "Show closed sprints" / "Hide closed sprints")
 *     because there is no React i18n runtime in scope for this POC. The only
 *     user-supplied values rendered (sprint names, refs, etc.) flow through the
 *     child `./Sprint.tsx` via React's default (escaping) text nodes.
 *   - `tg-backlog-sprint="sprint"` and `tg-sprint-sortable` were AngularJS
 *     directive hooks; they are reproduced here as LITERAL, inert attribute
 *     strings (NOT AngularJS behavior) purely so the existing e2e selector
 *     `div[tg-backlog-sprint="sprint"]` continues to locate every sprint card.
 *     React passes dashed attributes through to the DOM verbatim.
 *
 * @dnd-kit interop: `./Backlog.tsx` owns the `DndContext`. Each sprint card is a
 * droppable ({@link DroppableSprint}) so dropping a backlog user story onto a
 * sprint moves it into that sprint; the drop is surfaced to the drag-end handler
 * as `event.over.data.current = { type: "sprint", sprintId }`. `useDroppable`
 * reads from `@dnd-kit`'s context which has a safe default, so a `SprintList`
 * still renders correctly outside a `DndContext` (e.g. in isolated unit tests).
 */

import { useDroppable } from "@dnd-kit/core";

import type { Milestone, Project } from "../shared/types";
import { Sprint } from "./Sprint";

/**
 * Props for the module-local {@link DroppableSprint} wrapper — one draggable
 * sprint card. Kept internal (not exported) because the wrapper is an
 * implementation detail of {@link SprintList}.
 */
interface DroppableSprintProps {
    /** The sprint (milestone) this card renders. */
    sprint: Milestone;
    /** Project context, forwarded to {@link Sprint} for permission gating / URLs. */
    project: Project;
    /**
     * Whether this card belongs to the CLOSED list. Chooses the `sprint-closed`
     * vs `sprint-open` modifier on the wrapper (matching the jade's two hardcoded
     * `ng-repeat`s) and is forwarded to {@link Sprint} implicitly via the sprint's
     * own `closed` flag for its collapsed/expanded default.
     */
    isClosed: boolean;
    /** Open the create/edit-sprint lightbox for this sprint (legacy `sprintform:edit`). */
    onEditSprint: (sprint: Milestone) => void;
}

/**
 * A single sprint card wrapper that is a `@dnd-kit` droppable target.
 *
 * Reproduces the legacy `div.sprint.sprint-open` / `div.sprint.sprint-closed`
 * `ng-repeat` element that carried `tg-backlog-sprint="sprint"` and
 * `tg-sprint-sortable`. The droppable ref lands on the `.sprint-table` INSIDE
 * {@link Sprint} (passed down as `dropRef`), so a story dropped anywhere on the
 * card's table is registered against this sprint. The `isOver` flag adds the
 * `.sprint-table.drag-over` affordance while a draggable hovers the card.
 *
 * The droppable `id` (`sprint-<id>`) and `data` payload
 * (`{ type: "sprint", sprintId }`) form the contract the `DndContext` owner
 * (`./Backlog.tsx`) reads in its drag-end handler to move the story into the
 * sprint via a single `bulk-update-us-milestone` call.
 *
 * @param props - See {@link DroppableSprintProps}.
 * @returns The sprint-card wrapper element, DOM/class-identical to the legacy repeat.
 */
function DroppableSprint(props: DroppableSprintProps): JSX.Element {
    const { setNodeRef, isOver } = useDroppable({
        id: `sprint-${props.sprint.id}`,
        data: { type: "sprint", sprintId: props.sprint.id },
    });

    return (
        <div
            className={`sprint ${props.isClosed ? "sprint-closed" : "sprint-open"}`}
            tg-backlog-sprint="sprint"
            tg-sprint-sortable=""
        >
            <Sprint
                sprint={props.sprint}
                project={props.project}
                onEditSprint={props.onEditSprint}
                dropRef={setNodeRef}
                isOver={isOver}
            />
        </div>
    );
}

/**
 * Props contract for {@link SprintList}. The component is fully controlled: it
 * owns no sprint data or visibility state — `./Backlog.tsx` supplies the
 * projected open/closed lists, the totals, the closed-sprints visibility flag,
 * and the add/toggle/edit callbacks.
 */
export interface SprintListProps {
    /** Project context — drives the add-sprint permission gate. */
    project: Project;
    /** The OPEN sprints (milestones) to render, in display order. */
    openSprints: Milestone[];
    /**
     * The CLOSED sprints to render (only shown while {@link closedSprintsVisible}
     * is `true`, mirroring the legacy lazy load on toggle).
     */
    closedSprints: Milestone[];
    /**
     * Total OPEN milestone count. Renders the `.sprint-header .number` badge and
     * gates the header add-sprint button (mirrors the legacy `totalMilestones`);
     * when `0`, the `.empty-small` empty-state is shown instead.
     */
    totalMilestones: number;
    /** Total CLOSED milestone count. Gates the `.filter-closed-sprints` toggle. */
    totalClosedMilestones: number;
    /**
     * Whether the closed sprints are currently shown. Renders the closed sprint
     * cards and flips the toggle label to "Hide closed sprints".
     */
    closedSprintsVisible: boolean;
    /** Open the create-sprint lightbox (legacy `ctrl.addNewSprint()`). */
    onAddSprint: () => void;
    /** Toggle closed-sprints visibility (legacy ToggleExcludeClosedSprintsVisualization). */
    onToggleClosedSprints: () => void;
    /** Open the create/edit-sprint lightbox for a given sprint (legacy `sprintform:edit`). */
    onEditSprint: (sprint: Milestone) => void;
}

/**
 * Renders the Backlog sidebar sprint list.
 *
 * Permission gating is identical to the legacy template's
 * `tg-check-permission="add_milestone"`: the add-sprint controls render only for
 * users who hold the `add_milestone` permission. There is NO parallel
 * authorization — the backend stays the single enforcement point (AAP §0.6.4);
 * this flag only decides which controls are shown.
 *
 * @param props - See {@link SprintListProps}.
 * @returns The `section.sprints` sidebar, DOM/class-identical to `sprints.jade`.
 */
export function SprintList(props: SprintListProps): JSX.Element {
    // Mirrors `tg-check-permission="add_milestone"` — gates every add-sprint control.
    const canAddMilestone = props.project.my_permissions.indexOf("add_milestone") !== -1;

    return (
        <section className="sprints">
            <header className="sprint-header">
                <h1>
                    {props.totalMilestones ? (
                        <span className="number">{props.totalMilestones}</span>
                    ) : null}
                    <span className="title">SPRINTS</span>
                </h1>
                {props.totalMilestones && canAddMilestone ? (
                    <a
                        className="btn-link add-sprint"
                        href=""
                        title="Add a sprint"
                        onClick={(event) => {
                            event.preventDefault();
                            props.onAddSprint();
                        }}
                    >
                        <span>Add</span>
                        <svg className="icon icon-add">
                            <use xlinkHref="#icon-add" />
                        </svg>
                    </a>
                ) : null}
            </header>

            {props.totalMilestones === 0 ? (
                <div className="empty-small">
                    <img src="/v/images/empty/empty_sprint.png" alt="There are no sprints yet" />
                    <p className="title">There are no sprints yet</p>
                    {canAddMilestone ? (
                        <a
                            className="btn-link add-sprint"
                            href=""
                            title=""
                            onClick={(event) => {
                                event.preventDefault();
                                props.onAddSprint();
                            }}
                        >
                            <span> Add a sprint</span>
                            <svg className="icon icon-add">
                                <use xlinkHref="#icon-add" />
                            </svg>
                        </a>
                    ) : null}
                </div>
            ) : null}

            {props.openSprints.map((sprint) => (
                <DroppableSprint
                    key={sprint.id}
                    sprint={sprint}
                    project={props.project}
                    isClosed={false}
                    onEditSprint={props.onEditSprint}
                />
            ))}

            {props.totalClosedMilestones ? (
                <a
                    className="filter-closed-sprints"
                    href=""
                    onClick={(event) => {
                        event.preventDefault();
                        props.onToggleClosedSprints();
                    }}
                >
                    <svg className="icon icon-folder">
                        <use xlinkHref="#icon-folder" />
                    </svg>
                    <span className="text">
                        {props.closedSprintsVisible ? "Hide closed sprints" : "Show closed sprints"}
                    </span>
                </a>
            ) : null}

            {props.closedSprintsVisible
                ? props.closedSprints.map((sprint) => (
                      <DroppableSprint
                          key={sprint.id}
                          sprint={sprint}
                          project={props.project}
                          isClosed
                          onEditSprint={props.onEditSprint}
                      />
                  ))
                : null}
        </section>
    );
}
