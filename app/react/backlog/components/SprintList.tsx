/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintList — React port of the Backlog "Sprints" section
 * (`app/partials/includes/modules/sprints.jade`, lines 8-60).
 *
 * Presentational (stateless) component that renders the ENTIRE sprints column of
 * the Backlog screen:
 *   1. the section header (`.sprint-header`) — the `SPRINTS` title with an
 *      optional count badge and the header "Add" sprint button;
 *   2. the empty state (`.empty-small`) shown when the project has no sprints;
 *   3. the list of OPEN sprints, each wrapped in `div.sprint.sprint-open`;
 *   4. the "show / hide closed sprints" toggle (`.filter-closed-sprints`);
 *   5. the list of CLOSED sprints, each wrapped in `div.sprint.sprint-closed`.
 *
 * It is rendered once by `BacklogApp`, and it renders the sibling `Sprint.tsx`
 * component (the `sprint.jade` port) once per sprint.
 *
 * COMPOSITION BOUNDARY (critical): in `sprints.jade` each sprint is
 * `div.sprint.sprint-open` / `div.sprint.sprint-closed` (the wrapper, host of the
 * `tgBacklogSprint` directive) CONTAINING `<tg-sprint>` (which expands to
 * `sprint.jade`). Therefore THIS component owns the `.sprint.sprint-open` /
 * `.sprint.sprint-closed` wrapper `<div>` and renders `<Sprint …/>` inside each
 * wrapper. `SprintList` is a thin list/orchestration shell: it owns the section
 * chrome + the sprint wrappers, but delegates every sprint's body — including its
 * OWN `<SortableContext>` / `useDroppable` — to `Sprint`. It contains NO
 * drag-and-drop wiring of its own (the shared `<DndContext>` is provided once by
 * `BacklogApp`; each `Sprint` is a self-contained droppable).
 *
 * The component reproduces the EXACT DOM structure and CSS class names of the
 * original AngularJS markup so the existing compiled global SCSS renders it with
 * ZERO visual change (AAP 0.3.4). No stylesheet or asset is imported.
 *
 * Behavioral & markup sources (REFERENCE ONLY — never imported):
 *  - app/partials/includes/modules/sprints.jade:8-60 — the EXACT DOM reproduced
 *    here (`section.sprints` > header / empty-small / open sprints /
 *    filter-closed-sprints / closed sprints).
 *  - app/coffee/modules/backlog/sprints.coffee:124-167
 *    (`ToggleExcludeClosedSprintsVisualization`, `tgBacklogToggleClosedSprints-
 *    Visualization`) — the closed-sprints toggle. `excludeClosedSprints` starts
 *    `true` (closed hidden); a click flips it and broadcasts
 *    `backlog:load-closed-sprints` / `backlog:unload-closed-sprints`. When closed
 *    sprints become visible the `.text` label becomes
 *    `BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS`; when hidden,
 *    `BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS`. The icon stays `icon-folder`
 *    (no icon swap). Expressed here declaratively: the `showClosedSprints` prop
 *    drives the `.text` label and the click invokes `onToggleClosedSprints`.
 *
 * Localization: no i18n framework is in scope for this component (its allowed
 * import surface is intentionally limited to the reducer types + the `Sprint`
 * child), so the AngularJS `translate` / `| translate` labels are reproduced as
 * the literal English catalog values:
 *   - BACKLOG.SPRINTS.TITLE                       -> "SPRINTS"
 *   - BACKLOG.SPRINTS.TITLE_ACTION_NEW_SPRINT     -> "Add a sprint"
 *   - BACKLOG.SPRINTS.EMPTY                       -> "There are no sprints yet"
 *   - BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS  -> "Show closed sprints"
 *   - BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS  -> "Hide closed sprints"
 *   - the header add button label is the literal "Add".
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration of the Backlog
 * screen (AAP Section 0). Uses the automatic JSX runtime (`jsx: "react-jsx"`), so
 * React is intentionally NOT imported as a value; the reducer models and the
 * `MouseEvent` are type-only imports (required by `isolatedModules: true`).
 */

