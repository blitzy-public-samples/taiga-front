/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useKanbanBoard
 * ==============
 *
 * Headless React hook that replaces the AngularJS `KanbanController` data layer
 * (the CoffeeScript `main.coffee`) as part of the AngularJS 1.5.10 ->
 * React 18 coexistence migration. It owns:
 *
 *   - Data loading: project (by slug), swimlanes, statuses, userstories, and the
 *     archived-status merge  (reproduces loadInitialData -> loadProject ->
 *     loadSwimlanes -> loadKanban/loadUserstories, main.coffee:546-594).
 *   - WebSocket subscriptions: the `$tgEvents` equivalent for the userstories
 *     and projects routing keys (reproduces initializeSubscription,
 *     main.coffee:245-264).
 *   - Action dispatchers: move / add / edit / delete / fold / hide-show that
 *     mutate the immer board state (reproduces moveUs and the
 *     `usform:*`/`kanban:*`/`lightbox:*` event handlers, main.coffee:160-334,
 *     596-632).
 *
 * Design notes (technology-specific changes, per the migration HARD rules):
 *   - The immer board state lives in `../state/kanbanReducer.ts` (which
 *     reproduces the persistent immutable-collection board of the CoffeeScript
 *     `kanban-usertories` service). This hook only ORCHESTRATES those pure
 *     producers - it never re-implements board logic.
 *   - ALL server IO flows through the typed `../../shared/api` adapters or the
 *     generic `../../shared/api/httpClient`; ALL realtime IO flows through
 *     `../../shared/events/eventsClient`. The `/api/v1/` contract, headers, and
 *     WebSocket routing keys are frozen and identical to the AngularJS source.
 *   - Coexistence boundary is globals-only: this file imports ONLY from `react`,
 *     `../state`, and `../../shared/**`. It pulls in no legacy CoffeeScript or
 *     compiled-bundle modules and references no legacy DnD / persistent-
 *     collection / DOM-manipulation libraries; all interop is via `window`
 *     globals and the frozen REST + WebSocket endpoints.
 *   - This is a HEADLESS hook: it returns state + functions only. No JSX, no
 *     markup, no styles. All rendering lives in `../KanbanApp.tsx` and
 *     `../components/*`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// State producers + types (sibling folder, first-order dependency). These are
// the immer replacement for the AngularJS `KanbanUserstoriesService`. Import
// names reconciled against the real `../state/kanbanReducer.ts` exports:
//   - `toggleFold` there toggles a USER-STORY's fold flag (foldStatusChanged),
//     matching the coffee `toggleFold(id)` -> service.toggleFold(id). We alias
//     it `foldStatus` locally to keep call sites descriptive.
//   - `hideStatus`/`showStatus` are the real producer names (aliased with a
//     `Producer` suffix to disambiguate from this hook's `hideStatus`/
//     `showStatus` dispatchers).
import {
  initialKanbanState,
  reset,
  init,
  set,
  add,
  remove,
  replaceModel,
  refreshRawOrder,
  refresh,
  toggleFold as foldStatus,
  hideStatus as hideStatusProducer,
  showStatus as showStatusProducer,
  move,
  getUsModel,
  type KanbanState,
  type UserStory,
  type User,
  type Swimlane,
  type Project,
} from '../state/kanbanReducer';

// Shared adapters (globals-only interop layer over the frozen /api/v1/ + WS).
import httpClient from '../../shared/api/httpClient';
import type { HttpError } from '../../shared/api/httpClient';
import userstories from '../../shared/api/userstories';
import { createEventsClient, routingKeys } from '../../shared/events/eventsClient';
// `config` and most of `session` are read indirectly by httpClient/eventsClient
// (Bearer token, X-Session-Id, Accept-Language, API/events URLs). The one direct
// use is `redirectToLogin`, invoked from the load-error handler to reproduce the
// legacy `$tgHttp` 401 -> /login navigation.
import { redirectToLogin } from '../../shared/session';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/**
 * Minimal structural type for a user-story status. `../state` does not export a
 * status type, so we define the fields the board consumes (AAP Phase 3). Kept
 * structural + open (`[k]: unknown`) so it tolerates the full status payload.
 */
export interface UsStatus {
  id: number;
  name: string;
  order: number;
  color?: string;
  wip_limit?: number | null;
  is_archived?: boolean;
  [key: string]: unknown;
}

/** A project member, as embedded in the project detail payload. */
interface ProjectMember {
  id: number;
  [key: string]: unknown;
}

/**
 * The subset of the project-detail payload this hook reads. Extends the opaque
 * `Project` (`{ id; [k]: unknown }`) with the typed fields we consume; every
 * added field is assignable to the base index signature (`unknown`).
 */
interface ProjectDetail extends Project {
  is_kanban_activated?: boolean;
  members?: ProjectMember[];
  us_statuses?: UsStatus[];
  points?: Array<{ id: number; order: number; [k: string]: unknown }>;
  roles?: unknown[];
  name?: string;
}

/** Inner payload of a `changes.project.{id}.userstories` WS event. */
interface UserstoriesEventPayload {
  pk: number | number[];
}

/** Inner payload of a `changes.project.{id}.projects` WS event. */
interface ProjectsEventPayload {
  matches?: string;
}

// ---------------------------------------------------------------------------
// Module-level constants + pure helpers (no React, no globals)
// ---------------------------------------------------------------------------

/**
 * EXACT 3-string membership set that gates the projects-subscription refresh
 * (main.coffee:255). Reproduced byte-for-byte - membership test only, order is
 * irrelevant. Typed `readonly string[]` so `.includes(someString)` type-checks.
 */
const PROJECT_EVENT_MATCHES: readonly string[] = [
  'projects.swimlane',
  'projects.swimlaneuserstorystatus',
  'projects.userstorystatus',
];

/** Cancelable function produced by `createTrailingDebounce`. */
interface Cancelable {
  cancel(): void;
}

