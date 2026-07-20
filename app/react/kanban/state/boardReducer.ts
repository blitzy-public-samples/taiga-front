/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// React-only reimplementation of AngularJS tgKanbanUserstories (kanban-usertories.coffee). immer replaces Immutable.js inside React ONLY.

/**
 * boardReducer.ts — pure, immer-driven state machine for the React 18 Kanban
 * board.
 *
 * This module is a FAITHFUL BEHAVIOURAL PORT of the legacy AngularJS
 * `KanbanUserstoriesService` (`tgKanbanUserstories`,
 * `app/coffee/modules/kanban/kanban-usertories.coffee`, lines 1-319). Every
 * transition below preserves the source names and semantics exactly; the
 * source file is cited inline (e.g. `SOURCE 150-190`) next to each port.
 *
 * The one deliberate technology swap is immutability: the legacy service built
 * its board indexes with Immutable.js (`Immutable.Map` / `Immutable.List` /
 * `Immutable.fromJS`). Here the same indexes are plain JavaScript
 * (`Record<...>` / `[]`) and every transition is produced with immer's
 * `produce(state, draft => { ... })`. That swap is confined to `app/react/**`;
 * the AngularJS service (and the globally-installed Immutable.js it uses)
 * remain on disk untouched for the out-of-scope screens, and are NEVER imported
 * from here.
 *
 * Design invariants (see the file's agent prompt / AAP §0.3.3):
 *  - PURE: no `window`, `localStorage`, `fetch`, `document`, timers, URLs, or
 *    network access. All data arrives through action payloads; the reducer only
 *    computes the next state.
 *  - immer ONLY for immutability. No Immutable.js, dragula, dom-autoscroller,
 *    checksley, jQuery, angular, or lodash. No `Map`/`Set` state (so immer's
 *    `enableMapSet` is unnecessary).
 *  - Domain shapes come exclusively from the shared types module, which mirrors
 *    the unchanged Django `/api/v1/` payloads and the derived per-card view
 *    model the legacy service produced.
 *
 * The state shapes produced here (`usByStatus`, `usByStatusSwimlanes`, `usMap`,
 * `swimlanesList`) match what the sibling hook (`./useKanbanBoard`),
 * container (`../KanbanApp`), drag-and-drop context (`../dnd/KanbanDndContext`),
 * presentational components (`../components/**`), and unit specs
 * (`../__tests__/**`) consume.
 */

import { produce } from 'immer';
import type {
    UserStory,
    Swimlane,
    Project,
    BoardCard,
    AssignedUser,
    ColorizedTag,
    UsByStatus, // = Record<string, number[]>
    UsByStatusSwimlanes, // = Record<string, Record<string, number[]>>
    UsMap, // = Record<number, BoardCard>
} from '../../shared/types';

/* ========================================================================== *
 * Module constants
 * ========================================================================== */

/**
 * Synthetic swimlane id for the "unclassified" lane that groups stories with no
 * swimlane assignment. Mirrors the legacy `emptySwimlane.id = -1`
 * (`kanban-usertories.coffee:296`). Exported because the hook maps swimlane
 * `-1` -> `null` before dispatching a MOVE, and the components key the
 * unclassified lane on this value.
 */
export const UNCLASSIFIED_SWIMLANE_ID = -1;

/**
 * The rendered label for the unclassified swimlane.
 *
 * Source: `kanban-usertories.coffee:298` used
 * `@translate.instant("KANBAN.UNCLASSIFIED_USER_STORIES")`. There is NO i18n
 * bridge in `app/react/shared`, so the resolved English label is inlined
 * verbatim from `app/locales/taiga/locale-en.json`
 * (`KANBAN.UNCLASSIFIED_USER_STORIES`).
 */
const UNCLASSIFIED_USER_STORIES_LABEL = 'Unclassified user stories';

/* ========================================================================== *
 * State shape
 * ========================================================================== */

