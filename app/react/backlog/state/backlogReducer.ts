/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * backlogReducer
 * --------------
 * immer-based Backlog state reducer for the React Backlog screen.
 *
 * This module reproduces the behaviour of the AngularJS 1.5.10 Backlog feature
 * as part of the AngularJS -> React 18 coexistence migration:
 *   - `BacklogController`             app/coffee/modules/backlog/main.coffee
 *   - sprint fold/toggle directives   app/coffee/modules/backlog/sprints.coffee
 *   - sprint add/edit lightbox        app/coffee/modules/backlog/lightboxes.coffee
 *   - drag-and-drop semantics         app/coffee/modules/backlog/sortable.coffee
 *
 * The legacy controller stored the board in Immutable.js collections
 * (`@scope.swimlanesList = Immutable.List()`, main.coffee:86; sprint/us maps as
 * `Immutable.Map`); here those persistent collections are REPLACED by plain
 * TypeScript objects and arrays that are updated immutably with immer's
 * `produce()`. immer auto-freezes every produced state, giving us the same
 * "never mutate in place" guarantee the Immutable.js collections previously
 * provided, WITHOUT the Immutable.js API. Because every field is a plain
 * object/array (never `Map`/`Set`), immer's `enableMapSet()` is intentionally
 * NOT required.
 *
 * COEXISTENCE BOUNDARY (AAP section 0.4.2 / 0.7 - HARD RULES):
 *   - The ONLY runtime module this file imports is the npm package `immer`.
 *     Nothing is imported from the AngularJS/CoffeeScript tree (app/coffee,
 *     app/modules, app/partials, app/styles) or the compiled `elements` bundle
 *     - the controller is reproduced here from its documented behaviour, never
 *     imported.
 *   - The three sibling imports are TYPE-ONLY (`import type`), so nothing is
 *     emitted at runtime and the globals-only boundary is preserved.
 *   - The word "Immutable" appears in this file only inside explanatory
 *     comments such as this one; there is no `immutable` dependency.
 *   - Every export is pure and deterministic: `(state, ...args) => value`.
 *     There are NO side effects - no `window`, DOM, network, timers, logging,
 *     `moment`, `lodash` or `$translate`. Any value the AngularJS code resolved
 *     from "now" (`new Date().getTime()` in `findCurrentSprint`, main.coffee:697;
 *     `moment()` in the sprint-form defaults, lightboxes.coffee:154,163) or from
 *     a permission check (`projectService.canEdit('delete_milestone')`) is
 *     INJECTED as a parameter (`nowMs` / `nowYmd` / `canDelete`) so the reducer
 *     stays framework-agnostic and trivially unit-testable.
 *
 * SERVER CONTRACT (frozen `/api/v1/`): two DISTINCT bulk paths flow through this
 * reducer and MUST NOT be conflated (see the payload types below):
 *   1. DRAG reorder      -> `bulkUpdateBacklogOrder` : `bulkUserstories` is a
 *                           `number[]` of moved user-story ids.
 *   2. TOOLBAR move-to-sprint -> `bulkUpdateMilestone` : `bulkStories` is an
 *                           array of `{ us_id, order }` objects.
 */

import { produce } from 'immer';

import type { BacklogDragResult, UsId } from '../../shared/dnd/types';
import type { Milestone } from '../../shared/api/milestones';
import type { BulkOrderItem } from '../../shared/api/userstories';

/* ------------------------------------------------------------------ *
 * Type definitions
 * ------------------------------------------------------------------ */

/**
 * Raw backlog user-story payload as delivered by `/api/v1/`. In the AngularJS
 * controller this was an Angular model whose `getAttrs()` returned the plain
 * attributes; in React the raw JSON object IS that attributes object. Only the
 * fields the backlog logic actually consumes are described explicitly; the
 * index signature tolerates the rest of the (large) user-story payload.
 */
export interface UserStory {
  id: number;
  /** `visibleUserStories` collects `us.ref` (main.coffee:379-380). */
  ref: number;
  /** Sprint id, or `null` for the backlog list (moveUs `oldSprintId = usList[0].milestone`, main.coffee:524). */
  milestone: number | null;
  /** `moveUs project = usList[0].project` (main.coffee:525). */
  project: number;
  /** Ordering key in the backlog list (main.coffee:377,386). */
  backlog_order: number;
  /** Ordering key within a sprint (main.coffee:292,318; toolbar order). */
  sprint_order: number;
  /** Points math (`sprintTotalPoints`, `moveUssToSprint`). */
  total_points: number;
  status?: number;
  /** Set `true` when `newUs.includes(id)` (main.coffee:383-384). */
  new?: boolean;
  /** `[name, color]` tuples; color may be null. */
  tags?: Array<[string, string | null]>;
  [key: string]: unknown; // tolerate the full user-story payload
}

/**
 * A sprint/milestone. Sprint objects come from the milestones API
 * (`rs.sprints.list` -> `milestones`), so `Sprint` extends the shared
 * `Milestone` and narrows/requires the fields the reducer needs with its
 * `user_stories` populated:
 *   - `closed`       : required here (optional on `Milestone`).
 *   - `total_points` : the toolbar bumps `sprint.total_points` (main.coffee:792).
 *   - `user_stories` : narrowed from `Milestone.user_stories?: unknown[]`.
 */
export interface Sprint extends Milestone {
  closed: boolean;
  total_points: number;
  user_stories: UserStory[];
}

/** Opaque project record (the resolved project; `moveUssToSprint` reads `project.id`). */
export interface Project {
  id: number;
  [key: string]: unknown;
}

/**
 * PROJECT stats payload (`rs.projects.stats`) plus the derived
 * `completedPercentage`. Reproduces `loadProjectStats` (main.coffee:256-268).
 */
export interface BacklogStats {
  total_points?: number;
  defined_points?: number;
  closed_points?: number;
  assigned_points?: number;
  speed?: number;
  total_milestones?: number;
  /** Derived: `round(100 * closed_points / totalPoints)` (main.coffee:262/264). */
  completedPercentage: number;
  [key: string]: unknown;
}

/**
 * The reducer owns only the query text + selected + custom saved filters.
 * Detailed filter generation lives in the hook / filter service.
 */
export interface BacklogFilters {
  /** `filterQ` text search (main.coffee:81 `translationData.q`, :353 `params.q`). */
  query: string;
  /** Active sidebar filters. */
  selected: unknown[];
  /** Saved custom filters (`storeCustomFiltersName = 'backlog-custom-filters'`). */
  custom: unknown[];
}

/**
 * The sprint add/edit lightbox form values (`lightboxes.coffee`). Dates are the
 * canonical `'YYYY-MM-DD'` the API returns; display formatting (the lightbox's
 * `prettyDate`) is a component concern - documented deviation.
 */
export interface SprintFormValues {
  project: number | null;
  name: string | null;
  estimated_start: string | null;
  estimated_finish: string | null;
  /** Present in edit mode. */
  id?: number;
}

/** The sprint add/edit lightbox UI state (`lightboxes.coffee`). */
export interface SprintFormState {
  open: boolean;
  mode: 'create' | 'edit';
  values: SprintFormValues;
  /** Shown on create when a last sprint exists (lightboxes.coffee:172-176). */
  lastSprintName: string | null;
  /** Edit-mode delete visibility (`canEdit('delete_milestone')`, INJECTED). */
  canDelete: boolean;
}

/**
 * A queued optimistic drag entry, reproducing the `pendingDrag` queue entries
 * (main.coffee:540-546). Retained in state so a burst of drags can be applied
 * optimistically while the previous bulk request is still in flight.
 */
export interface PendingDragEntry {
  movedIds: number[];
  targetSprintId: number | null;
  index: number;
  previousUs: number | null;
  nextUs: number | null;
}

/**
 * Complete Backlog state. Reproduces every field the AngularJS controller
 * initialised (main.coffee:50-95) plus the sprint-fold model (sprints.coffee)
 * and the sprint-form model (lightboxes.coffee).
 */
