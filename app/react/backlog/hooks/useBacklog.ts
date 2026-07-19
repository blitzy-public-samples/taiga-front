/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useBacklog
 * ----------
 * The effectful / data layer of the React Backlog screen, part of the
 * AngularJS 1.5.10 -> React 18 coexistence migration (Blitzy AAP 0.1-0.4).
 *
 * This hook reproduces the ASYNC responsibilities of the AngularJS
 * `BacklogController` (`app/coffee/modules/backlog/main.coffee`, 1385 lines):
 * data loading, pagination, HTTP header parsing, ordering, WebSocket
 * subscriptions (including the milestones `selfNotification` nuance), and the
 * optimistic-then-reconcile move flows. It is a BEHAVIORAL re-implementation,
 * NOT a port: it reproduces the exact runtime semantics while consuming the
 * FROZEN `/api/v1/` REST + WebSocket contract through the shared React adapters
 * only.
 *
 * SEPARATION OF CONCERNS:
 *   - ALL state mutation lives in the PURE immer reducer `../state/backlogReducer`.
 *     This hook never mutates state directly; it only dispatches actions and
 *     injects wall-clock values (`nowMs` / `nowYmd`) and transport concerns
 *     (parsed HTTP headers) that the pure reducer must not compute itself.
 *   - The hook returns `{ state, actions }`; the presentational layer
 *     (`../BacklogApp.tsx` and its children) renders `state` and calls `actions`.
 *
 * COEXISTENCE BOUNDARY (AAP 0.7 - HARD RULES): the cross-framework boundary is
 * GLOBALS + `/api/v1/` ONLY. This module imports NOTHING from the AngularJS /
 * CoffeeScript tree (`app/coffee/**`, `app/modules/**`), never touches
 * `angular` / `immutable` / `dragula` / `dom-autoscroller` / `checksley` /
 * `jquery`, and does NOT import `../../shared/dnd/*` or `../../shared/validation/*`
 * (drag-and-drop wiring and sprint-form validation are owned by
 * `../BacklogApp.tsx` / the `SprintForm` component, not by this hook). Every
 * network call flows through `../../shared/api/*`, which owns the base-URL join,
 * the Bearer token, `X-Session-Id`, and `Accept-Language`.
 *
 * Doc comments on each action cite the `main.coffee` / `lightboxes.coffee` line
 * ranges the action reproduces, so behavioral parity can be audited.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

// Pure immer reducer + its producers, selectors, action union, and ALL public
// types (the reducer is this hook's first-order dependency). The three movement
// producers are aliased with a `produce*` prefix so they do not clash with this
// hook's own action names.
import {
  backlogReducer,
  createInitialState,
  applyDrag as produceApplyDrag,
  moveToCurrentSprint as produceMoveToCurrentSprint,
  moveToLatestSprint as produceMoveToLatestSprint,
  type BacklogState,
  type BacklogStats,
  type BacklogFilters,
  type Project,
  type Sprint,
  type SprintFormValues,
  type UserStory,
} from '../state/backlogReducer';

// Shared adapters (globals-only interop layer over the frozen /api/v1/ + WS).
// `httpClient` / `eventsClient` inject the Bearer token, `X-Session-Id`, and
// `Accept-Language` internally, so `../../shared/session` is intentionally NOT
// imported here.
import httpClient from '../../shared/api/httpClient';
import userstories, { type FiltersDataResponse } from '../../shared/api/userstories';
import milestones from '../../shared/api/milestones';
import { createEventsClient, routingKeys } from '../../shared/events/eventsClient';
import { getEventsUrl } from '../../shared/config';
import { serializeAppliedFilters, type SerializableAppliedFilter } from '../../shared/filters';
import {
  locationHasManagedParams,
  parseAppliedFiltersFromSearch,
  readLocationSearch,
  extractQueryText,
} from '../../shared/filterUrl';

import moment from 'moment';

/* ------------------------------------------------------------------ *
 * Module-level constants & helpers
 * ------------------------------------------------------------------ */

/**
 * The whitelist of URL query params the backlog user-story list honours.
 * Reproduces `BacklogController.validQueryParams` (main.coffee:55-68) EXACTLY.
 * Exported so `BacklogApp` can persist the same key set to the URL / storage.
 */
export const VALID_QUERY_PARAMS = [
  'exclude_status',
  'status',
  'exclude_tags',
  'tags',
  'exclude_assigned_users',
  'assigned_users',
  'exclude_role',
  'role',
  'exclude_epic',
  'epic',
  'exclude_owner',
  'owner',
] as const;

/**
 * Per-project-slug `localStorage` key for the backlog applied filters. Mirrors
 * the sibling Kanban's `${projectSlug}:kanban-filters` convention (a simple,
 * readable per-project key rather than the legacy hashed key -- reproducing the
 * exact `generateHash` key is outside the coexistence boundary, AAP 0.7).
 */
export function backlogFiltersStorageKey(projectSlug: string | undefined): string {
  return `${projectSlug ?? ''}:backlog-filters`;
}

/**
 * Read a JSON value from `localStorage`, returning `fallback` on a missing key,
 * malformed JSON, or a private-mode/quota error. Used ONLY for the documented
 * backlog filter UI-preference persistence.
 */
function readStored<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return fallback;
    }
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Compute the initial backlog filter model by restoring from the URL first and
 * falling back to `localStorage` ONLY when the URL carries no managed params --
 * reproducing the legacy "URL wins on load" precedence of `applyStoredFilters`
 * (controllerMixins.coffee:106-118). Runs once, inside the `useReducer` lazy
 * initializer, so the very first `loadBacklog` already issues the restored,
 * filtered `/userstories` query. Restored chip ids carry placeholder (id) names
 * that `BacklogApp` reconciles to labels once `filters_data` resolves.
 */
function hydrateInitialFilters(
  projectSlug: string | undefined,
): { selected: unknown[]; query: string } {
  if (locationHasManagedParams(VALID_QUERY_PARAMS)) {
    const search = readLocationSearch();
    return {
      selected: parseAppliedFiltersFromSearch(search, VALID_QUERY_PARAMS),
      query: extractQueryText(search),
    };
  }
  const stored = readStored<unknown[]>(backlogFiltersStorageKey(projectSlug), []);
  return { selected: Array.isArray(stored) ? stored : [], query: '' };
}

/**
 * Minimal object-key picker (lodash-free). Reproduces `_.pick(obj, keys)`:
 * returns a new object containing ONLY the whitelisted keys that are present
 * (own, non-`undefined`) on the source. `lodash` is intentionally NOT imported
 * - no `@types/lodash` ships in this project and no sibling React module
 * depends on it, so a tiny local helper keeps the file self-contained and
 * strictly typed (AAP 0.7 minimal-change / isolation).
 */
function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

