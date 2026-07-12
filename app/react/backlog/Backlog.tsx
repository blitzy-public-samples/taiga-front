/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * `Backlog.tsx` — top-level React screen container for the Backlog /
 * Sprint-Planning workspace (feature F-002). It is the React 18.2 + TypeScript
 * reproduction of the AngularJS `BacklogController` plus its two Jade templates
 * (`app/partials/backlog/backlog.jade` +
 * `app/partials/includes/modules/backlog-table.jade`) and the
 * `addnewus.jade` / `mainTitle.jade` includes.
 *
 * Mount seam: `../bootstrap.ts` registers the `<tg-react-backlog>` custom
 * element and mounts this component via `createElement(Backlog, { context })`.
 * AngularJS treats the unknown `<tg-react-backlog>` tag as an inert node, the
 * browser upgrades it after `customElements.define`, and this React tree renders
 * inside it. The surrounding `.wrapper` + `tg-project-menu` and the lightbox
 * bank stay AngularJS — only the `main.main.scrum` content region is React.
 *
 * Responsibilities (mirrors the legacy controller, no new behavior):
 *   - Orchestrates the `useBacklogStories` hook (which owns the API + WebSocket
 *     clients, immer state, and the `pendingDrag` bulk-order queue). Every piece
 *     of state and every action rendered here comes from that hook's view-model.
 *   - Owns the single `@dnd-kit` `DndContext` that replaces the legacy dragula +
 *     dom-autoscroller wiring (`app/coffee/modules/backlog/sortable.coffee`).
 *     Backlog rows are sortable items; sprints (inside `SprintList`) are drop
 *     targets. `onDragEnd` maps to exactly one backend bulk call — a milestone
 *     move (`bulk-update-us-milestone`) or a backlog reorder
 *     (`bulk-update-us-backlog-order`) — exactly like the legacy `moveUs`.
 *   - Composes the presentational children `BacklogRow`, `SprintList`,
 *     `BurndownSummary`, and the React sprint lightbox `CreateEditSprint`.
 *
 * DOM fidelity: the JSX reproduces the exact element tree, class names,
 * `data-*` attributes and English `translate` strings the AngularJS templates
 * produced, so the unchanged compiled SCSS (`app/styles/layout/backlog.scss`,
 * `app/styles/modules/backlog/backlog-table.scss`) styles it identically. In
 * particular icons are wrapped in `<tg-svg>` — the faithful reproduction of the
 * AngularJS `tg-svg` directive (which has no `replace`) — because the theme
 * targets them via descendant selectors such as `.btn-filter.move-to-sprint
 * tg-svg`; a bare `<svg>` would drop that styling.
 */

// jsx automatic runtime => NO `import React`. The type-only namespace import
// provides the `React.*` types used by the `declare global` JSX augmentation
// and the `React.CSSProperties` / event typings below.
import type * as React from "react";
import { useMemo } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { MountContext, UserStory, Project, Status } from "../shared/types";
import { BacklogRow } from "./BacklogRow";
import { SprintList } from "./SprintList";
import { BurndownSummary } from "./BurndownSummary";
import { CreateEditSprint } from "./lightboxes/CreateEditSprint";
import { useBacklogStories } from "./hooks/useBacklogStories";

/**
 * Custom-element JSX typing. This screen emits two tags unknown to React's
 * intrinsic element table:
 *   - `tg-svg` — the AngularJS icon directive DOM the SCSS targets. The type is
 *     kept identical to the sibling React screen files (`BacklogRow.tsx`,
 *     `Card.tsx`, `KanbanHeader.tsx`) so the merged `declare global` blocks agree
 *     on its type (TypeScript requires type identity for a property declared in
 *     multiple augmentations, not merely byte-identity).
 *   - `sidebar` — the legacy `sidebar.sidebar` element wrapping the sprint list.
 *     Emitting the `<sidebar>` tag verbatim (rather than a `<div>`/`<aside>`) is a
 *     deliberate DOM-fidelity choice: the AngularJS `backlog.jade` renders
 *     `sidebar.sidebar` and the compiled theme targets it, so the React output
 *     must match. React's development build logs a one-time "unrecognized tag"
 *     advisory for any non-hyphenated unknown element; that advisory is stripped
 *     from the production (esbuild `NODE_ENV=production`) bundle and has no
 *     runtime/visual effect — it is an accepted cost of exact parity. Suppressing
 *     it globally would mask genuine warnings and is intentionally avoided.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "tg-svg": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> &
        Record<string, unknown>;
      sidebar: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

/**
 * Module-local reproduction of the AngularJS `tg-svg` directive output
 * (`app/coffee/modules/common.coffee` — no `replace`, so the rendered DOM is
 * `<tg-svg><svg class="icon <name>"><use xlink:href="#<name>"/></svg></tg-svg>`).
 * Kept output-identical to the sibling `BacklogRow` `Icon` helper so both parts
 * of the same screen emit matching icon markup. React 18 JSX uses `xlinkHref`
 * (compiled to the `xlink:href` attribute the SVG sprite sheet expects).
 *
 * @param props.name     Sprite id (e.g. `"icon-add"`) — used for both the
 *                       `icon <name>` class and the `#<name>` sprite reference.
 * @param props.svgClass Optional extra class placed on the `<svg>`.
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
 * Props for the {@link SortableBacklogRow} wrapper. Mirrors the subset of
 * {@link BacklogRow}'s props this container feeds each row, plus `key` handled
 * by the parent `map`.
 */