export interface BacklogState {
  // Project context
  project: Project | null;
  // Backlog user stories
  userstories: UserStory[];
  visibleUserStories: number[]; // us.ref list (main.coffee:379-380)
  totalUserStories: number;
  page: number;
  disablePagination: boolean;
  firstLoadComplete: boolean;
  loadingUserstories: boolean;
  noSwimlaneUserStories: boolean;
  backlogOrder: Record<number, number>; // usId -> backlog_order
  milestonesOrder: Record<number, Record<number, number>>; // sprintId -> usId -> sprint_order
  newUs: number[]; // ids to flag us.new = true
  // Sprints / milestones
  sprints: Sprint[]; // open sprints
  closedSprints: Sprint[];
  sprintsById: Record<number, Sprint>; // keyBy id (single, last-wins)
  closedSprintsById: Record<number, Sprint>;
  sprintsCounter: number;
  totalMilestones: number;
  totalOpenMilestones: number;
  totalClosedMilestones: number;
  /**
   * Whether the sprints/milestones list has completed its first server load
   * (set once by `setSprints`, which always fires on load regardless of whether
   * the project has zero or many sprints).
   *
   * PARITY / CLS GUARD (QA finding F-CLS-01): the AngularJS backlog left
   * `totalMilestones` `undefined` until milestones loaded, so its empty-state
   * gate `totalMilestones === 0` (`undefined === 0` -> false) never rendered the
   * `.empty-small` illustration during the async load window. Our reducer
   * initialises `totalMilestones` to the number `0`, so a naive `=== 0` gate is
   * TRUE during that window and briefly flashes `empty_sprint.png` before the
   * real sprint cards arrive — a Cumulative Layout Shift regression. This flag
   * reproduces the AngularJS "not yet known" state: the empty illustration is
   * gated on `sprintsLoaded && totalMilestones === 0`, so it is suppressed until
   * the first `setSprints` and only shown for a genuinely empty project.
   */
  sprintsLoaded: boolean;
  currentSprint: Sprint | null;
  closedSprintsVisible: boolean; // inverse of excludeClosedSprints
  sprintOpen: Record<number, boolean>; // per-sprint fold state (sprints.coffee)
  // Stats / forecasting
  stats: BacklogStats | null;
  showGraphPlaceholder: boolean | null;
  displayVelocity: boolean;
  forecastedStories: UserStory[];
  forecastNewSprint: boolean;
  // View toggles / filters
  showTags: boolean; // DEFAULT true (main.coffee:91)
  activeFilters: boolean; // DEFAULT false (main.coffee:92)
  /**
   * "View points per Role" selection for the backlog table header
   * (`tg-us-role-points-selector`, `backlog-table.jade:14`). `null` = "All roles"
   * (show each story's total points); a role id = show that role's per-role
   * points label + the total, matching the legacy `uspoints:select` /
   * `uspoints:clear-selection` broadcast the `UsRolePointsSelectorDirective`
   * (`backlog/main.coffee:995-1021`) drove across every row's points widget.
   */
  pointsViewRoleId: number | null;
  filters: BacklogFilters;
  // Multi-select + drag
  selectedIds: number[]; // .ui-multisortable-multiple selection
  pendingDrag: PendingDragEntry[];
  // Sprint add/edit form
  sprintForm: SprintFormState;
}

/**
 * Options for `setUserstories`. The HTTP header parsing is done by the hook,
 * which passes the derived flags here (reproduces the `header(...)` reads in
 * `parseLoadUserstoriesResponse`, main.coffee:396-404).
 */
export interface SetUserstoriesOptions {
  /** Mirrors main.coffee:365-366: clear the list before appending. */
  resetPagination?: boolean;
  /** `header('x-pagination-next')` -> enable next page (main.coffee:396-398). */
  hasNext?: boolean;
  /** `header('Taiga-Info-Backlog-Total-Userstories')` (main.coffee:400-401). */
  total?: number | null;
  /** `header('Taiga-Info-Userstories-Without-Swimlane')` (main.coffee:403-404). */
  noSwimlane?: boolean | null;
}

/**
 * One entry of the post-API reconciliation list consumed by `applyMoveResult`
 * (main.coffee:611-617): `{ id, milestone, backlog_order }`.
 */
export interface BacklogMoveResultEntry {
  id: number;
  milestone: number | null;
  backlog_order: number;
}

/* ------------------------------------------------------------------ *
 * Server-observable payload / result wrappers
 *
 * The AngularJS `moveUs` / `moveUssToSprint` BOTH mutated scope AND called a
 * frozen `/api/v1/` endpoint. To stay pure, the corresponding producers return
 * BOTH the next immutable state and the exact API payload; the hook dispatches
 * `state` and forwards `payload` to `../../shared/api/userstories.*`. `payload`
 * is nullable so a no-op move returns `{ state, payload: null }`.
 * ------------------------------------------------------------------ */

/**
 * DRAG reorder payload -> `bulkUpdateBacklogOrder(projectId, milestoneId|null,
 * afterUsId|null, beforeUsId|null, bulkUserstories)` (main.coffee:603-609).
 *
 * CORRECTNESS-CRITICAL: `bulkUserstories` is a `number[]` of the moved
 * user-story ids - NOT an array of `{ us_id, order }` objects (that is the
 * DISTINCT toolbar path, `BacklogMoveToSprintPayload`).
 */
export interface BacklogMovePayload {
  projectId: number;
  /** `currentSprintId` (destination sprint id, or `null` for the backlog). */
  milestoneId: number | null;
  /** `= previousUs`. */
  afterUserstoryId: number | null;
  /** `= nextUs`. */
  beforeUserstoryId: number | null;
  /** Moved US ids (NOTE: `number[]`, NOT `{ us_id, order }` objects). */
  bulkUserstories: number[];
}

/** `applyDrag` returns both the next state and the drag API payload (or `null`). */
export interface BacklogMoveResult {
  state: BacklogState;
  payload: BacklogMovePayload | null;
}

/**
 * TOOLBAR "move to sprint" payload -> `bulkUpdateMilestone(projectId,
 * milestoneId, bulkStories)` (main.coffee:794-799).
 *
 * CORRECTNESS-CRITICAL: `bulkStories` is `[{ us_id, order }]`, and `milestoneId`
 * is ALWAYS `sprints[0].id` even for `moveToCurrentSprint` - see the quirk
 * documented on `applyMoveToSprint`.
 */
export interface BacklogMoveToSprintPayload {
  projectId: number;
  /** NOTE: source uses `sprints[0].id` even for moveToCurrentSprint (main.coffee:799). */
  milestoneId: number;
  /** `[{ us_id: us.id, order: us.sprint_order }]` (main.coffee:794-798). */
  bulkStories: BulkOrderItem[];
}

/** `moveToCurrentSprint` / `moveToLatestSprint` return both state and payload. */
export interface BacklogMoveToSprintResult {
  state: BacklogState;
  payload: BacklogMoveToSprintPayload | null;
}

/* ------------------------------------------------------------------ *
 * Initial state / reset
 * ------------------------------------------------------------------ */

/**
 * Build a fresh Backlog state. Reproduces the controller init (main.coffee:50-95).
 *
 * NOTE the DEFAULTS that are load-bearing for the UI:
 *   - `showTags`     : TRUE  (main.coffee:91).
 *   - `activeFilters`: FALSE (main.coffee:92).
 *   - `forecastNewSprint`: TRUE (calculateForecasting starts it `true`, main.coffee:450).
 *   - `page`         : 1     (main.coffee:78).
 * `swimlanesList = Immutable.List()` (main.coffee:86) is intentionally NOT
 * reproduced here: swimlanes are a Kanban concept; the Backlog reducer models
 * only the backlog list + sprints.
 */
export function createInitialState(): BacklogState {
  return {
    // Project context
    project: null,
    // Backlog user stories
    userstories: [],
    visibleUserStories: [],
    totalUserStories: 0,
    page: 1,
    disablePagination: false,
    firstLoadComplete: false,
    loadingUserstories: false,
    noSwimlaneUserStories: false,
    backlogOrder: {},
    milestonesOrder: {},
    newUs: [],
    // Sprints / milestones
    sprints: [],
    closedSprints: [],
    sprintsById: {},
    closedSprintsById: {},
    sprintsCounter: 0,
    totalMilestones: 0,
    totalOpenMilestones: 0,
    totalClosedMilestones: 0,
    // Starts false so the empty-sprint illustration is suppressed until the
    // first `setSprints` (see the `sprintsLoaded` doc on BacklogState) — prevents
    // the F-CLS-01 empty-state flash / layout shift during the async load window.
    sprintsLoaded: false,
    currentSprint: null,
    closedSprintsVisible: false,
    sprintOpen: {},
    // Stats / forecasting
    stats: null,
    showGraphPlaceholder: null,
    displayVelocity: false,
    forecastedStories: [],
    forecastNewSprint: true,
    // View toggles / filters
    showTags: true,
    activeFilters: false,
    pointsViewRoleId: null,
    filters: { query: '', selected: [], custom: [] },
    // Multi-select + drag
    selectedIds: [],
    pendingDrag: [],
    // Sprint add/edit form
    sprintForm: {
      open: false,
      mode: 'create',
      values: { project: null, name: null, estimated_start: null, estimated_finish: null },
      lastSprintName: null,
      canDelete: false,
    },
  };
}

/** Canonical empty Backlog state (a full reset with all defaults). */
export const initialBacklogState: BacklogState = createInitialState();

/**
 * Return a fresh state, preserving the `project` context from `prev` when
 * present (mirrors the kanban reducer's `reset`, which carries over injected
 * context across a reload). `createInitialState()` remains the canonical entry.
 */
