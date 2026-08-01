###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

taiga = @.taiga

mixOf = @.taiga.mixOf
toggleText = @.taiga.toggleText
scopeDefer = @.taiga.scopeDefer
bindOnce = @.taiga.bindOnce
groupBy = @.taiga.groupBy
timeout = @.taiga.timeout
bindMethods = @.taiga.bindMethods
debounceLeading = @.taiga.debounceLeading

module = angular.module("taigaKanban")

#############################################################################
## AngularJS / React coexistence seam (strangler-fig migration)
##
## The `taigaKanban` module is RETRIEVED on the line above, never re-declared, and
## that retrieval must NEVER gain a second argument. The declaring call -- the one
## that passes an empty dependency array -- is owned by
## `app/coffee/modules/kanban.coffee:9`, and passing `[]` from here as well would
## RESET the module. `paths.coffee_order` in `gulpfile.js` concatenates
## `coffee/modules/taskboard/*.coffee` (L147) BEFORE
## `coffee/modules/kanban/*.coffee` (L148), so a reset here would silently detach
## the OUT-OF-SCOPE taskboard's `tgTaskboardIssues`
## (`taskboard/taskboard-issues.coffee:81`) and `tgTaskboardTasks`
## (`taskboard/taskboard-tasks.coffee:157`) services at bootstrap.
## `admin/lightboxes.coffee:13` retrieves this same module as well.
##
## The Kanban board's markup is now rendered by the React tree under
## `app/react/kanban/**`, mounted through the `tg-react-loader` custom element and
## fed by `app/coffee/modules/kanban/react-bridge.coffee`. Accordingly the SEVEN
## view-layer directives this file used to register -- `tgKanban`,
## `tgKanbanArchivedShowStatusHeader`, `tgKanbanArchivedStatusIntro`,
## `tgKanbanSquishColumn`, `tgKanbanWipLimit`, `tgKanbanSwimlane` and
## `tgKanbanTaskboardColumn` -- are retired below. Only the REGISTRATION CALLS are
## removed: every factory function is deliberately LEFT IN PLACE as the
## authoritative behavioural reference for its React successor, because these
## bodies are the specification for the WIP-limit arithmetic, the virtualisation
## latch, the archived-column lifecycle, the sticky-header geometry and the
## drag-hover auto-open. See the retirement note above each factory. The net effect
## is that this file now registers a controller and no directives.
##
## `KanbanController` is RETAINED IN FULL, registration unchanged. It remains the
## data and permission layer behind the React board: every `$tgResources` call, the
## two realtime subscriptions and the `is_kanban_activated` gate are REUSED rather
## than rebuilt, so `/api/v1/`, the WebSocket routing keys and `$tgModel`'s
## changed-fields-only PATCH semantics are all untouched by this migration. React
## therefore never opens its own transport and never calls `$rootScope.$apply()`.
##
## `tgCardAssignedTo`, `tgCardData` and `tgCardActions` are NOT retired: they moved
## verbatim to `app/coffee/modules/kanban/card-directives.coffee`, still registered
## on this same module under identical names, because the shared out-of-scope
## `tg-card` component depends on them. See the note at the removal point below.
#############################################################################

#############################################################################
## Kanban Controller
#############################################################################

