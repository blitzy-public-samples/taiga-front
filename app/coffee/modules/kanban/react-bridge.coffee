###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

module = angular.module("taigaKanban")

# The AngularJS -> React seam for the Kanban board. `KanbanController` remains the
# data, permission, realtime and write layer; this factory only publishes the
# `{component, params, events}` payload that `tgLoadElement` assigns onto the host
# element as DOM PROPERTIES. Properties, not attributes, is the whole trick:
# attributes stringify their values, so only properties carry nested objects and
# callbacks across the boundary intact. The React root mounts in light DOM, because
# a shadow root would sever the global stylesheet cascade and break `<use>`
# references into the sprite inlined in the document.
#
# The payload is a ONE-TIME HAND-OFF, not a state stream. `tgLoadElement` watches it
# by reference identity, so rebuilding it re-renders React on every digest while
# mutating it in place notifies nothing at all. `params` is therefore an honest
# construction-time snapshot and every value that has to stay current is also
# reachable through an accessor in `events`.
#
# Nothing that is not plain JSON may cross: persistent collections and models are
# flattened here, because a model carries the dirty-tracking state that makes
# changed-fields-only PATCH work. The AngularJS-side structures stay persistent on
# the scope, since out-of-scope consumers depend on their `.size` and `.getIn()`
# contracts.
#
# It is a factory rather than a directive because the controller injects it by this
# exact name; a directive would be published as `…Directive` and the injector would
# fail to link the whole view subtree.

# A copy with AngularJS's private `$$` bookkeeping removed, which is mandatory
# rather than cosmetic: `ng-repeat` without a `track by` stamps `$$hashKey` onto
# every object it iterates, and anything React freezes would then make the next
# repeat pass throw. `angular.toJson` is reused because it already drops `$$` keys
# at every depth and substitutes a sentinel for a window, a document or a scope,
# which makes passing one of those across the seam structurally impossible.
stripAngularPrivates = (value) ->
    return value if not angular.isObject(value)
    json = angular.toJson(value)
    return value if not json?
    return angular.fromJson(json)

# MEMO FOR THE PERSISTENT-COLLECTION BRANCH OF `toPlain` BELOW.
#
# WHY THIS EXISTS. The four board projections are read through live accessors in
# `events`, so `getUsByStatus()` and its siblings are called whenever React needs
# the current board -- and each call used to walk the whole projection twice, once
# to flatten it and once more through `angular.toJson`/`angular.fromJson`. On a
# real board that is O(board-size) allocation per read, and worse, EVERY read
# handed back a fresh deep object graph. Fresh identities are exactly what
# `React.memo` cannot see through, so the structural sharing that replaces
# immutable.js change detection (`P-IMMER-4`) was being thrown away at the seam
# that exists to preserve it.
#
# WHY KEYING ON SOURCE IDENTITY IS SOUND HERE, AND ONLY HERE. Every value reaching
# this cache is a PERSISTENT collection -- the branch is guarded on `.toJS()`
# existing. `taiga.defineImmutableProperty` (`app/coffee/utils.coffee:177-190`)
# refuses to publish anything else: its getter throws
# "defineImmutableProperty must return immutable data" for an object with no
# `.size`, which is what guarantees that `usByStatus`, `usMap`,
# `usByStatusSwimlanes` and `swimlanesList` (`main.coffee:144-154`) really are
# persistent. A persistent collection is never mutated in place: any change
# produces a NEW object. Its identity therefore IS its version, and that is the
# explicit invalidation -- a changed collection arrives as a cache MISS by
# construction, with no version counter to maintain and nothing to remember to
# call. `foldedSwimlane` qualifies for the same reason (`Immutable.Map` at
# `main.coffee:132`, replaced wholesale at `:680`).
#
# WHY THE OTHER TWO BRANCHES ARE DELIBERATELY NOT MEMOISED. A `$tgModel` instance
# mutates its own attributes in place (`base/model.coffee`), and a plain scope
# object can be mutated in place by AngularJS as well, so for those two the
# identity says nothing about the contents and a cache would serve a stale copy.
# They keep converting on every read, which is exactly what they do today: this
# change removes repeated work without changing what any value converts to.
#
# A `WeakMap` rather than a `Map`, so a superseded collection is collected with its
# copy and the cache cannot grow without bound over a long session. One per
# `build(ctrl)` call, so two screens never share it.
createImmutableSnapshotCache = () ->
    cache = new WeakMap()

    return (collection) ->
        cached = cache.get(collection)
        return cached if cached isnt undefined

        snapshot = stripAngularPrivates(collection.toJS())
        cache.set(collection, snapshot)
        return snapshot

