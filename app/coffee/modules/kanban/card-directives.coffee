###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

#############################################################################
## Shared card directives (React coexistence migration)
#############################################################################
## MOVED IN, NOT NEW BEHAVIOUR. `tgCardAssignedTo`, `tgCardData` and
## `tgCardActions` -- together with the `CardSvgTemplate` heredoc that all three
## of them compile with `_.template(...)` -- were relocated VERBATIM out of
## `app/coffee/modules/kanban/main.coffee` (formerly L855-L1125) when that file's
## AngularJS kanban view layer was retired in favour of the React board. Not one
## line of their bodies changed, and they stay registered on this SAME
## `taigaKanban` module under identical names, so not one consumer changes.
##
## WHY THEY SURVIVE THE RETIREMENT. They render the SHARED `tg-card` component in
## `app/modules/components/card/**`, which is must-not-modify. `card.jade` emits
## `tg-card-actions` (L16), `tg-card-assigned-to` (L26) and `tg-card-data` (L31),
## and that component is also rendered by the OUT-OF-SCOPE taskboard at
## `app/partials/includes/modules/taskboard-table.jade` L135 and L186. Retiring
## these three directives would silently strip the avatar, the ref/subject/points
## body and the kebab menu from every taskboard card -- a regression on a screen
## this migration does not touch.
##
## WHY THE SVG HEREDOC HAD TO TRAVEL WITH THEM. The Gulp `coffee` task compiles
## each `.coffee` file INDIVIDUALLY and only afterwards concatenates the results
## into `app.js`, and CoffeeScript wraps every compiled file in its own
## `(function(){...}).call(this)` IIFE -- so file-scope variables do NOT cross
## file boundaries in the bundle. Leaving `CardSvgTemplate` behind in
## `main.coffee` would have raised a `ReferenceError` the first time any card
## rendered, taking down the taskboard along with the board.
##
## WHY NO BUILD CHANGE IS NEEDED. This path is already matched by
## `app/coffee/modules/kanban/*.coffee` in both `paths.coffee` and
## `paths.coffee_order` (`gulpfile.js` L133/L147), so the file is compiled and
## concatenated into `app.js` with no gulpfile edit.
#############################################################################

taiga = @.taiga

module = angular.module("taigaKanban")

CardSvgTemplate = """
    <tg-svg>
        <svg class="icon <%- svgIcon %>" style="fill: <%- svgFill %>">
            <use xlink:href="#<%- svgIcon %>" attr-href="#<%- svgIcon %>">
                <% if(svgTitle) { %>
                <title><%- svgTitle %></title>
                <% } %>
            </use>
        </svg>
    </tg-svg>
    """

CardAssignedToDirective = ($template, $translate, avatarService, projectService) ->
    template = $template.get("components/card/card-templates/card-assigned-to.html", true)
    svgTemplate  = _.template(CardSvgTemplate)

    render = (vm) =>
        avatars = {}
        (vm.item.get('assigned_users') || [vm.item.get('assigned_to')]).forEach (user) =>
            if user
                avatars[user.get('id')] = avatarService.getAvatar(user, 'avatar')

        return template({
            vm: vm,
            avatars: avatars,
            translate: (key, params) =>
                return $translate.instant(key, params)
            checkPermission: (permission) =>
                return projectService.hasPermission(permission)
            svg: (svgData) =>
                return svgTemplate(Object.assign({
                    svgTitle: '',
                    svgFill: ''
                }, svgData))
            loading: """
                <img
                    class='loading-spinner'
                    src='#{window._version}/svg/spinner-circle.svg'
                    alt='loading...'
                />
            """
        })

    return {
        scope: {
            zoomLevel: '<',
            item: '<',
            vm: '<'
        },
        link: ($scope, $el) ->
            initializeZoom = false

            onChange = () =>
                html = render($scope.vm)
                $el.off()

                $el.html(html)

                $el.find('.card-user-avatar').on 'click', (event) =>
                    if !event.ctrlKey && !event.metaKey
                        $scope.vm.onClickAssignedTo({id: $scope.vm.item.get('id')})

            $scope.$watch 'item', onChange
            # ignore the first watch because is the same as item
            $scope.$watch 'zoomLevel', () =>
                if initializeZoom
                    onChange()
                else
                    initializeZoom = true

            $scope.$on "$destroy", ->
                $el.off()
    }


module.directive("tgCardAssignedTo", [
    "$tgTemplate",
    "$translate",
    "tgAvatarService",
    "tgProjectService",
    CardAssignedToDirective])

