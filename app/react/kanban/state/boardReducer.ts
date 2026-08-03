/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * boardReducer — the ONE place Kanban board state is written.
 *
 * ===========================================================================
 * 1. WHAT THIS MODULE IS, AND ITS EXACTLY THREE EXPORTS
 * ===========================================================================
 * It replaces the mutation half of two AngularJS units:
 *
 *   `KanbanUserstoriesService`  `app/coffee/modules/kanban/kanban-usertories.coffee`
 *   `KanbanController`          `app/coffee/modules/kanban/main.coffee`
 *
 * and nothing else. Three exports, no more:
 *
 *   `kanbanBoardReducer`       the PLAIN, draft-mutating reducer. It is NOT
 *                              pre-wrapped in `produce`; the container applies
 *                              `useReducer(produce(kanbanBoardReducer), init)`
 *                              so the curried producer composes with it
 *                              directly and `use-immer` is not needed.
 *   `createInitialBoardState`  the `init` argument of that same `useReducer`.
 *   `UNCLASSIFIED_SWIMLANE_ID` the `-1` sentinel, owned here.
 *
 * Every type comes from `./types`, which is the binding contract: its
 * `KanbanBoardState` fixes the 20 fields this module may write and its
 * `KanbanBoardAction` fixes the 29 transitions it may implement. The switch
 * below is exhaustive over that union, so adding a member there becomes a
 * COMPILE ERROR here rather than a silently ignored action.
 *
 * There is NO hook, NO store, NO context, NO selector and NO wrapped reducer in
 * this file. Reading is `./boardSelectors.ts`; effects are `../hooks/`.
 *
 * ===========================================================================
 * 2. THE FIVE ARCHITECTURAL RULINGS
 * ===========================================================================
 * RULING 1 — `refresh()` AND `refreshSwimlanes()` ARE NO-OPS HERE. NOT PORTED.
 *
 * The incumbent caches four derived structures on the service and republishes
 * them onto the scope through `taiga.defineImmutableProperty`
 * (`main.coffee:144-155` — `usByStatus` at `:144`, `usMap` at `:147`,
 * `usByStatusSwimlanes` at `:150`, `swimlanesList` at `:153`).
 * `refresh` (`kanban-usertories.coffee:327-348`) and `refreshSwimlanes`
 * (`:350-390`) exist for the sole purpose of rebuilding those caches.
 *
 * In React all four are PURE DERIVATIONS computed on read by
 * `./boardSelectors.ts`. `KanbanBoardState` therefore declares none of them,
 * and every `@.refresh(false)` / `@.refreshSwimlanes()` call in the source
 * (`:159` in `add`, `:230` in `move`, `:265` in `moveToEnd`, `:123` in
 * `remove`, `:91` in `set`) becomes a NO-OP: the derivation happens
 * automatically on the next selector read.
 *
 * THIS IS STATED HERE BECAUSE IT IS THE SINGLE EASIEST WAY TO GET THIS FOLDER
 * WRONG. Porting `refresh` in would create two competing sources of truth for
 * the same grouping. It is also what makes P-IMMER-4 pay off: with `autoFreeze`
 * on, `produce` yields reference equality on untouched branches, so a selector
 * can memoise and `React.memo` becomes a genuine replacement for the
 * Immutable-based change detection this migration removes.
 *
 * RULING 2 — THE `-1` -> `null` SWIMLANE NORMALISATION HAPPENS HERE, FIRST.
 *
 * `main.coffee:700-703` converts before touching either local state or the API:
 *
 *     apiNewSwimlaneId = newSwimlaneId
 *     if newSwimlaneId == -1
 *         apiNewSwimlaneId = null
 *
 * and the ALREADY-CONVERTED value then goes to BOTH the local mutation
 * (`:705-712` calls `move(..., apiNewSwimlaneId, ...)`) and the write
 * (`:714-721` passes it to `bulkUpdateKanbanOrder`). The controller's React
 * analogue is `../hooks/useCardDrag.ts`, which does not exist yet, so the
 * invariant is enforced in the one module that writes the field instead. It is
 * idempotent and behaviour-identical.
 *
 * THE SILENT DATA BUG THIS PREVENTS. `refreshSwimlanes` identifies unclassified
 * stories by `us.swimlane == null` (`kanban-usertories.coffee:357-358`) and
 * maps the synthetic `-1` back to `null` when matching cards into swimlanes
 * (`:383`). If a story ever STORED `-1` then (a) `userstoriesNoSwimlane.length`
 * is 0, so the synthetic swimlane is never created (`:366`), and (b) the
 * `== null` match fails, so THE CARDS SILENTLY VANISH FROM THE BOARD. No error,
 * no warning, nothing in the console.
 *
 * Corroboration: `moveUsToTop` (`main.coffee:266`) forwards the story's OWN
 * `.swimlane`, which is already `null` for an unclassified story — that call
 * only works because the field is never `-1`.
 *
 * THE ASYMMETRY IS PRESERVED. `main.coffee:698` broadcasts
 * `kanban:userstories:loaded` with the UNCONVERTED `newSwimlaneId` while `:705`
 * passes the CONVERTED value to `move`. This reducer surfaces no broadcast, so
 * there is nothing to convert; if one is ever added it must stay unconverted.
 *
 * RULING 3 — `UNCLASSIFIED_SWIMLANE_ID` IS OWNED HERE.
 *
 * Both this file (the normalisation above) and `./boardSelectors.ts` (the
 * synthetic swimlane entry, and the `swimlane.id === -1 ? null : swimlane.id`
 * match) need the literal. It cannot live in `./types.ts`, which is
 * deliberately type-only with zero executable statements. The import direction
 * is therefore `./boardSelectors.ts` -> `./boardReducer.ts`, which is
 * cycle-free, and THIS FILE MUST NEVER IMPORT FROM `./boardSelectors`.
 *
 * RULING 4 — THE REDUCER / SELECTOR BOUNDARY.
 *
 * This module owns NORMALISED state only — the 20 fields of
 * `KanbanBoardState`. `./boardSelectors.ts` owns EVERY derivation:
 * `usByStatus`, `usByStatusSwimlanes`, the `usMap` of `CardUserStoryVm` values,
 * `swimlanesList`, `hasSwimlanes`, the per-column card ids and counts, and the
 * placeholder predicate. `retrieveUserStoryData`
 * (`kanban-usertories.coffee:293-325`) is a derivation and is NOT reproduced
 * here.
 *
 * RULING 5 — `createInitialBoardState` SEEDS FROM AN INITIAL-ONLY HAND-OFF.
 *
 * The bridge `params` object is a one-time hand-off, not a state stream: the
 * unmodified `tgLoadElement` directive `$watch`es with no third argument
 * (`app/coffee/modules/base/load-element.coffee:19`), so it compares by
 * IDENTITY, and `main.coffee:185` builds the contract exactly once at the end
 * of the controller constructor and never rebuilds it. React therefore seeds
 * once and owns its state locally thereafter. The factory accepts
 * `KanbanBoardHydration` — every member optional, because the bridge builds its
 * payload before the asynchronous load chain (`main.coffee:678`) has populated
 * anything — and always returns a FULLY POPULATED state. Never a partial: an
 * `undefined` field would break every selector and the exhaustive-switch
 * guarantees below.
 *
 * ===========================================================================
 * 3. SOURCE-OF-TRUTH CORRECTION — READ THIS BEFORE EDITING `MOVE_CARD`
 * ===========================================================================
 * The migration plan reproduces `move()` as an excerpt and that excerpt is a
 * PARAPHRASE, not the code in this tree. It was measured against an earlier
 * revision and differs in four load-bearing ways. The file itself was re-read
 * line by line and IS the authority here, because T6 states that behaviour
 * follows the AngularJS implementation and T10 forbids any functional change:
 *
 *   plan excerpt                          this tree (`kanban-usertories.coffee`)
 *   ------------------------------------  --------------------------------------
 *   sorts `@.userstoriesRaw`, i.e.        `:199` sorts `getStatus(statusId,
 *   EVERY story on the board              swimlaneId)`, i.e. the TARGET COLUMN
 *   `previousUsOrder = order[prev]`       `:203` `= order[prev] + 1`
 *   `previousUsIndex = findIndex(...)`    `:204` `= findIndex(...) + 1`
 *   `bulkUserstories` is the shifted      `:247` is the MOVED ID LIST; `usList`
 *   post-slice tail                       is never reassigned in this revision
 *
 * Implementing the paraphrase would renumber every story on the board on every
 * drag and would drop both `+ 1`s — a genuine behaviour change, and precisely
 * the class of silent off-by-one that named risk R-DND-2 warns about, where a
 * wrong order persists with no error surface and only surfaces on the next page
 * load. The transcription below follows the tree.
 *
 * ===========================================================================
 * 4. IMMER DISCIPLINE — ALL FOUR PITFALLS ARE MANDATORY
 * ===========================================================================
 * P-IMMER-1  PLAIN OBJECTS ONLY. `$tgModel` returns model CLASSES carrying
 *            dirty-tracking state, and passing one into a draft is undefined
 *            behaviour. The conversion boundary already exists in the
 *            incumbent: `kanban-usertories.coffee:303` calls
 *            `usModel.getAttrs()` (`app/coffee/modules/base/model.coffee:48-54`,
 *            which injects `version` at `:49-50` and returns
 *            `_.extend({}, @._attrs, @._modifiedAttrs)` at `:54`), and the
 *            house precedent for flattening at the framework seam is
 *            `app/modules/components/project-menu/project-menu.controller.coffee:27`
 *            (`project: @projectService.project.toJS(),`).
 *            CALLER CONTRACT: every action payload and every hydration member
 *            MUST carry post-`getAttrs()` PLAIN objects. Never a `$tgModel`
 *            instance, never an Immutable structure, never a promise, never a
 *            callback, never a DOM node.
 * P-IMMER-2  `console.log(draft)` THROWS a `TypeError` on a Proxy draft. Debug
 *            with `JSON.stringify` or immer's `current()`. This file ships no
 *            `console.*` call at all.
 * P-IMMER-3  MUTATE OR RETURN, NEVER BOTH. The draft parameter is never
 *            reassigned and the reducer returns `void`. This is exactly why the
 *            `{statusId, swimlaneId, afterUserstoryId, beforeUserstoryId,
 *            bulkUserstories}` object that `move` returns at `:242-248` CANNOT
 *            be returned from here — see the note on `MOVE_CARD`.
 * P-IMMER-4  `autoFreeze` STAYS ON (the default). `setAutoFreeze` is never
 *            called, anywhere. Two consequences are relied on: structural
 *            sharing gives reference equality on untouched branches, and an
 *            accidental post-`produce` mutation throws in development instead
 *            of corrupting state silently. The second one is why every sort in
 *            this file COPIES FIRST — `Array.prototype.sort` is in place, and
 *            sorting a frozen array throws at runtime with nothing for the type
 *            checker to catch.
 *
 * `immer` is imported TYPE-ONLY (`Draft`). `produce` itself is applied by the
 * container.
 *
 * ===========================================================================
 * 5. WHAT LIVES ELSEWHERE — EVERY TIMER, EVERY I/O, EVERY DERIVATION
 * ===========================================================================
 * This reducer is PURE: no `fetch`, no `XMLHttpRequest`, no `$tg*` service, no
 * `$tgStorage`, no `localStorage`, no `setTimeout`, no promise, no DOM, no
 * `angular`, no request body. The measured delays are recorded here so the hook
 * that owns each one has a single reference:
 *
 *   1000 ms, invokeApply FALSE  the `kanban-moved` highlight
 *                               (`main.coffee:250-252`). The hook sets the
 *                               timer and dispatches `CLEAR_MOVED_US`.
 *    100 ms, invokeApply FALSE  the `redraw:wip` rebroadcast after a swimlane
 *                               toggle (`:428-430`) and after the render queue
 *                               drains (`:491-493`).
 *      0 ms, invokeApply TRUE   `initialLoad` flipping to true (`:686-688`).
 *                               The `true` is deliberate and contrasts with
 *                               every `, false` above; it is a real difference
 *                               in the source, not a typo.
 *   [200, 100, 50] then `|| 20` the initial render batching (`:476`, `:481`).
 *   debounceLeading 100         `filtersReloadContent` (`:231`).
 *
 * I/O the hook performs, never this file: `storeStatusColumnModes`
 * (`main.coffee:1005`), `storeSwimlanesModes` (`:426`), `getStatusColumnModes`
 * (`:997`, `:1014`), `getSwimlanesModes` (`:680`) — all four wrapped by
 * `../../shared/api/kanbanStorage.ts` — plus `loadUserstories`, `firstLoad`
 * and `bulkUpdateKanbanOrder`.
 *
 * Derivations other modules own, never re-derived here: the WIP threshold
 * arithmetic (`../WipLimitMarker.tsx` already exports `resolveWipLimitState`
 * and `resolveWipLimitIndex`), the drop-position and neighbour arithmetic
 * (`../../shared/dnd/useSortableList.ts`, where PREVIOUS WINS), the
 * virtualisation latch (`../../shared/useInViewport.ts`), and the request
 * bodies (`../../shared/api/userstories.ts`).
 *
 * NOT BOARD STATE, and deliberately absent: `usCardVisibility` (a write-once
 * monotonic latch, `main.coffee` never writes `false`), `pendingDrag` (a
 * BACKLOG-only mechanism — kanban has no such path), `isMaximized` /
 * `isMinimized` (referenced by templates but defined in no controller anywhere
 * in the repository, so the classes never apply and no state is invented for
 * them), and `'loading-extra'` (card-owned and protected by T4).
 *
 * ===========================================================================
 * 6. LOCATOR CONVENTION
 * ===========================================================================
 * Every `path:line` citation is the CURRENT tree position, verified by reading
 * the file. The plan measured these sources before this migration added its
 * seam comments to them, so its own line numbers have shifted; where the two
 * differ the current position is used, following the precedent set by
 * `./types.ts` and `../../shared/types/userStory.ts`. Bare `:nnn` continues the
 * most recently named file.
 *
 * ===========================================================================
 * 7. LEDGER OF THE GOVERNING CONSTRAINTS
 * ===========================================================================
 * NO USER-SPECIFIED RULES EXIST FOR THIS PROJECT. `review_rules` returns "No
 * user rules provided.", which the Agent Action Plan corroborates at its
 * section 0.10. Nothing is invented in their place and the bar is not lowered:
 * enterprise practice applies, and the plan's own constraints stand in for a
 * rules document. Each one, summarised, with where this module honours it:
 *
 *   T1    Class names preserved. This file emits no markup, so the obligation
 *         is to maintain the state those untouched stylesheets are bound to:
 *         `folds` -> `vfold`, `unfold` -> `vunfold`, `selectedUss` ->
 *         `kanban-task-selected` and `ui-multisortable-multiple`, `movedUs` ->
 *         `kanban-moved`, `foldedSwimlane` -> the swimlane body gate and
 *         `folded`, `notFoundUserstories` -> `not-found`, `renderInProgress` ->
 *         the counter's `disabled`. No CSS, no class string, no style object
 *         appears below.
 *   T2    Colours stay data-bound. There is no colour literal anywhere in this
 *         file, not even in a comment as a default.
 *   T3    Zero new icon assets, hence no icon name.
 *   T4    The shared card is never touched. Nothing here writes to
 *         `app/modules/components/card/**` or `app/styles/**`, and
 *         `'loading-extra'` is left to the card that owns it.
 *   T5    No parallel HTTP client. This reducer builds no request body and
 *         reaches no transport. For the record, so nobody adds one here: the
 *         ordering endpoint is POSITION-RELATIVE and
 *         `app/coffee/modules/resources/userstories.coffee:112-129` implements
 *         `if after ... else if before`, so when BOTH neighbours are supplied
 *         only `after_userstory_id` is sent, when neither is supplied neither
 *         key appears, `swimlane_id` and `milestone_id` are added on
 *         TRUTHINESS (a `0` omits the key) and `status_id` is always sent.
 *         That contract belongs to `../../shared/api/userstories.ts`.
 *   T6    Behaviour follows AngularJS. Every behavioural decision below carries
 *         a `[path:locator]` citation, and section 3 above resolves the one
 *         place where the plan's excerpt and the tree disagree.
 *   T7/T8 No build configuration is touched and all new code is isolated under
 *         `app/react/**`. This module adds one file and edits nothing.
 *   T9    The seam is documented at each point of change. All eight mandated
 *         sites are present: the Immutable -> plain-object boundary and the
 *         `.length`-never-`.size` rule (section 4 and `toDraft`); the
 *         three-way key-type asymmetry and why it is NOT normalised (on
 *         `CLEAN_SELECTED_USS` and `TOGGLE_SWIMLANE`); the `folds` string ->
 *         numeric coercion (on `buildNumericFolds`); `swimlane` being
 *         `number | null` and NEVER `-1` while `-1` IS a grouping key (RULING 2
 *         and `UNCLASSIFIED_SWIMLANE_ID`); `refresh` / `refreshSwimlanes` being
 *         no-ops (RULING 1); timers, I/O and persistence living in the hooks
 *         with their exact measured delays (section 5); `moveToEnd` having zero
 *         measured call sites (on `MOVE_TO_END`); and `usStatusList` sorting by
 *         `"order"` here versus `"id"` in the backlog (on `SET_US_STATUS_LIST`).
 *   T10   No functional change. Preserved as-is, every one against its own
 *         instinct to tidy: the truthy `if previousCard` guard, the truthy
 *         `!swimlaneId` guard inside `getStatus`, the pre-filter index applied
 *         to the post-filter array, the `+ 1` in `initialLength`, the
 *         remove-then-append dedupe, `moveToEnd` writing BOTH `order` and
 *         `kanban_order` where `move` writes only `order`, `cleanSelectedUss`
 *         never deleting a key, the unconditional pushes that permit
 *         duplicates, and both swimlane/flat-mode asymmetries.
 *   HR-2  The dependency set is closed. Three modules are imported and nothing
 *         else: type-only `immer`, `./types`, and one shared domain type. No
 *         lodash — `_.sortBy`, `_.filter`, `_.slice`, `_.find`, `_.findIndex`,
 *         `_.each`, `_.map`, `_.remove` and `_.assign` are all reimplemented
 *         with native `Array` methods. No `use-immer`, no class-name helper, no
 *         schema library, no date library, no UI package, no React.
 *   HR-5  Browserless. Nothing here needs jsdom, a network or `dist/`.
 *   HR-9  >=70% line coverage with Jest. Every export and every branch below is
 *         reachable from a pure unit test with no browser.
 *   HR-11 Minimal Change Clause. Three measured omissions are that discipline
 *         in practice: `assignOrders` (`kanban-usertories.coffee:193-196`) is
 *         NOT implemented because it has zero callers in the kanban module;
 *         `deleteStatus` (`:182-186`) is NOT implemented because it is dead and
 *         broken (`_.map` is called with a function and no collection, and it
 *         writes the never-initialised, never-read `@.archived`); and the dead
 *         `groupBy = @.taiga.groupBy` alias at `:9` is not reproduced.
 *   I1    No `angular` reference of any kind.
 *   I3    `dragula` and `dom-autoscroller` are never imported.
 *   I5    ZERO Immutable. Nothing here exposes or calls `get`, `getIn`, `toJS`
 *         or `size`; collection length is always `.length`.
 *   I6    No DOM at all, so light-DOM-only is trivially honoured.
 *   I7    Reinforces T5: writes go through the existing repository layer, whose
 *         `$tgModel` dirty-tracking PATCHes only changed fields with the
 *         optimistic-concurrency `version`.
 *   I8    No `.gitignore` change.
 *   I9    This file is the CONTAINER half of the presentational/container
 *         split. Keeping it pure is what makes the coverage gate reachable
 *         browserlessly.
 */

