/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Typed facade over the `swimlanes` namespace of the aggregate AngularJS resources
 * service, for the React 18 rebuild of the Kanban board.
 *
 * ---------------------------------------------------------------------------------------
 * 1. WHAT THIS MODULE IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------------------
 * This migration is a strangler-fig, in-place coexistence migration: the AngularJS 1.5.10
 * shell survives untouched, `KanbanController` survives as a thin bridge, and only the
 * *rendering* layer of the Kanban and Backlog screens moves to React 18. React therefore
 * reaches HTTP, realtime, translation and permissions through the existing AngularJS
 * injector rather than reimplementing them.
 *
 * AAP §0.5.1 describes this folder in five words -- "Thin typed wrappers over
 * `$tgResources` endpoints" -- and AAP §0.6.2 repeats the constraint with the part that
 * matters most spelled out: "Typed wrappers over the named `$tgResources` endpoints; **no
 * new transport**."
 *
 * So this module is a *type layer*, not a data layer. It opens no connection, holds no
 * state, owns no cache, and adds no behaviour. It takes the AngularJS sub-resource service
 * as its FIRST ARGUMENT, calls the one method the Kanban board needs, marshals the
 * AngularJS promise into a native one, and hands the result back untouched. Everything
 * else -- URL registry lookup, header injection, the interceptor chain, response parsing,
 * model construction -- already happens on the AngularJS side of the seam and is inherited
 * rather than re-derived (section 4).
 *
 * @example
 * // Inside a screen hook, which owns the single service lookup (section 6):
 * //   const rs = useAngularService('$tgResources');
 * //   const models = await listSwimlanes(rs.swimlanes, projectId);
 * //   const swimlanes = models.map((model) => model.getAttrs());
 *
 * ---------------------------------------------------------------------------------------
 * 2. THE FROZEN SOURCE CONTRACT, MEASURED RATHER THAN ASSUMED
 * ---------------------------------------------------------------------------------------
 * `app/coffee/modules/resources/swimlanes.coffee:16-18` is the whole of the incumbent
 * read path, and it is three lines long:
 *
 *     service.list = (projectId) ->
 *         params = {project: projectId}
 *         return $repo.queryMany("swimlanes", params)
 *
 * Three properties of those three lines are load-bearing, and each one is documented at
 * the point of use below because rule T9 requires the seam to be commented where it is
 * crossed:
 *
 *   a. **The query key is `project`, SINGULAR** (`:17`) -- not `projects`, and not
 *      `project_id`. That key is built on the AngularJS side, so this facade forwards the
 *      identifier and never composes the parameter bag itself. Goal G2 freezes the backend
 *      contract: no endpoint, request shape, query parameter, body key or response
 *      contract may change.
 *
 *   b. **The listing is UNPAGINATED.** `queryMany` at
 *      `app/coffee/modules/base/repository.coffee:135-148` takes `options` and `headers`
 *      arguments that `list` does not pass, so `options.enablePagination` is falsy and
 *      lines 139-140 set the pagination-disabling request header, whose literal wire form
 *      is `x-disable-pagination: "1"`. Every swimlane of the project comes back in one
 *      response. A page size must not be introduced here (T10).
 *
 *   c. **The value is a BARE ARRAY of live model INSTANCES.** Line 143 maps the parsed
 *      body through the model factory, and because `headers` defaults to false the branch
 *      at 145-146 is skipped and line 148 returns `result` alone. It is NOT the
 *      `[models, headersGetter]` pair -- contrast
 *      `app/coffee/modules/resources/userstories.coffee:45-55`, whose `listUnassigned`
 *      passes `{enablePagination: true}` AND a trailing `true`, and therefore does return
 *      that pair. Conflating the two shapes is an easy and silent mistake, so the return
 *      type below states which one this is.
 *
 * The endpoint itself is registered once, in the frozen URL registry at
 * `app/coffee/modules/resources.coffee:142-144` (`"swimlanes": "/swimlanes"`, alongside
 * `"swimlane-userstory-statuses"`). That citation exists so a reader can find the route;
 * it is NOT a template for building one. This module never composes a URL, never touches
 * the URL-registry service, and never performs registry lookup -- the repository layer
 * does all three, at `repository.coffee:136`.
 *
 * ---------------------------------------------------------------------------------------
 * 3. WHY `list` IS THE ENTIRE SURFACE -- THE FIVE MUTATORS ARE DELIBERATELY NOT FACADED
 * ---------------------------------------------------------------------------------------
 * The AngularJS namespace exposes six methods. One is a read; five are mutators, and not
 * one of the five is reachable from either screen this migration rebuilds:
 *
 *   | method            | source                  | reached from                        |
 *   | ----------------- | ----------------------- | ----------------------------------- |
 *   | `create`          | `swimlanes.coffee:20-29` | `admin/project-values.coffee:146`   |
 *   | `edit`            | `swimlanes.coffee:31-37` | `admin/project-values.coffee:158`   |
 *   | `bulkUpdateOrder` | `swimlanes.coffee:39-46` | `admin/project-values.coffee:187`   |
 *   | `wipLimitUpdate`  | `swimlanes.coffee:48-54` | `wip-limit-selector.controller.coffee:22`, a component consumed only by `partials/includes/modules/admin/project-kanban-swimlanes.jade:63` and `:91` |
 *   | `delete`          | `swimlanes.coffee:56-62` | `admin/project-values.coffee:205`   |
 *
 * Those call sites -- found by grepping the whole application, not inferred -- put all
 * five behind the ADMIN project-values screen, which AAP §0.2.2 places out of scope:
 * "Every `taiga-front` screen other than Kanban and Backlog: epics, issues, wiki, admin,
 * auth, user profile, search, team, discover, project home, taskboard." The admin screen
 * stays on AngularJS and keeps calling the namespace directly, exactly as it does today.
 *
 * Facading them here would therefore add public surface with no consumer, which the
 * Minimal Change Clause forbids in as many words: "Do not enhance or optimize beyond the
 * stated requirements." When an admin migration needs them, they are added then, beside
 * specs that exercise them.
 *
 * One cross-folder note, recorded because in isolation it reads like a contradiction: the
 * shared-types modules state that the request shapes of those five methods "belong to
 * `app/react/shared/api/`". That is a BOUNDARY MARKER -- it means "not in the types
 * folder" -- and not a mandate that the facades exist. This folder's own requirement is
 * explicit that only the read is in scope.
 *
 * ---------------------------------------------------------------------------------------
 * 4. WHAT ROUTING THROUGH THE EXISTING RESOURCE LAYER INHERITS FOR FREE
 * ---------------------------------------------------------------------------------------
 * Rule T5, verbatim: "Reuse `$tgResources`; do not build a parallel HTTP client. New
 * TypeScript files are typed facades over the existing repository layer." Requirement I7
 * says the same from the other direction. No transport of whatever kind appears anywhere
 * in this module, and the reason is behavioural rather than stylistic -- a hand-rolled
 * client would silently drop all of this:
 *
 *   • **Headers.** `app/coffee/modules/base/http.coffee:17-30` builds
 *     `Authorization: Bearer <token>` (token read at :21, header set at :23) and
 *     `Accept-Language` from the preferred language (:26, :28), then merges them into
 *     every request at :33 in an order that lets the service's own headers win over
 *     per-call ones. `app/coffee/app.coffee:590-594` adds `X-Session-Id` for the whole
 *     application, applied to the writing verbs at :596-599, with a GET receiving
 *     `X-Session-Id` alone at :600-602.
 *   • **Single-flight 401 refresh.** `app/coffee/app.coffee:609-613` holds one shared
 *     in-progress/promise pair, so concurrent requests do not each trigger their own token
 *     refresh.
 *   • **VERSION_ERROR on a 400 carrying a `version` field**, raised as a toast for
 *     10,000 ms (`app/coffee/app.coffee:740-750`). This is how an optimistic-concurrency
 *     conflict becomes visible to the user.
 *   • **451 blocked-project handling** (`app/coffee/app.coffee:764`, `:775`) and the
 *     **status-0 / status-minus-1 connection-error path** (`:619`), which closes open
 *     lightboxes and shows the full-page connection view.
 *   • **GET de-duplication.** The AngularJS HTTP wrapper hands its GETs a shared cache and
 *     empties that cache once the request settles, so concurrent identical reads collapse
 *     into one round trip. This facade must neither reimplement that nor defeat it, which
 *     is one more reason it holds no cache of its own.
 *
 * The same argument protects writes, even though this module performs none. A model
 * instance dirty-tracks its fields, so `getAttrs(true)`
 * (`app/coffee/modules/base/model.coffee:48-54`) yields only the fields the user actually
 * changed plus the optimistic-concurrency `version`, and the repository's save short-
 * circuits an unmodified model without issuing a request at all
 * (`repository.coffee:57-59`). A client that posted whole objects would turn every field
 * change into a potential silent lost update. Preserving the model instances this facade
 * returns -- rather than flattening them here -- is what keeps that guarantee intact
 * (section 5).
 *
 * ---------------------------------------------------------------------------------------
 * 5. THE MODEL-INSTANCE BOUNDARY -- P-IMMER-1, AND WHY FLATTENING IS THE CALLER'S STEP
 * ---------------------------------------------------------------------------------------
 * Pitfall P-IMMER-1, verbatim: "immer dislikes class instances. `$tgModel` returns model
 * classes carrying dirty-tracking state; passing one into a draft produces undefined
 * behaviour. Convert to plain objects at the boundary."
 *
 * What comes back from this facade is therefore NOT the plain `Swimlane` domain type. It
 * is a live `Model` instance (`app/coffee/modules/base/model.coffee:9`) whose attribute
 * fields are `Object.defineProperty` accessors installed over `_attrs` and
 * `_modifiedAttrs` in the loop at `:94-101`. That instance also carries the bookkeeping
 * those accessors read -- `_attrs`, `_modifiedAttrs`, `_isModified`, `_name` and
 * `_dataTypes` (`:11-13`, `:56-61`) -- and AngularJS keeps mutating that graph through
 * `setAttr` (`:63-65`).
 *
 * Two consequences follow, and both are why a shallow object spread is NOT an acceptable
 * flattening:
 *
 *   a. A spread copies the bookkeeping fields across as well, producing a hybrid that
 *      looks like plain data while carrying half a model's private state.
 *   b. Nested values -- the status-column array most of all -- stay shared by reference
 *      with the structure AngularJS still owns.
 *
 * The single sanctioned flattening is `getAttrs()` (`:48-54`), which merges `_attrs` with
 * `_modifiedAttrs` into a fresh plain object. The house style is to flatten at the seam,
 * established by the `params` bag of the one production custom-element hand-off:
 * `app/modules/components/project-menu/project-menu.controller.coffee:27` flattens the
 * project structure with `toJS()`, with a second flattening precedent at `:21`. (The AAP
 * quotes that line as "L28"; the locator is off by one -- `:28` is the closing brace `},`
 * of the `params` object. Recorded so the next reader does not chase the wrong line, and
 * `shared/types/swimlane.ts` records the same correction.)
 *
 * **Flattening deliberately does NOT happen inside this facade.** Doing it here would be
 * an unrequested transformation (T10), it would strip the dirty-tracking that makes a
 * changed-fields-only write possible (section 4), and -- worst -- it would hide the hazard
 * instead of documenting it. The return type names the model shape explicitly so the
 * obligation lands on the caller, where a spec can cover it; the shared `Swimlane` type is
 * imported precisely to describe what `getAttrs()` yields once the caller does flatten.
 *
 * ---------------------------------------------------------------------------------------
 * 6. WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------------------
 * Rule T10 forbids functional and feature change without exception -- the linked design
 * frames licence layout fidelity only. Each absence below is therefore a decision with a
 * reason, not an oversight:
 *
 *   • **No second function.** One read is faceted; see section 3.
 *   • **No barrel file.** This folder holds no `index.ts`, so nothing can grow a
 *     re-export surface that outlives its consumers (T8).
 *   • **No React hook, and no service lookup.** The service arrives as the first
 *     parameter. Requirement I9 explains why: "The >=70% coverage gate forces a
 *     presentational/container split. Jest runs browserless in jsdom with no `dist/`
 *     dependency, so data-fetching and drag effects must be isolated in hooks and
 *     containers, leaving pure components independently testable." A facade that looked up
 *     its own service would need the bridge context mounted in every spec; taking the
 *     service as an argument makes it a plain function with a plain double.
 *   • **No retries, timeouts, cancellation or logging.** The incumbent has none of them,
 *     and a retry in particular would multiply requests behind the user's back.
 *   • **No cache and no de-duplication.** Both already exist one layer down (section 4);
 *     a second one here could only diverge from the first.
 *   • **No pagination.** The incumbent read is unpaginated by construction (section 2b).
 *   • **No sorting, no filtering, no re-keying, no normalisation beyond typing.** The
 *     board's own grouping is derived downstream, in the Kanban state layer, and the
 *     archived-status filter belongs to the components that render columns. Reordering or
 *     filtering here would change what the board shows.
 *   • **No synthesis of the unclassified swimlane.** The `-1` identifier is a CLIENT-SIDE
 *     SENTINEL that the server never sends: the board inserts a synthetic swimlane with
 *     `id: -1` at `app/coffee/modules/kanban/kanban-usertories.coffee:295-300` and maps it
 *     back to the stories whose own `swimlane` attribute is null at `:312-313`, while
 *     `kanban/main.coffee` gives that band its columns by assigning the project's statuses
 *     to the `-1` slot of the per-swimlane map. This facade never observes `-1` and must
 *     never "handle" it -- the sentinel is a view-layer construct, and code that branches
 *     on it belongs under `app/react/kanban/` where its spec can live.
 *   • **No runtime argument guard.** The incumbent validates nothing, so a throw here
 *     would be new behaviour on a path the type system already closes: `strict` mode plus
 *     the typed signature make a wrong argument a compile error, and the only caller reads
 *     the identifier straight off the loaded project. This is a decision, recorded so it is
 *     not mistaken for a gap.
 *   • **No digest interaction.** Digest cycles remain AngularJS's concern; React state is
 *     driven by React. The marshaller documents why honouring that is safe rather than a
 *     leap of faith.
 *   • **No permission logic.** React reads the same `my_permissions` array the existing
 *     permission directives read and computes no independent notion of what a user may do,
 *     so no gate is exposed here.
 *   • **No token access.** The session token stays in browser storage behind the AngularJS
 *     storage service, and the header is built one layer down (section 4).
 *
 * ---------------------------------------------------------------------------------------
 * 7. CONVENTIONS AND VERIFICATION NOTES
 * ---------------------------------------------------------------------------------------
 * **No user-specified rules exist for this project.** The project rules document was
 * queried and reports that none were provided, so nothing is invented in their place and
 * the bar is held to enterprise-standard practice instead: every claim above cites the
 * `path:locator` it was measured at, the retirement of surface is justified by a
 * whole-application consumer search (section 3), and the failure modes that break silently
 * are named rather than left to be discovered.
 *
 * **Sigil omission.** AngularJS service identifiers are written without their leading
 * sigil wherever the sigilled spelling would collide with a banned token -- this tree is
 * scanned for the transport, URL-composition and digest-trigger spellings to catch real
 * calls, and a comment naming one literally would trip a gate that exists for a good
 * reason. The same convention is used by the bridge modules this file imports from.
 *
 * **Browserless by construction.** The co-located spec runs under jsdom with no browser
 * binary, no server, no generated build output and no end-to-end runner import (HR-5). It
 * can, because this module's whole dependency surface is two type-only imports and one
 * ten-line marshaller.
 */

