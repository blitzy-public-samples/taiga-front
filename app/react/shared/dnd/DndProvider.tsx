/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Shared, framework-agnostic React drag-and-drop provider for the Taiga
 * AngularJS -> React migration. It is the declarative `@dnd-kit/core`
 * replacement for the imperative `dragula` + `dom-autoscroller` pair used by the
 * legacy Kanban and Backlog boards, and it is consumed by BOTH React screens
 * (Kanban columns / cards / swimlanes and Backlog sprint / backlog rows).
 *
 * On drop it persists the new order through the FROZEN Django `/api/v1/`
 * bulk-order endpoints, but ONLY by calling the functions exported from the
 * sibling `../api/userstories` module — it never calls `fetch` directly and
 * never re-derives an endpoint URL.
 *
 * The ordering semantics below are a faithful, verified port of:
 *   - app/coffee/modules/kanban/sortable.coffee        (drake config, over/out/drag/drop/dragend, neighbors, autoscroll)
 *   - app/coffee/modules/backlog/sortable.coffee       (neighbors, sameContainer, moveUs call, window autoscroll)
 *   - app/coffee/modules/kanban/main.coffee   L596-625  (moveUs: swimlane -1 -> null, bulkUpdateKanbanOrder arg order)
 *   - app/coffee/modules/backlog/main.coffee  L523-609  (moveUs: currentSprintId, bulkUpdateBacklogOrder arg order)
 *   - app/coffee/modules/kanban/kanban-usertories.coffee L150-190 (move() return proves the neighbor -> API mapping)
 *
 * ---------------------------------------------------------------------------
 * CONSUMER DOM / DATA-ATTRIBUTE CONTRACT (so the ordering math works AND the
 * already-compiled SCSS still themes the DOM by class name):
 *
 *   Kanban   — draggable cards carry `data-id` (the `tg-card` element);
 *              droppable columns carry `data-status` and `data-swimlane`.
 *   Backlog  — draggable rows carry `data-id` (the `.row` element);
 *              droppable containers are the sprint / backlog tables
 *              (`.sprint-table`, `.backlog-table-body`, `.js-empty-backlog`).
 *
 * NEIGHBOR -> API MAPPING (the XOR contract the backend relies on):
 *   `previous` (the item BEFORE the drop, in final visual order) -> `afterUserstoryId`
 *   `next`     (the item AFTER  the drop)                        -> `beforeUserstoryId`
 *   `next` is produced ONLY when there is no `previous` (i.e. the item landed
 *   at the very top of the target container).
 *
 * SWIMLANE MAPPING (Kanban only): the raw board value `-1` ("no swimlane") is
 * mapped to `null` before hitting the API (see `mapSwimlaneForApi`).
 *
 * WHY the consumer computes the ordered id list (not this provider): unlike
 * `dragula`, dnd-kit does NOT mutate the DOM during a drag, so the post-drop DOM
 * cannot be read with jQuery `prevAll`/`nextAll`. Instead the consuming screen
 * (KanbanApp / BacklogApp), which owns the board state, resolves the TARGET
 * container's final ordered id list + the dropped index inside `resolveDrop`,
 * and this provider derives the neighbors from that array via `computeNeighbors`.
 * That keeps the provider 100% screen-agnostic while faithfully reproducing the
 * source's after / before / index / status / swimlane semantics.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import type {
    CollisionDetection,
    DragEndEvent,
    DragStartEvent,
    KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { bulkUpdateBacklogOrder, bulkUpdateKanbanOrder } from "../api/userstories";
import type { UserStory } from "../api/userstories";
import type { HttpResponse } from "../api/httpClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal structural project shape needed for the permission gate. Mirrors the
 * two fields the CoffeeScript sortable directives read from `$scope.project`
 * (kanban/sortable.coffee L37-41).
 */
export interface DndProject {
    /** `my_permissions` from the project payload; DnD requires `"modify_us"`. */
    my_permissions?: readonly string[] | null;
    /** Truthy when the project is archived; archived projects disable DnD. */
    archived_code?: unknown;
}

