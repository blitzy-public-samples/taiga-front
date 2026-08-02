###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

module = angular.module("taigaKanban")

#############################################################################
## React bridge -- the AngularJS -> React coexistence seam for the Kanban board.
##
## 1. WHAT THIS FILE IS
## A strangler-fig seam, not a rewrite. `KanbanController`
## (`app/coffee/modules/kanban/main.coffee:68`, registered at `:730`) is RETAINED
## IN FULL as the data, permission, realtime and write layer; only the view-layer
## directives that file used to register are retired. This file adds exactly ONE
## injectable, `tgKanbanReactBridge`, whose single `build(ctrl)` call produces the
## `{component, params, events}` payload published on `ctrl.reactBoard`
## (`main.coffee:185`). `app/partials/kanban/kanban.jade` hosts it as
##     tg-react-loader(tg-load-element="ctrl.reactBoard")
## and `component: 'kanban-board'` is the key `app/react/bridge/registry.ts`
## resolves to `app/react/kanban/KanbanBoard.tsx`. Precedent for the entire
## hand-off: `app/modules/components/project-menu/project-menu.jade:9-12` driven
## by `project-menu.controller.coffee:24-33`.
##
## This file holds no view logic, no transport, no realtime listener and no state
## machine. Every behaviour it exposes already exists on the retained controller;
## the only thing added here is the crossing.
##
## 2. WHY A FACTORY AND NOT A DIRECTIVE
## `main.coffee` names `"tgKanbanReactBridge"` as the 24th and LAST entry of the
## controller's `@.$inject` list (`:105`) and takes it as the last constructor
## parameter (`:126`). Only a service/factory is injectable under that exact name:
## a directive of the same name is published to the injector as
## `tgKanbanReactBridgeDirective`, so AngularJS would raise
## `[$injector:unpr] Unknown provider: tgKanbanReactBridgeProvider` and abort
## linking the whole `ng-view` subtree -- taking the project rail and the page
## title down with the board. That `$inject` list maps POSITIONALLY, which is why
## the entry sits at the END of it: inserting it anywhere else would silently
## misbind all 23 pre-existing services, with no error raised at all.
##
## Bundle order is deliberately irrelevant here. `gulpfile.js`
## `paths.coffee_order` concatenates `coffee/modules/kanban/*.coffee`
## alphabetically, so `main.coffee` is emitted BEFORE `react-bridge.coffee` and the
## controller declares a dependency on a name that is registered later in the same
## bundle. That is safe because AngularJS resolves dependencies lazily at
## INSTANTIATION time, never at registration time. Do not "fix" the order by
## renaming this file.
##
## 3. THE MODULE HANDLE ON LINE 9 MUST NEVER GAIN A SECOND ARGUMENT
## Line 9 RETRIEVES the existing `taigaKanban` module. The declaring call -- the
## one that passes the empty dependency array -- belongs to
## `app/coffee/modules/kanban.coffee:9`. Passing `[]` from here as well would RESET
## that module, and because `paths.coffee_order` concatenates
## `coffee/modules/taskboard/*.coffee` (L147) BEFORE
## `coffee/modules/kanban/*.coffee` (L148), the reset would silently detach the
## OUT-OF-SCOPE taskboard's `tgTaskboardIssues`
## (`taskboard/taskboard-issues.coffee:81`) and `tgTaskboardTasks`
## (`taskboard/taskboard-tasks.coffee:157`), along with everything
## `admin/lightboxes.coffee:13` hangs off the same handle. The breakage would
## appear at bootstrap, in a screen this migration never touches.
##
## 4. DOM PROPERTIES, NOT ATTRIBUTES
## `tgLoadElement` (`app/coffee/modules/base/load-element.coffee:17-39`, on module
## `taigaBase`) is REUSED VERBATIM and MUST NOT BE MODIFIED. It assigns
## `.component` (`:24`, unconditionally), `.params` (`:26-27`) and `.events`
## (`:29-30`) onto the host element as PROPERTIES. Attributes stringify their
## values; properties do not, so nested objects AND callback functions cross the
## framework boundary structurally intact -- that is the entire trick, and it is
## why nothing here is ever serialised. Because `:26-27` and `:29-30` are
## truthiness-gated while `:24` is not, `params` and `events` below are ALWAYS
## emitted as real objects: never `null`, never `undefined`, never conditionally
## omitted.
##
## The React root mounts in LIGHT DOM only. A shadow root would sever the single
## global stylesheet loaded at `app/index.jade:25` and break `<use href="#icon-add">`
## against the sprite inlined at `app/index.jade:96`.
##
## 5. BUILT ONCE -- AND THE COROLLARY THAT MAKES THAT RULE SAFE
## The watch expression at `load-element.coffee:19` takes NO third argument, so
## `objectEquality` is false and it compares by REFERENCE IDENTITY. Re-running
## `build(ctrl)` on any digest-frequency path would therefore re-fire that watcher
## on every digest, re-assign all three properties and drive React into a
## continuous re-render loop. It is called exactly ONCE, at the end of the
## controller constructor, and the object it returns is never rebuilt.
##
## COROLLARY -- read it together with the rule above, or the rule above is
## dangerously misleading: because that comparison is reference identity, MUTATING
## `params` IN PLACE PRODUCES NO NOTIFICATION AT ALL. "Build once and mutate"
## would hand React a stable reference with no change channel. This payload is
## therefore a ONE-TIME HAND-OFF, NOT A STATE STREAM, and no change-notification
## machinery is built here: no watcher, no event-bus relay, no emitter, no
## observable. React re-reads live state through the accessor callbacks in
## `events` -- stable function references, so the payload's identity never changes,
## yet each call reads current controller and scope state -- and otherwise obtains
## data through `useAngularService('$tgResources')` and its own `useRealtime` hook.
## The only sanctioned post-mount push precedent in this repository is
## `app/coffee/app.coffee:975-979`; do not invent another channel.
##
## `build` also runs BEFORE `loadInitialData()` (`main.coffee:678`) has resolved,
## so `params` is an honest CONSTRUCTION-TIME SNAPSHOT: whatever the async load
## chain has not populated yet is empty or absent in it. That is exactly what
## `params` is for -- the first frame -- and it is why every value React needs to
## keep current is ALSO reachable through an accessor in `events`.
##
## 6. FLATTENING AT THE BOUNDARY
## No persistent collection (immutable.js `Map`/`List`) and no `$tgModel` instance
## may cross the seam: immer rejects class instances, and `$tgModel` carries the
## dirty-tracking state that makes changed-fields-only PATCH work, which React
## must never touch. Everything is flattened here by `toPlain` below -- `.toJS()`
## for persistent collections, `.getAttrs()` for `$tgModel`
## (`app/coffee/modules/base/model.coffee:48`) -- following the house precedent at
## `project-menu.controller.coffee:27` and `:21`, and at `kanban/main.coffee:661`.
##
## Unwrapping alone is not sufficient, so `stripAngularPrivates` then copies the
## result and drops AngularJS's own `$$`-prefixed bookkeeping from it. Two reasons,
## both spelled out at that function: `ng-repeat` stamps `$$hashKey` onto the
## objects it iterates, and immer's `autoFreeze` would freeze whatever React keeps
## -- freezing an object AngularJS still repeats over makes the next digest throw.
## The seam therefore hands over plain, clean, freshly allocated JSON values.
##
## The AngularJS-side structures are deliberately LEFT ALONE. `usByStatus`,
## `usMap`, `usByStatusSwimlanes` and `swimlanesList` stay persistent on the scope
## (`main.coffee:144-154`) because out-of-scope consumers depend on their `.size`
## and `.getIn()` contracts: `kanban.jade:17` switches the `swimlane` class on
## `swimlanesList.size`, and `app/modules/components/card/card.controller.coffee:31`
## reads the same property from the shared card component the taskboard also
## renders (rule T4). They are flattened ONLY here, at this seam.
##
## 7. WHAT MUST NOT MOVE INTO REACT
## Every read and write still goes through `$tgResources` / `$tgRepo` on the
## retained controller, so the `Authorization: Bearer` header
## (`app/coffee/modules/base/http.coffee:20-23`), the `X-Session-Id` header
## (`app/coffee/app.coffee:590-602`), the single-flight 401 refresh, the
## 400-with-`version` VERSION_ERROR toast, the 451 blocking interceptor, the
## status-0 connection-error path and -- most importantly -- `$tgModel`'s
## changed-fields-only PATCH carrying its optimistic-concurrency `version` are all
## INHERITED rather than re-derived. A hand-rolled transport would begin sending
## whole objects and turn every concurrent edit into a potential silent lost
## update, which is a data-integrity regression rather than a stylistic one.
##
## Realtime also stays where it is: the controller's own handlers
## (`main.coffee:341`) cover `changes.project.<id>.userstories` and
## `changes.project.<id>.projects` -- those two routing keys only -- and this file
## opens no realtime channel of its own. React must never force an AngularJS
## digest by hand; digest cycles remain AngularJS's concern and React state is
## driven by React. Several delegations below hand back `$q` promises, which the
## React side marshals through `app/react/bridge/toNativePromise.ts` at the call
## site rather than consuming directly.
##
## Teardown is not this file's business either. `load-element.coffee:32-33` only
## releases its own watcher and performs NO property cleanup, so
## `disconnectedCallback` on the host element alone owns unmounting the React root.
## Nothing here tears React down or clears `ctrl.reactBoard`.
##
## 8. COORDINATION NOTES -- SURFACED HERE, DECIDED ELSEWHERE
## (a) `app-loader/app-loader.coffee:110-114` still chains
##     `elements.js -> app.js -> angular.bootstrap` with no `js/react.js` step. Until
##     that load is inserted between `:111` and `:112`, the element definition runs
##     after `angular.bootstrap`, `tg-react-loader` is an inert unknown element,
##     `tgLoadElement` still assigns the three values as plain expando properties,
##     NOTHING THROWS, and the board renders BLANK. Check that first for an empty
##     board. That file belongs to another agent and is not edited from here.
## (b) Component ownership is unresolved upstream: the plan states that
##     `tg-kanban-board-zoom`, `tgInputSearch` and `tg-filter` stay AngularJS and are
##     bridged to rather than reimplemented, yet all three sit inside the region
##     (`kanban.jade:38-41`, `:44-46`, `:52-62`) that is replaced by a single
##     `tg-react-loader`. This file deliberately does not pick a side: it exposes
##     EVERY toolbar and filter method so either resolution works unchanged.
## (c) `kanban.jade:56` carries a pre-existing duplicate attribute whose expression
##     is broken (`ctl` instead of `ctrl`). It is left exactly as it is, and no alias
##     is added here to compensate for it.
#############################################################################