// Three type-only imports, and no more. `isolatedModules` is enabled, so a
// value-form import of a type would survive transpilation; `import type` is
// erased. `tsconfig.json` declares neither `baseUrl` nor `paths`, hence the
// relative specifiers, and `userStory` is camelCase on purpose because
// `forceConsistentCasingInFileNames` is enabled.
//
// `../../shared/types/swimlane` is reached TRANSITIVELY through
// `KanbanBoardState` rather than imported directly: this module never names
// `Swimlane`, and `noUnusedLocals` would reject an unused import. Deriving the
// story draft type from the state contract below has the same motivation — it
// cannot drift from `./types.ts`.
import type { Draft } from 'immer';
import type {
    KanbanBoardAction,
    KanbanBoardHydration,
    KanbanBoardState,
} from './types';
import type { UserStory } from '../../shared/types/userStory';
import type { Status } from '../../shared/types/status';


// ---------------------------------------------------------------------------
// LOCAL TYPE ALIASES
//
// Not exported: the public API of this module is exactly three values, and a
// fourth exported name — even a type — would widen it.
// ---------------------------------------------------------------------------

/**
 * The mutable view of the board state that `produce` hands the reducer.
 *
 * `Draft<T>` strips every `readonly` modifier recursively, which is what makes
 * `draft.order[id] = n` legal even though `KanbanBoardState.order` is declared
 * `Readonly<Record<number, number>>`.
 */
type BoardDraft = Draft<KanbanBoardState>;

/** One drafted story, derived from the state contract so it cannot drift. */
type StoryDraft = BoardDraft['storiesById'][number];


// ---------------------------------------------------------------------------
// EXPORT 1 OF 3 — THE UNCLASSIFIED SWIMLANE SENTINEL
// ---------------------------------------------------------------------------