/** Where an item sits: a stable container key plus its 0-based index within that container. */
export interface DropLocation {
    /** Stable identifier for the container (e.g. `"status:1|swimlane:-1"`, `"sprint:42"`, `"backlog"`). */
    containerKey: string;
    /** 0-based position of the item among its siblings in that container. */
    index: number;
}

/** The immediate neighbors used to build the API's after / before ids. */
export interface DropNeighbors {
    /** Id of the item immediately BEFORE the drop -> `afterUserstoryId`. */
    previous: number | null;
    /** Id of the item immediately AFTER the drop -> `beforeUserstoryId` (only when `previous` is null). */
    next: number | null;
}

/**
 * A fully-resolved drop, produced by the per-screen `resolveDrop` callback from
 * the raw dnd-kit drag-end event and the consumer's own board state.
 */
export interface ResolvedDrop {
    /** Container + index the item started in (used by the skip-when-unchanged rule). */
    origin: DropLocation;
    /** Container + index the item landed in. */
    target: DropLocation;
    /** Final visual order of item ids in the TARGET container, INCLUDING the dropped item. */
    orderedIds: number[];
    /** Ids being moved (single-item drag => exactly one element). */
    draggedIds: number[];
}

/** Args for the Kanban bulk-order endpoint (swimlane still raw here; `-1` is allowed). */
export interface KanbanPersistArgs {
    /** Target status column id. */
    statusId: number;
    /** Raw board swimlane value; `-1` means "no swimlane" and is mapped to `null` for the API. */
    swimlaneId: number;
    /** Neighbor before the drop (maps to `after_userstory_id`). */
    afterUserstoryId: number | null;
    /** Neighbor after the drop (maps to `before_userstory_id`). */
    beforeUserstoryId: number | null;
    /** Ids of the moved user stories. */
    bulkUserstories: number[];
}

/** Args for the Backlog / Sprint bulk-order endpoint. */
export interface BacklogPersistArgs {
    /** Destination milestone id, or `null` for the backlog. */
    milestoneId: number | null;
    /** Neighbor before the drop (maps to `after_userstory_id`). */
    afterUserstoryId: number | null;
    /** Neighbor after the drop (maps to `before_userstory_id`). */
    beforeUserstoryId: number | null;
    /** Ids of the moved user stories. */
    bulkUserstories: number[];
}

/**
 * Normalized drag-end payload handed to the per-screen `resolveDrop`. It exposes
 * the numeric active id, the raw `over` id (which may be a container key), and
 * the untouched dnd-kit event for consumers that need collision geometry.
 */
export interface NormalizedDragEnd {
    /** `Number(active.id)` — the dragged item's numeric id. */
    activeId: number;
    /** `over?.id ?? null` — the drop target id (may be a container key string). */
    overId: number | string | null;
    /** Raw dnd-kit event, for consumers that need geometry / collision data. */
    event: DragEndEvent;
}