class KanbanController extends mixOf(taiga.Controller, taiga.PageMixin, taiga.FiltersMixin, taiga.UsFiltersMixin)
    excludeFilters: [
        "status"
    ]

    @.$inject = [
        "$scope",
        "$rootScope",
        "$tgRepo",
        "$tgConfirm",
        "$tgResources",
        "tgResources",
        "$routeParams",
        "$q",
        "$tgLocation",
        "tgAppMetaService",
        "$tgNavUrls",
        "$tgEvents",
        "$tgAnalytics",
        "$translate",
        "tgErrorHandlingService",
        "$tgModel",
        "tgKanbanUserstories",
        "$tgStorage",
        "tgFilterRemoteStorageService",
        "tgProjectService",
        "tgLightboxFactory",
        "tgLoader",
        "$timeout",
        # React coexistence: appended as the 24th and LAST entry, on purpose.
        # `$inject` maps POSITIONALLY onto the constructor parameters below, so
        # inserting anywhere other than the end would silently misbind every
        # service after the insertion point -- no error, just wrong objects.
        # `tgKanbanReactBridge` is registered on this same `taigaKanban` module by
        # `app/coffee/modules/kanban/react-bridge.coffee` and exposes a single
        # builder, `build(ctrl)`, returning the `{component, params, events}`
        # contract that `tgLoadElement` hands to the `tg-react-loader` element.
        "tgKanbanReactBridge"
    ]

    storeCustomFiltersName: 'kanban-custom-filters'
    storeFiltersName: 'kanban-filters'
    validQueryParams: [
        'exclude_tags',
        'tags',
        'exclude_assigned_users',
        'assigned_users',
        'exclude_role',
        'role',
        'exclude_epic',
        'epic',
        'exclude_owner',
        'owner'
    ]

    constructor: (@scope, @rootscope, @repo, @confirm, @rs, @rs2, @params, @q, @location,
                  @appMetaService, @navUrls, @events, @analytics, @translate, @errorHandlingService,
                  @model, @kanbanUserstoriesService, @storage, @filterRemoteStorageService,
                  @projectService, @lightboxFactory, @tgLoader, @timeout, @reactBridge) ->
        bindMethods(@)
        @kanbanUserstoriesService.reset()
        @.openFilter = false
        @.selectedUss = {}
        @.movedUs = []
        @.foldedSwimlane = Immutable.Map()
        @.isFirstLoad = true
        @.renderBatching = true

        @.isLightboxOpened = false # True when a lighbox is open
        @.isRefreshNeeded = false  # True if a lighbox is open and some event arrived

        return if @.applyStoredFilters(@params.pslug, "kanban-filters", @.validQueryParams)

        @scope.sectionName = @translate.instant("KANBAN.SECTION_NAME")
        @.initializeEventHandlers()

        taiga.defineImmutableProperty @.scope, "usByStatus", () =>
            return @kanbanUserstoriesService.usByStatus

        taiga.defineImmutableProperty @.scope, "usMap", () =>
            return @kanbanUserstoriesService.usMap

        taiga.defineImmutableProperty @.scope, "usByStatusSwimlanes", () =>
            return @kanbanUserstoriesService.usByStatusSwimlanes

        taiga.defineImmutableProperty @.scope, "swimlanesList", () =>
            return @kanbanUserstoriesService.swimlanesList

        # MIGRATION NOTE (AngularJS/React coexistence seam): built exactly ONCE,
        # here, and never rebuilt. `app/partials/kanban/kanban.jade` hosts
        # `tg-react-loader(tg-load-element="ctrl.reactBoard")`. The UNMODIFIED
        # `tgLoadElement` directive (`app/coffee/modules/base/load-element.coffee`
        # L17-L39, on the `taigaBase` module) assigns `.component`, `.params` and
        # `.events` onto that custom element as DOM PROPERTIES rather than
        # attributes, which is the whole trick: attributes stringify their values
        # whereas properties do not, so nested objects and callback functions cross
        # the framework boundary structurally intact. The host element in
        # `app/react/bridge/ReactHostElement.ts` reads those three properties and
        # mounts the React root in LIGHT DOM -- never a shadow root, which would
        # sever the global Sass cascade and break `<use href="#icon-...">` against
        # the sprite inlined into the document.
        #
        # WHY THIS MUST NOT BE REBUILT: that directive's `$watch` (its L19) takes NO
        # third argument, so `objectEquality` is false and it compares by IDENTITY.
        # Re-running `build(@)` on any digest-frequency path would make the watcher
        # fire every digest, re-assign the DOM properties and re-render the React
        # root continuously. Fresh data reaches React through the bridge's own
        # accessors, not by replacing this object.
        #
        # It is assigned here, at the end of the constructor, deliberately: after
        # the `applyStoredFilters` early-return guard above (that path renders no
        # board at all), after `initializeEventHandlers()`, and after the four
        # `defineImmutableProperty` bindings, so `@.scope.usByStatus`, `usMap`,
        # `usByStatusSwimlanes` and `swimlanesList` all already exist when the
        # bridge reads them. The bridge flattens those Immutable projections with
        # `.toJS()` at the seam, matching the in-repo precedent at
        # `app/modules/components/project-menu/project-menu.controller.coffee` L28.
        @.reactBoard = @reactBridge.build(@)

    cleanSelectedUss: () ->
        for key of @.selectedUss
            @.selectedUss[key] = false

    toggleSelectedUs: (usId) ->
        @.selectedUss[usId] = !@.selectedUss[usId]

    firstLoad: () ->
        promise = @.loadInitialData()

        # On Success
        promise.then =>
            title = @translate.instant("KANBAN.PAGE_TITLE", {projectName: @scope.project.name})
            description = @translate.instant("KANBAN.PAGE_DESCRIPTION", {
                projectName: @scope.project.name,
                projectDescription: @scope.project.description
            })
            @appMetaService.setAll(title, description)

        # On Error
        promise.then null, @.onInitialDataError.bind(@)

    setZoom: (zoomLevel, zoom) ->
        zoomLevel = Number(zoomLevel)
        if @.zoomLevel == zoomLevel
            return null

        previousZoomLevel = @.zoomLevel

        @.zoomLevel = zoomLevel
        @.zoom = zoom

        if @.isFirstLoad
            @.firstLoad().then () =>
                @.isFirstLoad = false
                @kanbanUserstoriesService.resetFolds()

        else if @.zoomLevel > 2 && previousZoomLevel <= 2
            @.zoomLoading = true

            @.loadUserstories().then () =>
                @.zoomLoading = false
                @kanbanUserstoriesService.resetFolds()

    filtersReloadContent: debounceLeading 100, () ->
        @.loadUserstories().then (result) =>
            if !result
                return

            if @scope.swimlanesList.size && !result.length
                @.foldedSwimlane = @.foldedSwimlane.set(@scope.swimlanesList.first().id.toString(), false)

    moveToTopDropdown: (us) ->
        @.moveUsToTop(us.toJS().model)

    moveUsToTop: (uss) ->
        if !Array.isArray(uss)
            uss = [uss]

        us = uss[0]
        nextUsId = null
        userstories = []
        @.movedUs.push(us.id)
        @timeout () =>
            @.movedUs = []
        , 1000, false

        if us.swimlane
            userstories = @scope.usByStatusSwimlanes.getIn([
                us.swimlane,
                us.status
            ])
        else
            userstories = @scope.usByStatus.get(us.status.toString())

        if userstories && userstories.size
            nextUsId = userstories.get(0)

        if nextUsId
            @.moveUs(null, uss, us.status, us.swimlane, 0, null, nextUsId)

    initializeEventHandlers: ->
        @scope.$on "usform:new:success", (event, us, position = 'bottom') =>
            @.refreshTagsColors().then () =>
                @kanbanUserstoriesService.add(us)
                @scope.$broadcast("redraw:wip")

                if position == 'top'
                    @.moveUsToTop(us)

            @analytics.trackEvent("userstory", "create", "create userstory on kanban", 1)

        @scope.$on "usform:bulk:success", (event, uss, position = 'bottom') =>
            @confirm.notify("success")
            @.refreshTagsColors().then () =>
                @kanbanUserstoriesService.add(uss)
                @scope.$broadcast("redraw:wip")

                if position == 'top'
                    @.moveUsToTop(uss)

            @analytics.trackEvent("userstory", "create", "bulk create userstory on kanban", 1)

        @scope.$on "usform:edit:success", (event, us) =>
            @.refreshTagsColors().then () =>
                oldStatus = @kanbanUserstoriesService.getUsModel(us.id).status
                if oldStatus != us.status
                    # the us has to move at the end of the status
                    status = @scope.usByStatus.get(us.status.toString())
                    if status
                        lastUsId = status.last()
                        newOrder = @scope.usMap.get(lastUsId).getIn(['model', 'kanban_order']) + 1
                        us.kanban_order = newOrder

                @kanbanUserstoriesService.replaceModel(us)
                @kanbanUserstoriesService.refreshRawOrder()
                @kanbanUserstoriesService.refresh(false)

        @scope.$on "kanban:us:deleted", (event, us) =>
            @kanbanUserstoriesService.remove(us)

        # MIGRATION NOTE (React coexistence): `kanban:us:move` is THE drag contract,
        # and both ends of it must keep matching. It is broadcast today at
        # `app/coffee/modules/kanban/sortable.coffee` L153 as
        # `$rootscope.$broadcast("kanban:us:move", finalUsList, newStatus,
        # newSwimlane, index, previousCard, nextCard)`, and `@.moveUs` below is the
        # receiving end -- note the leading `ctx` parameter there is the AngularJS
        # event object supplied by `$on`, which is why `moveUs` is also called
        # directly with `null` as its first argument from `moveUsToTop`.
        # `app/react/kanban/hooks/useCardDrag.ts` MUST emit the same event name with
        # the same six arguments in the same order, because this single broadcast
        # drives BOTH the retained handler below (which issues the position-relative
        # `bulkUpdateKanbanOrder` write) and the WIP marker redraw registered by
        # `KanbanWipLimitDirective`. `moveUs` then broadcasts `redraw:wip` on
        # success, so the marker is refreshed from server-acknowledged state.
        @scope.$on("kanban:us:move", @.moveUs)
        @scope.$on("kanban:show-userstories-for-status", @.loadUserStoriesForStatus)
        @scope.$on("kanban:hide-userstories-for-status", @.hideUserStoriesForStatus)

        @scope.$on "lightbox:opened", () =>
            @.isLightboxOpened = true

        @scope.$on "lightbox:closed", () =>
            @.isLightboxOpened = false
            if @.isRefreshNeeded
                @.refreshAfterSwimlanesOrUserstoryStatusesHaveChanged()
                @.isRefreshNeeded = false

    refreshAfterSwimlanesOrUserstoryStatusesHaveChanged: ->
        # User story statuses has changed
        @tgLoader.start()
        @projectService.fetchProject().then () =>
            @.loadInitialData()

    initializeSubscription: ->
        randomTimeout = taiga.randomInt(700, 1000)

        # For user stories events
        routingKeyUserstories = "changes.project.#{@scope.projectId}.userstories"
        @events.subscribe @scope, routingKeyUserstories, debounceLeading randomTimeout, (message) =>
            @.eventsLoadUserstories(message)

        # For project attributes (swimlanes, statuses,...) events
        routingKeyProject = "changes.project.#{@scope.projectId}.projects"
        @events.subscribe @scope, routingKeyProject, debounceLeading randomTimeout, (message) =>
            if message.matches in [
                "projects.swimlane"
                "projects.swimlaneuserstorystatus"
                "projects.userstorystatus"
            ]
                if @.isLightboxOpened
                    @.isRefreshNeeded = true
                else
                    @.refreshAfterSwimlanesOrUserstoryStatusesHaveChanged()

    addNewUs: (type, statusId) ->
        swimlane = null
        switch type
            when "standard" then  @rootscope.$broadcast("genericform:new",
                {
                    'objType': 'us',
                    'project': @scope.project,
                    'statusId': statusId,
                    'swimlane': swimlane
                })
            when "bulk" then @rootscope.$broadcast("usform:bulk", @scope.projectId, statusId, swimlane)

    editUs: (id) ->
        us = @kanbanUserstoriesService.getUs(id)
        us = us.set('loading-edit', true)
        @kanbanUserstoriesService.replace(us)

        @rs.userstories.getByRef(us.getIn(['model', 'project']), us.getIn(['model', 'ref']))
        .then (editingUserStory) =>
            @rs2.attachments.list(
                "us", us.get('id'), us.getIn(['model', 'project'])).then (attachments) =>
                    @rootscope.$broadcast("genericform:edit", {
                        'objType': 'us',
                        'obj': editingUserStory,
                        'statusList': @scope.usStatusList,
                        'attachments': attachments.toJS()
                    })

                us = us.set('loading-edit', false)
                @kanbanUserstoriesService.replace(us)

    deleteUs: (id) ->
        us = @kanbanUserstoriesService.getUs(id)
        us = us.set('loading-delete', true)

        @rs.userstories.getByRef(us.getIn(['model', 'project']), us.getIn(['model', 'ref']))
        .then (deletingUserStory) =>
            us = us.set('loading-delete', false)
            title = @translate.instant("US.TITLE_DELETE_ACTION")
            message = deletingUserStory.subject
            @confirm.askOnDelete(title, message).then (askResponse) =>
                promise = @repo.remove(deletingUserStory)
                promise.then =>
                    model = us.toJS().model
                    @scope.$broadcast("kanban:us:deleted", model)
                    askResponse.finish()
                promise.then null, ->
                    askResponse.finish(false)
                    @confirm.notify("error")

    showPlaceHolder: (statusId, swimlaneId) ->
        firstStatus = @scope.usStatusList[0].id == statusId && !@kanbanUserstoriesService.userstoriesRaw.length

        if swimlaneId
            firstSwimlane =  @scope.swimlanesList.first().id == swimlaneId
            return firstStatus && firstSwimlane

        return firstStatus

    toggleFold: (id) ->
        @kanbanUserstoriesService.toggleFold(id)

    toggleSwimlane: (id) ->
        @.foldedSwimlane = @.foldedSwimlane.set(id.toString(), !@.foldedSwimlane.get(id.toString()))
        @rs.kanban.storeSwimlanesModes(@scope.projectId, @.foldedSwimlane.toJS())

        @timeout () =>
            @scope.$broadcast("redraw:wip")
        , 100, false

    isUsInArchivedHiddenStatus: (usId) ->
        return @kanbanUserstoriesService.isUsInArchivedHiddenStatus(usId)

    changeUsAssignedUsers: (id) =>
        item = @kanbanUserstoriesService.getUsModel(id)

        onClose = (assignedUsersIds) =>
            item.assigned_users = assignedUsersIds
            if item.assigned_to not in assignedUsersIds and assignedUsersIds.length > 0
                item.assigned_to = assignedUsersIds[0]
            if assignedUsersIds.length == 0
                item.assigned_to = null
            @kanbanUserstoriesService.replaceModel(item)

            @repo.save(item).then =>
                @.generateFilters()
                if @.isFilterDataTypeSelected('assigned_users') || @.isFilterDataTypeSelected('role')
                    @.filtersReloadContent()

        @lightboxFactory.create(
            'tg-lb-select-user',
            {
                "class": "lightbox lightbox-select-user",
            },
            {
                "currentUsers": _.compact(_.union(item.assigned_users, [item.assigned_to])),
                "activeUsers": @scope.activeUsers,
                "onClose": onClose,
                "lbTitle": @translate.instant("COMMON.ASSIGNED_USERS.ADD"),
            }
        )

    refreshTagsColors: ->
        return @rs.projects.tagsColors(@scope.projectId).then (tags_colors) =>
            @scope.project.tags_colors = tags_colors._attrs

    renderBatch: (clean = false) ->
        @.renderInProgress = true
        newUs = _.take(@.queue, @.batchSize)
        @.rendered = _.concat(@.rendered, newUs)
        @.queue = _.drop(@.queue, @.batchSize)

        if clean
            @kanbanUserstoriesService.set(newUs)
            @.batchTimings = [200, 100, 50]
        else
            @kanbanUserstoriesService.add(newUs)

        if @.queue.length > 0
            timeout = @.batchTimings.shift() || 20
            @timeout(@.renderBatch, timeout)
        else
            scopeDefer @scope, =>
                # The broadcast must be executed when the DOM has been fully reloaded.
                # We can't assure when this exactly happens so we need a defer
                @rootscope.$broadcast("kanban:userstories:loaded", @.rendered)
                @scope.$broadcast("userstories:loaded", @.rendered)
                @.renderInProgress = false

                @timeout () =>
                    @scope.$broadcast("redraw:wip")
                , 100, false

    renderUserStories: (userstories) =>
        userstories = _.sortBy(userstories, 'kanban_order')
        # init before render is needed in KanbanSquishColumnDirective to
        # render status columns if not we will see the column squash on load
        @kanbanUserstoriesService.initUsByStatusList(userstories)

        if @.renderBatching
            userstoriesMap = _.groupBy(userstories, 'status')
            @.rendered = []
            @.queue = []
            @.batchSize = 0

            while (@.queue.length < userstories.length)
                _.each @scope.project.us_statuses, (x) =>
                    if (userstoriesMap[x.id]?.length > 0)
                        @.queue = _.concat(@.queue, _.take(userstoriesMap[x.id], 10))
                        userstoriesMap[x.id] = _.drop(userstoriesMap[x.id], 10)
                if !@.batchSize
                    @.batchSize = 100

            @.renderBatch(true)
        else
            @kanbanUserstoriesService.set(userstories)

    loadUserstoriesParams: () ->
        params = {
            status__is_archived: false
        }

        if @.zoomLevel >= 2
            params.include_attachments = 1
            params.include_tasks = 1

        locationParams = _.pick(_.clone(@location.search()), @.validQueryParams)
        params = _.merge params, locationParams
        params.q = @.filterQ

        return params

    eventsLoadUserstories: (data) ->
        eventUserstories = []

        if !Array.isArray(data.pk)
            eventUserstories = [data.pk]
        else
            eventUserstories = data.pk

        modifiedUs = eventUserstories.filter (us) => !!@kanbanUserstoriesService.userstoriesRaw.find((raw) => raw.id == us)

        params = @.loadUserstoriesParams()

        @rs.userstories.listAll(@scope.projectId, params).then (userstories) =>
            newUss = userstories.filter (us) => !@kanbanUserstoriesService.userstoriesRaw.find((raw) => raw.id == us.id)

            userstories
            .filter((us) => modifiedUs.includes(us.id))
            .forEach (us) =>
                @kanbanUserstoriesService.replaceModel(us)
                @kanbanUserstoriesService.refreshRawOrder()

            if newUss.length
                @kanbanUserstoriesService.add(newUss)

            @kanbanUserstoriesService.refresh(false)

    loadUserstories: () ->
        params = @.loadUserstoriesParams()

        @.lastSearch = @.filterQ
        lastSearch = @.filterQ
        @.lastLoadUserstoriesParams = params

        loadPromises = [
            @rs.userstories.listAll(@scope.projectId, params),
            @.loadSwimlanes()
        ]

        archivedPromises = []
        openArchived = _.difference(@kanbanUserstoriesService.archivedStatus,
                                    @kanbanUserstoriesService.statusHide)

        if openArchived.length
            archivedPromises = openArchived.map (archivedStatusId) =>
                return @.loadUserStoriesForStatus({}, archivedStatusId)

        loadPromises = loadPromises.concat(archivedPromises)

        promise = @q.all(loadPromises).then (result) =>
            if lastSearch != @.lastSearch
                return

            @kanbanUserstoriesService.reset(false, false, false)
            userstories = result[0]
            swimlanes = result[1]

            if result.length > 2
                result.slice(2).forEach (archivedRedult) =>
                    userstories = userstories.concat(archivedRedult)

            @.notFoundUserstories = false

            if !userstories.length && ((@.filterQ && @.filterQ.length) || Object.keys(@location.search()).length)
                @.notFoundUserstories = true

            @kanbanUserstoriesService.init(@scope.project, swimlanes, @scope.usersById)
            @tgLoader.pageLoaded()
            @.renderUserStories(userstories)

            return userstories

        return promise

    loadUserStoriesForStatus: (ctx, statusId) ->
        filteredStatus = @location.search().status

        # if there are filters applied the action doesn't end if the statusId is not in the url
        if filteredStatus
            filteredStatus = filteredStatus.split(",").map (it) -> parseInt(it, 10)

            return if filteredStatus.indexOf(statusId) == -1

        params = {
            status: statusId
            include_attachments: true,
            include_tasks: true
        }

        if @.filterQ
            params.q = @.filterQ

        params = _.merge params, @location.search()

        return @rs.userstories.listAll(@scope.projectId, params).then (userstories) =>
            @.waitEmptyQuote () =>
                @scope.$broadcast("kanban:shown-userstories-for-status", statusId, userstories)

            return userstories

    waitEmptyQuote: (cb) ->
        if @.queue.length > 0
            requestAnimationFrame () => @.waitEmptyQuote(cb)
        else
            scopeDefer @scope, => cb()

    hideUserStoriesForStatus: (ctx, statusId) ->
        @scope.$broadcast("kanban:hidden-userstories-for-status", statusId)

    loadKanban: ->
        return @q.all([
            @.refreshTagsColors(),
            @.loadUserstories()
        ])

    loadSwimlanes: ->
        return @rs.swimlanes.list(@scope.projectId).then (swimlanes) =>
            @scope.swimlanes = swimlanes
            @scope.swimlanesStatuses = {}

            @scope.swimlanes.forEach (swimlane) =>
                @scope.swimlanesStatuses[swimlane.id] = swimlane.statuses

            @scope.swimlanesStatuses[-1] = @scope.project.us_statuses

            return @scope.swimlanes

    loadProject: ->
        project = @projectService.project.toJS()

        if not project.is_kanban_activated
            @errorHandlingService.permissionDenied()

        @scope.projectId = project.id
        @scope.project = project
        @scope.projectId = project.id
        @scope.points = _.sortBy(project.points, "order")
        @scope.pointsById = groupBy(project.points, (x) -> x.id)
        @scope.usStatusById = groupBy(project.us_statuses, (x) -> x.id)
        @scope.usStatusList = _.sortBy(project.us_statuses, "order")
        @scope.usCardVisibility = {}

        @scope.$emit("project:loaded", project)
        return project

    loadInitialData: ->
        project = @.loadProject()
        @.foldedSwimlane = Immutable.fromJS(@rs.kanban.getSwimlanesModes(project.id))
        @.initialLoad = false

        @.fillUsersAndRoles(project.members, project.roles)
        @.initializeSubscription()
        @.loadKanban().then () =>
            @timeout () =>
                @.initialLoad = true
            , 0, true

        @.generateFilters()

    moveUs: (ctx, usList, newStatusId, newSwimlaneId, index, previousCard, nextCard) ->
        @.cleanSelectedUss()

        usList = _.map usList, (us) =>
            return @kanbanUserstoriesService.getUsModel(us.id)

        @rootscope.$broadcast("kanban:userstories:loaded", usList, newStatusId, newSwimlaneId, index)

        apiNewSwimlaneId = newSwimlaneId

        if newSwimlaneId == -1
            apiNewSwimlaneId = null

        data = @kanbanUserstoriesService.move(
            usList.map((it) => it.id),
            newStatusId,
            apiNewSwimlaneId,
            index,
            previousCard,
            nextCard
        )

        promise = @rs.userstories.bulkUpdateKanbanOrder(
            @scope.projectId,
            newStatusId,
            apiNewSwimlaneId,
            data.afterUserstoryId,
            data.beforeUserstoryId,
            data.bulkUserstories
        )

        promise.then () =>
            @scope.$broadcast("redraw:wip")

            @.generateFilters()
            if @.isFilterDataTypeSelected('status')
                @.filtersReloadContent()

