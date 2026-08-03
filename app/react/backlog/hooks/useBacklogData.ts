/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * useBacklogData.ts -- THE BACKLOG SCREEN'S DATA CONTAINER
 * ==========================================================================
 *
 * Transformation rule T9 ("Comment every technology-specific change at the point
 * of change, especially at the AngularJS/React seam") governs this file. It sits
 * directly on that seam, so every statement below was verified by reading the
 * cited source in THIS checkout rather than assumed, and every locator is
 * quoted.
 *
 * LOCATOR NOTE, so both readings of the repository resolve: commit `c221a3d82`
 * ("Retire the AngularJS backlog view layer and its Protractor coverage")
 * shifted `app/coffee/modules/backlog/main.coffee` downwards. The plan and some
 * briefs quote the pre-`c221a3d82` numbering. Every locator in this file is the
 * CURRENT one, because that is what a reader of this checkout will find -- the
 * already-landed sibling `useBacklogRealtime.ts` cites it the same way.
 *
 * --------------------------------------------------------------------------
 * 1. THE DOMINATING ARCHITECTURAL FACT: PULL ON NOTIFY, NEVER PUSH
 * --------------------------------------------------------------------------
 * `tgLoadElement`'s watch, verbatim at
 * `app/coffee/modules/base/load-element.coffee:19`:
 *
 *     unwatch = $scope.$watch $parse($attrs.tgLoadElement), (val) ->
 *
 * TWO ARGUMENTS. No third one. So it is a REFERENCE-IDENTITY watch, not a deep
 * watch -- and the object it watches,
 * `app/coffee/modules/backlog/react-bridge.coffee:349`, is published inside
 * `bindOnce $scope, "project"` (`:341`) behind the idempotence guard
 * `return if $ctrl.reactScreen` at `:347`. It is therefore built EXACTLY ONCE
 * and never rebuilt.
 *
 * Three consequences follow, and this whole file is shaped by them:
 *
 *   (1) `params` IS A ONE-TIME BOOTSTRAP HAND-OFF, NOT A STATE STREAM. Writing
 *       into it produces no notification whatsoever, so it is read once, on the
 *       first render, and never polled and never watched.
 *   (2) LIVE VALUES ARE READ BY CALLING THE `events` GETTERS. Each one is a
 *       stable closure over the retained controller's scope
 *       (`react-bridge.coffee:376`-`:400`), so it answers with whatever
 *       AngularJS holds AT CALL TIME.
 *   (3) A RE-READ IS TRIGGERED BY NOTIFICATION, through
 *       `events.onAngularEvent(name, handler)` --
 *       `react-bridge.coffee:539`-`:540`, which delegates to
 *       `registerAngularEvent` at `:156`-`:162` and hands back AngularJS's own
 *       DEREGISTRATION FUNCTION. Every registration below is released in the
 *       effect's cleanup.
 *
 * There is deliberately NO change-notification mechanism in the bridge and none
 * is simulated here: no interval, no watcher, no proxy over `params`.
 *
 * Handlers registered through `onAngularEvent` already run inside an AngularJS
 * digest -- `registerAngularEvent` is a direct `$scope.$on`, and a scope
 * broadcast is dispatched from within one -- so React never drives a digest of
 * its own. Nothing in this file calls the AngularJS digest-forcing method, and
 * nothing may be added that does (AAP 0.7.4 makes that a prohibition, not a
 * preference). React state updates made from a delivery are perfectly ordinary:
 * React schedules its own render and React 18's automatic batching coalesces
 * them.
 *
 * --------------------------------------------------------------------------
 * 2. RULE T5 AND REQUIREMENT I7 -- WHY THERE IS NO CLIENT OF OUR OWN
 * --------------------------------------------------------------------------
 * Rule T5, verbatim: "Reuse `$tgResources`; do not build a parallel HTTP
 * client. New TypeScript files are typed facades over the existing repository
 * layer." Requirement I7 explains why that is a DATA-INTEGRITY constraint
 * rather than a stylistic one: "`$tgModel` dirty-tracks fields so `save()`
 * issues a `PATCH` of only changed fields carrying the optimistic-concurrency
 * `version`; a hand-rolled client would silently start sending full-object
 * writes."
 *
 * The proof, read from source. `app/coffee/modules/base/model.coffee:48`-`:54`:
 *
 *     getAttrs: (patch=false) ->
 *         if @._attrs.version?
 *             @._modifiedAttrs.version = @._attrs.version
 *         if patch
 *             return _.extend({}, @._modifiedAttrs)
 *         return _.extend({}, @._attrs, @._modifiedAttrs)
 *
 * and `app/coffee/modules/base/repository.coffee:53`-`:64`, whose `patch`
 * parameter DEFAULTS TO TRUE:
 *
 *     save: (model, patch=true, params = {}, options, returnHeaders = false) ->
 *         if not model.isModified() and patch
 *             defered.resolve(model)            # :55-57 -- no request at all
 *         data = JSON.stringify(model.getAttrs(patch))   # :61
 *         promise = @http.patch(url, data, params, options)  # :64
 *
 * So `$tgRepo.save(model)` already sends ONLY the fields somebody wrote, plus
 * `version`, and short-circuits entirely when nothing was written. The one write
 * this file owns (section 5) therefore goes through `$tgModel` and `$tgRepo`,
 * with no extra arguments and no URL of its own. Two users editing DIFFERENT
 * fields of the same story cannot overwrite each other, which a full-object
 * write would let them do silently.
 *
 * FIVE INHERITED INTERCEPTOR BEHAVIOURS ARE NOT REIMPLEMENTED HERE, because
 * going through the existing layers is what supplies them: the single-flight
 * token refresh on 401, the version-conflict notification raised from a 400
 * carrying `version`, the 451 blocked-project path, the connection-error path
 * for the two non-HTTP statuses, and header injection (`Authorization`,
 * `Accept-Language` and the session header). Rejections are passed through
 * untouched for exactly that reason -- swallowing one would hide a version
 * conflict, a blocked project or connection loss from the screen whose job it is
 * to surface them.
 *
 * --------------------------------------------------------------------------
 * 3. ⭐ THIS HOOK ISSUES NO REQUEST OF ITS OWN, AND THAT IS THE POINT
 * --------------------------------------------------------------------------
 * The RETAINED `BacklogController` still performs every load: project statistics
 * (`main.coffee:264`-`:276`), open and closed sprints (`:312`-`:338` and
 * `:289`-`:304`), and the paginated stories (`:349`-`:381`). It also owns both
 * realtime subscriptions (`:236`-`:243`). This hook READS what those loads
 * produced, through the getters, and ASKS for a reload through the bridge
 * actions. Issuing the same request a second time from React would generate
 * server traffic no session generates today -- a feature addition, which rule
 * T10 forbids outright.
 *
 * That is why the single resource-service resolution below reaches
 * for exactly ONE facade, `getShowTags`, which is SYNCHRONOUS local-storage
 * reading and performs no input or output at all. The deliberate omissions,
 * each for the same reason:
 *
 *   - `getProjectStats` -- the controller already calls `service.stats`
 *     (`main.coffee:265`). The PURE `toProjectStats` from the same facade module
 *     is used instead, on the snapshot the controller produced (section 4).
 *   - `listSprints` -- the controller already calls `service.list` twice, once
 *     per closed state (`main.coffee:291` and `:314`). Sprint loading belongs to
 *     `useSprints.ts`.
 *   - `listUnassignedUserstories` -- the controller already calls
 *     `service.listUnassigned` for the page (`main.coffee:367`) and again for
 *     the reference preload (`:133`).
 *   - `getProjectTagsColors` -- KANBAN-ONLY. Its sole consumer repository-wide
 *     is `app/coffee/modules/kanban/main.coffee:424`; there is not one call
 *     across `app/coffee/modules/backlog`.
 *   - `listUserstoryValues` -- DEAD on this path. Statuses and estimation points
 *     come off the PROJECT object, synchronously, at `main.coffee:487`-`:490`.
 *   - `getUserstoriesFiltersData` -- filter generation stays in AngularJS
 *     (section 7).
 *   - `storeUserstoriesQueryParams`, `storeBacklogIds`, `getBacklogIds` and
 *     `storeShowTags` -- the controller performs each of those writes already,
 *     at `main.coffee:355`, `:138`/`:146`, and `:247`/`:510` respectively.
 *
 * ⭐ THE SIX STORAGE FACADES ARE SYNCHRONOUS, so the one that IS used is never
 * awaited and never marshalled. `service.getShowTags`
 * (`app/coffee/modules/resources/userstories.coffee:174`-`:177`) returns
 * `$storage.get(hash)` directly, and `$storage.get`
 * (`app/coffee/modules/base/storage.coffee:17`-`:25`) reads local storage
 * inline. Handing a plain value to the promise marshaller would still work --
 * it resolves non-thenables as themselves -- but it would misdescribe the call,
 * and the function that reads it is deliberately NOT declared asynchronous.
 *
 * --------------------------------------------------------------------------
 * 4. THE CANONICAL EIGHT-FIELD `ProjectStats`, BUILT FIELD BY FIELD
 * --------------------------------------------------------------------------
 * `../state/types.ts` owns the canonical shape and requires EIGHT members:
 * `assigned_points`, `closed_points`, `completedPercentage`, `defined_points`,
 * `milestones`, `speed`, `total_milestones` and `total_points`. The server sends
 * SEVEN of them; `completedPercentage` is derived on the client.
 *
 * ⭐ THE PAYLOAD GENUINELY MIXES NAMING CONVENTIONS -- snake_case wire fields
 * beside one camelCase client-derived field -- and it MUST NOT be normalised.
 * The wire names are frozen by goal G2 and the derived name is what
 * `app/partials/includes/components/summary.jade:12` renders; renaming either
 * half would break one end or the other (T10).
 *
 * WHAT THIS FILE DOES: it NARROWS the plain snapshot the getter hands over into
 * the seven wire fields, one field at a time, with a total check per field and
 * no type assertion anywhere -- and then hands that to `toProjectStats`, the
 * PURE function exported by `../../shared/api/projects.ts:385`-`:404`, which is
 * the single audited implementation of the derivation. Its arithmetic is
 * `main.coffee:264`-`:276` verbatim:
 *
 *     totalPoints = if stats.total_points then stats.total_points else stats.defined_points
 *     if totalPoints
 *         @scope.stats.completedPercentage = Math.round(100 * stats.closed_points / totalPoints)
 *     else
 *         @scope.stats.completedPercentage = 0
 *
 * -- a TRUTHY fallback (so a `total_points` of zero falls through to
 * `defined_points`, which a nullish fallback would not), a TRUTHY guard on the
 * denominator (so a point-less project yields `0` rather than a division
 * artefact), and `Math.round` rather than truncation, because the value is
 * rendered as a percentage and also drives the summary bar's fill width. The
 * co-located spec pins all three THROUGH this hook, so the behaviour is provable
 * here and the arithmetic still exists in exactly one place.
 *
 * ⚠ THE BRIEF FOR THIS FILE DESCRIBES `../../shared/api/projects.ts` AS IT WAS
 * DRAFTED, NOT AS IT LANDED. It reports a non-exported five-member interface
 * carrying `completedPercentage` and "imports nothing from `../types/`". The
 * committed file instead declares a SEVEN-member wire interface WITHOUT
 * `completedPercentage`, imports the canonical `ProjectStats` from
 * `../../backlog/state/types`, and exports the pure `toProjectStats`. That file
 * is a dependency and is not modifiable from here, so the LANDED contract wins;
 * re-deriving the same arithmetic locally would put two copies of one rule in
 * one module, free to drift apart.
 *
 * ⭐ THE SNAPSHOT IS ALREADY PLAIN, SO NOTHING NEEDS FLATTENING.
 * `service.stats` is `$repo.queryOneRaw(...)`
 * (`app/coffee/modules/resources/projects.coffee:42`-`:43`), whose raw query
 * resolves the parsed body itself, and the bridge passes it through `toPlain`
 * on top of that (`react-bridge.coffee:383`).
 *
 * `showGraphPlaceholder` is derived HERE and not there, because it is a VIEW
 * decision. `main.coffee:274` is an EXISTENCE test, not a truthiness test:
 *
 *     @scope.showGraphPlaceholder = !(stats.total_points? && stats.total_milestones?)
 *
 * CoffeeScript's `?` compiles to a null-and-undefined check, so a project whose
 * totals are legitimately ZERO still gets the chart. A truthiness test would
 * replace it with the placeholder, which is a visible regression.
 *
 * --------------------------------------------------------------------------
 * 5. THE ONE WRITE THIS FILE OWNS, AND THE DEFECT IT PRESERVES
 * --------------------------------------------------------------------------
 * The incumbent inline status change lives in
 * `app/coffee/modules/common/popovers.coffee`, and every detail below is load
 * bearing:
 *
 *     $el.on "click", ".popover-status", debounce 2000, (event) ->   # :51
 *         us = $scope.$eval($attrs.tgUsStatus)                       # :59
 *         us.status = target.data("status-id")                       # :60
 *         render(us)                                                 # :61
 *         $el.find(".pop-status").popover().close()                  # :63
 *         <digest wrapper> ->                                        # :65
 *             $repo.save(us).then ->                                 # :66
 *                 $scope.$eval($attrs.onUpdate)                      # :67
 *
 * ⭐⭐ DEFECT DBN-1 -- THE "2,000 ms DEBOUNCE" IS A LEADING-EDGE GUARD, NOT A
 * DELAY. `app/coffee/utils.coffee:117`-`:118`, verbatim:
 *
 *     debounce = (wait, func) ->
 *         return _.debounce(func, wait, {leading: true, trailing: false})
 *
 * and `:121`-`:122` defines `debounceLeading` as the TRAILING one. The two names
 * are INVERTED relative to the conventional reading, and they are exported under
 * those names at `:293` and `:294`. So `debounce 2000` FIRES IMMEDIATELY and
 * DROPS every call inside the following two seconds: it is a double-submit
 * guard. Implementing it as a two-second timer would introduce a two-second lag
 * that no user has today -- a T10 violation dressed up as fidelity. The guard
 * below fires first and suppresses afterwards.
 *
 * ⭐⭐ DEFECT STATUS-1 -- THERE IS NO ERROR HANDLER AND NO REVERT. `:66` attaches
 * only a fulfilment handler, so a rejected save leaves the optimistic value on
 * screen until the next reload. THAT IS PRESERVED, DELIBERATELY AND WITHOUT
 * EXCEPTION: adding a revert would change behaviour (T10). It is numbered here
 * and belongs in the Drift Register, which lives under
 * `taiga-front/e2e-react/artifacts/figma-comparison/` and is owned by the
 * end-to-end agent -- this file creates no register of its own.
 *
 * `:67`'s `onUpdate` is the bridge action `updateUserStoryStatus`, which takes NO
 * arguments and is the post-write refresh rather than the write:
 * `main.coffee:675`-`:681` regenerates the filters, broadcasts the filter
 * update, reloads the statistics, and reloads the rows only when a status filter
 * is selected.
 *
 * THE WRITE ITSELF has no bridge action, and cannot have one: the bridge
 * flattens everything it hands over (`react-bridge.coffee:89`-`:101`), so React
 * never receives a live model, and there is no status-write callback among the
 * twenty-nine actions. Section 6 is how that is answered without a client of our
 * own.
 *
 * --------------------------------------------------------------------------
 * 6. PITFALL P-IMMER-1 -- LIVE MODELS LIVE IN A REF, NEVER IN STATE
 * --------------------------------------------------------------------------
 * P-IMMER-1, verbatim: "immer dislikes class instances. `$tgModel` returns model
 * classes carrying dirty-tracking state; passing one into a draft produces
 * undefined behaviour. Convert to plain objects at the boundary."
 *
 * The rule applied here, and it is binding:
 *
 *   - EVERYTHING THIS HOOK RETURNS IS FLATTENED PLAIN DATA. React state holds no
 *     model, so no draft can ever receive one.
 *   - THE LIVE MODELS LIVE IN A `useRef` MAP KEYED BY STORY ID. A ref is not
 *     state, is never diffed, and is never drafted.
 *   - FLATTENED DATA IS NEVER SAVED. The write path saves the RETAINED MODEL, so
 *     the dirty tracking and the `version` that section 2 depends on survive.
 *
 * Why a model is not simply spread: its attributes are not own data properties
 * but accessor pairs installed one per attribute at `model.coffee:67`-`:101`
 * over the private bag assigned at `:11`. Spreading an instance drops every
 * prototype member, copies the private bookkeeping beside the data, and captures
 * only the keys that existed at construction. `getAttrs()` returns a fresh plain
 * merge instead (`:54`), which is what is wanted -- and the house style at this
 * seam already does exactly that, at
 * `app/modules/components/project-menu/project-menu.controller.coffee:27`.
 *
 * The registry is populated two ways, and both keep the invariant. A caller that
 * already holds a live model -- the edit path, or a future drag hook -- hands it
 * over through `retainUserStoryModel`. Otherwise the write path MINTS one from
 * the flattened row with `$tgModel.make_model('userstories', row)`, writes the
 * single changed field with `setAttr`, and keeps it, so a second change to the
 * same story reuses the same dirty-tracked instance rather than starting over.
 * `make_model` plus one `setAttr` produces exactly `{status, version}` on the
 * wire, per `model.coffee:49`-`:53`, which is the changed-fields-only PATCH
 * requirement I7 asks for.
 *
 * ⛔ NO PERSISTENT-COLLECTION LIBRARY IS IMPORTED ANYWHERE UNDER `app/react/**`
 * (requirement I5 keeps it installed for its 124 out-of-scope consumers). Plain
 * arrays and objects only, so `.length` rather than a collection's own size
 * member is the boundary. ⛔ NO DRAFT LIBRARY IS IMPORTED HERE EITHER, and its
 * absence is a decision rather than an omission: this hook replaces its snapshot
 * wholesale on every pull and never mutates one, so there is nothing to draft.
 * Drafting belongs to the reducers under `../state/`. Every returned shape is
 * `readonly`, so an accidental write is a compile error rather than a run-time
 * surprise (P-IMMER-4). A draft must never be logged (P-IMMER-2) and must never
 * be reassigned or mixed with a returned value (P-IMMER-3); neither can arise in
 * a file that holds none.
 *
 * --------------------------------------------------------------------------
 * 7. OWNERSHIP BOUNDARIES -- WHAT THIS FILE DELIBERATELY DOES NOT DO
 * --------------------------------------------------------------------------
 *   - FILTER GENERATION STAYS IN ANGULARJS. `main.coffee:25` declares
 *     `BacklogController extends mixOf(taiga.Controller, taiga.PageMixin,
 *     taiga.FiltersMixin, taiga.UsFiltersMixin)`, and those mixins live in
 *     `app/coffee/modules/controllerMixins.coffee` (`generateFilters` at `:229`,
 *     `selectFilter` at `:57`, `isFilterDataTypeSelected` at `:223`). This hook
 *     CALLS the bridge's filter actions and reimplements none of that. The
 *     custom-filter storage name is `'backlog-custom-filters'`
 *     (`main.coffee:50`).
 *   - THE DOOM-LINE INDEX IS COMPUTED BY `../state/backlogSelectors.ts`. This
 *     hook calls `selectDoomLineIndex` and supplies its two inputs. ⭐ DEFECT
 *     DL-1: `main.coffee:763`-`:767` guards `reloadDoomLine` on
 *     `$scope.displayVelocity`, which that directive never assigns, and on
 *     `!$scope.displayVelocity?`, which is therefore always true -- so the line
 *     always renders once the project total is non-zero. That is preserved by
 *     delegating, since the selector reproduces it.
 *   - REALTIME LISTENING BELONGS TO `useBacklogRealtime.ts`. The two
 *     re-publishing broadcasts (`main.coffee:234` and `:241`) are ITS events,
 *     and they are not registered here.
 *   - SPRINT LOADING, THE SPRINT FORM AND DRAG ORDERING belong to
 *     `useSprints.ts` and `useStoryDrag.ts`. In particular the serialised drag
 *     queue at `main.coffee:646`-`:671`, with its `null`-first-argument drain
 *     that bypasses both the enqueue and the re-entrancy guard, is NOT this
 *     file's business.
 *   - TRANSLATION AND RENDERING belong to the components. No copy, no class name
 *     and no colour appears in this file: status, tag and epic colours are
 *     per-project DATA read from the project object (rule T2, drift entry D3),
 *     and the values visible in the design frames are seeded sample data.
 *   - PERMISSIONS ARE READ, NEVER RECOMPUTED. The gates below test the very same
 *     `my_permissions` array the permission directives test, with the very same
 *     membership test they use -- `project.my_permissions.indexOf(permission) != -1`
 *     at `app/coffee/modules/common.coffee:136`. A hidden control is
 *     presentation, not protection: every bridge action re-checks the permission,
 *     the project state and the module flag against live services before
 *     delegating (`react-bridge.coffee:334`-`:339`).
 * ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toNativePromise } from '../../bridge/toNativePromise';