/**
 * Hand-rolled TRAILING debounce, reproducing `taiga.debounceLeading(wait, fn)`
 * which is literally `_.debounce(fn, wait, { leading: false, trailing: true })`
 * (verified in the coffee helper). Despite the "leading" name it fires ONCE on
 * the trailing edge, `wait` ms after the last call in a burst.
 *
 * Implemented with `setTimeout` (NOT lodash) so it is (a) dependency-free -
 * `@types/lodash` is intentionally absent and `package.json` is a shared,
 * uneditable manifest - and (b) driveable by Jest fake timers. `.cancel()`
 * clears any pending trailing call, used by the subscription cleanup to avoid
 * leaks across AngularJS route changes.
 */
function createTrailingDebounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): ((...args: A) => void) & Cancelable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;

  const debounced = (...args: A): void => {
    lastArgs = args;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      const callArgs = lastArgs as A;
      lastArgs = undefined;
      fn(...callArgs);
    }, wait);
  };

  (debounced as ((...args: A) => void) & Cancelable).cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    lastArgs = undefined;
  };

  return debounced as ((...args: A) => void) & Cancelable;
}

/**
 * Stable numeric sort by a derived key (undefined keys sorted last). Reproduces
 * `_.sortBy(coll, key)` for the `order`/`kanban_order` sorts, without lodash.
 */
function sortByNumericKey<T>(list: T[], keyFn: (item: T) => number | undefined): T[] {
  return [...list].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (ka === kb) {
      return 0;
    }
    if (ka === undefined) {
      return 1;
    }
    if (kb === undefined) {
      return -1;
    }
    return ka - kb;
  });
}

/** Array difference `a \ b`, reproducing `_.difference(a, b)` without lodash. */
function difference<T>(a: T[], b: T[]): T[] {
  return a.filter((x) => !b.includes(x));
}

/**
 * Reproduce `taiga.groupBy(coll, pred)`: build a SINGLE object keyed by the
 * predicate (LAST wins), NOT array buckets. Used for `usersById`.
 */
function groupById<T extends { id: number }>(coll: T[]): Record<number, T> {
  const result: Record<number, T> = {};
  for (const item of coll) {
    result[item.id] = item;
  }
  return result;
}

/**
 * Read the persisted folded-swimlane modes for a project from localStorage
 * (reproduces `rs.kanban.getSwimlanesModes(projectId)`, main.coffee:584). This
 * is a UI preference, so touching localStorage directly is allowed. The exact
 * key does not affect parity; a stable per-project key is used. Defaults to
 * `{}` when absent or unparseable.
 */
function readSwimlanesModes(projectId: number): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(`kanban.swimlanes.modes.${projectId}`);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persist the folded-swimlane modes for a project to localStorage (reproduces
 * `rs.kanban.storeSwimlanesModes(projectId, modes)`, main.coffee:329). Failures
 * (private mode, quota) are swallowed - persistence is best-effort.
 */