/** Props for {@link DndProvider}. */
export interface DndProviderProps {
    /** Board project used for the permission gate. */
    project: DndProject;
    /** The board subtree (columns / rows) rendered inside the drag context. */
    children: ReactNode;
    /**
     * Per-screen resolver: turn a raw dnd-kit drag-end into a {@link ResolvedDrop}
     * using the consumer's own state (item -> container / index resolution).
     * Return `null` to abort (e.g. dropped outside any known container).
     */
    resolveDrop: (event: NormalizedDragEnd) => ResolvedDrop | null;
    /**
     * Per-screen persister: called with the resolved drop and the
     * provider-computed neighbors. Consumers pass a closure that builds
     * {@link KanbanPersistArgs} / {@link BacklogPersistArgs} and calls the matching
     * factory ({@link createKanbanPersister} / {@link createBacklogPersister}).
     */
    persist: (resolved: ResolvedDrop, neighbors: DropNeighbors) => void | Promise<void>;
    /** Optional overlay renderer shown while dragging (mirrors dragula's drag mirror). */
    renderDragOverlay?: (activeId: number | null) => ReactNode;
    /** Optional pointer activation distance in px (default 5, prevents accidental drags on click). */
    activationDistance?: number;
    /** Optional pass-through for dnd-kit autoScroll (default `true` — built-in autoscroll enabled). */
    autoScroll?: boolean;
    /**
     * Optional collision-detection strategy for the `DndContext`. When omitted,
     * dnd-kit's default (`rectIntersection`) is used. The Backlog passes
     * {@link rowPreferringCollisionDetection} so drops resolve to a specific row
     * (precise reorder + single-step keyboard); Kanban leaves it undefined.
     */
    collisionDetection?: CollisionDetection;
    /**
     * Optional `KeyboardSensor` coordinate getter for accessible keyboard DnD.
     * When omitted, the dnd-kit default (fixed pixel step) is used. The Backlog
     * passes {@link singleStepKeyboardCoordinates} for one-row-per-arrow movement
     * ([N]); Kanban leaves it undefined.
     */
    keyboardCoordinateGetter?: KeyboardCoordinateGetter;
    /**
     * Optional RECOVERABLE-FAILURE-SIGNALING hook. Invoked when the drop's
     * {@link persist} REJECTS (async) OR throws synchronously.
     *
     * The provider is intentionally screen-agnostic and does NOT own the board
     * state (the consumer's {@link resolveDrop} does), so it cannot roll back an
     * optimistic move itself. Instead it hands the consuming screen the `error`
     * and the exact {@link ResolvedDrop} that failed, so the screen can:
     *   1. restore its optimistic board state (reverse the move using
     *      `resolved.origin` / `resolved.target` / `resolved.orderedIds` /
     *      `resolved.draggedIds`), and
     *   2. surface a user-facing error (translated toast, inline message, etc.).
     *
     * When omitted, the provider falls back to a single diagnostic
     * `console.error` so a persistence failure is NEVER silently swallowed — but
     * it still never throws. `resolved` is `null` only in the (unreachable for a
     * genuine persistence failure) case where the drop was aborted before
     * persistence; consumers should treat a `null` resolved defensively.
     */
    onPersistError?: (error: unknown, resolved: ResolvedDrop | null) => void;
    /**
     * [M-12] Notifies the consumer when a drag STARTS (`true`) and ENDS/CANCELS
     * (`false`). The legacy Kanban detected "a drag is in progress" by probing
     * for dragula's `tg-card.gu-mirror` element (kanban/main.coffee L1172); with
     * `@dnd-kit` there is no such DOM mirror to probe, so the provider — the one
     * component that owns the drag lifecycle — surfaces the active flag instead.
     * `KanbanBoard` uses it to drive the folded-swimlane hover auto-open, which
     * must only trigger WHILE a card is being dragged.
     */
    onDragActiveChange?: (active: boolean) => void;
}

// ---------------------------------------------------------------------------
// Pure helper functions (deterministic and directly unit-testable)
// ---------------------------------------------------------------------------

/**
 * Permission gate — mirrors kanban/sortable.coffee L37-41 intent: DnD is enabled
 * ONLY when the project grants the `"modify_us"` permission AND is not archived.
 *
 * The backlog directive (backlog/sortable.coffee L30) expresses the same intent
 * with an inverted boolean that reads incorrectly; per the migration plan we
 * follow the authoritative Kanban intent here for both screens.
 */
export function isDragEnabled(project: DndProject | null | undefined): boolean {
    if (!project) {
        return false;
    }

    const permissions = project.my_permissions;

    return (
        Array.isArray(permissions) &&
        permissions.indexOf("modify_us") > -1 &&
        !project.archived_code
    );
}

