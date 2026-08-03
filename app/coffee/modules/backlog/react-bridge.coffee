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

# The AngularJS -> React seam for the Backlog / Sprint-Planning screen.
# `BacklogController` remains the data, permission and drag-serialisation layer;
# this directive only publishes the `{component, params, events}` object that
# `tgLoadElement` assigns onto the host element as DOM PROPERTIES. Properties, not
# attributes, is the whole trick: attributes stringify their values, so only
# properties carry nested objects and callbacks across the boundary intact. The
# React root mounts in light DOM, because a shadow root would sever the global
# stylesheet cascade and break `<use>` references into the sprite inlined in the
# document.
#
# `params` is a set-once bootstrap snapshot and `events` is a stable set of
# accessors and delegations, because the object is built once and watched by
# reference identity -- rebuilding it re-mounts React and mutating it in place
# notifies nothing at all.
#
# Nothing that is not plain JSON may cross the seam: persistent collections and
# models are flattened below, because a model carries the dirty-tracking state that
# makes changed-fields-only PATCH work. This file carries no copy, no markup and no
# colour; status, tag and epic colours are per-project data and are never handed
# over as literals.

# Flatten at the boundary: persistent collections through `toJS`, models through
# `getAttrs`, and anything already plain by identity -- returning the same reference
# for a plain value keeps React's reference equality intact, so wrapping a
# known-plain getter costs nothing.
toPlain = (value) ->
    return value if not value?
    return value.toJS() if angular.isFunction(value.toJS)
    return value.getAttrs() if angular.isFunction(value.getAttrs)
    return value

toPlainList = (list) -> _.map(list or [], toPlain)

# Sprints are the one nested case at this seam: a milestone model's `user_stories`
# are themselves models and `getAttrs` is shallow, so without this step the nested
# stories would still cross as class instances.
toPlainSprint = (sprint) ->
    plain = toPlain(sprint)
    return plain if not plain? or not _.isArray(plain.user_stories)
    return _.assign({}, plain, {user_stories: toPlainList(plain.user_stories)})

toPlainSprintList = (sprints) -> _.map(sprints or [], toPlainSprint)

toPlainSprintMap = (sprintsById) -> _.mapValues(sprintsById or {}, toPlainSprint)

# Register a React handler for an AngularJS event on the CONTROLLER'S scope and hand
# back AngularJS's own deregistration function.
#
# ⭐ THE WRAPPER IS WHY THIS IS A FUNCTION RATHER THAN A ONE-LINE DELEGATION.
# `$scope.$on` invokes its listener as `(event, payloadArgs...)`. Passing the React
# handler straight through would hand React AngularJS's EVENT OBJECT as argument 1 --
# and that object carries `targetScope` and `currentScope`, so a live `$scope` would
# cross the seam, which point 6 of the header forbids -- while simultaneously SHIFTING
# every real payload argument by one position with no error raised. The wrapper drops
# the event object and forwards only the payload, each value through this seam's single
# `toPlain` helper so no `$tgModel` and no persistent collection crosses either.
#
# Returning the deregistration function is equally load-bearing: React MUST invoke it
# from its `useEffect` cleanup, and a leak here is SILENT -- it surfaces only as
# duplicated refreshes after navigating away and back.
#
# A non-function handler yields `angular.noop` rather than letting AngularJS accept it
# and throw later, at broadcast time, from a line that names neither this file nor the
# React caller.
registerAngularEvent = ($scope, eventName, handler) ->
    return angular.noop if not angular.isFunction(handler)

    deregister = $scope.$on eventName, (event, args...) ->
        handler.apply(null, (toPlain(arg) for arg in args))

    return deregister

# One prefix for every refusal this file can emit, so a denied action is greppable
# and cannot be mistaken for an application error.
DENIED_PREFIX = "[tgBacklogReactBridge]"

# Log a refusal WITHOUT logging what was refused beyond the permission name.
# Deliberately no ids, no story data, no user data and no project payload: a
# console diagnostic is readable by anyone with the page open, so it carries the
# rule that fired and nothing that could identify a record or a person.
denied = (action, reason) ->
    console.warn("#{DENIED_PREFIX} #{action} refused: #{reason}.")
    return false

