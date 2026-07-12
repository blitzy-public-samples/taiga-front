/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useBacklogStories — the single custom React hook that owns ALL Backlog /
 * Sprint-Planning screen state and side effects.
 *
 * It reproduces (framework-only migration; behavior preserved exactly):
 *   - `BacklogController` + its directives/toolbar (app/coffee/modules/backlog/main.coffee)
 *   - the drag/move semantics of backlog/sortable.coffee (L39, L145)
 *   - the closed-sprint toggle of backlog/sprints.coffee
 *   - the sprint create/edit success/remove flows of backlog/lightboxes.coffee
 *   - the request shapes of resources/{userstories,sprints}.coffee
 *
 * It is consumed by `../Backlog.tsx`, which destructures EVERY {@link BacklogVM}
 * member below — a missing member is a runtime crash. This hook follows the
 * established sibling precedent `../../kanban/hooks/useKanbanStories.ts`
 * (runtime project window bridge + graceful fallback, immer state-producer
 * transitions, optimistic-move-then-persist with mandated rollback, and a WS
 * effect with consumer-owned debounce).
 *
 * Contract-preserving (constraint C-1): the backend is reached ONLY through
 * `apiClient` using the frozen endpoint keys; no new endpoint, header, or
 * request shape is ever constructed here. WebSocket routing keys are fixed by
 * `subscribeToProject`. There is NO parallel authorization: this hook only READS
 * `project.my_permissions` / `is_backlog_activated` for view gating.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    MountContext,
    Project,
    Milestone,
    UserStory,
    Status,
    Point,
    Role,
} from "../../shared/types";
import type { ApiClient, BulkStoryOrder } from "../../shared/api";
import { createApiClient } from "../../shared/api";
import { createEventsClient, subscribeToProject } from "../../shared/ws/events";
import type { EventsClient } from "../../shared/ws/events";
import {
    createInitialBacklogState,
    setUserstories,
    setSprints,
    setClosedSprints,
    enqueueDrag,
    shiftDrag,
    peekDrag,
    shouldCoalesceDrag,
    applyOptimisticMove,
    reconcileMovedStory,
    moveMetadata,
    prepareBulkUpdateData,
} from "../../shared/state";
import type { BacklogState, PendingDragItem } from "../../shared/state";
import type { BacklogStats } from "../BurndownSummary";

/* ------------------------------------------------------------------------- *
 * Internal types & helpers (module scope, above the hook)
 * ------------------------------------------------------------------------- */

/**
 * The full runtime project shape. The frozen REST surface exposes no
 * project-by-slug endpoint (only `resolveProject(slug)` -> numeric id), so the
 * rich project fields (`my_permissions`, `is_backlog_activated`, `points`,
 * `roles`, `us_statuses`, aggregate totals) are read from shell-provided
 * `window` globals. This mirrors the `ProjectRuntime` extension used by
 * `useKanbanStories.ts`.
 */
type ProjectRuntime = Project & {
    i_am_admin?: boolean;
    default_us_status?: number;
    us_statuses?: Status[];
    points?: Point[];
    roles?: Role[];
    members?: unknown[];
    total_story_points?: number | null;
    total_milestones?: number | null;
    total_closed_milestones?: number | null;
};

/**
 * THE one intentional cross-framework seam (AAP 0.6.1 — session/context bridge):
 * the surviving AngularJS shell publishes the fully-hydrated current project on a
 * `window` global before the React root mounts. Reading it here avoids adding a
 * new REST endpoint (constraint C-1) and keeps the two frameworks decoupled.
 * Returns `null` when no global is present so the caller can degrade gracefully.
 */
function readRuntimeProject(): ProjectRuntime | null {
    const w = window as unknown as {
        taigaConfig?: { project?: unknown };
        _project?: unknown;
        taigaCurrentProject?: unknown;
    };
    const candidates = [w.taigaConfig?.project, w._project, w.taigaCurrentProject];
    for (const c of candidates) {
        if (c && typeof c === "object") {
            return c as ProjectRuntime;
        }
    }
    return null;
}

/**
 * Graceful degradation (MANDATORY): never crash when the shell global is absent.
 * Empty `my_permissions` => controls hidden (read-only); backlog treated as
 * activated so the screen still renders.
 */
function buildFallbackProject(projectId: number, slug: string): ProjectRuntime {
    return {
        id: projectId,
        slug,
        name: "",
        my_permissions: [],
        is_kanban_activated: true,
        is_backlog_activated: true,
        archived_code: null,
        us_statuses: [],
        points: [],
        roles: [],
    } as ProjectRuntime;
}

/**
 * Dependency-free date parser (replaces moment in `findCurrentSprint` /
 * sprint sorting). Parses a leading `YYYY-MM-DD` to LOCAL midnight ms (TZ-safe,
 * matching the legacy `moment(date, 'YYYY-MM-DD')`), else falls back to
 * `Date.parse`. Returns `null` for empty/invalid input.
 */
function parseYmdMs(value: string | undefined): number | null {
    if (!value) {
        return null;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) {
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    }
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? null : t;
}

/** Inclusive random integer in [start, end] (matches the kanban precedent). */
function randomInt(start: number, end: number): number {
    return start + Math.floor(Math.random() * (end - start + 1));
}