export function reset(prev?: Partial<BacklogState>): BacklogState {
  const next = createInitialState();
  if (prev && prev.project) {
    next.project = prev.project;
  }
  return next;
}


/* ------------------------------------------------------------------ *
 * Pure helpers (standalone, NO produce - trivially unit-testable)
 * ------------------------------------------------------------------ */

/**
 * Stable ascending sort by a numeric key. JS `Array.prototype.sort` is spec-
 * stable from ES2019 (our target), but we decorate-sort-undecorate with the
 * original index as an explicit tiebreak so stability is guaranteed regardless
 * of engine. Returns a NEW array; the input is never mutated.
 */
function stableSortByNumber<T>(list: T[], key: (item: T) => number): T[] {
  // Resilience guard (finding M-04). This is the single sort choke point for both
  // `sortByBacklogOrder` (userstories) and `sortBySprintOrder` (a sprint's nested
  // `user_stories`). The legacy sorted via `_.sortBy`, which coerces a non-array
  // input to `[]`; the native `.map` below would instead throw and crash the
  // board. Mirror the lodash tolerance so a malformed (non-array) collection —
  // e.g. a milestone whose `user_stories` field is not an array — degrades to an
  // empty list rather than propagating a `TypeError`. Well-formed arrays are
  // unaffected.
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ka = key(a.item);
      const kb = key(b.item);
      if (ka !== kb) {
        return ka - kb;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * Stable ascending sort by `backlog_order`. Reproduces
 * `_.sortBy(us, "backlog_order")` (main.coffee:377). Returns a NEW array.
 */
export function sortByBacklogOrder(list: UserStory[]): UserStory[] {
  return stableSortByNumber(list, (us) => us.backlog_order);
}

/**
 * Stable ascending sort by `sprint_order`. Reproduces
 * `_.sortBy(sprint.user_stories, "sprint_order")` (main.coffee:292,318).
 */
export function sortBySprintOrder(list: UserStory[]): UserStory[] {
  return stableSortByNumber(list, (us) => us.sprint_order);
}

/**
 * Reproduce the custom `groupBy` helper (utils.coffee:80-85), which is actually
 * a keyBy: `result[pred(item)] = item` stores a SINGLE item per key (LAST-WINS),
 * NOT an array of items. This is load-bearing: `moveUs` reads
 * `sprintsById[id].user_stories` expecting a single `Sprint`, not a `Sprint[]`.
 */
export function keyById<T extends { id: number }>(items: T[]): Record<number, T> {
  const result: Record<number, T> = {};
  for (const item of items) {
    result[item.id] = item; // last-wins, single item (NOT arrays)
  }
  return result;
}

/**
 * Sum a numeric field over a list. Reproduces the AngularJS
 * `_.reduce(_.map(list, pick), (a, b) => a + b)` points math used by
 * `sprintTotalPoints` / `moveUssToSprint`. Returns `0` for an empty list
 * (the coffee's `_.reduce` would return `undefined` for an empty list, but the
 * only call sites always have at least one selected story; `0` is the correct,
 * safe identity here).
 */
export function sumBy<T>(list: T[], pick: (t: T) => number): number {
  let total = 0;
  for (const item of list) {
    total += pick(item);
  }
  return total;
}

/**
 * Parse a `'YYYY-MM-DD'` string to a millisecond timestamp at LOCAL midnight.
 * Reproduces `moment(value, 'YYYY-MM-DD').format('x')` at DAY granularity
 * (main.coffee:698-699; lightboxes.coffee).
 *
 * PURITY NOTE: `new Date(y, m - 1, d)` is called WITH ARGUMENTS, so it is fully
 * deterministic given its inputs - it is NOT a "now" call and does not violate
 * the no-`Date.now()` / no-`new Date()` (no-arg) purity rule.
 */
export function parseYmdToMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * Inverse of `parseYmdToMs`: build a `'YYYY-MM-DD'` string from a timestamp,
 * using the LOCAL calendar date. Deterministic (`new Date(ms)` takes an
 * argument, so it is not a "now" call). Used by `addWeeks`.
 */
export function formatMsToYmd(ms: number): string {
  const date = new Date(ms);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Add `weeks * 7` days to a `'YYYY-MM-DD'` string. Reproduces
 * `moment(x).add(weeks, 'weeks')` (lightboxes.coffee:163) at DAY granularity:
 * `parseYmdToMs -> + weeks * 7 * 86400000 -> formatMsToYmd`. The day-granularity
 * approximation (which can differ by a calendar day across a DST boundary) is
 * acceptable for the sprint-form default date suggestions.
 */
export function addWeeks(ymd: string, weeks: number): string {
  const ms = parseYmdToMs(ymd) + weeks * 7 * 86400000;
  return formatMsToYmd(ms);
}

/**
 * Remove the first user story whose `id` matches from a list, in place.
 * Reproduces `_.remove(list, (it) => it.id == id)` (main.coffee:550,562,584);
 * user-story ids are unique, so removing the first match is equivalent to
 * lodash's remove-all-matching. Internal helper for the drag/move producers.
 */
function removeUserStoryById(list: UserStory[], id: number): void {
  const index = list.findIndex((it) => it.id === id);
  if (index !== -1) {
    list.splice(index, 1);
  }
}

/**
 * Resolve the moved user-story objects by id, searching the backlog list first,
 * then every open sprint, then every closed sprint (reproduces the lookup
 * `moveUs` performs across `userstories` + `sprintsById`/`closedSprintsById`).
 * Results are returned in the order of `ids`. Works on both the frozen input
 * state (for pre-read) and an immer draft (for mutation) because it only reads
 * the three list fields.
 */
function resolveMovedUserStories(
  source: Pick<BacklogState, 'userstories' | 'sprints' | 'closedSprints'>,
  ids: readonly number[],
): UserStory[] {
  const found: UserStory[] = [];
  for (const id of ids) {
    let match = source.userstories.find((u) => u.id === id);
    if (!match) {
      for (const sprint of source.sprints) {
        const inSprint = sprint.user_stories.find((u) => u.id === id);
        if (inSprint) {
          match = inSprint;
          break;
        }
      }
    }
    if (!match) {
      for (const sprint of source.closedSprints) {
        const inClosed = sprint.user_stories.find((u) => u.id === id);
        if (inClosed) {
          match = inClosed;
          break;
        }
      }
    }
    if (match) {
      found.push(match);
    }
  }
  return found;
}


/* ------------------------------------------------------------------ *
 * Selectors (pure, read-only - take state/args, return a value)
 * ------------------------------------------------------------------ */

/** Open (non-closed) sprints. Reproduces `openSprints()` (main.coffee:332-333). */
export function selectOpenSprints(state: BacklogState): Sprint[] {
  return state.sprints.filter((sprint) => !sprint.closed);
}

/**
 * Total points of a sprint. Reproduces `sprintTotalPoints` (main.coffee:435-442):
 * sum `us.total_points` over `sprint.user_stories`, but ONLY for stories whose
 * `milestone` still equals this `sprint.id`.
 */
export function sprintTotalPoints(sprint: Sprint): number {
  let points = 0;
  for (const us of sprint.user_stories) {
    if (us.milestone === sprint.id) {
      points += us.total_points;
    }
  }
  return points;
}

/**
 * The sprint that contains "now". Reproduces `findCurrentSprint`
 * (main.coffee:696-703) but with an INJECTED `nowMs` instead of
 * `new Date().getTime()` - returns the first sprint whose
 * `[estimated_start, estimated_finish]` (parsed to ms at day granularity)
 * brackets `nowMs`, else `null`.
 */
export function findCurrentSprint(sprints: Sprint[], nowMs: number): Sprint | null {
  const found = sprints.find((sprint) => {
    const start = parseYmdToMs(sprint.estimated_start);
    const end = parseYmdToMs(sprint.estimated_finish);
    return start <= nowMs && nowMs <= end;
  });
  return found ?? null;
}

/**
 * The latest-finishing OPEN sprint. Reproduces `getLastSprint`
 * (lightboxes.coffee:120-127): filter `!closed`, sort ascending by
 * `estimated_finish`, return the LAST element (latest finish), else `null`.
 */
export function selectLastSprint(sprints: Sprint[]): Sprint | null {
  const open = sprints.filter((sprint) => !sprint.closed);
  const sorted = stableSortByNumber(open, (sprint) => parseYmdToMs(sprint.estimated_finish));
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/**
 * The completed-points percentage. Reproduces main.coffee:259-264:
 * `totalPoints = stats.total_points || stats.defined_points`; when truthy,
 * `round(100 * closed_points / totalPoints)`, else `0`. Kept standalone so it
 * is directly unit-testable.
 */
export function computeCompletedPercentage(stats: BacklogStats): number {
  const totalPoints = stats.total_points || stats.defined_points;
  if (totalPoints) {
    return Math.round((100 * (stats.closed_points ?? 0)) / totalPoints);
  }
  return 0;
}

/**
 * Doom-line index (finding M-08). Reproduces the AngularJS `reloadDoomLine`
 * (backlog `BacklogDirective` -> `linkDoomLine`, main.coffee:727-752) — the
 * "Project Scope [Doomline]" marker that is inserted BEFORE the first backlog
 * story whose running point total overflows the project's `total_points`
 * budget. Returns that story's zero-based index in `userstories`, or `-1` when
 * no doom line is shown.
 *
 * EXACT RUNTIME PARITY — the dead velocity gate:
 *   The AngularJS source guards the computation with `!$scope.displayVelocity?`
 *   and pre-clears with `if $scope.displayVelocity: removeDoomlineDom()`. Those
 *   read the BARE scope property `$scope.displayVelocity`, which is NEVER
 *   assigned anywhere in the codebase (verified via a repo-wide grep): the
 *   controller sets `ctrl.displayVelocity` (published `BacklogController as
 *   ctrl`, referenced as `ctrl.displayVelocity` in backlog-table.jade:21), a
 *   DIFFERENT property. CoffeeScript's existential `?` makes the guard
 *   `$scope.displayVelocity == null`, which is ALWAYS true, so `!(...)` is
 *   always true and the pre-clear branch never fires. The paired
 *   `userstories:forecast` removal event (main.coffee:762) is likewise NEVER
 *   broadcast. Net effect: the doom line renders whenever `stats.total_points`
 *   is a nonzero number, INDEPENDENT of the velocity-forecasting toggle — and
 *   it is re-run on every `userstories:loaded` (which `toggleVelocityForecasting`
 *   broadcasts, main.coffee:254). We therefore deliberately do NOT gate on
 *   `displayVelocity`; gating on it would hide the line during forecasting and
 *   DIVERGE from the real AngularJS behaviour.
 *
 * COMPUTATION (main.coffee:734-752, verbatim): seed the running sum with
 * `stats.assigned_points`, then walk `userstories` in order adding each
 * `total_points`; the doom line goes before the FIRST story where the running
 * sum exceeds `stats.total_points`, then the loop breaks (only one line). Only
 * runs when `stats` exists and `stats.total_points` is present and non-zero
 * (`stats? and stats.total_points? and stats.total_points != 0`).
 *
 * `assigned_points` is optional on {@link BacklogStats} but is always present
 * alongside `total_points` in the Django project-stats response, so the `?? 0`
 * fallback guards the type without any observable divergence.
 */
export function computeDoomLineIndex(
  stats: BacklogStats | null | undefined,
  userstories: readonly UserStory[],
): number {
  if (!stats) {
    return -1;
  }
  const totalPoints = stats.total_points;
  if (totalPoints == null || totalPoints === 0) {
    return -1;
  }
  let currentSum = stats.assigned_points ?? 0;
  for (let i = 0; i < userstories.length; i += 1) {
    currentSum += userstories[i].total_points;
    if (currentSum > totalPoints) {
      return i;
    }
  }
  return -1;
}

/**
 * Default dates + last-sprint name for the create sprint form. Reproduces the
 * create-form defaults (lightboxes.coffee:152-176) with an INJECTED `nowYmd`
 * (no `moment()` / `Date.now()`):
 *   - `estimated_start`  = lastSprint ? lastSprint.estimated_finish : nowYmd
 *   - `estimated_finish` = addWeeks(estimated_start, 2)
 *   - `lastSprintName`   = lastSprint?.name ?? null
 */
export function buildCreateSprintDefaults(
  sprints: Sprint[],
  nowYmd: string,
): { estimated_start: string; estimated_finish: string; lastSprintName: string | null } {
  const lastSprint = selectLastSprint(sprints);
  const base = lastSprint ? lastSprint.estimated_finish : nowYmd;
  return {
    estimated_start: base,
    estimated_finish: addWeeks(base, 2),
    lastSprintName: lastSprint ? lastSprint.name : null,
  };
}


/* ------------------------------------------------------------------ *
 * Loading / stats producers (each `(state, ...args) => BacklogState`)
 * ------------------------------------------------------------------ */

/**
 * Internal: populate `draft.milestonesOrder`. Reproduces `setMilestonesOrder`
 * (main.coffee:270-274): `milestonesOrder[sprint.id][us.id] = us.sprint_order`.
 * Factored out so `setSprints` and `setClosedSprints` share one body (no nested
 * `produce`).
 */
function applyMilestonesOrder(draft: BacklogState, sprints: Sprint[]): void {
  for (const sprint of sprints) {
    draft.milestonesOrder[sprint.id] = {};
    for (const us of sprint.user_stories) {
      draft.milestonesOrder[sprint.id][us.id] = us.sprint_order;
    }
  }
}

/**
 * Append a page of backlog user stories. Reproduces `parseLoadUserstoriesResponse`
 * (main.coffee:375-408); the hook parses the HTTP headers and passes the derived
 * flags via `opts`. `resetPagination` clears the list first (main.coffee:365-366).
 * New objects are created for stories flagged `new` (no in-place mutation of the
 * incoming payload); `state.userstories` is only read.
 */
export function setUserstories(
  state: BacklogState,
  userstories: UserStory[],
  opts: SetUserstoriesOptions = {},
): BacklogState {
  const existing = opts.resetPagination ? [] : state.userstories;
  const combined = existing.concat(sortByBacklogOrder(userstories));
  return produce(state, (draft: BacklogState) => {
    draft.userstories = combined.map((us) =>
      draft.newUs.includes(us.id) ? { ...us, new: true } : us,
    );
    draft.visibleUserStories = draft.userstories.map((us) => us.ref);
    for (const us of draft.userstories) {
      draft.backlogOrder[us.id] = us.backlog_order;
    }
    draft.loadingUserstories = false;
    if (opts.hasNext) {
      draft.disablePagination = false;
      draft.page += 1;
    }
    if (opts.total != null) {
      draft.totalUserStories = opts.total;
    }
    if (opts.noSwimlane != null) {
      draft.noSwimlaneUserStories = opts.noSwimlane;
    }
  });
}

/**
 * Load the OPEN sprints. Reproduces `loadSprints` (main.coffee:304-330). Each
 * sprint's `user_stories` is sorted by `sprint_order`; `currentSprint` uses the
 * INJECTED `nowMs`. `sprints` and `sprintsById` are populated with the SAME
 * object references (via `keyById`) so a later optimistic move mutating
 * `sprintsById[id].user_stories` is reflected in the rendered `sprints` list.
 * The per-sprint fold state initialises to `!closed` (sprints.coffee: closed ->
 * collapsed, open -> expanded).
 */
export function setSprints(
  state: BacklogState,
  args: { milestones: Sprint[]; closed: number; open: number; nowMs: number },
): BacklogState {
  const { milestones, closed, open, nowMs } = args;
  // Build sorted sprint copies OUTSIDE produce so the incoming `milestones`
  // objects are never mutated in place.
  const prepared: Sprint[] = milestones.map((sprint) => ({
    ...sprint,
    user_stories: sortBySprintOrder(sprint.user_stories),
  }));
  const current = findCurrentSprint(prepared, nowMs);
  return produce(state, (draft: BacklogState) => {
    applyMilestonesOrder(draft, prepared);
    draft.totalClosedMilestones = closed;
    draft.totalOpenMilestones = open;
    draft.totalMilestones = open + closed;
    // Mark the sprints list as loaded so the empty-state illustration is now
    // allowed to render for a genuinely empty project (open + closed === 0)
    // WITHOUT flashing during the preceding async load window (F-CLS-01).
    draft.sprintsLoaded = true;
    draft.sprints = prepared;
    // Guard kept for parity with the source (main.coffee:322); our init is `[]`.
    if (!draft.closedSprints) {
      draft.closedSprints = [];
    }
    draft.sprintsCounter = prepared.length;
    draft.sprintsById = keyById(prepared);
    draft.currentSprint = current;
    for (const sprint of prepared) {
      draft.sprintOpen[sprint.id] = !sprint.closed;
    }
  });
}

/**
 * Load the CLOSED sprints. Reproduces `loadClosedSprints` (main.coffee:281-296):
 * same sorting/keying as `setSprints`, but only touches the closed collections
 * and sets each fold state to `false` (closed sprints render collapsed).
 */
export function setClosedSprints(
  state: BacklogState,
  args: { milestones: Sprint[]; closed: number },
): BacklogState {
  const { milestones, closed } = args;
  const prepared: Sprint[] = milestones.map((sprint) => ({
    ...sprint,
    user_stories: sortBySprintOrder(sprint.user_stories),
  }));
  return produce(state, (draft: BacklogState) => {
    applyMilestonesOrder(draft, prepared);
    draft.totalClosedMilestones = closed;
    draft.closedSprints = prepared;
    draft.closedSprintsById = keyById(prepared);
    for (const sprint of prepared) {
      draft.sprintOpen[sprint.id] = !sprint.closed;
    }
  });
}

/**
 * Unload the closed sprints. Reproduces `unloadClosedSprints` (main.coffee:276-279);
 * we additionally clear `closedSprintsById` so the lookup map stays consistent
 * with the emptied list.
 */
export function unloadClosedSprints(state: BacklogState): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.closedSprints = [];
    draft.closedSprintsById = {};
  });
}

/**
 * Store the project stats + the derived `completedPercentage` and
 * `showGraphPlaceholder`. Reproduces `loadProjectStats` (main.coffee:256-268):
 * `showGraphPlaceholder = !(stats.total_points? && stats.total_milestones?)`.
 */
export function setProjectStats(state: BacklogState, stats: BacklogStats): BacklogState {
  const nextStats: BacklogStats = { ...stats };
  nextStats.completedPercentage = computeCompletedPercentage(stats);
  // Reproduce `loadProjectStats` -> `calculateForecasting` (main.coffee:267):
  // recompute the forecast against the freshly-stored stats so `speed` is
  // current. Computed from a plain snapshot (not the immer draft) so only fresh
  // outputs are stored. When velocity is being displayed, also refresh the
  // visible list so it tracks the new stats.
  const forecast = calculateForecasting({ ...state, stats: nextStats });
  return produce(state, (draft: BacklogState) => {
    draft.stats = nextStats;
    draft.showGraphPlaceholder = !(stats.total_points != null && stats.total_milestones != null);
    draft.forecastedStories = forecast.forecastedStories;
    draft.forecastNewSprint = forecast.forecastNewSprint;
    if (draft.displayVelocity) {
      draft.visibleUserStories = forecast.forecastedStories.map((us) => us.ref);
    }
  });
}

/** Set the resolved project (main.coffee constructor / `loadProject`). */
export function setProject(state: BacklogState, project: Project): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.project = project;
  });
}

