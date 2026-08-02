/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * kanbanStorage -- the typed facade over the `kanban` namespace of
 * `$tgResources`, which holds the Kanban board's per-project fold state: which
 * status columns are collapsed, and which swimlanes are collapsed.
 *
 * Planned by the migration specification at section 0.5.1, which lists
 * `shared/api/` as "Thin typed wrappers over `$tgResources` endpoints", and at
 * section 0.6.2, which records this folder's source of record as
 * `app/coffee/modules/resources.coffee` and its obligation as "Typed wrappers
 * over the named `$tgResources` endpoints; no new transport".
 *
 * Rule T9 ("Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam") governs this file, and it sits
 * exactly on that seam: React code above it, an AngularJS 1.5.10 service below
 * it, and a frozen storage layout underneath that. Every statement below was
 * measured in the sources it cites.
 *
 * ===========================================================================
 * 1. READ THIS FIRST: THIS FILE PERFORMS NO NETWORK INPUT OR OUTPUT AT ALL
 * ===========================================================================
 * A file sitting under `shared/api/` invites the assumption that it talks to a
 * server. This one does not, and it is the only member of this folder that does
 * not.
 *
 * The aggregate service installs twenty-five namespaces onto one instance
 * (`app/coffee/modules/resources.coffee:264-288`, driven by the installer loop
 * at `:249-254` onto the class declared at `:11` and registered at `:257`).
 * Twenty-four of them are backed by the repository and HTTP layers. The Kanban
 * installer at `:283` is the exception: its provider declares exactly one
 * dependency, the storage service
 * (`app/coffee/modules/resources/kanban.coffee:44`, whose factory argument list
 * is a single entry), and its body takes that one collaborator
 * (`:13`). It never reaches for the repository, the transport wrapper `$tgHttp`
 * or the URL registry.
 *
 * There is therefore no endpoint, no URL, no header, no request and no response
 * in this file's concern. It reads and writes browser local storage through the
 * injected namespace, and nothing else. Requirement G2 freezes the REST
 * contract and the realtime routing keys; this file cannot regress either,
 * because it touches neither -- and it must not acquire one.
 *
 * The governing rule is T5: "Reuse `$tgResources`; do not build a parallel HTTP
 * client. New TypeScript files are typed facades over the existing repository
 * layer." The same principle covers storage under requirement I7: the storage
 * service is not reimplemented here, it is delegated to.
 *
 * ---------------------------------------------------------------------------
 * 2. THE FOUR MEMBERS BEING FACADED
 * ---------------------------------------------------------------------------
 * `app/coffee/modules/resources/kanban.coffee` publishes exactly four members
 * on the namespace, in two symmetrical pairs:
 *
 *   `:19-22`  storeStatusColumnModes(projectId, params)  -> writes
 *   `:24-27`  getStatusColumnModes(projectId)            -> reads
 *   `:29-32`  storeSwimlanesModes(projectId, params)     -> writes
 *   `:34-37`  getSwimlanesModes(projectId)               -> reads
 *
 * The provider returns an installer that attaches that object to the aggregate
 * service as `.kanban` (`:39-40`). Four members in, four exported functions
 * out, one to one, with no member added and none omitted -- except as section 6
 * records.
 *
 * ---------------------------------------------------------------------------
 * 3. ALL FOUR FACADES ARE SYNCHRONOUS -- A DELIBERATE, SOURCE-PROVEN DEVIATION
 * ---------------------------------------------------------------------------
 * The convention for this folder is that a facade hands its caller a native
 * promise, because the namespaces it wraps return AngularJS deferred values.
 * THIS FILE BREAKS THAT CONVENTION ON PURPOSE, and the deviation is recorded
 * here because following the convention would be a behavioural regression.
 *
 * The storage service underneath is synchronous end to end
 * (`app/coffee/modules/base/storage.coffee:17-32`): the reader at `:17-25`
 * takes the stored string, returns a default when it is absent (`:19-20`) or
 * `null` when it cannot be parsed (`:24-25`), and otherwise returns the parsed
 * value (`:23`); the writer at `:27-32` serialises and stores in place.
 * Nothing in that chain produces a deferred value, a callback or a promise.
 *
 * The incumbent screen consumes both readers WITHOUT `.then()`, at three
 * measured call sites in `app/coffee/modules/kanban/main.coffee`:
 *
 *   `:584`  @.foldedSwimlane = Immutable.fromJS(@rs.kanban.getSwimlanesModes(project.id))
 *   `:780`  $scope.folds = rs.kanban.getStatusColumnModes(projectService.project.get('id'))
 *   `:797`  $scope.folds = rs.kanban.getStatusColumnModes(projectService.project.get('id'))
 *
 * Marking these facades `async` would therefore change behaviour rather than
 * style. At `:584` the pending promise object itself would be handed to
 * `Immutable.fromJS`, which would wrap the promise instead of the fold map. At
 * `:780` and `:797` a promise would land in `$scope.folds`, which is then
 * indexed by status id (`:783`, `:803`). Neither mistake throws: a promise is
 * always truthy, and indexing it by an unrelated key yields `undefined`. Every
 * column would simply render unfolded and every fold the user had saved would
 * look lost. That silence is precisely why the deviation is documented instead
 * of assumed -- rule T10 forbids it, and it would not announce itself.
 *
 * Two consequences follow. This file imports no promise-marshalling helper,
 * because there is no AngularJS deferred value to convert. And it never drives
 * the AngularJS digest cycle, which remains AngularJS's own concern.
 *
 * ---------------------------------------------------------------------------
 * 4. THE STORAGE KEY IS COMPOSED INSIDE THE ANGULARJS SERVICE, NEVER HERE
 * ---------------------------------------------------------------------------
 * Each of the four members composes its own key in two steps
 * (`resources/kanban.coffee:20-21`, `:25-26`, `:30-31`, `:35-36`):
 *
 *   1. a namespace string `"{projectId}:{suffix}"`, from the project id and the
 *      per-concern suffix constant declared at `:16` or `:17`;
 *   2. the final key, derived from the two-element pair `[projectId, ns]` by the
 *      ambient hash helper that the `taiga` namespace publishes, aliased into
 *      the module at `:11`.
 *
 * Note that the project id appears TWICE in that derivation -- once on its own,
 * and once already embedded in the namespace string. That is the incumbent
 * behaviour; it is the layout under which every key in browser local storage
 * was written; and it is therefore load-bearing. A tidier single-argument
 * derivation would produce different keys and silently orphan every fold state
 * every user has ever saved.
 *
 * The facades below forward the project id unchanged and NEVER derive a key.
 * Re-deriving one here would be a second implementation of a rule that already
 * has one -- the parallel machinery rule T5 exists to prevent -- and it would
 * drift the moment either a suffix constant or the helper changed.
 *
 * The helper's identifier is deliberately not spelled out anywhere in this
 * file. That way a plain text search for it across `app/react/**` returns
 * nothing, and the absence of key derivation in the React tree is mechanically
 * provable rather than merely asserted.
 *
 * ---------------------------------------------------------------------------
 * 5. THE PAYLOAD: STRING KEYS, BOOLEAN VALUES, AND NEVER NULL
 * ---------------------------------------------------------------------------
 * Both readers end in `or {}` (`resources/kanban.coffee:27`, `:37`), so a
 * project with nothing stored -- and equally a project whose stored value failed
 * to parse, which the storage reader turns into `null` at
 * `base/storage.coffee:25` -- reads back an empty object. The return types below
 * consequently carry no nullable union: callers index them directly and never
 * guard for absence. Widening them to include `null` would push a needless check
 * onto every call site and misdescribe the source.
 *
 * The keys are STRINGS, even though the status and swimlane identifiers they
 * come from are numbers. Two independent proofs:
 *
 *   - the swimlane writer builds its map with `id.toString()`
 *     (`kanban/main.coffee:329-330`) and the board template reads it back the
 *     same way -- `ctrl.foldedSwimlane.get(swimlane.id.toString())` at
 *     `app/partials/includes/modules/kanban-table.jade:82`, `:86`, `:90` and
 *     `:108`;
 *   - the status writer indexes with the numeric id
 *     (`kanban/main.coffee:783`, `:803`), which the language coerces to a string
 *     property name before the map is ever serialised.
 *
 * So the shape is keyed by `string`, never by `number`. A numeric key type would
 * compile and then quietly fail to match at run time for every caller that
 * already holds the stringified form.
 *
 * The values are booleans. The status writer flips its entry with a triple
 * negation (`kanban/main.coffee:783`) and forces archived statuses to `true`
 * (`:803`); the swimlane writer stores the negation of the previous entry
 * (`:329`).
 *
 * The shared declaration is deliberately wider than that. `KanbanResource`
 * (`app/react/bridge/useAngularService.ts:644-656`) types the payload as
 * `ResourceParams`, an open record of `unknown` values (`:441`), because that
 * single alias serves all twenty-five namespaces the aggregate service installs.
 * Each reader below narrows that open record to the measured shape with one
 * assertion, which the compiler accepts because the narrow type is assignable to
 * the wide one -- so no suppression comment and no unsafe escape type is needed
 * or used.
 *
 * That narrowing is a COMPILE-TIME statement of what the writers store, not a
 * run-time check. Nothing here validates, coerces or repairs the stored value:
 * the incumbent passes whatever was parsed straight through to its consumers,
 * and rule T10 requires this facade to do the same.
 *
 * ---------------------------------------------------------------------------
 * 6. EXACTLY FOUR MEMBERS -- AND ONE DELIBERATE OMISSION
 * ---------------------------------------------------------------------------
 * The namespace declares THREE suffix constants (`resources/kanban.coffee:15`,
 * `:16`, `:17`) but only two of them are ever used. `hashSuffixStatusViewModes`
 * at `:15` is referenced by no member of the service -- it is dead code left
 * behind by an earlier iteration, and its string value is deliberately not
 * reproduced here.
 *
 * No facade is provided for it, because there is nothing to facade: the service
 * exposes neither a reader nor a writer for that suffix. Adding a pair would
 * invent behaviour the application has never had, which rule T10 -- "The Figma
 * frames license layout fidelity only" -- forbids outright. Four members exist,
 * four are wrapped.
 *
 * ---------------------------------------------------------------------------
 * 7. WHY THE SERVICE ARRIVES AS THE FIRST PARAMETER
 * ---------------------------------------------------------------------------
 * These are plain functions, not hooks. The namespace is passed in as the first
 * argument rather than resolved inside:
 *
 *     const rs = useAngularService('$tgResources');       // once, in the hook
 *     const folds = getStatusColumnModes(rs.kanban, projectId);
 *
 * The screen's own data hook owns that single service lookup and hands
 * `rs.kanban` down. Two structural reasons:
 *
 *   - a hook may only be called from a component or another hook, which would
 *     put this module under the rules of hooks and make it unusable from a
 *     reducer, a selector or a plain event handler -- all three of which need
 *     the fold state;
 *   - requirement I9, "The >=70% coverage gate forces a presentational/container
 *     split. Jest runs browserless in jsdom with no `dist/` dependency, so
 *     data-fetching and drag effects must be isolated in hooks and containers,
 *     leaving pure components independently testable." A function whose entire
 *     dependency surface is one argument is the most testable form there is: the
 *     co-located spec stands up a four-method object literal and needs no
 *     injector, no provider and no React tree.
 *
 * ---------------------------------------------------------------------------
 * 8. WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * Rule T10 and the Minimal Change Clause rule out everything in this list. Each
 * entry is a plausible-looking improvement that would change behaviour:
 *
 *   - no retry, timeout, debounce or batching;
 *   - no caching or memoisation -- every call reads through to the service, as
 *     the incumbent does;
 *   - no default or seeded fold state, and no notion of "all unfolded";
 *   - no migration or clean-up of keys written by earlier versions;
 *   - no validation, coercion or repair of the stored payload;
 *   - no fifth member (section 6);
 *   - no direct use of the browser storage interface. Everything goes through
 *     the injected namespace, so the storage layer that also holds the session
 *     token stays single-sourced; this file neither reads that token, nor
 *     enumerates the store, nor clears it.
 */