// The AngularJS-to-native promise marshaller. A VALUE import, because it is called at run
// time -- the one and only run-time dependency of this module.
import { toNativePromise } from '../../bridge/toNativePromise';

// `import type` on every remaining specifier, for three reasons that all apply: the root
// TypeScript configuration sets `isolatedModules`, under which a type-only import must be
// marked as such so each file can be transpiled on its own; marking it guarantees the
// statement is erased and contributes no run-time require to the bundle the build task
// emits; and it documents that this module consumes shapes rather than behaviour.
//
// The specifiers are relative because that same configuration declares neither a base URL
// nor path aliases, so no alias exists to import through.
//
// `AngularServices` and `TaigaModel` come from the bridge module that OWNS them. Neither is
// redeclared here: the bridge states its interfaces are "exported so `../shared/api/**` can
// build its typed facades on these shapes -- and so a facade never has to redeclare one and
// let the two definitions drift apart", and indexing the owned map is what guarantees this
// facade tracks it automatically.
import type { AngularServices, TaigaModel } from '../../bridge/useAngularService';
import type { Status } from '../types/status';
import type { Swimlane } from '../types/swimlane';

/**
 * The `swimlanes` sub-resource service, derived by indexing the bridge's service map rather
 * than restated.
 *
 * Indexing is deliberate. The map is the single contract of the whole bridge, so deriving
 * the parameter type from it means a change to the AngularJS namespace surfaces here as a
 * compile error instead of as a run-time surprise, and it makes the mutator exclusion
 * self-enforcing: the bridge declares exactly one member on this namespace, so a call to
 * one of the five admin mutators (section 3) would not type-check even if somebody tried.
 */
