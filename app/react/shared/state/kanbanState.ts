/*
 * Copyright (c) 2021-present Kaleidos INC
 *
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Kanban board state producers (immer) — value-semantic replacement for
 * app/coffee/modules/kanban/kanban-usertories.coffee (KanbanUserstoriesService).
 * Pure data-in/data-out: no React, no AngularJS, no DOM, no network.
 */

import { produce, type Draft } from "immer";
import type { UserStory, Swimlane, OrderMap } from "../types";

/**
 * Value-semantic snapshot of the Kanban board's derived projections.
 *
 * This is the plain-object replacement for the Immutable.js structures the
 * legacy `KanbanUserstoriesService` maintained (`usByStatus`, `usMap`,
 * `usByStatusSwimlanes`, `swimlanesList`, `order`). Every field is a plain
 * array or `Record` so that the immer producers below stay side-effect-free
 * and no `enableMapSet()` call is required.
 *
 * The React board's DOM parity (WIP counter, the `section.main.kanban.swimlane`
 * toggle, column fold, archived / blocked row classes) depends on these
 * projections being IDENTICAL in content and ORDER to the Immutable.js
 * originals, so the producers reproduce the legacy algorithms exactly.
 */
export interface KanbanState {
    /** Flat list of user stories, kept sorted by `order[id]`. */
    userstoriesRaw: UserStory[];
    /** Configured swimlanes supplied through {@link init}. */
    swimlanes: Swimlane[];
    /** usId -> folded? — a separate presentation flag the Card component reads. */
    foldStatusChanged: Record<number, boolean>;
    /** `String(statusId)` -> ordered `usId[]` (a kanban column). */
    usByStatus: Record<string, number[]>;
    /** usId -> raw {@link UserStory} (no presentation enrichment). */
    usMap: Record<number, UserStory>;
    /** `String(swimlaneId)` -> (`String(statusId)` -> `usId[]`). */
    usByStatusSwimlanes: Record<string, Record<string, number[]>>;
    /** Hidden status ids. */
    statusHide: number[];
    /** Archived status ids. */
    archivedStatus: number[];
    /** Ordered swimlanes for rendering (may include the synthetic `-1`). */
    swimlanesList: Swimlane[];
    /** usId -> working kanban order value. */
    order: OrderMap;
}

/**
 * Result payload produced by {@link move}. The `shared/api/client.ts` layer
 * maps these five camelCase keys onto the frozen `bulk-update-us-kanban-order`
 * request shape (`status_id`, `swimlane_id`, `after_userstory_id` /
 * `before_userstory_id`, `bulk_userstories`) — do NOT snake_case them here.
 */
export interface KanbanMoveResult {
    statusId: number;
    swimlaneId: number | null;
    afterUserstoryId: number | null;
    beforeUserstoryId: number | null;
    bulkUserstories: number[];
}

/** Id of the synthetic "unclassified" swimlane (stories with `swimlane == null`). */
export const UNCLASSIFIED_SWIMLANE_ID = -1;

/**
 * Raw i18n key for the synthetic swimlane's name. Kept UNTRANSLATED here — the
 * hook / Swimlane component translates it for display (this module performs no
 * i18n).
 */
export const UNCLASSIFIED_SWIMLANE_NAME = "KANBAN.UNCLASSIFIED_USER_STORIES";

/* -------------------------------------------------------------------------- */
/* Internal helpers (module-private).                                         */
/* -------------------------------------------------------------------------- */

/**
 * Sort key for `order`. Unseen ids sort LAST, exactly mirroring the legacy
 * `_.sortBy` behaviour where an `undefined` order value goes to the end.
 *
 * `order[id]` is typed `number` by the `OrderMap` index signature, but a lookup
 * for a missing id is genuinely `undefined` at runtime, so we read it as
 * `number | undefined` (honest null handling under TS `strict`).
 */
const orderOf = (order: OrderMap, id: number): number => {
    const value = order[id] as number | undefined;
    return value === undefined ? Number.POSITIVE_INFINITY : value;
};