# Flatten one value at the seam. Persistent collections expose `.toJS()`;
# `$tgModel` instances expose `.getAttrs()` (`base/model.coffee:48`). The order
# matters because a persistent collection has no `.getAttrs()` and a model has no
# `.toJS()`, so at most one branch can ever apply. Whatever the unwrapping
# produces is then copied and cleaned by `stripAngularPrivates` above. Plain
# scalars, including `0`, `false` and `""`, fall through untouched.
#
# The persistent branch answers from `snapshotOf`, so an unchanged collection is
# converted ONCE and every later read returns the same object -- see
# `createImmutableSnapshotCache` for why that is sound for this branch alone. The
# conversion itself is unchanged: the same `.toJS()`, the same deep copy and the
# same `$$`-stripping, on the same values.
toPlain = (snapshotOf, value) ->
    return value if not value?
    return snapshotOf(value) if angular.isFunction(value.toJS)
    return stripAngularPrivates(value.getAttrs()) if angular.isFunction(value.getAttrs)
    return stripAngularPrivates(value)

# Flatten a plain AngularJS array whose members may be models. Anything that is
# not an array -- most often a collection the async load chain has not populated
# yet -- becomes an empty array, so React never has to guard a `.map()`.
#
# The ARRAY itself is not memoised, and must not be: it is a plain JavaScript
# array on the scope, so AngularJS can push into it in place and its identity says
# nothing about its contents. Its persistent MEMBERS, if any, still come from the
# cache through `toPlain`.
toPlainList = (snapshotOf, list) ->
    return [] if not angular.isArray(list)
    return (toPlain(snapshotOf, item) for item in list)

toMyPermissions = (project) ->
    return [] if not project or not angular.isArray(project.my_permissions)
    return project.my_permissions.slice()

# Resolve the PLAIN USER-STORY ATTRIBUTES that the retained `moveUsToTop` reads --
# `us.id`, `us.status` and `us.swimlane` (`main.coffee:241-266`) -- out of whatever
# the React side hands over.
#
# ⭐ THIS EXISTS BECAUSE `moveToTopDropdown` CANNOT BE DELEGATED VERBATIM. The
# retained method is `@.moveUsToTop(us.toJS().model)` (`main.coffee:239-240`): it
# takes an IMMUTABLE card straight out of `usMap` and unwraps it in TWO steps --
# `.toJS()` for the persistent collection, then `.model` for the story attributes
# nested inside the card (`kanban-usertories.coffee:307` is where that member is
# written). §6 of the header flattens `usMap` AT THIS SEAM, so the value React
# holds is the ALREADY-`toJS()`-ed card and the first step has already happened.
# Calling the Immutable-only wrapper with it would throw
# `us.toJS is not a function` the first time a card's "move to top" action is
# used -- a crash inside the retained controller, reported from a line that names
# neither this file nor React. The SECOND unwrapping step is still required, and
# it is performed here.
#
# Accepts either shape so no call site can get it wrong: a flattened card, which
# carries `.model`, or the story attributes themselves. `moveUsToTop` and the
# `moveUs` it delegates to are safe with plain attributes -- `moveUs` re-resolves
# every live `$tgModel` by id at `main.coffee:695-696` -- which is why no model
# lookup is needed on this path, unlike the backlog seam.
toStoryAttrs = (card) ->
    return null if not angular.isObject(card)
    return card.model if angular.isObject(card.model)
    return card