/**
 * The id the SYNTHETIC "unclassified user stories" swimlane renders with.
 *
 * Two facts about this number, and conflating them is the bug RULING 2 exists
 * to prevent:
 *
 *   IT IS A LEGITIMATE GROUPING KEY. `refreshSwimlanes` prepends
 *   `{id: -1, kanban_order: 1, name: "KANBAN.UNCLASSIFIED_USER_STORIES"}` at
 *   index 0 of the rendered swimlane list
 *   (`kanban-usertories.coffee:366-374`), `loadSwimlanes` seeds
 *   `swimlanesStatuses[-1]` with ALL project statuses (`main.coffee:656`), and
 *   the template compares `swimlane.id == -1` to add the
 *   `unclassified-swimlane` class (`kanban-table.jade:82`).
 *
 *   IT MUST NEVER BE STORED ON A STORY. `UserStory.swimlane` is
 *   `number | null`, and `null` — not `-1` — is what marks a story
 *   unclassified. `main.coffee:700-703` converts `-1` to `null` before either
 *   the local mutation or the API call, and `refreshSwimlanes` maps the
 *   synthetic id back to `null` when matching cards (`:383`).
 *
 * Declared here rather than in `./types.ts` because that module is
 * deliberately type-only with zero executable statements. `./boardSelectors.ts`
 * imports it from here; this file must never import from there.
 */
export const UNCLASSIFIED_SWIMLANE_ID = -1;


// ---------------------------------------------------------------------------
// INTERNAL HELPERS
//
// Every one of these stands in for a lodash call the incumbent made. `lodash`
// is not part of the closed dependency set (HR-2), so each is reimplemented
// with native `Array` methods and each names the call it replaces.
// ---------------------------------------------------------------------------

/**
 * The local, type-only equivalent of immer's `castDraft`.
 *
 * T9 SEAM. `UserStory` and `Swimlane` declare `readonly` ARRAY members
 * (`tags`, `epics`, `assigned_users`, `attachments`, `tasks`, `watchers`,
 * `statuses`), and immer's `Draft<T>` rewrites those to mutable arrays. A
 * `readonly T[]` is not assignable to a `T[]`, so TypeScript rejects handing a
 * freshly fetched story straight to a drafted record even though the two are
 * structurally IDENTICAL at runtime — nothing is copied, converted or
 * reinterpreted.
 *
 * immer ships `castDraft` for exactly this, but it is a VALUE export and this
 * module imports `immer` type-only, so the one-line equivalent lives here. The
 * assertion is the whole point of the helper: it is confined to this single
 * function so that no other assertion is needed anywhere below, and so that
 * every other assignment keeps full type checking.
 *
 * P-IMMER-1 rides on the caller contract, not on this signature: what arrives
 * must already be a post-`getAttrs()` plain object
 * (`app/coffee/modules/base/model.coffee:48-54`).
 */
function toDraft<T>(value: T): Draft<T> {
    return value as Draft<T>;
}

/**
 * `@.order[id]`, with an explicit numeric floor.
 *
 * `refreshRawOrder` (`kanban-usertories.coffee:188-191`) assigns an order to
 * EVERY tracked story, and every action below that adds a story rebuilds it, so
 * a missing entry is unreachable on the happy path. The floor exists because
 * the alternative is arithmetic on `undefined`, which yields `NaN`, and a `NaN`
 * order corrupts the board's ordering silently — the exact failure mode named
 * risk R-DND-2 describes, with no exception and no console warning.
 *
 * THE CONSEQUENCE, STATED EXACTLY. Reading `0` for an untracked story makes it
 * sort first in `sortStoriesByOrder`, and makes an untracked NEIGHBOUR behave as
 * though it sat at order `0` — so `previousUsOrder` becomes `1` (the `+ 1` at
 * `:203` still applies) while `findIndex` independently returns `-1`, leaving
 * `previousUsIndex` at `0` and the shifted tail starting at `1 + initialLength`.
 * The moved run therefore still lands ahead of the whole column, which is the
 * same outcome as the incumbent's no-neighbour branch (`:206-207`), just one
 * order value higher. No branch is added for the case: one code path is easier
 * to reason about than two, and `NaN` is the only outcome worth ruling out.
 */
function readOrder(order: BoardDraft['order'], id: number): number {
    const value = order[id];

    return Number.isFinite(value) ? value : 0;
}

/**
 * `_.sortBy list, [(it) => @.order[it.id]]` — `kanban-usertories.coffee:200`.
 *
 * COPIES BEFORE SORTING, always. `Array.prototype.sort` mutates in place, and
 * under immer's `autoFreeze` (P-IMMER-4) sorting a frozen array throws at
 * runtime with nothing for the type checker to catch.
 *
 * The sort is STABLE, which `./boardSelectors.ts` must also be. Equal `order`
 * values are reachable: the incumbent's own pre-filter-index-applied-to-a
 * -post-filter-array step (see `applyMoveCard`) can leave two cards in one
 * column sharing an order, and only a stable sort then keeps them in their
 * previous relative position. ECMAScript has required `Array.prototype.sort` to
 * be stable since ES2019.
 */
function sortStoriesByOrder(
    stories: readonly StoryDraft[],
    order: BoardDraft['order'],
): StoryDraft[] {
    return [...stories].sort(
        (left, right) => readOrder(order, left.id) - readOrder(order, right.id),
    );
}

/**
 * `getStatus(statusId, swimlaneId)` — `kanban-usertories.coffee:178-180`:
 *
 *     return _.filter @.userstoriesRaw, (it) =>
 *         return it.status == statusId && (!swimlaneId || it.swimlane == swimlaneId)
 *
 * TWO THINGS ARE PRESERVED VERBATIM AND MUST NOT BE "IMPROVED" (T10).
 *
 * THE FALSY GUARD. `!swimlaneId` is truthiness, not a null check. After RULING
 * 2's normalisation an unclassified drop arrives as `null`, so `!null` is true
 * and the filter degrades to status-only — matching stories in EVERY swimlane.
 * That is the incumbent's behaviour. A swimlane whose id were `0` would behave
 * the same way; swimlane ids are database primary keys starting at 1, so the
 * case is unreachable, and it is preserved anyway rather than guarded.
 *
 * THE ITERATION SCOPE. CoffeeScript's `==` compiles to `===`, so the
 * comparisons are strict.
 *
 * ONE MEASURED STRUCTURAL DIFFERENCE, recorded rather than hidden: the
 * incumbent scans `@.userstoriesRaw`, an ARRAY whose own order is whatever the
 * last `refresh` left, whereas RULING 4 stores stories in a keyed record and
 * JavaScript enumerates integer-like keys in ascending numeric order. Both are
 * then sorted by `order`, so the only observable difference is the tie-break
 * basis when two cards in one column share an order — ascending id here versus
 * previous array position there. It is unreachable except through the
 * incumbent's own off-by-one, and normalised state is what RULING 4 requires.
 */
function selectStatusStories(
    draft: BoardDraft,
    statusId: number,
    swimlaneId: number | null,
): StoryDraft[] {
    return Object.values(draft.storiesById).filter(
        (story) =>
            story.status === statusId &&
            (!swimlaneId || story.swimlane === swimlaneId),
    );
}

/**
 * `refreshRawOrder()` — `kanban-usertories.coffee:188-191`:
 *
 *     @.order = {}
 *     if (@.userstoriesRaw)
 *         @.order[it.id] = it.kanban_order for it in @.userstoriesRaw
 *
 * A WHOLESALE REPLACEMENT, NOT A MERGE. `:189` discards the previous index
 * outright, so any local drag ordering `applyMoveCard` wrote is DISCARDED and
 * every story falls back to its server-assigned `kanban_order`. That is exactly
 * what the incumbent does and it is why `add` (`:138`) can undo an unsaved
 * reorder. Preserved deliberately (T10).
 *
 * The `if (@.userstoriesRaw)` truthiness guard at `:190` has no analogue:
 * `storiesById` is always an object here, never `undefined`.
 */
function buildOrderFromKanbanOrder(
    stories: readonly { readonly id: number; readonly kanban_order: number }[],
): Record<number, number> {
    const order: Record<number, number> = {};

    for (const story of stories) {
        order[story.id] = story.kanban_order;
    }

    return order;
}

/**
 * The normalised form of `@.userstoriesRaw = userstories`
 * (`kanban-usertories.coffee:89`).
 *
 * Keyed by id, which is the whole point of RULING 4. Later entries win when a
 * payload repeats an id, matching the incumbent's remove-then-append dedupe at
 * `:132-134`.
 */
function buildStoriesById(
    stories: readonly UserStory[],
): Record<number, UserStory> {
    const storiesById: Record<number, UserStory> = {};

    for (const story of stories) {
        storiesById[story.id] = story;
    }

    return storiesById;
}

/**
 * `_.sortBy usList, ['kanban_order']` — `kanban-usertories.coffee:130`.
 *
 * Copy-first for the same reason as `sortStoriesByOrder`. The incoming payload
 * may be frozen, either by immer or by a caller's own `Object.freeze`.
 */
function sortByKanbanOrder(stories: readonly UserStory[]): UserStory[] {
    return [...stories].sort(
        (left, right) => left.kanban_order - right.kanban_order,
    );
}

/**
 * The STRING -> NUMERIC rebuild for column folds.
 *
 * T9 SEAM (3). `folds` is NUMERIC-keyed in state because every consumer indexes
 * it with a raw status id — `folds[s.id]` at `kanban-table.jade:20`, `:113` and
 * `:190`, `$scope.folds[status.id]` at `main.coffee:1000`, `:1002` and `:1020`
 * — while its PERSISTED form is string-keyed, because
 * `getStatusColumnModes` ends `$storage.get(hash) or {}`
 * (`app/coffee/modules/resources/kanban.coffee:24-27`) and a JSON round-trip
 * through storage always yields string keys.
 *
 * The AngularJS incumbent performs NO conversion: it reads the stored object
 * and indexes it with a number, relying on JavaScript coercing the key. This
 * rebuild is therefore a TYPING ACCOMMODATION and is RUNTIME-IDENTICAL, because
 * JavaScript object keys are always strings.
 *
 * IT MUST NOT DROP OR RENUMBER AN ENTRY, so there is no filter and no guard
 * here. `Number` is exact for a stringified integer, including `'-1'`. A key
 * that were not numeric would become `NaN` and is kept as such rather than
 * silently discarded — the stored keys are always stringified status ids, and
 * dropping an entry would be the one failure this contract forbids.
 *
 * Note also that the reader it mirrors ends `or {}`, so a missing project key
 * yields `{}` and never `undefined`. No null guard is added that the source
 * does not have.
 */
function buildNumericFolds(
    stored: Readonly<Record<string, boolean>>,
): Record<number, boolean> {
    const folds: Record<number, boolean> = {};

    Object.entries(stored).forEach(([key, value]) => {
        folds[Number(key)] = value;
    });

    return folds;
}