CardDataDirective = ($template, $translate, avatarService, projectService, dueDateService) ->
    template = $template.get("components/card/card-templates/card-data.html", true)
    svgTemplate  = _.template(CardSvgTemplate)

    render = (vm) =>
        avatars = {}
        (vm.item.get('assigned_users') || []).forEach (user) =>
            if user
                avatars[user.get('id')] = avatarService.getAvatar(user, 'avatar')
            else
                console.error 'invalid assigned_users', vm.item.get('assigned_users').toJS()

        return template({
            vm: vm,
            avatars: avatars,
            emptyTask: () =>
                tasks = vm.item.getIn(['model', 'tasks'])
                return !tasks || !tasks.size
            dueDateColor: () =>
                dueDateService.color({
                    dueDate: vm.item.getIn(['model', 'due_date']),
                    isClosed: vm.item.getIn(['model', 'is_closed']),
                    objType: vm.type
                })
            dueDateTitle: () =>
                dueDateService.title({
                    dueDate: vm.item.getIn(['model', 'due_date']),
                    isClosed: vm.item.getIn(['model', 'is_closed']),
                    objType: vm.type
                })
            totalAttachments: () =>
                if vm.type == 'task'
                    return vm.item.getIn(['model', 'attachments']).size
                else
                    return vm.item.getIn(['model', 'total_attachments'])

            translate: (key, params) =>
                return $translate.instant(key, params)
            svg: (svgData) =>
                return svgTemplate(Object.assign({
                    svgTitle: '',
                    svgFill: ''
                }, svgData))
        })

    return {
        scope: {
            zoomLevel: '<',
            item: '<',
            vm: '<'
        },
        link: ($scope, $el) ->
            initializeZoom = false

            onChange = () =>
                html = render($scope.vm)
                $el.off()

                $el.html(html)

            $scope.$watch 'item', onChange
            # ignore the first watch because is the same as item
            $scope.$watch 'zoomLevel', () =>
                if initializeZoom
                    onChange()
                else
                    initializeZoom = true

            $scope.$on "$destroy", ->
                $el.off()
    }

module.directive("tgCardData", [
    "$tgTemplate",
    "$translate",
    "tgAvatarService",
    "tgProjectService",
    "tgDueDateService",
    CardDataDirective])


CardActionsDirective = ($template, $translate, projectService) ->
    template = $template.get("components/card/card-templates/card-actions.html", true)
    svgTemplate  = _.template(CardSvgTemplate)

    render = (vm) =>
        return template({
            vm: vm,
            translate: (key, params) =>
                return $translate.instant(key, params)
            checkPermission: (permission) =>
                return projectService.canEdit(permission)
            svg: (svgData) =>
                return svgTemplate(Object.assign({
                    svgTitle: '',
                    svgFill: ''
                }, svgData))
        })

    return {
        scope: {
            zoomLevel: '<',
            item: '<',
            vm: '<'
        },
        link: ($scope, $el) ->
            initializeZoom = false
            openPopup = false

            removePopupOpenState = () ->
                openPopup = false
                $el.find(".js-popup-button").removeClass('popover-open')

            onChange = () =>
                html = render($scope.vm)
                $el.off()

                $el.html(html)
                openPopup = false
                $el.find('.js-popup-button').on 'click', (event) =>
                    if openPopup
                        return

                    openPopup = true
                    $(event.currentTarget).addClass('popover-open')

                    actions = []

                    if projectService.canEdit($scope.vm.getModifyPermisionKey())
                        actions.push(
                            {
                                text: $translate.instant('COMMON.CARD.EDIT'),
                                icon: 'icon-edit'
                                event: () ->
                                    $scope.vm.onClickEdit({id: $scope.vm.item.get('id')})
                            },
                            {
                                text: $translate.instant('COMMON.CARD.ASSIGN_TO'),
                                icon: 'icon-assign-to',
                                event: () ->
                                    $scope.vm.onClickAssignedTo({id: $scope.vm.item.get('id')})
                            },
                        )

                    if projectService.canEdit($scope.vm.getDeletePermisionKey())
                        actions.push(
                            {
                                text: $translate.instant('COMMON.CARD.DELETE'),
                                icon: 'icon-trash',
                                event: () ->
                                    $scope.vm.onClickDelete({id: $scope.vm.item.get('id')})
                            },
                        )

                    if projectService.canEdit($scope.vm.getModifyPermisionKey()) && !$scope.vm.isFirst
                        actions.push(
                            {
                                text: $translate.instant('COMMON.CARD.MOVE_TO_TOP'),
                                icon: 'icon-move-to-top',
                                event: () ->
                                    $scope.vm.onClickMoveToTop($scope.vm.item)
                            },
                        )

                    taiga.globalPopover(
                        event.currentTarget,actions,
                        {},
                        () ->
                            removePopupOpenState()
                    )

            $scope.$watch 'item', onChange
            # ignore the first watch because is the same as item
            $scope.$watch 'zoomLevel', () =>
                if initializeZoom
                    onChange()
                else
                    initializeZoom = true

            $scope.$on "$destroy", ->
                $el.off()
    }


module.directive("tgCardActions", [
    "$tgTemplate",
    "$translate",
    "tgProjectService",
    CardActionsDirective])