// The `react` MouseEvent is a TYPE-only import (isolatedModules): it types the
// click handlers for the "Add" and "toggle closed sprints" anchors. No React
// value is imported — the automatic JSX runtime supplies it.
import type { MouseEvent } from 'react';
// Reducer models are TYPE-only imports (isolatedModules). The reducer's `Sprint`
// type is aliased to `SprintModel` so it does not collide with the imported
// `Sprint` COMPONENT below. `UserStory` types the `buildUserStoryUrl` prop that
// is threaded through to each `Sprint`.
import type { Sprint as SprintModel, UserStory } from '../state/backlogReducer';
// The sibling presentational child: renders ONE sprint's body inside each wrapper.
import { Sprint } from './Sprint';

/**
 * Module-local reference to the AngularJS `<tg-svg>` custom-element host.
 *
 * React owns the entire subtree inside `<tg-react-backlog>`, so it must render the
 * SVG sprite `<svg><use>` itself rather than relying on AngularJS to compile the
 * `tgSvg` directive (common.coffee:342-363). That directive runs in `template`
 * mode WITHOUT `replace: true`, so the real production DOM keeps the `<tg-svg>`
 * HOST and nests the sprite inside it:
 *   `<tg-svg svg-icon="X"><svg class="icon X"><use …/></svg></tg-svg>`.
 *
 * BLITZY [VISUAL-PARITY]: the `<tg-svg>` host is load-bearing and MUST be
 * reproduced (this is why the wrapper is used here rather than a bare `<svg>`):
 * the reference-only, compiled SCSS targets `tg-svg` DIRECTLY for both icons this
 * component renders, so a bare `<svg>` would silently drop their fill, size, and
 * spacing (a VISIBLE regression, violating the zero-visual-change mandate):
 *   - core/base.scss:50            `tg-svg { display:flex; align-items:center;
 *                                   justify-content:center }`
 *   - components/buttons-next.scss:109-111  `.btn-link tg-svg { fill:currentColor }`
 *                                   (the header + empty-state "Add" icon-add)
 *   - modules/backlog/sprints.scss:42-47    `.filter-closed-sprints tg-svg {
 *                                   fill:$color-link-primary; height:1rem;
 *                                   margin-right:.5rem; transition:all .2s ease }`
 *                                   plus a `:hover` fill (the icon-folder toggle).
 * This mirrors the established `SprintHeader.tsx` / `UserStoryRow.tsx` /
 * `FilterBar.tsx` / `Card.tsx` pattern.
 *
 * The `as unknown as any` cast lets the custom-element tag be used in JSX without
 * a cross-file `declare global { namespace JSX }` augmentation, which would
 * conflict with the sibling React files that use this same established pattern.
 */
const TgSvg = 'tg-svg' as unknown as any;

/**
 * Renders a Taiga sprite icon, reproducing the rendered output of the AngularJS
 * `tgSvg` directive (`tg-svg(svg-icon="…")`). React maps `className` -> `class` on
 * the inner `<svg>`; `xlinkHref` renders the SVG 1.1 `xlink:href` attribute while
 * the extra `href` (spread via a cast so the `<use>` intrinsic type does not
 * complain) covers SVG 2 / Firefox — the Playwright engine used for the
 * migration's committed visual evidence (AAP 0.6.2).
 */
function Svg({ icon }: { icon: string }) {
  return (
    <TgSvg svg-icon={icon}>
      <svg className={`icon ${icon}`}>
        <use xlinkHref={`#${icon}`} {...({ href: `#${icon}` } as Record<string, unknown>)} />
      </svg>
    </TgSvg>
  );
}

/**
 * Props for {@link SprintList}. Every datum and callback is supplied by the parent
 * (`BacklogApp`), keeping this component purely presentational: no API calls, no
 * event subscriptions, no nav-service / config access. The URL builders and the
 * empty-state image URL are threaded in from `BacklogApp`.
 */