import type { AngularServices } from '../../bridge/useAngularService';

/**
 * The `kanban` namespace of `$tgResources`, obtained by indexing the service map
 * the bridge publishes rather than by redeclaring its shape here.
 *
 * Indexing keeps this file structurally tied to
 * `app/react/bridge/useAngularService.ts:644-656`: if a member's signature
 * changes there, the facades below stop compiling instead of drifting apart from
 * it. Redeclaring the four signatures locally would have created exactly the
 * kind of duplicate definition that the bridge's own type-exports section
 * (`:1390-1396`) exists to prevent.
 *
 * Local and unexported by design. The bridge already publishes the interface for
 * callers that need to name it, so re-publishing it from here would create a
 * second import path to one type.
 */
type KanbanStorageService = AngularServices['$tgResources']['kanban'];

/* ===========================================================================
 * STATUS COLUMN FOLD STATE
 *
 * Which status columns of the board are collapsed. Written whenever the user
 * folds or unfolds a column, and read once when the board finishes its initial
 * load so the previous session's layout is restored.
 * ======================================================================== */

/**
 * Reads the per-status column fold state for one project.
 *
 * Facade over the namespace member at
 * `app/coffee/modules/resources/kanban.coffee:24-27`. SYNCHRONOUS: the value is
 * available on return, exactly as at the incumbent call sites
 * `app/coffee/modules/kanban/main.coffee:780` and `:797`, neither of which uses
 * `.then()`. Section 3 of the file header explains why that must not change.
 *
 * @param kanban - the `kanban` namespace of `$tgResources`, supplied by the
 *   caller (`rs.kanban`). Taking it as a parameter rather than resolving it
 *   internally is what keeps this function callable outside a React render and
 *   testable without an injector; see header section 7.
 * @param projectId - the project whose fold state is being read. Forwarded
 *   unchanged: the storage key is composed inside the AngularJS service, and
 *   header section 4 explains why it must stay there.
 * @returns a map of stringified status id to folded flag. An empty object when
 *   the project has nothing stored, or when what was stored could not be parsed.
 *   Never `null`, never `undefined`, so the result can be indexed directly.
 *
 * @example
 * const folds = getStatusColumnModes(rs.kanban, project.id);
 * const isFolded = folds[String(status.id)] === true;
 */