interface SortableBacklogRowProps {
  us: UserStory;
  project: Project;
  statuses: Status[];
  showTags: boolean;
  selected: boolean;
  isFirstInBacklog: boolean;
  onToggleSelected: (us: UserStory, checked: boolean) => void;
  onUpdateStatus: (us: UserStory, statusId: number) => void;
  onUpdatePoints: (us: UserStory, roleId: number | null, pointId: number) => void;
  onEdit: (us: UserStory) => void;
  onDelete: (us: UserStory) => void;
  onMoveToTop: (us: UserStory) => void;
}

/**
 * `@dnd-kit` sortable wrapper for a single backlog row.
 *
 * CRITICAL — this is a COMPONENT that renders `<BacklogRow>` directly and adds
 * NO wrapping DOM node. That keeps the `.row.us-item-row` element emitted by
 * `BacklogRow` a DIRECT child of `.backlog-table-body`, preserving the ported
 * e2e selector `.backlog-table-body > div[ng-repeat]` and the SCSS child
 * selectors. `useSortable` supplies the refs/listeners that `BacklogRow`
 * applies to its own row root (`setNodeRef`, `style`, `isDragging`) and drag
 * handle (`setActivatorNodeRef`, `attributes`, `listeners`).
 *
 * `useSortable().attributes` is typed as the `DraggableAttributes` interface,
 * which has named string-literal keys and therefore no implicit index
 * signature; it is not directly assignable to `BacklogRow`'s
 * `attributes: Record<string, unknown>`, so it is widened via `as unknown as`.
 * `listeners` is already `Record<string, Function> | undefined`, whose value
 * type widens to `unknown`, so it needs no cast.
 */
