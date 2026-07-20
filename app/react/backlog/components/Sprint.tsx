/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Sprint — React port of ONE Backlog sprint (`app/partials/backlog/sprint.jade`).
 *
 * Presentational (stateless) component that renders the body of a single sprint
 * card: the sprint header, its thin progress bar, the drag-and-drop table of the
 * milestone (assigned) user-story rows, and the "go to taskboard" link. It is the
 * React reproduction of the AngularJS `tgSprint` directive template
 * (`templateUrl: 'backlog/sprint.html'`, sprints.coffee:169-180) and is rendered
 * once per sprint by the sibling `SprintList.tsx`.
 *
 * COMPONENT BOUNDARY (critical): in `sprints.jade` each sprint is wrapped by
 * `div.sprint.sprint-open` / `div.sprint.sprint-closed` (the `tgBacklogSprint`
 * host). That OUTER wrapper is owned by `SprintList.tsx`, NOT here. This component
 * reproduces ONLY `sprint.jade` and therefore returns a React FRAGMENT whose four
 * top-level siblings are exactly `<header>`, `.summary-progress-wrapper`,
 * `.sprint-table`, and the conditional `a.btn-small` — never the `.sprint`
 * wrapper.
 *
 * The component reproduces the EXACT DOM structure and CSS class names of the
 * original AngularJS markup so the existing compiled global SCSS renders it with
 * ZERO visual change (AAP 0.3.4). No stylesheet or asset is imported.
 *
 * Behavioral & markup sources (REFERENCE ONLY — never imported):
 *  - app/partials/backlog/sprint.jade — the EXACT DOM reproduced here (header,
 *    progress wrapper, `.sprint-table`, empty state, `.milestone-us-item-row`
 *    rows, and the bottom `.btn-small` taskboard link).
 *  - app/coffee/modules/backlog/sprints.coffee:18-60 (`tgBacklogSprint`) — the
 *    fold/toggle behaviour: `toggleSprint` flips `.compact-sprint.active` AND
 *    `.sprint-table.open` TOGETHER; open sprints init expanded, closed sprints
 *    stay collapsed (`.sprint-closed`, owned by `SprintList`). Expressed here
 *    declaratively through the `isOpen` prop + the `.compact-sprint`/`.open`
 *    class + inline `display` (the AngularJS `slideToggle` resting state).
 *  - app/coffee/modules/backlog/sprints.coffee:169-180 (`tgSprint`) — confirms
 *    this component IS the `sprint.jade` template with scope `{sprint, project}`.
 *  - app/coffee/modules/backlog/sortable.coffee:43-47 — the sprint rows are
 *    draggable with NO dedicated handle (`moves: (item) -> $(item).hasClass('row')`),
 *    so the WHOLE `.milestone-us-item-row` is the drag handle (unlike the backlog
 *    body rows, which use a `.draggable-us-row` grip). The row therefore spreads
 *    BOTH `attributes` and `listeners`. The `.sprint-table` is the drop container
 *    (`isContainer: (el) -> el.classList.contains('sprint-table')`), reproduced
 *    with `useDroppable`.
 *  - Styling (REFERENCE ONLY, never imported): app/styles/modules/backlog/sprints.scss —
 *    `.sprint-table` has no `.open` rule (the `open` class is a non-visual
 *    slideToggle marker; visibility is driven by inline `display`);
 *    `.sprint-closed .sprint-table { display:none }`; `.us-ref-text` has NO
 *    trailing margin, so the load-bearing separator between the ref and the name
 *    is the TRAILING SPACE rendered by `tgBoRef` (`$el.html("##{val} ")`,
 *    base/bind.coffee:28-32).
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration of the Backlog
 * screen (AAP Section 0). This is the first NON-LEAF backlog component: it
 * composes `SprintHeader` + `ProgressBar` and owns its OWN `<SortableContext>` +
 * `useDroppable`; the shared `<DndContext>` is supplied once by `BacklogApp` (via
 * `DndProvider`), never here. Uses the automatic JSX runtime (`jsx: "react-jsx"`),
 * so React is intentionally NOT imported as a value; the reducer models are
 * type-only imports (required by `isolatedModules: true`).
 */