module.controller("KanbanController", KanbanController)

#############################################################################
## Kanban Directive
#############################################################################
## RETIRED (React coexistence migration): the `tgKanban` registration is removed.
## React successors: `app/react/kanban/KanbanBoard.tsx` (the board shell) and
## `app/react/shared/useInViewport.ts` (the virtualisation latch). It was applied as
## an attribute on `div.kanban-table` in
## `app/partials/includes/modules/kanban-table.jade` L13, alongside
## `tg-kanban-swimlane`, `tg-kanban-sortable` and `tg-kanban-squish-column`; that
## whole element is replaced by a single `tg-react-loader` host, and an unmatched
## attribute is simply ignored by AngularJS in any case. The controller host is a
## different element -- `ng-controller="KanbanController as ctrl"` on `div.wrapper`
## at `app/partials/kanban/kanban.jade` L12 -- and it survives untouched, which is
## why the retained controller keeps driving the screen.
## The factory below is RETAINED as the authoritative behavioural reference. It
## owns FOUR DISTINCT MECHANISMS which must not be conflated:
##
## 1. `watchKanbanSize()` -- a `ResizeObserver` over `.task-colum-name` (the class
##    really is spelled with ONE `l`; it matches the stylesheet, so do not correct
##    it). It parses the CSS custom property `--kanban-column-margin`, sums the
##    observed column widths plus that margin, and publishes the total on
##    `document.body` as `--kanban-width`, which the stylesheet then uses to size
##    the board. It calls `resizeObserver.unobserve(column)` for any column no
##    longer in the document, which is what stops the observer leaking as swimlanes
##    fold and unfold. Note it only writes when `width > 0`, so a fully folded
##    board leaves the last good value in place instead of collapsing to zero.
##
## 2. THE VIRTUALISATION LATCH -- `initBoard()` (`app/js/boards.js`) emits
##    `SHOW_CARD`, and this handler sets `$scope.usCardVisibility[entry.id] = true`
##    inside a single `$evalAsync` for the whole batch. IT IS A WRITE-ONCE LATCH:
##    `boards.js` L37-L39 filters entries to the visible ones and L41 fires the
##    callback ONLY when that filtered array is non-empty, so "left the viewport"
##    is never even reported; and repository-wide `usCardVisibility` is set to
##    `true` here and to `false` NOWHERE. The pre-filter
##    `entry.visible && !$scope.usCardVisibility[entry.id]` also means an already
##    latched card never re-triggers a digest.
##    `app/react/shared/useInViewport.ts` MUST LATCH THE SAME WAY -- once true it
##    stays true for the component's lifetime. A hook that flips back to `false` on
##    exit would blank cards on scroll-away: that is a behavioural regression, not
##    an optimisation. Drag targets must likewise stay registered for off-screen
##    cards, or dragging toward a collapsed region finds no drop target.
##
## 3. BOARD REGISTRATION -- `$scope.taskColumnLoaded` calls
##    `board.addSwimlane(column, status, swimlane)`, `$scope.cardLoaded` calls
##    `board.addCard(event.target[0], status, swimlane)`, and
##    `$scope.kanbanTableLoaded` flips `$scope.isTableLoaded` to true and, when a
##    `swimlaneId` is supplied, calls `$scope.openSwimlane(swimlaneId)` -- the
##    drag-container entry point defined in
##    `app/coffee/modules/kanban/sortable.coffee` L30-L34. `isTableLoaded` starts
##    `false`, so React must keep an equivalent "board not ready yet" gate.
##
## 4. HORIZONTAL HEADER SYNC -- the table body's `scroll` handler applies
##    `translateX(-scrollLeft)` to `.kanban-table-header .kanban-table-inner`, so
##    the sticky column header tracks the horizontally scrolling body. The sign is
##    NEGATIVE here (counter the scroll) whereas `KanbanSwimlaneDirective` uses a
##    POSITIVE offset (follow the scroll) -- they are different mechanisms with
##    different geometry. CSS `position: sticky` alone cannot replace this, because
##    the header lives in a separate scroll container from the body.
##
## The `$destroy` teardown detaches both `$el` and the cached `_tableBody`
## handlers; `useEffect` cleanups are the React equivalent and are not optional.
KanbanDirective = ($repo, $rootscope) ->
    link = ($scope, $el, $attrs) ->
        watchKanbanSize = () =>
            columns = $el.find(".task-colum-name")
            kanbanStyles = getComputedStyle($el[0])
            columnMargin = Number(kanbanStyles.getPropertyValue('--kanban-column-margin')
                .trim()
                .replace('px', '')
                .split(' ')[1])

            resizeCb = (entries) =>
                    width = columns.toArray().reduce (acc, column) =>
                        if document.body.contains(column)
                            return acc + column.offsetWidth + columnMargin

                        resizeObserver.unobserve(column)
                        return acc
                    , 0

                    if width > 0
                        document.body.style.setProperty('--kanban-width', (width - columnMargin) + 'px')

            resizeObserver = new ResizeObserver(resizeCb)

            columns.each (index, column) =>
                resizeObserver.observe(column)

        board = initBoard()
        board.events (event, entries) =>
            # the card is visible in the scroll viewport
            if event == 'SHOW_CARD'
                visibleEntries = entries.filter (entry) => entry.visible && !$scope.usCardVisibility[entry.id]

                if visibleEntries.length
                    $scope.$evalAsync () =>
                        visibleEntries.forEach (entry) =>
                            $scope.usCardVisibility[entry.id] = true

            return

        $scope.taskColumnLoaded = (event, status, swimlane) ->
            column = event.target[0]
            board.addSwimlane(column, status, swimlane)

        $scope.cardLoaded = (event, status, swimlane) ->
            board.addCard(event.target[0], status, swimlane)

        _tableBody = null

        $scope.isTableLoaded = false

        $scope.kanbanTableLoaded = (event, swimlaneId) ->
            $scope.$evalAsync () =>
                # we only want to track when the user open a new swimlane for d&d
                if swimlaneId
                    $scope.openSwimlane(swimlaneId)

                $scope.isTableLoaded = true

            tableBody = event.target
            _tableBody = tableBody
            tableHeaderDom = $el.find(".kanban-table-header .kanban-table-inner")

            tableBody.on "scroll", (event) ->
                scroll = -1 * event.currentTarget.scrollLeft
                tableHeaderDom.css("transform", "translateX(#{scroll}px)")

            watchKanbanSize()

            return

        $scope.$on "$destroy", ->
            $el.off()
            if _tableBody
                _tableBody.off()

    return {link: link}

