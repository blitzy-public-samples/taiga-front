/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * kanbanReducer
 * -------------
 * immer-based board-state reducer for the React Kanban screen.
 *
 * This module reproduces the behaviour of the AngularJS 1.5.10
 * `KanbanUserstoriesService`
 * (app/coffee/modules/kanban/kanban-usertories.coffee) as part of the
 * AngularJS -> React 18 coexistence migration. The legacy service stored the
 * board in Immutable.js collections (`Immutable.Map` / `Immutable.List`); here
 * those persistent collections are REPLACED by plain TypeScript objects and
 * arrays that are updated immutably with immer's `produce()`. immer
 * auto-freezes every produced state, giving us the same "never mutate in
 * place" guarantee the Immutable.js collections previously provided, without
 * the Immutable.js API.
 *
 * Coexistence boundary (AAP section 0.4.2 / 0.7 - HARD RULES):
 *   - The ONLY module this file imports is the npm package `immer`. Nothing is
 *     imported from the AngularJS/CoffeeScript tree (app/coffee, app/modules,
 *     app/partials, app/styles) or the compiled `elements` bundle - the coffee
 *     service is reproduced here from its documented behaviour, never imported.
 *   - The word "Immutable" appears in this file only inside explanatory
 *     comments such as this one; there is no `immutable` dependency.
 *   - Every export is pure and deterministic: `(state, ...args) => value`.
 *     There are no side effects - no `window`, DOM, network, timers, logging or
 *     `$translate`. The synthetic "unclassified" swimlane label that the
 *     AngularJS service resolved through `$translate.instant(...)` is INJECTED
 *     via `init` / `reset` (see `DEFAULT_UNCLASSIFIED_LABEL`) so the reducer
 *     stays framework-agnostic and trivially unit-testable.
 *   - All state is plain objects/arrays (never Map/Set), so immer's
 *     `enableMapSet()` is intentionally NOT required.
 */

import { produce } from 'immer';

/* ------------------------------------------------------------------ *
 * Type definitions
 * ------------------------------------------------------------------ */

/**
 * Raw user-story payload as delivered by `/api/v1/`. In the AngularJS service
 * this was an Angular model whose `getAttrs()` returned the plain attributes;
 * in React the raw payload object IS that attributes object. Only the fields
 * the board logic actually consumes are described explicitly; the index
 * signature tolerates the rest of the (large) user-story payload.
 */
export interface UserStory {
  id: number;
  status: number;
  swimlane: number | null;
  kanban_order: number;
  assigned_to: number | null;
  assigned_users: number[];
  attachments?: Array<{ thumbnail_card_url?: string | null; [k: string]: unknown }>;
  tags?: Array<[string, string | null]>; // [name, color] tuples; color may be null
  [key: string]: unknown; // tolerate the full user-story payload
}

/** Opaque user record from the `usersById` lookup. */
export interface User {
  id: number;
  [key: string]: unknown;
}

/**
 * Swimlane record from `rs.swimlanes.list`. The synthetic "unclassified"
 * swimlane injected for stories without a swimlane is
 * `{ id: -1, kanban_order: 1, name }`.
 */
export interface Swimlane {
  id: number;
  name: string;
  kanban_order: number;
  [key: string]: unknown;
}

/** A tag rendered on a card: `[name, color]` from the raw model, colorized. */
export interface ColorizedTag {
  name: string;
  color: string | null;
}

/**
 * View-model produced by `retrieveUserStoryData`. This is what `usMap` stores;
 * `.model` carries the raw user story. Reproduces every field the AngularJS
 * `retrieveUserStoryData` computed.
 */