type SwimlanesService = AngularServices['$tgResources']['swimlanes'];

/**
 * The plain, structural-sharing-safe attribute shape one returned model flattens to -- what
 * the CALLER holds after `getAttrs()`, never what this facade returns (section 5).
 *
 * This is the shared `Swimlane` domain model, with its optional status-column member
 * restated in the intersection so that `Status` is part of THIS seam's checked surface
 * rather than only a transitive detail. The intersection is a semantic no-op today, and
 * that is the point: both shared-type modules record the finding that a swimlane's statuses
 * are `Status` verbatim, with no per-swimlane variant -- the same `is_archived` predicate is
 * applied to a project's statuses and to a swimlane's statuses at
 * `app/coffee/modules/admin/project-values.coffee:191-198`, and
 * `kanban/main.coffee` stores both in the same per-swimlane map slot. Spelling the member
 * here turns a future incompatible variant into a compile error at this facade instead of a
 * silent widening downstream.
 *
 * `statuses` stays OPTIONAL because the synthetic unclassified swimlane really does omit it
 * (`kanban-usertories.coffee:295-300`), and `readonly` throughout because board state lives
 * in a structurally shared tree whose auto-freeze stays enabled (P-IMMER-4): an accidental
 * write outside a producer should be a compile error, not a frozen-object surprise at run
 * time.
 */