## The `tgKanban` registration used to sit here; see the retirement note above
## `KanbanDirective`.

#############################################################################
## Kanban Archived Show Status
#############################################################################
## RETIRED (React coexistence migration): the `tgKanbanArchivedShowStatusHeader`
## registration is removed. React successor:
## `app/react/kanban/ArchivedColumn.tsx` (the collapsed rail's header and its
## expand affordance). The factory below is RETAINED as the authoritative
## behavioural reference:
##
##  * `$translate.instant("KANBAN.ACTION_SHOW_ARCHIVED")` is resolved ONCE at
##    factory time, not per link. React resolves the same key through
##    `app/react/bridge/useTranslate.ts`.
##  * A one-shot `$watch 'ctrl.initialLoad'` unwatches itself on the first truthy
##    value, then registers the status as archived AND hides it
##    (`addArchivedStatus` followed by `hideStatus`). Both calls are required: the
##    first makes `isUsInArchivedHiddenStatus` answer correctly, the second is what
##    keeps the column's stories out of the board until the user asks for them.
##  * The click handler is idempotent by design -- it only acts when
##    `kanbanUserstoriesService.statusHide.includes(status.id)`, so repeated clicks
##    on an already-shown column do nothing. It then broadcasts
##    `kanban:show-userstories-for-status` and calls `showStatus(status.id)`. The
##    broadcast is handled by `KanbanController.loadUserStoriesForStatus`, which is
##    RETAINED, so the fetch keeps working unchanged from the React side.
##  * The handler wraps its work in `$scope.$apply` because the click arrives from
##    outside the digest. React must NOT reproduce that: digest cycles stay
##    AngularJS's concern and React state updates are driven by React.
KanbanArchivedShowStatusHeaderDirective = ($rootscope, $translate, kanbanUserstoriesService) ->
    showArchivedText = $translate.instant("KANBAN.ACTION_SHOW_ARCHIVED")

    link = ($scope, $el, $attrs) ->
        unwatch = $scope.$watch 'ctrl.initialLoad', (initialLoad) =>
            return if !initialLoad

            unwatch()

            status = $scope.$eval($attrs.tgKanbanArchivedShowStatusHeader)

            kanbanUserstoriesService.addArchivedStatus(status.id)
            kanbanUserstoriesService.hideStatus(status.id)

            $el.on "click", (event) ->
                $scope.$apply ->
                    if kanbanUserstoriesService.statusHide.includes(status.id)
                        $rootscope.$broadcast("kanban:show-userstories-for-status", status.id)
                        kanbanUserstoriesService.showStatus(status.id)

        $scope.$on "$destroy", ->
            $el.off()

    return {link:link}