function SortableBacklogRow(rp: SortableBacklogRowProps): JSX.Element {
  const s = useSortable({ id: rp.us.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(s.transform),
    transition: s.transition,
  };
  return (
    <BacklogRow
      us={rp.us}
      project={rp.project}
      statuses={rp.statuses}
      showTags={rp.showTags}
      selected={rp.selected}
      isFirstInBacklog={rp.isFirstInBacklog}
      onToggleSelected={rp.onToggleSelected}
      onUpdateStatus={rp.onUpdateStatus}
      onUpdatePoints={rp.onUpdatePoints}
      onEdit={rp.onEdit}
      onDelete={rp.onDelete}
      onMoveToTop={rp.onMoveToTop}
      dnd={{
        setNodeRef: s.setNodeRef,
        setActivatorNodeRef: s.setActivatorNodeRef,
        style,
        attributes: s.attributes as unknown as Record<string, unknown>,
        listeners: s.listeners,
        isDragging: s.isDragging,
      }}
    />
  );
}

/**
 * Backlog / Sprint-Planning workspace screen container (NAMED export — required
 * by `../bootstrap.ts`, which mounts it via `createElement(Backlog, { context })`).
 *
 * @param props.context The mount context bridged from the `<tg-react-backlog>`
 *   custom element (`projectSlug`, `token`, `sessionId`, `apiUrl`, `eventsUrl`,
 *   `language`). It is passed straight into `useBacklogStories`, which owns the
 *   API/WebSocket clients and all screen state.
 */
export function Backlog(props: { context: MountContext }): JSX.Element {
  // The hook owns ALL data access, immer state, the WebSocket subscription and
  // the `pendingDrag` bulk-order queue. This container is a pure projection of
  // its view-model plus the `@dnd-kit` drag wiring.
  const vm = useBacklogStories(props.context);
  const project = vm.project;

  // Single pointer sensor with an 8px activation distance: clicks on the row
  // checkbox / status / points / options controls still fire, and a drag only
  // begins after the pointer moves 8px — the React equivalent of dragula's
  // handle-based drag start (`app/coffee/modules/backlog/sortable.coffee`).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Stable id list for the sortable rows. Recomputed only when the story list
  // identity changes, mirroring the `ng-repeat="us in userstories"` binding.
  const rowIds = useMemo<number[]>(
    () => vm.userstories.map((u) => u.id),
    [vm.userstories],
  );

  /**
   * Maps a completed drag to exactly ONE backend bulk call, reproducing the
   * legacy `drake.on('dragend')` -> `ctrl.moveUs(...)` semantics:
   *   - drop onto a sprint droppable  -> `moveToSprint`  (bulk-update-us-milestone)
   *   - drop over another backlog row -> `moveUs`        (bulk-update-us-backlog-order)
   * A drop with no target, on the dragged story itself, or on an unknown id is a
   * no-op (matching the legacy `index == oldIndex && sameContainer` early return).
   */
  function onDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over) {
      return;
    }

    const activeUs = vm.userstories.find(
      (u) => String(u.id) === String(active.id),
    );
    if (!activeUs) {
      return;
    }

    // Sprint droppables expose `{ type: "sprint", sprintId }` via their data ref
    // (see `SprintList`). `over.data.current` is loosely typed by `@dnd-kit`.
    const overData = over.data.current as
      | { type?: string; sprintId?: number }
      | undefined;
    if (overData && overData.type === "sprint" && overData.sprintId != null) {
      vm.moveToSprint([activeUs], overData.sprintId);
      return;
    }

    // Otherwise this is a reorder within the backlog list: compute the target
    // index and the neighbouring stories the API needs for ordering, exactly as
    // the legacy `drop` handler derived `previousUs` / `nextUs`.
    const overUs = vm.userstories.find(
      (u) => String(u.id) === String(over.id),
    );
    if (overUs && overUs.id !== activeUs.id) {
      const newIndex = vm.userstories.findIndex((u) => u.id === overUs.id);
      const previousUs = vm.userstories[newIndex - 1] ?? null;
      const nextUs = vm.userstories[newIndex + 1] ?? null;
      vm.moveUs([activeUs], newIndex, null, previousUs, nextUs);
    }
  }

  // Loading guard: until the project resolves, render the empty `main.main.scrum`
  // shell so children never dereference a null project. After this point
  // TypeScript narrows `project` to a non-null `Project`.
  if (!project) {
    return <main className="main scrum" />;
  }

  // Permission gates — mirror the AngularJS `tg-check-permission` directives.
  // The backend remains the single enforcement point (constraint C-1); these
  // only hide controls the user cannot use.
  const modifyUs = project.my_permissions.indexOf("modify_us") !== -1;
  const addUs = project.my_permissions.indexOf("add_us") !== -1;

  // `i_am_admin` is a runtime flag not modelled on `Project`; read it defensively
  // (the legacy template gated the empty-burndown hint on `project.i_am_admin`).
  const isAdmin = (project as { i_am_admin?: boolean }).i_am_admin === true;
  const adminModulesUrl =
    "#/project/" + project.slug + "/admin/project-profile/modules";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      autoScroll
      onDragEnd={onDragEnd}
    >
      <main className="main scrum">
        <section className="backlog">
          {/* mainTitle.jade -> header > h1 (project name rendered as a text node,
              so any subject/tag characters are escaped by React by default). */}
          <header>
            <h1>{project.name ?? ""}</h1>
          </header>

          {/* .backlog-summary is reproduced ENTIRELY by BurndownSummary
              (summary + empty-burndown hint + graphics-container). */}
          <BurndownSummary
            stats={vm.stats}
            showGraphPlaceholder={vm.showGraphPlaceholder}
            isAdmin={isAdmin}
            adminModulesUrl={adminModulesUrl}
          />

          <div className="backlog-table">
            <div className="backlog-top">
              <div className="backlog-menu">
                <div className="backlog-header">
                  <div className="backlog-header-title">
                    <h2>Backlog</h2>
                    {vm.selectedFilters.length ? (
                      <>
                        <span className="backlog-stories-number squared">
                          {vm.userstories.length}
                        </span>
                        <span className="backlog-stories-number">
                          {"of " + vm.totalUserStories + " user stories"}
                        </span>
                      </>
                    ) : (
                      <span className="backlog-stories-number">
                        {vm.totalUserStories + " user stories"}
                      </span>
                    )}
                  </div>
                  <div className="backlog-header-options">
                    {/* addnewus.jade -> .new-us. The baseline compiled dist renders
                        the two `button variant=...` directives as anchors, so the
                        ported e2e selector is `.new-us a` (get(0)=standard, get(1)=bulk). */}
                    <div className="new-us">
                      {addUs ? (
                        <a
                          className="btn-small"
                          href=""
                          onClick={(e) => {
                            e.preventDefault();
                            vm.addNewUs("standard");
                          }}
                        >
                          <Icon name="icon-add" />
                          <span className="text">user story</span>
                        </a>
                      ) : null}
                      {addUs ? (
                        <a
                          className="btn-icon"
                          href=""
                          aria-label="Add some new user stories in bulk"
                          onClick={(e) => {
                            e.preventDefault();
                            vm.addNewUs("bulk");
                          }}
                        >
                          <Icon name="icon-bulk" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="backlog-table-options">
                  <div className="backlog-table-options-start">
                    <button
                      className={
                        "btn-filter e2e-open-filter ng-animate-disabled" +
                        (vm.activeFilters ? " active" : "")
                      }
                      id="show-filters-button"
                      onClick={() => vm.toggleActiveFilters()}
                    >
                      <Icon name="icon-filters" />
                      <span className="text">
                        {vm.activeFilters ? "Hide filters" : "Filters"}
                      </span>
                      {vm.selectedFilters.length ? (
                        <span className="selected-filters">
                          {vm.selectedFilters.length}
                        </span>
                      ) : null}
                    </button>

                    {/* tg-input-search -> plain search input; change -> changeQ. */}
                    <input
                      type="text"
                      className="e2e-search"
                      value={vm.filterQ}
                      onChange={(e) => vm.changeQ(e.target.value)}
                    />

                    {vm.userstories.length ? (
                      <div
                        className="display-tags-button"
                        id="show-tags"
                        onClick={() => vm.toggleShowTags()}
                      >
                        <div
                          className={"check js-check" + (vm.showTags ? " active" : "")}
                        >
                          <input
                            type="checkbox"
                            id="show-tags-input"
                            checked={vm.showTags}
                            readOnly
                          />
                          <div />
                        </div>
                        <label htmlFor="show-tags-input">tags</label>
                      </div>
                    ) : null}
                  </div>

                  <div className="backlog-table-options-end">
                    {vm.currentSprint ? (
                      <button
                        className="btn-filter move-to-current-sprint move-to-sprint e2e-move-to-sprint"
                        title="Move to Current Sprint"
                        id="move-to-current-sprint"
                        onClick={() => vm.moveSelectedToCurrentSprint()}
                      >
                        <span className="text">Move to Current Sprint</span>
                        <Icon name="icon-add-to-sprint" />
                      </button>
                    ) : (
                      <button
                        className="btn-filter move-to-latest-sprint move-to-sprint e2e-move-to-sprint"
                        title="Move to latest Sprint"
                        id="move-to-latest-sprint"
                        onClick={() => vm.moveSelectedToLatestSprint()}
                      >
                        <span className="text">Move to latest Sprint</span>
                        <Icon name="icon-add-to-sprint" />
                      </button>
                    )}

                    {vm.userstories.length && vm.hasPermission("add_milestone") ? (
                      <button
                        className={
                          "btn-filter velocity-forecasting-btn ng-animate-disabled e2e-velocity-forecasting" +
                          (vm.displayVelocity ? " active" : "")
                        }
                        title="Velocity forecasting"
                        onClick={() => vm.toggleVelocityForecasting()}
                      >
                        <Icon name="icon-fold-column" />
                        <span className="text">Velocity forecasting</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div
                className={"backlog-manager" + (!vm.activeFilters ? " expanded" : "")}
              >
                {/* tg-filter DOM (filters UI) — the filter panel container; the
                    filter widgets themselves render inside on demand. */}
                {vm.activeFilters ? (
                  <div className="backlog-filter" id="backlog-filter" />
                ) : null}

                <section
                  className={"backlog-table" + (!vm.userstories.length ? " hidden" : "")}
                >
                  {/* backlog-table.jade — header title row. */}
                  <div className="backlog-table-header">
                    <div className="row backlog-table-title">
                      {modifyUs ? <div className="draggable-us-column" /> : null}
                      {modifyUs ? <div className="input" /> : null}
                      <div className="user-stories">User Story</div>
                      <div className="status">Status</div>
                      <div className="points" title="Select view per Role">
                        <div className="inner">
                          <span className="header-points">Points</span>
                          <Icon name="icon-filter" />
                        </div>
                      </div>
                      <div className="us-header-options" />
                    </div>
                  </div>

                  {/* backlog-table.jade — sortable body. Rows are DIRECT children
                      (SortableBacklogRow adds no wrapper) so the ported e2e selector
                      `.backlog-table-body > div[ng-repeat]` and the SCSS child
                      selectors keep matching. */}
                  <div
                    className={
                      "backlog-table-body" +
                      (vm.showTags ? " show-tags" : "") +
                      (vm.activeFilters ? " active-filters" : "") +
                      (vm.displayVelocity ? " forecasted-stories" : "")
                    }
                  >
                    <SortableContext
                      items={rowIds}
                      strategy={verticalListSortingStrategy}
                    >
                      {vm.userstories.map((us, i) => (
                        <SortableBacklogRow
                          key={us.id}
                          us={us}
                          project={project}
                          statuses={vm.statuses}
                          showTags={vm.showTags}
                          selected={vm.selectedUs.has(us.id)}
                          isFirstInBacklog={i === 0}
                          onToggleSelected={vm.toggleSelectedUs}
                          onUpdateStatus={vm.updateUserStoryStatus}
                          onUpdatePoints={vm.updateUserStoryPoints}
                          onEdit={vm.editUserStory}
                          onDelete={vm.deleteUserStory}
                          onMoveToTop={vm.moveUsToTop}
                        />
                      ))}
                    </SortableContext>
                    {/* tg-loading placeholder for the infinite-scroll fetch. */}
                    <div>{vm.loading ? "…" : null}</div>
                  </div>

                  {vm.displayVelocity ? (
                    <div
                      className="forecasting-add-sprint e2e-velocity-forecasting-add"
                      onClick={() => vm.createSprintFromForecasting()}
                    >
                      <span className="forecasting-text">
                        {vm.forecastNewSprint
                          ? "create sprint and add US"
                          : "Move to Current Sprint"}
                      </span>
                      <input className="e2e-sprint-name" defaultValue="" />
                    </div>
                  ) : null}
                </section>

                {/* Empty states — `.js-empty-backlog` is also a dragula drop
                    target in the legacy code; here it is purely presentational. */}
                <div
                  className={
                    "empty-backlog js-empty-backlog" +
                    (vm.userstories.length || !vm.filterQ.length ? " hidden" : "")
                  }
                >
                  <p className="no-match">No matches</p>
                  <p className="no-match-help">Try again with a different search</p>
                </div>
                <div
                  className={
                    "empty-large js-empty-backlog" +
                    (vm.userstories.length || vm.filterQ.length ? " hidden" : "")
                  }
                >
                  <p className="title">The backlog is empty!</p>
                  {addUs ? (
                    <button
                      className="btn-small"
                      title="Create a new user story"
                      onClick={() => vm.addNewUs("standard")}
                    >
                      <Icon name="icon-add" />
                      <span className="text">Add a user story</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* sidebar sprints (sprints.jade) — reproduced by SprintList. The
            `<sidebar>` tag mirrors the legacy `sidebar.sidebar` exactly (see the
            file-level note on the JSX augmentation). */}
        <sidebar className="sidebar">
          <SprintList
            project={project}
            openSprints={vm.sprints}
            closedSprints={vm.closedSprints}
            totalMilestones={vm.totalMilestones}
            totalClosedMilestones={vm.totalClosedMilestones}
            closedSprintsVisible={vm.closedSprintsVisible}
            onAddSprint={vm.openCreateSprint}
            onToggleClosedSprints={vm.toggleClosedSprints}
            onEditSprint={vm.openEditSprint}
          />
        </sidebar>
      </main>

      {/* Only the sprint create/edit lightbox is React; US create/edit/bulk are
          delegated to the surviving AngularJS lightboxes by the hook via window
          CustomEvents. Kept inside the single DndContext so the whole screen
          shares one drag context. */}
      <CreateEditSprint
        open={vm.sprintLightbox.open}
        mode={vm.sprintLightbox.mode}
        sprint={vm.sprintLightbox.sprint}
        lastSprint={vm.sprintLightbox.lastSprint}
        project={project}
        projectId={vm.projectId}
        apiClient={vm.apiClient}
        onClose={vm.closeSprintLightbox}
        onSaved={vm.onSprintSaved}
        onDeleted={vm.onSprintDeleted}
      />
    </DndContext>
  );
}