// Reducer models are TYPE-only imports (required by `isolatedModules: true`). The
// reducer's `Sprint` type is aliased to `SprintModel` so it does not collide with
// this component's own name `Sprint`.
import type { Sprint as SprintModel, UserStory } from '../state/backlogReducer';
// Sibling presentational children (the `<header>` content and the sprint bar).
import { SprintHeader } from './SprintHeader';
import { ProgressBar } from './ProgressBar';
// @dnd-kit wiring: the row sortable hook, the per-sprint sortable context, and the
// droppable that lets stories be dropped INTO this sprint (including empty ones).
import { useSortableRow } from '../../shared/dnd/sortable';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
// Native due-date badge + epic-pill colour helper (M-10 / M-11): replace the
// previously-inert `tg-belong-to-epics` / `tg-due-date` directive hosts.
import { DueDateBadge } from '../../shared/components/DueDateBadge';
import type { DueDateProject } from '../../shared/dueDate';
import { darker } from '../../shared/color';

/**
 * Milestone-row sub-widgets — the epic pills and the due-date badge — are now
 * rendered NATIVELY (M-10 / M-11), replacing the previously-inert
 * `tg-belong-to-epics` / `tg-due-date` custom-element hosts (their AngularJS
 * directives never $compiled inside `<tg-react-backlog>`, so the epic pills and
 * the due-date clock were missing entirely on the sprint rows):
 *
 *   - Epic pills reproduce `belong-to-epics-pill.jade` (the `format="pill"`
 *     template the `tg-belong-to-epics(class="us-epic-container" format="pill")`
 *     host used): a `.us-epic-container` wrapper holding one
 *     `.belong-to-epic-pill-wrapper > .belong-to-epic-pill` per epic, each with
 *     `background: epic.color` + `border-color: darker(color, -0.2)` and a
 *     `"#<ref> <subject>"` title (rendered inline below).
 *   - The due-date badge reproduces `due-date-icon.jade` via the shared
 *     `DueDateBadge` component (identical to `UserStoryRow.tsx`).
 *
 * The `.us-epic-container` host keeps the original `tg-belong-to-epics` tag name
 * so the compiled DOM matches; `class` (NOT `className`) is used on it for the
 * same reason as elsewhere (React does not map `className -> class` on custom
 * elements, and the existing `.us-epic-container` SCSS matches on the class).
 */
const TgBelongToEpics = 'tg-belong-to-epics' as unknown as any;

/** A single epic as read off a milestone row's `us.epics` list. */
interface SprintRowEpic {
  ref: number | string;
  subject: string;
  color?: string;
}

/**
 * Props for the module-local {@link MilestoneRow}. Mirrors the per-row data the
 * AngularJS `sprint.jade` row read from its `us` scope plus the `modify_us`
 * permission gate and the pre-resolved detail URL.
 */
interface MilestoneRowProps {
  /** The assigned user story (milestone row). */
  us: UserStory;
  /**
   * Id of the sprint this row belongs to. Threaded into the row's
   * `useSortableRow` drag `data` as `sprintId` so the shared backlog drag-end
   * handler resolves the DESTINATION sprint even when a drop lands on THIS row
   * (a sibling) rather than the sprint's container droppable — the same reason
   * the Kanban `Card` carries `statusId`/`swimlaneId` (Card.tsx:590). Without
   * it, `overData` carried only `{ usId }`, `targetSprintId` resolved to
   * `null`, and the `bulk_update_backlog_order` write omitted `milestone_id`
   * -> backend 400 (QA BL-1).
   */
  sprintId: number;
  /**
   * Zero-based position within this sprint's ordered story list -> drag
   * `data.oldIndex` (source index for the handler's same-container no-op guard,
   * `backlog/sortable.coffee:120-121`).
   */
  index: number;
  /** `modify_us` permission -> row `readonly` class (and enables row dragging). */
  canModifyUs: boolean;
  /** Pre-resolved user-story detail URL for the row anchor. */
  detailUrl: string;
  /**
   * The resolved project — passed to the due-date badge so it reads the per-type
   * `us_duedates` appearance override. Optional; the default appearance config is
   * used when absent.
   */
  project?: DueDateProject;
}

/**
 * One `.row.milestone-us-item-row` inside a sprint's `.sprint-table`
 * (reproduces `sprint.jade:17-53`).
 *
 * Declared as a module-local, non-exported component because it calls the
 * `useSortableRow` hook, and hooks cannot be called inside the parent's `.map()`
 * callback. Unlike the backlog body rows, milestone rows have NO dedicated drag
 * grip: the WHOLE row is the drag handle (`sortable.coffee:43-47`), so both
 * `attributes` and `listeners` are spread onto the row element itself.
 */