export interface SprintListProps {
  /** Open (non-closed) sprints, in display order. */
  openSprints: SprintModel[];
  /** Closed sprints (populated by the parent only when the user chooses to show them). */
  closedSprints: SprintModel[];
  /** Total number of milestones — drives the h1 `.number` badge and gates the header "Add sprint" button. */
  totalMilestones: number;
  /** Total closed milestones — gates the `.filter-closed-sprints` toggle link. */
  totalClosedMilestones: number;
  /** Whether closed sprints are currently shown — drives the toggle `.text` label. */
  showClosedSprints: boolean;
  /** Fold state per sprint id (reducer `sprintOpen`; open sprints init true, closed init false). */
  sprintOpen: Record<number, boolean>;
  /** `add_milestone` permission → header + empty-state "Add sprint" buttons. */
  canAddMilestone: boolean;
  /** `view_milestones` permission → threaded to each Sprint. */
  canViewMilestones: boolean;
  /** `!archived && modify_milestone` → threaded to each Sprint (edit pencil). */
  canEditSprint: boolean;
  /** `modify_us` permission → threaded to each Sprint (row readonly + drag). */
  canModifyUs: boolean;
  /** Resolves the taskboard URL for a sprint (threaded from BacklogApp nav helpers). */
  buildTaskboardUrl: (sprint: SprintModel) => string;
  /** Resolves the user-story detail URL for a milestone row (threaded from BacklogApp). */
  buildUserStoryUrl: (us: UserStory) => string;
  /** Config-resolved static URL for the empty-sprint illustration (optional; BacklogApp passes the versioned path). */
  emptySprintImageUrl?: string;
  /** Opens the create-sprint lightbox (`ctrl.addNewSprint`). */
  onAddSprint: () => void;
  /** Toggles closed-sprints visibility (load/unload + flips `showClosedSprints`). */
  onToggleClosedSprints: () => void;
  /** Toggles a sprint's fold state. */
  onToggleSprintFold: (sprintId: number) => void;
  /** Opens the edit-sprint lightbox for a sprint. */
  onEditSprint: (sprint: SprintModel) => void;
}

/**
 * The Backlog "Sprints" section. See the module doc comment for the full source
 * mapping (sprints.jade:8-60 + sprints.coffee:124-167).
 */
