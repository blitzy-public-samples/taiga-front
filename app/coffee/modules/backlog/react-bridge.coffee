###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

taiga = @.taiga
bindOnce = taiga.bindOnce

module = angular.module("taigaBacklog")

#############################################################################
## React bridge directive  (AngularJS -> React coexistence seam)
##
## 1. WHAT THIS FILE IS
## The AngularJS -> React coexistence bridge for the Backlog / Sprint-Planning
## screen. This is a strangler-fig migration, not a rewrite: the AngularJS shell
## survives, `BacklogController` (`backlog/main.coffee:51`, registered at `:796`)
## is RETAINED IN FULL as the data, permission and drag-serialisation layer, and
## only the seven view-layer directives it used to register are retired. This
## directive publishes ONE object, `ctrl.reactScreen`, which the React tree under
## `app/react/backlog/**` consumes.
##
## THIS MODULE HANDLE: `angular.module("taigaBacklog")` above RETRIEVES the module
## and MUST NEVER gain a second argument. The declaration belongs to
## `app/coffee/modules/backlog.coffee:9`, and `app/coffee/modules/taskboard/
## sortable.coffee:17` retrieves the SAME module from the Gulp `coffee_order` glob
## that runs immediately AFTER this folder. Passing `[]` here would reset the
## module and silently detach the out-of-scope taskboard's `tgTaskboardSortable`
## at bootstrap.
##
## 2. THE MECHANISM
## `tgLoadElement` (`app/coffee/modules/base/load-element.coffee:17-39`, on module
## `taigaBase`) is REUSED VERBATIM and MUST NOT BE MODIFIED. It `$watch`es the
## expression named by its attribute and, when truthy, assigns `.component` (L24,
## unconditional), `.params` (L26-27) and `.events` (L29-30) onto the host element.
## The host is `tg-react-loader`, registered by `app/react/index.ts` and resolved
## through `app/react/bridge/registry.ts`; `component: 'backlog-screen'` is that
## registry's key. Host markup:
##     tg-react-loader(tg-load-element="ctrl.reactScreen")
## Precedent for the whole hand-off: `app/modules/components/project-menu/
## project-menu.jade:9-12` with `project-menu.controller.coffee:24-33`.
##
## 3. WHY DOM PROPERTIES AND NOT ATTRIBUTES
## `tgLoadElement` assigns PROPERTIES. Attributes stringify their values;
## properties do not, so nested objects AND callback functions cross the boundary
## structurally intact. That is the entire trick. Never pass data as attributes.
##
## 4. BUILD ONCE -- AND ITS COROLLARY
## The `$watch` at `load-element.coffee:19` takes two arguments, so it compares by
## REFERENCE IDENTITY (`objectEquality` defaults to false). The bridge object is
## therefore built EXACTLY ONCE, via `taiga.bindOnce` (`app/coffee/utils.coffee:33`),
## and never rebuilt: a per-digest rebuild would re-fire the watcher on every
## digest, re-assign all three properties and drive React into a continuous
## re-render loop.
## COROLLARY, which must be read together with the rule above or the rule above is
## dangerously misleading: because that watch is reference-identity, MUTATING
## `params` IN PLACE PRODUCES NO NOTIFICATION AT ALL. "Build once and mutate" would
## hand React a stable reference with no change channel. So this object is a
## ONE-TIME HAND-OFF, NOT A STATE STREAM. `params` carries only values that are
## stable after project load; everything dynamic is read through the GETTER
## callbacks in `events`, which are stable function references -- the object never
## changes identity -- yet read live controller/scope state on each invocation.
## React otherwise gets live data through `useAngularService('$tgResources')` and
## `useRealtime`, never by polling `params`. The only sanctioned post-mount push
## precedent is `app/coffee/app.coffee:975-979`; do not invent another channel.
##
## 5. FLATTENING AT THE BOUNDARY
## No `Immutable` structure and no `$tgModel` instance may cross the seam: immer
## rejects class instances (P-IMMER-1) and `$tgModel` carries dirty-tracking state
## React must never mutate. Everything is flattened here by `toPlain` below --
## `.toJS()` for Immutable, `.getAttrs()` for `$tgModel` (`base/model.coffee:48-54`)
## -- following the house precedent at `project-menu.controller.coffee:27` and `:21`.
## `$scope.swimlanesList` STAYS an `Immutable.List` on the AngularJS scope
## (`backlog/main.coffee:124`, consumed at `:347-348`) because `Immutable.List::push`
## returns a NEW list while `Array::push` returns the new LENGTH, and because its
## `.size` contract is read by out-of-scope consumers such as
## `app/modules/components/card/card.controller.coffee` (rule T4). It is flattened
## ONLY here.
## For the `react/` agent, the remaining immer pitfalls: `console.log(draft)` THROWS
## on a Proxy draft, so use `JSON.stringify` or immer's `current()` (P-IMMER-2);
## never reassign the draft and never mix draft mutation with an explicit return
## from the same producer (P-IMMER-3); keep `autoFreeze` ON so structural sharing
## yields reference equality on untouched branches, which is what makes
## `React.memo` a real replacement for Immutable-based change detection, and so
## accidental post-`produce` mutation throws in development (P-IMMER-4).
## `useReducer(produce(reducer), init)` needs no `use-immer` dependency.
##
## 6. OWNERSHIP OF TEARDOWN
## `load-element.coffee` performs NO property cleanup -- its `$destroy` handler only
## unwatches (L32-33). `disconnectedCallback` on `app/react/bridge/
## ReactHostElement.ts` ALONE owns `root.unmount()`. This bridge never tears React
## down, never nulls `ctrl.reactScreen` and never calls into React.
##
## 7. LIGHT DOM ONLY, NEVER SHADOW DOM (requirement I6)
## A shadow root would sever the globally compiled Sass cascade (the single
## stylesheet is loaded at `app/index.jade:25`) and would break
## `<use href="#icon-...">` against the sprite inlined at `app/index.jade:96`.
##
## 8. TRANSPORT IS INHERITED, NEVER REBUILT (I7 / T5)
## React must not open its own transport. Routing every request through
## `$tgResources` inherits `Authorization: Bearer` (`base/http.coffee:21-23`),
## `X-Session-Id` (`app/coffee/app.coffee:590-602`), the single-flight 401 refresh,
## the 400-with-`version` VERSION_ERROR toast, the 451 blocking interceptor and the
## status 0/-1 connection-error path. `$tgModel` dirty-tracking is a DATA-INTEGRITY
## guarantee, not an optimisation: `save()` PATCHes only changed fields plus the
## `version` (`base/model.coffee:48-54`), so a hand-rolled `fetch` client would turn
## every edit into a potential lost update. The `/api/v1/` contract is frozen.
## REALTIME: the service is `app/coffee/modules/events.coffee` (module
## "taigaEvents"); `modules/base/events.coffee` DOES NOT EXIST. Its auto-unsubscribe
## fires only when a scope is passed, so `useRealtime` -- which passes a NULL scope,
## matching house style -- MUST call `unsubscribe(routingKey)` in its `useEffect`
## cleanup. That leak is silent and surfaces only as duplicate refreshes after
## navigating away and back. The two routing keys this screen subscribes to are
## documented at `backlog/main.coffee:261-280`.
##
## 9. TRAP -- `lightboxFactory.create` TARGETS ARE NOT WEB COMPONENTS
## `project-menu.controller.coffee:43-45` creates "tg-search-box", which appears
## ZERO times in `elements.js` -- that bundle defines exactly three custom elements:
## `tg-legacy`, `tg-legacy-loader` and `tg-project-navigation`. Every
## `lightboxFactory.create` target is an AngularJS element directive compiled by
## `$compile`. Do NOT model this bridge -- or `SprintFormLightbox.tsx` -- on them.
##
## 10. LOAD ORDER -- THE BLANK-SCREEN DIAGNOSIS
## `js/react.js` must be loaded between `app-loader/app-loader.coffee:111`
## (`elements.js`) and `:112` (`app.js`), i.e. BEFORE `angular.bootstrap` at `:114`,
## so `customElements.define` has run by the first compile. Otherwise
## `tg-react-loader` is an inert unknown element, `tgLoadElement` still assigns
## expando properties onto it, NO ERROR IS THROWN, and the screen renders BLANK.
## If the backlog comes up blank, check that insertion FIRST.
##
## 11. THE `pendingDrag` WARNING (for `app/react/backlog/hooks/useStoryDrag.ts`)
## `moveUs` is exposed verbatim below and fronts a FIFO queue with a re-entrancy
## guard (`backlog/main.coffee:600-723`). `bulk-update-us-backlog-order` is
## POSITION-RELATIVE -- `previousUs`/`nextUs` serialise to `after_userstory_id`/
## `before_userstory_id`, never absolute indices -- so with two requests in flight
## the second computes its neighbours from a client ordering the server has not yet
## acknowledged and the persisted order silently diverges from what the user sees:
## no error, no toast, no console warning, visible only on the next page load. A
## single-drag test passes against a completely broken implementation, so the
## Playwright specs MUST drag twice in rapid succession. Note also that the
## queue-empty branch is what gates BOTH tail blocks (the three-call
## `events.connected` reload fallback and the `backlog:load-closed-sprints`
## broadcast), and that the queue must live in the reducer rather than the
## component so it stays unit-testable without a browser (I9).
##
## CROSS-FOLDER ITEMS SURFACED HERE, NOT DECIDED HERE
##  * Whether React mounts INTO the kept `div.lightbox.lightbox-sprint-add-edit`
##    shell (`app/partials/backlog/backlog.jade:201-202`) or replaces its content
##    is for the `partials/` and `react/` agents to agree.
##  * BOTH `.js-empty-backlog` drop targets (`backlog.jade:174` and `:178`) are live
##    dragula containers (`backlog/sortable.coffee:34`, `:39`), and so is every
##    `.sprint-table` via the `isContainer` predicate (`sortable.coffee:42`,
##    `app/partials/backlog/sprint.jade:13`). All of them sit inside the
##    React-replaced region and must be registered by `app/react/shared/dnd/**`.
##  * The doom line is created inside the RETIRED `tgBacklog` directive
##    (`backlog/main.coffee`, `linkDoomLine`), NOT in `backlog.jade` as the plan's
##    component map implies, and `sortable.coffee:95` removes it document-wide.
##  * `$scope.currentSprint` (`main.coffee:374`) is reached through the
##    `findCurrentSprint` action rather than through a dedicated getter.
##
## Every user-visible string stays on the React side through `useTranslate`; this
## file carries no copy, no markup and no colour. Status, tag and epic colours are
## DATA (`s.color`, `tag[1]`, `epic.color`) and are never handed over as literals
## (rule T2). The milestone-divider and summary-bar fills are theme tokens and
## belong in SCSS, never in bridge data.
#############################################################################