export function getStatusColumnModes(
    kanban: KanbanStorageService,
    projectId: number,
): Readonly<Record<string, boolean>> {
    // The service already substitutes `{}` for a missing or unparseable value
    // (`resources/kanban.coffee:27`), so there is deliberately no fallback here:
    // adding one would duplicate a decision the incumbent has already made and
    // would mask a future change to it.
    //
    // The assertion narrows the open record the shared alias declares
    // (`useAngularService.ts:441`) down to the shape the writers actually store
    // (header section 5). It is a compile-time statement only -- no branch, no
    // copy, no validation -- because rule T10 requires this facade to pass the
    // parsed value through untouched, exactly as the incumbent does.
    return kanban.getStatusColumnModes(projectId) as Readonly<
        Record<string, boolean>
    >;
}

/**
 * Persists the per-status column fold state for one project.
 *
 * Facade over the namespace member at
 * `app/coffee/modules/resources/kanban.coffee:19-22`. SYNCHRONOUS: the map is
 * serialised and stored before the call returns (`base/storage.coffee:27-32`),
 * so there is no completion signal to observe and no outcome to reconcile.
 *
 * @param kanban - the `kanban` namespace of `$tgResources`.
 * @param projectId - the project whose fold state is being written.
 * @param modes - the COMPLETE map to store, keyed by stringified status id. The
 *   incumbent writes the whole map on every single change
 *   (`kanban/main.coffee:788` stores the entire collection it has just mutated at
 *   `:783`), never a delta, and this facade preserves that: the stored value is
 *   replaced outright and never merged with what was there before. A merge would
 *   make it impossible to unfold the last folded column, because the entry would
 *   survive its own removal.
 *
 *   Declared read-only so a caller cannot mutate the object it has just handed
 *   over. That is worth enforcing here because the migrated board holds its state
 *   in an immer-produced structure whose untouched branches stay frozen: mutating
 *   one would throw at run time, and the modifier turns that into a compile error
 *   instead.
 *
 * @example
 * storeStatusColumnModes(rs.kanban, project.id, nextFolds);
 */