function storeSwimlanesModes(projectId: number, modes: Record<string, boolean>): void {
  try {
    localStorage.setItem(`kanban.swimlanes.modes.${projectId}`, JSON.stringify(modes));
  } catch {
    /* ignore storage errors */
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inputs. `../KanbanApp.tsx` calls
 * `useKanbanBoard({ projectSlug, zoomLevel, filtersQuery })`. The two `on*`
 * callbacks are OPTIONAL injection points so KanbanApp (which owns the
 * FiltersMixin and multi-selection) can react to a move without this headless
 * hook reaching into filter/selection internals.
 */
export interface UseKanbanBoardParams {
  /** Project slug from the preserved route `/project/:pslug/kanban`. */
  projectSlug: string;
  /** Zoom level 0..3; KanbanApp owns the ZoomControl + `kanban_zoom` storage. */
  zoomLevel: number;
  /**
   * Sidebar filters already `_.pick`ed to the valid query params by KanbanApp,
   * with the search text merged in (carries `q`). Merged into the userstories
   * query (main.coffee:423-436).
   */
  filtersQuery: Record<string, unknown>;
  /**
   * Called after a successful move so KanbanApp can regenerate filters
   * (reproduces the `generateFilters()`/`filtersReloadContent()` tail of
   * moveUs, main.coffee:627-632). Optional - the hook stays decoupled from
   * filter internals.
   */
  onFiltersChanged?: () => void;
  /**
   * Called at the start of a move to clear multi-selection (reproduces
   * `cleanSelectedUss`). Selection lives in KanbanApp; optional here.
   */
  onCleanSelection?: () => void;
}

/**
 * Return shape. Every field below is destructured by `../KanbanApp.tsx`, so the
 * contract must stay stable. `permissionError` is an additive optional field
 * surfacing the `is_kanban_activated` gate without crashing.
 */
export interface UseKanbanBoardResult {
  // --- board state (KanbanState + its projections) ---
  state: KanbanState;
  usByStatus: KanbanState['usByStatus'];
  usMap: KanbanState['usMap'];
  usByStatusSwimlanes: KanbanState['usByStatusSwimlanes'];
  swimlanesList: KanbanState['swimlanesList'];
  statuses: UsStatus[];
  project: Project | null;
  projectId: number | null;
  usersById: Record<number, User>;
  foldedSwimlane: Record<string, boolean>;
  // --- flags ---
  isFirstLoad: boolean;
  loading: boolean;
  isLightboxOpened: boolean;
  notFoundUserstories?: boolean;
  permissionError?: boolean;
  /** A failed INITIAL board load (F-READ-1); `null` when the load succeeded. */
  loadError?: Error | null;
  /** A failed optimistic move write, after rollback (F-WRITE-2); `null` when clear. */
  writeError?: Error | null;
  // --- dispatchers ---
  moveUs: (
    usList: Array<{ id: number }> | null,
    newStatusId: number,
    newSwimlaneId: number,
    index: number,
    previousCard: number | null,
    nextCard: number | null,
  ) => Promise<void>;
  moveUsToTop: (uss: UserStory | UserStory[]) => Promise<void>;
  addUs: (created: UserStory | UserStory[], position?: 'top' | 'bottom') => void;
  addUsBulk: (
    statusId: number,
    bulkStories: string,
    swimlaneId?: number | null,
    position?: 'top' | 'bottom',
  ) => Promise<void>;
  editUs: (us: UserStory) => void;
  deleteUs: (us: UserStory) => void;
  toggleFold: (statusId: number) => void;
  toggleSwimlane: (swimlaneId: number) => void;
  hideStatus: (statusId: number) => void;
  showStatus: (statusId: number) => Promise<void>;
  reload: () => Promise<void>;
  setLightboxOpen: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useKanbanBoard(params: UseKanbanBoardParams): UseKanbanBoardResult {
  // --- Board state ---------------------------------------------------------
  // The AngularJS `KanbanUserstoriesService` was a MUTABLE singleton that event
  // handlers and `moveUs` read synchronously. In React, async callbacks (WS
  // handlers, debounced reloads, post-`await` logic) capture state by closure
  // and would read STALE values. We reproduce the mutable-read behavior with a
  // `stateRef` kept in lockstep with `state`, and funnel EVERY board update
  // through `applyState`, which updates the ref synchronously (so successive
  // within-tick dispatches and post-await reads always see the latest board).
  const [state, setState] = useState<KanbanState>(initialKanbanState);
  const stateRef = useRef<KanbanState>(initialKanbanState);

  /**
   * The single board-state mutator. Computes the next state from the LATEST
   * board (stateRef.current, not the closed-over `state`), syncs the ref
   * synchronously, then schedules the render. This is the React-idiomatic
   * replacement for the AngularJS mutable service singleton.
   */
  const applyState = useCallback((updater: (prev: KanbanState) => KanbanState): KanbanState => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  // --- Non-board UI / coordination state -----------------------------------
  const [loading, setLoading] = useState<boolean>(false);
  const [isFirstLoad, setIsFirstLoad] = useState<boolean>(true); // ctor default true (main.coffee:76-103)
  const [isLightboxOpened, setIsLightboxOpened] = useState<boolean>(false);
  const [notFoundUserstories, setNotFoundUserstories] = useState<boolean>(false);
  const [permissionError, setPermissionError] = useState<boolean>(false);
  // Error surfaces (parity with legacy `$tgHttp` error handling):
  //  - `loadError` (F-READ-1): a failed INITIAL board load. Surfacing it lets the
  //    consumer render an error state instead of a silently-broken board, and it
  //    ensures the load promise no longer rejects uncaught.
  //  - `writeError` (F-WRITE-2): a failed optimistic move write, after the board
  //    has been rolled back to the pre-move state.
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [writeError, setWriteError] = useState<Error | null>(null);
  const [foldedSwimlane, setFoldedSwimlane] = useState<Record<string, boolean>>({});
  const [projectId, setProjectId] = useState<number | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [statuses, setStatuses] = useState<UsStatus[]>([]); // sorted usStatusList
  const [usersById, setUsersById] = useState<Record<number, User>>({});

  // --- Coordination refs (read synchronously inside async callbacks) -------
  const projectRef = useRef<ProjectDetail | null>(null);
  const projectIdRef = useRef<number | null>(null);
  const usersByIdRef = useRef<Record<number, User>>({});
  // `isLightboxOpened` mirror for the projects-subscription deferral gate
  // (main.coffee:230-237); set eagerly in `setLightboxOpen`.
  const isLightboxOpenedRef = useRef<boolean>(false);
  const isRefreshNeededRef = useRef<boolean>(false);
  // Stale-search guard for `loadUserstories` (main.coffee:487-488).
  const lastSearchRef = useRef<string | undefined>(undefined);

  // Prop mirrors so the stable (ref-reading) callbacks below always observe the
  // latest props without being re-created on every prop change. Assigned during
  // render, which runs synchronously before effects/callbacks fire.
  const zoomLevelRef = useRef<number>(params.zoomLevel);
  const filtersQueryRef = useRef<Record<string, unknown>>(params.filtersQuery);
  const projectSlugRef = useRef<string>(params.projectSlug);
  const callbacksRef = useRef<{ onFiltersChanged?: () => void; onCleanSelection?: () => void }>({
    onFiltersChanged: params.onFiltersChanged,
    onCleanSelection: params.onCleanSelection,
  });
  zoomLevelRef.current = params.zoomLevel;
  filtersQueryRef.current = params.filtersQuery;
  projectSlugRef.current = params.projectSlug;
  callbacksRef.current = {
    onFiltersChanged: params.onFiltersChanged,
    onCleanSelection: params.onCleanSelection,
  };

  // --- Query building ------------------------------------------------------

  /**
   * Reproduce `loadUserstoriesParams` (main.coffee:423-436) EXACTLY:
   *   base `{ status__is_archived: false }`
   *   + when zoomLevel >= 2: `include_attachments: 1, include_tasks: 1`
   *     (NOTE the deliberate off-by-one vs the reload trigger in the zoom
   *      effect, which fires at `> 2` - both are reproduced verbatim)
   *   + merge the caller's already-picked `filtersQuery` (carries `q`).
   */
  const loadUserstoriesParams = useCallback((): Record<string, unknown> => {
    const p: Record<string, unknown> = { status__is_archived: false };
    if (zoomLevelRef.current >= 2) {
      p.include_attachments = 1;
      p.include_tasks = 1;
    }
    Object.assign(p, filtersQueryRef.current);
    return p;
  }, []);

  /**
   * `listAll(projectId, params)` - reproduces
   * `rs.userstories.listAll` = `queryMany("userstories", { project, ... },
   * { 'x-disable-pagination': '1' })` (resources/userstories.coffee). The
   * pagination-disable header is a per-call header option; the client owns all
   * other headers (Bearer, X-Session-Id, Accept-Language) and query
   * serialization - we NEVER hand-build a URL.
   */
  const listAll = useCallback(
    async (pid: number, queryParams: Record<string, unknown>): Promise<UserStory[]> => {
      const result = await httpClient.get<UserStory[]>(
        'userstories',
        { project: pid, ...queryParams },
        { headers: { 'x-disable-pagination': '1' } },
      );
      // Robustness (F-READ-2): `httpClient` returns `null` for a 204 / empty
      // body (transformResponseBody). The declared return type is
      // `Promise<UserStory[]>` and every caller relies on it (`.concat`,
      // `.length`, `sortBy`), so coalesce a null/undefined body to `[]` here —
      // at the single source — instead of forcing each caller to null-check.
      return result ?? [];
    },
    [],
  );

  /**
   * `loadSwimlanes` (main.coffee:552-562). Reproduces
   * `rs.swimlanes.list` = `queryMany("swimlanes", { project })`. The reducer's
   * `init`/`refreshSwimlanes` derive `swimlanesList`/`usByStatusSwimlanes` from
   * the swimlanes + project statuses, so we simply return the fetched list.
   */
  const loadSwimlanes = useCallback(async (): Promise<Swimlane[]> => {
    const pid = projectIdRef.current;
    if (pid == null) {
      return [];
    }
    const result = await httpClient.get<Swimlane[]>('swimlanes', { project: pid });
    // Robustness (F-READ-2): coalesce a 204 / null body to `[]` so the declared
    // `Promise<Swimlane[]>` contract holds and the reducer's swimlane
    // derivations never receive `null`.
    return result ?? [];
  }, []);

  /**
   * FETCH-only helper reproducing `loadUserStoriesForStatus` (main.coffee:
   * 511-535): the archived stories for a single status, with the status-filter
   * guard and the merged params. Used by (a) `loadUserstories` for the open
   * archived statuses and (b) the `showStatus` dispatcher.
   *
   * Parity note: on the guard early-return we return `[]` (NOT `undefined`).
   * The coffee returns `undefined`, which its caller `concat`s - a latent bug
   * that would inject an `undefined` story. Returning `[]` preserves the
   * observable board content (no stories for a filtered-out status) without the
   * crash.
   */
  const loadUserStoriesForStatus = useCallback(
    async (statusId: number): Promise<UserStory[]> => {
      const pid = projectIdRef.current;
      if (pid == null) {
        return [];
      }
      const fq = filtersQueryRef.current;
      // Guard (main.coffee:514-518): skip when a status filter excludes this id.
      const filteredStatus = fq.status;
      if (filteredStatus != null) {
        const allowed = String(filteredStatus)
          .split(',')
          .map((it) => parseInt(it, 10));
        if (allowed.indexOf(statusId) === -1) {
          return [];
        }
      }
      const p: Record<string, unknown> = {
        status: statusId,
        include_attachments: true,
        include_tasks: true,
      };
      const searchQ = fq.q;
      if (searchQ) {
        p.q = searchQ; // reproduce: if @.filterQ then params.q
      }
      const merged = { ...p, ...fq }; // reproduce _.merge(params, location.search())
      return listAll(pid, merged);
    },
    [listAll],
  );


  // --- Core load path ------------------------------------------------------

  /**
   * `loadUserstories` (main.coffee:464-509). Fetches the board's userstories +
   * swimlanes + open-archived statuses in parallel, applies the stale-search
   * abort, computes the empty-results flag, and rebuilds the board through the
   * `reset -> init -> set` producer chain.
   */
  const loadUserstories = useCallback(async (): Promise<UserStory[] | undefined> => {
    const pid = projectIdRef.current;
    if (pid == null) {
      return undefined;
    }
    const queryParams = loadUserstoriesParams();
    // Stale-search abort (main.coffee:487-488): capture the search this request
    // was issued for; if a newer request supersedes it, drop these results.
    const thisSearch = queryParams.q as string | undefined;
    lastSearchRef.current = thisSearch;

    const current = stateRef.current;
    // Open archived statuses = archived minus explicitly hidden (main.coffee:477-478).
    const openArchived = difference(current.archivedStatus, current.statusHide);

    const [mainStories, swimlanes, ...archivedResults] = await Promise.all([
      listAll(pid, queryParams),
      loadSwimlanes(),
      ...openArchived.map((id) => loadUserStoriesForStatus(id)),
    ]);

    if (lastSearchRef.current !== thisSearch) {
      return undefined; // a newer search started; drop stale results.
    }

    let allStories = mainStories;
    for (const archived of archivedResults) {
      allStories = allStories.concat(archived);
    }

    // Empty-results flag (main.coffee:500-501); "has filters" derived from
    // `filtersQuery` since there is no `location.search()` in React.
    const hasSearch = typeof thisSearch === 'string' && thisSearch.length > 0;
    const hasFilters = Object.keys(filtersQueryRef.current).length > 0;
    setNotFoundUserstories(allStories.length === 0 && (hasSearch || hasFilters));

    const proj = projectRef.current;
    const users = usersByIdRef.current;
    // renderUserStories (main.coffee:399-421): sortBy 'kanban_order' then
    // initUsByStatusList + set. The AngularJS batched render (batchSize 100,
    // batchTimings [200,100,50]) is a rendering-performance optimization only;
    // it is intentionally SIMPLIFIED to a single `set` here (React batches its
    // own DOM updates). This does NOT change the final board content.
    const sorted = sortByNumericKey(allStories, (it) => it.kanban_order);
    // Apply order: reset(false,false,false) preserves swimlanesList /
    // archivedStatus / statusHide; init sets project/swimlanes/usersById; set
    // rebuilds the projections (main.coffee:503-508).
    applyState((prev) => {
      let s = reset(prev, false, false, false);
      s = init(s, proj, swimlanes, users);
      s = set(s, sorted);
      return s;
    });

    return allStories;
  }, [loadUserstoriesParams, listAll, loadSwimlanes, loadUserStoriesForStatus, applyState]);

  /**
   * `loadProject` (main.coffee:564-580). AngularJS read the already-loaded
   * `projectService.project`; in React we FETCH it by slug via the generic
   * client (there is no `projects` adapter):
   *   `rs.projects.getBySlug` = `queryOne("projects", "by_slug?slug=" + slug)`.
   * The client builds the query string from the params object - we never
   * hand-build it. Sets project/projectId/usersById on BOTH the refs
   * (synchronously, so the immediately-following `loadUserstories` sees them)
   * AND state (for rendering).
   */
  const loadProject = useCallback(async (): Promise<ProjectDetail | null> => {
    const slug = projectSlugRef.current;
    const proj = await httpClient.get<ProjectDetail>('projects/by_slug', { slug });

    // Permission gate (main.coffee:566-569): the coffee calls
    // `errorHandlingService.permissionDenied()`; we surface an error flag
    // instead of crashing so the consumer can render an access-denied state.
    if (!proj.is_kanban_activated) {
      setPermissionError(true);
    } else {
      setPermissionError(false);
    }

    const users = groupById<User>((proj.members as User[]) ?? []); // fillUsersAndRoles (controllerMixins:22-34)
    // Sync refs synchronously (source-of-truth for async reads this tick)...
    projectRef.current = proj;
    projectIdRef.current = proj.id;
    usersByIdRef.current = users;
    // ...then schedule state for rendering.
    setProject(proj);
    setProjectId(proj.id);
    setUsersById(users);
    setStatuses(sortByNumericKey((proj.us_statuses as UsStatus[]) ?? [], (st) => st.order)); // usStatusList

    return proj;
  }, []);

  /**
   * `loadInitialData` (main.coffee:582-594) -> `loadKanban` (546-550). Loads the
   * project, reads the folded-swimlane preference, then loads the board. The WS
   * subscription is set up by the Phase-6 effect (keyed on projectId), NOT here,
   * so this data-load path can be safely re-run (e.g. by
   * `refreshAfterSwimlanesOrUserstoryStatusesHaveChanged`) without duplicating
   * the subscription.
   *
   * `loadKanban` is `q.all([refreshTagsColors(), loadUserstories()])`. Tag
   * colors are a presentational concern owned by KanbanApp/Board (they colorize
   * tag chips); the essential board data is `loadUserstories()`, so tag-color
   * fetching is intentionally left to the consumer and omitted here.
   */
  /**
   * Centralized handler for a failed board LOAD (F-READ-1).
   *
   * Legacy parity: the AngularJS `$tgHttp` response interceptor surfaces load
   * failures and, on a `401`, redirects to the login route
   * (`app/coffee/app.coffee:1025`). Reproducing that here (a) surfaces the error
   * via `loadError` so the consumer renders an error state instead of a
   * silently-broken board, and (b) navigates to `/login` on a `401`.
   *
   * It deliberately does NOT re-throw: the load is kicked off fire-and-forget
   * (`void loadInitialData()` / `void loadUserstories()` in the init effect), so
   * swallowing the error HERE — after surfacing it — is precisely what prevents
   * the uncaught promise rejection the QA flagged. It also handles the
   * fail-closed empty-config throw (a non-HTTP `Error` with no `status`), which
   * rides the same path: the error is surfaced without a spurious redirect.
   */
  const handleLoadError = useCallback((err: unknown): void => {
    const error = err instanceof Error ? err : new Error(String(err));
    setLoadError(error);
    if ((error as HttpError).status === 401) {
      redirectToLogin();
    }
  }, []);

  const loadInitialData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null); // clear any prior error on a fresh (re)load attempt.
    try {
      const proj = await loadProject();
      if (proj == null) {
        return;
      }
      // foldedSwimlane from localStorage (main.coffee:584).
      setFoldedSwimlane(readSwimlanesModes(proj.id));
      await loadUserstories();
      setIsFirstLoad(false); // firstLoad().then(() => isFirstLoad = false) (main.coffee:112-125)
    } catch (err) {
      // F-READ-1: a failed initial load (401/500 read, or the fail-closed
      // empty-config throw) must not escape as an uncaught rejection. Surface an
      // error state and, on 401, redirect to login — matching legacy behavior.
      handleLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [loadProject, loadUserstories, handleLoadError]);

  /** Public reload = re-run `loadUserstories` (used by KanbanApp after filter changes). */
  const reload = useCallback(async (): Promise<void> => {
    await loadUserstories();
  }, [loadUserstories]);

  /**
   * `refreshAfterSwimlanesOrUserstoryStatusesHaveChanged` (main.coffee:239-243):
   * `projectService.fetchProject().then(loadInitialData)`. In React we re-fetch
   * the project by slug and re-run the board init WITHOUT tearing down the live
   * WebSocket subscription: subscription lifecycle is owned by the Phase-6
   * effect (keyed on projectId), and re-fetching the same slug yields the same
   * projectId, so the effect does not re-run.
   */
  const refreshAfterSwimlanesOrUserstoryStatusesHaveChanged = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      await loadInitialData();
    } finally {
      setLoading(false);
    }
  }, [loadInitialData]);

  /**
   * `eventsLoadUserstories` (main.coffee:438-462). Triggered (debounced) by the
   * userstories WS subscription. Re-fetches the board's userstories and merges:
   * modified stories already on the board are replaced; brand-new stories are
   * added. All state reads use `stateRef.current` (the mutable-service
   * replacement), and `modifiedUs` is computed from the raw at EVENT time while
   * `newUss` is computed from the raw at RESOLVE time - matching the coffee.
   */
  const eventsLoadUserstories = useCallback(
    async (data: unknown): Promise<void> => {
      const pid = projectIdRef.current;
      if (pid == null) {
        return;
      }
      const payload = data as UserstoriesEventPayload;
      const eventUserstories = Array.isArray(payload.pk) ? payload.pk : [payload.pk];

      // ids already on the board (raw captured BEFORE the fetch).
      const rawBefore = stateRef.current.userstoriesRaw;
      const modifiedUs = eventUserstories.filter((id) => rawBefore.some((r) => r.id === id));

      const fetched = await listAll(pid, loadUserstoriesParams());

      // ids NOT yet on the board (raw re-read AFTER the fetch).
      const rawAfter = stateRef.current.userstoriesRaw;
      const newUss = fetched.filter((us) => !rawAfter.some((r) => r.id === us.id));

      applyState((prev) => {
        let s = prev;
        for (const us of fetched) {
          if (modifiedUs.includes(us.id)) {
            s = replaceModel(s, us);
            s = refreshRawOrder(s);
          }
        }
        if (newUss.length) {
          s = add(s, newUss);
        }
        s = refresh(s, false);
        return s;
      });
    },
    [listAll, loadUserstoriesParams, applyState],
  );


  // --- Action dispatchers --------------------------------------------------

  /**
   * `moveUs` (main.coffee:596-632). THE authoritative state+API function for a
   * move. Resolves the moved raw models, maps the unclassified swimlane
   * (`-1 -> null`) for the API, applies the `move` producer, reads the payload
   * it returns, and fires EXACTLY ONE `bulk_update_kanban_order` request.
   *
   * SINGLE-CALL INVARIANT (coordination): the DnD layer
   * `../../shared/dnd/sortable.ts` also has an `onMove` + API path. KanbanApp
   * MUST wire the drag `onMove` to this `moveUs` and ensure the DnD handler does
   * NOT also perform the network call (inject a pass-through api, or bypass its
   * own api call) so a single drop yields a single request. This hook owns that
   * one network call.
   */
  const moveUs = useCallback(
    async (
      usList: Array<{ id: number }> | null,
      newStatusId: number,
      newSwimlaneId: number,
      index: number,
      previousCard: number | null,
      nextCard: number | null,
    ): Promise<void> => {
      const pid = projectIdRef.current;
      if (pid == null) {
        return;
      }
      // cleanSelectedUss equivalent - multi-selection lives in KanbanApp.
      callbacksRef.current.onCleanSelection?.();

      const current = stateRef.current;
      // Resolve raw models; skip any id not on the board (defensive vs the
      // coffee, which assumes all are found).
      const models = (usList ?? [])
        .map((u) => getUsModel(current, u.id))
        .filter((m): m is UserStory => m !== undefined);
      const ids = models.map((m) => m.id); // moved ids (number[])

      // apiSwimlane: the unclassified swimlane (-1) maps to null on the wire
      // (main.coffee:604-607).
      const apiNewSwimlaneId = newSwimlaneId === -1 ? null : newSwimlaneId;

      // Apply the move producer and READ ITS PAYLOAD (the API args).
      const { state: next, payload } = move(
        current,
        ids,
        newStatusId,
        apiNewSwimlaneId,
        index,
        previousCard,
        nextCard,
      );
      // Optimistic update FIRST (matching the AngularJS `$scope.$apply` ordering:
      // state then request). Clear any stale write error on a fresh move.
      setWriteError(null);
      applyState(() => next);

      // Fire the frozen endpoint via the typed adapter. `bulk_userstories` is a
      // `number[]` at runtime (the move payload) AND the adapter now types its
      // last param `number[]` — matching the frozen contract
      // (kanban/main.coffee:610 `usList.map((it) => it.id)`). So
      // `payload.bulkUserstories` is passed straight through with NO cast.
      //
      // F-WRITE-2: the write is wrapped so a failed request (4xx/5xx/offline)
      // (a) never escapes as an uncaught promise rejection, and (b) ROLLS BACK
      // the optimistic update to the exact pre-move snapshot (`current`) so the
      // board reconverges with the server (which — the request having failed —
      // never mutated). This reproduces legacy parity where a rejected reorder
      // does not leave the card falsely shown in its new column. Exactly ONE
      // write is attempted (no retry), preserving the single-call invariant.
      try {
        await userstories.bulkUpdateKanbanOrder(
          pid,
          newStatusId,
          apiNewSwimlaneId,
          payload.afterUserstoryId,
          payload.beforeUserstoryId,
          payload.bulkUserstories,
        );
      } catch (err) {
        // Roll the board back to the pre-move state and surface the error. Do
        // NOT re-throw: the caller (`KanbanApp`'s `onMove`) invokes this
        // fire-and-forget (`void moveUs(...)`), so re-throwing would produce the
        // uncaught rejection the QA flagged.
        applyState(() => current);
        setWriteError(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      // .then tail (main.coffee:627-632): WIP recompute is AUTOMATIC on
      // re-render in React (no `redraw:wip` event needed); filters are
      // regenerated by KanbanApp via the injected callback. Only runs on a
      // SUCCESSFUL write.
      callbacksRef.current.onFiltersChanged?.();
    },
    [applyState],
  );

  /**
   * `moveUsToTop` (main.coffee:160-184). Moves a story to the TOP of its target
   * column. NOTE: the coffee calls `moveUs(null, uss, ...)` where the leading
   * `null` is the AngularJS controller `ctx`; this React hook drops `ctx`, so we
   * pass the story list as the FIRST arg. The transient `kanban-moved`
   * highlight is a purely cosmetic rendering concern owned by KanbanApp and is
   * intentionally omitted from this headless hook.
   */
  const moveUsToTop = useCallback(
    async (uss: UserStory | UserStory[]): Promise<void> => {
      const list = Array.isArray(uss) ? uss : [uss];
      const us = list[0];
      if (!us) {
        return;
      }
      const current = stateRef.current;
      let nextUsId: number | null = null;
      if (us.swimlane) {
        const col = current.usByStatusSwimlanes[us.swimlane]?.[us.status];
        nextUsId = col && col.length ? col[0] : null;
      } else {
        const col = current.usByStatus[String(us.status)];
        nextUsId = col && col.length ? col[0] : null;
      }
      if (nextUsId != null) {
        const swimlaneArg = us.swimlane == null ? -1 : us.swimlane;
        // index 0, previousCard null, nextCard = current first id.
        await moveUs(list, us.status, swimlaneArg, 0, null, nextUsId);
      }
    },
    [moveUs],
  );

  /**
   * `addUs` - reproduces the STATE effect of the `usform:new:success` /
   * `usform:bulk:success` handlers (main.coffee:187-206): add the created
   * story(ies) to the board (WIP recompute is automatic), and when
   * `position === 'top'` move it to the top of its column. The board state is
   * committed synchronously (via `applyState`) BEFORE `moveUsToTop` runs so the
   * latter sees the just-added story when it reads `stateRef.current`.
   */
  const addUs = useCallback(
    (created: UserStory | UserStory[], position: 'top' | 'bottom' = 'bottom'): void => {
      applyState((prev) => add(prev, created));
      if (position === 'top') {
        void moveUsToTop(created);
      }
    },
    [applyState, moveUsToTop],
  );

  /**
   * `addUsBulk` - the bulk-create path. POSTs the raw multiline `bulkStories`
   * text to `bulk_create` via the typed adapter, then adds the returned stories
   * to the board. Either this OR KanbanApp may own the `bulkCreate` call, but a
   * single invocation must yield a single `bulk_create` request.
   */
  const addUsBulk = useCallback(
    async (
      statusId: number,
      bulkStories: string,
      swimlaneId: number | null = null,
      position: 'top' | 'bottom' = 'bottom',
    ): Promise<void> => {
      const pid = projectIdRef.current;
      if (pid == null) {
        return;
      }
      const created = await userstories.bulkCreate(pid, statusId, bulkStories, swimlaneId);
      addUs(created as UserStory | UserStory[], position);
    },
    [addUs],
  );

  /**
   * `editUs` - reproduces the `usform:edit:success` STATE effect (main.coffee:
   * 208-221). When the status changed, bump `kanban_order` to (last card's
   * order + 1) so the story lands at the END of the new status column, then
   * `replaceModel -> refreshRawOrder -> refresh(false)`. We build a NEW story
   * object rather than mutating the input. The server PATCH itself is performed
   * by KanbanApp's edit-lightbox flow; this reproduces the board reaction.
   */
  const editUs = useCallback(
    (us: UserStory): void => {
      applyState((prev) => {
        const oldStatus = getUsModel(prev, us.id)?.status;
        let target = us;
        if (oldStatus !== us.status) {
          const col = prev.usByStatus[String(us.status)];
          if (col && col.length) {
            const lastUsId = col[col.length - 1];
            const lastOrder = prev.usMap[lastUsId]?.model?.kanban_order;
            if (typeof lastOrder === 'number') {
              target = { ...us, kanban_order: lastOrder + 1 };
            }
          }
        }
        let s = replaceModel(prev, target);
        s = refreshRawOrder(s);
        s = refresh(s, false);
        return s;
      });
    },
    [applyState],
  );

  /**
   * `deleteUs` - reproduces the `kanban:us:deleted` handler (main.coffee:
   * 223-224): remove the story from board state. The full delete flow (confirm
   * dialog + server `DELETE /userstories/:id`, main.coffee:297-314) is a
   * card-action owned by KanbanApp; this dispatcher reproduces only the
   * board-state removal that the event triggers.
   */
  const deleteUs = useCallback(
    (us: UserStory): void => {
      applyState((prev) => remove(prev, us));
    },
    [applyState],
  );

  /**
   * `toggleFold` (main.coffee:325-326) -> `service.toggleFold(id)`. Despite the
   * contract's `statusId` param label, this toggles a USER-STORY's fold flag
   * (the reducer's `toggleFold(state, usId)` toggles `foldStatusChanged[usId]`
   * and refreshes that story's view-model) - matching the coffee exactly.
   */
  const toggleFold = useCallback(
    (id: number): void => {
      applyState((prev) => foldStatus(prev, id));
    },
    [applyState],
  );

  /**
   * `toggleSwimlane` (main.coffee:328-334). Flip the folded flag for a swimlane
   * (keyed by `swimlaneId.toString()`), then persist ALL modes to localStorage
   * (the UI-preference parity for folded swimlanes). WIP recompute is automatic
   * on re-render.
   */
  const toggleSwimlane = useCallback((swimlaneId: number): void => {
    const pid = projectIdRef.current;
    setFoldedSwimlane((prev) => {
      const key = String(swimlaneId);
      const next = { ...prev, [key]: !prev[key] };
      if (pid != null) {
        storeSwimlanesModes(pid, next);
      }
      return next;
    });
  }, []);

  /**
   * `hideStatus` - reproduces the `hideUserStoriesForStatus` board effect
   * (main.coffee:543-544): mark the status hidden (the producer pushes it to
   * `statusHide`), removing its archived stories from the board view.
   */
  const hideStatus = useCallback(
    (statusId: number): void => {
      applyState((prev) => hideStatusProducer(prev, statusId));
    },
    [applyState],
  );

  /**
   * `showStatus` - reproduces `loadUserStoriesForStatus` + the show effect
   * (main.coffee:511-535). Applies the status-filter guard (return early WITHOUT
   * un-hiding when a status filter excludes this id), fetches the archived
   * stories for the status, then un-hides it and merges the stories in.
   */
  const showStatus = useCallback(
    async (statusId: number): Promise<void> => {
      const pid = projectIdRef.current;
      if (pid == null) {
        return;
      }
      // Guard (main.coffee:514-518): do nothing when a status filter excludes
      // this status.
      const filteredStatus = filtersQueryRef.current.status;
      if (filteredStatus != null) {
        const allowed = String(filteredStatus)
          .split(',')
          .map((it) => parseInt(it, 10));
        if (allowed.indexOf(statusId) === -1) {
          return;
        }
      }
      const stories = await loadUserStoriesForStatus(statusId);
      applyState((prev) => {
        let s = showStatusProducer(prev, statusId);
        s = add(s, stories);
        return refresh(s, false);
      });
    },
    [loadUserStoriesForStatus, applyState],
  );

  /**
   * `setLightboxOpen` - the consumer-facing half of the deferral gate
   * (main.coffee:230-237). Tracks the lightbox-open state (and its ref mirror,
   * read by the projects subscription). On CLOSE, if a refresh was deferred
   * while the lightbox was open, run it now and clear the flag.
   */
  const setLightboxOpen = useCallback(
    (open: boolean): void => {
      setIsLightboxOpened(open);
      isLightboxOpenedRef.current = open;
      if (open === false && isRefreshNeededRef.current) {
        void refreshAfterSwimlanesOrUserstoryStatusesHaveChanged();
        isRefreshNeededRef.current = false;
      }
    },
    [refreshAfterSwimlanesOrUserstoryStatusesHaveChanged],
  );


  // --- Effects -------------------------------------------------------------

  /**
   * WebSocket subscriptions (reproduces initializeSubscription, main.coffee:
   * 245-264). Keyed on `projectId` so subscriptions attach once the id is known
   * and detach on unmount / projectId change - reproducing the AngularJS route
   * attach/detach and preventing leaks across route changes (the custom-element
   * `disconnectedCallback` unmounts the React root, running this cleanup).
   */
  useEffect(() => {
    if (projectId == null) {
      return undefined;
    }

    const events = createEventsClient();
    events.connect();

    // ONE debounce delay, computed ONCE and SHARED by BOTH subscriptions - the
    // coffee computes `taiga.randomInt(700, 1000)` a single time and passes the
    // SAME value to both `debounceLeading` calls (main.coffee:246). randomInt is
    // INCLUSIVE of both bounds.
    const randomTimeout = 700 + Math.floor(Math.random() * (1000 - 700 + 1));

    // Subscription A - userstories (main.coffee:248-251). `debounceLeading` is a
    // TRAILING debounce; the callback receives the INNER WS payload, so
    // `message.pk` is directly on the argument.
    const keyUs = routingKeys.userstories(projectId);
    const onUs = createTrailingDebounce((payload: unknown) => {
      void eventsLoadUserstories(payload);
    }, randomTimeout);
    events.subscribe(keyUs, onUs);

    // Subscription B - projects (main.coffee:253-264). On the EXACT 3-string
    // `matches` set, refresh the board - but DEFER while a lightbox is open
    // (set the needed flag) and run on close instead.
    const keyProj = routingKeys.projects(projectId);
    const onProj = createTrailingDebounce((payload: unknown) => {
      const msg = payload as ProjectsEventPayload;
      if (msg.matches != null && PROJECT_EVENT_MATCHES.includes(msg.matches)) {
        if (isLightboxOpenedRef.current) {
          isRefreshNeededRef.current = true; // defer while a lightbox is open
        } else {
          void refreshAfterSwimlanesOrUserstoryStatusesHaveChanged();
        }
      }
    }, randomTimeout);
    events.subscribe(keyProj, onProj);

    // Cleanup: cancel pending trailing calls AND unsubscribe/disconnect.
    return () => {
      onUs.cancel();
      onProj.cancel();
      events.unsubscribe(keyUs);
      events.unsubscribe(keyProj);
      events.disconnect();
    };
  }, [projectId, eventsLoadUserstories, refreshAfterSwimlanesOrUserstoryStatusesHaveChanged]);

  /**
   * First-load + zoom coupling (reproduces the load-trigger semantics of
   * `setZoom`, main.coffee:127-148). On mount with a resolved slug, run the
   * initial load once (guarded by `didInitRef` so React StrictMode's
   * double-invoke does not double-load). On subsequent `zoomLevel` changes,
   * reload userstories ONLY when crossing UP from `<= 2` to `> 2` (when the
   * `include_attachments`/`include_tasks` params newly apply). NOTE the
   * deliberate off-by-one: `loadUserstoriesParams` adds the includes at `>= 2`,
   * but the reload trigger is `> 2 && prev <= 2`. Both are reproduced verbatim.
   */
  const didInitRef = useRef<boolean>(false);
  const prevZoomRef = useRef<number>(params.zoomLevel);
  useEffect(() => {
    if (!params.projectSlug) {
      return;
    }
    if (!didInitRef.current) {
      didInitRef.current = true;
      prevZoomRef.current = params.zoomLevel;
      void loadInitialData(); // isFirstLoad ? firstLoad()
      return;
    }
    const prevZoom = prevZoomRef.current;
    const currZoom = params.zoomLevel;
    prevZoomRef.current = currZoom;
    if (currZoom > 2 && prevZoom <= 2) {
      // Guard this fire-and-forget reload the same way as the initial load: a
      // rejected fetch must surface via `loadError`, never as an uncaught
      // rejection (F-READ-1, same latent pattern as `loadInitialData`).
      void loadUserstories().catch(handleLoadError);
    }
  }, [params.zoomLevel, params.projectSlug, loadInitialData, loadUserstories, handleLoadError]);

  // --- Result --------------------------------------------------------------

  return {
    // board state + projections
    state,
    usByStatus: state.usByStatus,
    usMap: state.usMap,
    usByStatusSwimlanes: state.usByStatusSwimlanes,
    swimlanesList: state.swimlanesList,
    statuses,
    project,
    projectId,
    usersById,
    foldedSwimlane,
    // flags
    isFirstLoad,
    loading,
    isLightboxOpened,
    notFoundUserstories,
    permissionError,
    loadError,
    writeError,
    // dispatchers
    moveUs,
    moveUsToTop,
    addUs,
    addUsBulk,
    editUs,
    deleteUs,
    toggleFold,
    toggleSwimlane,
    hideStatus,
    showStatus,
    reload,
    setLightboxOpen,
  };
}

export default useKanbanBoard;