# ---------------------------------------------------------------------------
# P-IMMER-1 / house style: flatten AT THE BOUNDARY.
# Precedent: `project-menu.controller.coffee:27` (`...toJS()`) and `:21`.
#   - Immutable.Map / Immutable.List -> .toJS()
#   - $tgModel instance              -> .getAttrs()  (`base/model.coffee:48-54`,
#                                       returns _.extend({}, _attrs, _modifiedAttrs))
#   - plain object / primitive       -> passed through UNCHANGED, same reference
# React (and immer) must NEVER receive either wrapper type. Because a plain value
# is returned by identity, wrapping a known-plain getter costs nothing and keeps
# React's reference equality intact.
# `_` (lodash) and `angular` are bundle globals here, as in every file in this folder.
# ---------------------------------------------------------------------------
toPlain = (value) ->
    return value if not value?
    return value.toJS() if angular.isFunction(value.toJS)
    return value.getAttrs() if angular.isFunction(value.getAttrs)
    return value

toPlainList = (list) -> _.map(list or [], toPlain)

# Sprints are the ONE nested case at this seam. `$tgRepo.queryMany` builds milestone
# models (`base/repository.coffee:135-148`) whose `user_stories` are THEMSELVES models
# (`app/coffee/modules/resources/sprints.coffee:33-35`), and `getAttrs()` is shallow,
# so without this the nested user stories would still reach immer as class instances.
# These two compose the helpers above rather than replacing them.
toPlainSprint = (sprint) ->
    plain = toPlain(sprint)
    return plain if not plain? or not _.isArray(plain.user_stories)
    return _.assign({}, plain, {user_stories: toPlainList(plain.user_stories)})