export function storeStatusColumnModes(
    kanban: KanbanStorageService,
    projectId: number,
    modes: Readonly<Record<string, boolean>>,
): void {
    // Straight delegation. Serialisation, key composition and the write itself
    // all belong to the AngularJS layer (header sections 1 and 4); this function
    // exists to give React callers a typed, injector-free entry point to it and
    // to hold the documentation above.
    kanban.storeStatusColumnModes(projectId, modes);
}

/* ===========================================================================
 * SWIMLANE FOLD STATE
 *
 * Which swimlanes of the board are collapsed. The same storage mechanism as the
 * columns above, under a different suffix constant
 * (`resources/kanban.coffee:17`), and a separate pair of members so the two
 * concerns cannot overwrite one another.
 * ======================================================================== */

/**
 * Reads the per-swimlane fold state for one project.
 *
 * Facade over the namespace member at
 * `app/coffee/modules/resources/kanban.coffee:34-37`. SYNCHRONOUS, and this is
 * the most consequential of the four: the incumbent feeds the returned value
 * straight into `Immutable.fromJS(...)` at `kanban/main.coffee:584` with no
 * `.then()`, so a promise here would be wrapped as though it were the fold map
 * and every swimlane would silently render expanded. Header section 3 has the
 * full analysis.
 *
 * @param kanban - the `kanban` namespace of `$tgResources`.
 * @param projectId - the project whose fold state is being read. At the
 *   incumbent site this is `project.id` (`kanban/main.coffee:584`).
 * @returns a map of stringified swimlane id to folded flag, empty when nothing
 *   is stored. The keys are stringified because the writer builds them with
 *   `id.toString()` (`kanban/main.coffee:329`) and the board template reads them
 *   back the same way (`kanban-table.jade:82`, `:86`, `:90`, `:108`).
 *
 * @example
 * const folded = getSwimlanesModes(rs.kanban, project.id);
 * const isCollapsed = folded[String(swimlane.id)] === true;
 */
