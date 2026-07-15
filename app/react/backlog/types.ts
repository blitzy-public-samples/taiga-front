/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Shared TypeScript domain & prop types for the React Backlog screen.
 *
 * This is the FOUNDATIONAL, runtime-free type module for the entire
 * `app/react/backlog/**` tree: `useBacklogState.ts`, every `*.tsx`
 * component, and the `__tests__` import their domain types from here.
 *
 * The shapes are synthesized from the AngularJS sources that this migration
 * replaces (`app/coffee/modules/backlog/main.coffee`,
 * `app/coffee/modules/resources/userstories.coffee`,
 * `app/coffee/modules/backlog/sprints.coffee`) together with the JSON
 * returned by the frozen `/api/v1/` endpoints.
 *
 * Design notes:
 * - The "entity" interfaces (UserStory, Sprint, Project, ProjectStats) are
 *   intentionally kept OPEN with a trailing `[key: string]: unknown;` index
 *   signature. The backend returns far more fields than the UI reads, and
 *   version-based optimistic concurrency requires that we round-trip those
 *   unknown fields verbatim on every PATCH/PUT. Narrowing the shape would
 *   silently drop server data.
 * - `unknown` (never `any`) is used for genuinely open-ended values so the
 *   compiler still forces callers to narrow before use.
 * - This module is standalone: it declares its own richer domain types rather
 *   than importing the intentionally-minimal `UserStory` from
 *   `../shared/api/userstories.ts`. It has NO imports of any kind.
 */

/* -------------------------------------------------------------------------- */
/* Primitive / utility aliases                                                */
/* -------------------------------------------------------------------------- */

/** Numeric primary key used throughout the Taiga API. */
export type Id = number;

/**
 * A Taiga tag is a 2-tuple `[tagName, hexColorOrNull]`.
 *
 * Rendered in `backlog-row.jade` as
 * `ng-repeat="tag in us.tags" ng-style="{background: tag[1]}"` displaying
 * `{{tag[0]}}`, so element 0 is the display name and element 1 is the
 * background color (which may be null when the tag has no color).
 */
export type Tag = readonly [name: string, color: string | null];

/** A permission slug from `project.my_permissions` (e.g. `"modify_us"`). */
export type Permission = string;

/* -------------------------------------------------------------------------- */
/* Project configuration entities                                             */
/* -------------------------------------------------------------------------- */

/**
 * An estimation point option, from `project.points`.
 *
 * `value` is nullable: the special "?" point carries `value: null`.
 */
export interface Point {
  id: Id;
  name: string;
  value: number | null;
  order: number;
  [key: string]: unknown;
}

/**
 * A project role, from `project.roles`.
 *
 * `computable` gates whether the role participates in points estimation
 * (`_.filter(project.roles, "computable")` in the controller).
 */
export interface Role {
  id: Id;
  name: string;
  slug?: string;
  computable: boolean;
  order?: number;
  [key: string]: unknown;
}

/**
 * A user-story status, from `project.us_statuses`.
 */
export interface UsStatus {
  id: Id;
  name: string;
  color: string;
  order: number;
  is_closed: boolean;
  is_archived?: boolean;
  [key: string]: unknown;
}

/**
 * An epic pill shown on a user story, from `us.epics[]`.
 *
 * Rendered in `backlog-row.jade` `.belong-to-epic-pill` with
 * `title="#{{epic.ref}} {{epic.subject}}"` and
 * `ng-style="{'background': epic.color}"`.
 */