toPlainSprintList = (sprints) -> _.map(sprints or [], toPlainSprint)

# `sprintsById` / `closedSprintsById` are `taiga.groupBy` maps (`utils.coffee:80-85`)
# holding the SAME milestone models, so their values need the same flattening.
toPlainSprintMap = (sprintsById) -> _.mapValues(sprintsById or {}, toPlainSprint)

BacklogReactBridgeDirective = ($rootScope) ->
    link = ($scope, $el, $attrs) ->
        # jqLite's `controller()` with no argument resolves `ngController`, checking
        # this element first and then walking ancestors through `inheritedData`. The
        # directive therefore works BOTH on the `div.wrapper` that carries
        # `ng-controller="BacklogController as ctrl"` (`backlog.jade:10-11`) and on a
        # `tg-react-loader` host nested inside it -- neither position is assumed. Same
        # pattern as the retired `tgBacklog` link at `backlog/main.coffee:1018`.
        $ctrl = $el.controller()

        if not $ctrl
            # Mirrors the defensive check at `backlog/sortable.coffee:24-26`.
            console.error("tgBacklogReactBridge must have access to BacklogCtrl")
            return

        # Re-hydration. React only ever holds the FLATTENED data this seam produced,
        # but two AngularJS consumers reached through `events` still require the live
        # `$tgModel`:
        #   * `$tgRepo.remove()` calls `model.getIdAttrName()` and `model.getName()`
        #     (`base/repository.coffee:17-19`, `:37-39`), so `deleteUserStory` needs
        #     the model or it throws.
        #   * `tgLbCreateEditSprint` edits through `$scope.newSprint.realClone()`
        #     (`backlog/lightboxes.coffee:64`), so the `sprintform:edit` payload needs
        #     the model or the edit path throws.
        # Both helpers accept an id OR an object, look the record up in the
        # controller's own collections, and fall back to whatever the caller supplied
        # so handing a live model straight through still works and a missed lookup can
        # never break a call site.
        idOf = (value) ->
            return null if not value?
            return value.id if _.isObject(value)
            return value

        resolveUserStory = (us) ->
            id = idOf(us)
            return us if not id?
            return _.find($scope.userstories, (it) -> it? and it.id == id) or us

        resolveSprint = (sprint) ->
            id = idOf(sprint)
            return sprint if not id?
            return ($scope.sprintsById or {})[id] or ($scope.closedSprintsById or {})[id] or sprint

        bindOnce $scope, "project", (project) ->
            # `taiga.bindOnce` guards with `!= undefined` (`utils.coffee:35`), so a
            # null project would still reach this continuation -- guard defensively.
            return if not project

            # BUILD ONCE. See point 4 of the header block: the `tgLoadElement` `$watch`
            # is reference-identity, so reassigning `ctrl.reactScreen` re-fires it and
            # re-mounts React. This guard also keeps the invariant true if the directive
            # is ever placed on more than one element under the same controller.
            return if $ctrl.reactScreen

            $ctrl.reactScreen = {
                # Registry key into `app/react/bridge/registry.ts`. FIXED CONTRACT --
                # the kanban counterpart is 'kanban-board' on `ctrl.reactBoard`.
                component: 'backlog-screen'

                # ---------------------------------------------------------------
                # `params` -- SET-ONCE bootstrap values only. Everything here is
                # assigned by `BacklogController.loadProject()`
                # (`backlog/main.coffee:515-532`) before this continuation runs, and
                # every object is routed through `toPlain` as the seam's single
                # documented flattening point. Nothing dynamic belongs here: see the
                # corollary in point 4 of the header block.
                # ---------------------------------------------------------------
                params: {
                    projectId: $scope.projectId
                    # Already plain -- `main.coffee:516` does `.toJS()` -- but routed
                    # through `toPlain` for defence in depth. Carries `my_permissions`,
                    # which is the ONLY permission source React needs: it evaluates the
                    # same array the `tg-check-permission` / `tg-class-permission`
                    # directives evaluate (`sortable.coffee:30`), so no separate
                    # permission map is computed here. Gates in play on this screen:
                    # `is_backlog_activated` (screen level, `main.coffee:518-519`),
                    # then `add_us`, `modify_us`, `view_milestones`, `add_milestone`,
                    # `modify_milestone`, `delete_milestone`, plus the state-level
                    # blocked/archived restrictions.
                    project: toPlain($scope.project)
                    # The ROUTE section key, matching `ng-init="section='backlog'"`
                    # (`backlog.jade:11`). Deliberately NOT `$scope.sectionName`, which
                    # `main.coffee:128` sets to the translated BACKLOG.SECTION_NAME
                    # label.
                    sectionName: 'backlog'
                    points: toPlainList($scope.points)
                    pointsById: toPlain($scope.pointsById)
                    usStatusById: toPlain($scope.usStatusById)
                    usStatusList: toPlainList($scope.usStatusList)
                    closedMilestones: $scope.closedMilestones
                    # Initial snapshot only: `loadSwimlanes` (`main.coffee:344`) fills
                    # the Immutable.List asynchronously, so the live value must be read
                    # through `events.getSwimlanes` instead.
                    swimlanesList: toPlain($scope.swimlanesList)
                }

                events: {
                    # -----------------------------------------------------------
                    # GETTERS -- stable function references that read LIVE
                    # controller/scope state on every call. These, not `params`,
                    # are the change channel (header block, point 4). Object-valued
                    # getters go through `toPlain`, which returns plain values by
                    # identity, so reference equality is preserved for React while
                    # no `Immutable` or `$tgModel` wrapper can escape.
                    # -----------------------------------------------------------
                    getProject: => toPlain($scope.project)
                    # `$repo.queryMany` models (`repository.coffee:135-148`).
                    getUserStories: => toPlainList($scope.userstories)
                    # Plain array of `ref` primitives (`main.coffee:425-426`); returned
                    # by identity so React can rely on reference equality.
                    getVisibleUserStories: => $scope.visibleUserStories
                    getSprints: => toPlainSprintList($scope.sprints)
                    getClosedSprints: => toPlainSprintList($scope.closedSprints)
                    getSprintsById: => toPlainSprintMap($scope.sprintsById)
                    getClosedSprintsById: => toPlainSprintMap($scope.closedSprintsById)
                    # `$repo.queryOneRaw`, so already plain; carries
                    # `completedPercentage` (`main.coffee:302-314`).
                    getStats: => toPlain($scope.stats)
                    getShowGraphPlaceholder: => $scope.showGraphPlaceholder
                    # Flattened at CALL time -- the list is still empty at hand-off.
                    getSwimlanes: => toPlain($scope.swimlanesList)
                    # Despite the plural name this is a COUNT, not a list: it is the
                    # `Taiga-Info-Userstories-Without-Swimlane` response header
                    # (`main.coffee:444`), `false` until the first page lands
                    # (`:123`). Returned raw because it is a primitive.
                    getNoSwimlaneUserStories: => $scope.noSwimlaneUserStories
                    getTotalUserStories: => $ctrl.totalUserStories
                    getFilterQ: => $ctrl.filterQ
                    getTranslationData: => toPlain($ctrl.translationData)
                    getActiveFilters: => $ctrl.activeFilters
                    getSelectedFilters: => $ctrl.selectedFilters
                    getFilters: => toPlain($ctrl.filters)
                    getCustomFilters: => $ctrl.customFilters
                    getShowTags: => $ctrl.showTags
                    getDisplayVelocity: => $ctrl.displayVelocity
                    getForecastedStories: => toPlainList($ctrl.forecastedStories)
                    # These two back the infinite scroll that `backlog-table.jade:22-24`
                    # drives with `infinite-scroll-disabled="ctrl.disablePagination ||
                    # !ctrl.firstLoadComplete"`. `StoryTable.tsx` cannot be correct
                    # without both.
                    getDisablePagination: => $ctrl.disablePagination
                    getFirstLoadComplete: => $ctrl.firstLoadComplete
                    getPointsById: => toPlain($scope.pointsById)
                    getUsStatusById: => toPlain($scope.usStatusById)


                    # -----------------------------------------------------------
                    # ACTIONS -- thin delegations to the RETAINED
                    # `BacklogController`. Promise-returning methods hand their
                    # `$q` promise back UNCHANGED; React marshals it with
                    # `app/react/bridge/toNativePromise.ts`. No promise adapter is
                    # reimplemented on this side, and React must NEVER call
                    # `$rootScope.$apply()` -- digest cycles stay AngularJS's
                    # concern, which is why the controller keeps its own
                    # `$applyAsync` calls.
                    # -----------------------------------------------------------

                    # THE most important callback. Exposed VERBATIM: arguments are not
                    # wrapped, reordered, deferred, debounced or simplified, because the
                    # FIFO queue and its re-entrancy guard live in the controller
                    # (`main.coffee:600-723`). `ctx` is only ever tested for TRUTHINESS
                    # (`:616`, `:679`), never read as a value -- it arrives as an
                    # AngularJS event object, as the literal string "sprint:us:move", or
                    # as `null` from the queue-drain re-drive, and React models it as a
                    # plain boolean `isUserInitiated`. `previousUs` and `nextUs` are
                    # mutually exclusive at the source (`sortable.coffee:62`): the
                    # endpoint receives one anchor, never both. See point 11 above.
                    moveUs: (ctx, usList, newUsIndex, newSprintId, previousUs, nextUs) =>
                        return $ctrl.moveUs(ctx, usList, newUsIndex, newSprintId, previousUs, nextUs)

                    moveUsToTopOfBacklog: (uss) => $ctrl.moveUsToTopOfBacklog(uss)
                    loadUserstories: (resetPagination, pageSize) =>
                        return $ctrl.loadUserstories(resetPagination, pageSize)

                    loadAllPaginatedUserstories: => $ctrl.loadAllPaginatedUserstories()
                    loadSprints: => $ctrl.loadSprints()
                    loadClosedSprints: => $ctrl.loadClosedSprints()
                    unloadClosedSprints: => $ctrl.unloadClosedSprints()
                    loadProjectStats: => $ctrl.loadProjectStats()
                    loadSwimlanes: => $ctrl.loadSwimlanes()
                    # Returns milestone models (`main.coffee:378-379`), so flatten.
                    openSprints: => toPlainSprintList($ctrl.openSprints())
                    # Pure computation over `sprint.user_stories`; a sprint flattened by
                    # `toPlainSprint` works unchanged, which is exactly why the nested
                    # `user_stories` flattening above matters.
                    sprintTotalPoints: (sprint) => $ctrl.sprintTotalPoints(sprint)
                    findCurrentSprint: => toPlainSprint($ctrl.findCurrentSprint())
                    calculateForecasting: => $ctrl.calculateForecasting()
                    # Gated by `add_milestone` at `backlog.jade:120-121`.
                    toggleVelocityForecasting: => $ctrl.toggleVelocityForecasting()
                    toggleTags: => $ctrl.toggleTags()
                    toggleShowTags: => $ctrl.toggleShowTags()
                    toggleActiveFilters: => $ctrl.toggleActiveFilters()
                    # 'standard' broadcasts `genericform:new`, 'bulk' broadcasts
                    # `usform:bulk` (`main.coffee:764-772`); gated by `add_us`.
                    addNewUs: (type) => $ctrl.addNewUs(type)
                    addNewSprint: => $ctrl.addNewSprint()
                    editUserStory: (projectId, ref, $event) =>
                        return $ctrl.editUserStory(projectId, ref, $event)

                    # Re-hydrated: `$tgRepo.remove` needs the live model, and
                    # `main.coffee:750` removes it from `$scope.userstories` by
                    # REFERENCE, which a plain copy would never match.
                    deleteUserStory: (us) => $ctrl.deleteUserStory(resolveUserStory(us))
                    updateUserStoryStatus: => $ctrl.updateUserStoryStatus()
                    # From `UsFiltersMixin` (`controllerMixins.coffee:183`).
                    changeQ: (q) => $ctrl.changeQ(q)
                    # BACKLOG'S OWN FILTER NAMES. `BacklogController` OVERRIDES the
                    # plain `addFilter`/`removeFilter` of `UsFiltersMixin` (`:187`,
                    # `:192`) with these variants, which additionally call
                    # `filtersReloadContent()` and `generateFilters('null')` -- the
                    # STRING 'null' (`main.coffee:786-794`). Kanban's controller uses
                    # `addFilter`/`removeFilter`/`openFilter` instead; unifying the two
                    # naming sets would break one of the two screens.
                    addFilterBacklog: (newFilter) => $ctrl.addFilterBacklog(newFilter)
                    removeFilterBacklog: (filter) => $ctrl.removeFilterBacklog(filter)
                    saveCustomFilter: (name) => $ctrl.saveCustomFilter(name)
                    selectCustomFilter: (filter) => $ctrl.selectCustomFilter(filter)
                    removeCustomFilter: (filter) => $ctrl.removeCustomFilter(filter)
                    # Reproduces `backlog/sprints.coffee:49-53`. Re-hydrated because
                    # `tgLbCreateEditSprint` calls `.realClone()` on the payload
                    # (`lightboxes.coffee:64`), a `$tgModel` method.
                    editSprint: (sprint) =>
                        return $rootScope.$broadcast("sprintform:edit", resolveSprint(sprint))

                    # -----------------------------------------------------------
                    # THE AngularJS -> React EVENT CHANNEL
                    # `params`/`events` are a one-way hand-off, so this is how React
                    # observes AngularJS-side broadcasts. Returns the AngularJS
                    # DEREGISTRATION function; React MUST call it from its `useEffect`
                    # cleanup. Handlers already run inside a digest, so React code must
                    # never call `$rootScope.$apply()`.
                    #
                    # Names emitted from this folder that React may observe:
                    # backlog:loaded, backlog:userstories:loaded,
                    # backlog:load-closed-sprints, backlog:unload-closed-sprints,
                    # closed-sprints:reloaded, filters:update, genericform:new,
                    # genericform:edit, project:loaded, showTags, sprint:us:moved,
                    # sprintform:create, sprintform:edit,
                    # sprintform:create:success:callback, sprintform:remove:success,
                    # sprints:loaded, userstories:loaded, usform:bulk, uspoints:select,
                    # uspoints:clear-selection, plus the two issued through the
                    # `broadcastEvent` variable in `lightboxes.coffee:63`/`:70` --
                    # sprintform:create:success and sprintform:edit:success.
                    #
                    # WARNING for the `react/` agent: sprintform:create:success,
                    # sprintform:edit:success and sprintform:remove:success have an
                    # OUT-OF-SCOPE consumer -- `app/modules/services/
                    # project.service.coffee` registers all three in
                    # `fetchRequiredSignals` and re-fetches the project from them. If
                    # React stops broadcasting them the project silently goes stale.
                    # -----------------------------------------------------------
                    onAngularEvent: (eventName, handler) => $scope.$on(eventName, handler)
                }
            }

    return {link: link}

module.directive("tgBacklogReactBridge", ["$rootScope", BacklogReactBridgeDirective])