/**
 * Rebuild `order` from the raw `kanban_order` of every story (legacy
 * `refreshRawOrder`). A freshly-created story may have no `kanban_order`; the
 * legacy service stored `undefined` for it, and {@link orderOf} compensates by
 * treating that as `+Infinity`, so we faithfully reproduce that assignment.
 */
function applyRefreshRawOrder(draft: Draft<KanbanState>): void {
    draft.order = {};
    for (const it of draft.userstoriesRaw) {
        // `kanban_order` may be undefined; mirror legacy `@.order[it.id] = it.kanban_order`.
        draft.order[it.id] = it.kanban_order as number;
    }
}

/**
 * Legacy `refresh`: sort `userstoriesRaw` by `order`, rebuild the
 * `String(statusId) -> usId[]` projection, optionally refresh `usMap`, and
 * optionally cascade into {@link applyRefreshSwimlanes}.
 */
function applyRefresh(
    draft: Draft<KanbanState>,
    refreshUsMap = true,
    doSwimlanes = true,
): void {
    // Array.prototype.sort is stable in ES2019, matching lodash `_.sortBy`.
    draft.userstoriesRaw.sort(
        (a, b) => orderOf(draft.order, a.id) - orderOf(draft.order, b.id),
    );

    const collection: Record<string, number[]> = {};
    for (const usModel of draft.userstoriesRaw) {
        const status = String(usModel.status);
        if (!collection[status]) {
            collection[status] = [];
        }
        collection[status] = collection[status].filter((id) => id !== usModel.id);
        collection[status].push(usModel.id);

        if (refreshUsMap) {
            draft.usMap[usModel.id] = usModel;
        }
    }
    draft.usByStatus = collection;

    if (doSwimlanes) {
        applyRefreshSwimlanes(draft);
    }
}

/**
 * Legacy `refreshSwimlanes`: build the ordered `swimlanesList` (prepending the
 * synthetic unclassified swimlane when any story has no swimlane) and the
 * `usByStatusSwimlanes` buckets keyed by `String(swimlaneId)` ->
 * `String(statusId)` -> `usId[]`.
 */
function applyRefreshSwimlanes(draft: Draft<KanbanState>): void {
    if (!draft.swimlanes || !draft.swimlanes.length) {
        return;
    }

    // Configured swimlanes, de-duplicated by id defensively.
    const list: Swimlane[] = [];
    for (const swimlane of draft.swimlanes) {
        if (!list.some((existing) => existing.id === swimlane.id)) {
            list.push(swimlane);
        }
    }

    // Loose `== null` matches both null and undefined, mirroring the legacy
    // `us.swimlane == null` "no swimlane" test.
    const noSwimlane = draft.userstoriesRaw.filter((us) => us.swimlane == null);
    if (noSwimlane.length) {
        list.unshift({
            id: UNCLASSIFIED_SWIMLANE_ID,
            kanban_order: 1,
            name: UNCLASSIFIED_SWIMLANE_NAME,
        });
    }
    draft.swimlanesList = list;

    const out: Record<string, Record<string, number[]>> = {};
    for (const sw of list) {
        const inner: Record<string, number[]> = {};
        const filteredSwimlaneId =
            sw.id === UNCLASSIFIED_SWIMLANE_ID ? null : sw.id;
        for (const statusId of Object.keys(draft.usByStatus)) {
            inner[statusId] = draft.usByStatus[statusId].filter((usId) => {
                const us = draft.usMap[usId];
                return !!us && us.swimlane === filteredSwimlaneId;
            });
        }
        out[String(sw.id)] = inner;
    }
    draft.usByStatusSwimlanes = out;
}

/* -------------------------------------------------------------------------- */
/* Exported pure producers.                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Fresh, fully-empty state (the legacy `reset(true, true, true)` shape).
 */
export function createInitialKanbanState(): KanbanState {
    return {
        userstoriesRaw: [],
        swimlanes: [],
        foldStatusChanged: {},
        usByStatus: {},
        usMap: {},
        usByStatusSwimlanes: {},
        statusHide: [],
        archivedStatus: [],
        swimlanesList: [],
        order: {},
    };
}