export interface UserStoryData {
  foldStatusChanged: boolean | undefined; // foldStatusChanged[usId] (may be undefined)
  model: UserStory; // the raw user story (was usModel.getAttrs())
  images: Array<{ thumbnail_card_url?: string | null; [k: string]: unknown }>;
  id: number;
  swimlane: number | null;
  assigned_to: User | undefined; // usersById[assigned_to]
  assigned_users: User[]; // resolved via usersById (missing ids skipped)
  assigned_users_preview: User[]; // assigned_users.slice(0, 3)
  colorized_tags: ColorizedTag[]; // model.tags.map(t => ({ name: t[0], color: t[1] }))
  [key: string]: unknown; // tolerate extra flags set by consumers (e.g. loading-edit)
}

/** Opaque project record. */
export interface Project {
  id: number;
  [key: string]: unknown;
}

/**
 * Complete Kanban board state. Reproduces every field the AngularJS service
 * reset/initialised. NOTE the deliberately precise key types, which are
 * load-bearing for the components/hooks:
 *   - `usByStatus`          : STRING status key -> ordered user-story ids
 *   - `usByStatusSwimlanes` : swimlane id -> NUMBER status key -> ordered ids
 * Consumers read `usByStatus[status.toString()]` and
 * `usByStatusSwimlanes[swimlaneId][statusNumber]`.
 */
export interface KanbanState {
  userstoriesRaw: UserStory[];
  swimlanes: Swimlane[];
  swimlanesList: Swimlane[]; // render list; may include the synthetic unclassified swimlane at index 0
  usByStatus: Record<string, number[]>; // statusId (STRING key) -> ordered user-story ids (non-swimlane view)
  usMap: Record<number, UserStoryData>; // usId -> view-model
  usByStatusSwimlanes: Record<number, Record<number, number[]>>; // swimlaneId -> statusId (NUMBER key) -> ordered ids
  order: Record<number, number>; // usId -> kanban_order
  foldStatusChanged: Record<string, boolean>; // usId -> folded?
  statusHide: number[];
  archivedStatus: number[];
  project: Project | null;
  usersById: Record<number, User>;
  unclassifiedLabel: string; // injected label for the synthetic swimlane (keeps the reducer pure)
}

/**
 * Payload returned by `move`. Its shape and values must match the AngularJS
 * `move` return object (kanban-usertories.coffee:184-190) exactly, because the
 * hook forwards it straight to `bulkUpdateKanbanOrder` - it is the frozen
 * server contract. `bulkUserstories` is a `number[]` (user-story ids), never
 * an array of objects.
 */
export interface KanbanMovePayload {
  statusId: number;
  swimlaneId: number | null;
  afterUserstoryId: number | null; // = previousCard
  beforeUserstoryId: number | null; // = nextCard
  bulkUserstories: number[]; // moved user-story ids, in order
}

/**
 * `move` returns BOTH the next immutable state and the exact API payload.
 * Rationale: the AngularJS `move` mutated `this` AND returned an API payload.
 * To stay pure we return the two separately - the hook dispatches `state` and
 * forwards `payload` to the userstories API adapter.
 */
export interface KanbanMoveResult {
  state: KanbanState;
  payload: KanbanMovePayload;
}

/** Payload returned by `moveToEnd`; matches kanban-usertories.coffee:202 exactly. */
export interface KanbanMoveToEndPayload {
  us_id: number;
  order: -1;
}

/** `moveToEnd` returns both the next state and the exact API payload. */
export interface KanbanMoveToEndResult {
  state: KanbanState;
  payload: KanbanMoveToEndPayload;
}

/**
 * English fallback for the synthetic "unclassified" swimlane name. Mirrors the
 * AngularJS `KANBAN.UNCLASSIFIED_USER_STORIES` translation key. The translated
 * string is injected by the hook through `init` (or `reset`) so this pure
 * reducer never touches `$translate`.
 */
export const DEFAULT_UNCLASSIFIED_LABEL = 'Unclassified user stories';

/* ------------------------------------------------------------------ *
 * Pure helpers (no state mutation)
 * ------------------------------------------------------------------ */