/**
 * Merge ids into `newUs` (deduped). Reproduces the `newUs` accumulation used by
 * `parseLoadUserstoriesResponse` (main.coffee:383-384): a US created via the
 * usform gets its id pushed here so the NEXT load flags `us.new = true`.
 */
export function markNewUs(state: BacklogState, ids: number[]): BacklogState {
  return produce(state, (draft: BacklogState) => {
    for (const id of ids) {
      if (!draft.newUs.includes(id)) {
        draft.newUs.push(id);
      }
    }
  });
}

/**
 * Replace a single user story in the backlog list with an updated server copy.
 *
 * Used by the inline status/points row controls (finding #12): after the
 * `userstories.save` PATCH resolves with the server-updated story (new `version`,
 * recomputed `total_points`, changed `status`/`points`), this producer swaps the
 * matching row IN PLACE by `id`, preserving list order. Reproduces the legacy
 * `render(us)` re-display after `$repo.save` (`common/popovers.coffee:59-67`,
 * `estimation.coffee:154-166`) — the story object mutates in the AngularJS scope
 * and the row re-renders. A story not present in the list is a no-op.
 */
export function updateUserStory(state: BacklogState, us: UserStory): BacklogState {
  return produce(state, (draft: BacklogState) => {
    const idx = draft.userstories.findIndex((u) => u.id === us.id);
    if (idx !== -1) {
      // Cast through the reducer's UserStory shape; the server copy carries the
      // full payload (index signature tolerates every field).
      draft.userstories[idx] = us as unknown as (typeof draft.userstories)[number];
    }
  });
}