type SwimlaneAttrs = Swimlane & {
    readonly statuses?: readonly Status[];
};

/**
 * Lists every swimlane of one project.
 *
 * The single read this folder faces for the Kanban board, and the whole of its public
 * surface (section 3). Its one incumbent consumer is `loadSwimlanes` in
 * `app/coffee/modules/kanban/main.coffee` -- `:552-562` on the pre-migration source, where
 * the call sits at `:553` -- which stores the result on the scope, then reads `swimlane.id`
 * and `swimlane.statuses` off each element to build the per-swimlane column map. That method
 * survives verbatim in the retained controller; only its line numbers moved when the
 * controller was reworked into a bridge, which is why the pre-migration locator is the one
 * quoted here. The
 * Backlog screen never touches this namespace; its `project.swimlanes` read at
 * `backlog/main.coffee:346` is a PROJECT field with the same name.
 *
 * BEHAVIOURAL CONTRACT -- deliberately the smallest one that is correct:
 *
 * - **Delegation only.** Exactly one call, to the AngularJS service handed in, with the
 *   project identifier forwarded unchanged. The `{project: projectId}` parameter bag is
 *   built on the AngularJS side at `resources/swimlanes.coffee:17`, where the key is
 *   `project` -- SINGULAR -- and it is not rebuilt here, so goal G2's frozen request shape
 *   cannot drift.
 * - **Unpaginated.** `queryMany` receives no pagination option from `list`, so
 *   `repository.coffee:139-140` sets the pagination-disabling header -- on the wire,
 *   `x-disable-pagination: "1"` -- and the response carries every swimlane of the project.
 *   No page size is accepted or added (T10).
 * - **A bare array, not a pair.** `repository.coffee:148` returns the models alone; the
 *   `[models, headersGetter]` form at `:145-146` requires the opt-in that `list` does not
 *   pass. Contrast `userstories.coffee:45-55`, which does opt in.
 * - **Live model instances, unflattened.** Each element is a dirty-tracking model whose
 *   fields are accessors over its private attribute bag
 *   (`base/model.coffee:94-101`). THE CALLER MUST FLATTEN WITH `getAttrs()` BEFORE THE
 *   VALUE ENTERS A STRUCTURAL-SHARING DRAFT OR REACT STATE (P-IMMER-1, section 5); the
 *   flattened element is {@link SwimlaneAttrs}. Flattening here would strip the
 *   dirty-tracking that keeps writes to changed fields only.
 * - **Rejections pass through untouched**, because the AngularJS interceptor chain
 *   communicates through rejection values: a 400 carrying `version` (VERSION_ERROR), a 451
 *   blocked project and connection loss all arrive that way (section 4). Nothing here
 *   catches, wraps, logs or swallows one.
 * - **No retries, timeouts, cancellation, caching, sorting, filtering or re-keying**, and
 *   no synthesis of the client-side `-1` sentinel. See section 6 for each absence and its
 *   reason.
 *
 * `async` is deliberate rather than incidental: it makes the declared native `Promise` the
 * authoritative return type and guarantees this function never throws synchronously, which
 * is what callers of a promise-returning API expect. It changes nothing observable on every
 * reachable path -- the delegated call composes a two-key object and hands off to the
 * repository layer -- so the guarantee is free.
 *
 * @typeParam TAttrs - the plain attribute shape the returned models wrap, constrained to
 *   {@link SwimlaneAttrs} and defaulting to it. Present because the bridge's own signature
 *   is generic and because a caller may legitimately name a wider server payload; the
 *   constraint is what stops that widening from dropping `id`, `name`, or the shared
 *   `Status` element type.
 * @param swimlanes - the `swimlanes` sub-resource service, normally reached once per screen
 *   as `useAngularService('$tgResources').swimlanes` in the screen's hook and passed down
 *   from there (requirement I9, section 6). Taking it as a parameter is what keeps this
 *   module a plain function with no React dependency and no bridge context to mount in a
 *   spec.
 * @param projectId - the project whose swimlanes are wanted, forwarded verbatim as the
 *   value of the SINGULAR `project` query key.
 * @returns a native `Promise` for a readonly array of live model instances, in the order the
 *   endpoint sent them. Empty when the project has no swimlanes -- never null, because
 *   `repository.coffee:143` maps over the parsed body and yields an empty array for an empty
 *   collection.
 */
export async function listSwimlanes<TAttrs extends SwimlaneAttrs = SwimlaneAttrs>(
    swimlanes: SwimlanesService,
    projectId: number,
): Promise<ReadonlyArray<TaigaModel<TAttrs>>> {
    // THE ANGULARJS-TO-REACT SEAM (rule T9). `list` hands back an AngularJS promise, whose
    // settlement is coupled to the framework's digest loop rather than to the microtask
    // queue. Marshalling it here -- through the bridge's single marshaller, which forwards
    // both settlement branches untouched -- is what lets every React consumer above this
    // line treat the result as an ordinary awaited value, with no digest ever triggered
    // from React and no promise implementation leaking upward.
    //
    // One call, one hand-off, nothing in between: no request is issued from this module,
    // and the response is neither inspected nor copied.
    return toNativePromise(swimlanes.list<TAttrs>(projectId));
}