/**
 * Compute the `{ previous, next }` neighbor ids for a drop, reproducing the
 * legacy `prevAll('...:not(.gu-transit)')[0]` / `nextAll(...)[0]` selection with
 * the XOR gate that the bulk-order API relies on.
 *
 * `previous` is the closest non-dragged id scanning BACKWARD from `index - 1`.
 * `next` is the closest non-dragged id scanning FORWARD from `index + 1`, but
 * ONLY when there is no `previous` (the item landed at the top of the container).
 * Items in `draggedIds` are skipped so the moved item(s) never count as their own
 * neighbor (the source excluded the drag mirror via `:not(.gu-transit)`).
 *
 * @param orderedIds Final order of item ids in the target container, INCLUDING the dropped item.
 * @param index      0-based position where the dropped item's first element landed.
 * @param draggedIds Ids currently being dragged (excluded from the scan). Defaults to `[orderedIds[index]]`.
 */
export function computeNeighbors(
    orderedIds: number[],
    index: number,
    draggedIds?: number[],
): DropNeighbors {
    const dragged =
        draggedIds ??
        (index >= 0 && index < orderedIds.length ? [orderedIds[index]] : []);

    let previous: number | null = null;
    for (let i = index - 1; i >= 0; i--) {
        const id = orderedIds[i];
        if (dragged.indexOf(id) === -1) {
            previous = id;
            break;
        }
    }

    let next: number | null = null;
    if (previous === null) {
        // XOR: only look forward when there is NO previous neighbor.
        for (let i = index + 1; i < orderedIds.length; i++) {
            const id = orderedIds[i];
            if (dragged.indexOf(id) === -1) {
                next = id;
                break;
            }
        }
    }

    return { previous, next };
}

/**
 * Skip-when-unchanged rule: a drop that lands at the same index in the same
 * container is a no-op and must NOT be persisted. Mirrors the legacy guards
 * `index == oldIndex && initialContainer == parentEl` (kanban dragend) and
 * `index == oldIndex && sameContainer` (backlog dragend).
 */
export function shouldSkip(origin: DropLocation, target: DropLocation): boolean {
    return target.index === origin.index && target.containerKey === origin.containerKey;
}

/**
 * Kanban swimlane mapping for the API: the raw board value `-1` ("no swimlane")
 * becomes `null`; every other value passes through unchanged. This mirrors
 * kanban/main.coffee L604-607 (`apiNewSwimlaneId = null when newSwimlaneId == -1`).
 */
export function mapSwimlaneForApi(swimlane: number): number | null {
    return swimlane === -1 ? null : swimlane;
}

/**
 * Orchestrate one drop: abort on a null resolution, skip a no-op move, otherwise
 * compute the neighbors and hand them to the per-screen `persist` callback. This
 * is exactly what the provider's `onDragEnd` runs, exposed as a pure function so
 * it is directly unit-testable.
 *
 * @returns the `persist()` result (a promise when the persister is async), or
 *          `undefined` when the drop is null or skipped.
 */
export function applyDrop(
    resolved: ResolvedDrop | null,
    persist: (resolved: ResolvedDrop, neighbors: DropNeighbors) => void | Promise<void>,
): void | Promise<void> {
    if (!resolved) {
        return;
    }

    if (shouldSkip(resolved.origin, resolved.target)) {
        return;
    }

    const neighbors = computeNeighbors(
        resolved.orderedIds,
        resolved.target.index,
        resolved.draggedIds,
    );

    return persist(resolved, neighbors);
}

// ---------------------------------------------------------------------------
// Persister factories (the ONLY code in this file that imports ../api/userstories)
// ---------------------------------------------------------------------------

/**
 * Build a Kanban order persister bound to a project. It maps the raw swimlane
 * value `-1 -> null` (via {@link mapSwimlaneForApi}) BEFORE calling the API, then
 * invokes `bulkUpdateKanbanOrder` with the exact argument order verified against
 * kanban/main.coffee L618-625: `(projectId, statusId, swimlane, after, before, bulk)`.
 */
export function createKanbanPersister(
    projectId: number,
): (args: KanbanPersistArgs) => Promise<HttpResponse<UserStory[]>> {
    return (args: KanbanPersistArgs): Promise<HttpResponse<UserStory[]>> =>
        bulkUpdateKanbanOrder(
            projectId,
            args.statusId,
            mapSwimlaneForApi(args.swimlaneId),
            args.afterUserstoryId,
            args.beforeUserstoryId,
            args.bulkUserstories,
        );
}