/**
 * Legacy `reset(resetSwimlanesList, resetArchivedStatus, resetHideStatud)`.
 * Always clears the six core collections; conditionally clears the hidden,
 * archived, and swimlane-list caches. Faithful to legacy, `order` is NOT reset.
 */
export function reset(
    state: KanbanState,
    {
        resetSwimlanesList = true,
        resetArchivedStatus = true,
        resetStatusHide = true,
    }: {
        resetSwimlanesList?: boolean;
        resetArchivedStatus?: boolean;
        resetStatusHide?: boolean;
    } = {},
): KanbanState {
    return produce(state, (draft) => {
        draft.userstoriesRaw = [];
        draft.swimlanes = [];
        draft.foldStatusChanged = {};
        draft.usByStatus = {};
        draft.usMap = {};
        draft.usByStatusSwimlanes = {};

        if (resetStatusHide) {
            draft.statusHide = [];
        }
        if (resetArchivedStatus) {
            draft.archivedStatus = [];
        }
        if (resetSwimlanesList) {
            draft.swimlanesList = [];
        }
    });
}

/**
 * Store the configured swimlanes needed by {@link applyRefreshSwimlanes}.
 * Legacy `init(project, swimlanes, usersById)` also kept `project` and
 * `usersById`, but those are presentation concerns and are intentionally
 * omitted from this pure state module.
 */
export function init(state: KanbanState, swimlanes: Swimlane[]): KanbanState {
    return produce(state, (draft) => {
        draft.swimlanes = swimlanes;
    });
}

/**
 * Replace the full story list and rebuild every projection (legacy `set`).
 */
export function set(state: KanbanState, userstories: UserStory[]): KanbanState {
    return produce(state, (draft) => {
        draft.userstoriesRaw = userstories;
        applyRefreshRawOrder(draft);
        applyRefresh(draft, true, true);
    });
}

/**
 * Merge new order values over the working `order` map and refresh projections
 * WITHOUT rebuilding `usMap` (legacy `assignOrders` -> `refresh(false)`).
 */
export function assignOrders(state: KanbanState, newOrder: OrderMap): KanbanState {
    return produce(state, (draft) => {
        draft.order = { ...draft.order, ...newOrder };
        applyRefresh(draft, false, true);
    });
}

/**
 * Add one or many stories WITHOUT a full refresh — legacy `add` deliberately
 * avoids resetting the order/scroll of existing stories. New stories are sorted
 * by `kanban_order`, de-duplicated against the existing list, appended, and only
 * genuinely-new ids are inserted into `usByStatus` / `usMap`.
 */
export function add(state: KanbanState, usList: UserStory | UserStory[]): KanbanState {
    const items = Array.isArray(usList) ? usList : [usList];
    const sorted = [...items].sort(
        (a, b) => (a.kanban_order ?? 0) - (b.kanban_order ?? 0),
    );

    return produce(state, (draft) => {
        draft.userstoriesRaw = draft.userstoriesRaw.filter(
            (us) => !sorted.find((it) => it.id === us.id),
        );
        draft.userstoriesRaw = draft.userstoriesRaw.concat(sorted);

        applyRefreshRawOrder(draft);

        draft.userstoriesRaw.sort(
            (a, b) => orderOf(draft.order, a.id) - orderOf(draft.order, b.id),
        );

        for (const usModel of sorted) {
            const status = String(usModel.status);
            if (!draft.usByStatus[status]) {
                draft.usByStatus[status] = [];
            }
            if (!draft.usMap[usModel.id]) {
                draft.usMap[usModel.id] = usModel;
                draft.usByStatus[status] = draft.usByStatus[status].filter(
                    (id) => id !== usModel.id,
                );
                draft.usByStatus[status].push(usModel.id);
            }
        }

        applyRefreshSwimlanes(draft);
    });
}

