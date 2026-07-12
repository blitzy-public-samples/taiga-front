/*
 * Copyright (c) 2021-present Kaleidos INC
 *
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Backlog / Sprint-Planning state producers (immer) — value-semantic replacement
 * for the ordering + drag-reorder + pendingDrag logic of
 * app/coffee/modules/backlog/main.coffee and backlog/sortable.coffee.
 * Pure data-in/data-out: no React, no AngularJS, no DOM, no network.
 */

import { produce, type Draft } from "immer";
import type { UserStory, Milestone, OrderMap } from "../types";

/* ------------------------------------------------------------------------- *
 * State shape
 * ------------------------------------------------------------------------- */

/**
 * Value-semantic snapshot of the Backlog / Sprint-Planning screen, mirroring the
 * pieces of AngularJS `BacklogController` scope that drive ordering and drag:
 *   - `@scope.userstories`          -> `userstories`   (backlog list, sorted by backlog_order)
 *   - `@scope.sprints`              -> `sprints`       (open sprints; each `user_stories` sorted by sprint_order)
 *   - `@scope.closedSprints`        -> `closedSprints`
 *   - `@.backlogOrder`              -> `backlogOrder`  (usId -> backlog_order)
 *   - `@.milestonesOrder`           -> `milestonesOrder` (sprintId -> usId -> sprint_order)
 *   - `@.pendingDrag`               -> `pendingDrag`   (queue of coalesced drag moves)
 * The Immutable.js `Map`/`List` projections of the legacy service are replaced by
 * plain objects/arrays; every transition below is an immer producer returning NEW
 * state, so callers keep React value semantics without mutating the input.
 */
export interface BacklogState {
    /** Backlog (unassigned) user stories, sorted by `backlog_order`. */
    userstories: UserStory[];
    /** Open sprints; each sprint's `user_stories` is sorted by `sprint_order`. */
    sprints: Milestone[];
    /** Closed sprints (loaded/toggled separately from the open ones). */
    closedSprints: Milestone[];
    /** Map of user-story id -> `backlog_order` (legacy `@.backlogOrder`). */
    backlogOrder: OrderMap;
    /** Map of sprint id -> (user-story id -> `sprint_order`) (legacy `@.milestonesOrder`). */
    milestonesOrder: Record<number, OrderMap>;
    /** Queue of coalesced drag moves awaiting API resolution (legacy `@.pendingDrag`). */
    pendingDrag: PendingDragItem[];
}

/**
 * A single coalesced drag operation, mirroring the object legacy `moveUs` pushes
 * onto `@.pendingDrag`. `previousUs`/`nextUs` come from the DOM siblings computed
 * by `backlog/sortable.coffee` on drop: `previousUs` is the story immediately
 * before the drop point (null => dropped at the top) and `nextUs` is the story
 * immediately after — and, matching the legacy drag handler, `nextUs` is only
 * ever populated when `previousUs` is null (a top-of-list drop).
 */
export interface PendingDragItem {
    /** The moved story (or stories, for a multi-card drag). */
    usList: UserStory[];
    /** Target insertion index within the destination container. */
    newUsIndex: number;
    /** Destination sprint id, or `null` when the drop target is the backlog. */
    newSprintId: number | null;
    /** Id of the story immediately before the drop point (`null` => top). */
    previousUs: number | null;
    /** Id of the story immediately after the drop point (`null` => bottom). */
    nextUs: number | null;
}

/**
 * Request body for `bulk-update-us-backlog-order` — built in snake_case and sent
 * to the frozen `/api/v1/` endpoint as-is. Optional keys are OMITTED when absent,
 * exactly like legacy `resources/userstories.coffee#bulkUpdateBacklogOrder`.
 */
export interface BacklogOrderPayload {
    project_id: number;
    bulk_userstories: number[];
    milestone_id?: number;
    after_userstory_id?: number;
    before_userstory_id?: number;
}

/**
 * Request body for `bulk-update-us-milestone` — snake_case, mirroring legacy
 * `resources/userstories.coffee#bulkUpdateMilestone`.
 */
export interface MilestonePayload {
    project_id: number;
    milestone_id: number;
    bulk_stories: BulkOrderEntry[];
}

/**
 * One `{ us_id, order }` entry produced by {@link prepareBulkUpdateData}. `order`
 * is `number | undefined` because the source order field (`backlog_order` /
 * `sprint_order` / `kanban_order`) is optional on {@link UserStory}; the legacy
 * `_.map uses, (x) -> {us_id: x.id, order: x[field]}` produced the same shape.
 */
export interface BulkOrderEntry {
    us_id: number;
    order: number | undefined;
}