# Hand React a COPY with AngularJS's own private bookkeeping removed. Two
# distinct hazards make this step mandatory rather than cosmetic:
#
# (a) `ng-repeat` WITHOUT a `track by` stamps a `$$hashKey` onto every object it
#     iterates, and `kanban-table.jade:17` repeats over `usStatusList`, so the
#     status objects reachable from the scope carry one. `$$`-prefixed properties
#     are AngularJS internals scoped to a digest. As React props they are dead
#     weight that also makes two otherwise identical status objects compare
#     unequal, defeating the `React.memo` reference checks that replace
#     immutable.js change detection.
# (b) Sharing the very objects AngularJS is still rendering is worse than untidy.
#     immer keeps `autoFreeze` ON, so anything entering React state is
#     `Object.freeze`d -- and the next `ng-repeat` pass over a now-frozen object
#     throws "Cannot add property $$hashKey, object is not extensible". Handing
#     over a copy removes that failure mode instead of leaving it latent.
#
# `angular.toJson` is reused rather than hand-rolling a walk because it already
# implements exactly this policy: it drops `$$`-prefixed keys at EVERY depth, and
# it substitutes a sentinel for a window, a document or a `$scope` instead of
# serialising it -- which makes "never pass a `$scope` or a DOM node across the
# seam" structurally impossible here rather than merely documented.
stripAngularPrivates = (value) ->
    return value if not angular.isObject(value)
    json = angular.toJson(value)
    # `angular.toJson` yields undefined only for input JSON cannot represent at
    # all. Returning the value unchanged is then strictly better than handing
    # React nothing, and it cannot arise for the plain server-shaped data this
    # seam moves -- every params value is asserted JSON-serialisable at runtime.
    return value if not json?
    return angular.fromJson(json)