/**
 * Remove a story by id from every projection (legacy `remove`). Only needs the
 * `id` and `status` of the story, so it accepts a narrowed shape.
 */
export function remove(
    state: KanbanState,
    usModel: Pick<UserStory, "id" | "status">,
): KanbanState {
    return produce(state, (draft) => {
        draft.userstoriesRaw = draft.userstoriesRaw.filter((it) => it.id !== usModel.id);
        delete draft.order[usModel.id];
        delete draft.usMap[usModel.id];

        const status = String(usModel.status);
        if (draft.usByStatus[status]) {
            draft.usByStatus[status] = draft.usByStatus[status].filter(
                (id) => id !== usModel.id,
            );
        }

        applyRefreshSwimlanes(draft);
    });
}

/**
 * Replace a story model in `userstoriesRaw` (matched by id) and in `usMap`
 * (legacy `replaceModel`).
 */
export function replaceModel(state: KanbanState, usModel: UserStory): KanbanState {
    return produce(state, (draft) => {
        draft.userstoriesRaw = draft.userstoriesRaw.map((it) =>
            it.id === usModel.id ? usModel : it,
        );
        draft.usMap[usModel.id] = usModel;
    });
}

/**
 * Replace only the `usMap` entry for a story (legacy `replace`).
 */
export function replace(state: KanbanState, us: UserStory): KanbanState {
    return produce(state, (draft) => {
        draft.usMap[us.id] = us;
    });
}

/**
 * Move one or more stories to a status / swimlane at a drop position — the
 * single most important producer, mirroring `KanbanUserstoriesService.move`.
 *
 * The state mutation happens inside the immer producer; the {@link
 * KanbanMoveResult} is built OUTSIDE it from the raw arguments so that the
 * result shape is exactly the five camelCase keys the API client expects.
 *
 * @param usList      ids of the stories being moved, in drop order.
 * @param statusId    destination status (column).
 * @param swimlaneId  destination swimlane, or `null` for unclassified.
 * @param index       drop index within the column (part of the DnD contract;
 *                    the ordering is derived from `previousCard` as in legacy).
 * @param previousCard id of the card immediately BEFORE the drop, or `null`.
 * @param nextCard     id of the card immediately AFTER the drop, or `null`.
 */
export function move(
    state: KanbanState,
    usList: number[],
    statusId: number,
    swimlaneId: number | null,
    index: number,
    previousCard: number | null,
    nextCard: number | null,
): { state: KanbanState; result: KanbanMoveResult } {
    // `index` is part of the documented DnD contract; the destination ordering
    // is derived from `previousCard`, exactly as the legacy service did.
    void index;

    const next = produce(state, (draft) => {
        // Stories currently in the destination status (and swimlane, when the
        // swimlane is a real one), sorted by working order.
        let usByStatus = draft.userstoriesRaw.filter(
            (it) => it.status === statusId && (!swimlaneId || it.swimlane === swimlaneId),
        );
        usByStatus = [...usByStatus].sort(
            (a, b) => orderOf(draft.order, a.id) - orderOf(draft.order, b.id),
        );

        let previousUsOrder: number;
        let previousUsIndex: number;
        if (previousCard) {
            previousUsOrder = draft.order[previousCard] + 1;
            previousUsIndex =
                usByStatus.findIndex((it) => it.id === previousCard) + 1;
        } else {
            previousUsOrder = 0;
            previousUsIndex = 0;
        }

        const usByStatusWithoutMoved = usByStatus.filter(
            (listIt) => !usList.find((movedId) => listIt.id === movedId),
        );

        const afterDestination = usByStatusWithoutMoved.slice(previousUsIndex);
        const initialLength = usList.length + 1;

        // Push the stories that come after the drop position further down.
        afterDestination.forEach((usModel, key) => {
            draft.order[usModel.id] = previousUsOrder + initialLength + key;
        });

        // Re-home each moved story and assign its new contiguous order.
        usList.forEach((usId, key) => {
            const usModel = draft.userstoriesRaw.find((us) => us.id === usId);
            if (usModel) {
                usModel.status = statusId;
                usModel.swimlane = swimlaneId;
                draft.order[usModel.id] = previousUsOrder + key;
                draft.usMap[usModel.id] = usModel;
            }
        });

        // refreshUsMap = false — matches legacy `@refresh(false)`.
        applyRefresh(draft, false, true);
    });

    const result: KanbanMoveResult = {
        statusId,
        swimlaneId,
        afterUserstoryId: previousCard,
        beforeUserstoryId: nextCard,
        bulkUserstories: usList,
    };

    return { state: next, result };
}

