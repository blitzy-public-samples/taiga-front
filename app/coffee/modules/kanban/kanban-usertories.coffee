###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

groupBy = @.taiga.groupBy

#############################################################################
## React migration seam: this service is RETAINED, not retired
#############################################################################
#
# `tgKanbanUserstories` remains the AngularJS-side data-shaping layer for the
# Kanban board. It owns the mutable raw collection (`userstoriesRaw`), the
# `order` map, and the four derived Immutable projections `usByStatus`,
# `usMap`, `usByStatusSwimlanes` and `swimlanesList`. `KanbanController`
# publishes those four projections onto `$scope` at
# `app/coffee/modules/kanban/main.coffee` L93-L103 through
# `taiga.defineImmutableProperty`.
#
# The React board never receives Immutable structures: they are flattened
# with `.toJS()` at the `app/coffee/modules/kanban/react-bridge.coffee` seam.
# That mirrors the in-repo precedent for handing data to a Web Component at
# `app/modules/components/project-menu/project-menu.controller.coffee` L28.
#
# The React successor for the derived-view logic is
# `app/react/kanban/state/boardSelectors.ts` (together with `boardReducer.ts`
# and `state/types.ts`), which rebuilds `usByStatus` / `usByStatusSwimlanes`
# from normalised plain-object state using `immer`. The immer conversion
# belongs there, not here.
#
# This service deliberately stays on Immutable (the `immutable` package).
# `swimlanesList` is read through the Immutable `List` API (`.size`,
# `.first()`) by code that this migration must not break:
#   - `app/partials/kanban/kanban.jade` L17
#   - `app/partials/includes/modules/kanban-table.jade` L14, L74, L177, L185
#   - `app/partials/includes/modules/lightbox-us-bulk.jade` L57, L61
#   - `app/partials/common/lightbox/lightbox-create-edit/lb-create-edit-us.jade` L8, L12
#   - `app/coffee/modules/kanban/main.coffee` L154, L155, L320
#   - `app/modules/components/card/card.controller.coffee` L31, which is
#     rule-T4 protected and shared with the out-of-scope taskboard
#     (`app/partials/includes/modules/taskboard-table.jade` L135, L186)
#
# A plain JavaScript array exposes `.length`, never `.size`, so converting
# this service in place would make every one of those call sites silently
# evaluate `undefined` -> falsy, with no error thrown anywhere.
#############################################################################