/**
 * Remove a single user story from the backlog list.
 *
 * Used by the ⋮ options menu "Delete" action (finding #12): after the confirm
 * dialog and the `userstories.deleteUserStory` DELETE resolve, the deleted story
 * is dropped from the visible list. Reproduces the legacy
 * `@scope.userstories = _.without(@scope.userstories, us)` (`backlog/main.coffee:667`)
 * optimistic removal. A story not present is a no-op.
 */
export function removeUserStory(state: BacklogState, usId: number): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.userstories = draft.userstories.filter((u) => u.id !== usId);
    // Drop it from the multi-selection too, so a stale id cannot leak into a
    // subsequent bulk move.
    draft.selectedIds = draft.selectedIds.filter((id) => id !== usId);
  });
}

/**
 * Set the "view points per Role" selection for the backlog table header.
 *
 * `null` clears the selection (show totals — legacy `uspoints:clear-selection`);
 * a role id selects that role (legacy `uspoints:select`). Reproduces the state
 * the `UsRolePointsSelectorDirective` (`backlog/main.coffee:995-1021`) broadcast
 * to every row's points widget so they all switch display mode together.
 */
export function setPointsViewRole(
  state: BacklogState,
  roleId: number | null,
): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.pointsViewRoleId = roleId;
  });
}


/* ------------------------------------------------------------------ *
 * Movement producers (SERVER-OBSERVABLE - return `{ state, payload }`)
 *
 * These reproduce the two DISTINCT frozen `/api/v1/` bulk paths and MUST NOT be
 * conflated:
 *   - DRAG      : `applyDrag` -> `BacklogMovePayload`      (bulkUserstories: number[])
 *   - TOOLBAR   : `moveTo*`   -> `BacklogMoveToSprintPayload` (bulkStories: [{us_id,order}])
 * ------------------------------------------------------------------ */

/**
 * Look up a sprint by id, searching the OPEN then CLOSED ARRAYS (never the
 * by-id maps). Returns the ARRAY ELEMENT so a mutation is visible in the
 * UI-rendered `sprints` / `closedSprints` lists; `undefined` when absent.
 *
 * WHY ARRAYS, NOT MAPS (immer shared-reference caveat): `setSprints` stores the
 * SAME sprint object in both the array (`draft.sprints`) and the lookup map
 * (`draft.sprintsById`). immer does NOT share a single draft across the two
 * access paths - within a later `produce`, `draft.sprints[i]` and
 * `draft.sprintsById[id]` become SEPARATE drafts of that one original object.
 * Mutating the map draft would therefore leave the array (what the board
 * renders) untouched. All sprint-content mutations here go through the array,
 * and `syncSprintDerived` rebuilds the maps + `currentSprint` from the array at
 * the end so every view stays consistent.
 */
function findSprintInArrays(draft: BacklogState, id: number): Sprint | undefined {
  const open = draft.sprints.find((s) => s.id === id);
  if (open) {
    return open;
  }
  return draft.closedSprints.find((s) => s.id === id);
}

/**
 * Rebuild the derived sprint state from the authoritative ARRAYS after any
 * producer that mutates sprint contents or membership:
 *   - `sprintsById` / `closedSprintsById` are re-keyed from the arrays so their
 *     entries are the SAME (mutated) array-element references again, and
 *   - `currentSprint` is re-pointed to the array element that carries its id
 *     (or `null` if that sprint no longer exists), so it never diverges from
 *     the rendered list.
 * This is the single place that repairs the immer shared-reference split
 * documented on `findSprintInArrays`.
 */
function syncSprintDerived(draft: BacklogState): void {
  draft.sprintsById = keyById(draft.sprints);
  draft.closedSprintsById = keyById(draft.closedSprints);
  if (draft.currentSprint) {
    const id = draft.currentSprint.id;
    const found =
      draft.sprints.find((s) => s.id === id) ?? draft.closedSprints.find((s) => s.id === id);
    draft.currentSprint = found ?? null;
  }
}

/**
 * Apply the optimistic drag reorder and return the exact `bulkUpdateBacklogOrder`
 * payload. Reproduces `moveUs`'s optimistic branch (main.coffee:523-609), mapped
 * from the `BacklogDragResult` the `../../shared/dnd` layer produces:
 *   movedIds = result.movedIds, newSprintId = result.targetSprintId (null =
 *   backlog), newUsIndex = result.index, previousUs = result.previousUs,
 *   nextUs = result.nextUs.
 *
 * The `{ state, payload }` wrapper keeps the reducer pure: the hook dispatches
 * `state` and forwards `payload` to the API (or, for the drag path, the
 * `../../shared/dnd/sortable` handler may already own the API call and ignore
 * `payload`). A no-op (no ids resolve) returns `{ state, payload: null }`.
 */