/**
 * The complete Kanban board state. Mirrors the instance fields of
 * `KanbanUserstoriesService` (`kanban-usertories.coffee:20-39`). All fields are
 * plain JS objects/arrays managed by immer — no Immutable.js structures.
 */
export type State = {
    /** Raw, source-of-truth list of user stories currently on the board. */
    userstoriesRaw: UserStory[];
    /** Configured swimlanes provided at INIT (source: `@.swimlanes`). */
    swimlanes: Swimlane[];
    /** Per-us fold toggle keyed by us id (source: `@.foldStatusChanged`). */
    foldStatusChanged: Record<number, boolean>;
    /** Status id (string key) -> ordered list of us ids (source: `@.usByStatus`). */
    usByStatus: UsByStatus;
    /** Us id -> derived board card (source: `@.usMap`). */
    usMap: UsMap;
    /**
     * Swimlane id (string key, `"-1"` for unclassified) -> { status id (string
     * key) -> us ids } (source: `@.usByStatusSwimlanes`).
     */
    usByStatusSwimlanes: UsByStatusSwimlanes;
    /**
     * Ordered swimlanes actually rendered; may include the synthetic
     * unclassified lane at index 0 (source: `@.swimlanesList`).
     */
    swimlanesList: Swimlane[];
    /** Hidden archived-status columns (source: `@.statusHide`). */
    statusHide: number[];
    /** Archived statuses that have been opened (source: `@.archivedStatus`). */
    archivedStatus: number[];
    /** Us id -> kanban_order snapshot used by the move math (source: `@.order`). */
    order: Record<number, number>;
    /** Owning project; set by INIT, read by `retrieveUserStoryData` provenance. */
    project: Project | null;
    /** Member id -> resolved member; set by INIT (source: `@.usersById`). */
    usersById: Record<number, AssignedUser>;
};

/**
 * Build a fresh, empty {@link State}. A new object is returned on every call so
 * no mutable module-level state is ever shared between boards.
 *
 * Mirrors the field initialisation performed by the legacy `reset()`
 * (`kanban-usertories.coffee:19-34`) combined with the fields the constructor
 * left implicit (`order`, `project`, `usersById`).
 */
export function initialState(): State {
    return {
        userstoriesRaw: [],
        swimlanes: [],
        foldStatusChanged: {},
        usByStatus: {},
        usMap: {},
        usByStatusSwimlanes: {},
        swimlanesList: [],
        statusHide: [],
        archivedStatus: [],
        order: {},
        project: null,
        usersById: {},
    };
}

/* ========================================================================== *
 * Internal pure helpers
 *
 * Each helper takes a `State` and mutates it in place. At the call sites these
 * receive an immer draft; because `State` declares no `readonly` members, an
 * immer `Draft<State>` is structurally assignable to `State`, so the helpers
 * read/write the draft directly. They are NOT exported (except where a selector
 * wraps one) — consumers dispatch actions or call the exported selectors.
 * ========================================================================== */

/**
 * Build the derived {@link BoardCard} view model for a user story.
 *
 * SOURCE 228-252. In AngularJS `usModel` was an Immutable model and
 * `model = usModel.getAttrs()`; here `usModel` is already a plain `UserStory`,
 * so `model` is the story itself. `assigned_to` / `assigned_users` are resolved
 * from `usersById`; `images` keeps only attachments that have a card thumbnail;
 * `colorized_tags` flattens each `[name, color]` tuple to an object.
 */