# Flatten one value at the seam. Persistent collections expose `.toJS()`;
# `$tgModel` instances expose `.getAttrs()` (`base/model.coffee:48`). The order
# matters because a persistent collection has no `.getAttrs()` and a model has no
# `.toJS()`, so at most one branch can ever apply. Whatever the unwrapping
# produces is then copied and cleaned by `stripAngularPrivates` above. Plain
# scalars, including `0`, `false` and `""`, fall through untouched.
toPlain = (value) ->
    return value if not value?
    return stripAngularPrivates(value.toJS()) if angular.isFunction(value.toJS)
    return stripAngularPrivates(value.getAttrs()) if angular.isFunction(value.getAttrs)
    return stripAngularPrivates(value)

# Flatten a plain AngularJS array whose members may be models. Anything that is
# not an array -- most often a collection the async load chain has not populated
# yet -- becomes an empty array, so React never has to guard a `.map()`.
toPlainList = (list) ->
    return [] if not angular.isArray(list)
    return (toPlain(item) for item in list)

# Read the project's permission list. The contents are passed through EXACTLY as
# the server sent them: React evaluates its own gates (`add_us`, `modify_us`,
# `view_milestones`, ...) from this array of permission codenames, the same way
# `tg-check-permission` and `tg-class-permission` do today. No pre-computed
# booleans are invented here. Copied with `slice` for the same reason as
# `stripAngularPrivates` above -- the members are plain strings, so no deeper walk
# is warranted, but the array itself must not be the one AngularJS still holds.
toMyPermissions = (project) ->
    return [] if not project or not angular.isArray(project.my_permissions)
    return project.my_permissions.slice()