export function applyDrag(state: BacklogState, result: BacklogDragResult): BacklogMoveResult {
  const movedIds: UsId[] = result.movedIds;
  const newSprintId: number | null = result.targetSprintId; // null = backlog
  const newUsIndex = result.index;
  const previousUs: UsId | null = result.previousUs;
  const nextUs: UsId | null = result.nextUs;

  // Pre-read from the frozen input state to detect no-ops and build the payload
  // (project + currentSprintId derive from the moved stories' current values).
  const preUsList = resolveMovedUserStories(state, movedIds);
  if (preUsList.length === 0) {
    return { state, payload: null };
  }
  const oldSprintId = preUsList[0].milestone;
  const project = preUsList[0].project;
  const currentSprintId = newSprintId !== oldSprintId ? newSprintId : oldSprintId;

  const nextState = produce(state, (draft: BacklogState) => {
    // Re-resolve against the draft so we mutate the live draft references.
    const usList = resolveMovedUserStories(draft, movedIds);
    if (usList.length === 0) {
      return;
    }
    const oldSprint = oldSprintId != null ? findSprintInArrays(draft, oldSprintId) : undefined;
    const newSprint = newSprintId != null ? findSprintInArrays(draft, newSprintId) : undefined;

    if (newSprintId !== oldSprintId) {
      // ---- CROSS-CONTAINER move ----
      if (oldSprint) {
        for (const us of usList) {
          removeUserStoryById(oldSprint.user_stories, us.id);
        }
      }
      if (newSprintId === null) {
        // sprint -> backlog: splice into the backlog at `index + i`
        // (main.coffee:558-559). NOTE: milestone is intentionally NOT changed
        // optimistically here (the source only reassigns it on the API result,
        // reconciled by `applyMoveResult`).
        usList.forEach((us, i) => {
          draft.userstories.splice(newUsIndex + i, 0, us);
        });
      } else {
        // backlog -> sprint OR sprint -> sprint.
        for (const us of usList) {
          removeUserStoryById(draft.userstories, us.id);
        }
        usList.forEach((us) => {
          us.milestone = newSprintId;
          // NOTE: `newUsIndex` (NOT `newUsIndex + i`) EACH iteration, reproducing
          // main.coffee:566 exactly. The `newSprint` guard is defensive: the drop
          // target always exists in state, but guarding avoids a throw if it does not.
          if (newSprint) {
            newSprint.user_stories.splice(newUsIndex, 0, us);
          }
        });
      }
    } else {
      // ---- SAME-CONTAINER reorder ----
      const targetList =
        newSprintId != null && newSprint ? newSprint.user_stories : draft.userstories;
      for (const us of usList) {
        removeUserStoryById(targetList, us.id);
      }
      // AFTER-PRECEDENCE (main.coffee:586-595), reproduced LITERALLY including the
      // documented source bug so runtime behaviour is byte-identical:
      //   - `previousUs` set -> insert AFTER it.
      //   - otherwise        -> insert at the head.
      let position = 0;
      if (previousUs != null) {
        position = targetList.findIndex((us) => us.id === previousUs);
      } else if (nextUs != null) {
        // SOURCE BUG (main.coffee:591): the else-if branch reads `previousUs`
        // (which is null here), so `findIndex` returns -1. Net runtime effect:
        // nextUs-only (drag to head) -> position stays -1 -> +1 -> 0 -> head insert.
        position = targetList.findIndex((us) => us.id === previousUs);
      }
      position++;
      usList.forEach((us, i) => {
        targetList.splice(position + i, 0, us);
      });
    }

    draft.visibleUserStories = draft.userstories.map((us) => us.ref);
    // Repair the immer shared-reference split so the mutated sprint arrays are
    // reflected in the by-id maps and `currentSprint` (see `findSprintInArrays`).
    syncSprintDerived(draft);
  });

  // DRAG payload -> bulkUpdateBacklogOrder(project, currentSprintId, previousUs,
  // nextUs, bulkUserstories) (main.coffee:603-609). `bulkUserstories` is the
  // moved-id `number[]` (NOT `{us_id,order}` objects).
  const payload: BacklogMovePayload = {
    projectId: project,
    milestoneId: currentSprintId,
    afterUserstoryId: previousUs,
    beforeUserstoryId: nextUs,
    bulkUserstories: [...movedIds],
  };
  return { state: nextState, payload };
}

/**
 * Post-API reconciliation of a drag move. Reproduces main.coffee:611-617: for
 * each `{ id, milestone, backlog_order }` returned by the server, find the
 * matching US (backlog list first, then sprints) and update its `milestone`
 * and `backlog_order`. Dispatched by the hook with the API response.
 */
export function applyMoveResult(
  state: BacklogState,
  updated: BacklogMoveResultEntry[],
): BacklogState {
  return produce(state, (draft: BacklogState) => {
    for (const entry of updated) {
      const [us] = resolveMovedUserStories(draft, [entry.id]);
      if (us) {
        us.milestone = entry.milestone;
        us.backlog_order = entry.backlog_order;
      }
    }
    // The reconciled stories live inside the sprint arrays; rebuild the by-id
    // maps + `currentSprint` so they carry the same mutated references.
    syncSprintDerived(draft);
  });
}

/**
 * Internal: move the currently-selected stories into the sprint identified by
 * `targetSprintId` and return the exact `bulkUpdateMilestone` payload.
 * Reproduces `moveUssToSprint` (main.coffee:779-799). Returns `null` (no-op)
 * when nothing is selected, the project / sprints are not loaded, or the target
 * sprint id does not resolve. Runs inside a caller's `produce` on `draft`.
 *
 * The target is resolved from the ARRAY (via `findSprintInArrays`) - NOT the
 * by-id map - so the union is visible in the rendered `sprints` list, and
 * `syncSprintDerived` repairs the by-id maps + `currentSprint` before returning
 * (see the immer shared-reference note on `findSprintInArrays`).
 */
function applyMoveToSprint(
  draft: BacklogState,
  targetSprintId: number,
): BacklogMoveToSprintPayload | null {
  const selectedUss = draft.userstories.filter((us) => draft.selectedIds.includes(us.id));
  if (selectedUss.length === 0) {
    return null;
  }
  const project = draft.project;
  if (!project || draft.sprints.length === 0) {
    return null;
  }
  const targetSprint = findSprintInArrays(draft, targetSprintId);
  if (!targetSprint) {
    return null;
  }
  // Remove the selected stories from the backlog (reproduce `_.without`, main.coffee:783).
  draft.userstories = draft.userstories.filter((us) => !draft.selectedIds.includes(us.id));
  const totalExtraPoints = sumBy(selectedUss, (us) => us.total_points);
  // Union into the target sprint, deduping by id (reproduce `_.union`, main.coffee:789).
  const additions = selectedUss.filter(
    (su) => !targetSprint.user_stories.some((existing) => existing.id === su.id),
  );
  targetSprint.user_stories = targetSprint.user_stories.concat(additions);
  // Bump the sprint total (main.coffee:792).
  targetSprint.total_points += totalExtraPoints;
  draft.visibleUserStories = draft.userstories.map((us) => us.ref);
  const bulkStories: BulkOrderItem[] = selectedUss.map((us) => ({
    us_id: us.id,
    order: us.sprint_order,
  }));
  // SOURCE QUIRK (main.coffee:799): the API ALWAYS uses `sprints[0].id`, even for
  // `moveToCurrentSprint` whose optimistic target may be `currentSprint`.
  // Reproduced faithfully.
  const payload: BacklogMoveToSprintPayload = {
    projectId: project.id,
    milestoneId: draft.sprints[0].id,
    bulkStories,
  };
  // Reset the multi-selection after the move (checkbox/toolbar reset parity).
  draft.selectedIds = [];
  // Rebuild the by-id maps + `currentSprint` from the mutated arrays.
  syncSprintDerived(draft);
  return payload;
}

/**
 * Move selected stories into the current sprint (or the first open sprint when
 * there is no current one). Reproduces main.coffee:807-810. The optimistic
 * union targets `currentSprint` (else `sprints[0]`), while the API payload's
 * `milestoneId` is ALWAYS `sprints[0].id` (the quirk on `applyMoveToSprint`).
 */
export function moveToCurrentSprint(state: BacklogState): BacklogMoveToSprintResult {
  let payload: BacklogMoveToSprintPayload | null = null;
  const nextState = produce(state, (draft: BacklogState) => {
    const targetId =
      draft.currentSprint != null
        ? draft.currentSprint.id
        : draft.sprints.length > 0
          ? draft.sprints[0].id
          : null;
    if (targetId == null) {
      return;
    }
    payload = applyMoveToSprint(draft, targetId);
  });
  return { state: nextState, payload };
}

/**
 * Move selected stories into the first (latest) sprint. Reproduces
 * main.coffee:812-813.
 */
export function moveToLatestSprint(state: BacklogState): BacklogMoveToSprintResult {
  let payload: BacklogMoveToSprintPayload | null = null;
  const nextState = produce(state, (draft: BacklogState) => {
    if (draft.sprints.length === 0) {
      return;
    }
    payload = applyMoveToSprint(draft, draft.sprints[0].id);
  });
  return { state: nextState, payload };
}