function retrieveUserStoryData(draft: State, usModel: UserStory): BoardCard {
    // SOURCE 240-246: resolve each assigned member id, keeping only truthy hits.
    const assigned_users = (usModel.assigned_users || [])
        .map((id) => draft.usersById[id])
        .filter(Boolean) as AssignedUser[];

    return {
        id: usModel.id, // SOURCE 237
        model: usModel, // SOURCE 234 (plain UserStory, not an Immutable model)
        swimlane: usModel.swimlane ?? null, // SOURCE 238
        foldStatusChanged: draft.foldStatusChanged[usModel.id], // SOURCE 232
        // SOURCE 235: only attachments with a card thumbnail are shown.
        images: (usModel.attachments || []).filter((a) => !!a.thumbnail_card_url),
        // SOURCE 239: `@.usersById[assigned_to]`; guard the null/absent case.
        assigned_to:
            usModel.assigned_to == null
                ? null
                : draft.usersById[usModel.assigned_to] ?? null,
        assigned_users,
        assigned_users_preview: assigned_users.slice(0, 3), // SOURCE 247
        // SOURCE 249-250: map each `[name, color]` tuple to a ColorizedTag.
        colorized_tags: (usModel.tags || []).map(
            (t): ColorizedTag => ({ name: t[0], color: t[1] }),
        ),
    };
}

/**
 * Find the raw user-story model by id. SOURCE 220-221 (`getUsModel`).
 */
function getUsModel(draft: State, id: number): UserStory | undefined {
    return draft.userstoriesRaw.find((us) => us.id === id);
}

/**
 * Recompute a single card in `usMap` from its raw model. SOURCE 223-226
 * (`refreshUserStory`). A no-op when the story is no longer on the board.
 */
function refreshUserStory(draft: State, usId: number): void {
    const m = getUsModel(draft, usId);
    if (m) {
        draft.usMap[usId] = retrieveUserStoryData(draft, m);
    }
}

/**
 * Rebuild the `order` snapshot (us id -> kanban_order) from the raw list.
 * SOURCE 140-143 (`refreshRawOrder`).
 */
function refreshRawOrder(draft: State): void {
    draft.order = {};
    for (const us of draft.userstoriesRaw) {
        draft.order[us.id] = us.kanban_order;
    }
}

/**
 * Rebuild `usByStatus` (and, optionally, `usMap`) from the raw list, sorted by
 * the current `order`. SOURCE 254-275 (`refresh`).
 *
 * @param refreshUsMap    When `true` (default) every card in `usMap` is
 *                        recomputed; MOVE passes `false` because it has already
 *                        refreshed the moved cards.
 * @param refreshSwimlanes When `true` (default) the swimlane indexes are rebuilt
 *                        afterwards.
 */
function refresh(draft: State, refreshUsMap = true, refreshSwimlanesFlag = true): void {
    // SOURCE 255: stable numeric sort by the order snapshot (matches `_.sortBy`).
    // Assign a sorted COPY rather than sorting `userstoriesRaw` in place. The
    // DnD-failure revert (Issue 3) dispatches `SET` with the immer-FROZEN
    // `userstoriesRaw` snapshot captured before the optimistic move (see
    // useKanbanBoard `move()` catch); an in-place `.sort()` on a frozen array
    // throws "Cannot assign to read only property '0'", which escapes React
    // rendering and blanks the board. `slice()` yields a fresh mutable array and
    // preserves the exact ordering for every caller (SET / MOVE / status toggles).
    draft.userstoriesRaw = draft.userstoriesRaw
        .slice()
        .sort((a, b) => draft.order[a.id] - draft.order[b.id]);

    // SOURCE 257-267: bucket us ids by status, de-duplicating before pushing.
    const collection: Record<string, number[]> = {};

    for (const usModel of draft.userstoriesRaw) {
        const statusKey = String(usModel.status);

        if (!collection[statusKey]) {
            collection[statusKey] = [];
        }

        collection[statusKey] = collection[statusKey].filter((id) => id !== usModel.id);
        collection[statusKey].push(usModel.id);

        if (refreshUsMap) {
            draft.usMap[usModel.id] = retrieveUserStoryData(draft, usModel); // SOURCE 269-270
        }
    }

    draft.usByStatus = collection; // SOURCE 272

    if (refreshSwimlanesFlag) {
        refreshSwimlanes(draft); // SOURCE 274-275
    }
}