export interface Epic {
  id?: Id;
  ref: number;
  subject: string;
  color: string;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Core entities                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The central Backlog entity: a user story.
 *
 * The explicitly-declared fields are every property the Backlog UI reads
 * (see `backlog-row.jade`, `sprint.jade`, and the controller logic in
 * `backlog/main.coffee`). The trailing index signature preserves every other
 * server field for optimistic-concurrency round-tripping.
 */
export interface UserStory {
  id: Id;
  ref: number;
  subject: string;
  project: Id;
  status: Id;
  /** `null` means the story is in the backlog (not assigned to a sprint). */
  milestone: Id | null;
  /**
   * Points estimation map: `roleId` (as a string key) -> `pointId`.
   * `onSelectedPointForRole` mutates this map in the points selector.
   */
  points: Record<string, Id>;
  /** Server-computed sum of points; `null` when the story is unestimated. */
  total_points: number | null;
  backlog_order: number;
  sprint_order: number;
  kanban_order?: number;
  assigned_to: Id | null;
  is_blocked: boolean;
  is_closed: boolean;
  tags: Tag[] | null;
  epics: Epic[] | null;
  due_date: string | null;
  due_date_status?: string;
  /**
   * REQUIRED for optimistic-concurrency PATCH/PUT: it must be echoed back with
   * every mutation so the backend can detect conflicting concurrent edits.
   */
  version: number;
  /**
   * Transient UI-only flag set by the controller (`it.new = true` when the
   * story id is in `newUs[]`); drives the `.new` blink animation class.
   * Not persisted to the server.
   */
  new?: boolean;
  [key: string]: unknown;
}

/**
 * A sprint.
 *
 * NOTE: `Sprint` and {@link Milestone} are the SAME server entity — the REST
 * route/resource is named "milestone" while the Backlog UI calls it a
 * "sprint". `estimated_start` / `estimated_finish` are `YYYY-MM-DD` strings.
 */
export interface Sprint {
  id: Id;
  name: string;
  slug: string;
  project: Id;
  /** `YYYY-MM-DD`. */
  estimated_start: string;
  /** `YYYY-MM-DD`. */
  estimated_finish: string;
  closed: boolean;
  closed_points: number;
  total_points: number;
  user_stories: UserStory[];
  order?: number;
  [key: string]: unknown;
}

/**
 * Alias for {@link Sprint}. Use `Milestone` when interacting with the
 * "milestone"-named resource in `../shared/api/milestones.ts`; the two are
 * structurally identical.
 */
export type Milestone = Sprint;

/**
 * A single data point of `stats.milestones[]`, consumed by the burndown graph
 * (`tgBurndownBacklogGraph`).
 *
 * The `team-increment` / `client-increment` field names contain hyphens, so
 * they MUST be declared as quoted string keys.
 */
export interface BurndownPoint {
  name: string;
  optimal: number;
  evolution: number | null;
  "team-increment": number;
  "client-increment": number;
  [key: string]: unknown;
}

/**
 * Aggregate project statistics, from `rs.projects.stats(projectId)`
 * (`httpGet('projects/{id}/stats')`), used to render the burndown graph and
 * the backlog summary/velocity widgets.
 */
export interface ProjectStats {
  total_points: number | null;
  defined_points: number;
  closed_points: number;
  assigned_points: number;
  speed: number;
  total_milestones: number | null;
  milestones: BurndownPoint[];
  /**
   * CLIENT-computed and stored back onto the stats object by the controller:
   * `Math.round(100 * closed_points / totalPoints)` (or `0` when there are no
   * points). Optional because it is derived, not returned by the server.
   */
  completedPercentage?: number;
  [key: string]: unknown;
}

/**
 * The current project, from `tgProjectService.project.toJS()`.
 *
 * Only the fields the Backlog UI reads are declared explicitly; all other
 * server fields are preserved by the index signature.
 */
export interface Project {
  id: Id;
  slug: string;
  name: string;
  description?: string;
  my_permissions: Permission[];
  roles: Role[];
  points: Point[];
  us_statuses: UsStatus[];
  is_backlog_activated: boolean;
  is_kanban_activated: boolean;
  /** Non-null when the project is archived; disables drag-and-drop. */
  archived_code?: string | null;
  default_us_status: Id;
  total_milestones: number | null;
  i_am_admin: boolean;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Filter widget contract                                                     */
/* -------------------------------------------------------------------------- */

/** A single selectable value within a {@link FilterCategory}. */
export interface FilterOption {
  id: Id | string;
  name: string;
  color?: string;
  count?: number;
  type?: string;
  [key: string]: unknown;
}

/** A group of filter options (e.g. "Status", "Tags", "Assigned to"). */
export interface FilterCategory {
  title: string;
  dataType: string;
  content: FilterOption[];
  [key: string]: unknown;
}

/** A filter value the user has currently applied. */
export interface SelectedFilter {
  id: Id | string;
  name: string;
  dataType: string;
  mode?: string;
  color?: string;
  [key: string]: unknown;
}

/** A saved custom filter, from the custom-filters store. */
export interface CustomFilter {
  id: Id;
  name: string;
  [key: string]: unknown;
}

/** The complete set of filter categories rendered by the filter widget. */
export type Filters = FilterCategory[];

/* -------------------------------------------------------------------------- */
/* Handler / prop helper types                                                */
/* -------------------------------------------------------------------------- */

/** A zero-argument, void-returning callback. */
export type VoidHandler = () => void;

/**
 * The shared user-story action contract prop-drilled from `BacklogApp` down to
 * the row/list components so every consumer agrees on the same callbacks.
 */
export interface UserStoryActions {
  /** Opens the shared AngularJS generic edit form via the framework bridge. */
  onEditUserStory: (us: UserStory) => void;
  onDeleteUserStory: (us: UserStory) => void;
  onMoveToTop: (us: UserStory) => void;
  onChangeStatus: (us: UserStory, statusId: Id) => void;
  onChangePoints: (us: UserStory, roleId: Id, pointId: Id) => void;
}