/** A trailing-debounced function that also exposes a `cancel()` for cleanup. */
interface Debounced<A extends unknown[]> {
    (...args: A): void;
    cancel: () => void;
}

/**
 * Consumer-owned trailing debounce (the WS/search debounce is the caller's
 * responsibility per `subscribeToProject`). Matches the kanban precedent.
 */
function debounceTrailing<A extends unknown[]>(
    wait: number,
    fn: (...args: A) => void,
): Debounced<A> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wrapped = (...args: A): void => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, wait);
    };
    (wrapped as Debounced<A>).cancel = (): void => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };
    return wrapped as Debounced<A>;
}

/**
 * localStorage preference helpers — React-namespaced keys (NOT the legacy SHA1
 * hash keys). Guarded so private-mode / quota errors never break the screen.
 */
function readBoolPref(key: string, fallback: boolean): boolean {
    try {
        const v = window.localStorage.getItem(key);
        return v === null ? fallback : v === "true";
    } catch {
        return fallback;
    }
}

function writeBoolPref(key: string, value: boolean): void {
    try {
        window.localStorage.setItem(key, String(value));
    } catch {
        /* ignore quota/security errors */
    }
}

/** Sort sprints ascending by `estimated_finish` (legacy lightbox ordering). */
function sortByFinishAsc(sprints: Milestone[]): Milestone[] {
    return [...sprints].sort(
        (a, b) => (parseYmdMs(a.estimated_finish) ?? 0) - (parseYmdMs(b.estimated_finish) ?? 0),
    );
}

/** The latest-finishing open sprint (legacy lightboxes.coffee `getLastSprint`). */
function getLastSprint(openSprints: Milestone[]): Milestone | null {
    const sorted = sortByFinishAsc(openSprints);
    return sorted.length ? sorted[sorted.length - 1] : null;
}

/**
 * The sprint whose [estimated_start, estimated_finish] window contains "now"
 * (legacy `findCurrentSprint`, main.coffee L696). Returns `null` when none match.
 */
function findCurrentSprint(sprints: Milestone[]): Milestone | null {
    const now = Date.now();
    return (
        sprints.find((s) => {
            const start = parseYmdMs(s.estimated_start);
            const end = parseYmdMs(s.estimated_finish);
            return start != null && end != null && now >= start && now <= end;
        }) ?? null
    );
}

/**
 * DERIVED backlog stats (contract-preserving POC approximation): the frozen
 * 14-key REST surface has no `rs.projects.stats` counterpart, so a faithful
 * {@link BacklogStats} is derived from the loaded milestones + runtime project.
 * `completedPercentage` / the graph-placeholder gate use the EXACT legacy formula
 * (main.coffee L256-267). `speed` is 0 (no velocity endpoint) — see
 * `calculateForecasting`.
 */
function computeStats(
    runtime: ProjectRuntime | null,
    openSprints: Milestone[],
    closedSprints: Milestone[],
): BacklogStats {
    const allSprints = [...openSprints, ...closedSprints];
    const closed_points = allSprints.reduce((acc, m) => acc + (m.closed_points ?? 0), 0);
    const sprintTotal = allSprints.reduce((acc, m) => acc + (m.total_points ?? 0), 0);
    const defined_points =
        runtime && runtime.total_story_points != null
            ? Number(runtime.total_story_points)
            : sprintTotal;
    const total_points = sprintTotal || defined_points;
    const total_milestones =
        runtime && runtime.total_milestones != null
            ? Number(runtime.total_milestones)
            : allSprints.length;
    const denom = total_points || defined_points;
    const completedPercentage = denom ? Math.round((100 * closed_points) / denom) : 0;
    return {
        total_points,
        defined_points,
        closed_points,
        assigned_points: closed_points,
        speed: 0,
        completedPercentage,
        total_milestones,
    };
}

/* ------------------------------------------------------------------------- *
 * Public VM contract (LOCKED — do NOT rename/drop/retype any member)
 * ------------------------------------------------------------------------- */

/** Open/close + mode + payload for the sprint create/edit lightbox. */
export interface SprintLightboxState {
    open: boolean;
    mode: "create" | "edit";
    sprint: Milestone | null;
    lastSprint: Milestone | null;
}

/**
 * The complete view-model surface consumed by `../Backlog.tsx`. Every member is
 * destructured by the consumer; the object returned by {@link useBacklogStories}
 * MUST contain all of them.
 */
