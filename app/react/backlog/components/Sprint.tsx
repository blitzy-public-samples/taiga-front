/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Sprint — one sprint block in the Backlog / Sprint-planning sidebar
 * (composite, render-only).
 *
 * React port of ONE AngularJS sprint block, reproducing three DELETE-marked
 * legacy sources byte-for-byte in DOM structure and behaviour:
 *   - `app/partials/backlog/sprint.jade` — the `tgSprint` template body.
 *   - `app/coffee/modules/backlog/sprints.coffee` — `SprintDirective`
 *     (`tgSprint`, scope `{sprint, project}`) and `BacklogSprintDirective`
 *     (`tgBacklogSprint`, the collapse/expand toggle), together with the
 *     `div.sprint.sprint-open` / `div.sprint.sprint-closed` ng-repeat host from
 *     `app/partials/includes/modules/sprints.jade`.
 *   - `app/coffee/modules/common/components.coffee` — `TgProgressBarDirective`
 *     (`tgProgressBar`, original lines 433-452) for the inline progress bar.
 *
 * RESPONSIBILITIES
 *   - Nests {@link SprintHeader} (from `./SprintHeader`) in the header slot.
 *   - Registers the `.sprint-table` as a `@dnd-kit/core` DROPPABLE container.
 *   - Registers each `.row.milestone-us-item-row` as a `@dnd-kit/core`
 *     DRAGGABLE, via the module-local {@link SprintRow} (one hook per row — a
 *     React hook-rules requirement, since hooks cannot be called inside a
 *     `.map` callback).
 *   - Owns ONLY local collapse UI state (`expanded`).
 *
 * RENDER-TREE (not import-tree) RELATIONSHIP
 *   It is rendered by `BacklogApp` — one `<Sprint>` per milestone — inside
 *   `../dnd/BacklogDndContext` at RUNTIME. This file therefore does NOT import
 *   the DnD context, the `../state` layer, or `../dnd/*`; the
 *   `useDroppable` / `useDraggable` hooks below simply connect to whichever
 *   `DndContext` an ancestor provides. The droppable/draggable `data` shapes
 *   deliberately match `BacklogDndContext`'s exported `BacklogDroppableData`
 *   (`{type:'sprint', sprintId}`) and `BacklogDraggableData`
 *   (`{type:'us', usId, fromSprintId}`) so the ancestor maps every drop
 *   faithfully.
 *
 * RENDER-ONLY: no fetch, no `/api/v1/`, no WebSocket, no business state. It
 * reuses the EXACT existing SCSS class names (verified in
 * `app/styles/modules/backlog/sprints.scss`) for pixel fidelity and neither
 * imports nor rewrites any SCSS.
 *
 * RECONCILED-AGAINST-ACTUAL — SprintHeader has no `expanded` prop
 *   The file summary suggested passing `expanded` to `<SprintHeader>`, but the
 *   authored dependency `./SprintHeader` exposes only
 *   `{ sprint, project, onEditSprint, onToggleCollapse }` (no `expanded`). We
 *   consume its ACTUAL contract and do NOT modify that prerequisite dependency
 *   (matching the "reconcile to the authored contract" precedent used across
 *   the backlog components). The collapse BEHAVIOUR is fully preserved anyway:
 *   this `Sprint` owns the collapse state and the `.sprint-table` `open` class +
 *   display toggle, and lifts the arrow click through `onToggleCollapse`. Only
 *   the `.compact-sprint.active` arrow styling — which lived inside the header —
 *   is the header's own concern.
 *
 * Uses the automatic `jsx: "react-jsx"` runtime, so there is deliberately no
 * `import React`; only the `useState` hook is imported from `react`.
 */

import { useState } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';

import { SprintHeader } from './SprintHeader';
import { can } from '../../shared/permissions';

import type { Milestone, Project, UserStory } from '../../shared/types';

/*
 * Taiga renders inline SVG sprites through its `<tg-svg>` web component, which
 * is not a standard HTML element, so we widen the JSX intrinsic-element table
 * locally (mirroring `SprintHeader` and the kanban components). Typed `any`
 * because the element is opaque to React/TS and is resolved by the existing
 * sprite runtime at render time.
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
 * `tg-svg(svg-icon="…")` markup and the sibling kanban / SprintHeader
 * convention. `className` is forwarded onto the custom element (the sprite
 * runtime reads it); the inner `<svg>` carries the `icon <name>` classes the
 * retained SCSS targets, and `<use>` references the sprite by id. Icon used by
 * this component: `icon-clock` (the due-date badge).
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
 * Props for {@link Sprint}.
 *
 * `project` and `sprint` are the same objects the container (`BacklogApp`)
 * already holds; `Sprint` derives every displayed value and both permission
 * gates from them and stores nothing but its own collapse flag. `onEditSprint`
 * lifts the header's edit intent up to the parent.
 */