/* ------------------------------------------------------------------------- *
 * Order-map builders (mirror backlog/main.coffee)
 * ------------------------------------------------------------------------- */

/**
 * Build the backlog order map (`usId -> backlog_order`).
 * Legacy: `@.backlogOrder[it.id] = it.backlog_order` inside
 * `parseLoadUserstoriesResponse`.
 */
export function buildBacklogOrder(userstories: UserStory[]): OrderMap {
    const o: OrderMap = {};
    for (const it of userstories) {
        o[it.id] = it.backlog_order as number;
    }
    return o;
}

/**
 * Build the per-sprint order map (`sprintId -> (usId -> sprint_order)`).
 * Legacy `setMilestonesOrder`:
 *   for sprint in sprints:
 *     @.milestonesOrder[sprint.id] = {}
 *     for it in sprint.user_stories: @.milestonesOrder[sprint.id][it.id] = it.sprint_order
 */
export function buildMilestonesOrder(sprints: Milestone[]): Record<number, OrderMap> {
    const m: Record<number, OrderMap> = {};
    for (const sp of sprints) {
        m[sp.id] = {};
        for (const it of sp.user_stories ?? []) {
            m[sp.id][it.id] = it.sprint_order as number;
        }
    }
    return m;
}

/* ------------------------------------------------------------------------- *
 * Bulk-update data + API payload builders (mirror resources/userstories.coffee)
 * ------------------------------------------------------------------------- */

/**
 * Project a list of user stories to the `{ us_id, order }` entries the bulk-order
 * endpoints expect. `field` selects which order attribute to read.
 * Legacy: `prepareBulkUpdateData: (uses, field="backlog_order") ->
 *            _.map(uses, (x) -> {"us_id": x.id, "order": x[field]})`.
 */
export function prepareBulkUpdateData(
    uses: UserStory[],
    field: "backlog_order" | "sprint_order" | "kanban_order" = "backlog_order",
): BulkOrderEntry[] {
    return uses.map((x) => ({ us_id: x.id, order: x[field] }));
}

/**
 * Build the `bulk-update-us-backlog-order` payload. Optional keys are added only
 * when their source value is truthy, and `after_userstory_id` takes precedence
 * over `before_userstory_id` (ELSE IF), exactly like the legacy resource:
 *   params = {project_id, bulk_userstories}
 *   if milestoneId:        params.milestone_id = milestoneId
 *   if afterUserstoryId:   params.after_userstory_id = afterUserstoryId
 *   else if beforeUserstoryId: params.before_userstory_id = beforeUserstoryId
 */
export function buildBacklogOrderPayload(
    projectId: number,
    milestoneId: number | null,
    afterUserstoryId: number | null,
    beforeUserstoryId: number | null,
    bulkUserstories: number[],
): BacklogOrderPayload {
    const params: BacklogOrderPayload = {
        project_id: projectId,
        bulk_userstories: bulkUserstories,
    };
    if (milestoneId) {
        params.milestone_id = milestoneId;
    }
    if (afterUserstoryId) {
        params.after_userstory_id = afterUserstoryId;
    } else if (beforeUserstoryId) {
        params.before_userstory_id = beforeUserstoryId;
    }
    return params;
}

/**
 * Build the `bulk-update-us-milestone` payload.
 * Legacy: `params = {project_id, milestone_id, bulk_stories: data}`.
 */
export function buildMilestonePayload(
    projectId: number,
    milestoneId: number,
    bulkStories: BulkOrderEntry[],
): MilestonePayload {
    return {
        project_id: projectId,
        milestone_id: milestoneId,
        bulk_stories: bulkStories,
    };
}

/* ------------------------------------------------------------------------- *
 * pendingDrag queue helpers (mirror @.pendingDrag lifecycle in moveUs)
 * ------------------------------------------------------------------------- */

/** Producer: append a coalesced drag move to the queue (`@.pendingDrag.push`). */
export function enqueueDrag(state: BacklogState, item: PendingDragItem): BacklogState {
    return produce(state, (draft: Draft<BacklogState>) => {
        draft.pendingDrag.push(item);
    });
}

/** Producer: drop the head of the queue after it has been drained (`@.pendingDrag.shift`). */
export function shiftDrag(state: BacklogState): BacklogState {
    return produce(state, (draft: Draft<BacklogState>) => {
        draft.pendingDrag.shift();
    });
}

/** True when at least one drag move is queued. */
export function hasPendingDrag(state: BacklogState): boolean {
    return state.pendingDrag.length > 0;
}

/**
 * Encodes the legacy coalescing gate `if ctx && @.pendingDrag.length > 1 then return`:
 * when more than one drag is queued the API call is SKIPPED for the just-enqueued
 * move — the moves coalesce and only the last drained item actually calls the
 * backend. The consuming hook checks this before issuing a request.
 */
