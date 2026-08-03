###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

taiga = @.taiga

module = angular.module("taigaKanban")

## These three directives render the shared `tg-card` component, which the
## out-of-scope taskboard also uses, so they stay registered on `taigaKanban`
## under these names and keep reading `item` as an Immutable structure.
##
## The SVG template lives in this file rather than beside its former neighbours
## because the Gulp `coffee` task compiles each file individually before
## concatenating, and CoffeeScript wraps every compiled file in its own IIFE --
## file-scope variables do not cross file boundaries in the bundle.

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
        invalidAssignedUsers = 0
        (vm.item.get('assigned_users') || []).forEach (user) =>
            if user
                avatars[user.get('id')] = avatarService.getAvatar(user, 'avatar')
            else
                # DIAGNOSTIC, SANITISED. The upstream form of this line was
                # `console.error 'invalid assigned_users', vm.item.get('assigned_users').toJS()`,
                # which serialised the ENTIRE assigned-user collection into the
                # browser console on a single malformed entry. Those user objects
                # carry full names, usernames, avatar URLs and other profile
                # metadata, so one nullish array slot published the personal data of
                # every assignee on the card to anyone with the console open -- and
                # console output is routinely pasted into tickets and screenshots.
                # A count answers the only question the log can usefully answer
                # ("did the server send a hole in this array, and how many?"), and
                # the offending payload is inspectable from the network response or
                # the database by whoever is entitled to see it.
                invalidAssignedUsers += 1

        if invalidAssignedUsers > 0
            console.error("invalid assigned_users: #{invalidAssignedUsers} entry/entries were empty")

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
