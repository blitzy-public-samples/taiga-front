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
## Shared card directives -- MOVED HERE VERBATIM, NOT NEW BEHAVIOUR
#############################################################################
## `tgCardAssignedTo`, `tgCardData` and `tgCardActions` -- together with the
## `_.template`-compiled SVG heredoc all three of them share -- were relocated out
## of `app/coffee/modules/kanban/main.coffee` (source block L855-L1126) when that
## file's AngularJS kanban view layer was superseded by the React board. Not one
## line of their bodies, signatures, DI arrays, isolate-scope bindings or template
## paths changed, and they stay registered on this SAME `taigaKanban` module under
## identical names, so NO consumer anywhere needs an edit. Requirement I2.
##
## WHY THEY SURVIVE THE RETIREMENT. They render the SHARED `tg-card` component
## under `app/modules/components/card/**`, which rule T4 marks MUST NOT CHANGE:
## `card.jade` emits `tg-card-actions` (L16-L20), `tg-card-assigned-to` (L26-L30)
## and `tg-card-data` (L31-L36). That component is ALSO rendered by the
## OUT-OF-SCOPE taskboard at `app/partials/includes/modules/taskboard-table.jade`
## L135 and L186, so retiring these three would silently strip the kebab menu, the
## assigned-user avatar and the card body from every taskboard card.
##
## WHY THE SVG HEREDOC TRAVELLED WITH THEM. The Gulp `coffee` task compiles each
## `.coffee` file INDIVIDUALLY (`gulpfile.js` L515) and only afterwards
## concatenates the results into `app.js` (L520); CoffeeScript wraps every compiled
## file in its own `(function(){...}).call(this)` IIFE, so file-scope variables do
## NOT cross file boundaries in the bundle. Leaving the heredoc behind in
## `main.coffee` would have raised a `ReferenceError` on the first card render,
## taking the taskboard down along with the board.
##
## WHY THE MODULE IS RETRIEVED, NOT DECLARED. The lookup above passes NO second
## argument, deliberately. Passing one would re-declare `taigaKanban` and reset it,
## wiping `tgTaskboardIssues` (`taskboard/taskboard-issues.coffee` L81) and
## `tgTaskboardTasks` (`taskboard/taskboard-tasks.coffee` L157), because
## `paths.coffee_order` concatenates `coffee/modules/taskboard/*.coffee`
## (`gulpfile.js` L146) BEFORE `coffee/modules/kanban/*.coffee` (L147). The one
## declaring call stays at `app/coffee/modules/kanban.coffee` L9. Requirement I1.
##
## WHY `item` IS STILL IMMUTABLE HERE. The `tg-card` contract hands `item` in as an
## Immutable structure and these bodies read it with `.get()`, `.getIn([...])`,
## `.size` and `.forEach`. That is deliberately NOT converted: plain objects and
## `immer` drafts live only in the new React state layer under
## `app/react/kanban/state/`, fed by data flattened at the `react-bridge.coffee`
## seam. Flattening it here would break the must-not-change shared component, and
## the out-of-scope taskboard with it.
##
## NO BUILD CHANGE IS NEEDED: `paths.coffee` already matches this path
## (`gulpfile.js` L133) and `paths.coffee_order` already orders it (L147).
#############################################################################

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