export function shouldCoalesceDrag(state: BacklogState): boolean {
    return state.pendingDrag.length > 1;
}

/**
 * Read-only peek at the head of the queue (the next move to drain, i.e. the item
 * the legacy success handler re-invokes `moveUs` with via `@.pendingDrag[0]`).
 */
export function peekDrag(state: BacklogState): PendingDragItem | undefined {
    return state.pendingDrag[0];
}

/* ------------------------------------------------------------------------- *
 * Optimistic collection edits (mirror the `if ctx` block of moveUs)
 * ------------------------------------------------------------------------- */

/**
 * Reshuffle `userstories` / `sprints[*].user_stories` optimistically (before the
 * server confirms), exactly as legacy `moveUs` does when a real drag context is
 * present. Handles cross-container moves (backlog <-> sprint, sprint <-> sprint)
 * and same-container reorders. The eventual server response reconciles the true
 * order via {@link reconcileMovedStory}; this optimistic edit only has to match
 * the legacy intermediate DOM.
 */
export function applyOptimisticMove(state: BacklogState, item: PendingDragItem): BacklogState {
    return produce(state, (draft: Draft<BacklogState>) => {
        const { usList, newUsIndex, newSprintId, previousUs, nextUs } = item;
        const oldSprintId = usList[0].milestone ?? null;
        const sourceSprint =
            oldSprintId != null ? draft.sprints.find((s) => s.id === oldSprintId) : null;
        const targetSprint =
            newSprintId != null ? draft.sprints.find((s) => s.id === newSprintId) : null;

        if (newSprintId !== oldSprintId) {
            // Cross-container move: remove from the source, then insert into the target.
            if (sourceSprint && sourceSprint.user_stories) {
                for (const us of usList) {
                    sourceSprint.user_stories = sourceSprint.user_stories.filter(
                        (it) => it.id !== us.id,
                    );
                }
            } else {
                // Came from the backlog.
                for (const us of usList) {
                    draft.userstories = draft.userstories.filter((it) => it.id !== us.id);
                }
            }

            if (newSprintId === null) {
                // Moved to the backlog.
                usList.forEach((us, i) => {
                    draft.userstories.splice(newUsIndex + i, 0, { ...us, milestone: null });
                });
            } else if (targetSprint) {
                if (!targetSprint.user_stories) {
                    targetSprint.user_stories = [];
                }
                usList.forEach((us, i) => {
                    targetSprint.user_stories!.splice(newUsIndex + i, 0, {
                        ...us,
                        milestone: newSprintId,
                    });
                });
            }
        } else {
            // Same-container reorder.
            const targetList: Draft<UserStory>[] =
                newSprintId != null ? targetSprint?.user_stories ?? [] : draft.userstories;

            for (const us of usList) {
                const idx = targetList.findIndex((it) => it.id === us.id);
                if (idx > -1) {
                    targetList.splice(idx, 1);
                }
            }

            // LEGACY QUIRK (preserve EXACTLY — do NOT "fix"): both branches search
            // `previousUs`. When only `nextUs` is set (a top-of-list drop), `previousUs`
            // is null, so findIndex returns -1; position then becomes -1, and the
            // `position++` below turns it into 0 (a front insert). This matches the
            // legacy `moveUs` intermediate DOM and is required for behavioral parity
            // (Minimal Change Clause).
            let position = 0;
            if (previousUs) {
                position = targetList.findIndex((u) => u.id === previousUs);
            } else if (nextUs) {
                // Intentional: mirrors the legacy quirk — `previousUs` is null here, so
                // this is a faithful replication of legacy behavior, NOT a bug to fix.
                position = targetList.findIndex((u) => u.id === previousUs);
            }
            position++;
            usList.forEach((us, i) => {
                targetList.splice(position + i, 0, us);
            });
        }
    });
}

/* ------------------------------------------------------------------------- *
 * Server reconciliation (mirror the moveUs success handler)
 * ------------------------------------------------------------------------- */

/**
 * Reconcile a moved story from the API success payload (`result.data`), mirroring
 * the legacy `moveUs` success handler which set `us.milestone` and
 * `us.backlog_order` from the response. The story is located wherever it currently
 * lives — backlog, an open sprint, or a closed sprint — and its `milestone` is
 * updated (and `backlog_order` when a value is provided). When the story is in the
 * backlog and a `backlogOrder` is provided, the `backlogOrder` map is kept in sync.
 * Defensive: if the story is not found anywhere, the state is returned unchanged.
 */