/**
 * React substitute for the AngularJS `_.clone(@location.search())` read in
 * `loadUserstories` (main.coffee:346). AngularJS read the live URL query string;
 * React has no `$location`, so the applied categorical filter selections are
 * read from the reducer's filter model instead. The CONCRETE serialization of
 * categorical filters (status / tags / assigned_users / ... -> comma-joined id
 * strings) is owned by the Backlog FilterBar / filter service that populates
 * this model; the CONCRETE serialization of the applied categorical selections
 * (`selected`) into comma-joined id strings per `VALID_QUERY_PARAMS` is done by
 * the shared `serializeAppliedFilters` helper (BL-11). The free-text query is
 * mapped to `q` SEPARATELY by `loadUserstories` (`params.q = @.filterQ`,
 * main.coffee:353), so it is NOT emitted here.
 */
function mapFiltersToQuery(filters: BacklogFilters): Record<string, unknown> {
  // BL-11: `selected` holds the applied include/exclude filter chips (populated
  // by the Backlog `FilterBar`). Serialize them into `status` / `tags` /
  // `assigned_users` / `role` / `owner` / `epic` (+ their `exclude_` forms).
  const selected = (filters.selected ?? []) as SerializableAppliedFilter[];
  return serializeAppliedFilters(selected, VALID_QUERY_PARAMS);
}

/**
 * Parse a Taiga boolean-ish response header into `boolean | null`. AngularJS
 * assigned the raw header value straight onto `@scope.noSwimlaneUserStories`
 * (main.coffee:403-404), relying on JS truthiness; the reducer types that field
 * as `boolean`, so the header (a count like `"3"`, or a flag like `"true"` /
 * `"false"`) is normalised here. `null` means "header absent" -> leave the flag
 * unchanged.
 */
function parseBoolHeader(value: string | null): boolean | null {
  if (value == null) {
    return null;
  }
  const lower = value.trim().toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  const asNumber = Number(value);
  return Number.isNaN(asNumber) ? value.length > 0 : asNumber > 0;
}

/**
 * The Backlog drag-result payload consumed by the reducer's `APPLY_DRAG` action
 * (`result: BacklogDragResult`). The canonical declaration lives in
 * `../../shared/dnd/types`, which is OUTSIDE this hook's allowed import boundary
 * (AAP 0.7 HARD RULE). Rather than duplicate the interface (which could drift)
 * or import from the forbidden path, we extract the EXACT type losslessly from
 * the reducer's exported `applyDrag` signature - a purely type-level reference
 * through the single allowed reducer import.
 */
export type BacklogDragResult = Parameters<typeof produceApplyDrag>[1];

/* ------------------------------------------------------------------ *
 * Public API types
 * ------------------------------------------------------------------ */

/** Parameters accepted by {@link useBacklog}. */
export interface UseBacklogParams {
  /** Project slug from the preserved route `/project/:pslug/backlog`. */
  projectSlug: string;
  /**
   * Preferred: the numeric project id passed directly by `../BacklogApp.tsx` /
   * `../elements/TgReactBacklog`. When omitted, the hook resolves it from
   * `projectSlug` via `GET projects/by_slug`.
   */
  projectId?: number;
}

/**
 * The stable, memoized action surface the presentational layer drives. Every
 * function is wrapped in `useCallback` and the object is assembled with
 * `useMemo`, so consumers may safely place `actions` (or individual actions) in
 * effect dependency arrays.
 */
export interface BacklogActions {
  // --- data loading ---
  loadBacklog(): Promise<void>;
  loadProjectStats(): Promise<void>;
  loadSprints(): Promise<void>;
  loadClosedSprints(): Promise<void>;
  unloadClosedSprints(): void;
  loadUserstories(resetPagination?: boolean, pageSize?: number): Promise<void>;
  loadMoreUserstories(): Promise<void>;
  // --- drag move (optimistic onMove; drag API owned by shared/dnd/sortable) ---
  applyDrag(result: BacklogDragResult): void;
  /**
   * Drag WRITE-failure callback (QA BL-1): wired into the shared drag-end
   * handler's `onMoveError`. Rolls back the optimistic `applyDrag` update and
   * surfaces `writeError`.
   */
  onDragError(err: unknown): void;
  /** Dismiss the save-failure surface (`writeError`) - BL-1/BL-2. */
  clearWriteError(): void;
  reconcileAfterMove(): Promise<void>;
  // --- toolbar move to sprint ---
  moveToCurrentSprint(usIds?: number[]): Promise<void>;
  moveToLatestSprint(usIds?: number[]): Promise<void>;
  // --- sprint form ---
  openSprintForm(mode: 'create' | 'edit', sprint?: Sprint): void;
  closeSprintForm(): void;
  submitSprintForm(values: SprintFormValues, mode: 'create' | 'edit', editingId?: number): Promise<void>;
  removeSprint(id: number): Promise<void>;
  // --- inline row controls (finding #12) ---
  /**
   * Change a story's status inline (status-dropdown widget). PATCHes
   * `{ status, version }`, replaces the row with the server copy, then refreshes
   * stats + filters (legacy `updateUserStoryStatus`, `backlog/main.coffee:646`).
   */
  changeUsStatus(us: UserStory, statusId: number): Promise<void>;
  /**
   * Set a story's per-role points inline (points widget). Clones `us.points`,
   * assigns `points[roleId] = pointId`, PATCHes `{ points, version }`, replaces
   * the row, then refreshes stats (legacy `onSelectedPointForRole` ->
   * `$repo.save`, `estimation.coffee:154-166`).
   */
  changeUsPoints(us: UserStory, roleId: number, pointId: number): Promise<void>;
  /**
   * Delete a story inline (⋮ options "Delete"). DELETEs `userstories/{id}`,
   * removes the row, then refreshes stats + sprints + first-story indicator
   * (legacy `deleteUserStory`, `backlog/main.coffee:662`). The blocking
   * confirmation is owned by the caller (BacklogApp) — this performs the write.
   */
  deleteUserStory(us: UserStory): Promise<void>;
  /**
   * Move a story to the TOP of the backlog (⋮ options "Move to top"). Reuses the
   * bulk backlog-order move (legacy `moveUsToTopOfBacklog` -> `moveUs`,
   * `backlog/main.coffee:511-517`).
   */
  moveUsToTop(us: UserStory): Promise<void>;
  // --- add user story (finding #16) ---
  /**
   * Create a SINGLE user story from the backlog "+ Add" toolbar button or the
   * empty-state "Create your first user story" button. POSTs
   * `{ project, subject, status }` with `status = project.default_us_status`
   * (legacy `addNewUs('standard')` -> generic form -> `POST /userstories`,
   * `backlog/main.coffee:683-691`), then reloads the backlog list + project
   * stats so the new story appears in the backlog. A blank subject is a no-op.
   */
  addStoryStandard(subject: string): Promise<void>;
  /**
   * Bulk-create user stories from the backlog bulk-add lightbox — one subject
   * per line. POSTs the raw multiline text to `bulk_create` with
   * `status = project.default_us_status` (legacy `addNewUs('bulk')` ->
   * `POST /userstories/bulk_create`, `backlog/main.coffee:683-691`), then reloads
   * the backlog list + project stats. Blank text is a no-op.
   */
  addStoryBulk(bulkText: string): Promise<void>;
  // --- filters & view toggles ---
  setFilter(next: Partial<BacklogFilters>): void;
  toggleShowTags(): void;
  toggleClosedSprints(): Promise<void>;
  setSelectedIds(ids: number[]): void;
  toggleSprintFold(sprintId: number): void;
  toggleActiveFilters(): void;
  toggleVelocityForecasting(): void;
  /**
   * Set the "view points per Role" header selection (`null` = All roles / totals;
   * a role id = that role's per-role label). Legacy `uspoints:select` /
   * `uspoints:clear-selection` (`backlog/main.coffee:995-1021`).
   */
  setPointsViewRole(roleId: number | null): void;
}