export function SprintList(props: SprintListProps) {
  const {
    openSprints,
    closedSprints,
    totalMilestones,
    totalClosedMilestones,
    showClosedSprints,
    sprintOpen,
    canAddMilestone,
    canViewMilestones,
    canEditSprint,
    canModifyUs,
    buildTaskboardUrl,
    buildUserStoryUrl,
    emptySprintImageUrl,
    onAddSprint,
    onToggleClosedSprints,
    onToggleSprintFold,
    onEditSprint,
  } = props;

  // `href=""` matches the Jade anchors; the handlers call `preventDefault()` so
  // the SPA does not navigate to the empty URL when the link is clicked.
  const handleAdd = (event: MouseEvent) => {
    event.preventDefault();
    onAddSprint();
  };
  const handleToggleClosed = (event: MouseEvent) => {
    event.preventDefault();
    onToggleClosedSprints();
  };

  return (
    <section className="sprints">
      {/* Section header — `header.sprint-header` (sprints.jade:9-24). */}
      <header className="sprint-header">
        <h1>
          {/* `span.number(ng-bind="totalMilestones" ng-if="totalMilestones")` —
              the count badge renders only when there is at least one milestone. */}
          {totalMilestones > 0 ? <span className="number">{totalMilestones}</span> : null}
          {/* `span.title(translate="BACKLOG.SPRINTS.TITLE")`. */}
          <span className="title">SPRINTS</span>
        </h1>
        {/* `a.btn-link(… ng-if="totalMilestones" tg-check-permission="add_milestone")`
            — the header "Add" button gated by BOTH a non-empty sprint list AND the
            `add_milestone` permission. `title` = BACKLOG.SPRINTS.TITLE_ACTION_NEW_SPRINT. */}
        {totalMilestones > 0 && canAddMilestone ? (
          <a className="btn-link" href="" title="Add a sprint" onClick={handleAdd}>
            <span>Add</span>
            <Svg icon="icon-add" />
          </a>
        ) : null}
      </header>

      {/* Empty state — `div.empty-small(ng-if="totalMilestones === 0")`
          (sprints.jade:26-39). */}
      {totalMilestones === 0 ? (
        <div className="empty-small">
          <img
            src={emptySprintImageUrl ?? 'images/empty/empty_sprint.png'}
            alt="There are no sprints yet"
          />
          <p className="title">There are no sprints yet</p>
          {/* `a.btn-link(… tg-check-permission="add_milestone")`. The Jade
              `span  {{…}}` has TWO spaces, so the rendered text keeps ONE LEADING
              space (" Add a sprint"); reproduced verbatim for byte parity. */}
          {canAddMilestone ? (
            <a className="btn-link" href="" onClick={handleAdd} title="">
              <span>{' Add a sprint'}</span>
              <Svg icon="icon-add" />
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Open sprints — `div.sprint.sprint-open(ng-repeat="sprint in
          ctrl.openSprints() track by sprint.id" …)` (sprints.jade:41-47). THIS
          component owns the `.sprint.sprint-open` wrapper; `<Sprint>` renders the
          body. `isOpen` comes from the reducer's per-sprint fold map. */}
      {openSprints.map((sprint) => (
        <div className="sprint sprint-open" key={sprint.id}>
          <Sprint
            sprint={sprint}
            isOpen={Boolean(sprintOpen[sprint.id])}
            canViewMilestones={canViewMilestones}
            canEditSprint={canEditSprint}
            canModifyUs={canModifyUs}
            taskboardUrl={buildTaskboardUrl(sprint)}
            buildUserStoryUrl={buildUserStoryUrl}
            onToggleFold={() => onToggleSprintFold(sprint.id)}
            onEditSprint={() => onEditSprint(sprint)}
          />
        </div>
      ))}

      {/* Closed-sprints toggle — `a.filter-closed-sprints(href=""
          tg-backlog-toggle-closed-sprints-visualization ng-if="totalClosedMilestones")`
          (sprints.jade:49-52). The icon stays `icon-folder`; only the `.text`
          label flips (sprints.coffee:151-162). */}
      {totalClosedMilestones > 0 ? (
        <a className="filter-closed-sprints" href="" onClick={handleToggleClosed}>
          <Svg icon="icon-folder" />
          <span className="text">
            {showClosedSprints ? 'Hide closed sprints' : 'Show closed sprints'}
          </span>
        </a>
      ) : null}

      {/* Closed sprints — `div.sprint.sprint-closed(ng-repeat="sprint in
          closedSprints track by sprint.id" …)` (sprints.jade:54-60). Same wrapper
          pattern as the open sprints; `closed` is passed to `<Sprint>` for API
          compatibility (Sprint treats it as informational — the `.sprint-closed`
          wrapper class is applied HERE). */}
      {closedSprints.map((sprint) => (
        <div className="sprint sprint-closed" key={sprint.id}>
          <Sprint
            sprint={sprint}
            closed
            isOpen={Boolean(sprintOpen[sprint.id])}
            canViewMilestones={canViewMilestones}
            canEditSprint={canEditSprint}
            canModifyUs={canModifyUs}
            taskboardUrl={buildTaskboardUrl(sprint)}
            buildUserStoryUrl={buildUserStoryUrl}
            onToggleFold={() => onToggleSprintFold(sprint.id)}
            onEditSprint={() => onEditSprint(sprint)}
          />
        </div>
      ))}
    </section>
  );
}