export interface SprintProps {
  /** The owning project; supplies `slug`, `my_permissions`, `archived_code`. */
  project: Project;
  /**
   * The sprint (milestone) this block renders. Carries `user_stories`,
   * `closed`, `closed_points`, `total_points`, `estimated_start` /
   * `estimated_finish`, `slug`, and `name`.
   */
  sprint: Milestone;
  /**
   * Forwarded to `<SprintHeader>`'s edit-sprint pencil; the parent
   * (`BacklogApp`) opens `CreateEditSprintLightbox` in edit mode. Reproduces
   * the directive's `$rootScope.$broadcast("sprintform:edit", sprint)`.
   */
  onEditSprint: (sprint: Milestone) => void;
}

/**
 * Props for the module-local {@link SprintRow}.
 */
interface SprintRowProps {
  /** The user story this row renders. */
  us: UserStory;
  /** The owning project (supplies `slug` for the detail link). */
  project: Project;
  /** `can(project, 'modify_us')`, precomputed once by the parent for all rows. */
  canModify: boolean;
  /** Owning sprint id — becomes the draggable's `fromSprintId`. */
  sprintId: number;
}

/**
 * ONE draggable user-story row inside a sprint table.
 *
 * Extracted into its own component so `useDraggable` is called exactly once, at
 * the top level of a component (React's rules of hooks forbid calling a hook
 * inside a `.map` callback).
 *
 * Reproduces `div.row.milestone-us-item-row` from `sprint.jade`:
 *   - `data-id={us.id}` is REQUIRED — `BacklogDndContext` locates candidate rows
 *     by `[data-id]` to compute the drop neighbours (`previousUs` / `nextUs`).
 *   - draggability is gated by `modify_us` (`disabled: !canModify`), mirroring
 *     backlog `sortable.coffee:30`; the authoritative move + permission check
 *     still lives in `BacklogDndContext` — the gate here is for parity.
 *   - `is_blocked`, `epics`, and `due_date` are real runtime `/api/v1/` fields
 *     that are not on the trimmed `UserStory` type, so they are read through the
 *     documented `& Record<string, any>` index-signature cast (per the AAP).
 */
