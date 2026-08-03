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

module = angular.module("taigaKanban")

#############################################################################
## Sortable Directive
#############################################################################

KanbanSortableDirective = ($repo, $rs, $rootscope, kanbanUserstoriesService) ->
    link = ($scope, $el, $attrs) ->
        drake = null
        oldIndex = null

        # The drop-container entry point for swimlane mode: the controller calls this
        # as each swimlane opens, and the containers are resolved by DOM query rather
        # than from model state, so a swimlane's columns only become drop targets
        # once they are actually rendered.
        $scope.openSwimlane = (id) =>
            containers = _.map $('.kanban-swimlane[data-swimlane="' + id + '"] .taskboard-column'), (item) ->
                return item

            init(containers)

        # Three gates, in this order: without `modify_us` and on an archived project
        # there is no drag at all rather than a rejected drop; and the third is
        # re-entrant, pushing new containers onto the existing instance instead of
        # creating a second one, so one instance accumulates containers as swimlanes
        # open.
        init = (containers) =>
            if not ($scope.project.my_permissions.indexOf("modify_us") > -1)
                return

            if $scope.project.archived_code
                return

            if drake
                containers.forEach (container) =>
                    drake.containers.push(container)

                return
            newParentScope = null
            itemEl = null
            tdom = $el

            deleteElement = (itemEl) ->
                itemEl.off()
                itemEl.remove()

            drake = dragula(containers, {
                copySortSource: false,
                copy: false,
                moves: (item) ->
                    return $(item).is('tg-card')
            })

            initialContainer = null

            drake.on 'over', (item, container) ->
                if !initialContainer
                    initialContainer = container
                else if container != initialContainer
                    $(container).addClass('target-drop')

            drake.on 'out', (item, container) ->
                if container != initialContainer
                    $(container).removeClass('target-drop')

            drake.on 'drag', (item) ->
                dragMultipleItems = window.dragMultiple.getElements()

                # if it is not drag multiple
                if !dragMultipleItems.length
                    dragMultipleItems = [item]

                firstElement = dragMultipleItems[0]

                parentEl = item.parentNode
                oldIndex = $(parentEl).find('tg-card').index(firstElement)
                initialContainer = null
                window.dragMultiple.start(item, containers)

            drake.on 'cloned', (item, dropTarget) ->
                $(item).addClass('multiple-drag-mirror')

            previousCard = null
            nextCard = null

            # The two neighbours are the only ordering information the server gets, and
            # they are resolved here rather than at drag end because only the live DOM
            # knows where the card landed. The placeholder node is skipped so the
            # references are real siblings. The asymmetry is load-bearing: `nextCard`
            # is computed ONLY when there is no preceding card, so a head-of-column
            # drop anchors forwards and every other drop anchors backwards. Sending
            # both would move the server-side anchor.
            drake.on 'drop', (item, target, source, sibling) ->
                previousCard = null
                nextCard = null
                prev = $(item).prevAll('tg-card:not(.gu-transit)')
                next = $(item).nextAll('tg-card:not(.gu-transit)')

                previousCard = null
                if prev.length && prev[0].dataset.id
                    previousCard = Number(prev[0].dataset.id)

                nextCard = null
                if !previousCard && next.length && next[0].dataset.id
                    nextCard = Number(next[0].dataset.id)

            drake.on 'dragend', (item, target, source, sibling) ->
                parentEl = item.parentNode
                dragMultipleItems = window.dragMultiple.stop()

                # if it is not drag multiple
                if !dragMultipleItems.length
                    dragMultipleItems = [item]

                firstElementId = dragMultipleItems[0].dataset.id
                firstElement = dragMultipleItems[0]

                index = $(parentEl).find('tg-card').index(firstElement)
                newStatus = Number(parentEl.dataset.status)
                newSwimlane = Number(parentEl.dataset.swimlane)

                if index == oldIndex && initialContainer == parentEl
                    return

                if initialContainer != parentEl
                    $(parentEl).addClass('new')

                    $(parentEl).one 'animationend', ()  ->
                        $(parentEl).removeClass('new')

                usList = _.map dragMultipleItems, (item) ->
                    return kanbanUserstoriesService.usMap.get(Number(item.dataset.id))

                finalUsList = _.map usList, (item)  ->
                    return {
                        id: item.get('id'),
                        oldStatusId: item.getIn(['model', 'status'])
                        oldSwimlaneId: item.getIn(['model', 'swimlane'])
                    }

                $scope.$apply ->
                    _.each usList, (item, key) =>
                        oldStatus = item.getIn(['model', 'status'])
                        oldSwimlaneId = item.getIn(['model', 'swimlane']) || -1
                        sameContainer = newStatus == oldStatus && newSwimlane == oldSwimlaneId

                        if !sameContainer
                            itemEl = $(dragMultipleItems[key])
                            deleteElement(itemEl)

                    # This broadcast is the whole drag contract. `KanbanController`
                    # matches these six arguments positionally after the event object
                    # and performs the only persistence, and the WIP marker uses the
                    # same event as its redraw trigger. Renaming it, reordering the
                    # arguments or dropping either neighbour breaks persistence and the
                    # marker at once, with no error surface.
                    $rootscope.$broadcast("kanban:us:move", finalUsList, newStatus, newSwimlane, index, previousCard, nextCard)

            scroll = autoScroll(containers, {
                margin: 100,
                scrollWhenOutside: true,
                autoScroll: () ->
                    return this.down && drake.dragging
            })

        # Two mutually exclusive initialisation paths, discriminated by the `swimlane`
        # class on the section: flat mode registers every column in one shot here and
        # then unwatches, whereas swimlane mode registers nothing here and relies on
        # `openSwimlane` above. The swimlane path returns BEFORE `unwatch()` on
        # purpose, so the discriminator is re-evaluated as swimlanes arrive.
        unwatch = $scope.$watch "isTableLoaded", (tableLoaded) ->
            return if !tableLoaded

            isSwimlane = $('.swimlane').length

            # in swimlanes we load every swimlane with kanbanTableLoaded
            return if isSwimlane

            unwatch()

            containers = _.map $el.find('.taskboard-column'), (item) ->
                return item

            init(containers)

        # Teardown must detach the handlers and destroy the instance, and the guard is
        # required because no instance exists on a read-only or archived project.
        # Leaving containers registered after teardown leaks silently across route
        # changes: it surfaces only as duplicate handling on returning to the board.
        $scope.$on "$destroy", ->
            $el.off()

            if drake
                drake.destroy()

    return {link: link}