import { useAngularService } from '../../bridge/useAngularService';
import type { TaigaModel } from '../../bridge/useAngularService';
import { toProjectStats } from '../../shared/api/projects';
import { getShowTags } from '../../shared/api/userstories';
import type { Status } from '../../shared/types/status';
// TYPE-ONLY, AND WORTH A NOTE. `swimlanesList` is one of the nine set-once bridge
// parameters and `getSwimlanes` is one of its getters, so this hook has to name the
// swimlane shape; `../state/types.ts` does not own one. The canonical declaration
// already exists, unchanged, in the sibling module beside `status`, `userStory` and
// `tag`, so it is imported rather than restated: a second declaration of one object
// is the defect `../../bridge/useAngularService.ts` records having paid for, and an
// `import type` is erased entirely under `isolatedModules`, adding no run-time edge.
import type { Swimlane } from '../../shared/types/swimlane';
import type { UserStory } from '../../shared/types/userStory';
import { selectDoomLineIndex } from '../state/backlogSelectors';
import type {
    BacklogUserStory,
    BurndownMilestone,
    PointsById,
    ProjectPoint,
    ProjectRole,
    ProjectStats,
} from '../state/types';

/* ==========================================================================
 * CONSTANTS
 * ========================================================================== */

/**
 * The suppression window of the inline status-change guard, in milliseconds.
 *
 * ⭐ DEFECT DBN-1 -- LEADING EDGE, NOT A DELAY. `app/coffee/utils.coffee:117`
 * builds the wrapper used at `app/coffee/modules/common/popovers.coffee:51` with
 * `{leading: true, trailing: false}`, so the first call goes through IMMEDIATELY
 * and every call inside this window is DROPPED. Section 5 of the file header
 * carries the full argument, including why a timer here would be a regression.
 */
