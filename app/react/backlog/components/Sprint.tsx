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

/**
 * Module-local references to the AngularJS custom-element host tags rendered
 * inside a milestone row.
 *
 * `tg-belong-to-epics` and `tg-due-date` are AngularJS directives that are OUT of
 * this folder's component scope to fully re-implement (their Angular directives
 * are not loaded inside `<tg-react-backlog>`). Per the presentational-split rule
 * they are reproduced here as INERT custom-element host tags carrying only the
 * correct tag name + class + primary attributes, so the DOM/SCSS structure
 * matches with zero visual change. This mirrors how `UserStoryRow.tsx` handled
 * `tg-due-date`.
 *
 * The `as unknown as any` cast lets these custom-element tags be used in JSX
 * WITHOUT a cross-file `declare global { namespace JSX }` augmentation, which
 * would conflict with the sibling React files that use this same established
 * pattern (see `UserStoryRow.tsx`, `SprintHeader.tsx`).
 *
 * NOTE (visual-parity critical): the structural class is passed as `class` (NOT
 * `className`) inside the spread. React does not apply its `className` -> `class`
 * mapping to a custom element whose type is a string tag, so `className` would
 * emit a bogus `classname` attribute and the existing `.due-date` /
 * `.us-epic-container` SCSS would never match. Passing `class` directly makes
 * React set the real `class` attribute (matching `UserStoryRow.tsx`).
 */
const TgBelongToEpics = 'tg-belong-to-epics' as unknown as any;
const TgDueDate = 'tg-due-date' as unknown as any;

/**
 * Props for the module-local {@link MilestoneRow}. Mirrors the per-row data the
 * AngularJS `sprint.jade` row read from its `us` scope plus the `modify_us`
 * permission gate and the pre-resolved detail URL.
 */
interface MilestoneRowProps {
  /** The assigned user story (milestone row). */
  us: UserStory;
  /** `modify_us` permission -> row `readonly` class (and enables row dragging). */
  canModifyUs: boolean;
  /** Pre-resolved user-story detail URL for the row anchor. */
  detailUrl: string;
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
function MilestoneRow({ us, canModifyUs, detailUrl }: MilestoneRowProps) {
  // Whole-row drag: `setNodeRef`/`style` mark the sortable node and `attributes`/
  // `listeners` are spread onto the same row element (no `.draggable-us-row`
  // grip). `className` carries `gu-transit` while the row is being dragged so the
  // existing placeholder SCSS applies. `data` carries the moved id for the shared
  // drag-end handler (`event.active.data.current.usId`).
  const { setNodeRef, attributes, listeners, style, className: dndClassName } =
    useSortableRow(us.id, { usId: us.id });

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
  const epics = rec.epics;
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
            {/* Inert epic-pills host (`ng-if="us.epics"`). */}
            {epics ? (
              <TgBelongToEpics
                {...({ class: 'us-epic-container', format: 'pill' } as Record<string, unknown>)}
              />
            ) : null}
            {/* Inert due-date host (`ng-if="us.due_date"`); `class` (not
                `className`) so the real `.due-date` attribute is emitted. */}
            {dueDate ? (
              <TgDueDate
                {...({
                  class: 'due-date',
                  'due-date': dueDate,
                  'is-closed': isClosed,
                  'obj-type': 'us',
                } as Record<string, unknown>)}
              />
            ) : null}
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
    data: { sprintId: sprint.id, isBacklog: false },
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
            userStories.map((us) => (
              <MilestoneRow
                key={us.id}
                us={us}
                canModifyUs={canModifyUs}
                detailUrl={buildUserStoryUrl(us)}
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