export function reconcileMovedStory(
    state: BacklogState,
    usId: number,
    milestoneId: number | null,
    backlogOrder: number | undefined,
): BacklogState {
    return produce(state, (draft: Draft<BacklogState>) => {
        let target: Draft<UserStory> | undefined = draft.userstories.find((it) => it.id === usId);
        const inBacklog = target !== undefined;

        if (!target) {
            for (const sp of draft.sprints) {
                const found = sp.user_stories?.find((it) => it.id === usId);
                if (found) {
                    target = found;
                    break;
                }
            }
        }

        if (!target) {
            for (const sp of draft.closedSprints) {
                const found = sp.user_stories?.find((it) => it.id === usId);
                if (found) {
                    target = found;
                    break;
                }
            }
        }

        // Defensive: story not found anywhere -> no-op.
        if (!target) {
            return;
        }

        target.milestone = milestoneId;
        if (backlogOrder !== undefined) {
            target.backlog_order = backlogOrder;
            if (inBacklog) {
                // Keep the backlog order map in sync (OrderMap values are numbers, so we
                // only write when a concrete order was returned by the server).
                draft.backlogOrder[usId] = backlogOrder;
            }
        }
    });
}

/* ------------------------------------------------------------------------- *
 * State builders / setters
 * ------------------------------------------------------------------------- */

/** Empty initial state (mirrors the `BacklogController` constructor init). */
export function createInitialBacklogState(): BacklogState {
    return {
        userstories: [],
        sprints: [],
        closedSprints: [],
        backlogOrder: {},
        milestonesOrder: {},
        pendingDrag: [],
    };
}

/**
 * Producer: replace the backlog list with `userstories` sorted by `backlog_order`
 * and rebuild the `backlogOrder` map. Mirrors `parseLoadUserstoriesResponse`
 * (`_.sortBy(userstories, "backlog_order")` + `@.backlogOrder[it.id] = it.backlog_order`).
 * The input array/objects are never mutated (a sorted copy is used).
 */
export function setUserstories(state: BacklogState, userstories: UserStory[]): BacklogState {
    const sorted = [...userstories].sort(
        (a, b) => (a.backlog_order ?? 0) - (b.backlog_order ?? 0),
    );
    return produce(state, (draft: Draft<BacklogState>) => {
        draft.userstories = sorted;
        draft.backlogOrder = buildBacklogOrder(sorted);
    });
}

/**
 * Producer: store the open `sprints`, sorting each sprint's `user_stories` by
 * `sprint_order`, then rebuild `milestonesOrder`. Mirrors `loadSprints`'
 * `sprint.user_stories = _.sortBy(sprint.user_stories, "sprint_order")` +
 * `setMilestonesOrder(sprints)`. A normalized copy is built so the caller's input
 * (and its sprint objects) is never mutated.
 */
export function setSprints(state: BacklogState, sprints: Milestone[]): BacklogState {
    const normalized: Milestone[] = sprints.map((sp) => ({
        ...sp,
        user_stories: [...(sp.user_stories ?? [])].sort(
            (a, b) => (a.sprint_order ?? 0) - (b.sprint_order ?? 0),
        ),
    }));
    return produce(state, (draft: Draft<BacklogState>) => {
        draft.sprints = normalized;
        draft.milestonesOrder = buildMilestonesOrder(normalized);
    });
}

/**
 * Producer: store the closed sprints. Mirrors `loadClosedSprints`' assignment of
 * `@scope.closedSprints`.
 */
export function setClosedSprints(state: BacklogState, closed: Milestone[]): BacklogState {
    return produce(state, (draft: Draft<BacklogState>) => {
        draft.closedSprints = closed;
    });
}

/* ------------------------------------------------------------------------- *
 * Move metadata helper (mirror the top of moveUs)
 * ------------------------------------------------------------------------- */

/**
 * Derive the request metadata legacy `moveUs` computes before issuing the bulk
 * order call:
 *   oldSprintId      = usList[0].milestone
 *   currentSprintId  = if newSprintId != oldSprintId then newSprintId else oldSprintId
 *   project          = usList[0].project
 *   bulkUserstories  = _.map(usList, (it) -> it.id)
 * The consuming hook combines this with `buildBacklogOrderPayload(projectId,
 * currentSprintId, previousUs, nextUs, bulkUserstories)` to form the API request.
 */
export function moveMetadata(
    usList: UserStory[],
    newSprintId: number | null,
): {
    oldSprintId: number | null;
    currentSprintId: number | null;
    projectId: number | undefined;
    bulkUserstories: number[];
} {
    const oldSprintId = usList[0].milestone ?? null;
    const currentSprintId = newSprintId !== oldSprintId ? newSprintId : oldSprintId;
    const projectId = usList[0].project;
    const bulkUserstories = usList.map((it) => it.id);
    return { oldSprintId, currentSprintId, projectId, bulkUserstories };
}