export const STATUS_CHANGE_GUARD_WINDOW_MS = 2000;

/**
 * The AngularJS events that make this hook re-read its snapshot.
 *
 * Mirrors `initializeEventHandlers` (`app/coffee/modules/backlog/main.coffee:153`
 * -`:222`), restricted to the events whose incumbent handler changes something
 * THIS hook exposes:
 *
 *   - `usform:bulk:success` (`:159`) -- bulk creation. Its handler also reads a
 *     THIRD listener argument defaulting to `'bottom'`, which chooses between a
 *     move-to-top followed by the reload and the reload alone; the position
 *     itself is the controller's business and only the reload is observable here.
 *   - `usform:new:success` (`:179`) -- single creation, same default position.
 *   - `usform:edit:success` (`:206`) -- an edit, which replaces one row in place
 *     and then broadcasts the filter update.
 *   - `filters:update` (broadcast at `:157`, `:204`, `:212`, `:219` and `:678`)
 *     -- the controller answers it by regenerating the filters (`:214`), so the
 *     filter members of the snapshot change.
 *   - `backlog:userstories:loaded` (`:408`) -- raised as soon as a page has been
 *     parsed.
 *   - `userstories:loaded` (`:262` and `:413`) -- raised through a deferral once
 *     the rows are in the document, together with the page-loaded notification.
 *   - `sprint:us:moved` (`:661`) -- the drag queue has drained, so ordering and
 *     the first-story indicator have settled.
 *
 * ⛔ DELIBERATELY ABSENT, because they belong to sibling hooks and duplicating a
 * listener here would run the same reload twice: `backlog:realtime:userstories`
 * and `backlog:realtime:milestones` (`useBacklogRealtime.ts`); every
 * `sprintform:*` event, `backlog:load-closed-sprints` and
 * `backlog:unload-closed-sprints` (`useSprints.ts`); and `sprint:us:move`, the
 * imperative MOVE request rather than the settled `moved` notification
 * (`useStoryDrag.ts`).
 */
export const BACKLOG_DATA_REPULL_EVENTS = [
    'usform:bulk:success',
    'usform:new:success',
    'usform:edit:success',
    'filters:update',
    'backlog:userstories:loaded',
    'userstories:loaded',
    'sprint:us:moved',
] as const;

/** The name of the user-story resource, as the repository layer registers it. */
const USER_STORY_MODEL_NAME = 'userstories';

/** The permission codenames this screen's controls are gated on. */
const PERMISSION_ADD_US = 'add_us';
const PERMISSION_MODIFY_US = 'modify_us';
const PERMISSION_DELETE_US = 'delete_us';
const PERMISSION_ADD_MILESTONE = 'add_milestone';
const PERMISSION_MODIFY_MILESTONE = 'modify_milestone';
const PERMISSION_VIEW_MILESTONES = 'view_milestones';

/* ==========================================================================
 * THE BRIDGE CONTRACT, TYPED
 *
 * Declared here because nothing else owns it: the AngularJS side is untyped
 * CoffeeScript, and the test harness under `../../test-support/` describes the
 * payload only loosely because it asserts on plumbing rather than on data. Both
 * halves below are narrowed to what THIS hook reads, so a member appearing here
 * is a member that is genuinely consumed -- the remaining getters and actions of
 * the twenty-five and twenty-nine the bridge publishes belong to the sibling
 * hooks and the screen container.
 * ========================================================================== */

/**
 * The project attributes this hook reads or forwards.
 *
 * Narrow ON PURPOSE. The bridge hands over the whole plain project
 * (`react-bridge.coffee:354`), and a consumer needing more of it widens this
 * interface rather than reaching past the type -- which keeps "what does the
 * Backlog screen depend on?" answerable by reading one declaration.
 */
export interface BacklogProject {
    readonly id: number;

    readonly name: string;

    readonly slug: string;

    /**
     * The raw permission list, exactly as the permission directives read it.
     *
     * ⭐ READ, NEVER RECOMPUTED. Section 7 of the file header carries the
     * reasoning and the locator for the membership test.
     */
    readonly my_permissions: readonly string[];

    /** The project's roles, which the story rows need for their point columns. */
    readonly roles: readonly ProjectRole[];
}

/**
 * The SET-ONCE bootstrap parameters, `react-bridge.coffee:352`-`:366`.
 *
 * ⛔ NOT A STATE STREAM. Section 1 of the file header explains why writing into
 * this object notifies nobody, and why it is consequently read on the first
 * render only.
 */
export interface BacklogBridgeParams {
    readonly projectId: number;

    readonly project: BacklogProject;

    /** The literal `'backlog'` (`react-bridge.coffee:355`). */
    readonly sectionName: string;

    /** Estimation points, sorted by `order` at `main.coffee:487`. */
    readonly points: readonly ProjectPoint[];

    /**
     * Estimation points indexed by id, `main.coffee:488`.
     *
     * ⭐ ONE POINT PER KEY, NOT AN ARRAY. `taiga.groupBy`
     * (`app/coffee/utils.coffee`) assigns `result[pred(item)] = item`, so it
     * indexes rather than buckets -- which is why the canonical `PointsById`
     * carries a single optional value per key.
     */
    readonly pointsById: PointsById;

    /** Story statuses indexed by id, `main.coffee:489`, indexed the same way. */
    readonly usStatusById: Readonly<Record<number, Status | undefined>>;

    /**
     * Story statuses as a list.
     *
     * ⭐⭐ THE SORT KEY DIFFERS PER SCREEN AND MUST NEVER BE UNIFIED. The Backlog
     * sorts by `"id"` -- `@scope.usStatusList = _.sortBy(project.us_statuses,
     * "id")` at `app/coffee/modules/backlog/main.coffee:490`. The Kanban board
     * sorts the SAME collection by `"order"` at
     * `app/coffee/modules/kanban/main.coffee:631`. That is a genuine
     * per-screen divergence in the incumbent, and collapsing the two would
     * reorder one screen's controls (T10).
     */
    readonly usStatusList: readonly Status[];

    /**
     * Whether the project has closed sprints, `main.coffee:485`.
     *
     * A BOOLEAN, coerced from a count with a double negation -- so it answers
     * "are there closed sprints?" and not "how many?".
     */
    readonly closedMilestones: boolean;

    /** The swimlane list, accumulated by `loadSwimlanes` (`main.coffee:306`). */
    readonly swimlanesList: readonly Swimlane[];
}

/** Releases one AngularJS listener; what `onAngularEvent` hands back. */
export type BacklogDataEventDeregistrar = () => void;

/** One of the events in {@link BACKLOG_DATA_REPULL_EVENTS}. */
export type BacklogDataEventName = (typeof BACKLOG_DATA_REPULL_EVENTS)[number];

/**
 * The bridge's AngularJS-event registrar, `react-bridge.coffee:539`-`:540`.
 *
 * ⭐ THE LISTENER RECEIVES THE PAYLOAD FROM POSITION ZERO. `registerAngularEvent`
 * (`:156`-`:162`) drops AngularJS's event object and flattens each remaining
 * argument before applying the handler, so a listener that declared the event
 * object first would read the payload out of the wrong position -- the classic
 * way to get an AngularJS listener wrong.
 *
 * ⭐ THE RETURN VALUE IS AN OBLIGATION. It is AngularJS's own deregistration
 * function, and every registration in this file is released with it. A leaked
 * listener throws nothing and logs nothing; it surfaces much later as a Backlog
 * that re-reads twice, then three times, as somebody walks between screens.
 */
export type BacklogDataEventRegistrar = (
    eventName: BacklogDataEventName,
    handler: (payload: unknown) => void,
) => BacklogDataEventDeregistrar | undefined;

/**
 * The bridge callbacks this hook consumes, `react-bridge.coffee:375`-`:540`.
 *
 * ⭐ EVERY ACTION MAY ANSWER WITH NOTHING. A permission-gated action returns
 * early when `allowed` refuses (`:334`-`:339`), so the declared result is
 * `unknown` rather than a promise type, and the wrappers below marshal it -- the
 * marshaller resolves a non-thenable as itself, so a refusal becomes a settled
 * promise instead of a crash.
 */
export interface BacklogBridgeEvents {
    /* ---- getters: live reads of the retained controller's scope ---- */

    /** `:376`. The live project, re-read because permissions can change. */
    readonly getProject: () => unknown;

    /** `:377`. The backlog rows, flattened. */
    readonly getUserStories: () => unknown;

    /** `:378`. The REFERENCES of the rows the filters leave visible. */
    readonly getVisibleUserStories: () => unknown;

    /** `:379`. Open sprints; read here only for the milestone counts. */
    readonly getSprints: () => unknown;

    /** `:380`. Closed sprints; likewise. */
    readonly getClosedSprints: () => unknown;

    /** `:383`. The statistics body, plain, as section 4 describes. */
    readonly getStats: () => unknown;

    /** `:385`. The swimlane list. */
    readonly getSwimlanes: () => unknown;

    /**
     * `:387`. ⭐ A RAW HEADER STRING once a page has loaded.
     *
     * `main.coffee:403` assigns `header('Taiga-Info-Backlog-Total-Userstories')`
     * with no numeric conversion, over the `0` the constructor set at `:84`.
     * Converting it here would be a behaviour change (`:403` is the only writer),
     * so the union keeps both shapes and no conversion is performed.
     */
    readonly getTotalUserStories: () => unknown;

    /** `:388`. The free-text filter term. */
    readonly getFilterQ: () => unknown;

    /** `:390`. Whether the filter panel is open. */
    readonly getActiveFilters: () => unknown;

    /** `:391`. The selected filters, per filter type. */
    readonly getSelectedFilters: () => unknown;

    /** `:394`. Whether tag pills are shown; see the resolution in section 8. */
    readonly getShowTags: () => unknown;

    /** `:395`. Whether velocity forecasting is on. */
    readonly getDisplayVelocity: () => unknown;

    /** `:396`. The rows velocity forecasting would fit into the next sprint. */
    readonly getForecastedStories: () => unknown;

    /**
     * `:397`. Half of the infinite-scroll predicate.
     *
     * `app/partials/includes/modules/backlog-table.jade:23` reads
     * `ctrl.disablePagination || !ctrl.firstLoadComplete`, so BOTH halves are
     * surfaced and the table reproduces the predicate verbatim.
     */
    readonly getDisablePagination: () => unknown;

    /**
     * `:398`. The other half. `main.coffee:104` is the ONLY assignment of `true`
     * to it, after the initial load resolves; `:80` initialises it to `false`.
     */
    readonly getFirstLoadComplete: () => unknown;

    /* ---- actions: every one delegates to the retained controller ---- */