/**
 * Move a single story to the very end of a status by assigning order `-1`
 * (legacy `moveToEnd`). Returns the `{ us_id, order }` payload the legacy
 * service returned for the single-story reorder endpoint.
 */
export function moveToEnd(
    state: KanbanState,
    id: number,
    statusId: number,
): { state: KanbanState; result: { us_id: number; order: number } } {
    const next = produce(state, (draft) => {
        draft.order[id] = -1;

        const model = draft.userstoriesRaw.find((it) => it.id === id);
        if (model) {
            model.status = statusId;
            model.kanban_order = -1;
        }

        applyRefresh(draft, false, true);
    });

    return { state: next, result: { us_id: id, order: -1 } };
}

/**
 * Flip the fold flag for a story (legacy `toggleFold`). Fold is a separate
 * presentation flag; the legacy service also re-rendered the story via
 * `refreshUserStory`, but here the boolean flip is the whole job — the Card
 * component reads `foldStatusChanged` and re-renders itself.
 */
export function toggleFold(state: KanbanState, usId: number): KanbanState {
    return produce(state, (draft) => {
        draft.foldStatusChanged[usId] = !draft.foldStatusChanged[usId];
    });
}

/**
 * Clear every fold flag (legacy `resetFolds`).
 */
export function resetFolds(state: KanbanState): KanbanState {
    return produce(state, (draft) => {
        draft.foldStatusChanged = {};
    });
}

/**
 * Record a status id as archived (legacy `addArchivedStatus`).
 */
export function addArchivedStatus(state: KanbanState, statusId: number): KanbanState {
    return produce(state, (draft) => {
        draft.archivedStatus.push(statusId);
    });
}

/**
 * Hide a status: first drop its column from `usByStatus` (legacy `deleteStatus`),
 * then record it as hidden (legacy `hideStatus`).
 */
export function hideStatus(state: KanbanState, statusId: number): KanbanState {
    return produce(state, (draft) => {
        if (draft.usByStatus[String(statusId)]) {
            delete draft.usByStatus[String(statusId)];
        }
        draft.statusHide.push(statusId);
    });
}

/**
 * Un-hide a status (legacy `showStatus`).
 */
export function showStatus(state: KanbanState, statusId: number): KanbanState {
    return produce(state, (draft) => {
        draft.statusHide = draft.statusHide.filter((it) => it !== statusId);
    });
}

/* -------------------------------------------------------------------------- */
/* Selectors (read-only, NOT producers).                                      */
/* -------------------------------------------------------------------------- */

/**
 * Look up the raw story stored in `usMap` (legacy `getUs`).
 */
export function getUs(state: KanbanState, id: number): UserStory | undefined {
    return state.usMap[id];
}

/**
 * Look up the story model in the flat list (legacy `getUsModel`).
 */
export function getUsModel(state: KanbanState, id: number): UserStory | undefined {
    return state.userstoriesRaw.find((it) => it.id === id);
}

/**
 * True only when the story's status is BOTH archived AND hidden — the exact
 * `&&` condition of the legacy `isUsInArchivedHiddenStatus`.
 */
export function isUsInArchivedHiddenStatus(state: KanbanState, usId: number): boolean {
    const us = state.usMap[usId];
    if (!us) {
        return false;
    }
    const status = us.status;
    return (
        state.archivedStatus.indexOf(status) !== -1 &&
        state.statusHide.indexOf(status) !== -1
    );
}