/**
 * Rebuild `swimlanesList` and `usByStatusSwimlanes`. SOURCE 277-317.
 *
 * The legacy source computed `emptySwimlaneExists` from the just-reset (hence
 * always empty) `swimlanesList` (SOURCE 287-288), so that guard reduced to "are
 * there any stories with no swimlane?". This port reproduces that EFFECTIVE
 * behaviour: the synthetic unclassified lane is inserted at index 0 whenever at
 * least one story has `swimlane == null`.
 */
function refreshSwimlanes(draft: State): void {
    // SOURCE 278-279: swimlanes are optional; nothing to build without them.
    if (!draft.swimlanes || !draft.swimlanes.length) {
        return;
    }

    // SOURCE 281-282: reset both indexes before rebuilding.
    draft.swimlanesList = [];
    draft.usByStatusSwimlanes = {};

    // SOURCE 284-285: `== null` catches both null AND undefined.
    const userstoriesNoSwimlane = draft.userstoriesRaw.filter((us) => us.swimlane == null);

    if (userstoriesNoSwimlane.length > 0) {
        // SOURCE 291-293: push every configured swimlane (dedupe by id).
        for (const swimlane of draft.swimlanes) {
            if (!draft.swimlanesList.some((s) => s.id === swimlane.id)) {
                draft.swimlanesList.push(swimlane);
            }
        }

        // SOURCE 295-300: prepend the synthetic unclassified lane at index 0.
        // The source literal is exactly `{ id:-1, kanban_order:1, name:<label> }`;
        // `order:1` is added so the object satisfies the shared `Swimlane` type
        // (which requires `order`) and still sorts first. `kanban_order` is
        // accepted by the type's `[key: string]: unknown` index signature.
        const emptySwimlane: Swimlane = {
            id: UNCLASSIFIED_SWIMLANE_ID,
            name: UNCLASSIFIED_USER_STORIES_LABEL,
            kanban_order: 1,
            order: 1,
        };
        draft.swimlanesList.unshift(emptySwimlane);
    } else {
        // SOURCE 303-305: no unclassified stories — just the configured lanes.
        for (const swimlane of draft.swimlanes) {
            if (!draft.swimlanesList.some((s) => s.id === swimlane.id)) {
                draft.swimlanesList.push(swimlane);
            }
        }
    }

    // SOURCE 307-317: for each rendered lane, filter each status bucket to the
    // stories whose model swimlane matches that lane (`-1` -> the null lane).
    for (const swimlane of draft.swimlanesList) {
        const swimlaneUsByStatus: Record<string, number[]> = {};
        const targetSwimlaneId =
            swimlane.id === UNCLASSIFIED_SWIMLANE_ID ? null : swimlane.id;

        for (const [statusKey, usList] of Object.entries(draft.usByStatus)) {
            // SOURCE 310-313: `us.getIn(['model','swimlane']) == swimlaneId`.
            const filtered = usList.filter((usId) => {
                const card = draft.usMap[usId];
                return card ? (card.model.swimlane ?? null) === targetSwimlaneId : false;
            });
            swimlaneUsByStatus[String(statusKey)] = filtered; // SOURCE 315
        }

        // SOURCE 317: outer key is the (stringified) swimlane id, `"-1"` for the
        // unclassified lane — matching `swimlanesStatuses[-1]` on the hook side.
        draft.usByStatusSwimlanes[String(swimlane.id)] = swimlaneUsByStatus;
    }
}

/**
 * Shared predicate for {@link getStatus} and the MOVE reorder. SOURCE 130-132.
 *
 * The `!swimlaneId` bypass is preserved EXACTLY: when `swimlaneId` is `null`
 * (or `0`) the swimlane filter is skipped. MOVE relies on this for the
 * unclassified / no-swimlane case, because the hook maps swimlane `-1` -> `null`
 * before dispatching.
 */