    /**
     * `:425`. ⭐ CALLABLE WITH NO ARGUMENTS, which is how the infinite scroll
     * calls it (`backlog-table.jade:22` is exactly `ctrl.loadUserstories()`).
     * The controller defaults `resetPagination` to `false` (`main.coffee:349`).
     */
    readonly loadUserstories: (resetPagination?: boolean, pageSize?: number) => unknown;

    /** `:432`. Re-reads the statistics behind the summary bar and the chart. */
    readonly loadProjectStats: () => unknown;

    /** `:448`. Opens the create form, standard or bulk. */
    readonly addNewUs: (kind: string) => unknown;

    /** `:467`. Opens the edit form for one story, addressed by reference. */
    readonly editUserStory: (projectId: number, ref: number, event?: unknown) => unknown;

    /**
     * `:475`. Deletes one story.
     *
     * ⭐ DEFECT DEL-1, PRESERVED: `main.coffee:699` removes the row from the
     * collection BEFORE the request, and the rejection path (`:710`-`:712`)
     * only closes the confirmation and notifies -- it NEVER puts the row back.
     * Note too that this call site passes THREE arguments to the delete
     * confirmation (`:697`) where `backlog/lightboxes.coffee` passes two; the two
     * are not unified.
     */
    readonly deleteUserStory: (userStory: unknown) => unknown;

    /**
     * `:482`. The POST-WRITE REFRESH, not the write.
     *
     * `main.coffee:676`-`:681` regenerates the filters, broadcasts the filter
     * update, reloads the statistics, and reloads the rows only when a status
     * filter is selected. It is the `onUpdate` of
     * `app/coffee/modules/common/popovers.coffee:67`, and it takes no arguments.
     */
    readonly updateUserStoryStatus: () => unknown;

    /** `:486`. Sets the free-text filter term. */
    readonly changeQ: (q: string) => unknown;

    /** `:487`. Adds one filter. */
    readonly addFilterBacklog: (filter: unknown) => unknown;

    /** `:488`. Removes one filter. */
    readonly removeFilterBacklog: (filter: unknown) => unknown;

    /** `:489`. Stores the current filter selection under a name. */
    readonly saveCustomFilter: (name: string) => unknown;

    /** `:490`. Applies a stored filter selection. */
    readonly selectCustomFilter: (filter: unknown) => unknown;

    /** `:491`. Forgets a stored filter selection. */
    readonly removeCustomFilter: (filter: unknown) => unknown;

    /** `:444`. Toggles the filter panel. */
    readonly toggleActiveFilters: () => unknown;

    /**
     * `:443`. Flips the tag-pill flag AND persists it (`main.coffee:245`-`:247`).
     *
     * Delegated rather than reimplemented so the flag and its stored copy stay
     * written by one owner; writing the store from here as well would produce two
     * writes per toggle.
     */
    readonly toggleShowTags: () => unknown;

    /** `:439`. Toggles velocity forecasting. */
    readonly toggleVelocityForecasting: () => unknown;

    /* ---- notification ---- */

    /** `:539`. See {@link BacklogDataEventRegistrar}. */
    readonly onAngularEvent: BacklogDataEventRegistrar;
}


/* ==========================================================================
 * THE RESULT SHAPE
 * ========================================================================== */

/**
 * The three milestone counters the incumbent keeps on its scope.
 *
 * ⭐ NO BRIDGE GETTER EXISTS FOR THESE, so they are DERIVED rather than read.
 * `loadSprints` writes all three at `main.coffee:319`-`:322`:
 *
 *     @scope.totalMilestones = sprints                                 # :319
 *     @scope.totalClosedMilestones = result.closed                     # :320
 *     @scope.totalOpenMilestones = result.open                         # :321
 *     @scope.totalMilestones = @scope.totalOpenMilestones + @scope.totalClosedMilestones   # :322
 *
 * ⭐ `:319` IS DEAD CODE -- it assigns the ARRAY and `:322` immediately replaces
 * it with the SUM. It is recorded here so nobody reads the incumbent, concludes
 * that `totalMilestones` is a collection, and "fixes" the React side to match the
 * line that never survives.
 *
 * ⭐ A MISSING HEADER MUST PROPAGATE, NEVER BE ZEROED. `result.closed` and
 * `result.open` come from a base-ten integer parse over two response headers
 * (`app/coffee/modules/resources/sprints.coffee:40`-`:41`), which yields the
 * not-a-number value when a header is absent, and `:322` then propagates it
 * through the sum. So {@link deriveMilestoneCounts} performs the addition with NO
 * fallback of its own: a coercion here would invent a zero the incumbent never
 * shows.
 *
 * ⚠ NAME COLLISION, worth stating once: the envelope's `closed` member is a
 * COUNT, while a `Sprint`'s own `closed` member is a BOOLEAN.
 */
export interface BacklogMilestoneCounts {
    readonly totalOpenMilestones: number;

    readonly totalClosedMilestones: number;

    readonly totalMilestones: number;
}

/**
 * How the stored tag-pill preference resolves on first load.
 *
 * ⭐⭐ DEFECT BC-2 -- THE DOUBLE READ IS ASYMMETRIC, AND IT IS PRESERVED. The
 * incumbent reads the same stored value TWICE, with two DIFFERENT tests:
 *
 *   - `main.coffee:502`, inside `loadInitialData`, tests STRICT EQUALITY against
 *     `false`: `if @rs.userstories.getShowTags(@scope.projectId) == false` and
 *     then sets the flag to `false` at `:503`, broadcasting NOTHING.
 *   - `main.coffee:113`, in the initial-load continuation, tests TRUTHINESS:
 *     `if @rs.userstories.getShowTags(@scope.projectId)` and then sets the flag
 *     to `true` at `:114` AND broadcasts at `:116`.
 *
 * So a stored `null` satisfies NEITHER test and the flag keeps the `true` the
 * constructor gave it at `:91`. The two reads are NOT collapsed into one, and the
 * broadcast stays attached to the truthy branch alone.
 *
 * ⭐ DEFECT ST-1 -- THE STORE ANSWERS WITH `null`, NEVER `undefined`.
 * `app/coffee/modules/base/storage.coffee:17`-`:25`: the absent-key branch
 * returns `_default or null` at `:20`, which is a TRUTHINESS fallback, so a
 * `_default` of `false` still yields `null`; and the malformed-value branch
 * returns a bare `null` at `:24` even when a default WAS supplied. The facade
 * `getShowTags` passes no default at all
 * (`app/coffee/modules/resources/userstories.coffee:174`-`:177`). So the test
 * below is an explicit comparison against `null` and `false` -- never a
 * truthiness test, which would swallow the very `false` that carries meaning.
 */
export interface BacklogShowTagsResolution {
    /** The resolved flag. */
    readonly showTags: boolean;

    /**
     * Whether the incumbent would ALSO have broadcast the change.
     *
     * True only on the truthy branch (`main.coffee:113`-`:116`). Surfaced rather
     * than acted on, because raising an AngularJS event is not this hook's to do:
     * `$scope` and the application root scope are unreachable from React by
     * design, and the sanctioned path would be an addition to the bridge.
     */
    readonly shouldBroadcast: boolean;
}

/** Everything {@link useBacklogData} hands its screen. */
export interface UseBacklogDataResult {
    /* ---- set-once bootstrap, section 1 fact (1) ---- */

    readonly projectId: number;

    readonly project: BacklogProject;

    readonly sectionName: string;

    readonly points: readonly ProjectPoint[];

    readonly pointsById: PointsById;

    readonly usStatusById: Readonly<Record<number, Status | undefined>>;

    /** Sorted by `id`, per {@link BacklogBridgeParams.usStatusList}. */
    readonly usStatusList: readonly Status[];

    readonly closedMilestones: boolean;

    readonly swimlanesList: readonly Swimlane[];

    readonly roles: readonly ProjectRole[];

    /* ---- permission gates: READ from the project, never recomputed ---- */

    readonly permissions: readonly string[];

    readonly canAddUs: boolean;

    readonly canModifyUs: boolean;

    readonly canDeleteUs: boolean;

    readonly canAddMilestone: boolean;

    readonly canModifyMilestone: boolean;

    readonly canViewMilestones: boolean;

    /* ---- the live snapshot, section 1 fact (2) ---- */

    readonly userStories: readonly BacklogUserStory[];

    /** The REFERENCES the filters leave visible, not the rows. */
    readonly visibleUserStories: readonly number[];

    /**
     * The total the response header reported.
     *
     * ⭐ A STRING once a page has loaded, and the `0` the constructor set before
     * that (`main.coffee:84` against `:403`). Never converted -- see
     * {@link BacklogBridgeEvents.getTotalUserStories}.
     */
    readonly totalUserStories: string | number;

    readonly stats: ProjectStats | null;

    /** Derived here with EXISTENCE tests; section 4 of the file header. */
    readonly showGraphPlaceholder: boolean;

    readonly milestoneCounts: BacklogMilestoneCounts;

    readonly filterQ: string;

    readonly activeFilters: boolean;

    readonly selectedFilterCount: number;

    readonly showTags: boolean;

    readonly displayVelocity: boolean;

    readonly forecastedStories: readonly BacklogUserStory[];

    /** Half of the infinite-scroll predicate; the table joins the two. */
    readonly disablePagination: boolean;

    /** The other half. */
    readonly firstLoadComplete: boolean;

    /**
     * The id of the first row, or `null` while there are none.
     *
     * Reproduces `resetFirstStoryIndicator` (`main.coffee:515`-`:517`), whose
     * guard is `if @scope.userstories.length > 0` -- so an empty backlog leaves
     * the indicator unset rather than pointing at nothing.
     */
    readonly firstUserStoryIdInBacklog: number | null;

    /** Delegated to `selectDoomLineIndex`; defect DL-1 in section 7. */
    readonly doomLineIndex: number | null;

    /* ---- actions ---- */

    /** Re-reads every live value at once. Stable across renders. */
    readonly refresh: () => void;

    /** No arguments, exactly as the infinite scroll invokes it. */
    readonly loadUserstories: () => Promise<unknown>;

    readonly loadProjectStats: () => Promise<unknown>;

    readonly addNewUs: (kind: string) => Promise<unknown>;

    readonly editUserStory: (ref: number, event?: unknown) => Promise<unknown>;

    readonly deleteUserStory: (userStory: number | BacklogUserStory) => Promise<unknown>;

    /**
     * The inline status change: guarded, optimistic, and WITHOUT a revert.
     *
     * Defects DBN-1 and STATUS-1, both preserved; section 5 of the file header
     * carries the decoded incumbent and the argument for each.
     */
    readonly changeUserStoryStatus: (userStoryId: number, statusId: number) => void;

    readonly changeQ: (q: string) => Promise<unknown>;

    readonly addFilter: (filter: unknown) => Promise<unknown>;

    readonly removeFilter: (filter: unknown) => Promise<unknown>;

    readonly saveCustomFilter: (name: string) => Promise<unknown>;

    readonly selectCustomFilter: (filter: unknown) => Promise<unknown>;

    readonly removeCustomFilter: (filter: unknown) => Promise<unknown>;

    readonly toggleActiveFilters: () => Promise<unknown>;

    readonly toggleShowTags: () => Promise<unknown>;

    readonly toggleVelocityForecasting: () => Promise<unknown>;