BacklogReactBridgeDirective = ($rootScope, projectService) ->
    link = ($scope, $el, $attrs) ->
        # Resolving the controller with no argument checks this element and then walks
        # ancestors, so the directive works both on the element carrying
        # `ng-controller` and on a host nested inside it. Neither position is assumed.
        $ctrl = $el.controller()

        if not $ctrl
            console.error("tgBacklogReactBridge must have access to BacklogCtrl")
            return

        # Re-hydration. React only ever holds the flattened data this seam produced,
        # but two consumers reached through `events` still need the live model: the
        # repository's delete reads the model's own id and name attributes, and the
        # sprint edit path clones the model. Both helpers below accept an id or an
        # object and fall back to whatever the caller supplied, so handing a live model
        # straight through still works and a missed lookup cannot break a call site.
        idOf = (value) ->
            return null if not value?
            return value.id if _.isObject(value)
            return value

        # Every collection a backlog story can legitimately live in. A story assigned to
        # a sprint is NOT in `$scope.userstories` -- it lives in that sprint's
        # `user_stories` (`resources/sprints.coffee:33-35`) -- so searching only the
        # backlog would have refused every sprint row, and a story dragged out of a
        # CLOSED sprint once those are loaded (`main.coffee:355-371`) would have been
        # missed as well. The `taiga.groupBy` maps hold the same model instances as the
        # arrays (`utils.coffee:80-85`), so both are read and neither needs flattening.
        userStoryModelLists = ->
            lists = [$scope.userstories or []]

            for collection in [($scope.sprints or []), ($scope.closedSprints or [])]
                continue if not _.isArray(collection)
                for sprint in collection
                    continue if not sprint? or not _.isArray(sprint.user_stories)
                    lists.push(sprint.user_stories)

            for map in [$scope.sprintsById, $scope.closedSprintsById]
                continue if not map?
                for own _sprintId, sprint of map
                    lists.push(sprint.user_stories) if sprint? and _.isArray(sprint.user_stories)

            return lists

        # Re-hydration to the LIVE model, or nothing. Returning the caller's own object
        # when the id is unknown would let a value React composed reach a queue that
        # mutates, splices and reconciles live `$tgModel`s (`main.coffee:601-602`,
        # `:643`, `:648-649`, `:670`, `:689-695`), so an unknown id is a refusal.
        findUserStoryById = (id) ->
            for list in userStoryModelLists()
                found = _.find(list, (it) -> it? and it.id == id)
                return found if found?

            return null

            for sprint in ($scope.sprints or []).concat($scope.closedSprints or [])
                continue if not sprint or not _.isArray(sprint.user_stories)
                found = _.find(sprint.user_stories, (it) -> it? and it.id == id)
                return found if found

            return null

        resolveUserStory = (action, us) ->
            id = idOf(us)
            if not id?
                denied(action, "no user story was identified")
                return null
            found = findUserStoryById(id)
            if not found
                denied(action, "that user story is not on this screen")
                return null
            return found

        resolveSprint = (action, sprint) ->
            id = idOf(sprint)
            if not id?
                denied(action, "no sprint was identified")
                return null
            found = ($scope.sprintsById or {})[id] or ($scope.closedSprintsById or {})[id]
            if not found
                denied(action, "that sprint does not belong to this project")
                return null
            return found

        # Every story in a list, or null if ANY of them fails. All-or-nothing,
        # because the ordering write is POSITION-RELATIVE: persisting a subset of a
        # multi-row move reorders the backlog in a way nobody asked for, and the
        # endpoint reports no error for it.
        resolveUserStories = (action, usList) ->
            list = if _.isArray(usList) then usList else [usList]
            if list.length == 0
                denied(action, "no user stories were identified")
                return null
            resolved = []
            for us in list
                found = resolveUserStory(action, us)
                return null if not found
                resolved.push(found)
            return resolved

        # ---------------------------------------------------------------------
        # AUTHORIZATION. The incumbent gated each control declaratively and those
        # gates are reproduced here VERBATIM -- same codenames, same service:
        #
        #   add_us           `addnewus.jade:12`, `:20`, `backlog.jade:184`
        #   modify_us        `backlog-row.jade:12`, `:16`, `:19`, `:64`, `:70`,
        #                    `backlog-table.jade:10`, `:11`, `sprint.jade:21`,
        #                    `us-edit-popover.jade` edit / move-to-top
        #   delete_us        `us-edit-popover.jade` delete
        #   add_milestone    `backlog.jade:111` (add sprint), `:121` (velocity),
        #                    `sprints.jade:21`, `:36`
        #   modify_milestone the sprint edit path (`sprints.coffee:49-53`)
        #
        # `tgCheckPermission` renders through `projectService.canEdit(permission)`
        # (`common.coffee:86-89`), and `canEdit` returns false for an ARCHIVED
        # project BEFORE it looks at the permission at all
        # (`project.service.coffee:107-110`). Delegating to it therefore reproduces
        # both gates from one call, and reproduces them LIVE rather than from the
        # snapshot in `params`.
        #
        # THE ARCHIVED CHECK IS THE ONE THAT CANNOT BE LEFT TO THE SERVER. The
        # unchanged backlog bulk-order endpoint enforces `modify_us` and the blocked
        # state but NOT the archived state, so a member who legitimately retains
        # `modify_us` on an archived project can still reorder it through a direct
        # `.events` call unless the client refuses -- which is exactly what the
        # hidden controls do today.
        #
        # WHAT IS DELIBERATELY NOT GATED, ENUMERATED SO THE OMISSION IS AUDITABLE:
        # every `get*` accessor; the `load*` reads plus `openSprints`,
        # `sprintTotalPoints`, `findCurrentSprint` and `calculateForecasting`; the
        # view-state toggles `toggleTags`, `toggleShowTags`, `toggleActiveFilters`;
        # the filter callbacks `changeQ`, `addFilterBacklog`, `removeFilterBacklog`,
        # `saveCustomFilter`, `selectCustomFilter`, `removeCustomFilter`; and
        # `onAngularEvent`, which only registers a listener on the controller's own
        # scope. The reads expose what the screen already renders to the user
        # looking at it, and gating them would break the screen for a read-only
        # member, which the incumbent supports. The toggles and filters do persist,
        # but what they persist is PER-USER interface preference stored against the
        # calling user -- nothing another member can observe -- and the incumbent
        # markup carries no permission attribute on any of those controls, so
        # gating them would be a behaviour change rather than a hardening (T10).
        # ---------------------------------------------------------------------

        # The screen-level feature gate of `main.coffee:518`-`:519`, evaluated per
        # call: that check governs NAVIGATION only, so a callback invoked directly
        # needs it again.
        backlogEnabled = ->
            project = projectService.project
            return true if not project           # not loaded yet: no basis to refuse
            return project.get('is_backlog_activated') != false

        # FAILS CLOSED WHEN THE PROJECT IS NOT LOADED. `projectService.project` is
        # null until `setProject` runs (`project.service.coffee:22`, `:77`), and a
        # mutation whose permission set is unknown cannot be authorised -- so it is
        # refused rather than allowed through. This also keeps `canEdit` from being
        # called on a null project, where `@._project.get(...)` would throw. In
        # practice this payload is only built inside `bindOnce $scope, "project"`,
        # so the project is loaded before any callback here can be reached.
        allowed = (action, permission) ->
            project = projectService.project
            return denied(action, "the project is not loaded yet") if not project
            return denied(action, "the backlog module is disabled for this project") if not backlogEnabled()
            return true if projectService.canEdit(permission)
            return denied(action, "'#{permission}' is not granted, or the project is archived")

        bindOnce $scope, "project", (project) ->
            return if not project

            # Build once: the watch is reference-identity, so reassigning this re-mounts
            # React. The guard also holds the invariant if the directive is ever placed
            # on more than one element under the same controller.
            return if $ctrl.reactScreen

            $ctrl.reactScreen = {
                component: 'backlog-screen'

                params: {
                    projectId: $scope.projectId
                    project: toPlain($scope.project)
                    sectionName: 'backlog'
                    points: toPlainList($scope.points)
                    pointsById: toPlain($scope.pointsById)
                    usStatusById: toPlain($scope.usStatusById)
                    usStatusList: toPlainList($scope.usStatusList)
                    closedMilestones: $scope.closedMilestones
                    swimlanesList: toPlain($scope.swimlanesList)
                }

                events: {
                    getProject: => toPlain($scope.project)
                    getUserStories: => toPlainList($scope.userstories)
                    getVisibleUserStories: => $scope.visibleUserStories
                    getSprints: => toPlainSprintList($scope.sprints)
                    getClosedSprints: => toPlainSprintList($scope.closedSprints)
                    getSprintsById: => toPlainSprintMap($scope.sprintsById)
                    getClosedSprintsById: => toPlainSprintMap($scope.closedSprintsById)
                    getStats: => toPlain($scope.stats)
                    getShowGraphPlaceholder: => $scope.showGraphPlaceholder
                    getSwimlanes: => toPlain($scope.swimlanesList)
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
                    getDisablePagination: => $ctrl.disablePagination
                    getFirstLoadComplete: => $ctrl.firstLoadComplete
                    getPointsById: => toPlain($scope.pointsById)
                    getUsStatusById: => toPlain($scope.usStatusById)

                    # Exposed verbatim -- arguments are not wrapped, reordered,
                    # deferred, debounced or simplified -- because the FIFO queue and
                    # its re-entrancy guard live in the controller and depend on `ctx`
                    # being truthy for a user-initiated move and falsy for the
                    # queue-drain re-drive. The two neighbours are mutually exclusive at
                    # the source: the endpoint receives one anchor, never both.
                    moveUs: (ctx, usList, newUsIndex, newSprintId, previousUs, nextUs) =>
                        return if not allowed("moveUs", "modify_us")
                        resolved = resolveUserStories("moveUs", usList)
                        return if not resolved
                        return if newSprintId? and not resolveSprint("moveUs", newSprintId)
                        return if previousUs? and not resolveUserStory("moveUs", previousUs)
                        return if nextUs? and not resolveUserStory("moveUs", nextUs)
                        return $ctrl.moveUs(ctx, resolved, newUsIndex, newSprintId, previousUs, nextUs)

                    moveUsToTopOfBacklog: (uss) =>
                        return if not allowed("moveUsToTopOfBacklog", "modify_us")
                        resolved = resolveUserStories("moveUsToTopOfBacklog", uss)
                        return if not resolved
                        # Re-wrapped as an array only when the caller passed one, so
                        # `main.coffee:558`-`:559`'s own normalisation still sees the
                        # shape it expects.
                        $ctrl.moveUsToTopOfBacklog(if _.isArray(uss) then resolved else resolved[0])
                    loadUserstories: (resetPagination, pageSize) =>
                        return $ctrl.loadUserstories(resetPagination, pageSize)

                    loadAllPaginatedUserstories: => $ctrl.loadAllPaginatedUserstories()
                    loadSprints: => $ctrl.loadSprints()
                    loadClosedSprints: => $ctrl.loadClosedSprints()
                    unloadClosedSprints: => $ctrl.unloadClosedSprints()
                    loadProjectStats: => $ctrl.loadProjectStats()
                    loadSwimlanes: => $ctrl.loadSwimlanes()
                    openSprints: => toPlainSprintList($ctrl.openSprints())
                    sprintTotalPoints: (sprint) => $ctrl.sprintTotalPoints(sprint)
                    findCurrentSprint: => toPlainSprint($ctrl.findCurrentSprint())
                    calculateForecasting: => $ctrl.calculateForecasting()
                    # Gated by `add_milestone` at `backlog.jade:120-121`.
                    toggleVelocityForecasting: =>
                        return if not allowed("toggleVelocityForecasting", "add_milestone")
                        $ctrl.toggleVelocityForecasting()
                    toggleTags: => $ctrl.toggleTags()
                    toggleShowTags: => $ctrl.toggleShowTags()
                    toggleActiveFilters: => $ctrl.toggleActiveFilters()
                    # 'standard' broadcasts `genericform:new`, 'bulk' broadcasts
                    # `usform:bulk` (`main.coffee:764-772`); gated by `add_us`
                    # (`addnewus.jade:12`, `:20`).
                    addNewUs: (type) =>
                        return if not allowed("addNewUs", "add_us")
                        $ctrl.addNewUs(type)
                    # `add_milestone` (`backlog.jade:111`, `sprints.jade:21`, `:36`).
                    addNewSprint: =>
                        return if not allowed("addNewSprint", "add_milestone")
                        $ctrl.addNewSprint()
                    # ⭐ THE PROJECT IS TAKEN FROM SCOPE, NEVER FROM THE CALLER. The
                    # controller passes its first argument straight to
                    # `rs.userstories.getByRef(projectId, ref)` and then to
                    # `rs2.attachments.list("us", us.id, projectId)`
                    # (`main.coffee:735`-`:736`), so a caller-supplied project id made
                    # this callback a reference-resolution probe against ANY project
                    # id the reader could think of. The incumbent markup never had
                    # that latitude: `us-edit-popover.jade` binds `us.project`, which
                    # is by construction the project on screen. The parameter is kept
                    # in the signature so the React call site stays a faithful port of
                    # that markup, and it is IGNORED -- the value used is
                    # `$scope.projectId` (`main.coffee:520`).
                    editUserStory: (projectId, ref, $event) =>
                        return if not allowed("editUserStory", "modify_us")
                        return $ctrl.editUserStory($scope.projectId, ref, $event)

                    # `delete_us`, its own permission -- NOT `modify_us`
                    # (`us-edit-popover.jade` delete control). Resolved strictly: an
                    # unresolvable story is refused rather than forwarded, because the
                    # argument reaches `$tgRepo.remove()`.
                    deleteUserStory: (us) =>
                        return if not allowed("deleteUserStory", "delete_us")
                        resolved = resolveUserStory("deleteUserStory", us)
                        return if not resolved
                        $ctrl.deleteUserStory(resolved)
                    # Called after an inline status change, which is a write to the
                    # story: `modify_us` (`backlog-row.jade:64`).
                    updateUserStoryStatus: =>
                        return if not allowed("updateUserStoryStatus", "modify_us")
                        $ctrl.updateUserStoryStatus()
                    # From `UsFiltersMixin` (`controllerMixins.coffee:183`).
                    changeQ: (q) => $ctrl.changeQ(q)
                    addFilterBacklog: (newFilter) => $ctrl.addFilterBacklog(newFilter)
                    removeFilterBacklog: (filter) => $ctrl.removeFilterBacklog(filter)
                    saveCustomFilter: (name) => $ctrl.saveCustomFilter(name)
                    selectCustomFilter: (filter) => $ctrl.selectCustomFilter(filter)
                    removeCustomFilter: (filter) => $ctrl.removeCustomFilter(filter)
                    editSprint: (sprint) =>
                        return if not allowed("editSprint", "modify_milestone")
                        resolved = resolveSprint("editSprint", sprint)
                        return if not resolved
                        return $rootScope.$broadcast("sprintform:edit", resolved)

                    # The only channel by which React observes AngularJS-side
                    # broadcasts, since `params` and `events` are a one-way hand-off.
                    # It returns the deregistration function, which the caller must
                    # invoke on teardown. Handlers already run inside a digest.
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
                    #
                    # ⭐ THE HANDLER IS WRAPPED, NOT PASSED THROUGH, and the wrapper is
                    # load-bearing on two counts. `$scope.$on` invokes its listener as
                    # `(event, payloadArgs...)`, so handing the React handler over
                    # directly would:
                    #   (a) make ARGUMENT 1 AngularJS's own event object -- which carries
                    #       `targetScope` and `currentScope` references and so would put a
                    #       live `$scope` on the React side of the seam, the one thing
                    #       point 6 of the header forbids most firmly; and
                    #   (b) SHIFT every real payload argument by one position, silently.
                    #       A handler written against `(sprint)` would receive the event
                    #       object instead and read `undefined` off it -- no error, no
                    #       warning, just a value that is never there.
                    # `registerAngularEvent` below drops the event object and forwards
                    # only the payload, flattened by this seam's own `toPlain` so no
                    # `$tgModel` and no persistent collection can cross either, and it
                    # returns AngularJS's deregistration function unchanged.
                    # -----------------------------------------------------------
                    onAngularEvent: (eventName, handler) =>
                        registerAngularEvent($scope, eventName, handler)
                }
            }

    return {link: link}

module.directive("tgBacklogReactBridge", ["$rootScope", "tgProjectService", BacklogReactBridgeDirective])