function getStatusInternal(
    state: State,
    statusId: number,
    swimlaneId: number | null,
): UserStory[] {
    return state.userstoriesRaw.filter(
        (it) => it.status === statusId && (!swimlaneId || it.swimlane === swimlaneId),
    );
}

/**
 * Insert / update a batch of user stories on the board WITHOUT a full refresh.
 * SOURCE 78-111 (`add`). Shared by the ADD and EVENTS_LOAD actions.
 *
 * The incoming batch is sorted by `kanban_order`, merged into the raw list
 * (replacing any same-id entries), re-ordered, and only GENUINELY-NEW ids get a
 * `usMap` card and a `usByStatus` slot (guard `!draft.usMap[id]`). It finishes
 * with `refreshSwimlanes` ONLY — never a full `refresh` — matching the source's
 * comment "don't call refresh to prevent unnecessary mutations in every single
 * us" (SOURCE 77).
 */
function addInternal(draft: State, usList: UserStory[]): void {
    // SOURCE 82: sort the incoming batch by kanban_order ascending.
    const sorted = usList.slice().sort((a, b) => a.kanban_order - b.kanban_order);

    // SOURCE 84-86: drop same-id entries from raw, then append the batch.
    draft.userstoriesRaw = draft.userstoriesRaw
        .filter((us) => !sorted.some((it) => it.id === us.id))
        .concat(sorted);

    refreshRawOrder(draft); // SOURCE 90

    // SOURCE 92: re-sort raw by the freshly-computed order.
    draft.userstoriesRaw.sort((a, b) => draft.order[a.id] - draft.order[b.id]);

    // SOURCE 94-109: only add cards/slots for ids not already mapped.
    for (const usModel of sorted) {
        const statusKey = String(usModel.status);

        if (!draft.usByStatus[statusKey]) {
            draft.usByStatus[statusKey] = [];
        }

        if (!draft.usMap[usModel.id]) {
            draft.usMap[usModel.id] = retrieveUserStoryData(draft, usModel);

            draft.usByStatus[statusKey] = draft.usByStatus[statusKey].filter(
                (id) => id !== usModel.id,
            );
            draft.usByStatus[statusKey].push(usModel.id);
        }
    }

    refreshSwimlanes(draft); // SOURCE 111 (refreshSwimlanes ONLY, not full refresh)
}

/* ========================================================================== *
 * Actions
 * ========================================================================== */

/**
 * The complete set of board transitions, expressed as a discriminated union
 * keyed on `type`. Each variant maps to a method of the legacy
 * `KanbanUserstoriesService`.
 *
 * NOTE: the `RESET` flag `resetHideStatud` preserves the source's spelling
 * (`kanban-usertories.coffee:19`) verbatim for traceability.
 */
export type Action =
    | {
          type: 'RESET';
          resetSwimlanesList?: boolean;
          resetArchivedStatus?: boolean;
          resetHideStatud?: boolean;
      }
    | {
          type: 'INIT';
          project: Project;
          swimlanes: Swimlane[];
          usersById: Record<number, AssignedUser>;
      }
    | { type: 'SET'; userstories: UserStory[] }
    | { type: 'ADD'; usList: UserStory[] }
    | { type: 'REMOVE'; usModel: UserStory }
    | { type: 'REPLACE_MODEL'; usModel: UserStory }
    | { type: 'ADD_ARCHIVED_STATUS'; statusId: number }
    | { type: 'HIDE_STATUS'; statusId: number }
    | { type: 'SHOW_STATUS'; statusId: number }
    | { type: 'TOGGLE_FOLD'; usId: number }
    | { type: 'RESET_FOLDS' }
    | { type: 'REFRESH_RAW_ORDER' }
    | { type: 'REFRESH'; refreshUsMap?: boolean; refreshSwimlanes?: boolean }
    | {
          type: 'MOVE';
          usIds: number[];
          statusId: number;
          swimlaneId: number | null;
          index: number;
          previousCard: number | null;
          nextCard: number | null;
      }
    | { type: 'MOVE_TO_END'; id: number; statusId: number }
    | { type: 'EVENTS_LOAD'; userstories: UserStory[] };