    /**
     * Hands a LIVE model to the registry described in section 6.
     *
     * For a caller that already holds one -- the edit path, or a drag hook -- so
     * that its dirty tracking is the tracking the next write uses.
     */
    readonly retainUserStoryModel: (model: TaigaModel<UserStory>) => void;

    /** Reads back a retained model, or `null` when none is held for that id. */
    readonly getUserStoryModel: (userStoryId: number) => TaigaModel<UserStory> | null;

    /**
     * How the stored tag preference resolved on the first render.
     *
     * Surfaced so the screen can honour the broadcast half of defect BC-2 and so
     * the resolution is assertable; see {@link BacklogShowTagsResolution}.
     */
    readonly showTagsResolution: BacklogShowTagsResolution;
}

/* ==========================================================================
 * PURE HELPERS
 *
 * Exported deliberately. Each one carries a rule that has to be assertable on
 * its own, in a browserless spec, without mounting anything -- which is what
 * makes the coverage floor reachable and what makes each preserved defect
 * provable rather than merely commented.
 * ========================================================================== */

/**
 * Whether the raw permission list grants a permission.
 *
 * `indexOf(...) !== -1` because that is literally what the permission directives
 * do -- `project.my_permissions.indexOf(permission) != -1` at
 * `app/coffee/modules/common.coffee:136`. Same list, same test, so the same users
 * see the same controls.
 */
function hasPermission(permissions: readonly string[], permission: string): boolean {
    return permissions.indexOf(permission) !== -1;
}

/** A value that is a non-null object, which is where every field read starts. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
    const value = source[key];

    return typeof value === 'number' ? value : null;
}

/**
 * Reads a member that the server sends as a number and may send as `null`.
 *
 * The two nothing-cases are distinguished on purpose: an ABSENT member and an
 * explicit `null` both yield `null`, but a member of the wrong type yields
 * `undefined`, which the caller treats as "this is not a statistics body".
 * Section 4 explains why `total_points` and `total_milestones` have to stay
 * nullable rather than being defaulted.
 */
function readNullableNumber(
    source: Record<string, unknown>,
    key: string,
): number | null | undefined {
    const value = source[key];

    if (value === null || value === undefined) {
        return null;
    }

    return typeof value === 'number' ? value : undefined;
}

/**
 * Narrows one burndown series entry.
 *
 * The hyphenated members are the WIRE SPELLING and are quoted rather than
 * renamed: the entries are handed to the chart untranslated, so an alias would
 * simply not be found at the other end. `evolution` is nullable because the
 * series runs out at today's date while the optimal line continues.
 */
function readBurndownMilestone(value: unknown): BurndownMilestone | null {
    if (!isRecord(value)) {
        return null;
    }

    const name = value['name'];
    const optimal = readNumber(value, 'optimal');
    const evolution = readNullableNumber(value, 'evolution');
    const teamIncrement = readNumber(value, 'team-increment');
    const clientIncrement = readNumber(value, 'client-increment');

    if (typeof name !== 'string' || optimal === null || evolution === undefined) {
        return null;
    }

    if (teamIncrement === null || clientIncrement === null) {
        return null;
    }

    return {
        name,
        optimal,
        evolution,
        'team-increment': teamIncrement,
        'client-increment': clientIncrement,
    };
}

function readBurndownMilestones(value: unknown): readonly BurndownMilestone[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const entries: BurndownMilestone[] = [];

    for (const candidate of value) {
        const entry = readBurndownMilestone(candidate);

        if (entry === null) {
            return null;
        }

        entries.push(entry);
    }

    return entries;
}


/**
 * Builds the canonical eight-member `ProjectStats` from the live snapshot.
 *
 * ⭐⭐ THIS IS THE SCREEN'S SOLE CONSTRUCTION SITE for that type, and it is built
 * FIELD BY FIELD: each of the seven wire members is read and checked
 * individually, and the eighth is derived. There is NO type assertion anywhere on
 * this path, so the compiler -- not a cast -- is what proves the mapping
 * complete: add a member to `ProjectStats` and this function stops compiling,
 * which is precisely the intended failure.
 *
 * The derivation itself is delegated to `toProjectStats`
 * (`../../shared/api/projects.ts:385`-`:404`), the pure function that already
 * carries `main.coffee:266`-`:272` verbatim -- the truthy `total_points` fallback
 * to `defined_points`, the truthy guard that yields `0` rather than a division
 * artefact, and `Math.round`. Section 4 of the file header records why the
 * arithmetic is reused rather than re-typed here, and the co-located spec pins
 * all three properties THROUGH this function so the behaviour is provable from
 * this file.
 *
 * Returns `null`, never a partially populated object, when the snapshot is
 * absent or does not carry the wire shape -- which is the honest answer before
 * the controller's first statistics read resolves. `main.coffee:94` initialises
 * the companion placeholder flag to the nothing-value for the same reason.
 *
 * @param snapshot - whatever the statistics getter answered with.
 * @returns the canonical statistics, or `null` when the snapshot is not one.
 */
export function toCanonicalProjectStats(snapshot: unknown): ProjectStats | null {
    if (!isRecord(snapshot)) {
        return null;
    }

    const assignedPoints = readNumber(snapshot, 'assigned_points');
    const closedPoints = readNumber(snapshot, 'closed_points');
    const definedPoints = readNumber(snapshot, 'defined_points');
    const speed = readNumber(snapshot, 'speed');
    const totalPoints = readNullableNumber(snapshot, 'total_points');
    const totalMilestones = readNullableNumber(snapshot, 'total_milestones');
    const milestones = readBurndownMilestones(snapshot['milestones']);

    if (assignedPoints === null || closedPoints === null || definedPoints === null) {
        return null;
    }

    if (speed === null || totalPoints === undefined || totalMilestones === undefined) {
        return null;
    }

    if (milestones === null) {
        return null;
    }

    // The seven WIRE members, assembled one at a time. The snake_case spelling is
    // the wire's and is preserved exactly: goal G2 freezes it, and the chart and
    // the summary bar read these names (T10).
    return toProjectStats({
        assigned_points: assignedPoints,
        closed_points: closedPoints,
        defined_points: definedPoints,
        speed,
        total_points: totalPoints,
        total_milestones: totalMilestones,
        milestones,
    });
}

/**
 * Whether the burndown chart is replaced by its placeholder.
 *
 * ⭐ AN EXISTENCE TEST, NOT A TRUTHINESS TEST. `main.coffee:274`, verbatim:
 *
 *     @scope.showGraphPlaceholder = !(stats.total_points? && stats.total_milestones?)
 *
 * CoffeeScript's `?` compiles to a null-and-undefined check, so a project whose
 * totals are legitimately ZERO still gets the chart. Reading these two with a
 * truthiness test would swap in the placeholder for such a project -- a visible
 * regression, and exactly why the canonical type keeps both members nullable.
 *
 * Answers `true` when there are no statistics at all, which is what an absent
 * chart should show; the incumbent reaches this line only after the read
 * resolved, and until then its flag sits at the nothing-value it was given at
 * `main.coffee:94`.
 */
export function resolveShowGraphPlaceholder(stats: ProjectStats | null): boolean {
    if (stats === null) {
        return true;
    }

    return !(stats.total_points !== null && stats.total_milestones !== null);
}

/**
 * Derives the three milestone counters from the two live sprint collections.
 *
 * See {@link BacklogMilestoneCounts} for the incumbent locators, the dead line at
 * `main.coffee:319` and the reason a missing header's not-a-number value has to
 * survive. The addition below has NO fallback, NO default and NO coercion, so it
 * propagates whatever it is handed -- which is the whole point.
 *
 * The counts come from the collections the retained controller already holds
 * rather than from a second read of the sprint endpoint: reading it again would
 * be a request no session makes today (rule T10), and sprint loading belongs to
 * `useSprints.ts`.
 *
 * ⭐ `.length` AND NOT A COLLECTION'S OWN SIZE MEMBER. The bridge flattens
 * everything to plain arrays (`react-bridge.coffee:89`-`:101`), and requirement
 * I5 keeps the persistent-collection library for its out-of-scope consumers
 * without letting it across this seam. That difference is the exact boundary.
 */
export function deriveMilestoneCounts(
    openSprints: readonly unknown[],
    closedSprints: readonly unknown[],
): BacklogMilestoneCounts {
    const totalOpenMilestones = openSprints.length;
    const totalClosedMilestones = closedSprints.length;

    return {
        totalOpenMilestones,
        totalClosedMilestones,
        // `main.coffee:322`, with no guard of its own -- deliberately.
        totalMilestones: totalOpenMilestones + totalClosedMilestones,
    };
}

/**
 * Resolves the stored tag-pill preference exactly as the incumbent's two reads do.
 *
 * Defects BC-2 and ST-1, both preserved; {@link BacklogShowTagsResolution} carries
 * the locators and the full argument. The three cases, and nothing between them:
 *
 *   - stored `false` -> the flag becomes `false` and NOTHING is broadcast
 *     (`main.coffee:502`-`:503`, a STRICT equality test).
 *   - stored `true` -> the flag becomes `true` AND the change is broadcast
 *     (`main.coffee:113`-`:116`, a TRUTHINESS test).
 *   - stored `null` -> NEITHER test is satisfied, so the flag keeps the `true`
 *     the constructor gave it at `main.coffee:91` and nothing is broadcast.
 *
 * The comparisons are explicit rather than truthiness-based precisely because
 * `false` and `null` are the two values that carry the meaning here, and a
 * truthiness test cannot tell them apart.
 *
 * @param stored - what the synchronous store answered with; `null` when absent,
 *                 and `null` again when the stored text would not parse (ST-1).
 */
export function resolveInitialShowTags(stored: boolean | null): BacklogShowTagsResolution {
    if (stored === false) {
        return { showTags: false, shouldBroadcast: false };
    }

    if (stored === true) {
        return { showTags: true, shouldBroadcast: true };
    }

    // `null`: neither incumbent branch fires, so the constructor's value stands.
    return { showTags: true, shouldBroadcast: false };
}

/**
 * Orders the story statuses the way the BACKLOG orders them.
 *
 * ⭐⭐ BY `id`, AND NEVER BY `order`. `main.coffee:490` is
 * `_.sortBy(project.us_statuses, "id")`, while the Kanban board sorts the SAME
 * collection by `"order"` at `app/coffee/modules/kanban/main.coffee:631`. The
 * divergence is genuine incumbent behaviour and unifying the two would reorder
 * one screen's status controls (T10). It is re-applied here rather than trusted
 * from the bridge so that the ordering this screen depends on is stated in the
 * screen's own code, where the next reader will look for it.
 *
 * A COPY is sorted, never the argument: the list arrives `readonly` and is shared
 * with the bootstrap parameters. The comparison is numeric subtraction, which is
 * what the utility library's key-based sort performs for numeric keys, and it is
 * stable in every engine this application supports.
 */
export function sortBacklogStatuses(statuses: readonly Status[]): readonly Status[] {
    return [...statuses].sort((left, right) => left.id - right.id);
}