/**
 * Build a Backlog / Sprint order persister bound to a project. It invokes
 * `bulkUpdateBacklogOrder` with the exact argument order verified against
 * backlog/main.coffee L603-609: `(projectId, milestoneId, after, before, bulk)`.
 * A `null` `milestoneId` means the backlog (no sprint).
 */
export function createBacklogPersister(
    projectId: number,
): (args: BacklogPersistArgs) => Promise<HttpResponse<UserStory[]>> {
    return (args: BacklogPersistArgs): Promise<HttpResponse<UserStory[]>> =>
        bulkUpdateBacklogOrder(
            projectId,
            args.milestoneId,
            args.afterUserstoryId,
            args.beforeUserstoryId,
            args.bulkUserstories,
        );
}

// ---------------------------------------------------------------------------
// DndProvider component (generic, dependency-injected)
// ---------------------------------------------------------------------------

/**
 * Default pointer activation distance (px). Prevents a plain click from being
 * interpreted as the start of a drag, matching dragula's implicit click/drag
 * distinction.
 */
const DEFAULT_ACTIVATION_DISTANCE = 5;

/**
 * Generic drag-and-drop provider shared by the React Kanban and Backlog screens.
 *
 * When DnD is NOT permitted (see {@link isDragEnabled}) it renders its children
 * with no `DndContext`, no sensors and no overlay — an inert pass-through that
 * behaves exactly like the legacy directives, which simply never initialized the
 * dragula drake without the `modify_us` permission.
 *
 * When permitted it wires a `PointerSensor` (mouse/touch/pen) AND a
 * `KeyboardSensor` (accessible keyboard-only drag), tracks the active dragged id
 * for the optional `DragOverlay`, and on drop delegates ordering + persistence to
 * {@link applyDrop} (which itself uses the injected `resolveDrop` / `persist`
 * callbacks). Auto-scroll during drag uses dnd-kit's BUILT-IN autoscroll (the
 * `autoScroll` prop, enabled by default) — the legacy `dom-autoscroller` is
 * deliberately not reintroduced.
 *
 * On a persistence FAILURE the provider signals the consuming screen via the
 * optional {@link DndProviderProps.onPersistError} callback (so the screen can
 * roll back its optimistic state and show a user-facing error); it never throws
 * and never renders error UI itself.
 */