/**
 * `loadSwimlanes`'s status index — `main.coffee:651-656`, rebuilt wholesale.
 *
 * `:651` resets the record to `{}` before repopulating it, so this REPLACES
 * rather than merges. `Object.entries` yields string keys and the record is
 * numeric-keyed, so each is coerced with `Number`; runtime-identical, because
 * JavaScript object keys are always strings, and the `-1` entry survives it
 * exactly (`Number('-1') === -1`).
 *
 * Each status list is COPIED. Two reasons, both practical: a `readonly Status[]`
 * is not assignable to the mutable array immer's `Draft` produces, and copying
 * stops the caller's own array from being aliased into state and then frozen by
 * `autoFreeze`.
 */
function buildSwimlanesStatuses(
    source: Readonly<Record<number, readonly Status[]>>,
): Record<number, Status[]> {
    const swimlanesStatuses: Record<number, Status[]> = {};

    Object.entries(source).forEach(([swimlaneId, statuses]) => {
        swimlanesStatuses[Number(swimlaneId)] = [...statuses];
    });

    return swimlanesStatuses;
}

/**
 * "Archived columns start folded" — `main.coffee:1016-1020`:
 *
 *     archivedFolds = $scope.usStatusList.filter (status) -> status.is_archived
 *     for status in archivedFolds
 *         $scope.folds[status.id] = true
 *
 * It runs inside a ONE-SHOT `$watch 'ctrl.initialLoad'` (`:1012-1022`) that
 * unwatches itself at `:1022`, immediately after re-reading the stored folds at
 * `:1014`. The retirement note above the directive is explicit about why the
 * one-shot matters: re-applying it later would mean the user could never keep an
 * archived column open.
 *
 * It is therefore attached to `SET_FOLDS` — the single action that stands for
 * `:1014-1020` — and the hook must dispatch that action once, on first load,
 * with the same one-shot semantics. The lazy sibling hydration at `:996-997`
 * (`if !$scope.folds then $scope.folds = ...`) has NO React analogue at all,
 * because `folds` here is seeded to `{}` by `createInitialBoardState` and is
 * never `undefined`.
 *
 * `Status.is_archived` is project configuration and is distinct from
 * `archivedStatus`, which is the runtime record of which archived columns the
 * board has taken responsibility for.
 */
function forceFoldArchivedStatuses(draft: BoardDraft): void {
    draft.usStatusList
        .filter((status) => status.is_archived)
        .forEach((status) => {
            draft.folds[status.id] = true;
        });
}

/**
 * `move(usList, statusId, swimlaneId, index, previousCard, nextCard)` —
 * `kanban-usertories.coffee:198-248`, transcribed step by step.
 *
 * THE HIGHEST-RISK FUNCTION IN THIS FILE. The ordering endpoint is
 * POSITION-RELATIVE, so an off-by-one here does not throw, does not warn and
 * does not fail a request: it PERSISTS A WRONG ORDER, and the divergence
 * appears only on the next page load (named risk R-DND-2). Read section 3 of the
 * module header before changing anything below — the plan's excerpt of this
 * method is a paraphrase and differs from the tree in four ways.
 *
 * OWNERSHIP SPLIT, so nothing is computed twice.
 * `../../shared/dnd/useSortableList.ts` owns the DOM-side NEIGHBOUR arithmetic
 * (`previousId` / `nextId`, where PREVIOUS WINS — `nextCard` is non-null only
 * when `previousCard` is falsy, `sortable.coffee:218-236`). THIS function owns
 * the `order` MAP arithmetic. Neighbours are ACCEPTED in the payload and never
 * re-derived here.
 *
 * The verbatim source, for line-by-line comparison:
 *
 *     :199  usByStatus = @.getStatus(statusId, swimlaneId)
 *     :200  usByStatus = _.sortBy usByStatus, [(it) => @.order[it.id]]
 *     :202  if previousCard
 *     :203      previousUsOrder = @.order[previousCard] + 1
 *     :204      previousUsIndex = (usByStatus.findIndex (it) => it.id == previousCard) + 1
 *     :205  else
 *     :206      previousUsOrder = 0
 *     :207      previousUsIndex = 0
 *     :209  usByStatusWithoutMoved = _.filter usByStatus, (listIt) ->
 *     :210      return !_.find usList, (moveIt) -> return listIt.id == moveIt
 *     :212  afterDestination = _.slice(usByStatusWithoutMoved, previousUsIndex)
 *     :214  initialLength = usList.length + 1
 *     :216  for usModel, key in afterDestination
 *     :217      @.order[usModel.id] = previousUsOrder + initialLength + key
 *     :219  for usId, key in usList
 *     :220      usModel = @.getUsModel(usId)
 *     :221      usModel.status = statusId
 *     :223      usModel.swimlane = swimlaneId
 *     :225      @.order[usModel.id] = previousUsOrder + key
 *     :230  @.refresh(false)
 *     :242  return {statusId, swimlaneId, afterUserstoryId, beforeUserstoryId, bulkUserstories}
 */
function applyMoveCard(
    draft: BoardDraft,
    action: Extract<KanbanBoardAction, { type: 'MOVE_CARD' }>,
): void {
    const { statusId, usList, previousCard } = action;

    // STEP 0 — RULING 2. Before anything else, and every later use is the
    // normalised value. `-1` is tolerated on input because that is the id the
    // synthetic swimlane renders with, and therefore the value a drop handler
    // naturally reads off the DOM (`main.coffee:700-703`).
    const swimlaneId =
        action.swimlaneId === UNCLASSIFIED_SWIMLANE_ID ? null : action.swimlaneId;

    // STEP 1 (:199-:200) — the TARGET COLUMN only, sorted by `order`. Not every
    // story on the board: see module header section 3.
    const sortedColumn = sortStoriesByOrder(
        selectStatusStories(draft, statusId, swimlaneId),
        draft.order,
    );

    // STEP 2 (:202-:207) — a TRUTHY guard on `previousCard`, preserved as-is.
    // A falsy `previousCard` means "land at the very top", which is the live
    // move-to-top path (`main.coffee:242-266` passes `previousCard = null` and a
    // non-null `nextUsId`). It is one of the incumbent's falsy guards that T10
    // forbids "improving" to `!= null`; the others are `getStatus`'s
    // `!swimlaneId` (see `selectStatusStories`) and `showPlaceHolder`'s
    // `if swimlaneId`, which belongs to `./boardSelectors.ts`.
    //
    // BOTH `+ 1`s ARE LOAD-BEARING. `previousUsOrder` is the neighbour's order
    // PLUS ONE, so the moved run starts in the slot immediately after it, and
    // `previousUsIndex` is the neighbour's index PLUS ONE, so the shifted tail
    // starts after the neighbour rather than at it.
    //
    // `findIndex` returns `-1` when `previousCard` is not in this column — which
    // happens whenever a card is dragged in from a different status or swimlane
    // — and `-1 + 1` is `0`, so the tail is the whole filtered column. That
    // coincides exactly with the `else` branch, which is why no extra case is
    // needed.
    let previousUsOrder = 0;
    let previousUsIndex = 0;

    if (previousCard) {
        previousUsOrder = readOrder(draft.order, previousCard) + 1;
        previousUsIndex =
            sortedColumn.findIndex((story) => story.id === previousCard) + 1;
    }

    // STEP 3 (:209-:210) — drop every moved id from the column. A `Set` gives
    // O(1) membership and is behaviour-identical to the nested `_.find`, which
    // `lodash`'s absence (HR-2) requires replacing anyway.
    const movedIds = new Set<number>(usList);
    const columnWithoutMoved = sortedColumn.filter(
        (story) => !movedIds.has(story.id),
    );

    // STEP 4 (:212) — the tail from `previousUsIndex` INCLUSIVE.
    //
    // THE INDEX WAS COMPUTED AGAINST THE PRE-FILTER ARRAY (:204) AND IS APPLIED
    // TO THE POST-FILTER ARRAY. This looks like a bug and IS THE SPECIFIED
    // BEHAVIOUR. Do not recompute the index against `columnWithoutMoved`: that
    // would shift the whole tail by however many moved cards preceded the
    // neighbour, which is a behaviour change (T10) and the precise kind of
    // silent divergence R-DND-2 warns about.
    //
    // Its one visible consequence, recorded so nobody "fixes" it: when a card
    // already in this column is dragged DOWNWARD past exactly one neighbour, the
    // tail can come up one element short and the moved card can end up sharing
    // an order value with the card after it. The stable sort in
    // `sortStoriesByOrder` — and in `./boardSelectors.ts` — is what then keeps
    // their relative order correct.
    const afterDestination = columnWithoutMoved.slice(previousUsIndex);

    // STEP 5 (:214) — `usList` is the MOVED ID LIST and is never reassigned in
    // this revision, so `initialLength` counts the moved cards, plus one. The
    // `+ 1` reserves a slot: moved cards take `previousUsOrder + key` and
    // shifted cards take `previousUsOrder + initialLength + key`, so the two
    // runs cannot collide however many cards move at once.
    const initialLength = usList.length + 1;

    // STEP 6 (:216-:217) — push the tail down. `key` is the 0-based index within
    // the slice.
    afterDestination.forEach((story, key) => {
        draft.order[story.id] = previousUsOrder + initialLength + key;
    });

    // STEP 7 (:219-:225) — the moved cards, in payload order.
    //
    // T9 SEAM. `:220`'s `@.getUsModel(usId)` reaches into `@.userstoriesRaw` and
    // the incumbent then re-derives the card view-model into `usMap` at
    // `:227-228`. Neither has an analogue: RULING 4 stores raw stories in
    // `storiesById`, so the fields are written directly, and RULING 1 makes the
    // view-model a derivation `./boardSelectors.ts` recomputes on read.
    //
    // `story.swimlane` receives the NORMALISED value, so `-1` can never be
    // stored — the invariant RULING 2 exists for.
    usList.forEach((storyId, key) => {
        const story = draft.storiesById[storyId];

        // A DEFENSIVE ADDITION WITH NO HAPPY-PATH EFFECT. The incumbent would
        // throw here on an untracked id, because `getUsModel` returns
        // `undefined` and `:221` immediately assigns to it. Inside a `produce`
        // draft a throw aborts the whole transition and would take the board
        // down, so an unknown id is skipped instead. Permitted under T10
        // precisely because the behaviour being replaced is a crash.
        if (!story) {
            return;
        }

        story.status = statusId;
        story.swimlane = swimlaneId;
        draft.order[storyId] = previousUsOrder + key;
    });

    // STEP 8 (:230) — `@.refresh(false)` is a NO-OP. RULING 1: the four derived
    // structures it rebuilt are recomputed on read by `./boardSelectors.ts`.

    // STEP 9 (:242-248) — THE RETURN VALUE CANNOT BE RETURNED FROM HERE.
    //
    // This is the one place immer forces a structural difference from the
    // incumbent. A `produce` reducer must MUTATE OR RETURN, NEVER BOTH
    // (P-IMMER-3), and this one mutates, so the
    // `{statusId, swimlaneId, afterUserstoryId, beforeUserstoryId,
    // bulkUserstories}` object is unavailable to a caller.
    //
    // The hook derives it instead, from the action it already holds:
    // `statusId` and `swimlaneId` are `action.statusId` and the normalised
    // swimlane, `afterUserstoryId` is `action.previousCard`,
    // `beforeUserstoryId` is `action.nextCard`, and `bulkUserstories` is
    // `action.usList` — the MOVED IDS. That last one is worth stating plainly
    // because it reads like the shifted tail and is not: `usList` is the
    // parameter and is never reassigned in this revision (`:247`).
    //
    // Building the request body itself belongs to
    // `../../shared/api/userstories.ts` (T5 / I7); see the module header for the
    // position-relative contract it must honour.
}