/**
 * Builds a LEADING-EDGE guard: the first call passes, later ones are dropped.
 *
 * ⭐⭐ DEFECT DBN-1. `app/coffee/utils.coffee:117`-`:118` is
 * `_.debounce(func, wait, {leading: true, trailing: false})`, exported as the
 * plainly named wrapper at `:293`, while `:121`-`:122` gives the TRAILING
 * behaviour to the wrapper whose name says leading. The names are inverted
 * relative to the conventional reading, so the two-second window at
 * `app/coffee/modules/common/popovers.coffee:51` is a DOUBLE-SUBMIT GUARD and not
 * a delay. A timer-based reading would add a two-second lag no user has today,
 * which rule T10 forbids.
 *
 * Implemented against the clock rather than with a timer, for two reasons: there
 * is no handle to leak, and no callback can fire after the screen has gone --
 * which a pending timer could. The trailing edge is deliberately absent: a
 * dropped call is DROPPED, never replayed when the window closes.
 *
 * @param windowMs - the suppression window, in milliseconds.
 * @param action - what the leading call performs.
 * @param now - the clock, injectable so the window is assertable without waiting.
 * @returns a function that runs `action` at most once per window.
 */
export function createLeadingEdgeGuard<TArgs extends readonly unknown[]>(
    windowMs: number,
    action: (...args: TArgs) => void,
    now: () => number = () => Date.now(),
): (...args: TArgs) => void {
    let lastAcceptedAt: number | null = null;

    return (...args: TArgs): void => {
        const currentTime = now();

        if (lastAcceptedAt !== null && currentTime - lastAcceptedAt < windowMs) {
            // Inside the window: dropped, and NOT queued for the trailing edge.
            return;
        }

        lastAcceptedAt = currentTime;

        action(...args);
    };
}

/* ==========================================================================
 * SNAPSHOT READERS
 *
 * The bridge answers every getter with plain data, so each reader below is a
 * total narrowing with a defined answer for "the controller has not got there
 * yet". None of them converts a value the incumbent leaves unconverted.
 * ========================================================================== */

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

function readObjectArray(value: unknown): readonly Record<string, unknown>[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(isRecord);
}

/**
 * Reads the rows, keeping only entries that carry the members every consumer
 * dereferences.
 *
 * `id` and `ref` are required because the rows are keyed and linked by them, and
 * `subject` because it is what the row renders. The remaining members are
 * forwarded as they arrived: this is a boundary check, not a transformation, and
 * silently repairing a row would hide a contract change rather than surface it.
 *
 * ⭐ `new` IS A REAL MEMBER AND IT IS NOT DROPPED. `main.coffee:391` sets
 * `it.new = true` on every row whose id is in the just-created set, which is what
 * gives a freshly created row its highlight class.
 *
 * ⭐ DEFECT BC-1, RECORDED BUT NOT THIS HOOK'S TO CARRY. The set of just-created
 * ids is `newUs`, declared as a PROTOTYPE-LEVEL array on the controller class
 * (`main.coffee:54`) -- shared by every instance -- and saved from the classic
 * shared-mutable-default bug only because both write sites REASSIGN it rather than
 * pushing into it (`:160` and `:180`). It stays entirely on the AngularJS side: the
 * flag reaches React already stamped onto the row, so nothing here reproduces the
 * array or its reassignment semantics, and nothing here may start mutating a
 * collection that arrives flattened.
 */
function readUserStories(value: unknown): readonly BacklogUserStory[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(isBacklogUserStory);
}

/**
 * The membership test behind {@link readUserStories}.
 *
 * A type predicate whose body performs no assertion: it states the three members
 * every consumer dereferences, and the rest of the row reaches React exactly as
 * the server sent it -- which is what keeps the wire contract frozen (G2). The
 * house style at this seam is the same shape, at
 * `../../bridge/useAngularService.ts`'s own structural predicates.
 */
function isBacklogUserStory(value: unknown): value is BacklogUserStory {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value['id'] === 'number' &&
        typeof value['ref'] === 'number' &&
        typeof value['subject'] === 'string'
    );
}

/** Reads the visible-row REFERENCES, which is what the controller stores. */
function readReferences(value: unknown): readonly number[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((entry): entry is number => typeof entry === 'number');
}

/**
 * Reads the total-rows header value WITHOUT converting it.
 *
 * ⭐ NO NUMERIC CONVERSION IS PERFORMED, and none may be added.
 * `main.coffee:403` assigns the raw header text and `:84` initialises the member
 * to the number zero, so both shapes are real and both are preserved. Converting
 * here would change what every consumer of this member sees.
 */
function readTotalUserStories(value: unknown): string | number {
    if (typeof value === 'string' || typeof value === 'number') {
        return value;
    }

    return 0;
}

/**
 * Finds one flattened row by id, reading the LIVE getter rather than a snapshot.
 *
 * The getter is the authority (section 1, fact (2)), and reading it at write time
 * also means the row seen is the row AngularJS holds rather than the one React
 * last rendered -- which matters because the `version` carried in that row is
 * what the optimistic-concurrency check depends on.
 */
function findUserStoryRow(
    events: BacklogBridgeEvents,
    userStoryId: number,
): BacklogUserStory | null {
    for (const row of readUserStories(events.getUserStories())) {
        if (row.id === userStoryId) {
            return row;
        }
    }

    return null;
}

/**
 * Resolves the LIVE MODEL to write, minting and retaining one when needed.
 *
 * Section 6 carries the argument. A retained model is preferred so a second
 * change to the same row reuses the same dirty tracking; otherwise one is minted
 * from the flattened row -- `make_model` plus one `setAttr` is exactly what
 * produces the `{status, version}` body requirement I7 asks for
 * (`app/coffee/modules/base/model.coffee:49`-`:53`) -- and then kept, so the
 * registry converges on one instance per row.
 *
 * Answers `null` when the row is not on this screen at all, because inventing an
 * identifier would write to the wrong record.
 *
 * A free function rather than a closure, so a spec can drive it with a registry,
 * a model-factory double and a getter double, and assert the retention directly.
 */
function resolveUserStoryModelForWrite(
    registry: Map<number, TaigaModel<UserStory>>,
    modelFactory: { make_model<TAttrs>(name: string, data: TAttrs): TaigaModel<TAttrs> },
    events: BacklogBridgeEvents,
    userStoryId: number,
): TaigaModel<UserStory> | null {
    const retained = registry.get(userStoryId);

    if (retained !== undefined) {
        return retained;
    }

    const row = findUserStoryRow(events, userStoryId);

    if (row === null) {
        return null;
    }

    const minted = modelFactory.make_model<UserStory>(USER_STORY_MODEL_NAME, row);

    registry.set(userStoryId, minted);

    return minted;
}

/** Counts the selected filters across every filter type. */
function countSelectedFilters(value: unknown): number {
    if (!isRecord(value)) {
        return 0;
    }

    let total = 0;

    for (const bucket of Object.values(value)) {
        if (Array.isArray(bucket)) {
            total += bucket.length;
        }
    }

    return total;
}


/* ==========================================================================
 * THE LIVE SNAPSHOT
 * ========================================================================== */

/**
 * Everything the getters answer with, read in one pass.
 *
 * ONE OBJECT PER PULL, replaced wholesale rather than patched, which is what
 * makes "the screen re-rendered because AngularJS told us something changed" a
 * single state transition instead of a dozen. Nothing here holds a live model, so
 * nothing here can reach a draft (section 6).
 */
interface BacklogLiveSnapshot {
    readonly project: BacklogProject | null;
    readonly userStories: readonly BacklogUserStory[];
    readonly visibleUserStories: readonly number[];
    readonly totalUserStories: string | number;
    readonly stats: ProjectStats | null;
    readonly milestoneCounts: BacklogMilestoneCounts;
    readonly filterQ: string;
    readonly activeFilters: boolean;
    readonly selectedFilterCount: number;
    readonly storedShowTags: boolean;
    readonly displayVelocity: boolean;
    readonly forecastedStories: readonly BacklogUserStory[];
    readonly disablePagination: boolean;
    readonly firstLoadComplete: boolean;
    readonly swimlanesList: readonly Swimlane[];
}

/**
 * Reads every live value the screen needs, through the bridge getters.
 *
 * A FREE FUNCTION rather than a member of the hook, so a spec can assert the
 * whole read against a getter double without rendering. It is called on the first
 * render and again on every notification -- never on a timer, and never from a
 * watcher over the bootstrap parameters (section 1).
 *
 * @param events - the bridge callbacks.
 * @param fallbackShowTags - the value the tag flag keeps when the getter has not
 *                           yet been given one; supplied by the caller so the
 *                           first-load resolution of defect BC-2 survives the
 *                           subsequent pulls.
 */
function readLiveSnapshot(
    events: BacklogBridgeEvents,
    fallbackShowTags: boolean,
): BacklogLiveSnapshot {
    const projectSnapshot = events.getProject();
    const userStories = readUserStories(events.getUserStories());

    return {
        project: isRecord(projectSnapshot) ? readProject(projectSnapshot) : null,
        userStories,
        visibleUserStories: readReferences(events.getVisibleUserStories()),
        totalUserStories: readTotalUserStories(events.getTotalUserStories()),
        stats: toCanonicalProjectStats(events.getStats()),
        milestoneCounts: deriveMilestoneCounts(
            readObjectArray(events.getSprints()),
            readObjectArray(events.getClosedSprints()),
        ),
        filterQ: readString(events.getFilterQ(), ''),
        activeFilters: readBoolean(events.getActiveFilters(), false),
        selectedFilterCount: countSelectedFilters(events.getSelectedFilters()),
        storedShowTags: readBoolean(events.getShowTags(), fallbackShowTags),
        displayVelocity: readBoolean(events.getDisplayVelocity(), false),
        forecastedStories: readUserStories(events.getForecastedStories()),
        disablePagination: readBoolean(events.getDisablePagination(), false),
        firstLoadComplete: readBoolean(events.getFirstLoadComplete(), false),
        swimlanesList: readSwimlanes(events.getSwimlanes()),
    };
}

/**
 * Narrows the project members section 7's permission gates and the story rows
 * need.
 *
 * `my_permissions` and `roles` default to EMPTY rather than to something
 * permissive: a project whose permission list has not arrived grants nothing,
 * which fails closed. That is presentation only -- every bridge action re-checks
 * against live services before delegating -- but failing closed is still the
 * right default for what the user is shown.
 */
function readProject(source: Record<string, unknown>): BacklogProject {
    return {
        id: readNumber(source, 'id') ?? 0,
        name: readString(source['name'], ''),
        slug: readString(source['slug'], ''),
        my_permissions: readStringArray(source['my_permissions']),
        roles: readRoles(source['roles']),
    };
}

function readStringArray(value: unknown): readonly string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Narrows the project roles the story rows' point columns need.
 *
 * `computable` decides whether a role takes estimation points at all, and
 * `../state/backlogSelectors.ts` filters on it, so a role arriving without it is
 * dropped rather than defaulted -- defaulting it either way would either invent a
 * points column or hide a real one.
 */
function readRoles(value: unknown): readonly ProjectRole[] {
    const roles: ProjectRole[] = [];

    for (const candidate of readObjectArray(value)) {
        const id = readNumber(candidate, 'id');
        const name = candidate['name'];
        const computable = candidate['computable'];

        if (id === null || typeof name !== 'string' || typeof computable !== 'boolean') {
            continue;
        }

        roles.push({ id, name, computable });
    }

    return roles;
}