/* ========================================================================== *
 * Reducer
 * ========================================================================== */

/**
 * The pure board reducer. Produces the next {@link State} for an {@link Action}
 * via a single immer `produce`; the base `state` is never mutated.
 */
export function reducer(state: State, action: Action): State {
    return produce(state, (draft) => {
        switch (action.type) {
            case 'RESET': {
                // SOURCE 19-34.
                const {
                    resetSwimlanesList = true,
                    resetArchivedStatus = true,
                    resetHideStatud = true,
                } = action;

                draft.userstoriesRaw = [];
                draft.swimlanes = [];
                draft.foldStatusChanged = {};
                draft.usByStatus = {};
                draft.usMap = {};
                draft.usByStatusSwimlanes = {};

                if (resetHideStatud) {
                    draft.statusHide = [];
                }
                if (resetArchivedStatus) {
                    draft.archivedStatus = [];
                }
                if (resetSwimlanesList) {
                    draft.swimlanesList = [];
                }
                // NOTE: `order`/`project`/`usersById` are intentionally NOT reset
                // here — matches the source `reset()`.
                break;
            }

            case 'INIT': {
                // SOURCE 36-39.
                draft.project = action.project;
                draft.swimlanes = action.swimlanes;
                draft.usersById = action.usersById;
                break;
            }

            case 'SET': {
                // SOURCE 48-51.
                draft.userstoriesRaw = action.userstories;
                refreshRawOrder(draft);
                refresh(draft);
                break;
            }

            case 'ADD': {
                // SOURCE 78-111 (see addInternal).
                addInternal(draft, action.usList);
                break;
            }

            case 'REMOVE': {
                // SOURCE 60-75.
                const { usModel } = action;
                draft.userstoriesRaw = draft.userstoriesRaw.filter(
                    (it) => it.id !== usModel.id,
                );

                delete draft.order[usModel.id];
                delete draft.usMap[usModel.id];

                const statusKey = String(usModel.status);
                if (draft.usByStatus[statusKey]) {
                    draft.usByStatus[statusKey] = draft.usByStatus[statusKey].filter(
                        (id) => id !== usModel.id,
                    );
                }

                refreshSwimlanes(draft);
                break;
            }

            case 'REPLACE_MODEL': {
                // SOURCE 207-215.
                const { usModel } = action;
                draft.userstoriesRaw = draft.userstoriesRaw.map((u) =>
                    u.id === usModel.id ? usModel : u,
                );
                draft.usMap[usModel.id] = retrieveUserStoryData(draft, usModel);
                break;
            }

            case 'ADD_ARCHIVED_STATUS': {
                // SOURCE 113-114.
                draft.archivedStatus.push(action.statusId);
                break;
            }

            case 'HIDE_STATUS': {
                // SOURCE 123-125. `deleteStatus` in the source is dead code
                // (it mutates a non-existent `@.archived`), so only the
                // observable `statusHide.push` effect is reproduced.
                draft.statusHide.push(action.statusId);
                break;
            }

            case 'SHOW_STATUS': {
                // SOURCE 127-128.
                draft.statusHide = draft.statusHide.filter((it) => it !== action.statusId);
                break;
            }

            case 'TOGGLE_FOLD': {
                // SOURCE 44-46.
                draft.foldStatusChanged[action.usId] = !draft.foldStatusChanged[action.usId];
                refreshUserStory(draft, action.usId);
                break;
            }

            case 'RESET_FOLDS': {
                // SOURCE 41-42.
                draft.foldStatusChanged = {};
                break;
            }

            case 'REFRESH_RAW_ORDER': {
                // SOURCE 140-143.
                refreshRawOrder(draft);
                break;
            }

            case 'REFRESH': {
                // SOURCE 254-275.
                refresh(draft, action.refreshUsMap ?? true, action.refreshSwimlanes ?? true);
                break;
            }

            case 'MOVE': {
                // SOURCE 150-190 — the core drag-and-drop reorder. The move math
                // is reproduced EXACTLY; only the Immutable.js writes become immer
                // mutations. The wire payload is produced separately by
                // `getMovePayload` (a reducer only returns state).
                const { usIds, statusId, previousCard } = action;

                // F-AAP-09 (data integrity): defensively coerce a NaN swimlane to
                // `null` at the state boundary. The primary normalization happens
                // upstream (the DnD boundary reads a missing `data-swimlane` as
                // `null`, and the hook maps `-1`/NaN to `null`), but the reducer is
                // the LAST gate before `usModel.swimlane` is written below — it must
                // never persist NaN into a card's model, which would corrupt
                // swimlane grouping (`getUsByStatusInternal`'s `it.swimlane ===
                // swimlaneId` can never match NaN) and serialize as an invalid
                // wire value. A real id (including `-1`) or `null` passes through.
                const swimlaneId =
                    typeof action.swimlaneId === 'number' && Number.isNaN(action.swimlaneId)
                        ? null
                        : action.swimlaneId;

                // SOURCE 151-152: stories in the destination status/lane, sorted
                // by order (operate on a copy — do not disturb raw here).
                const usByStatus = getStatusInternal(draft, statusId, swimlaneId);
                const sorted = usByStatus
                    .slice()
                    .sort((a, b) => draft.order[a.id] - draft.order[b.id]);

                // SOURCE 154-159: anchor order/index just after the previous card.
                let previousUsOrder: number;
                let previousUsIndex: number;
                if (previousCard != null) {
                    previousUsOrder = draft.order[previousCard] + 1;
                    previousUsIndex =
                        sorted.findIndex((it) => it.id === previousCard) + 1;
                } else {
                    previousUsOrder = 0;
                    previousUsIndex = 0;
                }

                // SOURCE 161-162: destination list without the moved stories.
                const withoutMoved = sorted.filter(
                    (listIt) => !usIds.some((moveId) => listIt.id === moveId),
                );

                // SOURCE 164: the stories that sit after the insertion point.
                const afterDestination = withoutMoved.slice(previousUsIndex);

                // SOURCE 166: reserve room for the moved block plus one.
                const initialLength = usIds.length + 1;

                // SOURCE 168-169: shift everything after the insertion point down.
                afterDestination.forEach((usModel, key) => {
                    draft.order[usModel.id] = previousUsOrder + initialLength + key;
                });

                // SOURCE 171-181: apply the new status/swimlane/order to each moved
                // story and refresh its card.
                usIds.forEach((usId, key) => {
                    const usModel = getUsModel(draft, usId);
                    if (!usModel) {
                        return;
                    }
                    usModel.status = statusId;
                    usModel.swimlane = swimlaneId;
                    draft.order[usModel.id] = previousUsOrder + key;
                    draft.usMap[usModel.id] = retrieveUserStoryData(draft, usModel);
                });

                // SOURCE 182: refresh without recomputing every card again.
                refresh(draft, false);
                break;
            }

            case 'MOVE_TO_END': {
                // SOURCE 192-202.
                const us = getUsModel(draft, action.id);
                if (us) {
                    draft.order[us.id] = -1;
                    us.status = action.statusId;
                    us.kanban_order = -1;
                }
                refresh(draft, false);
                break;
            }

            case 'EVENTS_LOAD': {
                // Mirrors `eventsLoadUserstories` (main.coffee:438-462) minus the
                // fetch: the hook fetches, then dispatches with the fresh list.
                const { userstories } = action;

                const modified = userstories.filter((us) =>
                    draft.userstoriesRaw.some((raw) => raw.id === us.id),
                );
                const newUss = userstories.filter(
                    (us) => !draft.userstoriesRaw.some((raw) => raw.id === us.id),
                );

                // Replace each already-present story in place; the source calls
                // refreshRawOrder INSIDE the loop, so it is kept inside.
                for (const m of modified) {
                    draft.userstoriesRaw = draft.userstoriesRaw.map((u) =>
                        u.id === m.id ? m : u,
                    );
                    draft.usMap[m.id] = retrieveUserStoryData(draft, m);
                    refreshRawOrder(draft);
                }

                if (newUss.length) {
                    addInternal(draft, newUss);
                }

                refresh(draft, false);
                break;
            }

            default: {
                // Exhaustiveness guard: if a new Action variant is added without a
                // matching case, this assignment fails to compile.
                const _exhaustive: never = action;
                void _exhaustive;
            }
        }
    });
}