export function getSwimlanesModes(
    kanban: KanbanStorageService,
    projectId: number,
): Readonly<Record<string, boolean>> {
    // Same contract as the column reader: the service defaults to `{}`
    // (`resources/kanban.coffee:37`), and the assertion only narrows the shared
    // open record to the measured shape. See header section 5.
    return kanban.getSwimlanesModes(projectId) as Readonly<
        Record<string, boolean>
    >;
}

/**
 * Persists the per-swimlane fold state for one project.
 *
 * Facade over the namespace member at
 * `app/coffee/modules/resources/kanban.coffee:29-32`. SYNCHRONOUS, as above.
 *
 * @param kanban - the `kanban` namespace of `$tgResources`.
 * @param projectId - the project whose fold state is being written. At the
 *   incumbent site this is `@scope.projectId` (`kanban/main.coffee:330`).
 * @param modes - the COMPLETE map to store, keyed by stringified swimlane id.
 *
 *   This parameter is a PLAIN OBJECT, and that is the point of the seam. The
 *   incumbent flattens its persistent structure before storing -- `:330` passes
 *   `@.foldedSwimlane.toJS()`, not the structure itself -- which is the same
 *   house convention the project menu follows when handing data to a custom
 *   element (`app/modules/components/project-menu/project-menu.controller.coffee:27`).
 *   Flattening at the boundary matters for the migrated screen too: pitfall
 *   P-IMMER-1 records that immer draft handling misbehaves on class instances, so
 *   plain objects are the only shape that may cross here. The storage writer
 *   would in fact serialise whatever it is given, which is exactly why the
 *   obligation is stated rather than left implicit -- a structure with private
 *   bookkeeping would round-trip into unusable stored data with no error at all.
 *
 * @example
 * storeSwimlanesModes(rs.kanban, project.id, nextFolded);
 */
export function storeSwimlanesModes(
    kanban: KanbanStorageService,
    projectId: number,
    modes: Readonly<Record<string, boolean>>,
): void {
    // Straight delegation, as with the column writer.
    kanban.storeSwimlanesModes(projectId, modes);
}