/** Return shape of {@link useBacklog}. */
export interface UseBacklogResult {
  state: BacklogState;
  actions: BacklogActions;
  /**
   * BL-11: raw `filters_data` response used to build the Backlog filter sidebar
   * (all categories, per-option counts, and the Unassigned / Not-in-an-epic
   * pseudo-options). `null` until the first fetch resolves.
   */
  filtersData: FiltersDataResponse | null;
  /**
   * A failed optimistic move WRITE (drag `bulkUpdateBacklogOrder` - BL-1 - or
   * toolbar `bulkUpdateMilestone` - BL-2), AFTER the board has been rolled back;
   * `null` when clear. Mirrors the Kanban hook's `writeError`. `BacklogApp`
   * renders the "changes were not saved" alert when this is non-null.
   */
  writeError: Error | null;
}

/* ------------------------------------------------------------------ *
 * Hook
 * ------------------------------------------------------------------ */

/**
 * React hook that owns the Backlog screen's data + effects and drives the pure
 * `../state/backlogReducer`. See the module doc comment for the design contract.
 */
export function useBacklog(params: UseBacklogParams): UseBacklogResult {
  // The pure reducer holds ALL board state; `createInitialState()` is the
  // canonical factory (NOT `initialBacklogState()`). A lazy initializer overlays
  // the filter model restored from the URL / `localStorage` (see
  // `hydrateInitialFilters`) so the FIRST `loadBacklog` already issues the
  // restored, filtered query -- reproducing `applyStoredFilters` running before
  // `loadInitialData` on the AngularJS side.
  const [state, dispatch] = useReducer(backlogReducer, undefined, () => {
    const base = createInitialState();
    const hydrated = hydrateInitialFilters(params.projectSlug);
    base.filters = { ...base.filters, selected: hydrated.selected, query: hydrated.query };
    return base;
  });

  // Async callbacks must read the LATEST state, not a stale render closure.
  // `stateRef` is re-synced after every render; async actions read
  // `stateRef.current` for pagination page, current sprints, selection,
  // closed-sprints visibility, and filters.
  const stateRef = useRef<BacklogState>(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // The effective numeric project id. Kept in a ref (read by every load action)
  // AND mirrored into React state so the WebSocket effect re-runs once the id is
  // resolved (a ref change alone would not trigger the effect).
  const projectIdRef = useRef<number | null>(params.projectId ?? null);
  const [resolvedProjectId, setResolvedProjectId] = useState<number | null>(params.projectId ?? null);

  // BL-11: the `filters_data` response (GET /userstories/filters_data), the
  // authoritative source for the Backlog filter sidebar's categories and
  // per-option story counts (`generateFilters` <- `rs.userstories.filtersData`,
  // main.coffee). Backlog shows ALL categories (no `excludeFilters`). Held as
  // hook state (not reducer state) so the sidebar rebuilds as counts change,
  // mirroring the sibling Kanban hook.
  const [filtersData, setFiltersData] = useState<FiltersDataResponse | null>(null);

  /* --------------- optimistic-move rollback + save-failure (QA BL-1/BL-2) --------------- */

  // `writeError` mirrors the Kanban hook's `writeError` (useKanbanBoard.ts): a
  // failed optimistic move WRITE - the drag `bulkUpdateBacklogOrder` (BL-1) or
  // the toolbar `bulkUpdateMilestone` (BL-2) - sets it AFTER the board has been
  // rolled back, so `BacklogApp` can render the "changes were not saved" alert.
  // `null` when clear. It is kept OUT of the reducer state (as in Kanban) so it
  // is never captured in a rollback snapshot.
  const [writeError, setWriteError] = useState<Error | null>(null);

  // Pre-drag snapshot captured by `applyDrag` BEFORE its optimistic dispatch, so
  // the paired `onDragError` can restore it if the drag write rejects. A single
  // ref suffices because the drag-end handler serializes drops (each `run()`
  // settles before the next), so at most one drag's snapshot is ever pending.
  const dragSnapshotRef = useRef<BacklogState | null>(null);

  /* ---------------------------- data loading ---------------------------- */

  /**
   * Reproduces `loadProjectStats` (main.coffee:256-268): `GET projects/{id}/stats`.
   * The RAW stats are dispatched; the reducer's `setProjectStats` computes
   * `totalPoints = stats.total_points || stats.defined_points`,
   * `completedPercentage = totalPoints ? round(100 * closed_points / totalPoints) : 0`,
   * and `showGraphPlaceholder = !(total_points != null && total_milestones != null)`
   * (main.coffee:259-266).
   */
  const loadProjectStats = useCallback(async (): Promise<void> => {
    const pid = projectIdRef.current;
    if (pid == null) {
      return;
    }
    const stats = await httpClient.get<BacklogStats>(`projects/${pid}/stats`);
    dispatch({ type: 'SET_PROJECT_STATS', stats });
  }, []);

  /**
   * Reproduces `loadSprints` (main.coffee:304-330): list the OPEN milestones and
   * hand them to the reducer, which sorts each sprint's `user_stories` by
   * `sprint_order`, records the open/closed/total counters, groups sprints by id,
   * and computes `currentSprint = findCurrentSprint(sprints, nowMs)`.
   * `nowMs` is INJECTED here because the reducer is pure and `findCurrentSprint`
   * (main.coffee:696-703) uses `new Date().getTime()`.
   */
  const loadSprints = useCallback(async (): Promise<void> => {
    const pid = projectIdRef.current;
    if (pid == null) {
      return;
    }
    const result = await milestones.list(pid, { closed: false });
    dispatch({
      type: 'SET_SPRINTS',
      milestones: result.milestones as Sprint[],
      closed: result.closed,
      open: result.open,
      nowMs: Date.now(),
    });
  }, []);

  /**
   * Reproduces `loadClosedSprints` (main.coffee:281-296): list the CLOSED
   * milestones. The reducer sorts `user_stories` by `sprint_order`, sets
   * `closedSprints` + `closedSprintsById`, and records `totalClosedMilestones`.
   */
  const loadClosedSprints = useCallback(async (): Promise<void> => {
    const pid = projectIdRef.current;
    if (pid == null) {
      return;
    }
    const result = await milestones.list(pid, { closed: true });
    dispatch({
      type: 'SET_CLOSED_SPRINTS',
      milestones: result.milestones as Sprint[],
      closed: result.closed,
    });
  }, []);

  /**
   * Reproduces `unloadClosedSprints` (main.coffee:276-279): clears the loaded
   * closed sprints. Synchronous (`void`).
   */
  const unloadClosedSprints = useCallback((): void => {
    dispatch({ type: 'UNLOAD_CLOSED_SPRINTS' });
  }, []);

  /**
   * Reproduces `loadUserstories` (main.coffee:341-408). Guards on the project id
   * (main.coffee:342), builds the request params from the reducer filter model
   * (React has no `$location`), fetches WITH response headers, and parses the
   * pagination / total / no-swimlane headers HERE (the pure reducer never sees
   * `Headers`). AngularJS used `header(name)` as a function; React uses
   * `Headers.get(name)`.
   */
  const loadUserstories = useCallback(
    async (resetPagination = false, pageSize?: number): Promise<void> => {
      const pid = projectIdRef.current;
      if (pid == null) {
        return; // main.coffee:342 `return null if !@scope.projectId`
      }
      const current = stateRef.current;
      const filtersQuery = pick(mapFiltersToQuery(current.filters), VALID_QUERY_PARAMS);
      const page = resetPagination ? 1 : current.page;
      const requestParams: Record<string, unknown> = {
        project: pid,
        milestone: 'null', // STRING "null" - EXACT: resources/userstories.coffee:46
        ...filtersQuery,
        page,
        q: current.filters.query ?? '', // params.q = @.filterQ (main.coffee:353)
      };
      if (pageSize != null) {
        requestParams.page_size = pageSize; // listUnassigned pageSize (resources/userstories.coffee:51-52)
      }

      // `rs.userstories.listUnassigned` returned `[userstories, header]`
      // (main.coffee:359); the adapter path returns the parsed body + `Headers`.
      const { data, headers } = await httpClient.getWithHeaders<UserStory[] | null>(
        'userstories',
        requestParams,
      );

      // Header parsing (reproduces `parseLoadUserstoriesResponse`, main.coffee:390-404):
      //   - `x-pagination-next` present -> more pages (reducer sets
      //     `disablePagination = false` and increments `page`) (l.390-392),
      //   - `Taiga-Info-Backlog-Total-Userstories` -> total (l.394-395),
      //   - `Taiga-Info-Userstories-Without-Swimlane` -> no-swimlane flag (l.397-398).
      const hasNext = headers.get('x-pagination-next') != null;
      const totalHeader = headers.get('Taiga-Info-Backlog-Total-Userstories');
      const noSwimlaneHeader = headers.get('Taiga-Info-Userstories-Without-Swimlane');

      dispatch({
        type: 'SET_USERSTORIES',
        userstories: data ?? [],
        opts: {
          resetPagination,
          hasNext,
          total: totalHeader != null ? Number(totalHeader) : null,
          // The reducer's `noSwimlane` option is `boolean | null` (the field it
          // feeds, `noSwimlaneUserStories`, is `boolean`), so the raw header is
          // normalised to a boolean flag rather than the raw number the source
          // implicitly relied on via JS truthiness.
          noSwimlane: parseBoolHeader(noSwimlaneHeader),
        },
      });
    },
    [],
  );

  /**
   * Infinite-scroll append: reloads the NEXT page using the current (already
   * incremented) `page`. Equivalent to `loadUserstories()` without reset.
   */
  const loadMoreUserstories = useCallback(async (): Promise<void> => {
    await loadUserstories(false);
  }, [loadUserstories]);

  /**
   * Private helper reproducing `loadAllPaginatedUserstories` (main.coffee:335-339):
   * reload EVERY currently-loaded story as a single page so a WebSocket-triggered
   * refresh does not lose the user's scroll position. The source saves/restores
   * `@.page`; the reducer owns `page` and re-derives it from the pagination
   * headers of the reloaded (reset) page, so an explicit page-counter restore is
   * unnecessary (a minor, non-visible detail).
   */
  const reloadAllUserstories = useCallback(async (): Promise<void> => {
    const size = stateRef.current.userstories.length || undefined;
    await loadUserstories(true, size);
  }, [loadUserstories]);

  /**
   * `generateFilters` data source (main.coffee): fetches
   * `GET /userstories/filters_data?project={id}` (PROJECT-WIDE — no `milestone`,
   * so the sidebar reflects the whole backlog) and stores the response so the
   * consumer can build the filter sidebar with real per-option counts and the
   * server-provided Unassigned / Not-in-an-epic pseudo-options (BL-11).
   *
   * NON-FATAL (see the sibling Kanban hook): the sidebar is a presentational
   * enhancement; a `filters_data` failure must never blank the backlog or escape
   * as an uncaught rejection, so the error is swallowed after leaving the
   * last-known-good `filtersData` in place.
   */
  const loadFiltersData = useCallback(async (): Promise<void> => {
    const pid = projectIdRef.current;
    if (pid == null) {
      return;
    }
    try {
      const data = await userstories.filtersData(pid);
      setFiltersData(data);
    } catch {
      // Non-fatal (see doc comment): keep the prior sidebar rather than crash.
    }
  }, []);

  /**
   * Reproduces `loadBacklog` (main.coffee:410-415): parallel load of project
   * stats, sprints, and the first user-story page. The source calls
   * `loadUserstories()` without reset, but this is the first load (page already
   * 1), so `loadUserstories(true)` is equivalent and clearer. The trailing
   * `calculateForecasting()` (main.coffee:415) has NO dispatchable reducer action
   * (there is no `SET_FORECAST`; `setForecastedStories` is a non-dispatched
   * producer) and only affects the velocity-forecast view - hidden while
   * `displayVelocity` is false (the default) - so the recompute is intentionally
   * omitted to stay within the reducer's action surface.
   *
   * BL-11: also loads the filter sidebar data (`generateFilters`, main.coffee)
   * so the `#backlog-filter` sidebar is populated on the initial backlog load.
   */
  const loadBacklog = useCallback(async (): Promise<void> => {
    await Promise.all([
      loadProjectStats(),
      loadSprints(),
      loadUserstories(true),
      loadFiltersData(),
    ]);
  }, [loadProjectStats, loadSprints, loadUserstories, loadFiltersData]);


  /* ------------------------- drag move & reconcile ------------------------- */

  /**
   * Optimistic `onMove` updater for the DRAG path (matches the
   * `OnBacklogMove = (result: BacklogDragResult) => void` signature). The drag
   * API call (`userstories.bulkUpdateBacklogOrder`) is owned by
   * `../../shared/dnd/sortable`'s drag-end handler, which `../BacklogApp.tsx`
   * wires into the DnD provider; that handler invokes this `onMove` BEFORE
   * awaiting the API. Here we ONLY apply the optimistic reorder by dispatching
   * `APPLY_DRAG` - the reducer's `applyDrag` producer reorders the backlog /
   * sprint lists (reproducing `moveUs`, main.coffee:523-596, including the
   * source's head-insert quirk at l.588-591, which is preserved byte-for-byte at
   * the reducer level and must NOT be "fixed" here). The producer's API payload
   * is intentionally ignored on this path (the dnd handler computes its own).
   */
  const applyDrag = useCallback((result: BacklogDragResult): void => {
    // BL-1 rollback prep: snapshot the pre-move state BEFORE the optimistic
    // dispatch so the paired `onDragError` can restore it if the write rejects.
    // The ref read is synchronous and reflects the latest committed state.
    // Clearing any stale write error mirrors Kanban's `setWriteError(null)` on a
    // fresh move.
    dragSnapshotRef.current = stateRef.current;
    setWriteError(null);
    dispatch({ type: 'APPLY_DRAG', result });
  }, []);

  /**
   * Failure callback for the DRAG path (QA BL-1), wired by `../BacklogApp.tsx`
   * into the shared drag-end handler's `onMoveError`. When
   * `bulkUpdateBacklogOrder` rejects, restore the exact pre-move snapshot
   * captured by `applyDrag` (undoing the optimistic reorder so the board
   * reconverges with the unchanged server state) and surface the error so the
   * "changes were not saved" alert renders. Never throws - the handler invokes
   * it fire-and-forget.
   */
  const onDragError = useCallback((err: unknown): void => {
    const snapshot = dragSnapshotRef.current;
    if (snapshot) {
      dispatch({ type: 'RESTORE_STATE', state: snapshot });
      dragSnapshotRef.current = null;
    }
    setWriteError(err instanceof Error ? err : new Error(String(err)));
  }, []);

  /**
   * Clears the save-failure surface (BL-1/BL-2). Exposed so `BacklogApp` can
   * dismiss the alert; the surface is ALSO cleared automatically at the start of
   * the next optimistic move (`applyDrag`).
   */
  const clearWriteError = useCallback((): void => {
    setWriteError(null);
  }, []);

  /**
   * Reproduces the DISCONNECTED-events branch of `moveUs` (main.coffee:633-637):
   * when `@events` is not connected the server broadcast never arrives, so the
   * controller manually reloaded sprints + closed sprints + project stats. In the
   * connected case (the normal docker topology) the WebSocket subscriptions (see
   * below) drive the reconcile instead. Because the dnd handler
   * (`../../shared/dnd/sortable`) exposes no success callback, `../BacklogApp.tsx`
   * may compose the drag completion to call `reconcileAfterMove()` when events are
   * disabled; when events are enabled the subscription handles it. The three
   * reloads match the source exactly.
   */
  const reconcileAfterMove = useCallback(async (): Promise<void> => {
    await Promise.all([loadSprints(), loadClosedSprints(), loadProjectStats()]);
  }, [loadSprints, loadClosedSprints, loadProjectStats]);

  /* --------------------------- toolbar move to sprint --------------------------- */

  /**
   * Shared implementation of the toolbar "move selected user stories to a sprint"
   * actions (reproduces `moveUssToSprint`, main.coffee:782-803). Unlike the drag
   * path, the hook OWNS the API call here.
   *
   * The API payload is obtained by running the PURE reducer producer directly on
   * the (possibly selection-overridden) state, because the reducer's dispatch
   * path DROPS the producer payload. The SAME producer is then dispatched to
   * update the store optimistically (deterministic double-compute).
   *
   * CRITICAL SOURCE QUIRK (main.coffee:799): the persisted `milestone_id` is
   * ALWAYS `sprints[0].id`, even for "move to current sprint" (whose optimistic
   * target may be `currentSprint`). `payload.milestoneId` already encodes this
   * (set by the reducer producer) - it must NOT be re-derived here.
   */
  const moveSelectedToSprint = useCallback(
    async (
      usIds: number[] | undefined,
      produceMove: typeof produceMoveToCurrentSprint,
      actionType: 'MOVE_TO_CURRENT_SPRINT' | 'MOVE_TO_LATEST_SPRINT',
    ): Promise<void> => {
      const current = stateRef.current;
      if (current.sprints.length === 0) {
        return; // move control is hidden when there are no sprints (main.coffee:828)
      }
      // Compute the payload from the intended selection (explicit `usIds` win
      // over the current multi-select) via the pure producer.
      const sourceState = usIds ? { ...current, selectedIds: usIds } : current;
      const { payload } = produceMove(sourceState);
      if (payload == null) {
        return; // no resolvable selection -> no-op
      }
      // Update the store: seed the selection first (so the reducer's move action,
      // which reads `selectedIds`, sees the right set), then apply the move.
      if (usIds) {
        dispatch({ type: 'SET_SELECTED_IDS', ids: usIds });
      }
      dispatch({ type: actionType });

      // API call (frozen contract): POST userstories/bulk_update_milestone with
      // `bulk_stories = [{ us_id, order }]` (reproduces main.coffee:794-799).
      await userstories.bulkUpdateMilestone(payload.projectId, payload.milestoneId, payload.bulkStories);

      // On-success reload (main.coffee:800-801). The source additionally calls
      // toggleVelocityForecasting()/calculateForecasting() (l.802-803); those only
      // affect the velocity-forecast view and have no dispatchable reducer action,
      // so they are omitted - the persisted move's parity is fully covered by
      // reloading sprints + project stats.
      await Promise.all([loadSprints(), loadProjectStats()]);
    },
    [loadSprints, loadProjectStats],
  );

  /**
   * Toolbar "move selected stories to the CURRENT sprint" (main.coffee:807-810).
   * Optimistically targets `currentSprint || sprints[0]` but persists to
   * `sprints[0].id` (the documented quirk).
   */
  const moveToCurrentSprint = useCallback(
    (usIds?: number[]): Promise<void> =>
      moveSelectedToSprint(usIds, produceMoveToCurrentSprint, 'MOVE_TO_CURRENT_SPRINT'),
    [moveSelectedToSprint],
  );

  /**
   * Toolbar "move selected stories to the LATEST sprint" (main.coffee:812-813).
   * Targets and persists to `sprints[0]`.
   */
  const moveToLatestSprint = useCallback(
    (usIds?: number[]): Promise<void> =>
      moveSelectedToSprint(usIds, produceMoveToLatestSprint, 'MOVE_TO_LATEST_SPRINT'),
    [moveSelectedToSprint],
  );

  /* ------------------------------- sprint form ------------------------------- */

  /**
   * Opens the sprint add/edit form (reproduces `lightboxes.coffee:120-221`).
   * Dispatch-only: for CREATE the reducer's `buildCreateSprintDefaults(sprints,
   * nowYmd)` derives the default dates (`estimated_start = lastSprint
   * .estimated_finish` else today; `estimated_finish = start + 2 weeks`,
   * reproducing lightboxes.coffee:152-170). `nowYmd` is INJECTED (the reducer is
   * pure). For EDIT, `canDelete` is `true` (the `.delete-sprint` action shows in
   * edit mode, lightboxes.coffee:205; a finer project-permission signal is not
   * available at the hook boundary).
   */
  const openSprintForm = useCallback((mode: 'create' | 'edit', sprint?: Sprint): void => {
    if (mode === 'create') {
      const pid = projectIdRef.current;
      if (pid == null) {
        return;
      }
      dispatch({ type: 'OPEN_SPRINT_FORM_CREATE', projectId: pid, nowYmd: moment().format('YYYY-MM-DD') });
    } else if (sprint) {
      dispatch({ type: 'OPEN_SPRINT_FORM_EDIT', sprint, canDelete: true });
    }
  }, []);

  /** Closes the sprint form (reproduces the lightbox close). Dispatch-only. */
  const closeSprintForm = useCallback((): void => {
    dispatch({ type: 'CLOSE_SPRINT_FORM' });
  }, []);

  /**
   * Persists the sprint form (reproduces `lightboxes.coffee:57-70`). Validation
   * is NOT done here - the `SprintForm` component runs
   * `../../shared/validation/sprintValidators`, so `values` arrive already valid.
   * The `milestones` adapter serializes the two dates to `YYYY-MM-DD` internally
   * (lightboxes.coffee:59-60). After success the form is closed and sprints +
   * project stats are reloaded (reproduces the `sprintform:*:success` reloads,
   * main.coffee:170-190); a full `loadSprints` keeps each sprint's `user_stories`
   * authoritative rather than depending on a PATCH/POST response shape.
   */
  const submitSprintForm = useCallback(
    async (values: SprintFormValues, mode: 'create' | 'edit', editingId?: number): Promise<void> => {
      const pid = projectIdRef.current;
      if (mode === 'create') {
        if (pid == null) {
          return;
        }
        await milestones.create({
          project: pid,
          name: values.name ?? '',
          estimated_start: values.estimated_start ?? '',
          estimated_finish: values.estimated_finish ?? '',
        });
      } else {
        const id = editingId ?? values.id;
        if (id == null) {
          return;
        }
        await milestones.save(id, {
          name: values.name ?? '',
          estimated_start: values.estimated_start ?? '',
          estimated_finish: values.estimated_finish ?? '',
        });
      }
      closeSprintForm();
      await Promise.all([loadSprints(), loadProjectStats()]);
    },
    [closeSprintForm, loadSprints, loadProjectStats],
  );

  /**
   * Deletes a sprint (reproduces `sprintform:remove:success`, main.coffee:192-208):
   * DELETE the milestone, then reload sprints + project stats + the backlog user
   * stories (a removed sprint returns its stories to the backlog), and reload the
   * closed sprints too when the removed sprint was a CLOSED one. The source's
   * `displayVelocity` `toggleVelocityForecasting()` (l.193-194) only affects the
   * velocity-forecast view and has no dispatchable reducer action, so it is
   * omitted.
   */
  const removeSprint = useCallback(
    async (id: number): Promise<void> => {
      const wasClosed = stateRef.current.closedSprints.some((sprint) => sprint.id === id);
      await milestones.remove(id);
      closeSprintForm();
      const tasks: Array<Promise<void>> = [loadSprints(), loadProjectStats(), loadUserstories(true)];
      if (wasClosed) {
        tasks.push(loadClosedSprints());
      }
      await Promise.all(tasks);
    },
    [closeSprintForm, loadSprints, loadProjectStats, loadUserstories, loadClosedSprints],
  );


  /* --------------------------- inline row controls (finding #12) --------------------------- */

  /**
   * Change a story's status inline. Reproduces the `tgUsStatus` widget's save
   * path (`common/popovers.coffee:59-67`): set `us.status`, `$repo.save(us)`
   * (PATCH `{ status, version }`), then run the `on-update` callback which for
   * the backlog is `updateUserStoryStatus` (`main.coffee:646-651`) — regenerate
   * filters + reload project stats. The server returns the updated story (new
   * version, recomputed fields); we swap it into the list via `UPDATE_US`.
   */
  const changeUsStatus = useCallback(
    async (us: UserStory, statusId: number): Promise<void> => {
      const version = (us as Record<string, unknown>).version;
      const updated = await userstories.save(us.id, { status: statusId, version });
      dispatch({ type: 'UPDATE_US', us: updated as unknown as UserStory });
      // updateUserStoryStatus: refresh the sidebar counts + the project stats.
      await Promise.all([loadProjectStats(), loadFiltersData()]);
    },
    [loadProjectStats, loadFiltersData],
  );

  /**
   * Set a story's per-role points inline. Reproduces the estimation service's
   * point-selection save (`estimation.coffee:198-213` + `154-166`): clone
   * `us.points`, assign `points[roleId] = pointId`, `$repo.save(@us)` (PATCH
   * `{ points, version }`), then reload project stats on success
   * (`main.coffee:1100`). The server recomputes `total_points`; we swap the
   * returned story into the list.
   */
  const changeUsPoints = useCallback(
    async (us: UserStory, roleId: number, pointId: number): Promise<void> => {
      const prior = (us as Record<string, unknown>).points;
      const points: Record<string, number> =
        prior && typeof prior === 'object'
          ? { ...(prior as Record<string, number>) }
          : {};
      points[String(roleId)] = pointId;
      const version = (us as Record<string, unknown>).version;
      const updated = await userstories.save(us.id, { points, version });
      dispatch({ type: 'UPDATE_US', us: updated as unknown as UserStory });
      await loadProjectStats();
    },
    [loadProjectStats],
  );

  /**
   * Delete a story inline (the actual write; the caller owns the confirm dialog).
   * Reproduces `deleteUserStory`'s server call + on-success reloads
   * (`main.coffee:662-676`): optimistically drop the row (`REMOVE_US`, mirroring
   * `@scope.userstories = _.without(...)`), DELETE the story, then reload project
   * stats + sprints + the backlog list (which rebuilds `first_us_in_backlog`,
   * i.e. `resetFirstStoryIndicator`).
   */
  const deleteUserStoryAction = useCallback(
    async (us: UserStory): Promise<void> => {
      dispatch({ type: 'REMOVE_US', usId: us.id });
      await userstories.deleteUserStory(us.id);
      await Promise.all([loadProjectStats(), loadSprints(), loadUserstories(true)]);
    },
    [loadProjectStats, loadSprints, loadUserstories],
  );

  /**
   * Move a story to the TOP of the backlog. Reproduces `moveUsToTopOfBacklog` ->
   * `moveUs("sprint:us:move", [us], 0, null, null, nextUs)` where
   * `nextUs = userstories[0].id` (`main.coffee:511-517`): the frozen
   * `bulk_update_backlog_order` endpoint is called with `before_userstory_id`
   * set to the current first story so the moved story is inserted BEFORE it. The
   * story stays in the backlog (milestone omitted). Re-query the list to pick up
   * the server-assigned `backlog_order`.
   */
  const moveUsToTop = useCallback(
    async (us: UserStory): Promise<void> => {
      const pid = projectIdRef.current;
      const list = stateRef.current.userstories;
      if (pid == null || list.length === 0) {
        return;
      }
      const firstId = list[0].id;
      if (firstId === us.id) {
        return; // already at the top -> no-op (matches "nextUs === self")
      }
      await userstories.bulkUpdateBacklogOrder(pid, null, null, firstId, [us.id]);
      await loadUserstories(true);
    },
    [loadUserstories],
  );

  /* ------------------------------ add user story ------------------------------ */

  /**
   * Resolve the status id assigned to newly-created backlog stories: the
   * project's `default_us_status` (legacy new stories inherit the project
   * default), falling back to the first configured status if the field is unset.
   * Reads `stateRef` so the value is current inside async create actions.
   */
  const resolveDefaultUsStatus = useCallback((): number | null => {
    const project = stateRef.current.project as Record<string, unknown> | null;
    if (project == null) {
      return null;
    }
    const dflt = project['default_us_status'];
    if (typeof dflt === 'number') {
      return dflt;
    }
    const list = project['us_statuses'];
    if (
      Array.isArray(list) &&
      list.length > 0 &&
      typeof (list[0] as Record<string, unknown>).id === 'number'
    ) {
      return (list[0] as Record<string, unknown>).id as number;
    }
    return null;
  }, []);

  const addStoryStandard = useCallback(
    async (subject: string): Promise<void> => {
      const pid = projectIdRef.current;
      const statusId = resolveDefaultUsStatus();
      const trimmed = subject.trim();
      if (pid == null || statusId == null || trimmed.length === 0) {
        return;
      }
      await userstories.createUserStory(pid, statusId, trimmed);
      // On-success reload (legacy `usform:new:success` -> reload backlog + stats):
      // resets pagination so the newly-created story is included in the list.
      await Promise.all([loadUserstories(true), loadProjectStats()]);
    },
    [resolveDefaultUsStatus, loadUserstories, loadProjectStats],
  );

  const addStoryBulk = useCallback(
    async (bulkText: string): Promise<void> => {
      const pid = projectIdRef.current;
      const statusId = resolveDefaultUsStatus();
      const trimmed = bulkText.trim();
      if (pid == null || statusId == null || trimmed.length === 0) {
        return;
      }
      await userstories.bulkCreate(pid, statusId, trimmed, null);
      await Promise.all([loadUserstories(true), loadProjectStats()]);
    },
    [resolveDefaultUsStatus, loadUserstories, loadProjectStats],
  );

  /**
   * Set the "view points per Role" header selection (`null` = All roles / totals;
   * a role id selects that role). Dispatch-only reducer flag consumed by every
   * row's points widget (legacy `uspoints:select` / `uspoints:clear-selection`
   * broadcast, `main.coffee:995-1021`).
   */
  const setPointsViewRole = useCallback((roleId: number | null): void => {
    dispatch({ type: 'SET_POINTS_VIEW_ROLE', roleId });
  }, []);


  /* --------------------------- filters & view toggles --------------------------- */

  /**
   * Updates the filter model then re-queries the user-story list (changing a
   * filter re-queries; reproduces `addFilterBacklog` / `generateFilters` + the
   * reload semantics, main.coffee:705-708). `SET_FILTERS` merges the partial
   * change (including the free-text `query`, mapped to the `q` param by
   * `loadUserstories`).
   *
   * The reducer state update is asynchronous, so `stateRef.current` is patched
   * synchronously here to ensure the immediately-following `loadUserstories(true)`
   * reads the NEW filters (the render-time effect otherwise re-syncs `stateRef`
   * only after the next render). This mirrors the sibling kanban hook's
   * synchronous-ref philosophy; the patch creates a fresh object and never
   * mutates the frozen immer state.
   */
  const setFilter = useCallback(
    (next: Partial<BacklogFilters>): void => {
      dispatch({ type: 'SET_FILTERS', filters: next });
      stateRef.current = {
        ...stateRef.current,
        filters: { ...stateRef.current.filters, ...next },
      };
      void loadUserstories(true);
      // BL-11: refresh the sidebar counts so they track the applied query
      // (generateFilters re-runs after a filter change on the coffee side).
      void loadFiltersData();
    },
    [loadUserstories, loadFiltersData],
  );

  /**
   * Toggles the "show tags" flag (reproduces `toggleShowTags`, main.coffee:236-239).
   *
   * NOTE: the source ALSO persists the flag via `rs.userstories.storeShowTags`,
   * which writes a HASHED per-project `localStorage` key computed by
   * `generateHash` in `app/coffee` (resources/userstories.coffee:169-177) - a
   * FORBIDDEN import. Reproducing the exact hashed key is out of the coexistence
   * boundary, so per-project persistence is intentionally omitted; the visible
   * toggle behavior is fully preserved (AAP 0.7 minimal-change / globals-only
   * boundary).
   */
  const toggleShowTags = useCallback((): void => {
    dispatch({ type: 'TOGGLE_SHOW_TAGS' });
  }, []);

  /**
   * Closed-sprints visualization toggle with on-demand load (sprints.coffee):
   * flips the flag, then loads the closed sprints the FIRST time they become
   * visible (they stay unloaded / empty until requested).
   */
  const toggleClosedSprints = useCallback(async (): Promise<void> => {
    const willBeVisible = !stateRef.current.closedSprintsVisible;
    dispatch({ type: 'TOGGLE_CLOSED_SPRINTS_VISIBLE' });
    if (willBeVisible) {
      // Showing: (re)load the closed sprints from the API. Legacy
      // `loadClosedSprints` (main.coffee:281-296) fires on every "show" click via
      // the `backlog:load-closed-sprints` broadcast (sprints.coffee:145-146), so we
      // reload each time the section becomes visible.
      await loadClosedSprints();
    } else {
      // Hiding: clear the loaded closed sprints. Legacy `unloadClosedSprints`
      // (main.coffee:276-279) sets `closedSprints = []` via the
      // `backlog:unload-closed-sprints` broadcast (sprints.coffee:143-144) so the
      // ng-repeat renders nothing. This is the finding #15 fix — hide must actually
      // hide (previously the flag flipped but the loaded array was never cleared and
      // `SprintList` rendered it unconditionally, so closed sprints stayed visible).
      unloadClosedSprints();
    }
  }, [loadClosedSprints, unloadClosedSprints]);

  /** Sets the multi-select set (reproduces the checkbox selection, main.coffee:822-831). */
  const setSelectedIds = useCallback((ids: number[]): void => {
    dispatch({ type: 'SET_SELECTED_IDS', ids });
  }, []);

  /** Folds / unfolds a sprint (reproduces the sprint fold/unfold, sprints.coffee). */
  const toggleSprintFold = useCallback((sprintId: number): void => {
    dispatch({ type: 'TOGGLE_SPRINT_FOLD', sprintId });
  }, []);

  /** Toggles the active-filters visibility (reproduces main.coffee:241-242). */
  const toggleActiveFilters = useCallback((): void => {
    dispatch({ type: 'TOGGLE_ACTIVE_FILTERS' });
  }, []);

  /**
   * Toggles velocity forecasting (reproduces `toggleVelocityForecasting`,
   * main.coffee:244-254): the reducer flips `displayVelocity` and recomputes
   * `visibleUserStories` from `userstories` (off) or `forecastedStories` (on).
   * On toggle-ON the reducer's `TOGGLE_VELOCITY` handler runs the velocity
   * accumulation math (`calculateForecasting`, main.coffee:444-467) itself, so
   * `forecastedStories` / `forecastNewSprint` are refreshed fresh from current
   * stats/sprints/userstories — dispatching the action is all that is needed.
   */
  const toggleVelocityForecasting = useCallback((): void => {
    dispatch({ type: 'TOGGLE_VELOCITY' });
  }, []);

  /* ---------------------- project resolution & initial load ---------------------- */

  /**
   * Reproduces `loadInitialData` (main.coffee:488-499): resolve the project
   * (preferably from the numeric id passed by the host element; otherwise from
   * the slug via `GET projects/by_slug`), then load the backlog. Keyed ONLY on
   * `projectSlug` / `projectId` so it does not re-run on unrelated renders.
   */
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      let pid: number | null = params.projectId ?? null;
      if (pid != null) {
        // Preferred path: the numeric id is passed directly by the host element.
        // Populate a MINIMAL project record (the id is authoritative) so the
        // reducer's move-to-sprint producer - which reads `project.id`
        // (main.coffee:799 / applyMoveToSprint) - works without a slug round-trip.
        dispatch({ type: 'SET_PROJECT', project: { id: pid } });
      } else if (params.projectSlug) {
        // reproduces rs.projects.getBySlug -> GET projects/by_slug?slug=...
        const project = await httpClient.get<Project | null>('projects/by_slug', {
          slug: params.projectSlug,
        });
        if (cancelled || project == null) {
          return;
        }
        dispatch({ type: 'SET_PROJECT', project });
        pid = project.id;
      }
      if (cancelled) {
        return;
      }
      projectIdRef.current = pid;
      setResolvedProjectId(pid);
      if (pid != null) {
        await loadBacklog();
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.projectSlug, params.projectId]);

  /* ------------------------------ WebSocket events ------------------------------ */

  /**
   * Reproduces `initializeSubscription` (main.coffee:223-234). Keyed on the
   * RESOLVED numeric project id (a `useState` mirror of `projectIdRef`) so the
   * subscription (re)creates once the id is known and tears down on unmount /
   * AngularJS route change (the host element's `disconnectedCallback`).
   */
  useEffect(() => {
    const pid = resolvedProjectId;
    if (pid == null) {
      return undefined;
    }
    if (getEventsUrl() == null) {
      return undefined; // events disabled (config proxy) -> no socket
    }

    const client = createEventsClient();
    client.connect();

    const usKey = routingKeys.userstories(pid);
    const msKey = routingKeys.milestones(pid);

    // routingKey1: changes.project.{pid}.userstories -> reload all loaded
    // userstories + sprints (main.coffee:225-227). NO selfNotification (default).
    client.subscribe(usKey, () => {
      void reloadAllUserstories();
      void loadSprints();
    });

    // routingKey2: changes.project.{pid}.milestones -> reload sprints + closed
    // sprints + project stats (main.coffee:230-233), subscribed WITH
    // { selfNotification: true } (main.coffee:234) so the client delivers events
    // even when THIS client originated the change - a load-bearing parity nuance.
    // The callback arg is the inner `data.data` payload (the client unwraps it)
    // and is not needed for these reloads.
    client.subscribe(
      msKey,
      () => {
        void loadSprints();
        void loadClosedSprints();
        void loadProjectStats();
      },
      { selfNotification: true },
    );

    return () => {
      client.unsubscribe(usKey);
      client.unsubscribe(msKey);
      client.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedProjectId]);

  /* --------------------------------- assembly --------------------------------- */

  const actions = useMemo<BacklogActions>(
    () => ({
      loadBacklog,
      loadProjectStats,
      loadSprints,
      loadClosedSprints,
      unloadClosedSprints,
      loadUserstories,
      loadMoreUserstories,
      applyDrag,
      onDragError,
      clearWriteError,
      reconcileAfterMove,
      moveToCurrentSprint,
      moveToLatestSprint,
      openSprintForm,
      closeSprintForm,
      submitSprintForm,
      removeSprint,
      changeUsStatus,
      changeUsPoints,
      deleteUserStory: deleteUserStoryAction,
      moveUsToTop,
      addStoryStandard,
      addStoryBulk,
      setFilter,
      toggleShowTags,
      toggleClosedSprints,
      setSelectedIds,
      toggleSprintFold,
      toggleActiveFilters,
      toggleVelocityForecasting,
      setPointsViewRole,
    }),
    [
      loadBacklog,
      loadProjectStats,
      loadSprints,
      loadClosedSprints,
      unloadClosedSprints,
      loadUserstories,
      loadMoreUserstories,
      applyDrag,
      onDragError,
      clearWriteError,
      reconcileAfterMove,
      moveToCurrentSprint,
      moveToLatestSprint,
      openSprintForm,
      closeSprintForm,
      submitSprintForm,
      removeSprint,
      changeUsStatus,
      changeUsPoints,
      deleteUserStoryAction,
      moveUsToTop,
      addStoryStandard,
      addStoryBulk,
      setFilter,
      toggleShowTags,
      toggleClosedSprints,
      setSelectedIds,
      toggleSprintFold,
      toggleActiveFilters,
      toggleVelocityForecasting,
      setPointsViewRole,
    ],
  );

  return useMemo<UseBacklogResult>(
    () => ({ state, actions, filtersData, writeError }),
    [state, actions, filtersData, writeError],
  );
}