## The `tgKanbanArchivedShowStatusHeader` registration used to sit here; see the
## retirement note above `KanbanArchivedShowStatusHeaderDirective`.

#############################################################################
## Kanban Archived Status Column Intro Directive
#############################################################################
## RETIRED (React coexistence migration): the `tgKanbanArchivedStatusIntro`
## registration is removed. React successor:
## `app/react/kanban/ArchivedColumn.tsx` (the expanded state). The factory below is
## RETAINED as the authoritative behavioural reference:
##
##  * It reads its status once from `$scope.$eval($attrs.tgKanbanArchivedStatusIntro)`
##    at link time, then listens for `kanban:shown-userstories-for-status`.
##  * On a matching status id it calls `kanbanUserstoriesService.deleteStatus(statusId)`
##    BEFORE `add(userStoriesLoaded)`. The order is load-bearing: `deleteStatus`
##    clears the placeholder/hidden bookkeeping for that column so that `add` does
##    not merge the freshly fetched archived stories into a stale column state.
##  * `kanban:shown-userstories-for-status` is broadcast by
##    `KanbanController.loadUserStoriesForStatus`, which is RETAINED, so React only
##    has to consume the same event -- it does not have to re-derive the fetch.
KanbanArchivedStatusIntroDirective = ($translate, kanbanUserstoriesService) ->
    userStories = []

    link = ($scope, $el, $attrs) ->
        status = $scope.$eval($attrs.tgKanbanArchivedStatusIntro)

        $scope.$on "kanban:shown-userstories-for-status", (ctx, statusId, userStoriesLoaded) ->
            if statusId == status.id
                kanbanUserstoriesService.deleteStatus(statusId)
                kanbanUserstoriesService.add(userStoriesLoaded)

        $scope.$on "$destroy", ->
            $el.off()

    return {link:link}

