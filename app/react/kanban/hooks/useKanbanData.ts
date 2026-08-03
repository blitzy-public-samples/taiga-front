/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useKanbanData — the Kanban board's ONE data seam: every read and the single
 * write the board performs, expressed as a stable typed API over the AngularJS
 * services that already own the transport.
 *
 * It is the only module of the Kanban screen that resolves `$tgResources`, and
 * it owns exactly three things: service acquisition, model/persistent-structure
 * FLATTENING, and API routing. It computes no grouping, no card view-model and
 * no order map — those belong to `../state/boardReducer.ts` and
 * `../state/boardSelectors.ts` — and it holds no React state of its own, so the
 * board container decides what to do with everything it hands back.
 *
 * ===========================================================================
 * 1. WHAT THIS REPLACES (transformation rule T9)
 * ===========================================================================
 * The data-fetching half of `KanbanController`, whose twenty-three injected
 * services (app/coffee/modules/kanban/main.coffee L31-L55) collapse here into
 * three named resolutions. Method by method, against the pre-migration file:
 *
 *     loadProject                 :564-580  -> `loadProject`
 *     loadUserstoriesParams       :423-436  -> `buildUserstoriesParams`
 *     loadUserstories (the read)  :464-472  -> `listUserstories`
 *     loadSwimlanes (the read)    :552-553  -> `listSwimlanes`
 *     refreshTagsColors           :368-370  -> `loadTagsColors`
 *     generateFilters (the read)  controllerMixins.coffee:246 -> `loadFiltersData`
 *     editUs/deleteUs (the read)  :283, :301 -> `getUserstoryByRef`
 *     moveUs (the write)          :604-625  -> `submitKanbanOrder`
 *     toggleSwimlane (storage)    :328-330  -> `storeSwimlanesModes`
 *     loadInitialData (storage)   :584      -> `getSwimlanesModes`
 *     KanbanSquishColumn (storage):780-797  -> `get`/`storeStatusColumnModes`
 *     refreshAfter…HaveChanged    :239-243  -> `refreshProject`
 *
 * Four things those methods also did are deliberately NOT here, because they are
 * not data access: the scope assignments and `$emit("project:loaded")` that
 * followed the project read (:570-579), the `groupBy` maps built beside it
 * (:574-575), the batched render loop (:372-421), and the broadcasts that
 * followed the write (:602, :627-632). The retained controller still performs
 * every one of them for the AngularJS side, and the React container drives its
 * own rendering from the plain values returned here.
 *
 * ===========================================================================
 * 2. WHY EVERY REQUEST GOES THROUGH `$tgResources` (requirement I7, rule T5)
 * ===========================================================================
 * There is no `fetch` in this file and there must never be one. Routing through
 * the existing resource layer is not a stylistic preference — it is how six
 * behaviours are inherited rather than re-derived, and losing any of them is
 * invisible until it costs data:
 *
 *   a. `Authorization: Bearer <token>` and `Accept-Language`, assembled per
 *      request from storage and the active locale
 *      (app/coffee/modules/base/http.coffee:17-30).
 *   b. `X-Session-Id` on GET, POST, PATCH, PUT and DELETE
 *      (app/coffee/app.coffee:590-604).
 *   c. The SINGLE-FLIGHT token refresh on 401, so concurrent board reads do not
 *      each start their own refresh.
 *   d. The VERSION_ERROR toast raised from a 400 carrying `version`, which is how
 *      an optimistic-concurrency conflict reaches the user at all.
 *   e. The 451 blocked-project interceptor and the status-0/-1 connection-error
 *      path.
 *   f. `$tgHttp.get`'s response cache, which de-duplicates concurrent identical
 *      GETs and is cleared in the `finally` of every read
 *      (base/http.coffee:37-45).
 *
 * The write path adds a seventh: `$tgRepo`/`$tgModel` PATCH only the CHANGED
 * fields, together with the optimistic-concurrency `version`
 * (base/model.coffee:48-54). A hand-rolled client would naturally send whole
 * objects, turning two users editing different fields of one story into a silent
 * lost update. That is why `getAttrs()` output is treated as read-only data here
 * and a live model is never rebuilt from it.
 *
 * ===========================================================================
 * 3. THE SYNC/ASYNC ASYMMETRY — the highest-risk seam in this file
 * ===========================================================================
 * `$tgResources` mixes two kinds of member behind one namespace, and the
 * difference is not visible at a call site:
 *
 *   - TRANSPORT members resolve `$q` promises. Every one of them is reached
 *     through a facade under `../../shared/api/**`, and those facades ALREADY
 *     marshal with `toNativePromise`, so nothing here re-wraps them. Double
 *     wrapping would not break, but it would add a microtask hop and obscure
 *     which values are genuinely raw.
 *   - STORAGE members are SYNCHRONOUS. `kanban.getStatusColumnModes` and its
 *     three siblings read and write `localStorage` through `$tgStorage` and
 *     return a value directly (app/coffee/modules/resources/kanban.coffee:19-37,
 *     base/storage.coffee:17-32).
 *
 * ⛔ WRAPPING A SYNCHRONOUS STORAGE READ IN A PROMISE FAILS SILENTLY AND
 * VISIBLY-LATER. The fold maps are consumed by truthiness — `if
 * !$scope.folds[status.id]` (main.coffee:785) and
 * `!@.foldedSwimlane.get(id.toString())` (:329) — so a `Promise` in that slot is
 * an object, every id lookup on it is `undefined`, and every column and swimlane
 * silently renders UNFOLDED. Nothing throws, no request fails, and the only
 * symptom is that the user's folds are gone after a reload. The four wrappers
 * below are therefore NOT `async`, return no promise, and are never awaited.
 * `toNativePromise` is applied at exactly one place in this file: the project
 * refresh, which really is a raw `$q` thenable (see section 6).
 *
 * ===========================================================================
 * 4. THE FLATTENING BOUNDARY (pitfall P-IMMER-1)
 * ===========================================================================
 * Two AngularJS wrapper types reach this file and NEITHER may cross into React
 * state, an immer draft, or a spread:
 *
 *   - `$tgModel` instances, produced for every row by the repository's model
 *     query (base/repository.coffee:135-148). Their attributes are accessor
 *     pairs installed by `Object.defineProperty` (base/model.coffee:67-101), so
 *     `{...model}` does NOT produce the attribute map: it drops the prototype
 *     methods, copies the private bookkeeping fields, and captures only the keys
 *     that existed at construction. It looks plausible and is wrong.
 *     `getAttrs()` returns a fresh plain merge instead, carrying `version`
 *     (base/model.coffee:48-54) — which is exactly what the optimistic-
 *     concurrency write needs preserved.
 *   - The persistent project structure held by `tgProjectService`. It is
 *     flattened with `.toJS()` at this seam and nowhere else, following the
 *     house precedent at
 *     app/modules/components/project-menu/project-menu.controller.coffee:27.
 *     Downstream of this file there is no `getIn`, no `.size` and no Immutable
 *     import: plain objects, plain arrays and `.length` only.
 *
 * immer drafts plain objects, arrays, maps and sets; a class instance is not
 * draftable, and with `autoFreeze` left on (P-IMMER-4) freezing a structure
 * AngularJS still holds is its own hazard. Flattening here closes both.
 *
 * ===========================================================================
 * 5. THE `-1` VERSUS `null` SWIMLANE ASYMMETRY
 * ===========================================================================
 * `-1` is the synthetic "unclassified" swimlane: a legitimate GROUPING key that
 * owns a full status set (main.coffee:560 gives it the project's statuses), and
 * one a drag event legitimately carries. It is NOT a swimlane a story may
 * reference — `UserStory.swimlane` spells unclassified as `null`, and persisting
 * `-1` would create a reference the project does not have.
 *
 * The incumbent handles this with a local rename immediately before the write
 * (:604-607): `apiNewSwimlaneId = newSwimlaneId`, then `null` when it is `-1`.
 * `submitKanbanOrder` reproduces that translation ONCE, on a local, and never
 * writes back to the caller's payload — the same value may still be in flight
 * through the reducer, which performs its own independent translation
 * (`../state/boardReducer.ts`, `applyMoveCard`).
 *
 * ===========================================================================
 * 6. WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ===========================================================================
 *   - It never calls `listUserstoryValues`. Statuses and estimation points come
 *     from the PROJECT payload (:573-576); the values endpoint has zero in-scope
 *     consumers, and calling it would issue a request the board never made.
 *   - It never calls `editStatus`. Changing a status' WIP limit is an
 *     administration path (resources/userstories.coffee:141-147), not a board
 *     path.
 *   - It never re-implements `controllerMixins.generateFilters`' post-processing
 *     (controllerMixins.coffee:249-290), which stringifies ids and rewrites tag
 *     and user rows in place. The filter panel stays AngularJS, so
 *     `loadFiltersData` hands back the parsed body UNCHANGED.
 *   - It never calls `$rootScope.$apply`, `$applyAsync` or `$digest`, and it
 *     resolves no scope service: AngularJS owns digest scheduling, React owns
 *     React state.
 *   - It adds no retry, timeout, cancellation or rejection rewriting. The
 *     incumbent has none, and swallowing a rejection would hide exactly the
 *     interceptor outcomes listed in section 2 (T10, Minimal Change Clause).
 */

import { useCallback, useMemo } from 'react';

import { toNativePromise } from '../../bridge/toNativePromise';
import { useAngularService } from '../../bridge/useAngularService';
import type { ResourceParams, TaigaModel } from '../../bridge/useAngularService';

import {
    getStatusColumnModes,
    getSwimlanesModes,
    storeStatusColumnModes,
    storeSwimlanesModes,
} from '../../shared/api/kanbanStorage';
import { getProjectTagsColors } from '../../shared/api/projects';
import { listSwimlanes } from '../../shared/api/swimlanes';
import {
    bulkUpdateKanbanOrder,
    getUserStoryByRef,
    getUserstoriesFiltersData,
    listAllUserstories,
} from '../../shared/api/userstories';
import type { UserstoriesFiltersData } from '../../shared/api/userstories';
import type { Status } from '../../shared/types/status';
import type { Swimlane } from '../../shared/types/swimlane';
import type { UserStory } from '../../shared/types/userStory';
import { UNCLASSIFIED_SWIMLANE_ID } from '../state/boardReducer';

/* ==========================================================================
 * THE FROZEN QUERY CONTRACT
 *
 * Both constants are the incumbent's own values, restated here because this file
 * is now the only place that builds the board's list parameters. Neither is a
 * tuning knob: changing either changes which stories the board asks for.
 * ========================================================================== */

/**
 * The URL query parameters the board is allowed to forward to the list endpoint.
 *
 * Verbatim from `KanbanController.validQueryParams`
 * (app/coffee/modules/kanban/main.coffee:59-70), where it is the second argument
 * of the `_.pick` that filters the location search before the merge (:432-433).
 *
 * ⛔ THE WHITELIST IS THE POINT, and `status` is absent from it on purpose. The
 * board never sends a status filter with its main list — the controller declares
 * `excludeFilters: ["status"]` (:27-29) and the archived-column path is the only
 * one that filters by status, with its own parameters (:511-531). Forwarding a
 * whole search bag unfiltered would let a `status` in the URL silently empty
 * four of the five columns.
 *
 * Exported so a spec can assert parity against the incumbent list rather than
 * re-typing it, which is how the two are kept from drifting.
 *
 * `as const` for the literal union below, and `Object.freeze` because the type-level
 * guarantee erases: this list decides which URL values reach the wire, so nothing
 * holding a reference to it may extend it at run time. Same reasoning, and the same
 * pairing, as the bridge's own service allow-list.
 */
export const KANBAN_VALID_QUERY_PARAMS = Object.freeze([
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
] as const);

/** One member of {@link KANBAN_VALID_QUERY_PARAMS}. */
export type KanbanValidQueryParam = (typeof KANBAN_VALID_QUERY_PARAMS)[number];

/**
 * The zoom level from which the list request also asks for attachments and tasks.
 *
 * `if @.zoomLevel >= 2` at main.coffee:428. Zoom levels 2 and 3 are the ones
 * whose cards render attachment thumbnails and a task counter, so the extra
 * payload is fetched only when something displays it.
 */
export const KANBAN_ZOOM_LEVEL_WITH_EXTRA_DATA = 2;

/* ==========================================================================
 * PUBLIC TYPES
 *
 * Every wire-shaped type is either imported from the shared domain types or
 * DERIVED from the facade it feeds, so a signature change in
 * `../../shared/api/**` breaks compilation here instead of drifting.
 * ========================================================================== */

/** The positional parameter list of the frozen Kanban order write. */
type BulkKanbanOrderParameters = Parameters<typeof bulkUpdateKanbanOrder>;

/**
 * What the Kanban order endpoint answers: one row per moved story, carrying the
 * authoritative `status`, `swimlane` and `kanban_order` the server settled on.
 *
 * Derived rather than restated, so the response description lives in exactly one
 * place (`../../shared/api/userstories.ts`, `KanbanOrderedUserStoryRow`).
 */
export type KanbanOrderResponse = Awaited<ReturnType<typeof bulkUpdateKanbanOrder>>;

/** The fold map shape both persisted Kanban maps share, derived from its reader. */
export type KanbanFoldModes = ReturnType<typeof getStatusColumnModes>;

/**
 * The project's tag-colour dictionary, keyed by TAG NAME.
 *
 * A string-keyed dictionary is the genuine wire shape here rather than a
 * stand-in for a type nobody wrote: the endpoint answers one entry per tag the
 * project defines, and a project defines whichever tags it likes. `null` is a
 * legitimate colour — an uncoloured tag renders with the default pill fill — so
 * the value is nullable rather than optional.
 *
 * ⛔ NO COLOUR LITERAL MAY EVER BE ADDED to this type or its consumers. Tag,
 * status and epic colours are per-project database values; the colours visible
 * in the Figma frames are seeded sample data (rule T2, Drift Register D3).
 */
export type KanbanTagsColors = Readonly<Record<string, string | null>>;

/**
 * One estimation-point value as the project payload carries it.
 *
 * `order` is what the board sorts by (main.coffee:573) and is the only member
 * this file reads; the rest are declared because the sorted array is handed
 * straight to the card renderer, which reads all three.
 */
export interface KanbanProjectPointValue {
    readonly id: number;

    readonly name: string;

    readonly value: number | null;

    readonly order: number;
}

/**
 * One user-story status as the project payload carries it.
 *
 * ⭐ WHY THIS EXTENDS `Status` INSTEAD OF BEING IT. The shared `Status`
 * (`../../shared/types/status.ts`) describes what the BOARD renders — id, name,
 * colour, WIP limit, archived flag — and deliberately carries no `order`,
 * because no rendering decision depends on one. Sorting does: the incumbent
 * orders the columns with `_.sortBy(project.us_statuses, "order")`
 * (main.coffee:576), and the member it sorts by is part of the project payload.
 * Extending keeps the sorted array assignable to `readonly Status[]` wherever the
 * board state wants it, while making the sort key explicit here rather than
 * reached for through a cast.
 */
export interface KanbanProjectStatus extends Status {
    readonly order: number;
}

/**
 * The board's view of the current project: the gate flag plus the two sorted
 * taxonomies, and nothing else.
 *
 * ⭐ MINIMAL BY CONSTRUCTION, AND NOT AN INDEX SIGNATURE. There is no shared
 * `Project` type in this codebase and this file does not invent one: it declares
 * the four members `loadProject` actually produces. Anything else a component
 * needs about the project — name, description, permissions, swimlane defaults —
 * already crosses the seam through the AngularJS bridge payload
 * (`app/coffee/modules/kanban/react-bridge.coffee`), flattened there. Widening
 * this into a bag would put an unchecked `Record<string, unknown>` in front of
 * every consumer and defeat the point of typing the seam at all.
 *
 * `usStatusList` carries the incumbent's own scope name (main.coffee:576) and is
 * the name the board reducer stores it under
 * (`../state/types.ts`, `KanbanBoardState.usStatusList`).
 */
export interface KanbanProjectData {
    readonly id: number;

    /**
     * The screen gate, read by TRUTHINESS exactly as `if not
     * project.is_kanban_activated` reads it (main.coffee:567).
     */
    readonly is_kanban_activated: boolean;

    /** A SORTED COPY of `project.points`; the payload array is not mutated. */
    readonly points: readonly KanbanProjectPointValue[];

    /** A SORTED COPY of `project.us_statuses`; the payload array is not mutated. */
    readonly usStatusList: readonly KanbanProjectStatus[];
}

/**
 * The inputs `listUserstories` needs to reproduce
 * `KanbanController.loadUserstoriesParams` (main.coffee:423-436).
 *
 * ⭐ EVERY MEMBER IS SUPPLIED BY THE CALLER, AND THAT IS THE DESIGN. The
 * incumbent read two of these off itself and the third off `$tgLocation`; this
 * file resolves no routing service, because routing stays AngularJS and a React
 * hook that reached for the URL would be claiming an authority it does not have.
 * The board container already holds all three — zoom and the search text arrive
 * in the bridge payload, and the search snapshot with them.
 */
export interface KanbanUserstoriesQuery {
    /**
     * The active card zoom level. At or above
     * {@link KANBAN_ZOOM_LEVEL_WITH_EXTRA_DATA} the request also asks for
     * attachments and tasks. Absent behaves as below the threshold, which is what
     * `undefined >= 2` evaluates to in the incumbent.
     */
    readonly zoomLevel?: number;

    /**
     * The board's free-text search term, forwarded as `q`.
     *
     * Assigned UNCONDITIONALLY, exactly as `params.q = @.filterQ` does
     * (main.coffee:434): an absent term leaves the key present and undefined, and
     * AngularJS omits undefined parameters from the query string, so the request
     * on the wire is identical to the incumbent's.
     */
    readonly filterQ?: string;

    /**
     * The URL search snapshot, i.e. the caller's equivalent of
     * `@location.search()`. Only the names in
     * {@link KANBAN_VALID_QUERY_PARAMS} are read from it; everything else is
     * ignored, reproducing the `_.pick` at main.coffee:432.
     */
    readonly queryParams?: ResourceParams;
}

/**
 * One Kanban order write, named rather than positional.
 *
 * ⭐ WHY AN OBJECT WHEN THE ENDPOINT IS POSITIONAL. The six frozen arguments
 * include four consecutive numbers — `statusId`, `swimlaneId`,
 * `afterUserstoryId`, `beforeUserstoryId` — so transposing any two of them
 * type-checks perfectly and persists a wrong board with an HTTP 200. Naming them
 * here makes that mistake unexpressible at the call site, while
 * {@link useKanbanData} still assembles the frozen positional list in exactly one
 * place. Each member's type is derived from the facade's own parameter list, so
 * the wire contract is described once.
 */
export interface KanbanOrderWrite {
    readonly projectId: BulkKanbanOrderParameters[1];

    readonly statusId: BulkKanbanOrderParameters[2];

    /**
     * The DESTINATION GROUPING KEY, which may legitimately be
     * {@link UNCLASSIFIED_SWIMLANE_ID} when the drop landed in the unclassified
     * swimlane. It is translated to `null` for the request and this object is
     * never written back to — see section 5 of the file header.
     */
    readonly swimlaneId: BulkKanbanOrderParameters[3];

    /** The card the block landed AFTER. Wins over `beforeUserstoryId`. */
    readonly afterUserstoryId: BulkKanbanOrderParameters[4];

    /** The card the block landed BEFORE. Sent only when there is no `after`. */
    readonly beforeUserstoryId: BulkKanbanOrderParameters[5];

    /** The moved story ids, in their destination order. */
    readonly bulkUserstories: BulkKanbanOrderParameters[6];
}

/**
 * The Kanban board's complete data surface.
 *
 * One frozen-by-type object with a stable identity for the life of the component,
 * so every member is safe to name in a `useEffect` or `useCallback` dependency
 * list. Read paths return native promises; the four storage members and the
 * project read are SYNCHRONOUS and must stay that way (section 3).
 */
export interface KanbanDataApi {
    /**
     * The board's entry gate and taxonomy read, reproducing
     * `KanbanController.loadProject` (main.coffee:564-580).
     *
     * SYNCHRONOUS, because the project is already resolved before the screen
     * renders: it is held by `tgProjectService` as a persistent structure and
     * merely flattened here.
     *
     * @returns the board's project view, or `null` when no project is loaded yet.
     */
    readonly loadProject: () => KanbanProjectData | null;

    /**
     * Lists every non-archived story of the board, as PLAIN flattened stories.
     *
     * @param projectId - the project to list.
     * @param query - the caller-supplied zoom, search term and URL snapshot.
     */
    readonly listUserstories: (
        projectId: number,
        query?: KanbanUserstoriesQuery,
    ) => Promise<readonly UserStory[]>;

    /**
     * Reads ONE story by its per-project reference, as a plain flattened story.
     *
     * @param projectId - the project the story belongs to.
     * @param ref - the story's per-project reference number.
     * @param extraParams - additional query parameters, forwarded untouched.
     */
    readonly getUserstoryByRef: (
        projectId: number,
        ref: number,
        extraParams?: ResourceParams,
    ) => Promise<UserStory>;

    /** Lists the project's swimlanes, as PLAIN flattened swimlanes. */
    readonly listSwimlanes: (projectId: number) => Promise<readonly Swimlane[]>;

    /** Reads the project's tag-colour dictionary, flattened off its model. */
    readonly loadTagsColors: (projectId: number) => Promise<KanbanTagsColors>;

    /**
     * Reads the filter panel's option counts, returned EXACTLY as the server sent
     * them — see section 6 of the file header.
     */
    readonly loadFiltersData: (
        params: ResourceParams,
    ) => Promise<UserstoriesFiltersData>;

    /** Submits one Kanban reordering, position-relative and never index-based. */
    readonly submitKanbanOrder: (
        write: KanbanOrderWrite,
    ) => Promise<KanbanOrderResponse>;

    /** SYNCHRONOUS read of the persisted status-column fold map. */
    readonly getStatusColumnModes: (projectId: number) => KanbanFoldModes;

    /** SYNCHRONOUS write of the persisted status-column fold map. */
    readonly storeStatusColumnModes: (
        projectId: number,
        modes: KanbanFoldModes,
    ) => void;

    /** SYNCHRONOUS read of the persisted swimlane fold map. */
    readonly getSwimlanesModes: (projectId: number) => KanbanFoldModes;

    /** SYNCHRONOUS write of the persisted swimlane fold map. */
    readonly storeSwimlanesModes: (
        projectId: number,
        modes: KanbanFoldModes,
    ) => void;

    /**
     * Re-fetches the project into `tgProjectService`, which is the first half of
     * `refreshAfterSwimlanesOrUserstoryStatusesHaveChanged` (main.coffee:239-243).
     * The loader and the subsequent board reload stay with the caller.
     */
    readonly refreshProject: () => Promise<void>;
}

/* ==========================================================================
 * MODULE-LEVEL HELPERS
 *
 * Pure functions, no module-level mutable state. Each one is the single
 * implementation of a boundary rule the file header names, so the rule cannot be
 * applied inconsistently at two call sites.
 * ========================================================================== */

/**
 * Flattens ONE live `$tgModel` into its plain attributes.
 *
 * The single implementation of the model half of section 4. `getAttrs()` already
 * returns a FRESH plain merge — `_.extend({}, @._attrs, @._modifiedAttrs)` at
 * base/model.coffee:48-54 — with the optimistic-concurrency `version` copied in
 * first (:49-50), so nothing needs re-copying afterwards and `version` survives
 * the crossing intact.
 *
 * @typeParam TAttrs - the plain attribute shape the model wraps.
 * @param model - a live model, as the repository's model query produced it.
 * @returns the model's attributes as a fresh plain object.
 */
function toPlainAttrs<TAttrs>(model: TaigaModel<TAttrs>): TAttrs {
    return model.getAttrs();
}

/**
 * Flattens a LIST of live models into a fresh plain array.
 *
 * `Array.prototype.map` allocates a new array, so neither the AngularJS-owned
 * array nor any model inside it survives into the value React receives.
 *
 * @typeParam TAttrs - the plain attribute shape the models wrap.
 * @param models - the models the repository resolved.
 * @returns a fresh array of fresh plain objects.
 */
function toPlainAttrsList<TAttrs>(
    models: ReadonlyArray<TaigaModel<TAttrs>>,
): readonly TAttrs[] {
    return models.map((model) => toPlainAttrs(model));
}

/** Anything the project payload sorts by `order`. */
interface OrderedProjectValue {
    readonly order: number;
}

/**
 * Reads one sort key, placing an absent or non-finite one LAST.
 *
 * ⭐ THIS REPRODUCES `_.sortBy`, WHICH IS NOT THE SAME AS `a.order - b.order`.
 * lodash orders `undefined` after every defined value, so a payload entry
 * missing `order` sank to the bottom of the incumbent's list. Subtracting
 * straight from the members would instead produce `NaN`, which `Array.sort`
 * treats as "equal", quietly leaving such an entry wherever it happened to be.
 * The member is declared `number` because the serializer always sends one; this
 * guard exists for the payload that nevertheless does not, and it keeps that
 * case behaving exactly as it does today.
 *
 * @param value - one point value or status from the project payload.
 * @returns its numeric order, or positive infinity when there is none.
 */
function orderOf(value: OrderedProjectValue): number {
    return Number.isFinite(value.order) ? value.order : Number.POSITIVE_INFINITY;
}

/**
 * Returns a SORTED COPY of a project taxonomy, ascending by `order`.
 *
 * A copy, because `project.points` and `project.us_statuses` belong to the
 * flattened payload and the incumbent likewise assigned sorted copies to
 * separate scope members (main.coffee:573, :576) while leaving the payload
 * arrays untouched.
 *
 * The comparator never returns `NaN` (see {@link orderOf}) and `Array.sort` is
 * stable from ES2015 onwards — the compile target here is ES2020 — so entries
 * sharing an order keep their payload order, exactly as `_.sortBy` guarantees.
 *
 * ⛔ KANBAN SORTS BY `order`; THE BACKLOG SORTS BY `id`. The two are not
 * unified, and must not be: the board's column sequence is the administrator's
 * configured order, while the backlog's status dropdown is keyed differently.
 *
 * @typeParam TValue - the taxonomy entry type.
 * @param values - the payload array, left unmodified.
 * @returns a fresh array sorted ascending by `order`.
 */
function sortByOrder<TValue extends OrderedProjectValue>(
    values: readonly TValue[],
): readonly TValue[] {
    return [...values].sort((left, right) => {
        const leftOrder = orderOf(left);
        const rightOrder = orderOf(right);

        if (leftOrder === rightOrder) {
            return 0;
        }

        return leftOrder < rightOrder ? -1 : 1;
    });
}

/**
 * The two taxonomies and the id `loadProject` needs off the flattened payload.
 *
 * A type alias rather than an interface so it keeps an implicit index signature
 * and stays intersectable with the `Record<string, unknown>` that `toJS()`
 * answers.
 */
type KanbanProjectPayload = {
    readonly id: number;

    readonly points: readonly KanbanProjectPointValue[];

    readonly us_statuses: readonly KanbanProjectStatus[];
};

/**
 * Narrows the flattened project payload to the three members `loadProject` reads.
 *
 * ⭐ WHAT IS CHECKED AND WHAT IS DECLARED, stated plainly because the difference
 * matters. The three members this function DEREFERENCES are checked here: `id`
 * must be a finite number, and both taxonomies must be arrays. The ELEMENT shapes
 * are declared rather than walked, which is the same contract every facade under
 * `../../shared/api/**` states about a response body — they are fixed by the
 * project serializer, and re-validating each entry would add a rejection path the
 * incumbent has never had (T10). What this closes instead is the failure that IS
 * reachable: `tgProjectService.project` is typed as an untyped persistent
 * structure, so `toJS()` hands back a string-keyed bag, and reading `.points` off
 * it would otherwise be an `unknown` a caller has to assert away.
 *
 * @param plain - the payload as `toJS()` produced it.
 * @returns whether the payload carries a usable id and both taxonomy arrays.
 */
function isKanbanProjectPayload(
    plain: Record<string, unknown>,
): plain is Record<string, unknown> & KanbanProjectPayload {
    return (
        typeof plain.id === 'number' &&
        Number.isFinite(plain.id) &&
        Array.isArray(plain.points) &&
        Array.isArray(plain.us_statuses)
    );
}

/**
 * Builds the board's list parameters, reproducing
 * `KanbanController.loadUserstoriesParams` (main.coffee:423-436) line for line.
 *
 * Four rules, in the incumbent's own order:
 *
 *   1. `status__is_archived: false` always (:425). The archived column has its own
 *      per-status read and is not served by this one.
 *   2. `include_attachments` and `include_tasks`, as the NUMBER 1 rather than the
 *      boolean, from zoom level 2 upwards (:428-430). The value is on the wire, so
 *      it is reproduced exactly.
 *   3. The caller's URL snapshot, filtered through
 *      {@link KANBAN_VALID_QUERY_PARAMS} (:432-433). Undefined values are skipped
 *      rather than copied, because `_.merge` ignores an undefined source value —
 *      copying it would leave a key the incumbent never produced.
 *   4. `q`, assigned UNCONDITIONALLY and last, so it overwrites any `q` that came
 *      in through the snapshot (:434). That precedence is the incumbent's.
 *
 * @param query - the caller-supplied zoom, search term and URL snapshot.
 * @returns a fresh parameter bag for the list endpoint.
 */
function buildUserstoriesParams(query: KanbanUserstoriesQuery): ResourceParams {
    const params: Record<string, unknown> = {
        status__is_archived: false,
    };

    if (
        query.zoomLevel !== undefined &&
        query.zoomLevel >= KANBAN_ZOOM_LEVEL_WITH_EXTRA_DATA
    ) {
        params.include_attachments = 1;
        params.include_tasks = 1;
    }

    const snapshot = query.queryParams;

    if (snapshot !== undefined) {
        for (const name of KANBAN_VALID_QUERY_PARAMS) {
            const value = snapshot[name];

            if (value !== undefined) {
                params[name] = value;
            }
        }
    }

    params.q = query.filterQ;

    return params;
}

/**
 * Translates a destination GROUPING key into the swimlane id the API accepts.
 *
 * The whole of section 5, in one place: `-1` becomes `null`, everything else
 * passes through untouched. Called with a local copy of the caller's value and
 * never used to write back, so a raw drag payload still carrying `-1` reaches the
 * reducer unaltered — the reducer performs its own independent translation, and
 * neither depends on the other having run.
 *
 * @param swimlaneId - the destination grouping key, possibly the unclassified one.
 * @returns the swimlane id for the request, with unclassified spelled `null`.
 */
function toApiSwimlaneId(
    swimlaneId: BulkKanbanOrderParameters[3],
): BulkKanbanOrderParameters[3] {
    return swimlaneId === UNCLASSIFIED_SWIMLANE_ID ? null : swimlaneId;
}

/* ==========================================================================
 * THE HOOK
 * ========================================================================== */

/**
 * Resolves the Kanban board's data services once and returns its complete typed
 * data API.
 *
 * Must be called inside `AngularBridgeProvider`; `useAngularService` throws a
 * named error otherwise, and the sibling `ErrorBoundary` contains it so the
 * surrounding AngularJS shell survives.
 *
 * @returns the board's data API, with one stable identity per component instance.
 */
export function useKanbanData(): KanbanDataApi {
    /*
     * ⭐ T9 — THE ONE RESOURCE RESOLUTION FOR THE WHOLE SCREEN, and the reason the
     * board reuses it instead of opening its own transport. `$tgResources` is the
     * service the AngularJS controller was handed (main.coffee:36), and reaching
     * the endpoints through it is what inherits, unchanged and without
     * re-derivation: the `Authorization` and `Accept-Language` headers assembled
     * per request (base/http.coffee:17-30), the `X-Session-Id` header
     * (app.coffee:590-604), the single-flight 401 refresh, the VERSION_ERROR toast
     * a 400-with-`version` raises, the 451 blocked-project path, the
     * status-0/-1 connection flow, the GET response cache that de-duplicates
     * concurrent identical reads (base/http.coffee:37-45), and — on the write
     * side — `$tgModel`'s changed-fields-only PATCH carrying the optimistic
     * `version` (base/model.coffee:48-54). Section 2 of the file header explains
     * what each of those costs if it is lost.
     *
     * ⛔ `$tgResources` AND `tgResources` ARE TWO DIFFERENT SERVICES. The
     * controller injects both (:36-37); only the dollar-prefixed one carries the
     * `userstories`, `swimlanes`, `projects` and `kanban` namespaces this file
     * needs. The other one carries `attachments`, and asking it for `userstories`
     * yields `undefined` rather than an error.
     */
    const resources = useAngularService('$tgResources');

    /*
     * The two NON-resource services, resolved separately because they are separate
     * services rather than namespaces of the resource bag: the project holder the
     * gate reads (main.coffee:51, :565) and the error-state service the gate calls
     * (:46, :568). No scope service, no `$q` and no `$http` is resolved anywhere in
     * this file — see section 6 of the file header.
     */
    const projectService = useAngularService('tgProjectService');
    const errorHandlingService = useAngularService('tgErrorHandlingService');

    /**
     * `KanbanController.loadProject` (main.coffee:564-580), reduced to the part
     * that is data.
     *
     * ⭐ THE GATE DOES NOT RETURN EARLY, AND THAT IS DELIBERATE. The incumbent
     * calls `permissionDenied()` and then carries straight on to shape the project
     * (:567-576); the error service only raises flags on the root scope
     * (error-handling.service.coffee:29-31), and the AngularJS error view takes
     * over from there. Returning early — or throwing, or navigating — would change
     * which of the two screens the user ends up looking at, so the fall-through is
     * reproduced exactly.
     *
     * The `null` results are the two states the incumbent could not be in. It
     * dereferenced `@projectService.project` unconditionally, so a screen rendered
     * before the route resolved its project would have thrown; a React root can
     * legitimately render that early, so "not yet" is answered with `null` and the
     * container renders nothing. Likewise a payload without a numeric id and both
     * taxonomies cannot address any endpoint — the incumbent would have sent
     * `project=undefined` — so no request is issued for it.
     */
    const loadProject = useCallback((): KanbanProjectData | null => {
        const structure = projectService.project;

        if (!structure) {
            return null;
        }

        /*
         * ⭐ T9 — THE IMMUTABLE BOUNDARY, AND THE ONLY `.toJS()` IN THE KANBAN
         * REACT TREE. `tgProjectService.project` is a persistent structure
         * (project.service.coffee:27), and flattening it here is both what the
         * incumbent did at main.coffee:565 and the established house style at this
         * seam (project-menu.controller.coffee:27). Downstream of this line the
         * board deals in plain objects, plain arrays and `.length`: no `getIn`, no
         * `.size`, no Immutable import — and nothing persistent ever reaches an
         * immer draft, whose `autoFreeze` would otherwise freeze a structure
         * AngularJS still holds (P-IMMER-1, P-IMMER-4).
         */
        const plain = structure.toJS();

        // TRUTHINESS, exactly as `if not project.is_kanban_activated` reads it
        // (:567) -- an absent flag and a false one are the same answer.
        const isKanbanActivated = Boolean(plain.is_kanban_activated);

        if (!isKanbanActivated) {
            errorHandlingService.permissionDenied();
        }

        if (!isKanbanProjectPayload(plain)) {
            return null;
        }

        /*
         * Statuses and points come from the PROJECT PAYLOAD, never from the
         * project-values endpoint: `_.sortBy(project.points, "order")` at :573 and
         * `_.sortBy(project.us_statuses, "order")` at :576. `listUserstoryValues`
         * exists on the resource and has zero in-scope consumers; calling it here
         * would issue a request the board has never made.
         */
        return {
            id: plain.id,
            is_kanban_activated: isKanbanActivated,
            points: sortByOrder(plain.points),
            usStatusList: sortByOrder(plain.us_statuses),
        };
    }, [projectService, errorHandlingService]);

    /**
     * The board's main list read, `main.coffee:472` with its parameters from
     * `:423-436`.
     *
     * The facade resolves a BARE ARRAY of models: `listAll` performs its
     * unconditional stored-query-parameter write and then a model query
     * (resources/userstories.coffee:57-62, base/repository.coffee:135-148). There
     * is no `{data}` envelope and no `[rows, headers]` tuple — that pairing belongs
     * to the paginated `listUnassigned`, which the backlog uses — so nothing is
     * unwrapped here, only flattened.
     */
    const listUserstories = useCallback(
        async (
            projectId: number,
            query: KanbanUserstoriesQuery = {},
        ): Promise<readonly UserStory[]> => {
            const models = await listAllUserstories<UserStory>(
                resources.userstories,
                projectId,
                buildUserstoriesParams(query),
            );

            return toPlainAttrsList(models);
        },
        [resources],
    );

    /**
     * One story by reference, `main.coffee:283` and `:301`.
     *
     * `extraParams` defaults to an empty bag, matching the resource's own default
     * (resources/userstories.coffee:27). The milestone-`'null'` clean-up that
     * follows it there (:33-35) is the resource's, and is neither duplicated nor
     * pre-empted here.
     */
    const getUserstoryByRef = useCallback(
        async (
            projectId: number,
            ref: number,
            extraParams: ResourceParams = {},
        ): Promise<UserStory> => {
            const model = await getUserStoryByRef<UserStory>(
                resources.userstories,
                projectId,
                ref,
                extraParams,
            );

            return toPlainAttrs(model);
        },
        [resources],
    );

    /**
     * The project's swimlanes, `main.coffee:553`.
     *
     * The resource sends the SINGULAR query key `project` (resources/
     * swimlanes.coffee:16-18) and the repository adds `x-disable-pagination`, so
     * the answer is the whole unpaginated list as models. Flattened and handed back
     * as-is: the `swimlanesStatuses` map the incumbent built beside this call
     * (:555-560), including the entry it gives the unclassified swimlane, is
     * GROUPING and belongs to the board state.
     */
    const listBoardSwimlanes = useCallback(
        async (projectId: number): Promise<readonly Swimlane[]> => {
            const models = await listSwimlanes(resources.swimlanes, projectId);

            return toPlainAttrsList(models);
        },
        [resources],
    );

    /**
     * The project's tag colours, `KanbanController.refreshTagsColors`
     * (main.coffee:368-370).
     *
     * ⭐ T9 — THE MODEL BOUNDARY, AND WHY A SPREAD WOULD NOT DO. This read resolves
     * a `$tgModel`, not plain data, and a model's attributes are accessor pairs
     * over a private bag (base/model.coffee:67-101) — so `{...model}` drops the
     * prototype methods, copies the private bookkeeping fields, and captures only
     * the keys that existed at construction. The incumbent side-stepped that by
     * reading the private slot directly (`tags_colors._attrs` at :370); React uses
     * the public `getAttrs()`, which for a freshly read, unmodified model returns
     * an equivalent fresh plain copy of exactly that bag (:54).
     */
    const loadTagsColors = useCallback(
        async (projectId: number): Promise<KanbanTagsColors> => {
            const model = await getProjectTagsColors(resources.projects, projectId);

            return toPlainAttrs(model);
        },
        [resources],
    );

    /**
     * The filter panel's option counts, `controllerMixins.coffee:246`.
     *
     * ⛔ RETURNED UNCHANGED, and that is a requirement rather than laziness. The
     * resource reaches `userstories-filters` with a NULL id through the
     * repository's RAW query (resources/userstories.coffee:42-43,
     * base/repository.coffee:172-180), so this resolves parsed JSON — statuses,
     * tags, assigned users, roles, owners, epics — and not models. The incumbent
     * then MUTATED that body in place, stringifying every id, keying tags by name
     * and defaulting user names (controllerMixins.coffee:249-290). Reproducing
     * that here would give the AngularJS filter panel, which is out of scope and
     * still performs it, a second helping.
     */
    const loadFiltersData = useCallback(
        (params: ResourceParams): Promise<UserstoriesFiltersData> =>
            getUserstoriesFiltersData<UserstoriesFiltersData>(
                resources.userstories,
                params,
            ),
        [resources],
    );

    /**
     * The board's ONE write, `main.coffee:618-625`.
     *
     * ⛔ POSITION-RELATIVE, NOT INDEX-BASED. The two anchors become
     * `after_userstory_id` and `before_userstory_id`, `after` wins when both are
     * supplied, and `swimlane_id` is sent only when truthy — all three encoded once
     * in the facade (`../../shared/api/userstories.ts`). An off-by-one in whoever
     * computed the anchors therefore persists a wrong column behind an HTTP 200,
     * with no error surface and no console warning; it becomes visible only on the
     * next page load. The six frozen arguments are assembled here, in the frozen
     * order, from a named object precisely so no call site can transpose them.
     *
     * The rejection is passed through untouched: a VERSION_ERROR conflict, a
     * blocked project and a lost connection all arrive as rejection values from the
     * interceptor chain, and the caller is the party that decides what to do about
     * them.
     */
    const submitKanbanOrder = useCallback(
        (write: KanbanOrderWrite): Promise<KanbanOrderResponse> => {
            // ONE translation, onto a local. `write` is never assigned to: the same
            // raw value may still be travelling to the reducer, which does its own
            // (section 5).
            const apiSwimlaneId = toApiSwimlaneId(write.swimlaneId);

            return bulkUpdateKanbanOrder(
                resources.userstories,
                write.projectId,
                write.statusId,
                apiSwimlaneId,
                write.afterUserstoryId,
                write.beforeUserstoryId,
                write.bulkUserstories,
            );
        },
        [resources],
    );

    /*
     * ⭐ T9 — THE FOUR SYNCHRONOUS MEMBERS. Not `async`, not awaited, not
     * `Promise.resolve`-wrapped, and they must never become any of those. They read
     * and write `localStorage` through `$tgStorage` and return directly
     * (resources/kanban.coffee:19-37, base/storage.coffee:17-32); the readers
     * default to `{}` on a miss (:27, :37), so neither ever answers nothing.
     *
     * ⛔ THE FAILURE MODE IS SILENT AND IT LOSES USER STATE. Both maps are consumed
     * by TRUTHINESS — `if !$scope.folds[status.id]` at main.coffee:785 and
     * `!@.foldedSwimlane.get(id.toString())` at :329 — so a `Promise` in that slot
     * is a truthy object whose every id lookup is `undefined`. Nothing throws, no
     * request fails, and every column and swimlane simply renders UNFOLDED: the
     * user's folds are gone after a reload, with no symptom pointing at the cause.
     * That is why these four wrappers are the only members of this API that are not
     * promise-returning, and why the asymmetry is stated at the type level in
     * {@link KanbanDataApi} as well as here.
     */
    const readStatusColumnModes = useCallback(
        (projectId: number): KanbanFoldModes =>
            getStatusColumnModes(resources.kanban, projectId),
        [resources],
    );

    const writeStatusColumnModes = useCallback(
        (projectId: number, modes: KanbanFoldModes): void => {
            storeStatusColumnModes(resources.kanban, projectId, modes);
        },
        [resources],
    );

    const readSwimlanesModes = useCallback(
        (projectId: number): KanbanFoldModes =>
            getSwimlanesModes(resources.kanban, projectId),
        [resources],
    );

    const writeSwimlanesModes = useCallback(
        (projectId: number, modes: KanbanFoldModes): void => {
            storeSwimlanesModes(resources.kanban, projectId, modes);
        },
        [resources],
    );

    /**
     * Re-reads the project into `tgProjectService`, the first half of
     * `refreshAfterSwimlanesOrUserstoryStatusesHaveChanged` (main.coffee:239-243).
     *
     * ⭐ THE ONE PLACE `toNativePromise` IS NEEDED IN THIS FILE. Every other async
     * member above reaches a facade under `../../shared/api/**`, and those facades
     * already marshal, so re-wrapping them would only add a microtask hop.
     * `fetchProject` is a raw AngularJS `$q` thenable reached directly, so it is
     * marshalled here — once, with fulfilment and rejection passed through
     * untouched, and no digest triggered.
     *
     * It also returns NOTHING when the service holds no project
     * (project.service.coffee:95-96, `return if !@.project`), on which the
     * incumbent would have thrown while dereferencing `.then`. `toNativePromise`
     * resolves a non-thenable directly, so the caller sees a settled promise
     * instead of a `TypeError` — the same outcome the incumbent has for every state
     * it can actually reach, and a defined one for the state it cannot.
     */
    const refreshProject = useCallback(
        (): Promise<void> => toNativePromise<void>(projectService.fetchProject()),
        [projectService],
    );

    /*
     * ONE object, ONE identity. Every member is already stable, so this memo
     * changes only if the injector answers with different services — which cannot
     * happen for the life of a mounted board. That stability is what lets a
     * container name any member in a `useEffect` dependency list without
     * re-running the effect on every render.
     */
    return useMemo<KanbanDataApi>(
        () => ({
            loadProject,
            listUserstories,
            getUserstoryByRef,
            listSwimlanes: listBoardSwimlanes,
            loadTagsColors,
            loadFiltersData,
            submitKanbanOrder,
            getStatusColumnModes: readStatusColumnModes,
            storeStatusColumnModes: writeStatusColumnModes,
            getSwimlanesModes: readSwimlanesModes,
            storeSwimlanesModes: writeSwimlanesModes,
            refreshProject,
        }),
        [
            loadProject,
            listUserstories,
            getUserstoryByRef,
            listBoardSwimlanes,
            loadTagsColors,
            loadFiltersData,
            submitKanbanOrder,
            readStatusColumnModes,
            writeStatusColumnModes,
            readSwimlanesModes,
            writeSwimlanesModes,
            refreshProject,
        ],
    );
}