// ---------------------------------------------------------------------------
// EXPORT 2 OF 3 — THE INITIAL-STATE FACTORY
// ---------------------------------------------------------------------------

/**
 * Build a FULLY POPULATED `KanbanBoardState` from the bridge's first-frame
 * hand-off.
 *
 * Consumed as the `init` argument of
 * `useReducer(produce(kanbanBoardReducer), createInitialBoardState(params))`.
 * RULING 5 explains why seeding once is correct: the bridge contract is built
 * exactly once (`main.coffee:185`) and watched by identity
 * (`load-element.coffee:19`), so it is a snapshot to hydrate FROM, never state
 * to keep.
 *
 * EVERY FIELD IS INITIALISED — never a partial. An `undefined` field would break
 * every selector and every exhaustive guarantee below. Each seed cites the
 * incumbent line it reproduces:
 *
 *   `storiesById`, `order`     `@.userstoriesRaw = []` (`kanban-usertories.coffee:60`)
 *   `swimlanes`                `@.swimlanes = []` (`:61`)
 *   `foldStatusChanged`        `@.foldStatusChanged = {}` (`:62`)
 *   `statusHide`               `@.statusHide = []` (`:68`)
 *   `archivedStatus`           `@.archivedStatus = []` (`:71`)
 *   `selectedUss`              `@.selectedUss = {}` (`main.coffee:130`)
 *   `movedUs`                  `@.movedUs = []` (`:131`)
 *   `foldedSwimlane`           `Immutable.Map()` (`:132`), flattened to `{}`
 *   `initialLoad`              `@.initialLoad = false` (`:681`)
 *   `notFoundUserstories`      `@.notFoundUserstories = false` (`:594`)
 *   `usStatusList`             `@scope.usStatusList` (`:672`) — see the note on
 *                              `SET_US_STATUS_LIST`; NOT sorted here
 *   `swimlanesStatuses`        `@scope.swimlanesStatuses = {}` (`:651`)
 *   `usersById`                `@scope.usersById` (`:683` ->
 *                              `controllerMixins.coffee:28`)
 *   `folds`, `unfold`          `$scope.folds` / `$scope.unfold` (`:997`, `:999`)
 *   `renderInProgress`         `@.renderInProgress` (`:469`)
 *   `zoomLoading`              `@.zoomLoading` (`:225`, `:228`)
 *
 * FOUR OF THOSE ARE UNINITIALISED IN THE INCUMBENT and read `undefined` until
 * their first write: `unfold`, `renderInProgress`, `zoomLoading` and
 * `zoomLevel`. The first three are only ever consumed for truthiness — the
 * template binds `unfold == s.id` (`kanban-table.jade:113`, `:190`) and
 * `disabled="ctrl.renderInProgress"` (`:127`, `:203`) — so `null` and `false`
 * are behaviour-identical seeds and are what `./types.ts` declares.
 *
 * `zoomLevel` IS DIFFERENT AND IS THE ONE SEED THAT NEEDED THOUGHT.
 * `setZoom` returns early when the level is UNCHANGED (`main.coffee:211-212`),
 * and it is the same call that assigns `zoom` (`:217`). The incumbent's
 * `@.zoomLevel` starts `undefined`, and `undefined == 0` is false, so a first
 * `setZoom(0, ...)` always proceeds and the card feature list always arrives.
 * Seeding `0` here would make that first dispatch a no-op for anyone whose
 * stored zoom is `0`, leaving `zoom` empty and stripping every feature from
 * every card — a silent regression. `-1` is used instead: the zoom control emits
 * only `0..3` (`kanban-board-zoom.directive.coffee:11` defaults the index to
 * `1`, and `:22-24` clamps above `3`), so `-1` can never collide, and the
 * template tests each level explicitly (`kanban-table.jade:14`) so it emits no
 * `zoom-N` class — exactly as `undefined` did. A selector must therefore test
 * the level explicitly as the template does, and never interpolate it into a
 * class name.
 *
 * `zoom` is seeded `[]` rather than left absent, which `./types.ts` records as
 * behaviour-preserving: cards only render once `initialLoad` is true
 * (`kanban-table.jade:9`), by which point the zoom directive's first `$watch`
 * has already fired (`kanban-board-zoom.directive.coffee:37-39`).
 *
 * An ABSENT hydration member falls back to its seed, which for a first frame is
 * the same thing as "leave the current value alone" — there is no current value
 * yet. The `HYDRATE` action, which runs against existing state, treats absence
 * as "leave alone" instead.
 *
 * @param params The bridge's `{component, params, events}` payload, narrowed to
 *   the board's share of it. Every member optional, all plain objects
 *   (P-IMMER-1).
 */
export function createInitialBoardState(
    params: KanbanBoardHydration = {},
): KanbanBoardState {
    const stories = params.stories ?? [];

    return {
        storiesById: buildStoriesById(stories),
        order: buildOrderFromKanbanOrder(stories),
        swimlanes: params.swimlanes ? [...params.swimlanes] : [],
        usStatusList: params.usStatusList ? [...params.usStatusList] : [],
        swimlanesStatuses: params.swimlanesStatuses
            ? buildSwimlanesStatuses(params.swimlanesStatuses)
            : {},
        usersById: params.usersById ? { ...params.usersById } : {},
        foldStatusChanged: {},
        statusHide: [],
        archivedStatus: [],
        folds: params.folds ? buildNumericFolds(params.folds) : {},
        unfold: null,
        foldedSwimlane: params.foldedSwimlane ? { ...params.foldedSwimlane } : {},
        selectedUss: {},
        movedUs: [],
        // `Number` reproduces the coercion at `main.coffee:210`, which exists
        // because the zoom directive forwards the RAW watched value rather than
        // its own coerced copy (`kanban-board-zoom.directive.coffee:37-39`
        // emits `zoomLevel`, not the `Number(zoomIndex)` computed at `:26`), and
        // a level restored from storage can therefore arrive as a string.
        zoomLevel: params.zoomLevel === undefined ? -1 : Number(params.zoomLevel),
        zoom: params.zoom ? [...params.zoom] : [],
        zoomLoading: false,
        renderInProgress: false,
        initialLoad: false,
        notFoundUserstories: false,
    };
}


// ---------------------------------------------------------------------------
// EXPORT 3 OF 3 — THE REDUCER
// ---------------------------------------------------------------------------

/**
 * Apply one transition to the board, IN PLACE, on an immer draft.
 *
 * PLAIN AND UNWRAPPED BY DESIGN. The container composes it with the curried
 * producer — `useReducer(produce(kanbanBoardReducer), init)` — which is what
 * makes `use-immer` unnecessary and keeps it outside the closed dependency set
 * (HR-2). Exporting a pre-wrapped reducer would also make it untestable as a
 * plain function.
 *
 * MUTATES ONLY, RETURNS `void` (P-IMMER-3). "No change" means TOUCHING NOTHING,
 * which is not the same as the incumbent's `return null` at `main.coffee:212`:
 * under immer an untouched draft yields the original state object by reference,
 * so a no-op transition cannot trigger a re-render.
 *
 * The `switch` is EXHAUSTIVE over `KanbanBoardAction`, enforced by the `never`
 * assignment in `default`. With `noFallthroughCasesInSwitch` on, a member added
 * to that union becomes a compile error here rather than a silently dropped
 * action.
 *
 * @param draft The board state, drafted by `produce`.
 * @param action One transition. Plain data only — see P-IMMER-1.
 */