/**
 * Stable ascending sort by a numeric key, reproducing lodash `_.sortBy`
 * semantics: the sort is stable (equal keys keep their original relative order,
 * guaranteed by V8's stable `Array.prototype.sort`) and `undefined` keys are
 * ordered last. Used to reproduce the several `_.sortBy` calls in the coffee
 * service (`refresh`, `add`, `move`).
 */
function stableSortByNumber<T>(list: T[], key: (item: T) => number | undefined): T[] {
  return [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
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

/**
 * Build the `UserStoryData` view-model for a raw user story. Pure function that
 * takes exactly the pieces it needs (the raw model, the fold map and the user
 * lookup) so it is trivially unit-testable. Reproduces
 * kanban-usertories.coffee:228-252. In React the raw user story IS the
 * attributes object, so there is no `getAttrs()` indirection.
 */
export function retrieveUserStoryData(
  usModel: UserStory,
  foldStatusChanged: Record<string, boolean>,
  usersById: Record<number, User>,
): UserStoryData {
  const model = usModel;

  const images = (model.attachments ?? []).filter((it) => !!it.thumbnail_card_url);

  const assignedUsers: User[] = [];
  const rawAssignedUsers = Array.isArray(usModel.assigned_users) ? usModel.assigned_users : [];
  for (const assignedUserId of rawAssignedUsers) {
    const assignedUserData = usersById[assignedUserId];
    if (assignedUserData) {
      assignedUsers.push(assignedUserData);
    }
  }

  const colorizedTags: ColorizedTag[] = (model.tags ?? []).map((tag) => ({
    name: tag[0],
    color: tag[1],
  }));

  return {
    foldStatusChanged: foldStatusChanged[usModel.id],
    model,
    images,
    id: usModel.id,
    swimlane: usModel.swimlane,
    // The coffee did `usersById[usModel.assigned_to]`; when `assigned_to` is
    // null that yields `undefined`. Guard the null case for type-safety.
    assigned_to: usModel.assigned_to != null ? usersById[usModel.assigned_to] : undefined,
    assigned_users: assignedUsers,
    assigned_users_preview: assignedUsers.slice(0, 3),
    colorized_tags: colorizedTags,
  };
}

/* ------------------------------------------------------------------ *
 * Internal draft-mutating helpers
 *
 * These operate in place on an immer draft (typed as the plain `KanbanState`;
 * immer proxies it at runtime). Public producers each wrap a single
 * `produce()` call that delegates to these helpers, so the reproduced coffee
 * logic lives in exactly one place and every branch is individually testable.
 * ------------------------------------------------------------------ */

/** Rebuild `order` from each raw story's `kanban_order`. Coffee 140-143. */
function applyRefreshRawOrder(draft: KanbanState): void {
  draft.order = {};
  for (const us of draft.userstoriesRaw) {
    draft.order[us.id] = us.kanban_order;
  }
}

/**
 * Rebuild the per-swimlane board projection. Coffee 277-317. Early-returns
 * (leaving the draft unchanged) when no swimlanes are configured.
 */
function applyRefreshSwimlanes(draft: KanbanState): void {
  if (!draft.swimlanes || !draft.swimlanes.length) {
    return;
  }

  draft.swimlanesList = [];
  draft.usByStatusSwimlanes = {};

  const userstoriesNoSwimlane = draft.userstoriesRaw.filter((us) => us.swimlane == null);

  // Push each configured swimlane once (dedup by id). The AngularJS code reset
  // `swimlanesList` immediately before this, so its "does an empty swimlane
  // already exist?" guard was always false; the net behaviour is simply: list
  // the configured swimlanes, then prepend the synthetic swimlane when needed.
  for (const swimlane of draft.swimlanes) {
    if (!draft.swimlanesList.some((existing) => existing.id === swimlane.id)) {
      draft.swimlanesList.push(swimlane);
    }
  }

  // When any story has no swimlane, insert the synthetic "unclassified"
  // swimlane at index 0. Its id (-1) maps to the API `null` swimlane.
  if (userstoriesNoSwimlane.length > 0) {
    const emptySwimlane: Swimlane = {
      id: -1,
      kanban_order: 1,
      name: draft.unclassifiedLabel,
    };
    draft.swimlanesList.unshift(emptySwimlane);
  }

  for (const swimlane of draft.swimlanesList) {
    const apiSwimlaneId = swimlane.id === -1 ? null : swimlane.id;
    const swimlaneUsByStatus: Record<number, number[]> = {};
    for (const statusStr of Object.keys(draft.usByStatus)) {
      const usIds = draft.usByStatus[statusStr];
      // NUMBER status key per coffee `Number(statusId)`.
      swimlaneUsByStatus[Number(statusStr)] = usIds.filter(
        (usId) => draft.usMap[usId]?.model.swimlane === apiSwimlaneId,
      );
    }
    draft.usByStatusSwimlanes[swimlane.id] = swimlaneUsByStatus;
  }
}

/**
 * Sort the raw stories by `order`, rebuild the STRING-keyed `usByStatus`
 * projection (dedup + append), optionally refresh `usMap`, then optionally
 * refresh the swimlane projection. Coffee 254-275.
 */
function applyRefresh(draft: KanbanState, refreshUsMap = true, refreshSwimlanesFlag = true): void {
  draft.userstoriesRaw = stableSortByNumber(draft.userstoriesRaw, (it) => draft.order[it.id]);

  const collection: Record<string, number[]> = {};
  for (const usModel of draft.userstoriesRaw) {
    // The coffee used the raw NUMBER status as the object key, which JS coerces
    // to a string - so `usByStatus` is STRING-keyed. Make that explicit.
    const status = String(usModel.status);
    if (!collection[status]) {
      collection[status] = [];
    }
    collection[status] = collection[status].filter((id) => id !== usModel.id);
    collection[status].push(usModel.id);

    if (refreshUsMap) {
      draft.usMap[usModel.id] = retrieveUserStoryData(
        usModel,
        draft.foldStatusChanged,
        draft.usersById,
      );
    }
  }

  draft.usByStatus = collection;

  if (refreshSwimlanesFlag) {
    applyRefreshSwimlanes(draft);
  }
}

/**
 * `deleteStatus` — a documented NO-OP, faithful to the legacy bug chain (F26).
 *
 * kanban-usertories.coffee:134-138 read:
 *     deleteStatus: (statusId) ->
 *         toDelete = _.filter @.userstoriesRaw, (us) -> return us.status == statusId
 *         toDelete = _.map (it) -> return it.id                # (A)
 *         @.archived = _.difference(@.archived, toDelete)      # (B)
 *
 * (A) OVERWRITES the just-computed `toDelete`: `_.map` is invoked with a
 *     FUNCTION as its `collection` and NO iteratee. Iterating a function yields
 *     nothing, so `toDelete` becomes `[]` — the `_.filter` on the line above is
 *     dead code.
 * (B) mutates `@.archived`, a field the service NEVER initializes — the
 *     constructor/reset only define `@.archivedStatus` and `@.statusHide`
 *     (kanban-usertories.coffee:28,31) — and which NOTHING in the codebase ever
 *     reads. `_.difference(undefined, [])` is `[]`, so this only ever assigns
 *     `[]` to a phantom property.
 *
 * NET EFFECT on the real board state (userstoriesRaw, usByStatus, archivedStatus,
 * statusHide): NONE. This reducer therefore reproduces the legacy behavior
 * EXACTLY, as a no-op.
 *
 * It intentionally does NOT filter `archivedStatus`: that collection holds
 * STATUS ids (addArchivedStatus pushes a statusId — coffee:113-114), NOT story
 * ids, so subtracting story ids from it could remove an unrelated status on a
 * numeric id collision — and would in any case be a behavior CHANGE the
 * AngularJS screen never performed (violating the AAP's exact-parity rule). No
 * phantom `archived` field is added to the typed state because nothing consumes
 * it. Params are prefixed `_` to mark them intentionally unused.
 */
function applyDeleteStatus(_draft: KanbanState, _statusId: number): void {
  // Intentionally empty — legacy no-op parity (see the doc comment above, F26).
}


/* ------------------------------------------------------------------ *
 * Initial state / reset
 * ------------------------------------------------------------------ */

/**
 * Build a fresh board state. Reproduces kanban-usertories.coffee:19-34.
 *
 * The AngularJS service mutated `this`; here the previous state is passed in
 * explicitly as `prev` so the flags that preserve values have something to read
 * from. The third flag is spelled `resetHideStatus` - the original coffee had
 * the typo `resetHideStatud`.
 *
 * `project`, `usersById` and `unclassifiedLabel` are always carried over from
 * `prev` when present so a reload (e.g. the consumer's
 * `reset(prev, false, false, false)`) keeps the injected configuration.
 */
export function reset(
  prev?: Partial<KanbanState>,
  resetSwimlanesList = true,
  resetArchivedStatus = true,
  resetHideStatus = true,
): KanbanState {
  const source: Partial<KanbanState> = prev ?? {};
  return {
    userstoriesRaw: [],
    swimlanes: [],
    swimlanesList: resetSwimlanesList ? [] : source.swimlanesList ?? [],
    usByStatus: {},
    usMap: {},
    usByStatusSwimlanes: {},
    order: {},
    foldStatusChanged: {},
    statusHide: resetHideStatus ? [] : source.statusHide ?? [],
    archivedStatus: resetArchivedStatus ? [] : source.archivedStatus ?? [],
    project: source.project ?? null,
    usersById: source.usersById ?? {},
    unclassifiedLabel: source.unclassifiedLabel ?? DEFAULT_UNCLASSIFIED_LABEL,
  };
}

/** Canonical empty board state (a full reset with all defaults). */
export const initialKanbanState: KanbanState = reset();

/* ------------------------------------------------------------------ *
 * Selectors (read-only)
 * ------------------------------------------------------------------ */

/** Find the raw user story by id. Coffee 220. */
export function getUsModel(state: KanbanState, id: number): UserStory | undefined {
  return state.userstoriesRaw.find((us) => us.id === id);
}

/** Read the view-model for a user story by id. Coffee 217. */
export function getUs(state: KanbanState, id: number): UserStoryData | undefined {
  return state.usMap[id];
}

/**
 * Raw stories in a status, optionally constrained to a swimlane. Coffee 130-132.
 * The falsy `!swimlaneId` check is preserved: a `null`/`undefined`/`0` swimlane
 * means "any swimlane" (callers pass the API swimlane id, which is `null` for
 * the unclassified swimlane).
 */
export function getStatus(
  state: KanbanState,
  statusId: number,
  swimlaneId?: number | null,
): UserStory[] {
  return state.userstoriesRaw.filter(
    (it) => it.status === statusId && (!swimlaneId || it.swimlane === swimlaneId),
  );
}

/**
 * True only when the story's status is present in BOTH `archivedStatus` and
 * `statusHide`. Coffee 116-121. Guards against a missing `usMap` entry.
 */
export function isUsInArchivedHiddenStatus(state: KanbanState, usId: number): boolean {
  const status = state.usMap[usId]?.model?.status;
  if (status === undefined) {
    return false;
  }
  return state.archivedStatus.indexOf(status) !== -1 && state.statusHide.indexOf(status) !== -1;
}

/* ------------------------------------------------------------------ *
 * Producers - configuration, folding and status visibility
 * ------------------------------------------------------------------ */

/**
 * Inject the board configuration. Coffee 36-39, extended so the hook can inject
 * the translated "unclassified" swimlane label (kept out of this pure module).
 */
export function init(
  state: KanbanState,
  project: Project | null,
  swimlanes: Swimlane[],
  usersById: Record<number, User>,
  unclassifiedLabel?: string,
): KanbanState {
  return produce(state, (draft: KanbanState) => {
    draft.project = project;
    draft.swimlanes = swimlanes;
    draft.usersById = usersById;
    if (unclassifiedLabel !== undefined) {
      draft.unclassifiedLabel = unclassifiedLabel;
    }
  });
}

/** Clear all fold flags. Coffee 41-42. */
export function resetFolds(state: KanbanState): KanbanState {
  return produce(state, (draft: KanbanState) => {
    draft.foldStatusChanged = {};
  });
}

/** Toggle a story's fold flag and refresh its view-model. Coffee 44-46. */
export function toggleFold(state: KanbanState, usId: number): KanbanState {
  return produce(state, (draft: KanbanState) => {
    draft.foldStatusChanged[usId] = !draft.foldStatusChanged[usId];
    const usModel = draft.userstoriesRaw.find((us) => us.id === usId);
    if (usModel) {
      draft.usMap[usId] = retrieveUserStoryData(usModel, draft.foldStatusChanged, draft.usersById);
    }
  });
}

/** Mark a status as archived. Coffee 113-114. */
export function addArchivedStatus(state: KanbanState, statusId: number): KanbanState {
  return produce(state, (draft: KanbanState) => {
    draft.archivedStatus.push(statusId);
  });
}

/**
 * Hide a status. Coffee 123-125:
 *     hideStatus: (statusId) ->
 *         @.deleteStatus(statusId)     # no-op (see applyDeleteStatus, F26)
 *         @.statusHide.push(statusId)
 *
 * The `deleteStatus` call is preserved for structural fidelity with the source,
 * but since it is a no-op the ONLY observable effect is pushing `statusId` onto
 * `statusHide` — exactly as the AngularJS service behaved.
 */
export function hideStatus(state: KanbanState, statusId: number): KanbanState {
  return produce(state, (draft: KanbanState) => {
    applyDeleteStatus(draft, statusId); // no-op, kept for source fidelity (F26)
    draft.statusHide.push(statusId);
  });
}

/** Show a previously hidden status. Coffee 127-128. */
export function showStatus(state: KanbanState, statusId: number): KanbanState {
  return produce(state, (draft: KanbanState) => {
    draft.statusHide = draft.statusHide.filter((it) => it !== statusId);
  });
}

/**
 * Delete a status. Coffee 134-138. This is a NO-OP by faithful reproduction of
 * the legacy bug chain (see `applyDeleteStatus`, F26): the returned state is
 * referentially identical to the input, because immer's `produce` returns the
 * original object when the draft is never mutated.
 */
export function deleteStatus(state: KanbanState, statusId: number): KanbanState {
  return produce(state, (draft: KanbanState) => {
    applyDeleteStatus(draft, statusId);
  });
}


/* ------------------------------------------------------------------ *
 * Producers - ordering and movement (server-observable, reproduced exactly)
 * ------------------------------------------------------------------ */

/** Rebuild `order` from `kanban_order`. Coffee 140-143. */
export function refreshRawOrder(state: KanbanState): KanbanState {
  return produce(state, (draft: KanbanState) => {
    applyRefreshRawOrder(draft);
  });
}

/** Merge explicit orders then refresh (without rebuilding usMap). Coffee 145-148. */
export function assignOrders(state: KanbanState, order: Record<number, number>): KanbanState {
  return produce(state, (draft: KanbanState) => {
    draft.order = { ...draft.order, ...order };
    applyRefresh(draft, false);
  });
}

/**
 * Move one or more stories to a status/swimlane at a given insertion point,
 * recomputing `order` so the moved stories land immediately after
 * `previousCard`. Reproduces kanban-usertories.coffee:150-190 exactly, and
 * returns both the next state and the byte-identical API payload the hook
 * forwards to `bulkUpdateKanbanOrder`.
 *
 * `usList` is a `number[]` of user-story ids. `index` is accepted for signature
 * parity with the AngularJS service (which likewise ignored it in the ordering
 * maths).
 */
export function move(
  state: KanbanState,
  usList: number[],
  statusId: number,
  swimlaneId: number | null,
  index: number,
  previousCard: number | null,
  nextCard: number | null,
): KanbanMoveResult {
  const nextState = produce(state, (draft: KanbanState) => {
    const usByStatus = stableSortByNumber(
      getStatus(draft, statusId, swimlaneId),
      (it) => draft.order[it.id],
    );

    let previousUsOrder: number;
    let previousUsIndex: number;
    if (previousCard) {
      previousUsOrder = draft.order[previousCard] + 1;
      previousUsIndex = usByStatus.findIndex((it) => it.id === previousCard) + 1;
    } else {
      previousUsOrder = 0;
      previousUsIndex = 0;
    }

    const usByStatusWithoutMoved = usByStatus.filter(
      (listIt) => !usList.find((moveId) => listIt.id === moveId),
    );

    const afterDestination = usByStatusWithoutMoved.slice(previousUsIndex);
    const initialLength = usList.length + 1;

    // Shift every story after the insertion point to make room for the moved ones.
    afterDestination.forEach((usModel, key) => {
      draft.order[usModel.id] = previousUsOrder + initialLength + key;
    });

    // Place the moved stories, updating their status/swimlane and view-models.
    // We mutate the raw models via `find` on the draft array (not on frozen
    // copies), matching the coffee which mutated the shared service models.
    usList.forEach((usId, key) => {
      const usModel = draft.userstoriesRaw.find((us) => us.id === usId);
      if (!usModel) {
        return;
      }
      usModel.status = statusId;
      usModel.swimlane = swimlaneId;
      draft.order[usId] = previousUsOrder + key;
      draft.usMap[usId] = retrieveUserStoryData(usModel, draft.foldStatusChanged, draft.usersById);
    });

    applyRefresh(draft, false);
  });

  return {
    state: nextState,
    payload: {
      statusId,
      swimlaneId,
      afterUserstoryId: previousCard ?? null,
      beforeUserstoryId: nextCard ?? null,
      bulkUserstories: usList,
    },
  };
}

/**
 * Move a story to the "end" sentinel (`order = -1`). Reproduces
 * kanban-usertories.coffee:192-202 and returns the exact `{ us_id, order: -1 }`
 * payload.
 */
export function moveToEnd(
  state: KanbanState,
  id: number,
  statusId: number,
): KanbanMoveToEndResult {
  const nextState = produce(state, (draft: KanbanState) => {
    const usModel = draft.userstoriesRaw.find((us) => us.id === id);
    draft.order[id] = -1;
    if (usModel) {
      usModel.status = statusId;
      usModel.kanban_order = -1;
    }
    applyRefresh(draft, false);
  });

  return {
    state: nextState,
    payload: { us_id: id, order: -1 },
  };
}

/* ------------------------------------------------------------------ *
 * Producers - collection synchronisation
 * ------------------------------------------------------------------ */

/** Replace the whole collection, rebuild order, then full refresh. Coffee 48-51. */
export function set(state: KanbanState, userstories: UserStory[]): KanbanState {
  return produce(state, (draft: KanbanState) => {
    draft.userstoriesRaw = userstories;
    applyRefreshRawOrder(draft);
    applyRefresh(draft);
  });
}

/** Ensure every present status has a (possibly empty) column. Coffee 53-58. */
export function initUsByStatusList(state: KanbanState, userstories: UserStory[]): KanbanState {
  return produce(state, (draft: KanbanState) => {
    for (const usModel of userstories) {
      const status = String(usModel.status);
      if (!(status in draft.usByStatus)) {
        draft.usByStatus[status] = [];
      }
    }
  });
}

/** Remove a story from every projection, then refresh swimlanes. Coffee 60-75. */
export function remove(state: KanbanState, usModel: UserStory): KanbanState {
  return produce(state, (draft: KanbanState) => {
    draft.userstoriesRaw = draft.userstoriesRaw.filter((it) => it.id !== usModel.id);
    delete draft.order[usModel.id];
    delete draft.usMap[usModel.id];
    const status = String(usModel.status);
    draft.usByStatus[status] = (draft.usByStatus[status] ?? []).filter((id) => id !== usModel.id);
    applyRefreshSwimlanes(draft);
  });
}

/**
 * Add one or more stories WITHOUT a full refresh (the AngularJS comment: "don't
 * call refresh to prevent unnecessary mutations in every single us"). Existing
 * `usMap` entries are preserved - the `if (!usMap[id])` guard is intentional.
 * Coffee 78-111.
 */
export function add(state: KanbanState, usList: UserStory[] | UserStory): KanbanState {
  return produce(state, (draft: KanbanState) => {
    const incoming: UserStory[] = Array.isArray(usList) ? usList : [usList];
    const sorted = stableSortByNumber(incoming, (it) => it.kanban_order);

    // Dedup then append the incoming stories.
    draft.userstoriesRaw = draft.userstoriesRaw.filter(
      (us) => !sorted.find((it) => it.id === us.id),
    );
    draft.userstoriesRaw = draft.userstoriesRaw.concat(sorted);

    applyRefreshRawOrder(draft);

    draft.userstoriesRaw = stableSortByNumber(draft.userstoriesRaw, (it) => draft.order[it.id]);

    for (const usModel of sorted) {
      const view = retrieveUserStoryData(usModel, draft.foldStatusChanged, draft.usersById);
      const status = String(usModel.status);
      if (!(status in draft.usByStatus)) {
        draft.usByStatus[status] = [];
      }
      // Guard: do NOT overwrite an existing view-model already tracked in usMap.
      if (!draft.usMap[usModel.id]) {
        draft.usMap[usModel.id] = view;
        draft.usByStatus[status] = draft.usByStatus[status]
          .filter((id) => id !== usModel.id)
          .concat(usModel.id);
      }
    }

    applyRefreshSwimlanes(draft);
  });
}

/** Replace a stored view-model. Coffee 204-205. `us` is a `UserStoryData`. */
export function replace(state: KanbanState, us: UserStoryData): KanbanState {
  return produce(state, (draft: KanbanState) => {
    draft.usMap[us.id] = us;
  });
}

/** Replace a raw model (by id) and recompute its view-model. Coffee 207-215. */
export function replaceModel(state: KanbanState, usModel: UserStory): KanbanState {
  return produce(state, (draft: KanbanState) => {
    draft.userstoriesRaw = draft.userstoriesRaw.map((usItem) =>
      usItem.id === usModel.id ? usModel : usItem,
    );
    draft.usMap[usModel.id] = retrieveUserStoryData(
      usModel,
      draft.foldStatusChanged,
      draft.usersById,
    );
  });
}

/** Recompute a single story's view-model. Coffee 223-226. */
export function refreshUserStory(state: KanbanState, usId: number): KanbanState {
  return produce(state, (draft: KanbanState) => {
    const usModel = draft.userstoriesRaw.find((us) => us.id === usId);
    if (usModel) {
      draft.usMap[usId] = retrieveUserStoryData(usModel, draft.foldStatusChanged, draft.usersById);
    }
  });
}

/* ------------------------------------------------------------------ *
 * Producers - projection rebuilds
 * ------------------------------------------------------------------ */

/**
 * Sort raw stories by `order`, rebuild `usByStatus` (STRING-keyed), optionally
 * refresh `usMap`, then optionally refresh swimlanes. Coffee 254-275.
 */
export function refresh(
  state: KanbanState,
  refreshUsMap = true,
  refreshSwimlanesFlag = true,
): KanbanState {
  return produce(state, (draft: KanbanState) => {
    applyRefresh(draft, refreshUsMap, refreshSwimlanesFlag);
  });
}

/** Rebuild the per-swimlane projection. Coffee 277-317. */
export function refreshSwimlanes(state: KanbanState): KanbanState {
  return produce(state, (draft: KanbanState) => {
    applyRefreshSwimlanes(draft);
  });
}