/** Narrows the swimlane list; `statuses` stays optional, as the type has it. */
function readSwimlanes(value: unknown): readonly Swimlane[] {
    const swimlanes: Swimlane[] = [];

    for (const candidate of readObjectArray(value)) {
        const id = readNumber(candidate, 'id');
        const name = candidate['name'];

        if (id === null || typeof name !== 'string') {
            continue;
        }

        swimlanes.push({ id, name });
    }

    return swimlanes;
}

/* ==========================================================================
 * THE HOOK
 * ========================================================================== */

/**
 * The Backlog / Sprint-Planning screen's data container.
 *
 * Bootstraps from the set-once parameters, reads live values through the bridge
 * getters, re-reads them when AngularJS says something changed, owns the one
 * inline write this screen performs, and hands the screen flattened plain data
 * plus stable callbacks. The file header carries the reasoning for every one of
 * those decisions; the summary is:
 *
 *   - PULL ON NOTIFY, never push (section 1). No interval, no watcher, no proxy.
 *   - NO CLIENT OF OUR OWN, and no request of our own either (sections 2 and 3).
 *     Exactly ONE resource-service resolution, used for ONE synchronous
 *     local-storage read.
 *   - THE CANONICAL STATISTICS ARE BUILT HERE, field by field, with the
 *     incumbent's arithmetic and its existence-tested placeholder flag
 *     (section 4).
 *   - THE STATUS WRITE IS GUARDED ON THE LEADING EDGE AND HAS NO REVERT
 *     (section 5), and it goes through a live model held in a ref (section 6).
 *   - EVERY LISTENER IS RELEASED on unmount, and no handler runs after it.
 *
 * Callbacks are stable, so the presentational siblings can be memoised and the
 * structural sharing of the reducers under `../state/` is worth having
 * (P-IMMER-4).
 *
 * @param params - the set-once bootstrap parameters from the bridge payload.
 * @param events - the bridge callbacks from the same payload.
 * @returns the screen's data and actions, deeply `readonly`.
 */