/* ========================================================================== *
 * Exported pure selectors / payload helpers
 * ========================================================================== */

/**
 * Stories in a given status and (optional) swimlane. SOURCE 130-132.
 *
 * Preserves the `!swimlaneId` bypass: a `null`/`0` swimlane skips the swimlane
 * filter entirely (see {@link getStatusInternal}).
 */
export function getStatus(
    state: State,
    statusId: number,
    swimlaneId: number | null,
): UserStory[] {
    return getStatusInternal(state, statusId, swimlaneId);
}

/**
 * Whether a story sits in a status that is BOTH archived and currently hidden.
 * SOURCE 116-121 (`isUsInArchivedHiddenStatus`).
 */
export function isUsInArchivedHiddenStatus(state: State, usId: number): boolean {
    const card = state.usMap[usId];
    const status = card ? card.model.status : undefined;
    return (
        status !== undefined &&
        state.archivedStatus.indexOf(status) !== -1 &&
        state.statusHide.indexOf(status) !== -1
    );
}

/**
 * The `/userstories/bulk_update_kanban_order` request payload, echoing the
 * object the legacy `move` returned (SOURCE 184-190).
 *
 * WIRE-FORMAT: `bulkUserstories` is a plain array of user-story ids
 * (`number[]`) — the byte-for-byte kanban contract (main.coffee:609-625 forwards
 * `data.bulkUserstories = usIds`; resources/userstories.coffee:112-129 posts the
 * array as-is). It is NOT converted to `{us_id, order}` objects for kanban.
 */