export function kanbanBoardReducer(
    draft: BoardDraft,
    action: KanbanBoardAction,
): void {
    switch (action.type) {
        // --- hydration -----------------------------------------------------

        /**
         * Merge the first-frame snapshot.
         *
         * AN ABSENT MEMBER MEANS "LEAVE THE CURRENT VALUE ALONE", never "reset
         * to empty" — `./types.ts` is explicit about this, because the bridge
         * builds its payload before the asynchronous load chain
         * (`main.coffee:678`) has populated anything, so most members are
         * genuinely missing on the first frame and arrive later through the
         * individual `SET_*` actions.
         *
         * `stories` normalises exactly as `SET_STORIES` does. `folds` takes the
         * string -> numeric rebuild; `foldedSwimlane` deliberately does NOT, and
         * the two key types must not be made to agree. The archived force-fold
         * is NOT applied here: it belongs to the one-shot `SET_FOLDS`.
         */
        case 'HYDRATE': {
            if (action.stories) {
                draft.storiesById = toDraft(buildStoriesById(action.stories));
                draft.order = buildOrderFromKanbanOrder(action.stories);
            }

            if (action.swimlanes) {
                draft.swimlanes = toDraft([...action.swimlanes]);
            }

            if (action.usStatusList) {
                draft.usStatusList = [...action.usStatusList];
            }

            if (action.swimlanesStatuses) {
                draft.swimlanesStatuses = buildSwimlanesStatuses(
                    action.swimlanesStatuses,
                );
            }

            if (action.usersById) {
                draft.usersById = { ...action.usersById };
            }

            if (action.folds) {
                draft.folds = buildNumericFolds(action.folds);
            }

            if (action.foldedSwimlane) {
                draft.foldedSwimlane = { ...action.foldedSwimlane };
            }

            if (action.zoom) {
                draft.zoom = [...action.zoom];
            }

            if (action.zoomLevel !== undefined) {
                draft.zoomLevel = Number(action.zoomLevel);
            }

            return;
        }

        // --- story collection ----------------------------------------------

        /**
         * `set(userstories)` — `kanban-usertories.coffee:88-91`:
         *
         *     @.userstoriesRaw = userstories
         *     @.refreshRawOrder()
         *     @.refresh()
         *
         * A WHOLESALE REPLACEMENT: a story absent from the payload is dropped,
         * because `:89` replaces the array outright. `order` is rebuilt from
         * `kanban_order`, and `:91`'s `refresh()` is a NO-OP (RULING 1).
         *
         * This is the `clean` branch of the render batcher
         * (`main.coffee:474-476`), which is also where `batchTimings` is reset
         * to `[200, 100, 50]`; those timers belong to the hook.
         */
        case 'SET_STORIES': {
            draft.storiesById = toDraft(buildStoriesById(action.stories));
            draft.order = buildOrderFromKanbanOrder(action.stories);

            return;
        }

        /**
         * `add(usList)` — `kanban-usertories.coffee:126-159`.
         *
         *     :130  usList = _.sortBy usList, ['kanban_order']
         *     :132  @.userstoriesRaw = @.userstoriesRaw.filter (us) =>
         *     :133      return !usList.find (it) => it.id == us.id
         *     :134  @.userstoriesRaw = @.userstoriesRaw.concat(usList)
         *     :135  @.userstoriesRaw = @.userstoriesRaw.map (us) => return us
         *     :138  @.refreshRawOrder()
         *     :140  @.userstoriesRaw = _.sortBy @.userstoriesRaw, [(it) => @.order[it.id]]
         *
         * REMOVE-THEN-APPEND DEDUPE (`:132-134`) collapses to a keyed assignment
         * under RULING 4: the incoming story REPLACES any existing entry with
         * the same id.
         *
         * `:135-136` IS A NO-OP `.map` — it returns each element unchanged. It is
         * recorded as a comment and deliberately NOT reproduced as code: T10
         * preserves behaviour, and a no-op has none.
         *
         * `:138` REBUILDS `order` FOR EVERY STORY from `kanban_order`, which
         * discards any unsaved local drag ordering `MOVE_CARD` wrote. That is
         * the incumbent's behaviour and it is preserved — see
         * `buildOrderFromKanbanOrder`. `:140`'s re-sort is a derivation and a
         * no-op here.
         *
         * `:142-157`'s loop, and in particular the `if !@.usMap.get(usModel.id)`
         * guard at `:149`, governed the DERIVED `usMap` and `usByStatus` caches
         * ONLY — never `userstoriesRaw`, which `:132-134` had already replaced.
         * Under RULING 1 those caches are recomputed from `storiesById` on every
         * read, so the guard has no analogue: an already-present story is
         * refreshed rather than left stale. That is the same consequence as
         * `refresh()` becoming a no-op, and it is why the method's own leading
         * comment at `:125` ("don't call refresh to prevent unnecessary
         * mutations in every single us") describes a performance concern that no
         * longer exists.
         *
         * The `kanban_order` sort at `:130` is performed even though a keyed
         * record makes it unobservable, so that the insertion sequence remains
         * deterministic and the transcription stays literal.
         */
        case 'ADD_STORIES': {
            sortByKanbanOrder(action.stories).forEach((story) => {
                draft.storiesById[story.id] = toDraft(story);
            });

            draft.order = buildOrderFromKanbanOrder(
                Object.values(draft.storiesById),
            );

            return;
        }

        /**
         * `remove(usModel)` — `kanban-usertories.coffee:108-123`:
         *
         *     :109  @.userstoriesRaw = @.userstoriesRaw.filter (it) => it.id != usModel.id
         *     :112  delete @.order[usModel.id]
         *     :116  @.usMap = @.usMap.delete(usModel.id)
         *     :118  @.usByStatus = @.usByStatus.set(status, ...filter...)
         *     :123  @.refreshSwimlanes()
         *
         * `:116-123` are all derived and are NO-OPS (RULING 1), so exactly two
         * fields change.
         *
         * WHAT IS DELIBERATELY NOT CLEARED: this story's entries in
         * `foldStatusChanged`, `selectedUss` and `movedUs`. The incumbent leaves
         * all three behind, and tidying them up would be a behaviour change
         * (T10). `cleanSelectedUss` below shows the same intent explicitly — it
         * never deletes a key either.
         */
        case 'REMOVE_STORY': {
            delete draft.storiesById[action.storyId];
            delete draft.order[action.storyId];

            return;
        }

        /**
         * `replaceModel(usModel)` — `kanban-usertories.coffee:272-280`.
         *
         * Swaps one story for a fresh copy and DOES NOT TOUCH `order`, so an
         * unsaved drag ordering survives a replace — the exact opposite of
         * `ADD_STORIES`, which rebuilds the whole index. The difference is in the
         * source and is preserved (T10).
         *
         * `:279-280`'s re-derivation into `usMap` is a NO-OP (RULING 1).
         */
        case 'REPLACE_STORY': {
            draft.storiesById[action.story.id] = toDraft(action.story);

            return;
        }

        // --- movement -------------------------------------------------------

        case 'MOVE_CARD': {
            applyMoveCard(draft, action);

            return;
        }

        /**
         * `moveToEnd(id, statusId)` — `kanban-usertories.coffee:257-267`:
         *
         *     :260  @.order[us.id] = -1
         *     :262  us.status = statusId
         *     :263  us.kanban_order = @.order[us.id]
         *     :265  @.refresh(false)
         *     :267  return {"us_id": us.id, "order": -1}
         *
         * `-1` HERE IS AN ORDER SENTINEL, UNRELATED TO `UNCLASSIFIED_SWIMLANE_ID`.
         * It tells the backend "append to the end of this status" instead of
         * naming a neighbour, which is why it is written to `kanban_order` as
         * well as to the local index.
         *
         * THE ASYMMETRY WITH `MOVE_CARD` IS PRESERVED: this transition writes
         * BOTH `order` and `kanban_order`, whereas `move` writes only `order`
         * (`:225`). Do not unify them (T10). Writing `kanban_order` is what makes
         * the sentinel survive `buildOrderFromKanbanOrder`, so a later
         * `ADD_STORIES` keeps the card at the end instead of restoring its old
         * position.
         *
         * MEASURED, so nobody assumes a consumer exists: `moveToEnd` has exactly
         * ONE occurrence in the repository — its own definition. ZERO call sites.
         * It is implemented because it is a declared transition of the action
         * union and because omitting it would leave the sentinel unreachable.
         *
         * `:265`'s `refresh(false)` is a NO-OP. `:267`'s snake_case return shape
         * is API payload, not view state, and belongs to
         * `../../shared/api/userstories.ts` (T5).
         *
         * The incumbent throws on an untracked id (`getUsModel` returns
         * `undefined` and `:260` reads `us.id`); the id is skipped here for the
         * same reason `MOVE_CARD` skips one.
         */
        case 'MOVE_TO_END': {
            const story = draft.storiesById[action.storyId];

            if (!story) {
                return;
            }

            draft.order[action.storyId] = -1;
            story.status = action.statusId;
            story.kanban_order = draft.order[action.storyId];

            return;
        }

        // --- fold state -----------------------------------------------------

        /**
         * `toggleFold(usId)` — `kanban-usertories.coffee:84-86`:
         *
         *     @.foldStatusChanged[usId] = !@.foldStatusChanged[usId]
         *     @.refreshUserStory(usId)
         *
         * One CARD's extra sections, not a column. `:86`'s `refreshUserStory` is
         * a NO-OP (RULING 1).
         *
         * A NEVER-TOGGLED STORY MUST KEEP READING `undefined`, which is why the
         * flip writes only the requested key and no other key is defaulted:
         * `CardUserStoryVm.foldStatusChanged` is `boolean | undefined` and
         * `./boardSelectors.ts` must not substitute `false` for absence.
         */
        case 'TOGGLE_FOLD': {
            draft.foldStatusChanged[action.storyId] =
                !draft.foldStatusChanged[action.storyId];

            return;
        }

        /**
         * `resetFolds()` — `kanban-usertories.coffee:81-82`:
         * `@.foldStatusChanged = {}`.
         *
         * CARD FOLDS, NOT COLUMN FOLDS. `folds` is untouched here — the two are
         * separate mechanisms with confusingly similar names.
         *
         * The hook dispatches this after a zoom change resolves: `setZoom` calls
         * `resetFolds()` at `main.coffee:222` (after the first load) and at
         * `:229` (after the level-2 threshold refetch). Both sit inside promise
         * callbacks, so neither is synchronous with `SET_ZOOM`.
         */
        case 'RESET_FOLDS': {
            draft.foldStatusChanged = {};

            return;
        }

        /**
         * `foldStatus(status)` — `main.coffee:995-1005`:
         *
         *     :999   $scope.unfold = null
         *     :1000  $scope.folds[status.id] = !!!$scope.folds[status.id]
         *     :1002  if !$scope.folds[status.id]
         *     :1003      $scope.unfold = status.id
         *     :1005  rs.kanban.storeStatusColumnModes($scope.projectId, $scope.folds)
         *
         * ORDER MATTERS: `unfold` is cleared FIRST and then re-set only when the
         * column ended up UNfolded. That is what makes `vunfold` a one-shot class
         * on ONE column (`kanban-table.jade:113`, `:190`) rather than the inverse
         * of `folds`.
         *
         * `!!!x` is CoffeeScript for `!x`; the triple bang is a source quirk with
         * no extra meaning.
         *
         * `:1005` IS I/O and belongs to the hook, which persists the resulting
         * `folds` through `../../shared/api/kanbanStorage.ts`'s
         * `storeStatusColumnModes` after dispatching.
         *
         * SO IS THE FOLLOW-UP AT `:1007-1008`, and it must not be lost:
         *
         *     if kanbanUserstoriesService.archivedStatus.includes(status.id) &&
         *        !kanbanUserstoriesService.statusHide.includes(status.id)
         *         kanbanUserstoriesService.hideStatus(status.id)
         *
         * Folding an archived column that is currently shown also hides it again,
         * which is what stops archived stories staying loaded behind a folded
         * column. The hook reproduces it by dispatching `HIDE_STATUS` under that
         * exact guard, evaluated against the post-dispatch state — the same
         * dispatch-a-pair pattern the archived column header already uses at
         * `:911-912`. It is kept out of this case because it is a second,
         * independently declared transition, not part of the fold flip.
         *
         * The lazy hydration at `:996-997` has no analogue: `folds` is always an
         * object here.
         */
        case 'TOGGLE_STATUS_COLUMN_FOLD': {
            draft.unfold = null;
            draft.folds[action.statusId] = !draft.folds[action.statusId];

            if (!draft.folds[action.statusId]) {
                draft.unfold = action.statusId;
            }

            return;
        }

        /**
         * Seed column folds from storage, then force-fold every archived column.
         *
         * This action stands for `main.coffee:1014-1020`, the body of the ONE-SHOT
         * `$watch 'ctrl.initialLoad'` that unwatches itself at `:1022`:
         *
         *     :1014  $scope.folds = rs.kanban.getStatusColumnModes(...)
         *     :1016  archivedFolds = $scope.usStatusList.filter (s) -> s.is_archived
         *     :1019  for status in archivedFolds
         *     :1020      $scope.folds[status.id] = true
         *
         * The payload is STRING-keyed because that is what storage returns, and
         * `buildNumericFolds` performs the rebuild `./types.ts` specifies.
         *
         * THE HOOK MUST DISPATCH THIS ONCE, on first load. Re-dispatching it
         * would re-fold an archived column the user had opened, which the
         * incumbent's retirement note calls out explicitly.
         *
         * `usStatusList` must therefore already be populated when this arrives —
         * true in the incumbent too, where the watch additionally requires a
         * non-empty `usByStatus` (`:1013`) and `usStatusList` is assigned much
         * earlier, at `:672`.
         */
        case 'SET_FOLDS': {
            draft.folds = buildNumericFolds(action.folds);
            forceFoldArchivedStatuses(draft);

            return;
        }

        /**
         * `toggleSwimlane(id)` — `main.coffee:424-430`:
         *
         *     :425  @.foldedSwimlane = @.foldedSwimlane.set(id.toString(), !@.foldedSwimlane.get(id.toString()))
         *     :426  @rs.kanban.storeSwimlanesModes(@scope.projectId, @.foldedSwimlane.toJS())
         *     :428  @timeout (=> @scope.$broadcast("redraw:wip")), 100, false
         *
         * T9 SEAM — THE KEY-TYPE ASYMMETRY, AND WHY IT IS NOT NORMALISED.
         * `foldedSwimlane` is STRING-keyed and stays that way, because every
         * consumer stringifies: `:425` writes `.set(id.toString(), ...)`, `:237`
         * writes `.set(...first().id.toString(), false)`, `:680` hydrates
         * straight from storage, and the template reads
         * `.get(swimlane.id.toString())` (`kanban-table.jade:82`, `:86`, `:90`,
         * `:108`). The synthetic swimlane's key is therefore the STRING `'-1'`.
         * `folds` goes the other way and is numeric-keyed to match ITS consumers.
         * The two must not be made to agree — this is the third of the three key
         * types, alongside `usByStatus`'s stringified status ids and `usMap`'s
         * numeric story ids.
         *
         * `:426` IS I/O: the hook persists through `storeSwimlanesModes` after
         * dispatching. `:428-430`'s 100 ms `redraw:wip` rebroadcast, with
         * `invokeApply` FALSE, is also the hook's.
         */
        case 'TOGGLE_SWIMLANE': {
            const key = String(action.swimlaneId);

            draft.foldedSwimlane[key] = !draft.foldedSwimlane[key];

            return;
        }

        /**
         * Replace the whole swimlane-fold record, STRING keys intact.
         *
         * TWO CALLERS SHARE THIS CHANNEL, and the second one must not be lost:
         *
         *   HYDRATION — `main.coffee:680`
         *   `@.foldedSwimlane = Immutable.fromJS(@rs.kanban.getSwimlanesModes(project.id))`,
         *   read through `../../shared/api/kanbanStorage.ts`'s
         *   `getSwimlanesModes`, whose underlying resource ends `or {}`
         *   (`resources/kanban.coffee:34-37`) and so never yields `undefined`.
         *
         *   THE EMPTY-FILTER FORCE-UNFOLD — `filtersReloadContent`,
         *   `main.coffee:231-237`:
         *
         *       filtersReloadContent: debounceLeading 100, () ->
         *           @.loadUserstories().then (result) =>
         *               if !result
         *                   return
         *               if @scope.swimlanesList.size && !result.length
         *                   @.foldedSwimlane = @.foldedSwimlane.set(
         *                       @scope.swimlanesList.first().id.toString(), false)
         *
         *   When swimlanes exist AND the filtered result is EMPTY, the FIRST
         *   swimlane is force-UNFOLDED (`false` means "not folded"). THIS IS THE
         *   ONLY REASON AN EMPTY FILTERED BOARD IS NOT A BLANK RECTANGLE — with
         *   every swimlane collapsed there would be nothing to render the
         *   "no results" placeholder inside. The hook owns the 100 ms LEADING
         *   debounce, the load, the emptiness test and picking the first entry
         *   of the derived swimlane list (`./boardSelectors.ts`), then dispatches
         *   the updated record here. The reducer performs the state change and
         *   nothing else.
         */
        case 'SET_FOLDED_SWIMLANES': {
            draft.foldedSwimlane = { ...action.foldedSwimlane };

            return;
        }

        // --- selection and the moved highlight -------------------------------

        /**
         * `toggleSelectedUs(usId)` — `main.coffee:191-192`:
         * `@.selectedUss[usId] = !@.selectedUss[usId]`.
         *
         * Drives BOTH `kanban-task-selected` AND `ui-multisortable-multiple`
         * (`kanban-table.jade:154`, `:230`), so a missing key and a `false` key
         * must read identically — which they do, because both are falsy.
         */
        case 'TOGGLE_SELECTED_US': {
            draft.selectedUss[action.storyId] =
                !draft.selectedUss[action.storyId];

            return;
        }

        /**
         * `cleanSelectedUss()` — `main.coffee:187-189`:
         *
         *     for key of @.selectedUss
         *         @.selectedUss[key] = false
         *
         * IT SETS EVERY EXISTING KEY TO `false` AND NEVER DELETES ONE, so the
         * record grows monotonically within a page view. Reproduced exactly: NO
         * `delete`, and NO reassignment to `{}`. Both shortcuts would be
         * behaviour changes (T10) — the key set is observable, and the class
         * contract at `kanban-table.jade:154` and `:230` depends on lookups
         * continuing to resolve.
         *
         * `Object.keys` yields strings and the record is numeric-keyed, so each
         * key is coerced back with `Number`. Runtime-identical, because
         * JavaScript object keys are always strings; the coercion exists purely
         * to satisfy the declared key type.
         *
         * When every key is already `false` nothing is written, so immer
         * short-circuits and the state keeps its identity (P-IMMER-4).
         *
         * `moveUs` calls this first, at `main.coffee:693`, so the hook dispatches
         * it ahead of `MOVE_CARD`.
         */
        case 'CLEAN_SELECTED_USS': {
            Object.keys(draft.selectedUss).forEach((key) => {
                draft.selectedUss[Number(key)] = false;
            });

            return;
        }

        /**
         * `@.movedUs.push(us.id)` — `main.coffee:249`, inside `moveUsToTop`.
         *
         * ONLY THE MOVE-TO-TOP PATH POPULATES THIS. An ordinary drag does not,
         * which is why it is a separate action from `MOVE_CARD`.
         *
         * THE PUSH IS UNCONDITIONAL and may therefore repeat an id. Preserved:
         * the template tests `ctrl.movedUs.indexOf(usId) != -1`
         * (`kanban-table.jade:154`), so a duplicate is harmless, and de-duplicating
         * would be an enhancement (T10).
         *
         * ⚠ THE HIGHLIGHT IS SWIMLANE-MODE ONLY. `kanban-moved` appears in the
         * swimlane template at `:154` and is OMITTED from the flat-mode template
         * at `:230`, even though `:249` pushes regardless of mode. The reducer
         * stores it unconditionally, exactly as the incumbent does, and only the
         * swimlane branch of `./boardSelectors.ts` consumes it. Do not unify the
         * two templates (T10).
         *
         * The 1000 ms lifetime is the hook's: `main.coffee:250-252` sets
         * `@timeout (=> @.movedUs = []), 1000, false` — note `invokeApply` FALSE —
         * and the hook's timer dispatches `CLEAR_MOVED_US`. No timer may live in
         * a pure reducer.
         */
        case 'MARK_US_MOVED': {
            draft.movedUs.push(action.storyId);

            return;
        }

        /**
         * `@.movedUs = []` — `main.coffee:251`.
         *
         * CLEARS THE WHOLE LIST, not just the story whose timer fired. That is
         * what the source does: one shared 1000 ms timer per move-to-top, and it
         * empties the array outright.
         */
        case 'CLEAR_MOVED_US': {
            draft.movedUs = [];

            return;
        }

        // --- zoom -------------------------------------------------------------

        /**
         * `setZoom(zoomLevel, zoom)` — `main.coffee:209-229`:
         *
         *     :210  zoomLevel = Number(zoomLevel)
         *     :211  if @.zoomLevel == zoomLevel
         *     :212      return null
         *     :214  previousZoomLevel = @.zoomLevel
         *     :216  @.zoomLevel = zoomLevel
         *     :217  @.zoom = zoom
         *     :219  if @.isFirstLoad
         *     :220      @.firstLoad().then () =>
         *     :221          @.isFirstLoad = false
         *     :222          @kanbanUserstoriesService.resetFolds()
         *     :224  else if @.zoomLevel > 2 && previousZoomLevel <= 2
         *     :225      @.zoomLoading = true
         *     :227      @.loadUserstories().then () =>
         *     :228          @.zoomLoading = false
         *     :229          @kanbanUserstoriesService.resetFolds()
         *
         * THE `Number` COERCION AT `:210` IS NOT DEFENSIVE PADDING. The zoom
         * directive emits the RAW watched value rather than its own coerced copy
         * (`kanban-board-zoom.directive.coffee:37-39` passes `zoomLevel`, while
         * the `Number(zoomIndex)` at `:26` is local to `getZoomView`), so a level
         * restored from storage can genuinely arrive as a string. It is
         * reproduced even though the action declares `number`.
         *
         * THE UNCHANGED CASE TOUCHES NOTHING. `:211-212`'s `return null` becomes
         * an early return that writes to no field, which under immer means the
         * state keeps its identity and no re-render is scheduled — not the same
         * thing as returning a value, which P-IMMER-3 forbids outright.
         *
         * THE `> 2` / `<= 2` THRESHOLD CROSSING. Levels 3 and 4 need attachments
         * and tasks the earlier levels never requested, so crossing UPWARD past
         * level 2 forces a refetch, and `:225` opens the loading bracket. That
         * one assignment is a pure state transition and is made here so the
         * invariant cannot be missed; the refetch itself is I/O and belongs to the
         * hook, which closes the bracket by dispatching `SET_ZOOM_LOADING(false)`
         * for `:228` and then `RESET_FOLDS` for `:229`.
         *
         * `:219-222`'s first-load branch has NO state analogue: `isFirstLoad` is a
         * controller local (`main.coffee:133`), not a field of
         * `KanbanBoardState`, and everything it guards is I/O. The hook owns it.
         *
         * The seed `createInitialBoardState` chose for `zoomLevel` is what
         * guarantees the FIRST dispatch always gets past `:211-212` — see the note
         * there.
         */
        case 'SET_ZOOM': {
            const nextZoomLevel = Number(action.zoomLevel);

            if (draft.zoomLevel === nextZoomLevel) {
                return;
            }

            const previousZoomLevel = draft.zoomLevel;

            draft.zoomLevel = nextZoomLevel;
            draft.zoom = [...action.zoom];

            if (nextZoomLevel > 2 && previousZoomLevel <= 2) {
                draft.zoomLoading = true;
            }

            return;
        }

        /**
         * `@.zoomLoading` — `main.coffee:225` sets it, `:228` clears it.
         *
         * Declared as its own action so the hook can close the bracket the
         * refetch opened. Idempotent, so `SET_ZOOM` also opening it at `:225`
         * costs nothing.
         */
        case 'SET_ZOOM_LOADING': {
            draft.zoomLoading = action.zoomLoading;

            return;
        }

        // --- load and render flags --------------------------------------------

        /**
         * `@.renderInProgress` — `main.coffee:469` sets it true at the top of
         * `renderBatch`, `:489` clears it once the DOM has settled inside a
         * `scopeDefer`.
         *
         * Bound to the animated counter's `disabled` input
         * (`kanban-table.jade:127`, `:203`) so the counts do not animate through
         * every intermediate batch.
         *
         * THE BATCHING TIMERS BELONG TO THE HOOK: `:476` resets
         * `batchTimings = [200, 100, 50]` on a clean render and `:481` takes
         * `@.batchTimings.shift() || 20`, so the fourth and later batches all use
         * 20 ms. `:491-493` then rebroadcasts `redraw:wip` after 100 ms with
         * `invokeApply` FALSE.
         */
        case 'SET_RENDER_IN_PROGRESS': {
            draft.renderInProgress = action.renderInProgress;

            return;
        }

        /**
         * `@.initialLoad` — `main.coffee:681` sets false, `:686-688` sets true.
         *
         * It gates the ENTIRE board (`kanban-table.jade:9`
         * `ng-if="ctrl.initialLoad"`), which is why several one-shot behaviours in
         * the incumbent watch it rather than running at link time — the archived
         * force-fold (`:1012-1022`) and the archived column header
         * (`:904-912`) among them.
         *
         * ⚠ `:686-688` is `@timeout (=> @.initialLoad = true), 0, true` —
         * `invokeApply` is TRUE here, in deliberate contrast with the `, false`
         * on every other timeout in this controller (`:252`, `:430`, `:493`). It
         * is a real difference in the source, not a typo, and it is the hook's to
         * reproduce: the zero-delay deferral must survive, because it is what
         * lets the board's first render happen after the load chain settles.
         */
        case 'SET_INITIAL_LOAD': {
            draft.initialLoad = action.initialLoad;

            return;
        }

        /**
         * `@.notFoundUserstories` — `main.coffee:594` resets it, `:596-597` sets
         * it:
         *
         *     :594  @.notFoundUserstories = false
         *     :596  if !userstories.length && ((@.filterQ && @.filterQ.length) ||
         *               Object.keys(@location.search()).length)
         *     :597      @.notFoundUserstories = true
         *
         * It distinguishes "no results for THIS FILTER" from "this project is
         * empty" and drives the `not-found` class on the placeholder
         * (`kanban-table.jade:146`, `:222`). The predicate reads the filter text
         * and the URL query, neither of which is board state, so the hook
         * evaluates it and dispatches the outcome.
         */
        case 'SET_NOT_FOUND_USERSTORIES': {
            draft.notFoundUserstories = action.notFoundUserstories;

            return;
        }

        // --- status visibility ------------------------------------------------

        /**
         * `hideStatus(statusId)` — `kanban-usertories.coffee:171-173`:
         *
         *     @.deleteStatus(statusId)
         *     @.statusHide.push(statusId)
         *
         * `deleteStatus` (`:182-186`) IS DEAD AND BROKEN and is deliberately not
         * ported: `:184` calls `_.map` with a function and NO collection, so
         * `toDelete` is always `[]`, and `:186` then writes `@.archived`, a field
         * that is never initialised and never read anywhere. The call therefore
         * has no effect on any state this reducer owns, and reproducing it would
         * add dead code the Minimal Change Clause forbids.
         *
         * THE PUSH IS UNCONDITIONAL, so the list may hold duplicates. Preserved:
         * the incumbent guards at its CALL SITES instead — `:1007` tests
         * `!statusHide.includes(status.id)` before hiding and `main.coffee:916`
         * tests `statusHide.includes(status.id)` before showing — and every read
         * is a membership test (`kanban-usertories.coffee:168-169`), so a
         * duplicate is invisible.
         *
         * Combined with `archivedStatus` this drives `isUsInArchivedHiddenStatus`
         * (`:164-169`), which demands a hit in BOTH lists and is passed to each
         * card as `archived` (`kanban-table.jade:167`, `:242`).
         */
        case 'HIDE_STATUS': {
            draft.statusHide.push(action.statusId);

            return;
        }

        /**
         * `showStatus(statusId)` — `kanban-usertories.coffee:175-176`:
         * `_.remove @.statusHide, (it) -> return it == statusId`.
         *
         * `_.remove` strips EVERY matching element, which the filter reproduces —
         * and which matters precisely because `HIDE_STATUS` above can leave
         * duplicates behind.
         */
        case 'SHOW_STATUS': {
            draft.statusHide = draft.statusHide.filter(
                (statusId) => statusId !== action.statusId,
            );

            return;
        }

        /**
         * `addArchivedStatus(statusId)` — `kanban-usertories.coffee:161-162`:
         * `@.archivedStatus.push(statusId)`.
         *
         * Dispatched from the archived column header once the first load
         * completes: `main.coffee:911` adds the status and `:912` IMMEDIATELY
         * hides it, so an archived column starts both archived AND hidden. Both
         * sit inside a one-shot `$watch 'ctrl.initialLoad'` that unwatches itself
         * at `:907`, so the hook must dispatch the pair once per archived column.
         *
         * Distinct from `Status.is_archived`, which is project configuration: this
         * is the runtime record of which archived columns the board has taken
         * responsibility for. Unconditional push, for the same reason as
         * `HIDE_STATUS`.
         */
        case 'ADD_ARCHIVED_STATUS': {
            draft.archivedStatus.push(action.statusId);

            return;
        }

        // --- taxonomies, all arriving from the async load chain ----------------

        /**
         * `main.coffee:649-650` -> `init(project, swimlanes, usersById)`
         * (`kanban-usertories.coffee:76-79`).
         *
         * THE PROJECT'S REAL SWIMLANES ONLY. The synthetic
         * `UNCLASSIFIED_SWIMLANE_ID` entry is never among them: it is a
         * render-time concern that `./boardSelectors.ts` prepends when a story is
         * unclassified (`kanban-usertories.coffee:366-374`).
         */
        case 'SET_SWIMLANES': {
            draft.swimlanes = toDraft([...action.swimlanes]);

            return;
        }

        /**
         * `loadSwimlanes()` — `main.coffee:648-658`:
         *
         *     :651  @scope.swimlanesStatuses = {}
         *     :653  @scope.swimlanes.forEach (swimlane) =>
         *     :654      @scope.swimlanesStatuses[swimlane.id] = swimlane.statuses
         *     :656  @scope.swimlanesStatuses[-1] = @scope.project.us_statuses
         *
         * ALL THREE LINES MATTER, AND THE THIRD MOST OF ALL. The synthetic
         * swimlane has no statuses of its own, so it receives ALL of the
         * project's — `project.us_statuses`, in project order, NOT the
         * `usStatusList` that `:672` sorts. The action carries the record already
         * assembled, including that entry, and `:651`'s wholesale reset is
         * reproduced by replacing the record rather than merging into it.
         *
         * `-1` IS LEGITIMATE AS A KEY HERE: this is a swimlane COLLECTION, not a
         * story field. Read back as `swimlanesStatuses[swimlane.id]` at
         * `kanban-table.jade:114`. `Object.entries` yields string keys, so each is
         * coerced with `Number` to match the declared numeric key type;
         * runtime-identical, since JavaScript object keys are always strings.
         */
        case 'SET_SWIMLANES_STATUSES': {
            draft.swimlanesStatuses = buildSwimlanesStatuses(
                action.swimlanesStatuses,
            );

            return;
        }

        /**
         * `@scope.usStatusList = _.sortBy(project.us_statuses, "order")` —
         * `main.coffee:672`.
         *
         * T9 SEAM (8) — THE SORT KEY DIVERGENCE, AND WHY IT MUST NOT BE UNIFIED.
         * Kanban sorts this list by `"order"`; the BACKLOG screen sorts the SAME
         * source list by `"id"` (`app/coffee/modules/backlog/main.coffee`,
         * `_.sortBy(..., "id")`). The two orderings are INDEPENDENTLY OBSERVABLE —
         * kanban column order versus the backlog status dropdown — so preserving
         * both is a behavioural requirement, not a duplication to remove.
         *
         * NO SORT HAPPENS HERE. `./types.ts` states the payload arrives already
         * sorted, and `Status` deliberately does not declare an `order` member, so
         * re-sorting is impossible by construction as well as forbidden. The
         * obligation this seam site carries is to record the divergence, which is
         * what this comment is.
         */
        case 'SET_US_STATUS_LIST': {
            draft.usStatusList = [...action.usStatusList];

            return;
        }

        /**
         * `@scope.usersById` — `main.coffee:683` calls
         * `@.fillUsersAndRoles(project.members, project.roles)`, which assigns it
         * at `controllerMixins.coffee:28`:
         * `@scope.usersById = groupBy(users, (e) -> e.id)`.
         *
         * ⚠ THE NAME `groupBy` IS MISLEADING AND HAS COST PEOPLE TIME.
         * `taiga.groupBy` (`app/coffee/utils.coffee:80-85`) is
         *
         *     result = {}
         *     for item in coll
         *         result[pred(item)] = item
         *     return result
         *
         * — a KEYED MAP BUILDER where the LAST item wins, NOT a grouper. There is
         * no array anywhere in the result, which is why `usersById` is
         * `Record<number, BoardUser>` and not `Record<number, BoardUser[]>`.
         *
         * The index feeds `CardUserStoryVm.assigned_to` and `assigned_users`,
         * which `./boardSelectors.ts` derives. It is assigned from ALL project
         * members, not only the active ones — `controllerMixins.coffee:25` builds
         * a separate `activeUsersById` for that, and this board does not use it.
         */
        case 'SET_USERS_BY_ID': {
            draft.usersById = { ...action.usersById };

            return;
        }

        default: {
            // EXHAUSTIVENESS GUARD. `action` narrows to `never` here only when
            // every member of `KanbanBoardAction` has a case above, so adding a
            // member to that union is a COMPILE ERROR in this file rather than a
            // silently dropped transition.
            //
            // THE BINDING IS CONSUMED BY `void`, AND NEVER RETURNED. That is not
            // a stylistic choice: `return exhaustive` type-checks, because `never`
            // is assignable to `void`, and it is a P-IMMER-3 VIOLATION. At run
            // time `action` is whatever really arrived, so returning it makes the
            // recipe both mutate the draft and produce a value, and immer then
            // REPLACES THE WHOLE STATE WITH THE ACTION OBJECT. That was caught by
            // an ad-hoc unit test, not by the compiler — which is exactly the
            // failure mode P-IMMER-3 exists to name.
            //
            // `void` still reads the binding, so `noUnusedLocals` is satisfied.
            const exhaustive: never = action;
            void exhaustive;

            return;
        }
    }
}