# Register a React handler for an AngularJS event on the CONTROLLER'S scope and
# hand back AngularJS's own deregistration function.
#
# ⭐ THE WRAPPER IS THE POINT, NOT CEREMONY. `$scope.$on` invokes its listener as
# `(event, payloadArgs...)`, so passing a React handler straight through would (a)
# hand React AngularJS's event object -- which carries `targetScope` and
# `currentScope` references and would put a live `$scope` on the React side of the
# seam, the one thing §6 forbids most firmly -- and (b) SHIFT every real payload
# argument by one position, silently. The wrapper drops the event object and
# forwards only the payload, flattened by the seam's single `toPlain` helper so no
# persistent collection and no `$tgModel` can cross either.
#
# Returning the deregistration function is equally load-bearing: React MUST call
# it from its `useEffect` cleanup, and a leak here is silent -- it surfaces only as
# duplicated work after navigating away and back.
#
# The four events `app/react/kanban/hooks/useWipLimit.ts` subscribes to, matching
# the retired `KanbanWipLimitDirective` (`main.coffee:1097-1100`) event for event,
# all reach THIS scope:
#   * `redraw:wip` -- `@scope.$broadcast` on this very scope (`main.coffee:272`,
#     `:283`, `:429`, `:492`, `:724`); `$broadcast` fires the emitting scope's own
#     listeners as well as its descendants'.
#   * `kanban:us:move` -- `$rootscope.$broadcast` (`sortable.coffee:341`), which
#     propagates DOWN through this scope.
#   * `usform:new:success` / `usform:bulk:success` -- `$rootscope.$broadcast` from
#     the shared lightbox (`common/lightboxes.coffee:375`), same downward path.
# `$emit` would NOT be observable here, which is exactly why
# `app/react/bridge/useTranslate.ts` reaches the root scope through its own named
# accessor instead of through this channel.
registerAngularEvent = ($scope, eventName, handler) ->
    return angular.noop if not angular.isFunction(handler)

    deregister = $scope.$on eventName, (event, args...) ->
        handler.apply(null, (toPlain(arg) for arg in args))

    return deregister

# One prefix for every refusal this file can emit, so a denied action is greppable
# and cannot be mistaken for an application error.
DENIED_PREFIX = "[tgKanbanReactBridge]"

# Log a refusal WITHOUT logging what was refused beyond the permission name.
# Deliberately no ids, no story data, no user data and no project payload: a
# console diagnostic is readable by anyone with the page open, so it carries the
# rule that fired and nothing that could identify a record or a person.
denied = (action, reason) ->
    console.warn("#{DENIED_PREFIX} #{action} refused: #{reason}.")
    return false