export type MovePayload = {
    statusId: number;
    swimlaneId: number | null;
    afterUserstoryId: number | null;
    beforeUserstoryId: number | null;
    bulkUserstories: number[];
};

/**
 * Build the {@link MovePayload} for a drag-and-drop move. Pure echo of the
 * arguments (SOURCE 184-190); the state mutation is performed by the MOVE
 * action, this only shapes the request body.
 */
export function getMovePayload(
    usIds: number[],
    statusId: number,
    swimlaneId: number | null,
    previousCard: number | null,
    nextCard: number | null,
): MovePayload {
    // F-AAP-09 (data integrity): the request body must never carry NaN. A NaN
    // swimlane (missing lane in no-swimlane mode) is coerced to `null` so the
    // `/userstories/bulk_update_kanban_order` payload sends a clean
    // `number | null` — mirroring the AngularJS contract where a falsy swimlane
    // is simply omitted. A real id (including the synthetic `-1`) passes through.
    const safeSwimlaneId =
        typeof swimlaneId === 'number' && Number.isNaN(swimlaneId) ? null : swimlaneId;
    return {
        statusId,
        swimlaneId: safeSwimlaneId,
        afterUserstoryId: previousCard,
        beforeUserstoryId: nextCard,
        bulkUserstories: usIds,
    };
}

/**
 * The `/userstories/bulk_update_kanban_order` payload for "move to end".
 * SOURCE 202 (`{"us_id": us.id, "order": -1}`).
 */
export function getMoveToEndPayload(id: number): { us_id: number; order: number } {
    return { us_id: id, order: -1 };
}