## The `tgKanbanArchivedStatusIntro` registration used to sit here; see the
## retirement note above `KanbanArchivedStatusIntroDirective`.

#############################################################################
## Kanban Squish Column Directive
#############################################################################
## RETIRED (React coexistence migration): the `tgKanbanSquishColumn` registration
## is removed. React successors: `app/react/kanban/ArchivedColumn.tsx` (the
## squished archived rail) and `app/react/kanban/StatusColumnHeader.tsx` (the
## `vfold` column-fold behaviour). The factory below is RETAINED as the
## authoritative behavioural reference for both:
##
##  * `$scope.foldStatus(status)` lazily seeds `$scope.folds` from
##    `rs.kanban.getStatusColumnModes(projectService.project.get('id'))` -- keyed by
##    PROJECT id -- then toggles `folds[status.id]` with `!!!` (i.e. "not truthy").
##  * `$scope.unfold` is reset to `null` on every toggle and set to the status id
##    ONLY when that status just became unfolded. It is the "which column did the
##    user just open" signal, not a mirror of `folds`, and the `vunfold` styling
##    depends on that distinction.
##  * Persistence is `rs.kanban.storeStatusColumnModes($scope.projectId, ...)` --
##    note it persists with `$scope.projectId` while it READ with
##    `projectService.project.get('id')`. Both resolve to the same project; React
##    must keep writing through the same resource method so the stored shape and
##    storage key stay compatible with what AngularJS wrote before the migration.
##  * Folding an ARCHIVED status that is currently shown also hides it again
##    (`kanbanUserstoriesService.hideStatus`), which is what stops archived stories
##    from staying loaded behind a folded column.
##  * The one-shot `$watch 'ctrl.initialLoad'` waits for BOTH `initialLoad` and a
##    non-empty `usByStatus`, then force-folds every `is_archived` status and
##    unwatches itself. React must reproduce "archived columns start folded" as
##    initial state derived on first load, and must not re-apply it afterwards or
##    the user could never keep an archived column open.
KanbanSquishColumnDirective = (rs, projectService, kanbanUserstoriesService) ->
    link = ($scope, $el, $attrs) ->
        $scope.foldStatus = (status) ->
            if !$scope.folds
                $scope.folds = rs.kanban.getStatusColumnModes(projectService.project.get('id'))

            $scope.unfold = null
            $scope.folds[status.id] = !!!$scope.folds[status.id]

            if !$scope.folds[status.id]
                $scope.unfold = status.id

            rs.kanban.storeStatusColumnModes($scope.projectId, $scope.folds)

            if kanbanUserstoriesService.archivedStatus.includes(status.id) && !kanbanUserstoriesService.statusHide.includes(status.id)
                kanbanUserstoriesService.hideStatus(status.id)

            return

        unwatch = $scope.$watch 'ctrl.initialLoad', (load) ->
            if load && $scope.usByStatus?.size
                $scope.folds = rs.kanban.getStatusColumnModes(projectService.project.get('id'))

                archivedFolds = $scope.usStatusList.filter (status) ->
                    return status.is_archived

                for status in archivedFolds
                    $scope.folds[status.id] = true

                unwatch()

    return {link: link}