export function DndProvider(props: DndProviderProps): JSX.Element {
    const {
        project,
        children,
        resolveDrop,
        persist,
        renderDragOverlay,
        activationDistance,
        autoScroll,
        collisionDetection,
        keyboardCoordinateGetter,
        onPersistError,
        onDragActiveChange,
    } = props;

    // Hooks are intentionally called UNCONDITIONALLY, before the permission gate
    // below, so hook order stays stable across renders even if `project` flips
    // the gate (e.g. permissions reload or the project becomes archived). This is
    // the canonical Rules-of-Hooks-safe pattern: call every hook, THEN branch the
    // returned JSX. The sensor/state are simply left unused when DnD is disabled.
    const [activeId, setActiveId] = useState<number | null>(null);

    // Two sensors so the board is operable by BOTH pointer and keyboard:
    //   • PointerSensor — mouse / touch / pen, with a small activation distance
    //     so a plain click is not misread as a drag (mirrors dragula's implicit
    //     click/drag distinction).
    //   • KeyboardSensor — accessible, keyboard-only drag-and-drop (Space/Enter to
    //     pick up, arrow keys to move, Space/Enter to drop, Esc to cancel). The
    //     legacy imperative `dragula` drake had no keyboard affordance; adding the
    //     KeyboardSensor is required for WCAG-compatible keyboard DnD.
    //
    //     The KeyboardSensor MUST be given a `coordinateGetter`; without one it
    //     picks a card up but the arrow keys produce no movement, so a keyboard
    //     user cannot reorder cards (QA-A11Y-03). `sortableKeyboardCoordinates`
    //     from @dnd-kit/sortable translates arrow keys into the next sortable
    //     droppable position, matching the `SortableContext` +
    //     `verticalListSortingStrategy` the columns already use.
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: activationDistance ?? DEFAULT_ACTIVATION_DISTANCE,
            },
        }),
        // Keyboard DnD coordinate getter, resolved per screen so BOTH boards stay
        // operable by keyboard (the KeyboardSensor ALWAYS receives a coordinateGetter,
        // never a no-op pick-up):
        //   • Backlog injects `singleStepKeyboardCoordinates` (one-row-per-arrow, [N]).
        //   • Kanban passes nothing and falls back to `sortableKeyboardCoordinates`
        //     (QA-A11Y-03), which matches the `SortableContext` +
        //     `verticalListSortingStrategy` the columns use.
        useSensor(KeyboardSensor, {
            coordinateGetter: keyboardCoordinateGetter ?? sortableKeyboardCoordinates,
        }),
    );

    const handleDragStart = useCallback(
        (event: DragStartEvent): void => {
            setActiveId(Number(event.active.id));
            // [M-12] A card drag has begun — enable folded-swimlane hover-open.
            onDragActiveChange?.(true);
        },
        [onDragActiveChange],
    );

    const handleDragCancel = useCallback((): void => {
        setActiveId(null);
        // [M-12] Drag cancelled — disable hover-open.
        onDragActiveChange?.(false);
    }, [onDragActiveChange]);

    const handleDragEnd = useCallback(
        (event: DragEndEvent): void => {
            // Build the normalized payload the per-screen resolver expects. `over`
            // may be a container key (string) or an item id (number), so it is kept
            // as the raw dnd-kit union here.
            const normalized: NormalizedDragEnd = {
                activeId: Number(event.active.id),
                overId: event.over ? event.over.id : null,
                event,
            };

            // Clear the overlay id immediately.
            setActiveId(null);
            // [M-12] The drag has ended — disable folded-swimlane hover-open.
            onDragActiveChange?.(false);

            // Resolve the drop UP-FRONT so the resolved payload is available to the
            // failure-recovery contract below. The consuming screen needs the exact
            // origin / target / orderedIds to restore its optimistic board state
            // when persistence fails.
            const resolved = resolveDrop(normalized);

            // Centralized, promise- AND throw-safe failure recovery. When the
            // consumer supplies `onPersistError` it OWNS the recovery: reverse the
            // optimistic move and surface a user-facing error (RECOVERABLE FAILURE
            // SIGNALING). When it does not, we fall back to a single diagnostic log
            // so a failure is never silently swallowed. Either way the provider
            // NEVER throws and NEVER renders app-specific error UI itself (it is a
            // generic, screen-agnostic provider).
            const handleFailure = (error: unknown): void => {
                if (onPersistError) {
                    onPersistError(error, resolved);
                    return;
                }
                // eslint-disable-next-line no-console
                console.error(
                    "[taiga-react] drag-and-drop order persistence failed",
                    error,
                );
            };

            try {
                // `applyDrop` may return void (skipped / null) or a promise (async
                // persist). `Promise.resolve(...)` normalizes both; the leading
                // `void` discards the promise so a rejection cannot surface as an
                // unhandled rejection — it is routed to `handleFailure` instead.
                void Promise.resolve(applyDrop(resolved, persist)).catch(handleFailure);
            } catch (error) {
                // A SYNCHRONOUS throw from `persist` (i.e. it threw instead of
                // returning a rejected promise) is routed through the SAME recovery
                // path, guaranteeing the drag handler never throws.
                handleFailure(error);
            }
        },
        [resolveDrop, persist, onPersistError, onDragActiveChange],
    );

    // Permission gate: inert pass-through when DnD is disabled (no DndContext,
    // no sensors, no overlay).
    if (!isDragEnabled(project)) {
        return <>{children}</>;
    }

    return (
        <DndContext
            sensors={sensors}
            autoScroll={autoScroll ?? true}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            {children}
            <DragOverlay>
                {renderDragOverlay ? renderDragOverlay(activeId) : null}
            </DragOverlay>
        </DndContext>
    );
}

