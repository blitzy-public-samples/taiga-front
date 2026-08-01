###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

taiga = @.taiga

module = angular.module("taigaKanban")

#############################################################################
## React bridge service  (AngularJS -> React coexistence seam, Kanban board)
##
## 1. WHAT THIS FILE IS
## The AngularJS -> React coexistence bridge for the Kanban / Taskboard screen,
## and the counterpart of `app/coffee/modules/backlog/react-bridge.coffee`. This
## is a strangler-fig migration, not a rewrite: the AngularJS shell survives,
## `KanbanController` (`kanban/main.coffee:69`, registered at `:730`) is RETAINED
## IN FULL as the data, permission and drag layer, and only the view-layer
## directives it used to register are retired. This service publishes ONE object,
## `ctrl.reactBoard`, which the React tree under `app/react/kanban/**` consumes.
##
## THIS IS A SERVICE, NOT A DIRECTIVE -- and that asymmetry with the backlog
## bridge is required, not stylistic. `kanban/main.coffee` names
## `"tgKanbanReactBridge"` as the 24th and last entry of the controller's
## `@.$inject` list (`:105`) and calls `@reactBridge.build(@)` at the end of the
## constructor (`:185`). Only a service/factory is injectable by that name; a
## directive registered as `tgKanbanReactBridge` would be published to the
## injector as `tgKanbanReactBridgeDirective` and would NOT satisfy that
## injection -- AngularJS would raise
## `[$injector:unpr] Unknown provider: tgKanbanReactBridgeProvider` and abort
## linking the whole `ng-view` subtree, taking the project rail and the page
## title down with the board.
##
## THIS MODULE HANDLE: `angular.module("taigaKanban")` above RETRIEVES the module
## and MUST NEVER gain a second argument. The declaration belongs to
## `app/coffee/modules/kanban.coffee:9`, and three out-of-scope files retrieve
## the SAME module later in the Gulp `coffee_order` glob --
## `app/coffee/modules/taskboard/taskboard-issues.coffee:81`,
## `app/coffee/modules/taskboard/taskboard-tasks.coffee:157` and
## `app/coffee/modules/admin/lightboxes.coffee:13`. Passing `[]` here would reset
## the module and silently detach all of them at bootstrap.
##
## 2. THE MECHANISM
## `tgLoadElement` (`app/coffee/modules/base/load-element.coffee:17-39`, on module
## `taigaBase`) is REUSED VERBATIM and MUST NOT BE MODIFIED. It `$watch`es the
## expression named by its attribute and, when truthy, assigns `.component`
## (L24), `.params` (L26-27) and `.events` (L29-30) onto the host element. The
## host is `tg-react-loader`, registered by `app/react/index.ts` and resolved
## through `app/react/bridge/registry.ts`; `component: 'kanban-board'` is that
## registry's key. Host markup:
##     tg-react-loader(tg-load-element="ctrl.reactBoard")
## Precedent for the whole hand-off: `app/modules/components/project-menu/
## project-menu.jade:9-12` with `project-menu.controller.coffee:24-33`.
##
## 3. WHY DOM PROPERTIES AND NOT ATTRIBUTES
## `tgLoadElement` assigns PROPERTIES. Attributes stringify their values;
## properties do not, so nested objects AND callback functions cross the boundary
## structurally intact. That is the entire trick. Never pass data as attributes.
##
## 4. BUILT ONCE -- AND ITS COROLLARY
## `build(ctrl)` is called exactly once, from the end of the controller
## constructor, and the object it returns is never rebuilt. That watch
## (`load-element.coffee:19`) takes no third argument, so `objectEquality` is
## false and it compares by REFERENCE IDENTITY: re-running `build` on any
## digest-frequency path would re-fire the watcher every digest, re-assign all
## three properties and drive React into a continuous re-render loop.
## COROLLARY, which must be read together with the rule above or the rule above
## is dangerously misleading: because that watch is reference-identity, MUTATING
## `params` IN PLACE PRODUCES NO NOTIFICATION AT ALL. This object is therefore a
## ONE-TIME HAND-OFF, NOT A STATE STREAM.
##
## Note the ordering constraint that follows from the single call site: `build` runs
## at the END of the constructor, which is BEFORE `loadInitialData()` has resolved,
## so `$scope.project`, `$scope.usStatusList` and the four
## `defineImmutableProperty` projections are not yet populated. `params` therefore
## carries only the two values that are genuinely known at construction time, and
## EVERY piece of board data is read through the GETTER callbacks in `events` --
## stable function references, so the object never changes identity, yet they read
## live controller/scope state on each invocation. React learns when to re-read by
## subscribing through `onAngularEvent` (§6) and otherwise gets live data via
## `useAngularService('$tgResources')` and `useRealtime`, never by polling `params`.
## The only sanctioned post-mount push precedent is `app/coffee/app.coffee:975-979`;
## do not invent another channel.
##
## 5. FLATTENING AT THE BOUNDARY
## No `Immutable` structure and no `$tgModel` instance may cross the seam: immer
## rejects class instances (P-IMMER-1) and `$tgModel` carries dirty-tracking
## state React must never mutate. Everything is flattened here by `toPlain`
## below -- `.toJS()` for Immutable, `.getAttrs()` for `$tgModel`
## (`base/model.coffee:48-54`) -- following the house precedent at
## `project-menu.controller.coffee:27` and `:21`. The AngularJS-side structures
## are deliberately left alone: `usByStatus`, `usMap`, `usByStatusSwimlanes` and
## `swimlanesList` STAY Immutable on the scope (`kanban/main.coffee:143-154`)
## because out-of-scope consumers such as
## `app/modules/components/card/card.controller.coffee` read their `.size` and
## `.getIn()` contracts (rule T4). They are flattened ONLY here.
## For the `react/` agent, the remaining immer pitfalls: `console.log(draft)`
## THROWS on a Proxy draft, so use `JSON.stringify` or immer's `current()`
## (P-IMMER-2); never reassign the draft parameter and never mix draft mutation
## with an explicit return in one producer (P-IMMER-3); keep `autoFreeze` on so
## structural sharing gives reference equality on untouched branches and
## `React.memo` becomes a real replacement for Immutable change detection
## (P-IMMER-4).
##
## 6. EVENT NAMES React MAY OBSERVE through `onAngularEvent`
## Emitted from this folder: `kanban:userstories:loaded`, `kanban:us:move`,
## `kanban:us:deleted`, `kanban:show-userstories-for-status`,
## `kanban:shown-userstories-for-status`, `kanban:hidden-userstories-for-status`,
## `redraw:wip`, `userstories:loaded`, `project:loaded`, `usform:bulk`,
## `genericform:new`, `genericform:edit`. Consumed here from elsewhere:
## `usform:new:success`, `usform:edit:success`, `usform:bulk:success`,
## `lightbox:opened`, `lightbox:closed`.
##
## 7. WHAT MUST NOT MOVE INTO REACT
## Writes go through `$tgResources`/`$tgRepo` only, so the `Authorization` and
## `X-Session-Id` headers, the single-flight 401 refresh, the 400-with-`version`
## VERSION_ERROR toast, the 451 blocking interceptor and -- most importantly --
## `$tgModel`'s changed-fields-only PATCH with its optimistic-concurrency
## `version` are all inherited rather than re-derived. React must never call
## `$rootScope.$apply()`: digest cycles remain AngularJS's concern.
#############################################################################