export interface BacklogVM {
    // ---- state ----
    loading: boolean;
    project: Project | null;
    projectId: number;
    userstories: UserStory[];
    sprints: Milestone[];
    closedSprints: Milestone[];
    closedSprintsVisible: boolean;
    totalMilestones: number;
    totalClosedMilestones: number;
    totalUserStories: number;
    currentSprint: Milestone | null;
    stats: BacklogStats | null;
    showGraphPlaceholder: boolean;
    showTags: boolean;
    activeFilters: boolean;
    displayVelocity: boolean;
    forecastNewSprint: boolean;
    filterQ: string;
    selectedFilters: unknown[];
    statuses: Status[];
    selectedUs: Set<number>;
    eventsConnected: boolean;
    sprintLightbox: SprintLightboxState;
    apiClient: ApiClient;
    // ---- actions ----
    hasPermission: (perm: string) => boolean;
    isBacklogActivated: boolean;
    loadUserstories: () => void;
    changeQ: (q: string) => void;
    toggleShowTags: () => void;
    toggleActiveFilters: () => void;
    toggleVelocityForecasting: () => void;
    toggleClosedSprints: () => void;
    moveUs: (
        usList: UserStory[],
        newUsIndex: number,
        newSprintId: number | null,
        previousUs: UserStory | null,
        nextUs: UserStory | null,
    ) => void;
    moveToSprint: (usList: UserStory[], sprintId: number) => void;
    moveUsToTop: (us: UserStory) => void;
    updateUserStoryStatus: (us: UserStory, statusId: number) => void;
    updateUserStoryPoints: (us: UserStory, roleId: number | null, pointId: number) => void;
    deleteUserStory: (us: UserStory) => void;
    addNewUs: (type: "standard" | "bulk") => void;
    editUserStory: (us: UserStory) => void;
    toggleSelectedUs: (us: UserStory, checked: boolean) => void;
    moveSelectedToCurrentSprint: () => void;
    moveSelectedToLatestSprint: () => void;
    openCreateSprint: () => void;
    openEditSprint: (sprint: Milestone) => void;
    closeSprintLightbox: () => void;
    onSprintSaved: () => void;
    onSprintDeleted: () => void;
    createSprintFromForecasting: () => void;
}

/* ------------------------------------------------------------------------- *
 * The hook
 * ------------------------------------------------------------------------- */

/**
 * Own all Backlog / Sprint-Planning state and side effects for a single mounted
 * screen. `context` is the cross-framework mount payload resolved by the Web
 * Component adapter and passed straight through by `../Backlog.tsx`.
 */