function SprintRow(props: SprintRowProps) {
  const { us, project, canModify, sprintId } = props;

  // Register this row as a @dnd-kit draggable. `data` matches
  // `BacklogDraggableData` ({type:'us', usId, fromSprintId}) exactly so the
  // ancestor `BacklogDndContext` maps drops faithfully. `disabled: !canModify`
  // reproduces the `modify_us` drag gate (backlog sortable.coffee:30).
  const { setNodeRef, attributes, listeners } = useDraggable({
    id: `us-${us.id}`,
    data: { type: 'us', usId: us.id, fromSprintId: sprintId },
    disabled: !canModify,
  });

  // Runtime-only fields (documented in the AAP): not present on the trimmed
  // `UserStory` type, so they are read via the `& Record<string, any>`
  // index-signature cast. This is the ONLY sanctioned `any` in the file.
  const usx = us as UserStory & Record<string, any>;
  const isBlocked = Boolean(usx.is_blocked);
  const epics = usx.epics as
    | Array<{ id: number; ref: number; subject: string; color: string }>
    | undefined;
  const dueDate = usx.due_date as string | undefined;

  // Row classes mirror ng-class="{closedRow: us.is_closed, blockedRow:
  // us.is_blocked}" plus tg-class-permission="{'readonly': '!modify_us'}".
  const rowClass =
    'row milestone-us-item-row' +
    (us.is_closed ? ' closedRow' : '') +
    (isBlocked ? ' blockedRow' : '') +
    (!canModify ? ' readonly' : '');

  // The us-name anchor classes mirror ng-class="{closed: us.is_closed, blocked:
  // us.is_blocked}".
  const usNameClass =
    'us-name clickable' +
    (us.is_closed ? ' closed' : '') +
    (isBlocked ? ' blocked' : '');

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={rowClass}
      data-id={us.id}
    >
      <div className="column-us">
        {/*
          US detail link. `sprint.jade` guarded this with ng-if="us.milestone"
          (always truthy for a story inside a sprint); the same guard is kept.
          `href` is the Taiga HTML5 user-story route; `title` mirrors
          tg-bo-title="'#' + us.ref + ' ' + us.subject".
        */}
        {us.milestone ? (
          <a
            className={usNameClass}
            href={`/project/${project.slug}/us/${us.ref}`}
            title={`#${us.ref} ${us.subject}`}
          >
            {/* tg-bo-ref="us.ref" rendered as "#<ref>". */}
            <span className="us-ref-text">{`#${us.ref}`}</span>
            {/*
              The original bound `us.subject | emojify` via tg-bind-html. We
              render PLAIN TEXT (no dangerouslySetInnerHTML): the emojify filter
              is a presentation-only enhancement, and plain text is the safe,
              faithful baseline for the migrated screen.
            */}
            <span className="us-name-text">{us.subject}</span>

            {/*
              Epics pills — reproduces `tg-belong-to-epics format="pill"`
              (ng-if="us.epics"). One pill per epic, coloured by `epic.color`;
              the tooltip mirrors "#<ref> <subject>".
            */}
            {epics && epics.length > 0 ? (
              <span className="us-epic-container">
                {epics.map((epic) => (
                  <span className="belong-to-epic-pill-wrapper" key={epic.id}>
                    <span
                      className="belong-to-epic-pill"
                      style={{ background: epic.color }}
                      title={`#${epic.ref} ${epic.subject}`}
                    />
                  </span>
                ))}
              </span>
            ) : null}

            {/*
              Due-date badge — a simplified, render-only reproduction of the
              original `tgDueDate` component (ng-if="us.due_date"). Preserves the
              `.due-date` / `.due-date-icon` SCSS targets; the clock glyph is the
              `icon-clock` sprite, and the raw date is surfaced as the tooltip.
            */}
            {dueDate ? (
              <span className="due-date" title={dueDate}>
                {svgIcon('icon-clock', 'due-date-icon')}
              </span>
            ) : null}
          </a>
        ) : null}
      </div>

      {/*
        Points column — ng-if="us.total_points". Classes mirror
        ng-class="{closed: us.is_closed, blocked: us.is_blocked}" and the value
        mirrors tg-bo-bind="us.total_points".
      */}
      {us.total_points ? (
        <div
          className={
            'column-points width-1' +
            (us.is_closed ? ' closed' : '') +
            (isBlocked ? ' blocked' : '')
          }
        >
          <span className="points-container">{us.total_points}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The sprint block.
 *
 * Behaviour reproduces the AngularJS directives EXACTLY:
 *   - COLLAPSE (`BacklogSprintDirective`, sprints.coffee L25-47): open sprints
 *     start expanded (the directive ran `toggleSprint` once at init, adding
 *     `active` + `open`); closed sprints start collapsed (only `sprint-closed`
 *     was added, never `open`). Hence `useState(!sprint.closed)`. The header's
 *     compact-sprint arrow lifts its click through `onToggleCollapse`, which
 *     flips `expanded`; this component owns the resulting `.sprint-table` `open`
 *     class and the display toggle (the React equivalent of the directive's
 *     jQuery `slideToggle` end-state — the animation is intentionally dropped,
 *     the behaviour preserved).
 *   - INLINE PROGRESS BAR (COMMON `tgProgressBar`, components.coffee L433-452):
 *     a single `.current-progress` div whose width is
 *     `100 * closed_points / total_points`, clamped to `[0, 100]` with NO
 *     rounding (mirrors `_.max([0, …])` then `_.min([100, …])`). A finite-guard
 *     maps divide-by-zero (`total_points` 0/absent) to 0. NOTE: this is the
 *     COMMON progress bar inlined, NOT the backlog-summary `ProgressBar`
 *     component.
 *   - DROPPABLE `.sprint-table` (backlog sortable.coffee `isContainer`): the
 *     table keeps its `sprint-table` class (the DnD container detection relies
 *     on it) and receives the droppable ref.
 *   - EMPTY MESSAGE (dual permission spans): both spans always render; the
 *     `hidden` class is toggled per `modify_us` exactly as the original
 *     `tg-class-permission` did, so the SCSS the design targets is unchanged.
 *   - TASKBOARD LINK (`a.btn-small`, gated `view_milestones`) sits OUTSIDE the
 *     `.sprint-table`, as a sibling, matching `sprint.jade`.
 *
 * Render-only: no state beyond `expanded`, no network, no side effects.
 */
export const Sprint = (props: SprintProps) => {
  const { project, sprint, onEditSprint } = props;

  // COLLAPSE: open sprints start expanded, closed sprints start collapsed
  // (BacklogSprintDirective init behaviour, sprints.coffee L33-39).
  const [expanded, setExpanded] = useState<boolean>(!sprint.closed);

  // `modify_us` gate — drives row draggability and the empty-message spans
  // (backlog sortable.coffee:30). Computed once and shared by every row.
  const canModify = can(project, 'modify_us');

  // Defensive guard: `user_stories` is `UserStory[]` on the type, but guard
  // against a not-yet-hydrated milestone.
  const stories = sprint.user_stories ?? [];

  // INLINE PROGRESS: 100 * closed / total, clamped to [0, 100] with NO rounding
  // (TgProgressBarDirective, components.coffee L442-445). The finite-guard maps
  // divide-by-zero (total 0 / absent) to 0.
  const rawPct =
    (100 * (sprint.closed_points ?? 0)) / (sprint.total_points ?? 0);
  const progressPct = Number.isFinite(rawPct)
    ? Math.min(100, Math.max(0, rawPct))
    : 0;

  // DROPPABLE sprint table. `data` matches `BacklogDroppableData`'s sprint
  // variant ({type:'sprint', sprintId}) so the ancestor context resolves the
  // drop target. Only the node ref is needed here.
  const { setNodeRef: setDropRef } = useDroppable({
    id: `sprint-${sprint.id}`,
    data: { type: 'sprint', sprintId: sprint.id },
  });

  // Mirrors ng-class="{'sprint-empty-wrapper': !sprint.user_stories.length}"
  // plus the directive's `open` toggle. The `sprint-table` class MUST be kept —
  // the DnD container detection relies on it.
  const sprintTableClass =
    'sprint-table' +
    (expanded ? ' open' : '') +
    (stories.length ? '' : ' sprint-empty-wrapper');

  return (
    <div className={`sprint ${sprint.closed ? 'sprint-closed' : 'sprint-open'}`}>
      {/*
        The source used a bare `header(tg-backlog-sprint-header)` element; we
        preserve the `<header>` tag for DOM fidelity and render the summary via
        <SprintHeader>. Its ACTUAL contract has no `expanded` prop (see the
        RECONCILED-AGAINST-ACTUAL note at the top of the file), so only the four
        real props are passed; `onToggleCollapse` flips this component's own
        collapse state.
      */}
      <header>
        <SprintHeader
          sprint={sprint}
          project={project}
          onEditSprint={onEditSprint}
          onToggleCollapse={() => setExpanded((e) => !e)}
        />
      </header>

      {/*
        Inline COMMON tgProgressBar: a single `.current-progress` whose width is
        the clamped percentage. NOT the backlog-summary ProgressBar component.
      */}
      <div className="summary-progress-wrapper">
        <div className="sprint-progress-bar">
          <div
            className="current-progress"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/*
        Droppable sprint table. Keeps the `sprint-table` class + droppable ref.
        The inline `display` toggle is the React equivalent of the directive's
        jQuery `slideToggle` END-STATE (`.sprint-closed .sprint-table {display:
        none}` in SCSS; `.sprint-table` is a plain block, so `block` is safe).
        The animation is intentionally dropped; the behaviour is preserved.
      */}
      <div
        ref={setDropRef}
        className={sprintTableClass}
        style={{ display: expanded ? 'block' : 'none' }}
      >
        {stories.length === 0 ? (
          <div className="sprint-empty">
            {/*
              Dual permission spans, faithful to the original
              `tg-class-permission`: BOTH spans always render, and the `hidden`
              class is toggled so exactly one is visible.
              Anonymous span (WARNING_EMPTY_SPRINT_ANONYMOUS): gets `hidden` WHEN
              the user HAS modify_us → visible only WITHOUT modify_us.
            */}
            {/* i18n: BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT_ANONYMOUS */}
            <span className={canModify ? 'hidden' : undefined}>
              This sprint has no user stories
            </span>
            {/*
              Has-permission span (WARNING_EMPTY_SPRINT): gets `hidden` WHEN the
              user LACKS modify_us → visible only WITH modify_us.
            */}
            {/* i18n: BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT */}
            <span className={!canModify ? 'hidden' : undefined}>
              Drop here Stories from your backlog to start a new sprint
            </span>
          </div>
        ) : (
          stories.map((us) => (
            <SprintRow
              key={us.id}
              us={us}
              project={project}
              canModify={canModify}
              sprintId={sprint.id}
            />
          ))
        )}
      </div>

      {/*
        Taskboard link — sibling of `.sprint-table`, gated on `view_milestones`
        (tg-check-permission). The non-standard `variant="secondary"` attribute
        is reproduced verbatim for parity (React forwards unknown lowercase
        attributes straight to the DOM).
      */}
      {can(project, 'view_milestones') ? (
        <a
          className="btn-small"
          href={`/project/${project.slug}/taskboard/${sprint.slug ?? ''}`}
          title={`Go to Taskboard of "${sprint.name}"`}
          {...{ variant: 'secondary' }}
        >
          {/* i18n: BACKLOG.SPRINTS.LINK_TASKBOARD */}
          <span>Sprint Taskboard</span>
        </a>
      ) : null}
    </div>
  );
};