/* ------------------------------------------------------------------ *
 * Toggle / filter / selection / fold / sprint-form producers
 * ------------------------------------------------------------------ */

/** Toggle the tags view. Reproduces `toggleShowTags` (main.coffee:236-239); the persistence to storage is a hook concern. */
export function toggleShowTags(state: BacklogState): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.showTags = !draft.showTags;
  });
}

/** Toggle the filters sidebar. Reproduces `toggleActiveFilters` (main.coffee:241-242). */
export function toggleActiveFilters(state: BacklogState): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.activeFilters = !draft.activeFilters;
  });
}

/**
 * Velocity-forecasting maths. Reproduces `calculateForecasting`
 * (main.coffee:444-467) as a PURE function over board state (finding #17):
 *
 *   - Seed `backlogPointsSum` from the FIRST sprint's total points
 *     (`sprintTotalPoints(sprints[0])`) when at least one sprint exists.
 *     `forecastNewSprint` starts `true`; when `speed > 0` AND that first
 *     sprint is already over capacity (`backlogPointsSum > speed`) the running
 *     sum is reset to 0 and `forecastNewSprint` stays `true` (a NEW sprint is
 *     forecast); otherwise `forecastNewSprint` becomes `false` (the current
 *     sprint still has room).
 *   - Walk `userstories` in order, accumulating each `total_points` into
 *     `backlogPointsSum` and pushing the story into `forecastedStories`, and
 *     STOP as soon as `speed > 0` AND `backlogPointsSum > speed`.
 *
 * With `speed === 0` (the guard is `speed > 0`) nothing ever breaks: every
 * story is forecast and `forecastNewSprint` is `false` whenever sprints exist —
 * exactly matching the AngularJS behaviour for zero-velocity projects. The
 * function only READS `state`; it returns fresh outputs the callers store.
 */
export function calculateForecasting(state: BacklogState): {
  forecastedStories: UserStory[];
  forecastNewSprint: boolean;
} {
  const speed = state.stats?.speed ?? 0;
  const forecastedStories: UserStory[] = [];
  let forecastNewSprint = true;
  let backlogPointsSum = 0;

  if (state.sprints.length > 0) {
    backlogPointsSum = sprintTotalPoints(state.sprints[0]);
    if (speed > 0 && backlogPointsSum > speed) {
      backlogPointsSum = 0;
    } else {
      forecastNewSprint = false;
    }
  }

  for (const us of state.userstories) {
    backlogPointsSum += us.total_points;
    forecastedStories.push(us);
    if (speed > 0 && backlogPointsSum > speed) {
      break;
    }
  }

  return { forecastedStories, forecastNewSprint };
}

/**
 * Toggle velocity forecasting. Reproduces `toggleVelocityForecasting`
 * (main.coffee:244-254): flip the flag, then recompute `visibleUserStories`
 * from `userstories` (off) or `forecastedStories` (on). On toggle-ON the
 * forecast is RECOMPUTED fresh via `calculateForecasting` (main.coffee:250
 * calls it before rebuilding the visible list), so `forecastedStories` /
 * `forecastNewSprint` always reflect current stats/sprints/userstories.
 */
export function toggleVelocityForecasting(state: BacklogState): BacklogState {
  // Compute the forecast from the (non-draft) input so no immer proxies leak
  // into the stored arrays; it is only consumed on the toggle-ON branch.
  const forecast = calculateForecasting(state);
  return produce(state, (draft: BacklogState) => {
    draft.displayVelocity = !draft.displayVelocity;
    if (!draft.displayVelocity) {
      draft.visibleUserStories = draft.userstories.map((us) => us.ref);
    } else {
      draft.forecastedStories = forecast.forecastedStories;
      draft.forecastNewSprint = forecast.forecastNewSprint;
      draft.visibleUserStories = forecast.forecastedStories.map((us) => us.ref);
    }
  });
}

/**
 * Store the forecasting outputs. Reproduces the outputs of `calculateForecasting`
 * (main.coffee:444-467) as a setter the hook fills (the velocity maths itself
 * uses stats and runs in the hook; the reducer is the store).
 */
export function setForecastedStories(
  state: BacklogState,
  stories: UserStory[],
  forecastNewSprint: boolean,
): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.forecastedStories = stories;
    draft.forecastNewSprint = forecastNewSprint;
  });
}

/**
 * Toggle closed-sprint visibility (inverse of `excludeClosedSprints`; the
 * closed-sprints toggle in sprints.coffee:124-167). The hook reacts by
 * dispatching `setClosedSprints` / `unloadClosedSprints`.
 */
export function toggleClosedSprintsVisible(state: BacklogState): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.closedSprintsVisible = !draft.closedSprintsVisible;
  });
}

/** Set the free-text filter query (main.coffee:353 `params.q`). */
export function setFilterQuery(state: BacklogState, query: string): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.filters.query = query;
  });
}

/** Merge partial filter changes into the current filters. */
export function setFilters(state: BacklogState, filters: Partial<BacklogFilters>): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.filters = { ...draft.filters, ...filters };
  });
}

/** Replace the multi-selection with an explicit id list. */
export function setSelectedIds(state: BacklogState, ids: number[]): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.selectedIds = ids;
  });
}

/**
 * Toggle a single story's selection. Reproduces `checkSelected`'s toggle of the
 * `.ui-multisortable-multiple` class (main.coffee:822-824): remove if present,
 * else add.
 */
export function toggleSelectedId(state: BacklogState, id: number): BacklogState {
  return produce(state, (draft: BacklogState) => {
    const index = draft.selectedIds.indexOf(id);
    if (index === -1) {
      draft.selectedIds.push(id);
    } else {
      draft.selectedIds.splice(index, 1);
    }
  });
}

/**
 * Toggle a sprint's fold state. Reproduces `toggleSprint` (sprints.coffee:25-56):
 * flips the per-sprint open/collapsed flag.
 */
export function toggleSprintFold(state: BacklogState, sprintId: number): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.sprintOpen[sprintId] = !draft.sprintOpen[sprintId];
  });
}

/**
 * Open the sprint form in CREATE mode with default dates. Reproduces the create
 * branch (lightboxes.coffee:136-188). `projectId` and the INJECTED `nowYmd`
 * seed the defaults (`buildCreateSprintDefaults`); create mode never shows the
 * delete action.
 */
export function openSprintFormCreate(
  state: BacklogState,
  args: { projectId: number; nowYmd: string },
): BacklogState {
  const { projectId, nowYmd } = args;
  return produce(state, (draft: BacklogState) => {
    const defaults = buildCreateSprintDefaults(draft.sprints, nowYmd);
    draft.sprintForm = {
      open: true,
      mode: 'create',
      values: {
        project: projectId,
        name: null,
        estimated_start: defaults.estimated_start,
        estimated_finish: defaults.estimated_finish,
      },
      lastSprintName: defaults.lastSprintName,
      canDelete: false,
    };
  });
}

/**
 * Open the sprint form in EDIT mode. Reproduces the edit branch
 * (lightboxes.coffee:190-215). `canDelete` is INJECTED (the reducer cannot call
 * `projectService.canEdit('delete_milestone')`). Dates are stored as the
 * canonical `'YYYY-MM-DD'` the API returns - display formatting (`prettyDate`)
 * is a component concern (documented deviation).
 */
export function openSprintFormEdit(
  state: BacklogState,
  args: { sprint: Sprint; canDelete: boolean },
): BacklogState {
  const { sprint, canDelete } = args;
  return produce(state, (draft: BacklogState) => {
    draft.sprintForm = {
      open: true,
      mode: 'edit',
      values: {
        project: sprint.project,
        name: sprint.name,
        estimated_start: sprint.estimated_start,
        estimated_finish: sprint.estimated_finish,
        id: sprint.id,
      },
      lastSprintName: null,
      canDelete,
    };
  });
}

/** Close + reset the sprint form. Reproduces `resetSprint` clearing (lightboxes.coffee:28-40). */
export function closeSprintForm(state: BacklogState): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.sprintForm = {
      open: false,
      mode: 'create',
      values: { project: null, name: null, estimated_start: null, estimated_finish: null },
      lastSprintName: null,
      canDelete: false,
    };
  });
}

/** Merge partial sprint-form field changes (controlled-input updates). */
export function setSprintFormValues(
  state: BacklogState,
  values: Partial<SprintFormValues>,
): BacklogState {
  return produce(state, (draft: BacklogState) => {
    draft.sprintForm.values = { ...draft.sprintForm.values, ...values };
  });
}

/**
 * Optimistically remove a sprint (after `sprintform:remove:success`,
 * lightboxes.coffee:108-118): drop it from the open/closed lists and lookup
 * maps, decrement the appropriate totals, and clear its fold state. If it was
 * the current sprint, clear `currentSprint`.
 */