export function useBacklogStories(context: MountContext): BacklogVM {
    // ---- story/sprint data: ONE state object driven by the immer producers ----
    const [state, setState] = useState<BacklogState>(() => createInitialBacklogState());

    // ---- UI-only state (kept separate from the producer-driven data) ----
    const [loading, setLoading] = useState<boolean>(true);
    const [project, setProject] = useState<Project | null>(null);
    const [projectId, setProjectId] = useState<number>(0);
    const [statuses, setStatuses] = useState<Status[]>([]);
    const [closedSprintsVisible, setClosedSprintsVisible] = useState<boolean>(false);
    const [totalMilestones, setTotalMilestones] = useState<number>(0);
    const [totalClosedMilestones, setTotalClosedMilestones] = useState<number>(0);
    const [totalUserStories, setTotalUserStories] = useState<number>(0);
    const [currentSprint, setCurrentSprint] = useState<Milestone | null>(null);
    const [stats, setStats] = useState<BacklogStats | null>(null);
    const [showGraphPlaceholder, setShowGraphPlaceholder] = useState<boolean>(true);
    const [showTags, setShowTags] = useState<boolean>(true);
    const [activeFilters, setActiveFilters] = useState<boolean>(false);
    const [displayVelocity, setDisplayVelocity] = useState<boolean>(false);
    const [forecastNewSprint, setForecastNewSprint] = useState<boolean>(true);
    const [filterQ, setFilterQ] = useState<string>("");
    // `selectedFilters` is presentational-only in the POC (no setter consumed yet).
    const [selectedFilters] = useState<unknown[]>([]);
    const [selectedUs, setSelectedUs] = useState<Set<number>>(() => new Set<number>());
    const [eventsConnected, setEventsConnected] = useState<boolean>(false);
    const [sprintLightbox, setSprintLightbox] = useState<SprintLightboxState>({
        open: false,
        mode: "create",
        sprint: null,
        lastSprint: null,
    });

    // ---- the thin call-through client (stable per mount context) ----
    const apiClient = useMemo<ApiClient>(() => createApiClient(context), [context]);

    // ---- refs to defeat stale closures in async callbacks / WS handlers /
    // move-persist recursion (read the CURRENT value inside callbacks) ----
    const stateRef = useRef<BacklogState>(state);
    const statsRef = useRef<BacklogStats | null>(stats);
    const projectRef = useRef<ProjectRuntime | null>(null);
    const projectIdRef = useRef<number>(0);
    const filterQRef = useRef<string>("");
    const selectedUsRef = useRef<Set<number>>(selectedUs);
    const currentSprintRef = useRef<Milestone | null>(null);
    const eventsClientRef = useRef<EventsClient | null>(null);
    const preMoveSnapshotRef = useRef<BacklogState | null>(null);

    // Keep the refs in sync with the latest committed render values.
    useEffect(() => {
        stateRef.current = state;
    }, [state]);
    useEffect(() => {
        statsRef.current = stats;
    }, [stats]);
    useEffect(() => {
        selectedUsRef.current = selectedUs;
    }, [selectedUs]);
    useEffect(() => {
        currentSprintRef.current = currentSprint;
    }, [currentSprint]);
    useEffect(() => {
        filterQRef.current = filterQ;
    }, [filterQ]);
    useEffect(() => {
        projectIdRef.current = projectId;
    }, [projectId]);

    /* --------------------------------------------------------------------- *
     * Forecasting (main.coffee L444) — best-effort. Default true; when open
     * sprints exist it flips to false unless velocity (`speed`) is known and the
     * first sprint over-fills it. With the derived `speed = 0` it therefore
     * mirrors the legacy "there are sprints => no forecast-new-sprint prompt".
     * --------------------------------------------------------------------- */
    const calculateForecasting = useCallback((): void => {
        let next = true;
        const openSprints = stateRef.current.sprints;
        if (openSprints.length > 0) {
            const speed = statsRef.current?.speed ?? 0;
            const firstPoints = openSprints[0].total_points ?? 0;
            if (!(speed > 0 && firstPoints > speed)) {
                next = false;
            }
        }
        setForecastNewSprint(next);
    }, []);

    /* --------------------------------------------------------------------- *
     * Loaders (useCallbacks). Those that run during mount take an explicit
     * `pid` so they work before `projectId` state settles; `loadUserstories`
     * reads the refs so it is safe from WS handlers and the US-lightbox bridge.
     * --------------------------------------------------------------------- */

    /** Prefer the runtime project's `us_statuses`; else the filters endpoint; else []. */
    const loadStatuses = useCallback(
        async (pid: number, runtime: ProjectRuntime | null): Promise<void> => {
            let next: Status[] = [];
            const fromRuntime = runtime?.us_statuses;
            if (fromRuntime && fromRuntime.length) {
                next = [...fromRuntime].sort(
                    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id,
                );
            } else {
                try {
                    const f = await apiClient.getUserStoriesFilters({ project: pid });
                    next = (f as { statuses?: Status[] }).statuses ?? [];
                } catch {
                    next = [];
                }
            }
            setStatuses(next);
        },
        [apiClient],
    );

    /** List open sprints, store them (sorted), set totals + current sprint. */
    const loadSprints = useCallback(
        async (pid: number): Promise<Milestone[]> => {
            const res = await apiClient.listMilestones(pid, { closed: false });
            setState((s) => setSprints(s, res.milestones));
            setTotalMilestones(res.open + res.closed);
            setTotalClosedMilestones(res.closed);
            const current = findCurrentSprint(res.milestones);
            setCurrentSprint(current);
            currentSprintRef.current = current;
            return res.milestones;
        },
        [apiClient],
    );

    /** List closed sprints and store them (the closed-sprint toggle target). */
    const loadClosedSprints = useCallback(
        async (pid: number): Promise<void> => {
            const res = await apiClient.listMilestones(pid, { closed: true });
            setState((s) => setClosedSprints(s, res.milestones));
            setTotalClosedMilestones(res.closed);
        },
        [apiClient],
    );

    /**
     * Load the backlog (unassigned) user stories. Legacy filter is
     * `{ project, milestone: "null" }` (string "null") plus the current search
     * `q`. React `listUserStories` returns only an array (no
     * `Taiga-Info-Backlog-Total-Userstories` header), so `list.length` is the
     * faithful POC substitute for `totalUserStories`.
     */
    const loadUserstories = useCallback(async (): Promise<void> => {
        const pid = projectIdRef.current;
        if (!pid) {
            return;
        }
        const list = await apiClient.listUserStories({
            project: pid,
            milestone: "null",
            q: filterQRef.current,
            page: 1,
        });
        setState((s) => setUserstories(s, list));
        setTotalUserStories(list.length);
    }, [apiClient]);

    /** Recompute derived stats + graph-placeholder gate, then forecasting. */
    const refreshStats = useCallback((): void => {
        const s = computeStats(
            projectRef.current,
            stateRef.current.sprints,
            stateRef.current.closedSprints,
        );
        statsRef.current = s;
        setStats(s);
        setShowGraphPlaceholder(!(s.total_points && s.total_milestones));
        calculateForecasting();
    }, [calculateForecasting]);


    /* --------------------------------------------------------------------- *
     * Mount effect — keyed [context.projectSlug], run-once guard with
     * cancellation. Resolves the project id, bridges the runtime project (or a
     * graceful fallback), then loads statuses -> sprints -> closed sprints ->
     * userstories, computes stats and forecasting, and hydrates localStorage
     * prefs. On error it still clears `loading` so the screen never hangs.
     * --------------------------------------------------------------------- */
    useEffect(() => {
        let cancelled = false;
        void (async (): Promise<void> => {
            try {
                setLoading(true);
                const pid = await apiClient.resolveProject(context.projectSlug ?? "");
                if (cancelled) {
                    return;
                }
                setProjectId(pid);
                projectIdRef.current = pid;
                const runtime =
                    readRuntimeProject() ?? buildFallbackProject(pid, context.projectSlug ?? "");
                projectRef.current = runtime;
                setProject(runtime);
                await loadStatuses(pid, runtime);
                const open = await loadSprints(pid);
                if (cancelled) {
                    return;
                }
                await loadClosedSprints(pid);
                await loadUserstories();
                if (cancelled) {
                    return;
                }
                const s = computeStats(runtime, open, stateRef.current.closedSprints);
                statsRef.current = s;
                setStats(s);
                setShowGraphPlaceholder(!(s.total_points && s.total_milestones));
                calculateForecasting();
                setShowTags(readBoolPref(`taiga-react:backlog:${pid}:showTags`, true));
                setDisplayVelocity(
                    readBoolPref(`taiga-react:backlog:${pid}:displayVelocity`, false),
                );
            } catch (e) {
                // Never leave the screen blank; log for diagnostics.
                // eslint-disable-next-line no-console
                console.error("useBacklogStories: initial load failed", e);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
        // Loaders are stable (memoized on apiClient); re-running only on the slug
        // avoids reload loops while still reacting to project navigation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context.projectSlug]);

    /* --------------------------------------------------------------------- *
     * WebSocket effect — keyed [projectId], only when truthy (mirrors kanban).
     * Reproduces `initializeSubscription` (main.coffee L206): the userstories
     * key reloads userstories + sprints; the milestones key reloads sprints +
     * closed sprints + stats. The consumer owns the debounce;
     * `subscribeToProject` attaches `{ selfNotification: true }` for milestones
     * internally, so it is NOT passed here. Backlog subscribes only
     * onUserStories + onMilestones (never onProjects).
     * --------------------------------------------------------------------- */
    useEffect(() => {
        if (!projectId) {
            return;
        }
        const client = createEventsClient(context);
        eventsClientRef.current = client;
        const onUserStories = debounceTrailing(randomInt(700, 1000), (): void => {
            void loadUserstories();
            void loadSprints(projectId);
        });
        const onMilestones = debounceTrailing(randomInt(700, 1000), (): void => {
            void loadSprints(projectId);
            void loadClosedSprints(projectId);
            refreshStats();
        });
        const cleanup = subscribeToProject(client, projectId, { onUserStories, onMilestones });
        client.setupConnection();
        setEventsConnected(client.isConnected());
        return () => {
            onUserStories.cancel();
            onMilestones.cancel();
            cleanup();
            client.stop();
            eventsClientRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId]);

    /* --------------------------------------------------------------------- *
     * US-lightbox bridge effect — keyed [] (mount once). The US create/edit/bulk
     * lightboxes stay AngularJS: this hook DISPATCHES `tg-react:us:new` /
     * `tg-react:us:edit` outward (see addNewUs / editUserStory) and LISTENS for
     * the AngularJS side reporting success so the backlog reloads (reproducing
     * legacy `usform:*:success` -> load()). Best-effort — if the shell never
     * emits these, the screen simply relies on the WS reload.
     * --------------------------------------------------------------------- */
    useEffect(() => {
        const onUsSaved = (): void => {
            void loadUserstories();
            refreshStats();
        };
        window.addEventListener("tg-react:us:saved", onUsSaved as EventListener);
        window.addEventListener("tg-react:us:deleted", onUsSaved as EventListener);
        return () => {
            window.removeEventListener("tg-react:us:saved", onUsSaved as EventListener);
            window.removeEventListener("tg-react:us:deleted", onUsSaved as EventListener);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* --------------------------------------------------------------------- *
     * Drag/move persistence (main.coffee L523-645): optimistic reshuffle +
     * coalesced queue + single bulk-order call + reconcile + events-disconnected
     * fallback + MANDATED rollback (the AAP adds the rollback the legacy lacked).
     * --------------------------------------------------------------------- */

    /**
     * Drain the head of the pendingDrag queue with exactly one
     * `bulk-update-us-backlog-order` call (legacy `moveUs` with `ctx = null`).
     * On success: reconcile milestone/backlog_order from server truth, shift the
     * queue, then drain the next item or — if the queue is empty and the WS is
     * disconnected — reload from the server (the legacy events-disconnected
     * fallback). On failure: restore the pre-batch snapshot.
     */
    const drainPendingDrag = useCallback((): void => {
        const s0 = stateRef.current;
        const head = peekDrag(s0);
        if (!head) {
            return;
        }
        const meta = moveMetadata(head.usList, head.newSprintId);
        const pid = projectIdRef.current;
        apiClient
            .bulkUpdateBacklogOrder(
                pid,
                meta.currentSprintId,
                head.previousUs,
                head.nextUs,
                meta.bulkUserstories,
            )
            .then((updated) => {
                // Reconcile from server truth + shift the queue. We compute the
                // next state from `stateRef.current` (the authoritative in-flight
                // value) and sync the ref SYNCHRONOUSLY here — the `[state]`
                // passive effect only runs after React commits, which is far too
                // late for the recursion below. Reading `stateRef.current` in a
                // microtask instead would observe the STALE pre-shift queue and
                // recurse forever (heap exhaustion). Driving the loop off the
                // freshly-computed `ns` guarantees termination.
                let ns = stateRef.current;
                for (const u of updated) {
                    ns = reconcileMovedStory(ns, u.id, u.milestone ?? null, u.backlog_order);
                }
                ns = shiftDrag(ns);
                stateRef.current = ns;
                setState(ns);
                // Drain the next queued move, or finish the batch.
                if (peekDrag(ns)) {
                    drainPendingDrag();
                    return;
                }
                preMoveSnapshotRef.current = null;
                // Events-disconnected fallback (main.coffee L633-637).
                const connected = eventsClientRef.current?.isConnected() ?? false;
                if (!connected) {
                    void loadSprints(projectIdRef.current);
                    void loadClosedSprints(projectIdRef.current);
                    refreshStats();
                }
            })
            .catch((err: unknown) => {
                // MANDATED ROLLBACK (AAP 0.6.3 — legacy had none): restore the
                // pre-batch snapshot and clear the queue. Sync the ref so any
                // subsequent move starts from the rolled-back state.
                const snapshot = preMoveSnapshotRef.current;
                if (snapshot) {
                    stateRef.current = snapshot;
                    setState(snapshot);
                }
                preMoveSnapshotRef.current = null;
                // eslint-disable-next-line no-console
                console.error(
                    "useBacklogStories.moveUs: bulkUpdateBacklogOrder failed; rolled back",
                    err,
                );
            });
    }, [apiClient, loadSprints, loadClosedSprints, refreshStats]);

    /**
     * Enqueue a drag move, apply the optimistic reshuffle, and drain only when
     * this is the FIRST queued move (subsequent moves coalesce and are drained
     * one at a time on resolve). `previousUs`/`nextUs` arrive as UserStory
     * objects from `Backlog.tsx` and are converted to ids for the producer/API.
     */
    const moveUs = useCallback(
        (
            usList: UserStory[],
            newUsIndex: number,
            newSprintId: number | null,
            previousUs: UserStory | null,
            nextUs: UserStory | null,
        ): void => {
            const item: PendingDragItem = {
                usList,
                newUsIndex,
                newSprintId,
                previousUs: previousUs ? previousUs.id : null,
                nextUs: nextUs ? nextUs.id : null,
            };
            // `stateRef.current` is the authoritative in-flight state (it is kept
            // synchronised on every move/drain transition, ahead of the `[state]`
            // passive effect). Snapshot for rollback only when a NEW batch begins
            // (queue currently empty).
            const base = stateRef.current;
            if (base.pendingDrag.length === 0) {
                preMoveSnapshotRef.current = base;
            }
            const next = applyOptimisticMove(enqueueDrag(base, item), item);
            stateRef.current = next;
            setState(next);
            // Only the FIRST enqueued drag fires the API immediately; extras
            // coalesce (shouldCoalesceDrag(next) === next.pendingDrag.length > 1)
            // and are drained one at a time by the in-flight drain's recursion.
            if (!shouldCoalesceDrag(next)) {
                drainPendingDrag();
            }
        },
        [drainPendingDrag],
    );


    /**
     * Move stories into a sprint (legacy `moveUssToSprint`, main.coffee L779-810):
     * optimistic cross-container move to the front of the target sprint, then one
     * `bulk-update-us-milestone` call, then reload + recompute; rollback on reject.
     */
    const moveToSprint = useCallback(
        (usList: UserStory[], sprintId: number): void => {
            const pid = projectIdRef.current;
            if (stateRef.current.pendingDrag.length === 0) {
                preMoveSnapshotRef.current = stateRef.current;
            }
            const item: PendingDragItem = {
                usList,
                newUsIndex: 0,
                newSprintId: sprintId,
                previousUs: null,
                nextUs: null,
            };
            const optimistic = applyOptimisticMove(stateRef.current, item);
            stateRef.current = optimistic;
            setState(optimistic);
            // `prepareBulkUpdateData` yields `order: number | undefined`; coerce the
            // (always-present in practice) sprint_order to the `BulkStoryOrder`
            // `order: number` shape the frozen endpoint expects.
            const bulk: BulkStoryOrder[] = prepareBulkUpdateData(usList, "sprint_order").map(
                (e) => ({ us_id: e.us_id, order: e.order ?? 0 }),
            );
            apiClient
                .bulkUpdateMilestone(pid, sprintId, bulk)
                .then(() => {
                    void loadSprints(pid);
                    void loadClosedSprints(pid);
                    refreshStats();
                    calculateForecasting();
                })
                .catch((err: unknown) => {
                    const snapshot = preMoveSnapshotRef.current;
                    if (snapshot) {
                        stateRef.current = snapshot;
                        setState(snapshot);
                    }
                    preMoveSnapshotRef.current = null;
                    // eslint-disable-next-line no-console
                    console.error(
                        "useBacklogStories.moveToSprint: bulkUpdateMilestone failed; rolled back",
                        err,
                    );
                });
        },
        [apiClient, loadSprints, loadClosedSprints, refreshStats, calculateForecasting],
    );

    /**
     * Reorder a story to the front of the backlog (legacy
     * `moveUsToTopOfBacklog`, main.coffee L511). No-op when the backlog is empty
     * or the story is already first; otherwise reuse `moveUs` with the current
     * first story as `nextUs`.
     */
    const moveUsToTop = useCallback(
        (us: UserStory): void => {
            const first = stateRef.current.userstories[0];
            if (!first || first.id === us.id) {
                return;
            }
            moveUs([us], 0, null, null, first);
        },
        [moveUs],
    );

    /**
     * Inline status editor on a backlog row: optimistic status change, then a
     * dirty-field PATCH (only `{ status }` + `version` over the wire). On reject,
     * reload to recover server truth.
     */
    const updateUserStoryStatus = useCallback(
        (us: UserStory, statusId: number): void => {
            setState((s) =>
                setUserstories(
                    s,
                    s.userstories.map((u) => (u.id === us.id ? { ...u, status: statusId } : u)),
                ),
            );
            apiClient
                .save("userstories", { ...us, status: statusId }, { status: statusId })
                .then(() => {
                    refreshStats();
                })
                .catch((err: unknown) => {
                    void loadUserstories();
                    // eslint-disable-next-line no-console
                    console.error("useBacklogStories.updateUserStoryStatus failed", err);
                });
        },
        [apiClient, loadUserstories, refreshStats],
    );

    /**
     * Inline points editor: optimistic update of the story's role->point map, then
     * a dirty-field PATCH of `{ points }`. When `roleId` is null (single computable
     * role), apply to the first computable role when known; otherwise still PATCH
     * the map defensively.
     */
    const updateUserStoryPoints = useCallback(
        (us: UserStory, roleId: number | null, pointId: number): void => {
            const newPoints: Record<string, number | null> = { ...(us.points ?? {}) };
            if (roleId != null) {
                newPoints[String(roleId)] = pointId;
            } else {
                const roles = projectRef.current?.roles ?? [];
                const computable = roles.find((r) => r.computable);
                if (computable) {
                    newPoints[String(computable.id)] = pointId;
                }
            }
            const patched = { ...us, points: newPoints };
            setState((s) =>
                setUserstories(
                    s,
                    s.userstories.map((u) => (u.id === us.id ? patched : u)),
                ),
            );
            apiClient
                .save("userstories", patched, { points: newPoints })
                .then(() => {
                    refreshStats();
                })
                .catch((err: unknown) => {
                    void loadUserstories();
                    // eslint-disable-next-line no-console
                    console.error("useBacklogStories.updateUserStoryPoints failed", err);
                });
        },
        [apiClient, loadUserstories, refreshStats],
    );

    /**
     * Delete a story after confirmation (legacy `$confirm.askOnDelete`;
     * `window.confirm` is the POC substitute): optimistic remove, DELETE, then
     * reload stats + sprints; rollback the removal on reject.
     */
    const deleteUserStory = useCallback(
        (us: UserStory): void => {
            const ok =
                typeof window.confirm === "function"
                    ? window.confirm("Delete this user story?")
                    : true;
            if (!ok) {
                return;
            }
            const snapshot = stateRef.current;
            setState((s) => setUserstories(s, s.userstories.filter((u) => u.id !== us.id)));
            apiClient
                .remove("userstories", us.id)
                .then(() => {
                    refreshStats();
                    void loadSprints(projectIdRef.current);
                })
                .catch((err: unknown) => {
                    setState(snapshot);
                    // eslint-disable-next-line no-console
                    console.error("useBacklogStories.deleteUserStory failed; rolled back", err);
                });
        },
        [apiClient, loadSprints, refreshStats],
    );

    /**
     * Open the AngularJS US create/bulk lightbox via an outward window
     * CustomEvent (no React US modal). `"standard"` <-> legacy `genericform:new`;
     * `"bulk"` <-> `usform:bulk`.
     */
    const addNewUs = useCallback((type: "standard" | "bulk"): void => {
        window.dispatchEvent(
            new CustomEvent("tg-react:us:new", {
                detail: { type, projectId: projectIdRef.current },
            }),
        );
    }, []);

    /** Open the AngularJS US edit lightbox via an outward window CustomEvent. */
    const editUserStory = useCallback((us: UserStory): void => {
        window.dispatchEvent(
            new CustomEvent("tg-react:us:edit", {
                detail: { us, projectId: projectIdRef.current },
            }),
        );
    }, []);

    /** Toggle a story's membership in the multi-select set (bulk toolbar). */
    const toggleSelectedUs = useCallback((us: UserStory, checked: boolean): void => {
        setSelectedUs((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(us.id);
            } else {
                next.delete(us.id);
            }
            return next;
        });
    }, []);

    /**
     * Bulk-move the selected stories to the current sprint (legacy toolbar
     * `moveToCurrentSprint`: currentSprint || sprints[0]), then clear selection.
     */
    const moveSelectedToCurrentSprint = useCallback((): void => {
        const selectedList = stateRef.current.userstories.filter((u) =>
            selectedUsRef.current.has(u.id),
        );
        if (!selectedList.length) {
            return;
        }
        const target = currentSprintRef.current ?? stateRef.current.sprints[0];
        if (!target) {
            return;
        }
        moveToSprint(selectedList, target.id);
        setSelectedUs(new Set<number>());
    }, [moveToSprint]);

    /**
     * Bulk-move the selected stories to the latest sprint (legacy toolbar
     * `moveToLatestSprint`: sprints[0]), then clear selection.
     */
    const moveSelectedToLatestSprint = useCallback((): void => {
        const selectedList = stateRef.current.userstories.filter((u) =>
            selectedUsRef.current.has(u.id),
        );
        if (!selectedList.length) {
            return;
        }
        const target = stateRef.current.sprints[0];
        if (!target) {
            return;
        }
        moveToSprint(selectedList, target.id);
        setSelectedUs(new Set<number>());
    }, [moveToSprint]);

    /* --------------------------------------------------------------------- *
     * Sprint lightbox actions. This hook only manages open/close + mode +
     * `lastSprint`; the actual milestones create/save/remove HTTP calls live in
     * `../lightboxes/CreateEditSprint.tsx`. onSprintSaved / onSprintDeleted run
     * the post-save/delete reloads (legacy `sprintform:*:success`).
     * --------------------------------------------------------------------- */
    const openCreateSprint = useCallback((): void => {
        setSprintLightbox({
            open: true,
            mode: "create",
            sprint: null,
            lastSprint: getLastSprint(stateRef.current.sprints),
        });
    }, []);

    /** The forecasting flow simply opens the create lightbox. */
    const createSprintFromForecasting = useCallback((): void => {
        setSprintLightbox({
            open: true,
            mode: "create",
            sprint: null,
            lastSprint: getLastSprint(stateRef.current.sprints),
        });
    }, []);

    const openEditSprint = useCallback((sprint: Milestone): void => {
        setSprintLightbox({
            open: true,
            mode: "edit",
            sprint,
            lastSprint: getLastSprint(stateRef.current.sprints),
        });
    }, []);

    const closeSprintLightbox = useCallback((): void => {
        setSprintLightbox((lb) => ({ ...lb, open: false }));
    }, []);

    /** Close + reload after a sprint is created/edited (loadSprints + stats). */
    const onSprintSaved = useCallback((): void => {
        setSprintLightbox((lb) => ({ ...lb, open: false }));
        void loadSprints(projectIdRef.current);
        refreshStats();
    }, [loadSprints, refreshStats]);

    /**
     * Close + full reload after a sprint is removed (loadSprints + closed +
     * userstories + stats). If velocity was on, turn it off (legacy
     * `sprintform:remove:success`).
     */
    const onSprintDeleted = useCallback((): void => {
        setSprintLightbox((lb) => ({ ...lb, open: false }));
        const pid = projectIdRef.current;
        void loadSprints(pid);
        void loadClosedSprints(pid);
        void loadUserstories();
        refreshStats();
        setDisplayVelocity((v) => {
            if (v) {
                writeBoolPref(`taiga-react:backlog:${pid}:displayVelocity`, false);
                return false;
            }
            return v;
        });
    }, [loadSprints, loadClosedSprints, loadUserstories, refreshStats]);

    /* --------------------------------------------------------------------- *
     * Toggles + search
     * --------------------------------------------------------------------- */

    const toggleShowTags = useCallback((): void => {
        setShowTags((v) => {
            const nv = !v;
            writeBoolPref(`taiga-react:backlog:${projectIdRef.current}:showTags`, nv);
            return nv;
        });
    }, []);

    const toggleActiveFilters = useCallback((): void => {
        setActiveFilters((v) => !v);
    }, []);

    const toggleVelocityForecasting = useCallback((): void => {
        setDisplayVelocity((v) => {
            const nv = !v;
            writeBoolPref(`taiga-react:backlog:${projectIdRef.current}:displayVelocity`, nv);
            return nv;
        });
        calculateForecasting();
    }, [calculateForecasting]);

    /**
     * Toggle the closed-sprint section: loading them on, clearing them on off
     * (legacy `backlog:load-closed-sprints` / `backlog:unload-closed-sprints`).
     */
    const toggleClosedSprints = useCallback((): void => {
        setClosedSprintsVisible((v) => {
            const nv = !v;
            if (nv) {
                void loadClosedSprints(projectIdRef.current);
            } else {
                setState((s) => setClosedSprints(s, []));
            }
            return nv;
        });
    }, [loadClosedSprints]);

    /** Stable trailing-debounced backlog reload for the search input. */
    const debouncedLoadUserstories = useMemo(
        () =>
            debounceTrailing(randomInt(300, 500), (): void => {
                void loadUserstories();
            }),
        [loadUserstories],
    );

    // Cancel any pending debounced reload on unmount / re-key.
    useEffect(
        () => () => {
            debouncedLoadUserstories.cancel();
        },
        [debouncedLoadUserstories],
    );

    /** Update the search query + ref, then trigger a debounced reload. */
    const changeQ = useCallback(
        (q: string): void => {
            setFilterQ(q);
            filterQRef.current = q;
            debouncedLoadUserstories();
        },
        [debouncedLoadUserstories],
    );

    /* --------------------------------------------------------------------- *
     * Permission read (VIEW gating only — NO parallel authorization; the backend
     * is the single enforcement point, constraint C-1).
     * --------------------------------------------------------------------- */
    const hasPermission = useCallback((perm: string): boolean => {
        const perms = projectRef.current?.my_permissions;
        return perms ? perms.indexOf(perm) > -1 : false;
    }, []);

    // Boolean field (NOT a function). Default true so the screen renders even
    // before the project loads or when the flag is absent.
    const isBacklogActivated = project ? project.is_backlog_activated !== false : true;

    /* --------------------------------------------------------------------- *
     * Return the complete BacklogVM (every member present — a missing one
     * crashes Backlog.tsx).
     * --------------------------------------------------------------------- */
    return {
        // ---- state ----
        loading,
        project,
        projectId,
        userstories: state.userstories,
        sprints: state.sprints,
        closedSprints: state.closedSprints,
        closedSprintsVisible,
        totalMilestones,
        totalClosedMilestones,
        totalUserStories,
        currentSprint,
        stats,
        showGraphPlaceholder,
        showTags,
        activeFilters,
        displayVelocity,
        forecastNewSprint,
        filterQ,
        selectedFilters,
        statuses,
        selectedUs,
        eventsConnected,
        sprintLightbox,
        apiClient,
        // ---- actions ----
        hasPermission,
        isBacklogActivated,
        loadUserstories,
        changeQ,
        toggleShowTags,
        toggleActiveFilters,
        toggleVelocityForecasting,
        toggleClosedSprints,
        moveUs,
        moveToSprint,
        moveUsToTop,
        updateUserStoryStatus,
        updateUserStoryPoints,
        deleteUserStory,
        addNewUs,
        editUserStory,
        toggleSelectedUs,
        moveSelectedToCurrentSprint,
        moveSelectedToLatestSprint,
        openCreateSprint,
        openEditSprint,
        closeSprintLightbox,
        onSprintSaved,
        onSprintDeleted,
        createSprintFromForecasting,
    };
}