# Flatten one value at the seam: Immutable -> plain via `.toJS()`, `$tgModel` ->
# plain via `.getAttrs()`, anything else passed through untouched.
toPlain = (value) ->
    return value if not value?
    return value.toJS() if angular.isFunction(value.toJS)
    return value.getAttrs() if angular.isFunction(value.getAttrs)
    return value

toPlainList = (list) -> _.map(list or [], toPlain)

KanbanReactBridgeService = ($rootScope) ->
    service = {}

    # `ctrl` is the live `KanbanController` instance. Called exactly once, from
    # the end of its constructor -- see §4 on why it is never called again.
    service.build = (ctrl) ->
        return null if not ctrl
        $scope = ctrl.scope

        return {
            component: 'kanban-board'
            # `params` carries ONLY what is genuinely known at construction time
            # and stable for the life of the screen. `$scope.sectionName` qualifies:
            # `kanban/main.coffee:141` assigns it synchronously, before the
            # `build(@)` call at `:185`.
            #
            # `projectId` deliberately does NOT appear here, and that omission is
            # load-bearing. It is first assigned in `loadProject`
            # (`kanban/main.coffee:666`/`:668`), which runs from the ASYNC
            # `loadInitialData()` chain long after this function has returned, so a
            # snapshot taken here would be permanently `undefined`. Because §4
            # forbids rebuilding this object, that stale value could never be
            # corrected -- an always-undefined key is worse than no key at all,
            # since it reads as "loaded but empty" rather than "read it live".
            # React obtains it from `events.getProjectId()` instead, which returns
            # the real id on every call.
            params: {
                sectionName: $scope.sectionName
            }
            events: {
                # --- project, taxonomies and permissions -------------------
                getProject: => toPlain($scope.project)
                getProjectId: => $scope.projectId
                getPoints: => toPlainList($scope.points)
                getPointsById: => toPlain($scope.pointsById)
                getUsStatusList: => toPlainList($scope.usStatusList)
                getUsStatusById: => toPlain($scope.usStatusById)

                # --- board data (Immutable on the scope, flattened here) ----
                getUsByStatus: => toPlain($scope.usByStatus)
                getUsByStatusSwimlanes: => toPlain($scope.usByStatusSwimlanes)
                getUsMap: => toPlain($scope.usMap)
                getSwimlanes: => toPlainList($scope.swimlanes)
                getSwimlanesList: => toPlain($scope.swimlanesList)
                getSwimlanesStatuses: => toPlain($scope.swimlanesStatuses)
                getFoldedSwimlane: => toPlain(ctrl.foldedSwimlane)

                # --- virtualisation, zoom and transient board state --------
                getUsCardVisibility: => $scope.usCardVisibility
                getZoom: => ctrl.zoom
                getZoomLevel: => ctrl.zoomLevel
                getZoomLoading: => ctrl.zoomLoading
                getInitialLoad: => ctrl.initialLoad
                getRenderInProgress: => ctrl.renderInProgress
                getNotFoundUserstories: => ctrl.notFoundUserstories
                getMovedUs: => ctrl.movedUs
                getSelectedUss: => ctrl.selectedUss

                # --- filters -----------------------------------------------
                getFilterQ: => ctrl.filterQ
                getFilters: => toPlain(ctrl.filters)
                getActiveFilters: => ctrl.activeFilters
                getSelectedFilters: => ctrl.selectedFilters
                getCustomFilters: => ctrl.customFilters
                getOpenFilter: => ctrl.openFilter
                getTranslationData: => toPlain(ctrl.translationData)

                # --- actions: delegated, never reimplemented ---------------
                # `moveUs` keeps the AngularJS signature verbatim so the
                # position-relative write API (`previousCard`/`nextCard` ->
                # `after_userstory_id`/`before_userstory_id`) is preserved: an
                # off-by-one here persists a wrong order with no error surface.
                moveUs: (ctx, usList, newStatusId, newSwimlaneId, index, previousCard, nextCard) =>
                    return ctrl.moveUs(ctx, usList, newStatusId, newSwimlaneId, index, previousCard, nextCard)
                moveUsToTop: (uss) => ctrl.moveUsToTop(uss)
                moveToTopDropdown: (us) => ctrl.moveToTopDropdown(us)
                setZoom: (zoomLevel, zoom) => ctrl.setZoom(zoomLevel, zoom)
                toggleFold: (id) => ctrl.toggleFold(id)
                toggleSwimlane: (id) => ctrl.toggleSwimlane(id)
                toggleSelectedUs: (usId) => ctrl.toggleSelectedUs(usId)
                cleanSelectedUss: => ctrl.cleanSelectedUss()
                showPlaceHolder: (statusId, swimlaneId) => ctrl.showPlaceHolder(statusId, swimlaneId)
                isUsInArchivedHiddenStatus: (usId) => ctrl.isUsInArchivedHiddenStatus(usId)
                addNewUs: (type, statusId) => ctrl.addNewUs(type, statusId)
                editUs: (id) => ctrl.editUs(id)
                deleteUs: (id) => ctrl.deleteUs(id)
                changeUsAssignedUsers: (id) => ctrl.changeUsAssignedUsers(id)
                loadUserstories: => ctrl.loadUserstories()
                loadUserStoriesForStatus: (ctx, statusId) => ctrl.loadUserStoriesForStatus(ctx, statusId)
                hideUserStoriesForStatus: (ctx, statusId) => ctrl.hideUserStoriesForStatus(ctx, statusId)
                loadSwimlanes: => ctrl.loadSwimlanes()

                # --- filter actions ---------------------------------------
                changeQ: (q) => ctrl.changeQ(q)
                addFilter: (newFilter) => ctrl.addFilter(newFilter)
                removeFilter: (filter) => ctrl.removeFilter(filter)
                saveCustomFilter: (name) => ctrl.saveCustomFilter(name)
                selectCustomFilter: (filter) => ctrl.selectCustomFilter(filter)
                removeCustomFilter: (filter) => ctrl.removeCustomFilter(filter)

                # --- signalling -------------------------------------------
                # React's only sanctioned change channel: subscribe to the
                # names listed in §6, then re-read through the getters above.
                onAngularEvent: (eventName, handler) => $scope.$on(eventName, handler)
                broadcast: (eventName, args...) => $rootScope.$broadcast(eventName, args...)
            }
        }

    return service

module.factory("tgKanbanReactBridge", ["$rootScope", KanbanReactBridgeService])