## The `tgKanbanSquishColumn` registration used to sit here; see the retirement
## note above `KanbanSquishColumnDirective`.

#############################################################################
## Kanban WIP Limit Directive
#############################################################################
## RETIRED (React coexistence migration): the `tgKanbanWipLimit` registration is
## removed. React successor: `app/react/kanban/WipLimitMarker.tsx`, which renders
## the same marker declaratively from `cardCount` and `wipLimit` instead of
## injecting DOM after the fact. The factory below is RETAINED as the
## authoritative behavioural reference. Every branch matters:
##
##  * The card count comes from `$el.find("tg-card")` -- counted by ELEMENT NAME,
##    so it counts rendered cards, not model entries. Virtualised (off-screen)
##    cards are still rendered elements, so the count is unaffected by scrolling.
##  * `cards.length + 1 == status.wip_limit` -> class `one-left`, marker inserted
##    AFTER `cards[cards.length - 1]`.
##  * `cards.length == status.wip_limit` -> class `reached`, marker inserted AFTER
##    `cards[cards.length - 1]`.
##  * `cards.length > status.wip_limit` -> class `exceeded`, marker inserted AFTER
##    `cards[status.wip_limit - 1]`. NOTE THE DIFFERENT INDEX: `exceeded` marks the
##    boundary at the limit, not the end of the list. This is the easy one to get
##    wrong, and getting it wrong puts the line under the wrong card with no error.
##  * Any pre-existing `.kanban-wip-limit` is removed before re-inserting, and
##    nothing is inserted at all when no branch matched (`element` stays null).
##  * The emitted markup is exactly
##    `<div class='kanban-wip-limit {one-left|reached|exceeded}'><span>WIP Limit</span></div>`.
##    `WIP Limit` is a HARDCODED English literal, NOT a translation key: it never
##    goes through `$translate`, and no locale value matches it -- the nearest,
##    `ADMIN.US_STATUS.WIP_LIMIT_COLUMN`, reads `WIP limit` with a lower-case `l`.
##    Behavioural equivalence therefore wins over the "all copy flows through
##    useTranslate" guidance: `WipLimitMarker.tsx` must emit the same literal, and
##    no translation key may be invented for it. Logged as Drift Register entry D5
##    under `e2e-react/artifacts/figma-comparison/`. Do not "improve" it.
##  * The `$timeout` trailing arguments are `, 0, false` -- the `false` means DO NOT
##    trigger a digest. React needs no equivalent, but the reason the redraw is
##    deferred by a tick does carry over: it must run AFTER the cards have been
##    committed to the DOM, which in React means a layout effect rather than render.
##  * The whole thing is gated on `status and not status.is_archived`, and redraws
##    on exactly four events: `redraw:wip`, `kanban:us:move`, `usform:new:success`
##    and `usform:bulk:success`. `.vfold .kanban-wip-limit { display: none }` in
##    `app/styles/modules/kanban/kanban-table.scss` hides the marker on folded
##    columns, so React authors no marker styling of its own.
KanbanWipLimitDirective = ($timeout) ->
    link = ($scope, $el, $attrs) ->
        status = $scope.$eval($attrs.tgKanbanWipLimit)

        redrawWipLimit = =>
            $timeout =>
                cards = $el.find("tg-card")

                wipLimitClass = ''
                element = null

                if cards.length + 1 == status.wip_limit
                    wipLimitClass = 'one-left'
                    element = cards[cards.length - 1]
                else if cards.length == status.wip_limit
                    wipLimitClass = 'reached'
                    element = cards[cards.length - 1]
                else if cards.length > status.wip_limit
                    wipLimitClass = 'exceeded'
                    element = cards[status.wip_limit - 1]

                $el.find(".kanban-wip-limit").remove()

                if element
                    angular.element(element).after("<div class='kanban-wip-limit #{wipLimitClass}'><span>WIP Limit</span></div>")
            , 0, false

        if status and not status.is_archived
            $scope.$on "redraw:wip", redrawWipLimit
            $scope.$on "kanban:us:move", redrawWipLimit
            $scope.$on "usform:new:success", redrawWipLimit
            $scope.$on "usform:bulk:success", redrawWipLimit

        $scope.$on "$destroy", ->
            $el.off()

    return {link: link}

## The `tgKanbanWipLimit` registration used to sit here; see the retirement note
## above `KanbanWipLimitDirective`.

## MOVED OUT (React coexistence migration): `tgCardAssignedTo`, `tgCardData` and
## `tgCardActions` -- together with the `CardSvgTemplate` heredoc that all three of
## them compile with `_.template(...)` -- moved VERBATIM from here to
## `app/coffee/modules/kanban/card-directives.coffee`. They remain registered on
## this same `taigaKanban` module under identical names, so not one consumer
## changes.
##
## They are MOVED, NOT RETIRED: they render the SHARED `tg-card` component in
## `app/modules/components/card/**`, which is must-not-modify and is also rendered
## by the OUT-OF-SCOPE taskboard at
## `app/partials/includes/modules/taskboard-table.jade` L135 and L186. Retiring
## them would break a screen this migration does not touch.
##
## The shared SVG heredoc had to travel WITH them, and that is not a tidiness
## preference. The Gulp `coffee` task compiles each `.coffee` file INDIVIDUALLY
## (`gulpfile.js` L515) and only afterwards concatenates the results into `app.js`
## (L520), and CoffeeScript wraps every compiled file in its own
## `(function(){...}).call(this)` IIFE -- so file-scope variables do NOT cross file
## boundaries in the bundle. Leaving the heredoc behind here would have raised a
## `ReferenceError` for it the first time any card rendered, taking down the
## taskboard along with this board.
##
## The four names above appear in this note as DOCUMENTATION ONLY: no code in this
## file references them any more, which is exactly what makes the move safe.