export function useBacklogData(
    params: BacklogBridgeParams,
    events: BacklogBridgeEvents,
): UseBacklogDataResult {
    /* ------------------------------------------------------------------
     * THE ONE RESOURCE-SERVICE RESOLUTION FOR THIS SCREEN (section 3), plus the
     * repository and model factory the single write needs (sections 2 and 6).
     *
     * All three are sanctioned names on the injector map owned by
     * `../../bridge/useAngularService.ts`. Neither scope service, the promise
     * service nor the raw transport is reachable from here BY DESIGN -- a scope
     * would invite the digest participation this migration forbids, and a raw
     * transport would bypass every interceptor the migration exists to inherit.
     * ------------------------------------------------------------------ */
    const resources = useAngularService('$tgResources');
    const repository = useAngularService('$tgRepo');
    const modelFactory = useAngularService('$tgModel');

    /* ------------------------------------------------------------------
     * THE LIVE-MODEL REGISTRY (section 6, pitfall P-IMMER-1).
     *
     * A ref, so it is never state, never diffed and never drafted. Keyed by story
     * id, because that is what both the write path and a caller handing a model
     * over have to address.
     * ------------------------------------------------------------------ */
    const userStoryModels = useRef<Map<number, TaigaModel<UserStory>>>(
        new Map<number, TaigaModel<UserStory>>(),
    );

    /* ------------------------------------------------------------------
     * FIRST-LOAD RESOLUTION OF THE STORED TAG PREFERENCE (defects BC-2, ST-1).
     *
     * ⭐ SYNCHRONOUS, AND THEREFORE NOT AWAITED AND NOT MARSHALLED. The facade
     * reads local storage inline (section 3), so this is an initialiser rather
     * than an effect -- and it runs ONCE, because the stored value is the
     * incumbent's first-load input and re-reading it on every render would let a
     * later store write reorder the resolution.
     *
     * ⭐ WHAT THIS IS FOR, since the controller performs the same double read on
     * its own side and the tag getter therefore already reflects it. Two things
     * that the getter cannot supply: the value the flag holds BEFORE the
     * controller's own resolution has reached the getter, which is what the
     * snapshot below falls back to; and the BROADCAST half of defect BC-2, which
     * is a property of the truthy branch alone and is surfaced rather than acted
     * on because raising an AngularJS event is not this hook's to do. It is a
     * faithful reproduction of the rule, not a second source of truth.
     * ------------------------------------------------------------------ */
    const [showTagsResolution] = useState<BacklogShowTagsResolution>(() =>
        resolveInitialShowTags(getShowTags(resources.userstories, params.projectId)),
    );

    /* ------------------------------------------------------------------
     * THE SNAPSHOT.
     *
     * Seeded by reading the getters during the initialiser rather than in an
     * effect, so the first paint already carries whatever the retained controller
     * had loaded before React mounted -- which, because the bridge publishes only
     * after the project resolved, is normally the whole first page.
     * ------------------------------------------------------------------ */
    const [snapshot, setSnapshot] = useState<BacklogLiveSnapshot>(() =>
        readLiveSnapshot(events, showTagsResolution.showTags),
    );

    /*
     * `events` and the resolved tag flag are held in refs as well as consumed
     * directly, so that the notification effect below never has to list them as
     * dependencies. Re-registering seven AngularJS listeners because a parent
     * re-rendered with a fresh payload object would drop deliveries in the gap
     * between release and re-registration.
     */
    const eventsRef = useRef<BacklogBridgeEvents>(events);
    const showTagsFallbackRef = useRef<boolean>(showTagsResolution.showTags);

    useEffect(() => {
        eventsRef.current = events;
    }, [events]);

    useEffect(() => {
        showTagsFallbackRef.current = showTagsResolution.showTags;
    }, [showTagsResolution.showTags]);

    /*
     * THE LIFECYCLE GUARD. A broadcast can be delivered in the same digest in
     * which React is unmounting -- the event service never removes its local
     * registry entry, so a message already in flight still reaches its listener.
     * This ref is armed on mount and set in a cleanup that React runs BEFORE the
     * listeners are released, because cleanups run in the order their effects
     * were created and this effect is created first. While it is set, no pull
     * touches state at all.
     */
    const cancelledRef = useRef<boolean>(false);

    useEffect(() => {
        cancelledRef.current = false;

        return () => {
            cancelledRef.current = true;
        };
    }, []);

    /**
     * Re-reads every live value. THE ONLY WRITER OF THE SNAPSHOT.
     *
     * Identity-stable: it reads the payload out of a ref, so it can be a
     * dependency of the notification effect without ever invalidating it.
     */
    const refresh = useCallback((): void => {
        if (cancelledRef.current) {
            return;
        }

        setSnapshot(readLiveSnapshot(eventsRef.current, showTagsFallbackRef.current));
    }, []);

    /* ------------------------------------------------------------------
     * PULL ON NOTIFY (section 1, fact (3)).
     *
     * ONE effect for all seven events, because they share one lifetime exactly:
     * they are taken together, released together, and no key or option could ever
     * move one without moving the others. Every deregistration handed back is
     * called on cleanup, unconditionally -- the registrar may legitimately answer
     * with nothing in a spec double, which is why the result is checked before it
     * is invoked rather than assumed callable.
     * ------------------------------------------------------------------ */
    useEffect(() => {
        const registrar = eventsRef.current.onAngularEvent;
        const deregistrations: BacklogDataEventDeregistrar[] = [];

        for (const eventName of BACKLOG_DATA_REPULL_EVENTS) {
            const deregister = registrar(eventName, (): void => {
                refresh();
            });

            if (typeof deregister === 'function') {
                deregistrations.push(deregister);
            }
        }

        return () => {
            for (const deregister of deregistrations) {
                deregister();
            }
        };
    }, [refresh]);

    /* ------------------------------------------------------------------
     * BOOTSTRAP VALUES (section 1, fact (1)).
     *
     * Read from the parameters, not from the snapshot, because these are the
     * set-once half of the payload. The status list is re-sorted by `id` here so
     * that the ordering this screen depends on is stated in this screen's code --
     * see {@link sortBacklogStatuses} for why unifying it with the board's would
     * be a regression.
     * ------------------------------------------------------------------ */
    const usStatusList = useMemo(
        () => sortBacklogStatuses(params.usStatusList),
        [params.usStatusList],
    );

    /*
     * PERMISSIONS ARE READ, NEVER RECOMPUTED (section 7). The live project is
     * preferred over the bootstrapped one when it has arrived, because a
     * membership change reaches the getter and cannot reach the parameters.
     */
    const permissions = useMemo<readonly string[]>(() => {
        const live = snapshot.project;

        if (live !== null && live.my_permissions.length > 0) {
            return live.my_permissions;
        }

        return params.project.my_permissions;
    }, [snapshot.project, params.project.my_permissions]);

    const roles = useMemo<readonly ProjectRole[]>(() => {
        const live = snapshot.project;

        if (live !== null && live.roles.length > 0) {
            return live.roles;
        }

        return params.project.roles;
    }, [snapshot.project, params.project.roles]);


    /* ------------------------------------------------------------------
     * DERIVED VIEW VALUES.
     * ------------------------------------------------------------------ */

    const showGraphPlaceholder = useMemo(
        () => resolveShowGraphPlaceholder(snapshot.stats),
        [snapshot.stats],
    );

    /*
     * `resetFirstStoryIndicator` (`main.coffee:515`-`:517`) guards on a non-empty
     * collection, so an empty backlog leaves the indicator unset rather than
     * pointing at nothing. `null` is that unset state.
     */
    const firstUserStoryIdInBacklog = useMemo<number | null>(() => {
        const first = snapshot.userStories[0];

        return first === undefined ? null : first.id;
    }, [snapshot.userStories]);

    /*
     * DELEGATED, NEVER REIMPLEMENTED (section 7, defect DL-1). The selector under
     * `../state/` owns the arithmetic and the always-renders behaviour; this hook
     * only supplies its two inputs.
     */
    const doomLineIndex = useMemo(
        () => selectDoomLineIndex(snapshot.stats, snapshot.userStories),
        [snapshot.stats, snapshot.userStories],
    );

    /* ------------------------------------------------------------------
     * ACTIONS.
     *
     * Every one delegates to a bridge callback and marshals the result, so the
     * request keeps going through the existing resource and repository layers and
     * inherits the whole interceptor chain (section 2). Rejections are NOT caught
     * here: swallowing one would hide a version conflict, a blocked project or
     * connection loss from the screen whose job it is to surface them.
     *
     * The marshaller resolves a non-thenable as itself, which is exactly what a
     * permission refusal produces -- the bridge returns early rather than
     * answering with a promise -- so a refused action settles instead of throwing.
     * ------------------------------------------------------------------ */

    const loadUserstories = useCallback(
        (): Promise<unknown> => toNativePromise(eventsRef.current.loadUserstories()),
        [],
    );

    const loadProjectStats = useCallback(
        (): Promise<unknown> => toNativePromise(eventsRef.current.loadProjectStats()),
        [],
    );

    const addNewUs = useCallback(
        (kind: string): Promise<unknown> => toNativePromise(eventsRef.current.addNewUs(kind)),
        [],
    );

    /*
     * The project id is supplied from the bootstrap parameters rather than asked
     * of the caller, because the bridge substitutes its own scope's id anyway
     * (`react-bridge.coffee:470` passes `$scope.projectId`, not the argument) --
     * so accepting one here would advertise a choice the seam does not honour.
     */
    const editUserStory = useCallback(
        (ref: number, event?: unknown): Promise<unknown> =>
            toNativePromise(eventsRef.current.editUserStory(params.projectId, ref, event)),
        [params.projectId],
    );

    /*
     * A row OR its id, because the bridge accepts either: it reads an id off an
     * object when it is given one and takes a bare value otherwise
     * (`react-bridge.coffee`'s `idOf`), and then re-hydrates the LIVE model from
     * its own collections before delegating -- which is why React can pass
     * flattened data here without breaking the model-only write rule of section 6.
     */
    const deleteUserStory = useCallback(
        (userStory: number | BacklogUserStory): Promise<unknown> =>
            toNativePromise(eventsRef.current.deleteUserStory(userStory)),
        [],
    );

    const changeQ = useCallback(
        (q: string): Promise<unknown> => toNativePromise(eventsRef.current.changeQ(q)),
        [],
    );

    const addFilter = useCallback(
        (filter: unknown): Promise<unknown> =>
            toNativePromise(eventsRef.current.addFilterBacklog(filter)),
        [],
    );

    const removeFilter = useCallback(
        (filter: unknown): Promise<unknown> =>
            toNativePromise(eventsRef.current.removeFilterBacklog(filter)),
        [],
    );

    const saveCustomFilter = useCallback(
        (name: string): Promise<unknown> =>
            toNativePromise(eventsRef.current.saveCustomFilter(name)),
        [],
    );

    const selectCustomFilter = useCallback(
        (filter: unknown): Promise<unknown> =>
            toNativePromise(eventsRef.current.selectCustomFilter(filter)),
        [],
    );

    const removeCustomFilter = useCallback(
        (filter: unknown): Promise<unknown> =>
            toNativePromise(eventsRef.current.removeCustomFilter(filter)),
        [],
    );

    /*
     * The three toggles below each flip a flag the controller owns, so each one
     * delegates and then re-reads. The tag toggle in particular ALSO persists the
     * flag on the AngularJS side (`main.coffee:245`-`:247`); writing the store
     * from here as well would produce two writes per toggle.
     */
    const toggleActiveFilters = useCallback((): Promise<unknown> => {
        const result = toNativePromise(eventsRef.current.toggleActiveFilters());

        refresh();

        return result;
    }, [refresh]);

    const toggleShowTags = useCallback((): Promise<unknown> => {
        const result = toNativePromise(eventsRef.current.toggleShowTags());

        refresh();

        return result;
    }, [refresh]);

    const toggleVelocityForecasting = useCallback((): Promise<unknown> => {
        const result = toNativePromise(eventsRef.current.toggleVelocityForecasting());

        refresh();

        return result;
    }, [refresh]);

    /* ------------------------------------------------------------------
     * THE LIVE-MODEL REGISTRY, PUBLIC HALF (section 6).
     * ------------------------------------------------------------------ */

    const retainUserStoryModel = useCallback((model: TaigaModel<UserStory>): void => {
        const attributes = model.getAttrs();

        // Keyed by the story's own id, read through the model's public accessor
        // rather than off its private bag, so the key survives a model whose
        // attributes were replaced by a save.
        if (typeof attributes.id === 'number') {
            userStoryModels.current.set(attributes.id, model);
        }
    }, []);

    const getUserStoryModel = useCallback(
        (userStoryId: number): TaigaModel<UserStory> | null =>
            userStoryModels.current.get(userStoryId) ?? null,
        [],
    );

    /* ------------------------------------------------------------------
     * THE ONE WRITE (section 5).
     *
     * Composed in two halves so the guard wraps a stable function: the inner half
     * performs the change, and the outer half is the leading-edge gate built once
     * and kept for the lifetime of the screen -- rebuilding it per render would
     * reset the suppression window and defeat the guard entirely, which is the
     * single easiest way to get defect DBN-1 wrong.
     * ------------------------------------------------------------------ */

    const applyStatusChange = useCallback(
        (userStoryId: number, statusId: number): void => {
            // 1. THE OPTIMISTIC LOCAL CHANGE, mirroring `us.status = ...` at
            //    `app/coffee/modules/common/popovers.coffee:60`. Written as a
            //    replacement rather than a mutation, because the rows are shared
            //    with the components and are declared `readonly`.
            setSnapshot((current) => ({
                ...current,
                userStories: current.userStories.map((row) =>
                    row.id === userStoryId ? { ...row, status: statusId } : row,
                ),
            }));

            // 2. THE PERSISTED CHANGE, through a LIVE MODEL so that requirement
            //    I7's changed-fields-only versioned PATCH is inherited rather than
            //    re-derived. A retained model is preferred, so a second change to
            //    the same row reuses the same dirty tracking; otherwise one is
            //    minted from the flattened row and then retained. `setAttr`
            //    records exactly one field, and `save` copies the
            //    optimistic-concurrency version alongside it
            //    (`base/model.coffee:49`-`:53`), so the request body is
            //    `{status, version}` and nothing else.
            const model = resolveUserStoryModelForWrite(
                userStoryModels.current,
                modelFactory,
                eventsRef.current,
                userStoryId,
            );

            if (model === null) {
                return;
            }

            model.setAttr('status', statusId);

            // 3. THE SAVE. No digest is driven from here and none is needed: the
            //    write is HTTP-backed, and the AngularJS transport layer settles
            //    its own promise from the response. The short-circuit that would
            //    resolve without a request applies only to an UNMODIFIED model
            //    (`base/repository.coffee:55`-`:57`), and the `setAttr` above has
            //    just modified this one, so that branch cannot be taken.
            //
            //    ⭐ DEFECT STATUS-1, PRESERVED: THERE IS NO REVERT.
            //    `app/coffee/modules/common/popovers.coffee:66` attaches a
            //    fulfilment handler only, so a failed save leaves the optimistic
            //    value on screen until the next reload. Adding a revert would
            //    change behaviour (T10). The rejection handler below is EMPTY for
            //    exactly that reason -- it acts on nothing, which is what the
            //    incumbent does; it exists only so a rejected write does not
            //    surface as an unhandled rejection in the host runtime, and the
            //    interceptor chain still raises the version conflict, the blocked
            //    project or the connection loss to the user.
            void toNativePromise(repository.save(model)).then(
                () => {
                    // `popovers.coffee:67`'s `onUpdate`. Its own broadcast of the
                    // filter update (`main.coffee:678`) is one of
                    // {@link BACKLOG_DATA_REPULL_EVENTS}, so the re-read arrives
                    // through the notification path rather than being forced here
                    // -- which is the pull-on-notify contract of section 1 applied
                    // to this hook's own write.
                    void toNativePromise(eventsRef.current.updateUserStoryStatus()).then(
                        () => undefined,
                        () => undefined,
                    );
                },
                () => undefined,
            );
        },
        [modelFactory, repository],
    );

    /*
     * The guard is built ONCE per screen and kept in a ref, because its whole
     * behaviour is the state it carries between calls: the timestamp of the last
     * accepted change. A guard rebuilt on re-render would accept every click.
     */
    const statusGuardRef = useRef<((userStoryId: number, statusId: number) => void) | null>(null);
    const applyStatusChangeRef = useRef<(userStoryId: number, statusId: number) => void>(
        applyStatusChange,
    );

    useEffect(() => {
        applyStatusChangeRef.current = applyStatusChange;
    }, [applyStatusChange]);

    if (statusGuardRef.current === null) {
        statusGuardRef.current = createLeadingEdgeGuard(
            STATUS_CHANGE_GUARD_WINDOW_MS,
            (userStoryId: number, statusId: number): void => {
                applyStatusChangeRef.current(userStoryId, statusId);
            },
        );
    }

    const changeUserStoryStatus = useCallback((userStoryId: number, statusId: number): void => {
        const guard = statusGuardRef.current;

        if (guard !== null) {
            guard(userStoryId, statusId);
        }
    }, []);

    /* ------------------------------------------------------------------
     * THE RESULT.
     *
     * Memoised so a screen that re-renders for an unrelated reason hands its
     * memoised children the same object, which is what makes the callbacks' stable
     * identities worth having.
     * ------------------------------------------------------------------ */
    return useMemo<UseBacklogDataResult>(
        () => ({
            projectId: params.projectId,
            project: snapshot.project ?? params.project,
            sectionName: params.sectionName,
            points: params.points,
            pointsById: params.pointsById,
            usStatusById: params.usStatusById,
            usStatusList,
            closedMilestones: params.closedMilestones,
            swimlanesList:
                snapshot.swimlanesList.length > 0 ? snapshot.swimlanesList : params.swimlanesList,
            roles,

            permissions,
            canAddUs: hasPermission(permissions, PERMISSION_ADD_US),
            canModifyUs: hasPermission(permissions, PERMISSION_MODIFY_US),
            canDeleteUs: hasPermission(permissions, PERMISSION_DELETE_US),
            canAddMilestone: hasPermission(permissions, PERMISSION_ADD_MILESTONE),
            canModifyMilestone: hasPermission(permissions, PERMISSION_MODIFY_MILESTONE),
            canViewMilestones: hasPermission(permissions, PERMISSION_VIEW_MILESTONES),

            userStories: snapshot.userStories,
            visibleUserStories: snapshot.visibleUserStories,
            totalUserStories: snapshot.totalUserStories,
            stats: snapshot.stats,
            showGraphPlaceholder,
            milestoneCounts: snapshot.milestoneCounts,
            filterQ: snapshot.filterQ,
            activeFilters: snapshot.activeFilters,
            selectedFilterCount: snapshot.selectedFilterCount,
            showTags: snapshot.storedShowTags,
            displayVelocity: snapshot.displayVelocity,
            forecastedStories: snapshot.forecastedStories,
            disablePagination: snapshot.disablePagination,
            firstLoadComplete: snapshot.firstLoadComplete,
            firstUserStoryIdInBacklog,
            doomLineIndex,

            refresh,
            loadUserstories,
            loadProjectStats,
            addNewUs,
            editUserStory,
            deleteUserStory,
            changeUserStoryStatus,
            changeQ,
            addFilter,
            removeFilter,
            saveCustomFilter,
            selectCustomFilter,
            removeCustomFilter,
            toggleActiveFilters,
            toggleShowTags,
            toggleVelocityForecasting,
            retainUserStoryModel,
            getUserStoryModel,
            showTagsResolution,
        }),
        [
            addFilter,
            addNewUs,
            changeQ,
            changeUserStoryStatus,
            deleteUserStory,
            doomLineIndex,
            editUserStory,
            firstUserStoryIdInBacklog,
            getUserStoryModel,
            loadProjectStats,
            loadUserstories,
            params,
            permissions,
            refresh,
            removeCustomFilter,
            removeFilter,
            retainUserStoryModel,
            roles,
            saveCustomFilter,
            selectCustomFilter,
            showGraphPlaceholder,
            showTagsResolution,
            snapshot,
            toggleActiveFilters,
            toggleShowTags,
            toggleVelocityForecasting,
            usStatusList,
        ],
    );
}