#############################################################################
## AUTHORIZATION AT THE SEAM -- WHY IT LIVES HERE
##
## `.events` is assigned onto the host element as a DOM PROPERTY
## (`load-element.coffee:29-30`). Anything holding a reference to that element
## can therefore invoke any callback on it directly, with arguments of its own
## choosing, and nothing in React is in the call path. Hiding a React control is
## presentation, not protection.
##
## The incumbent markup gated each control declaratively, and those gates are
## reproduced here VERBATIM rather than reinvented -- same permission codenames,
## same service, same archived-project semantics:
##
##   `tg-check-permission="add_us"`   kanban-table.jade:34, :43 (also `ng-hide`
##                                    on an archived status)
##   `tg-check-permission="modify_us"` us-edit-popover.jade edit / move-to-top
##   `tg-check-permission="delete_us"` us-edit-popover.jade delete
##
## `tgCheckPermission` renders through `projectService.canEdit(permission)`
## (`common.coffee:86-89`), and `canEdit` is `false` for an ARCHIVED project
## before it even looks at the permission
## (`app/modules/services/project.service.coffee:107-110`):
##
##     isArchived: () -> @._project.get('archived_code')
##     canEdit: (permission) ->
##         return false if this.isArchived()
##         return this.hasPermission(permission)
##
## So delegating to `canEdit` gets BOTH gates from one call, and gets them LIVE:
## `tgProjectService` holds the current project, so a permission revoked or a
## project archived after this payload was built is honoured on the next call.
## Reading `$scope.project.my_permissions` instead would read a snapshot.
##
## The screen-level feature gate is checked too. `loadProject` (`main.coffee:663`
## -`:664`) sends the user to the permission-denied view when
## `is_kanban_activated` is false, but that only governs NAVIGATION; a callback
## invoked directly needs the check itself.
##
## Finally every id is resolved against the controller's OWN collections before
## it is used. `editUs`/`deleteUs` call `getUs(id).set(...)` and
## `changeUsAssignedUsers` calls `getUsModel(id)` (`main.coffee:374`, `:393`,
## `:435`), so an unknown id currently throws a raw TypeError from inside
## AngularJS; an id belonging to ANOTHER project would be worse, because it would
## be forwarded to a write. `usMap` is keyed by NUMERIC id
## (`kanban-usertories.coffee:64`, `:150`, `:282`-`:283`), which is why the
## helpers below normalise before looking up.
##
## WHAT IS DELIBERATELY NOT GATED, ENUMERATED SO THE OMISSION IS AUDITABLE:
##
##   * every `get*` accessor -- they expose exactly what the screen already
##     renders to the user who is looking at it, they perform no write, and
##     gating them would break the board for a viewer with read-only
##     permissions, which the incumbent supports;
##   * the view-state toggles `setZoom`, `toggleFold`, `toggleSwimlane`,
##     `toggleSelectedUs`, `cleanSelectedUss`, `toggleOpenFilter`, and the
##     `showPlaceHolder` / `isUsInArchivedHiddenStatus` predicates;
##   * the filter callbacks `changeQ`, `addFilter`, `removeFilter`,
##     `saveCustomFilter`, `selectCustomFilter`, `removeCustomFilter`.
##
## The last two groups do persist -- `toggleSwimlane` writes swimlane fold modes
## through `rs.kanban.storeSwimlanesModes` (`main.coffee:429`) and the custom
## filters go through `tgFilterRemoteStorageService` -- but what they persist is
## PER-USER interface preference, not project data: it is stored against the
## calling user, it changes nothing another member can observe, and the incumbent
## markup carries no permission attribute on any of these controls. Gating them
## would be a behaviour change, not a hardening (rule T10).
#############################################################################
KanbanReactBridgeFactory = (projectService) ->
    service = {}

    service.build = (ctrl) ->
        if not ctrl or not ctrl.scope
            # Throw rather than return a falsy payload: the watcher would never see a
            # truthy value, the host element would keep its default properties, and
            # the board would render empty with no error anywhere.
            throw new Error(
                "tgKanbanReactBridge.build() requires the KanbanController instance and its scope")

        $scope = ctrl.scope

        # One cache per screen, closed over by every accessor below, so a board
        # projection that has not changed is converted once and read back with a
        # STABLE identity for as long as it stands. See
        # `createImmutableSnapshotCache` for why source identity is a sound key for
        # the persistent branch and for no other. It holds nothing until the first
        # read and, being weakly keyed, releases each entry when the collection it
        # copied is superseded.
        snapshotOf = createImmutableSnapshotCache()

        # ---------------------------------------------------------------------
        # GUARD HELPERS. All four read LIVE state on every call, so a permission
        # revoked, a project archived or a story deleted after this payload was
        # built is honoured immediately. None of them throws: a refused action
        # returns a falsy value and warns, which is what a hidden control does
        # today -- nothing happens.
        # ---------------------------------------------------------------------

        # The screen-level feature gate of `main.coffee:663`-`:664`, evaluated
        # per call rather than once at load.
        kanbanEnabled = ->
            project = projectService.project
            return true if not project           # not loaded yet: no basis to refuse
            return project.get('is_kanban_activated') != false

        # `tgCheckPermission`'s own test (`common.coffee:88`), which is archived
        # -project-then-permission (`project.service.coffee:107`-`:110`).
        #
        # FAILS CLOSED WHEN THE PROJECT IS NOT LOADED. `projectService.project` is
        # null until `setProject` runs (`project.service.coffee:22`, `:77`), and a
        # mutation whose permission set is unknown cannot be authorised -- so it is
        # refused rather than allowed through. This is also what keeps `canEdit`
        # from being called on a null project, where `@._project.get(...)` would
        # throw. In practice the project is always loaded long before any user
        # interaction, because the board does not render without it.
        allowed = (action, permission) ->
            project = projectService.project
            return denied(action, "the project is not loaded yet") if not project
            return denied(action, "the kanban module is disabled for this project") if not kanbanEnabled()
            return true if projectService.canEdit(permission)
            return denied(action, "'#{permission}' is not granted, or the project is archived")

        # Resolve a user-story id against the controller's OWN map. Returns the
        # NORMALISED numeric id, or NULL when the id is not one this board holds --
        # which covers a malformed id, a stale id and an id from another project.
        # `usMap` is keyed by numeric id, so the coercion is required for the lookup
        # to hit at all.
        canonicalUsId = (action, usId) ->
            usMap = $scope.usMap
            if not usMap
                denied(action, "the board has no user-story map yet")
                return null
            id = Number(if angular.isObject(usId) then usId.id else usId)
            if not _.isFinite(id)
                denied(action, "the user-story id is not a number")
                return null
            if not usMap.get(id)
                denied(action, "that user story is not on this board")
                return null
            return id

        # Every id in a list, or null if ANY of them fails. All-or-nothing on
        # purpose: a partially validated list would still be written, and the write
        # is position-relative, so persisting a subset of a multi-card move
        # reorders the board in a way the user never asked for.
        canonicalUsIds = (action, usList) ->
            return null if not angular.isArray(usList) or usList.length == 0
            ids = []
            for us in usList
                id = canonicalUsId(action, us)
                return null if not id?
                ids.push(id)
            return ids

        # Whether a status id may be used. A NULLISH id is accepted and left
        # untouched: `addNewUs` is legitimately called with no status from the
        # toolbar. `requireOpen` additionally rejects an ARCHIVED status,
        # reproducing `ng-hide="s.is_archived"` on the two add controls
        # (`kanban-table.jade:35`, `:44`).
        isCanonicalStatusId = (action, statusId, requireOpen = false) ->
            return true if not statusId?
            byId = $scope.usStatusById
            return denied(action, "the board has no status map yet") if not byId
            id = Number(statusId)
            return denied(action, "the status id is not a number") if not _.isFinite(id)
            status = byId[id]
            return denied(action, "that status does not belong to this project") if not status
            return denied(action, "that status is archived") if requireOpen and status.is_archived
            return true

        # Whether a position anchor may be used. Anchors become
        # `after_userstory_id` / `before_userstory_id` on the bulk-order write
        # (`main.coffee:714`), so an anchor that is not on this board persists an
        # order nobody asked for, silently. Absent anchors are legitimate -- a move
        # to either end of a column has only one neighbour.
        isCanonicalAnchor = (action, anchorId) ->
            return true if not anchorId?
            return canonicalUsId(action, anchorId)?

        return {
            component: 'kanban-board'

            params: {
                sectionName: $scope.sectionName

                # Already a plain object: `loadProject` (`main.coffee:661`) stores
                # `@projectService.project.toJS()`. Flattened anyway so the seam
                # never depends on that staying true.
                project: toPlain(snapshotOf, $scope.project)
                myPermissions: toMyPermissions($scope.project)

                # Board taxonomies, sorted and grouped by the controller
                # (`main.coffee:669-672`).
                points: toPlainList(snapshotOf, $scope.points)
                pointsById: toPlain(snapshotOf, $scope.pointsById)
                usStatusList: toPlainList(snapshotOf, $scope.usStatusList)
                usStatusById: toPlain(snapshotOf, $scope.usStatusById)

                # The four persistent projections defined at `main.coffee:144-154`.
                # `kanbanUserstoriesService.reset()` runs first (`:128`), so all
                # four are real empty collections rather than `undefined`, and
                # `.toJS()` here yields `{}` / `[]` on the first frame.
                usByStatus: toPlain(snapshotOf, $scope.usByStatus)
                usByStatusSwimlanes: toPlain(snapshotOf, $scope.usByStatusSwimlanes)
                usMap: toPlain(snapshotOf, $scope.usMap)
                swimlanesList: toPlain(snapshotOf, $scope.swimlanesList)
                swimlanes: toPlainList(snapshotOf, $scope.swimlanes)
                swimlanesStatuses: toPlain(snapshotOf, $scope.swimlanesStatuses)

                # Fold state: a persistent `Map` at `main.coffee:132`, replaced
                # from stored modes at `:680`. Its persisted form is already plain
                # -- `:426` stores `@.foldedSwimlane.toJS()` -- so flattening here
                # hands React exactly the shape the server round-trips.
                foldedSwimlane: toPlain(snapshotOf, ctrl.foldedSwimlane)

                zoom: ctrl.zoom
                zoomLevel: ctrl.zoomLevel

                filterQ: ctrl.filterQ
                openFilter: ctrl.openFilter
                filters: toPlain(snapshotOf, ctrl.filters)
                selectedFilters: ctrl.selectedFilters or []
                customFilters: ctrl.customFilters or []
            }

            # Stable function references, so the payload keeps one identity for the
            # life of the screen. Accessors read live state on every call; actions
            # delegate to the controller and never reimplement it.
            events: {
                # --- project, taxonomies and permissions ----------------------
                getProject: => toPlain(snapshotOf, $scope.project)
                getProjectId: => $scope.projectId
                getMyPermissions: => toMyPermissions($scope.project)
                getPoints: => toPlainList(snapshotOf, $scope.points)
                getPointsById: => toPlain(snapshotOf, $scope.pointsById)
                getUsStatusList: => toPlainList(snapshotOf, $scope.usStatusList)
                getUsStatusById: => toPlain(snapshotOf, $scope.usStatusById)

                # --- board data: persistent on the scope, flattened here -------
                getUsByStatus: => toPlain(snapshotOf, $scope.usByStatus)
                getUsByStatusSwimlanes: => toPlain(snapshotOf, $scope.usByStatusSwimlanes)
                getUsMap: => toPlain(snapshotOf, $scope.usMap)
                getSwimlanes: => toPlainList(snapshotOf, $scope.swimlanes)
                getSwimlanesList: => toPlain(snapshotOf, $scope.swimlanesList)
                getSwimlanesStatuses: => toPlain(snapshotOf, $scope.swimlanesStatuses)
                getFoldedSwimlane: => toPlain(snapshotOf, ctrl.foldedSwimlane)

                getUsCardVisibility: => $scope.usCardVisibility or {}
                getZoom: => ctrl.zoom
                getZoomLevel: => ctrl.zoomLevel
                getZoomLoading: => ctrl.zoomLoading
                getInitialLoad: => ctrl.initialLoad
                getRenderInProgress: => ctrl.renderInProgress
                getNotFoundUserstories: => ctrl.notFoundUserstories
                getMovedUs: => ctrl.movedUs or []
                getSelectedUss: => ctrl.selectedUss or {}

                getFilterQ: => ctrl.filterQ
                getFilters: => toPlain(snapshotOf, ctrl.filters)
                getSelectedFilters: => ctrl.selectedFilters or []
                getCustomFilters: => ctrl.customFilters or []
                getOpenFilter: => ctrl.openFilter

                # `moveUs` keeps the controller's signature verbatim, including the
                # leading `ctx` -- the event object when it is driven from the event
                # bus, `null` when it is called directly. Its write is
                # position-relative: the two neighbour ids become
                # `after_userstory_id` / `before_userstory_id`, so an off-by-one in
                # the caller persists a wrong order with no error surface.
                moveUs: (ctx, usList, newStatusId, newSwimlaneId, index, previousCard, nextCard) =>
                    return if not allowed("moveUs", "modify_us")
                    return if not canonicalUsIds("moveUs", usList)?
                    return if not isCanonicalStatusId("moveUs", newStatusId)
                    return if not isCanonicalAnchor("moveUs", previousCard)
                    return if not isCanonicalAnchor("moveUs", nextCard)
                    ctrl.moveUs(ctx, usList, newStatusId, newSwimlaneId, index, previousCard, nextCard)
                moveUsToTop: (uss) =>
                    return if not allowed("moveUsToTop", "modify_us")
                    return if not canonicalUsIds("moveUsToTop", uss)?
                    ctrl.moveUsToTop(uss)

                # NOT a verbatim delegation, and `toStoryAttrs` above documents why in
                # full: the retained `moveToTopDropdown` unwraps an IMMUTABLE card with
                # `us.toJS().model` (`main.coffee:239-240`), and the value React holds
                # was already flattened at this seam, so calling it would throw. The
                # second unwrapping step is performed here and the plain attributes go
                # to `moveUsToTop`, which is the method the retained wrapper itself
                # calls -- so the behaviour is identical, not merely equivalent.
                moveToTopDropdown: (card) =>
                    return if not allowed("moveToTopDropdown", "modify_us")

                    story = toStoryAttrs(card)

                    if not story? or not story.id? or not story.status?
                        # Fail loudly at the seam rather than let an unusable value
                        # reach the controller, where the symptom would be an
                        # unreadable failure inside the board's ordering arithmetic.
                        throw new Error(
                            "tgKanbanReactBridge: moveToTopDropdown needs the flattened card " +
                            "or its story attributes, carrying `id` and `status`")

                    return if not canonicalUsId("moveToTopDropdown", story)?

                    ctrl.moveUsToTop(story)

                setZoom: (zoomLevel, zoom) => ctrl.setZoom(zoomLevel, zoom)

                toggleFold: (id) => ctrl.toggleFold(id)
                toggleSwimlane: (id) => ctrl.toggleSwimlane(id)
                toggleSelectedUs: (usId) => ctrl.toggleSelectedUs(usId)
                cleanSelectedUss: => ctrl.cleanSelectedUss()
                showPlaceHolder: (statusId, swimlaneId) => ctrl.showPlaceHolder(statusId, swimlaneId)
                isUsInArchivedHiddenStatus: (usId) => ctrl.isUsInArchivedHiddenStatus(usId)

                # `type` is "standard" or "bulk" (`main.coffee:362-372`); both open
                # the existing shared lightboxes, which stay AngularJS. Gated on
                # `add_us` and on the status being an OPEN status of this project,
                # reproducing `tg-check-permission="add_us"` together with
                # `ng-hide="s.is_archived"` (`kanban-table.jade:34-35`, `:43-44`).
                # The original `statusId` is forwarded byte-for-byte once validated,
                # including when it is absent, because the lightbox payload
                # distinguishes absent from present.
                addNewUs: (type, statusId) =>
                    return if not allowed("addNewUs", "add_us")
                    return if not isCanonicalStatusId("addNewUs", statusId, true)
                    ctrl.addNewUs(type, statusId)
                # `modify_us`: `us-edit-popover.jade` gates the edit control with it.
                # The id is resolved first because `main.coffee:374` calls
                # `getUs(id).set(...)`, which throws a raw TypeError on an unknown id.
                editUs: (id) =>
                    return if not allowed("editUs", "modify_us")
                    return if not canonicalUsId("editUs", id)?
                    ctrl.editUs(id)
                # `delete_us`, its own permission -- NOT `modify_us`
                # (`us-edit-popover.jade` delete control).
                deleteUs: (id) =>
                    return if not allowed("deleteUs", "delete_us")
                    return if not canonicalUsId("deleteUs", id)?
                    ctrl.deleteUs(id)
                # Reassignment is a write to the story: `modify_us`. `main.coffee:435`
                # calls `getUsModel(id)` and then `repo.save`, so an unresolvable id
                # would throw before the save.
                changeUsAssignedUsers: (id) =>
                    return if not allowed("changeUsAssignedUsers", "modify_us")
                    return if not canonicalUsId("changeUsAssignedUsers", id)?
                    ctrl.changeUsAssignedUsers(id)

                # Read paths. No permission gate -- the incumbent shows the archived
                # column to anyone who can see the board, and gating reads would
                # break a read-only member's view. The FEATURE gate and the canonical
                # status id are still enforced: the id reaches a query
                # (`main.coffee:607`-`:632`) and a broadcast, so an id from another
                # project must not be forwarded.
                loadUserstories: => ctrl.loadUserstories()
                loadUserStoriesForStatus: (ctx, statusId) =>
                    return if not kanbanEnabled()
                    return if not isCanonicalStatusId("loadUserStoriesForStatus", statusId)
                    ctrl.loadUserStoriesForStatus(ctx, statusId)
                hideUserStoriesForStatus: (ctx, statusId) =>
                    return if not kanbanEnabled()
                    return if not isCanonicalStatusId("hideUserStoriesForStatus", statusId)
                    ctrl.hideUserStoriesForStatus(ctx, statusId)
                loadSwimlanes: => ctrl.loadSwimlanes()

                changeQ: (q) => ctrl.changeQ(q)
                addFilter: (newFilter) => ctrl.addFilter(newFilter)
                removeFilter: (filter) => ctrl.removeFilter(filter)
                saveCustomFilter: (name) => ctrl.saveCustomFilter(name)
                selectCustomFilter: (filter) => ctrl.selectCustomFilter(filter)
                removeCustomFilter: (filter) => ctrl.removeCustomFilter(filter)

                toggleOpenFilter: => ctrl.openFilter = !ctrl.openFilter

                # --- the AngularJS -> React event channel ---------------------
                # `params`/`events` are a ONE-TIME hand-off (§5), so this is the only
                # way React observes an AngularJS-side broadcast. It is required, not
                # optional: `app/react/kanban/hooks/useWipLimit.ts` takes a
                # `registerEvent(eventName, handler) => deregister` seam and subscribes
                # to `redraw:wip`, `kanban:us:move`, `usform:new:success` and
                # `usform:bulk:success` -- the same four the retired
                # `KanbanWipLimitDirective` used (`main.coffee:1097-1100`) -- so WIP
                # marker redraw parity is unreachable without it.
                #
                # Registered on the controller's own scope, with the Angular event
                # object stripped and the payload flattened; returns AngularJS's own
                # deregistration function, which React MUST invoke from its
                # `useEffect` cleanup. See `registerAngularEvent` above for the
                # argument-shifting and `$scope`-leak hazards this closes, and for the
                # proof that all four events reach this scope.
                #
                # Other names React may legitimately observe on this screen, all
                # emitted from this module: `kanban:userstories:loaded`
                # (`main.coffee:698`), `usform:edit:success`, `usform:bulk:success`,
                # `usform:new:success`, `redraw:wip`, `kanban:us:move`, and the shared
                # `filters:update`. A React handler must never call
                # `$rootScope.$apply()`: these handlers already run inside a digest.
                onAngularEvent: (eventName, handler) =>
                    registerAngularEvent($scope, eventName, handler)
            }
        }

    return service

# The array annotation is REQUIRED now that the factory takes an injectable:
# `gulpfile.js` minifies the concatenated bundle for a deploy build, and a
# minifier renames the parameter, after which AngularJS's implicit annotation
# would ask the injector for a one-letter provider and abort linking the whole
# `ng-view` subtree. `main.coffee:730` registers its controller without one only
# because that controller carries its own `@.$inject` list.
module.factory("tgKanbanReactBridge", ["tgProjectService", KanbanReactBridgeFactory])