export function removeSprint(state: BacklogState, sprintId: number): BacklogState {
  return produce(state, (draft: BacklogState) => {
    const wasOpen = draft.sprints.some((s) => s.id === sprintId);
    const wasClosed = draft.closedSprints.some((s) => s.id === sprintId);
    draft.sprints = draft.sprints.filter((s) => s.id !== sprintId);
    draft.closedSprints = draft.closedSprints.filter((s) => s.id !== sprintId);
    if (wasOpen) {
      draft.totalOpenMilestones = Math.max(0, draft.totalOpenMilestones - 1);
      draft.sprintsCounter = draft.sprints.length;
    }
    if (wasClosed) {
      draft.totalClosedMilestones = Math.max(0, draft.totalClosedMilestones - 1);
    }
    if (wasOpen || wasClosed) {
      draft.totalMilestones = Math.max(0, draft.totalMilestones - 1);
    }
    delete draft.sprintOpen[sprintId];
    // Rebuild the by-id maps from the filtered arrays and re-point/clear
    // `currentSprint` (becomes `null` when the removed sprint was the current one).
    syncSprintDerived(draft);
  });
}

/**
 * Optimistically add or replace a sprint (after `sprintform:create/edit:success`):
 * replace the matching open sprint by id, or push it when new. `syncSprintDerived`
 * then rebuilds `sprintsById` from the array (so the map entry is the SAME
 * reference the array holds) and re-points `currentSprint` when the upserted
 * sprint is the current one.
 */
export function upsertSprint(state: BacklogState, sprint: Sprint): BacklogState {
  return produce(state, (draft: BacklogState) => {
    const index = draft.sprints.findIndex((s) => s.id === sprint.id);
    if (index !== -1) {
      draft.sprints[index] = sprint;
    } else {
      draft.sprints.push(sprint);
      draft.sprintsCounter = draft.sprints.length;
      draft.totalOpenMilestones += 1;
      draft.totalMilestones += 1;
    }
    if (!(sprint.id in draft.sprintOpen)) {
      draft.sprintOpen[sprint.id] = !sprint.closed;
    }
    // Rebuild the by-id maps + re-point `currentSprint` to the upserted reference.
    syncSprintDerived(draft);
  });
}


/* ------------------------------------------------------------------ *
 * OPTIONAL discriminated-union reducer
 *
 * A thin, 100%-DELEGATING dispatcher over the individual producers above. It
 * re-implements NO transition logic - every case forwards to the matching
 * producer. For the server-observable `{ state, payload }` producers
 * (`applyDrag`, `moveToCurrentSprint`, `moveToLatestSprint`), the dispatcher
 * returns only `result.state`; the API `payload` is obtained by the hook calling
 * those producers directly (it needs the payload to hit `/api/v1/`). The action
 * variants mirror the consumer surface that `useBacklog` / `BacklogApp` drive.
 * ------------------------------------------------------------------ */

/**
 * The full set of Backlog actions. Each variant's fields map 1:1 to the
 * parameters of the producer it delegates to.
 */
export type BacklogAction =
  | { type: 'SET_PROJECT'; project: Project }
  | { type: 'SET_USERSTORIES'; userstories: UserStory[]; opts?: SetUserstoriesOptions }
  | { type: 'SET_SPRINTS'; milestones: Sprint[]; closed: number; open: number; nowMs: number }
  | { type: 'SET_CLOSED_SPRINTS'; milestones: Sprint[]; closed: number }
  | { type: 'UNLOAD_CLOSED_SPRINTS' }
  | { type: 'SET_PROJECT_STATS'; stats: BacklogStats }
  | { type: 'MARK_NEW_US'; ids: number[] }
  | { type: 'UPDATE_US'; us: UserStory }
  | { type: 'REMOVE_US'; usId: number }
  | { type: 'SET_POINTS_VIEW_ROLE'; roleId: number | null }
  | { type: 'TOGGLE_SHOW_TAGS' }
  | { type: 'TOGGLE_ACTIVE_FILTERS' }
  | { type: 'TOGGLE_VELOCITY' }
  | { type: 'TOGGLE_CLOSED_SPRINTS_VISIBLE' }
  | { type: 'SET_FILTER_QUERY'; query: string }
  | { type: 'SET_FILTERS'; filters: Partial<BacklogFilters> }
  | { type: 'SET_SELECTED_IDS'; ids: number[] }
  | { type: 'TOGGLE_SELECTED_ID'; id: number }
  | { type: 'TOGGLE_SPRINT_FOLD'; sprintId: number }
  | { type: 'OPEN_SPRINT_FORM_CREATE'; projectId: number; nowYmd: string }
  | { type: 'OPEN_SPRINT_FORM_EDIT'; sprint: Sprint; canDelete: boolean }
  | { type: 'CLOSE_SPRINT_FORM' }
  | { type: 'SET_SPRINT_FORM_VALUES'; values: Partial<SprintFormValues> }
  | { type: 'REMOVE_SPRINT'; sprintId: number }
  | { type: 'UPSERT_SPRINT'; sprint: Sprint }
  | { type: 'APPLY_DRAG'; result: BacklogDragResult }
  | { type: 'MOVE_TO_CURRENT_SPRINT' }
  | { type: 'MOVE_TO_LATEST_SPRINT' }
  | { type: 'APPLY_MOVE_RESULT'; updated: BacklogMoveResultEntry[] }
  | { type: 'RESTORE_STATE'; state: BacklogState };

/**
 * Pure dispatcher. Delegates each action to its producer; the `default` case
 * returns `state` unchanged. NO transition is re-implemented here.
 */
export function backlogReducer(state: BacklogState, action: BacklogAction): BacklogState {
  switch (action.type) {
    case 'SET_PROJECT':
      return setProject(state, action.project);
    case 'SET_USERSTORIES':
      return setUserstories(state, action.userstories, action.opts);
    case 'SET_SPRINTS':
      return setSprints(state, {
        milestones: action.milestones,
        closed: action.closed,
        open: action.open,
        nowMs: action.nowMs,
      });
    case 'SET_CLOSED_SPRINTS':
      return setClosedSprints(state, { milestones: action.milestones, closed: action.closed });
    case 'UNLOAD_CLOSED_SPRINTS':
      return unloadClosedSprints(state);
    case 'SET_PROJECT_STATS':
      return setProjectStats(state, action.stats);
    case 'MARK_NEW_US':
      return markNewUs(state, action.ids);
    case 'UPDATE_US':
      return updateUserStory(state, action.us);
    case 'REMOVE_US':
      return removeUserStory(state, action.usId);
    case 'SET_POINTS_VIEW_ROLE':
      return setPointsViewRole(state, action.roleId);
    case 'TOGGLE_SHOW_TAGS':
      return toggleShowTags(state);
    case 'TOGGLE_ACTIVE_FILTERS':
      return toggleActiveFilters(state);
    case 'TOGGLE_VELOCITY':
      return toggleVelocityForecasting(state);
    case 'TOGGLE_CLOSED_SPRINTS_VISIBLE':
      return toggleClosedSprintsVisible(state);
    case 'SET_FILTER_QUERY':
      return setFilterQuery(state, action.query);
    case 'SET_FILTERS':
      return setFilters(state, action.filters);
    case 'SET_SELECTED_IDS':
      return setSelectedIds(state, action.ids);
    case 'TOGGLE_SELECTED_ID':
      return toggleSelectedId(state, action.id);
    case 'TOGGLE_SPRINT_FOLD':
      return toggleSprintFold(state, action.sprintId);
    case 'OPEN_SPRINT_FORM_CREATE':
      return openSprintFormCreate(state, { projectId: action.projectId, nowYmd: action.nowYmd });
    case 'OPEN_SPRINT_FORM_EDIT':
      return openSprintFormEdit(state, { sprint: action.sprint, canDelete: action.canDelete });
    case 'CLOSE_SPRINT_FORM':
      return closeSprintForm(state);
    case 'SET_SPRINT_FORM_VALUES':
      return setSprintFormValues(state, action.values);
    case 'REMOVE_SPRINT':
      return removeSprint(state, action.sprintId);
    case 'UPSERT_SPRINT':
      return upsertSprint(state, action.sprint);
    case 'APPLY_DRAG':
      // Server-observable: the dispatcher keeps only the next state; the hook
      // calls `applyDrag` directly when it also needs the API payload.
      return applyDrag(state, action.result).state;
    case 'MOVE_TO_CURRENT_SPRINT':
      return moveToCurrentSprint(state).state;
    case 'MOVE_TO_LATEST_SPRINT':
      return moveToLatestSprint(state).state;
    case 'APPLY_MOVE_RESULT':
      return applyMoveResult(state, action.updated);
    case 'RESTORE_STATE':
      // Rollback: return the provided pre-move snapshot verbatim (QA BL-1/BL-2).
      return action.state;
    default:
      return state;
  }
}