function MilestoneRow({ us, sprintId, index, canModifyUs, detailUrl, project }: MilestoneRowProps) {
  // Whole-row drag: `setNodeRef`/`style` mark the sortable node and `attributes`/
  // `listeners` are spread onto the same row element (no `.draggable-us-row`
  // grip). `className` carries `gu-transit` while the row is being dragged so the
  // existing placeholder SCSS applies. `data` carries the FULL container identity
  // (not just `usId`): the shared drag-end handler reads it off BOTH `event.active`
  // AND `event.over` (when a drop lands on this row instead of the sprint's
  // container droppable), so `sprintId`/`isBacklog` here are what let a within-sprint
  // reorder that drops onto a sibling STORY still resolve `targetSprintId` (from
  // `overData['sprintId']`) -> `milestone_id` is included in
  // `bulk_update_backlog_order` and the backend returns 200 (BL-1), rather than
  // collapsing to the backlog. `oldIndex` is the source index for the
  // same-container no-op guard. Mirrors the Kanban `Card` (Card.tsx:590).
  const { setNodeRef, attributes, listeners, style, className: dndClassName } =
    useSortableRow(
      us.id,
      { usId: us.id, sprintId, isBacklog: false, oldIndex: index },
      // BL-3: gate dragging by `modify_us` (mirrors `BacklogTable.tsx` and the
      // Angular `sortable.coffee:29-31` permission gate), so a readonly user can
      // NEVER initiate a drag or fire `bulk_update_backlog_order`.
      { disabled: !canModifyUs },
    );

  // Field coercion: `UserStory` types only a handful of fields explicitly;
  // everything else arrives through the reducer's `[key: string]: unknown` index
  // signature, so these reads MUST be coerced to the concrete shape the markup
  // needs (a bare `us.is_closed` would be typed `unknown` and fail strict
  // compilation / could render `"undefined"`).
  const rec = us as Record<string, unknown>;
  const isClosed = Boolean(rec.is_closed);
  const isBlocked = Boolean(rec.is_blocked);
  const subject = String(rec.subject ?? '');
  const dueDate = rec.due_date;
  // Coerce `us.epics` (arriving via the reducer's `[key: string]: unknown` index
  // signature) to the concrete shape the epic pills need; empty when absent
  // (the legacy `ng-if="us.epics"` gate).
  const epics = (rec.epics as SprintRowEpic[] | undefined) ?? [];
  const totalPoints = us.total_points;

  // Row class list. `closedRow`/`blockedRow` reproduce
  // `ng-class="{closedRow: us.is_closed, blockedRow: us.is_blocked}"`; `readonly`
  // reproduces `tg-class-permission="{'readonly': '!modify_us'}"` (present when the
  // user CANNOT modify user stories); the hook's `className` appends `gu-transit`
  // while dragging.
  const rowClasses = ['row', 'milestone-us-item-row'];
  if (isClosed) rowClasses.push('closedRow');
  if (isBlocked) rowClasses.push('blockedRow');
  if (!canModifyUs) rowClasses.push('readonly');
  if (dndClassName) rowClasses.push(dndClassName);

  // Anchor class list reproduces `ng-class="{closed: us.is_closed, blocked:
  // us.is_blocked}"` on the `a.us-name.clickable` link.
  const anchorClasses = ['us-name', 'clickable'];
  if (isClosed) anchorClasses.push('closed');
  if (isBlocked) anchorClasses.push('blocked');

  return (
    <div
      ref={setNodeRef}
      className={rowClasses.join(' ')}
      data-id={us.id}
      style={style}
      {...attributes}
      {...listeners}
    >
      <div className="column-us">
        {/* Rendered only when the story is assigned to a milestone
            (`ng-if="us.milestone"`). `title` reproduces
            `tg-bo-title="'#' + us.ref + ' ' + us.subject"`. */}
        {us.milestone ? (
          <a
            className={anchorClasses.join(' ')}
            href={detailUrl}
            title={`#${us.ref} ${subject}`}
          >
            {/* `tgBoRef` renders `"#<ref> "` WITH a trailing space — the
                load-bearing separator between the ref and the name (there is no
                CSS margin on `.us-ref-text`). */}
            <span className="us-ref-text">{`#${us.ref} `}</span>
            <span className="us-name-text">{subject}</span>
            {/* Epic pills (M-10) — native reproduction of the
                `tg-belong-to-epics(format="pill")` directive (`ng-if="us.epics"`).
                One `.belong-to-epic-pill-wrapper > .belong-to-epic-pill` per epic;
                each pill's background is the epic colour and its border-color is
                `darker(color, -0.2)` (belong-to-epics-pill.jade), with a
                `"#<ref> <subject>"` title. The pill is an empty coloured dot. */}
            {epics.length ? (
              <TgBelongToEpics {...({ class: 'us-epic-container' } as Record<string, unknown>)}>
                {epics.map((epic, i) => (
                  <span className="belong-to-epic-pill-wrapper" key={`epic-${i}`}>
                    <div
                      className="belong-to-epic-pill"
                      title={`#${String(epic.ref)} ${epic.subject}`}
                      style={
                        epic.color
                          ? { background: epic.color, borderColor: darker(epic.color, -0.2) }
                          : undefined
                      }
                    />
                  </span>
                ))}
              </TgBelongToEpics>
            ) : null}
            {/* Due-date badge (M-11) — native `.due-date` > `.due-date-icon`
                clock (`ng-if="us.due_date"`), rendered by the shared
                `DueDateBadge` (identical to the backlog rows). */}
            {dueDate ? <DueDateBadge dueDate={String(dueDate)} project={project} /> : null}
          </a>
        ) : null}
      </div>
      {/* Points cell, rendered only when the story has points
          (`ng-if="us.total_points"`); `closed`/`blocked` reproduce the row's
          `ng-class`. `tgBoBind` renders the plain total-points value. */}
      {totalPoints ? (
        <div
          className={`column-points width-1${isClosed ? ' closed' : ''}${
            isBlocked ? ' blocked' : ''
          }`}
        >
          <span className="points-container">{totalPoints}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Props for {@link Sprint}. The sprint model arrives from the reducer; the fold
 * state, the three permission gates, the pre-resolved taskboard URL, the
 * detail-URL builder, and the two interaction callbacks all arrive from the
 * parent (`SprintList`/`BacklogApp`), keeping this component purely
 * presentational (no API calls, event subscriptions, or nav-service access).
 */
export interface SprintProps {
  /** The sprint (milestone) to render — from state/backlogReducer. */
  sprint: SprintModel;
  /** Fold state from the reducer (`sprintOpen[sprint.id]`); true = expanded. Open sprints init to true, closed to false. */
  isOpen: boolean;
  /** `view_milestones` permission -> shows the SprintHeader taskboard link + the bottom `.btn-small` link. */
  canViewMilestones: boolean;
  /** `!project.archived_code && modify_milestone` -> shows the SprintHeader edit-sprint pencil. */
  canEditSprint: boolean;
  /** `modify_us` permission -> row `readonly` class + enables row dragging. */
  canModifyUs: boolean;
  /** Pre-resolved taskboard URL for this sprint (used by SprintHeader link AND the bottom `.btn-small`). */
  taskboardUrl: string;
  /** Builds the user-story detail URL for a milestone row anchor. */
  buildUserStoryUrl: (us: UserStory) => string;
  /**
   * The resolved project — threaded to each milestone row's due-date badge so it
   * reads the per-type `us_duedates` appearance override. Optional; the default
   * appearance config is used when absent.
   */
  project?: DueDateProject;
  /** Toggles this sprint's fold state (wired to the `.compact-sprint` button inside SprintHeader). */
  onToggleFold: () => void;
  /** Opens the edit-sprint lightbox (wired to the `.edit-sprint` pencil inside SprintHeader). */
  onEditSprint: () => void;
  /**
   * Informational only: whether this sprint is closed. The `.sprint-closed`
   * wrapper class is applied by `SprintList`, so this component does not need it
   * structurally. Accepted as optional for API compatibility with `<Sprint closed>`.
   */
  closed?: boolean;
}

/**
 * Renders the body of one Backlog sprint. See the module doc comment for the full
 * source mapping (sprint.jade + sprints.coffee:18-60,169-180 +
 * sortable.coffee:43-47 + sprints.scss).
 */
export function Sprint(props: SprintProps) {
  const {
    sprint,
    isOpen,
    canViewMilestones,
    canEditSprint,
    canModifyUs,
    taskboardUrl,
    buildUserStoryUrl,
    onToggleFold,
    onEditSprint,
    project,
  } = props;

  // Point values. `sprint.total_points` is a declared `number`, but
  // `sprint.closed_points` arrives through the model's `[key: string]: unknown`
  // index signature, so both are coerced to a concrete `number` here (mirroring
  // the AngularJS `sprint.closed_points or 0` / `sprint.total_points or 0`
  // defaults, sprints.coffee:92-93). SprintHeader and ProgressBar both apply their
  // own fallbacks, so passing a plain number is safe.
  const closedPoints = Number(sprint.closed_points) || 0;
  const totalPoints = Number(sprint.total_points) || 0;

  // The assigned user stories and their ids (the SortableContext item set).
  const userStories = sprint.user_stories ?? [];
  const itemIds = userStories.map((us) => us.id);

  // Droppable container so stories can be dropped INTO this sprint (including
  // empty sprints). Reproduces `isContainer: (el) -> el.classList.contains(
  // 'sprint-table')` (sortable.coffee:42). The shared drag-end handler reads
  // `event.over?.data.current` for `{ sprintId, isBacklog }` to resolve the drop
  // target (see shared/dnd/types `BacklogDragResult`).
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `sprint-${sprint.id}`,
    // `orderedIds` lets the drag-end handler compute adjacency when a drop lands
    // on the sprint's EMPTY SPACE (the container itself) rather than a sibling
    // row — the moved story is then appended after the existing rows, matching
    // dragula dropping into empty container space (backlog/sortable.coffee).
    data: { sprintId: sprint.id, isBacklog: false, orderedIds: itemIds },
  });

  // `.sprint-table` class list: base `sprint-table`, plus `sprint-empty-wrapper`
  // when there are no stories (`ng-class="{'sprint-empty-wrapper':
  // !sprint.user_stories.length}"`), plus the non-visual `open` slideToggle marker
  // when expanded. Visibility itself is driven by the inline `display` below,
  // reproducing the AngularJS `slideToggle` resting state (there is no
  // `.sprint-table.open` CSS rule; a closed sprint is hidden by
  // `.sprint-closed .sprint-table { display:none }`, and closed sprints have
  // `isOpen === false`).
  const sprintTableClasses = ['sprint-table'];
  if (userStories.length === 0) sprintTableClasses.push('sprint-empty-wrapper');
  if (isOpen) sprintTableClasses.push('open');

  return (
    <>
      {/* (1) Header — the AngularJS `tgBacklogSprintHeader` directive did
          `$el.html(compiledTemplate)`, so the real DOM is `<header>` WRAPPING the
          `.sprint-summary` that `SprintHeader` renders (sprints.coffee:103). */}
      <header>
        <SprintHeader
          name={sprint.name}
          estimatedStart={sprint.estimated_start}
          estimatedFinish={sprint.estimated_finish}
          closedPoints={closedPoints}
          totalPoints={totalPoints}
          taskboardUrl={taskboardUrl}
          isVisible={canViewMilestones}
          isEditable={canEditSprint}
          isOpen={isOpen}
          onToggleFold={onToggleFold}
          onEdit={onEditSprint}
        />
      </header>

      {/* (2) Progress bar — `ProgressBar variant="sprint"` renders the
          `.sprint-progress-bar` host itself and computes the width internally, so
          it is NOT wrapped in another `.sprint-progress-bar` here. */}
      <div className="summary-progress-wrapper">
        <ProgressBar variant="sprint" closedPoints={closedPoints} totalPoints={totalPoints} />
      </div>

      {/* (3) Sprint table — the droppable container + the per-sprint sortable
          context. Inline `display` reproduces the `slideToggle` resting state. */}
      <div
        ref={setDroppableRef}
        className={sprintTableClasses.join(' ')}
        style={{ display: isOpen ? 'block' : 'none' }}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {userStories.length === 0 ? (
            <div className="sprint-empty">
              {/* `tg-class-permission="{'hidden': 'modify_us'}"` -> `hidden` when
                  the user HAS `modify_us` (this anonymous/read-only message is
                  shown only to users WITHOUT edit rights). */}
              <span className={canModifyUs ? 'hidden' : undefined}>
                This sprint has no user stories
              </span>
              {/* `tg-class-permission="{'hidden': '!modify_us'}"` -> `hidden` when
                  the user does NOT have `modify_us` (this drop hint is shown only
                  to editors). */}
              <span className={!canModifyUs ? 'hidden' : undefined}>
                Drop here Stories from your backlog to start a new sprint
              </span>
            </div>
          ) : (
            userStories.map((us, index) => (
              <MilestoneRow
                key={us.id}
                us={us}
                sprintId={sprint.id}
                index={index}
                canModifyUs={canModifyUs}
                detailUrl={buildUserStoryUrl(us)}
                project={project}
              />
            ))
          )}
        </SortableContext>
      </div>

      {/* (4) Taskboard link — gated by `view_milestones`
          (`tg-check-permission="view_milestones"`). `variant="secondary"` is a
          non-standard attribute carried verbatim from the Jade. */}
      {canViewMilestones ? (
        <a
          className="btn-small"
          href={taskboardUrl}
          title={`Go to Taskboard of "${sprint.name}"`}
          {...({ variant: 'secondary' } as Record<string, unknown>)}
        >
          <span>Sprint Taskboard</span>
        </a>
      ) : null}
    </>
  );
}