class KanbanUserstoriesService extends taiga.Service
    @.$inject = [
        "$translate"
    ]

    constructor: (@translate) ->
        @.reset()

    reset: (resetSwimlanesList = true, resetArchivedStatus = true, resetHideStatud = true) ->
        @.userstoriesRaw = []
        @.swimlanes = []
        @.foldStatusChanged = {}
        @.usByStatus = Immutable.Map()
        @.usMap = Immutable.Map()
        @.usByStatusSwimlanes = Immutable.Map()

        if resetHideStatud
            @.statusHide = []

        if resetArchivedStatus
            @.archivedStatus = []

        if resetSwimlanesList
            @.swimlanesList = Immutable.List()

    init: (project, swimlanes, usersById) ->
        @.project = project
        @.swimlanes = swimlanes
        @.usersById = usersById

    resetFolds: () ->
        @.foldStatusChanged = {}

    toggleFold: (usId) ->
        @.foldStatusChanged[usId] = !@.foldStatusChanged[usId]
        @.refreshUserStory(usId)

    set: (userstories) ->
        @.userstoriesRaw = userstories
        @.refreshRawOrder()
        @.refresh()

    # React seam: key-type normalisation the React selectors must reproduce.
    # `usByStatus` is keyed by `String(usModel.status)` -- STRING keys, which
    # is why `main.coffee` L178 and L213 both read it as
    # `usByStatus.get(us.status.toString())`. By contrast `usMap` is keyed by
    # NUMERIC user-story ids, and the inner maps of `usByStatusSwimlanes` are
    # keyed by `Number(statusId)` (see `refreshSwimlanes` below). Mixing those
    # key types up in `app/react/kanban/state/boardSelectors.ts` yields empty
    # columns rather than an error.
    initUsByStatusList: (userstories) ->
        for key, usModel of userstories
            status = String(usModel.status)

            if (!@.usByStatus.has(status))
                @.usByStatus = @.usByStatus.set(status, Immutable.List())

    remove: (usModel) ->
        @.userstoriesRaw = @.userstoriesRaw.filter (it) => it.id != usModel.id

        delete @.order[usModel.id]

        status = String(usModel.status)

        @.usMap = @.usMap.delete(usModel.id)

        @.usByStatus = @.usByStatus.set(
            status,
            @.usByStatus.get(status)
            .filter((id) => id != usModel.id)
        )

        @.refreshSwimlanes()

    # don't call refresh to prevent unnecessary mutations in every single us
    add: (usList) ->
        if !Array.isArray(usList)
            usList = [usList]

        usList = _.sortBy usList, ['kanban_order']

        @.userstoriesRaw = @.userstoriesRaw.filter (us) =>
            return !usList.find (it) => it.id == us.id
        @.userstoriesRaw = @.userstoriesRaw.concat(usList)
        @.userstoriesRaw = @.userstoriesRaw.map (us) =>
            return us

        @.refreshRawOrder()

        @.userstoriesRaw = _.sortBy @.userstoriesRaw, [(it) => @.order[it.id]]

        for key, usModel of usList
            us = @.retrieveUserStoryData(usModel)
            status = String(usModel.status)

            if (!@.usByStatus.has(status))
                @.usByStatus = @.usByStatus.set(status, Immutable.List())

            if !@.usMap.get(usModel.id)
                @.usMap = @.usMap.set(usModel.id, Immutable.fromJS(us))

                @.usByStatus = @.usByStatus.set(
                    status,
                    @.usByStatus.get(status)
                    .filter((id) => id != usModel.id)
                    .push(usModel.id)
                )

        @.refreshSwimlanes()

    addArchivedStatus: (statusId) ->
        @.archivedStatus.push(statusId)

    isUsInArchivedHiddenStatus: (usId) ->
        # us = @.getUsModel(usId)
        us = @.usMap.get(usId)
        status = us?.getIn(['model', 'status'])
        return @.archivedStatus.indexOf(status) != -1 &&
            @.statusHide.indexOf(status) != -1

    hideStatus: (statusId) ->
        @.deleteStatus(statusId)
        @.statusHide.push(statusId)

    showStatus: (statusId) ->
        _.remove @.statusHide, (it) -> return it == statusId

    getStatus: (statusId, swimlaneId) ->
        return _.filter @.userstoriesRaw, (it) =>
            return it.status == statusId && (!swimlaneId || it.swimlane == swimlaneId)

    deleteStatus: (statusId) ->
        toDelete = _.filter @.userstoriesRaw, (us) -> return us.status == statusId
        toDelete = _.map (it) -> return it.id

        @.archived = _.difference(@.archived, toDelete)

    refreshRawOrder: () ->
        @.order = {}
        if (@.userstoriesRaw)
            @.order[it.id] = it.kanban_order for it in @.userstoriesRaw

    assignOrders: (order) ->
        @.order = _.assign(@.order, order)

        @.refresh(false)

    move: (usList, statusId, swimlaneId, index, previousCard, nextCard) ->
        usByStatus = @.getStatus(statusId, swimlaneId)
        usByStatus = _.sortBy usByStatus, [(it) => @.order[it.id]]

        if previousCard
            previousUsOrder = @.order[previousCard] + 1
            previousUsIndex = (usByStatus.findIndex (it) => it.id == previousCard) + 1
        else
            previousUsOrder = 0
            previousUsIndex = 0

        usByStatusWithoutMoved = _.filter usByStatus, (listIt) ->
            return !_.find usList, (moveIt) -> return listIt.id == moveIt

        afterDestination = _.slice(usByStatusWithoutMoved, previousUsIndex)

        initialLength = usList.length + 1

        for usModel, key in afterDestination # increase position of the us after the dragged us's
            @.order[usModel.id] = previousUsOrder + initialLength + key

        for usId, key in usList
            usModel = @.getUsModel(usId)
            usModel.status = statusId

            usModel.swimlane = swimlaneId

            @.order[usModel.id] = previousUsOrder + key

            us = @.retrieveUserStoryData(usModel)
            @.usMap = @.usMap.set(us.id, Immutable.fromJS(us))

        @.refresh(false)

        # React seam: this return value is the in-repo proof that the kanban
        # write API is POSITION-RELATIVE, not index-based. `main.coffee`
        # L618-L625 forwards `afterUserstoryId` / `beforeUserstoryId` into
        # `@rs.userstories.bulkUpdateKanbanOrder(...)`, which serialises them
        # as `after_userstory_id` / `before_userstory_id`
        # (`app/coffee/modules/resources/userstories.coffee` L112-L129).
        # `app/react/shared/dnd/useSortableList.ts` must therefore compute the
        # same two neighbours from @dnd-kit collision data; an off-by-one
        # there silently persists a wrong order with no error surface, and
        # only becomes visible on the next page load.
        return {
            statusId: statusId,
            swimlaneId: swimlaneId,
            afterUserstoryId: previousCard,
            beforeUserstoryId: nextCard,
            bulkUserstories: usList,
        }

    # React seam: `-1` is a SENTINEL order, not a real position. It tells the
    # backend "append to the end of this status" instead of naming a
    # neighbour, and it is written to both the local `order` map and the
    # model's `kanban_order`. The return shape is `{"us_id": <id>, "order":
    # -1}` -- snake_case, because it is API payload rather than view state.
    # Any React reimplementation must keep the sentinel and the payload keys
    # exactly; substituting a computed index changes the request semantics.
    moveToEnd: (id, statusId) ->
        us = @.getUsModel(id)

        @.order[us.id] = -1

        us.status = statusId
        us.kanban_order = @.order[us.id]

        @.refresh(false)

        return {"us_id": us.id, "order": -1}

    replace: (us) ->
        @.usMap = @.usMap.set(us.get('id'), us)

    replaceModel: (usModel) ->
        @.userstoriesRaw = _.map @.userstoriesRaw, (usItem) ->
            if usModel.id == usItem.id
                return usModel
            else
                return usItem

        us = @.retrieveUserStoryData(usModel)
        @.usMap = @.usMap.set(usModel.id, Immutable.fromJS(us))

    getUs: (id) ->
        return @.usMap.get(id)

    getUsModel: (id) ->
        return _.find @.userstoriesRaw, (us) -> return us.id == id

    refreshUserStory: (usId) ->
        usModel = @.getUsModel(usId)
        us = @.retrieveUserStoryData(usModel)
        @.usMap = @.usMap.set(usId, Immutable.fromJS(us))

    retrieveUserStoryData: (usModel) ->
        us = {}
        # React seam: `getAttrs()` is the existing `$tgModel` -> plain-object
        # boundary. It is also the in-repo precedent for immer pitfall
        # P-IMMER-1: immer drafts do not tolerate class instances, and
        # `$tgModel` instances carry dirty-tracking state. The React state
        # layer must perform the equivalent flattening before handing a user
        # story to `produce()`, just as this line does before the plain `us`
        # object returned below is frozen with Immutable's `fromJS()` by the
        # callers of this method.
        model = usModel.getAttrs()

        us.foldStatusChanged = @.foldStatusChanged[usModel.id]

        us.model = model
        us.images = _.filter model.attachments, (it) -> return !!it.thumbnail_card_url

        us.id = usModel.id
        us.swimlane = usModel.swimlane
        us.assigned_to = @.usersById[usModel.assigned_to]
        us.assigned_users = []

        usModel.assigned_users.forEach (assignedUserId) =>
            assignedUserData = @.usersById[assignedUserId]
            if assignedUserData
                us.assigned_users.push(assignedUserData)

        us.assigned_users_preview = us.assigned_users.slice(0, 3)

        us.colorized_tags = _.map us.model.tags, (tag) =>
            return {name: tag[0], color: tag[1]}

        return us

    refresh: (refreshUsMap = true, refreshSwimlanes = true) ->
        @.userstoriesRaw = _.sortBy @.userstoriesRaw, [(it) => @.order[it.id]]

        collection = {}

        for key, usModel of @.userstoriesRaw
            us = @.retrieveUserStoryData(usModel)
            if (!collection[usModel.status])
                collection[usModel.status] = []

            collection[usModel.status] = collection[usModel.status]
            .filter((id) => id != usModel.id)

            collection[usModel.status].push(usModel.id)

            if refreshUsMap
                @.usMap = @.usMap.set(usModel.id, Immutable.fromJS(us))

        @.usByStatus = Immutable.fromJS(collection)

        if refreshSwimlanes
            @.refreshSwimlanes()

    refreshSwimlanes: () ->
        if !@.swimlanes || !@.swimlanes.length
            return

        @.swimlanesList = Immutable.List()
        @.usByStatusSwimlanes = Immutable.Map()

        userstoriesNoSwimlane = @.userstoriesRaw.filter (us) =>
            return us.swimlane == null

        emptySwimlaneExists = @.swimlanesList.filter (swimlane) =>
            return swimlane.id == null

        if userstoriesNoSwimlane.length && !emptySwimlaneExists.size
            @.swimlanes.forEach (swimlane) =>
                if (!@.swimlanesList.includes(swimlane))
                    @.swimlanesList = @.swimlanesList.push(swimlane)

            emptySwimlane = {
                id: -1,
                kanban_order: 1,
                name: @translate.instant("KANBAN.UNCLASSIFIED_USER_STORIES")
            }
            @.swimlanesList = @.swimlanesList.insert(0, emptySwimlane)

        else
            @.swimlanes.forEach (swimlane) =>
                if (!@.swimlanesList.includes(swimlane))
                    @.swimlanesList = @.swimlanesList.push(swimlane)

        @.swimlanesList.forEach (swimlane) =>
            swimlaneUsByStatus = Immutable.Map()
            @.usByStatus.forEach (usList, statusId) =>
                usListSwimlanes = usList.filter (usId) =>
                    us = @.usMap.get(usId)
                    swimlaneId = if swimlane.id == -1 then null else swimlane.id
                    return us.getIn(['model', 'swimlane']) == swimlaneId

                swimlaneUsByStatus = swimlaneUsByStatus.set(Number(statusId), usListSwimlanes)

            @.usByStatusSwimlanes = @.usByStatusSwimlanes.set(swimlane.id, swimlaneUsByStatus)

angular.module("taigaKanban").service("tgKanbanUserstories", KanbanUserstoriesService)