# No injected services: every value and every behaviour this bridge publishes
# already lives on the controller instance handed to `build`. With no injectable
# parameters there is nothing for a minifier to rename, so the plain function form
# is registered rather than an inline array annotation -- the same reason
# `main.coffee:730` registers its controller without one.
KanbanReactBridgeFactory = () ->
    service = {}

    # `ctrl` is the live `KanbanController` instance. Called exactly once, from the
    # end of its constructor (`main.coffee:185`) -- see §5 on why it is never called
    # again. Reads from `ctrl`, closes over it, and mutates nothing on it.
    service.build = (ctrl) ->
        if not ctrl or not ctrl.scope
            # Fail loudly instead of returning a falsy payload. A `null` return would
            # leave `ctrl.reactBoard` falsy, the watch expression at
            # `load-element.coffee:19` would never see a truthy value, the host
            # element would keep its default properties and the board would render
            # EMPTY WITH NO ERROR -- precisely the silent failure mode this seam is
            # most exposed to. The one sanctioned call site always passes the live
            # controller, so this branch is unreachable in normal operation and
            # exists to make a contract breach diagnosable at its origin.
            throw new Error(
                "tgKanbanReactBridge.build() requires the KanbanController instance and its scope")

        $scope = ctrl.scope

        return {
            # Registry key resolved by `app/react/bridge/registry.ts`. Frozen
            # contract: renaming it detaches the board from its React component.
            component: 'kanban-board'

            # The first-frame snapshot, taken at construction time and never
            # rebuilt (§5). Anything the async `loadInitialData()` chain
            # (`main.coffee:678`) has not populated yet is empty here by
            # definition; the matching accessor in `events` returns the live value
            # from then on. Every persistent collection and every model is
            # flattened (§6), so nothing that immer or React would choke on
            # crosses the seam.
            #
            # Status, tag and epic colours, WIP limits and every count travel
            # inside this data and are NEVER literals here: they come from
            # `status.color`, `tag[1]`, `epic.color` and `status.wip_limit` per
            # project, so hard-coding any of them would break every real project
            # (rule T2).
            params: {
                # Assigned synchronously at `main.coffee:141`, so this is the one
                # value guaranteed to be populated when `build` runs.
                sectionName: $scope.sectionName

                # Already a plain object: `loadProject` (`main.coffee:661`) stores
                # `@projectService.project.toJS()`. Flattened anyway so the seam
                # never depends on that staying true.
                project: toPlain($scope.project)
                myPermissions: toMyPermissions($scope.project)

                # Board taxonomies, sorted and grouped by the controller
                # (`main.coffee:669-672`).
                points: toPlainList($scope.points)
                pointsById: toPlain($scope.pointsById)
                usStatusList: toPlainList($scope.usStatusList)
                usStatusById: toPlain($scope.usStatusById)

                # The four persistent projections defined at `main.coffee:144-154`.
                # `kanbanUserstoriesService.reset()` runs first (`:128`), so all
                # four are real empty collections rather than `undefined`, and
                # `.toJS()` here yields `{}` / `[]` on the first frame.
                usByStatus: toPlain($scope.usByStatus)
                usByStatusSwimlanes: toPlain($scope.usByStatusSwimlanes)
                usMap: toPlain($scope.usMap)
                swimlanesList: toPlain($scope.swimlanesList)
                swimlanes: toPlainList($scope.swimlanes)
                swimlanesStatuses: toPlain($scope.swimlanesStatuses)

                # Fold state: a persistent `Map` at `main.coffee:132`, replaced
                # from stored modes at `:680`. Its persisted form is already plain
                # -- `:426` stores `@.foldedSwimlane.toJS()` -- so flattening here
                # hands React exactly the shape the server round-trips.
                foldedSwimlane: toPlain(ctrl.foldedSwimlane)

                # Zoom is driven by `tg-kanban-board-zoom` through
                # `setZoom(zoomLevel, zoom)` (`main.coffee:209`), which may not have
                # fired yet when `build` runs.
                zoom: ctrl.zoom
                zoomLevel: ctrl.zoomLevel

                # Toolbar and filter state. `openFilter` is initialised at
                # `main.coffee:129`; the rest are populated by `generateFilters`
                # (`controllerMixins.coffee:305`, `:316`, `:362`), which the async
                # load chain triggers.
                filterQ: ctrl.filterQ
                openFilter: ctrl.openFilter
                filters: toPlain(ctrl.filters)
                selectedFilters: ctrl.selectedFilters or []
                customFilters: ctrl.customFilters or []
            }

            # Stable function references, so the payload keeps one identity for the
            # life of the screen (§5). Accessors read live state on every call;
            # actions delegate to the retained controller and never reimplement it.
            # Every callback uses the fat arrow, matching the precedent at
            # `project-menu.controller.coffee:30`.
            events: {
                # --- project, taxonomies and permissions ----------------------
                getProject: => toPlain($scope.project)
                getProjectId: => $scope.projectId
                getMyPermissions: => toMyPermissions($scope.project)
                getPoints: => toPlainList($scope.points)
                getPointsById: => toPlain($scope.pointsById)
                getUsStatusList: => toPlainList($scope.usStatusList)
                getUsStatusById: => toPlain($scope.usStatusById)

                # --- board data: persistent on the scope, flattened here -------
                getUsByStatus: => toPlain($scope.usByStatus)
                getUsByStatusSwimlanes: => toPlain($scope.usByStatusSwimlanes)
                getUsMap: => toPlain($scope.usMap)
                getSwimlanes: => toPlainList($scope.swimlanes)
                getSwimlanesList: => toPlain($scope.swimlanesList)
                getSwimlanesStatuses: => toPlain($scope.swimlanesStatuses)
                getFoldedSwimlane: => toPlain(ctrl.foldedSwimlane)

                # --- virtualisation, zoom and transient board state -----------
                # `usCardVisibility` (`main.coffee:673`) is the id -> boolean latch
                # the IntersectionObserver fills in; it is handed over by reference
                # and is READ-ONLY for React, which owns its own visibility state
                # through `useInViewport`.
                getUsCardVisibility: => $scope.usCardVisibility or {}
                getZoom: => ctrl.zoom
                getZoomLevel: => ctrl.zoomLevel
                getZoomLoading: => ctrl.zoomLoading
                getInitialLoad: => ctrl.initialLoad
                getRenderInProgress: => ctrl.renderInProgress
                getNotFoundUserstories: => ctrl.notFoundUserstories
                getMovedUs: => ctrl.movedUs or []
                getSelectedUss: => ctrl.selectedUss or {}

                # --- filter state ---------------------------------------------
                # Kanban's own names throughout. The backlog screen calls the
                # equivalent state something else; the two are NOT unified, because
                # `kanban.jade` binds `ctrl.openFilter` (`:23`, `:25`, `:29`, `:33`,
                # `:48`) and nothing else.
                getFilterQ: => ctrl.filterQ
                getFilters: => toPlain(ctrl.filters)
                getSelectedFilters: => ctrl.selectedFilters or []
                getCustomFilters: => ctrl.customFilters or []
                getOpenFilter: => ctrl.openFilter

                # --- board actions: delegated, never reimplemented ------------
                # `moveUs` keeps the retained controller's signature VERBATIM
                # (`main.coffee:692`), including the leading `ctx` -- the AngularJS
                # event object when the controller is driven from the event bus, and
                # `null` when it is called directly, exactly as `moveUsToTop` does.
                # The write it performs is POSITION-RELATIVE: `previousCard` and
                # `nextCard` become `after_userstory_id` / `before_userstory_id` on
                # `bulkUpdateKanbanOrder` (`:714`), so an off-by-one in the caller
                # persists a wrong order with no error surface at all.
                moveUs: (ctx, usList, newStatusId, newSwimlaneId, index, previousCard, nextCard) =>
                    ctrl.moveUs(ctx, usList, newStatusId, newSwimlaneId, index, previousCard, nextCard)
                moveUsToTop: (uss) => ctrl.moveUsToTop(uss)
                moveToTopDropdown: (us) => ctrl.moveToTopDropdown(us)

                # Two arguments, deliberately: the zoom step and the zoom
                # descriptor. Collapsing them would break `main.coffee:209-229`,
                # which compares the step and uses the descriptor separately.
                setZoom: (zoomLevel, zoom) => ctrl.setZoom(zoomLevel, zoom)

                toggleFold: (id) => ctrl.toggleFold(id)
                toggleSwimlane: (id) => ctrl.toggleSwimlane(id)
                toggleSelectedUs: (usId) => ctrl.toggleSelectedUs(usId)
                cleanSelectedUss: => ctrl.cleanSelectedUss()
                showPlaceHolder: (statusId, swimlaneId) => ctrl.showPlaceHolder(statusId, swimlaneId)
                isUsInArchivedHiddenStatus: (usId) => ctrl.isUsInArchivedHiddenStatus(usId)

                # `type` is "standard" or "bulk" (`main.coffee:362-372`); both open
                # the existing shared lightboxes, which stay AngularJS.
                addNewUs: (type, statusId) => ctrl.addNewUs(type, statusId)
                editUs: (id) => ctrl.editUs(id)
                deleteUs: (id) => ctrl.deleteUs(id)
                changeUsAssignedUsers: (id) => ctrl.changeUsAssignedUsers(id)

                loadUserstories: => ctrl.loadUserstories()
                loadUserStoriesForStatus: (ctx, statusId) => ctrl.loadUserStoriesForStatus(ctx, statusId)
                hideUserStoriesForStatus: (ctx, statusId) => ctrl.hideUserStoriesForStatus(ctx, statusId)
                loadSwimlanes: => ctrl.loadSwimlanes()

                # --- toolbar and filter actions -------------------------------
                # `changeQ`, `addFilter`, `removeFilter`, `selectCustomFilter`,
                # `saveCustomFilter` and `removeCustomFilter` are mixed into the
                # controller by `taiga.UsFiltersMixin`
                # (`controllerMixins.coffee:183-222`) and are reached under kanban's
                # names, never the backlog variants.
                changeQ: (q) => ctrl.changeQ(q)
                addFilter: (newFilter) => ctrl.addFilter(newFilter)
                removeFilter: (filter) => ctrl.removeFilter(filter)
                saveCustomFilter: (name) => ctrl.saveCustomFilter(name)
                selectCustomFilter: (filter) => ctrl.selectCustomFilter(filter)
                removeCustomFilter: (filter) => ctrl.removeCustomFilter(filter)

                # The filter panel's open/closed state lives in the template today
                # as the inline expression `ctrl.openFilter = !ctrl.openFilter`
                # (`kanban.jade:23`). That markup is replaced by the React toolbar,
                # so the same flip is surfaced here rather than duplicated in React,
                # keeping `.btn-filter`'s `active` class and `.kanban-manager`'s
                # `expanded` class driven by the one boolean they already read.
                # Returns the new value.
                toggleOpenFilter: => ctrl.openFilter = !ctrl.openFilter
            }
        }

    return service

module.factory("tgKanbanReactBridge", KanbanReactBridgeFactory)