#############################################################################
## Kanban Swimlane Directive
#############################################################################
## RETIRED (React coexistence migration): the `tgKanbanSwimlane` registration is
## removed. React successors: `app/react/kanban/Swimlane.tsx` and
## `app/react/kanban/SwimlaneHeader.tsx`. The factory below is RETAINED as the
## authoritative behavioural reference; it owns THREE behaviours:
##
## 1. CONTROLLER LOOKUP -- `ctrl = $scope.$parent.ctrl`, and it THROWS
##    `KanbanSwimlaneDirective ctrl not found` when absent. React reaches the same
##    controller through the bridge params/events instead of the scope chain.
##
## 2. STICKY SWIMLANE TITLE -- the swimlane's `scroll` handler applies
##    `translateX(scrollLeft)` to `.kanban-swimlane-title` and
##    `.kanban-swimlane-add`, so the title and the add button stay pinned to the
##    left edge while the swimlane scrolls horizontally. Note the sign: this is
##    `+scrollLeft` (follow the scroll), whereas the board header sync in
##    `KanbanDirective` uses `-scrollLeft` (counter the scroll).
##
## 3. DRAG-HOVER AUTO-OPEN -- undocumented anywhere else, and easy to lose.
##    `mouseoverSwimlane(event, swimlaneId)` returns early when the pointer is
##    already over the current swimlane. For a swimlane carrying the `folded`
##    class it probes for a live drag with
##    `!!document.querySelectorAll('tg-card.gu-mirror').length` and returns unless
##    one is in progress; only then does it add the
##    `pending-to-open` class and schedule a 1000 ms `$timeout` that removes the
##    class and calls `ctrl.toggleSwimlane(swimlaneId)`. `mouseleaveSwimlane`
##    cancels that pending timeout via `$timeout.cancel(...)`. In React the
##    "is a drag in progress" test comes from the `@dnd-kit` drag state rather
##    than from a `gu-mirror` DOM probe, but the 1000 ms delay, the
##    `pending-to-open` class and the folded-only gate must all be preserved.
##
## `Swimlane.tsx` additionally owns the ngAnimate class contract (design-system
## gap G-DS-1). `.kanban-table-body` is animated today by ngAnimate, registered at
## `app/coffee/app.coffee` L1098 and driven by the `ng-if` directives at
## `app/partials/includes/modules/kanban-table.jade` L107-L110 and L184-L187.
## React does not participate in that lifecycle, so it must EMIT THE SAME CLASS
## SEQUENCE ON THE SAME SCHEDULE: `ng-enter` then `ng-enter-active`, `ng-move`
## then `ng-move-active`, `ng-leave` then `ng-leave-active`, over `0.5s linear`,
## with `max-height` moving between `0` and `524px`, `min-height` pinned to `0` for
## the duration (the resting rule is `min-height: 180px`, which would otherwise
## fight the collapse) and `opacity` between `0` and `1`. Honouring the contract
## instead of adding an animation library is what keeps
## `app/styles/modules/kanban/kanban-table.scss` L549-L575 applying verbatim and
## needing zero edits.
KanbanSwimlaneDirective = ($timeout) ->
    link = ($scope, $el, $attrs) ->
        tableHeaderDom = []
        addSwimlane = null
        ctrl = $scope.$parent.ctrl

        if !ctrl
            throw new Error('KanbanSwimlaneDirective ctrl not found')

        # sticky swimlane title
        $el.on "scroll", (event) ->
            if !tableHeaderDom.length
                tableHeaderDom = $el.find(".kanban-swimlane-title")
            if !addSwimlane
                addSwimlane = $el.find(".kanban-swimlane-add")

            scroll = event.currentTarget.scrollLeft
            tableHeaderDom.css("transform", "translateX(#{scroll}px)")
            addSwimlane.css("transform", "translateX(#{scroll}px)")

        currentSwimlane = null
        className = 'pending-to-open'

        $scope.mouseleaveSwimlane = (event) =>
            if currentSwimlane
                $timeout.cancel(currentSwimlane.timeoutId)
                currentSwimlane.el.classList.remove(className)
                currentSwimlane = null

        $scope.mouseoverSwimlane = (event, swimlaneId) =>
            return if currentSwimlane && currentSwimlane.id == swimlaneId

            if currentSwimlane
                $timeout.cancel(currentSwimlane.timeoutId)
                currentSwimlane.el.classList.remove(className)

            swimlane = event.currentTarget

            if swimlane.classList.contains('folded')
                isDragging = !!document.querySelectorAll('tg-card.gu-mirror').length

                return if !isDragging

                swimlane.classList.add(className)

                timeoutId = $timeout () ->
                    swimlane.classList.remove(className)
                    ctrl.toggleSwimlane(swimlaneId)
                , 1000

                currentSwimlane = {
                    id: swimlaneId,
                    timeoutId: timeoutId,
                    el: swimlane
                }

        $scope.$on "$destroy", ->
            $el.off()

    return {link: link}

## The `tgKanbanSwimlane` registration used to sit here; see the retirement note
## above `KanbanSwimlaneDirective`.

#############################################################################
## Kanban Swimlane Taskboard Column Directive
#############################################################################
## RETIRED (React coexistence migration): the `tgKanbanTaskboardColumn`
## registration is removed. React successor:
## `app/react/kanban/StatusColumn.tsx` -- one status cell within one swimlane,
## and the drop target for `app/react/shared/dnd/`. The factory below is RETAINED
## as the authoritative behavioural reference; it owns two things React must
## reproduce:
##
## 1. STICKY TASK COUNTER -- the cell's own `scroll` handler applies
##    `translateY(scrollTop)` to `.kanban-task-counter`, which is what keeps the
##    `n` / `n / limit` badge (`app/react/kanban/TaskCounter.tsx`) pinned to the
##    top-right of the cell while the cell scrolls vertically. The counter lives
##    inside the scrolling cell, so CSS `position: sticky` on its own does not
##    achieve this.
##
## 2. THE LOAD-BEARING DATA ATTRIBUTES on the element this directive sits on.
##    `app/partials/includes/modules/kanban-table.jade` renders `.taskboard-column`
##    (L112, L189) carrying `data-status="{{s.id}}"` (L119, L196),
##    `data-swimlane="{{swimlane.id}}"` (L76, L120) and, per card,
##    `data-id="{{ usId }}"` (L151, L227). React MUST emit all four verbatim:
##    without `data-id`, `entry.target.dataset.id` is `NaN` and virtualisation
##    silently never fires; without `data-status` / `data-swimlane`, drag
##    resolution breaks -- `openSwimlane` in
##    `app/coffee/modules/kanban/sortable.coffee` L30-L34 selects its drag
##    containers with `.kanban-swimlane[data-swimlane="<id>"] .taskboard-column`.
KanbanTaskboardColumnDirective = () ->
    link = ($scope, $el, $attrs) ->
        # sticky num us counter
        $el.on "scroll", (event) ->
            scroll = event.currentTarget.scrollTop
            taskCounterDom = $el.find(".kanban-task-counter")
            taskCounterDom.css("transform", "translateY(#{scroll}px)")

        $scope.$on "$destroy", ->
            $el.off()

    return {link: link}

## The `tgKanbanTaskboardColumn` registration used to sit here; see the
## retirement note above `KanbanTaskboardColumnDirective`.
