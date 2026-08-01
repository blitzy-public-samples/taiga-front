###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

taiga = @.taiga
bindOnce = @.taiga.bindOnce

module = angular.module("taigaBacklog")

#############################################################################
## Sortable Directive
#############################################################################

## RETIRED (React coexistence migration): the `tgBacklogSortable` directive
## registration is removed. Drag-and-drop for the backlog story table and the
## sprint sidebar is now owned by React, which replaces `dragula`,
## `dom-autoscroller` and `window.dragMultiple` with:
##
##   app/react/shared/dnd/DndProvider.tsx    -- the single @dnd-kit/core DndContext
##   app/react/shared/dnd/useSortableList.ts -- manual ordering from collision data
##   app/react/shared/dnd/multiDrag.ts       -- hand-built multi-select drag
##   app/react/backlog/hooks/useStoryDrag.ts -- the `pendingDrag` FIFO queue
##
## The `deleteElement` helper and the `BacklogSortableDirective` factory below are
## INTENTIONALLY RETAINED, unregistered, as the authoritative behavioural
## specification for those four files (AAP section 0.6.2). Nothing registers them,
## so the factory is never instantiated. DO NOT DELETE IT and DO NOT "clean it
## up": every locator in it is cited by the React implementation brief, and the
## dead locals and typos it carries are pre-existing and preserved deliberately so
## the reference stays faithful to the behaviour being reproduced.
##
## The contracts most easily broken while porting it:
##
##  * There are FOUR drop targets, not one -- `div.backlog-table-body`, BOTH
##    elements of the `$('.js-empty-backlog')` collection, and every `.sprint-table`
##    matched dynamically by `isContainer`. Miss the empty-backlog pair or the
##    sprint tables and dropping there silently stops working, with no error.
##  * Only elements carrying `row` are draggable (`moves`), and every row must
##    carry `data-id` -- it is the positional anchor for the whole write API.
##  * Three handlers cooperate through the closure: 'drag' captures `initIsBacklog`
##    and `oldIndex`, 'drop' derives `previousUs`/`nextUs` from POST-move DOM, and
##    'dragend' consumes all four and issues `ctrl.moveUs`. They are reset only
##    inside 'drop', so a cancelled drag -- which never fires 'drop' -- keeps the
##    previous drop's values; the `index == oldIndex && sameContainer` no-op return
##    is what absorbs that. Reproduce this protocol; do not tidy it into one
##    handler that resets on drag start, which would be a behaviour change.
##  * `previousUs` and `nextUs` are MUTUALLY EXCLUSIVE: `nextUs` is computed only
##    when `previousUs` is falsy, so `bulk-update-us-backlog-order` receives either
##    `after_userstory_id` or `before_userstory_id` -- never both.
##  * Starting a drag while velocity forecasting is on turns it OFF, and 'dragend'
##    removes the doom line document-wide. Both are load-bearing, not incidental.
##  * @dnd-kit emits none of dragula's classes, so React must add `gu-transit`,
##    `gu-mirror`, `multiple-drag-mirror` and the `drag-active` body class itself,
##    or the existing SCSS silently stops applying (rule T1 keeps stylesheet edits
##    at zero).
##  * The autoscroll options here are backlog-specific -- `[window]`, margin 20,
##    pixels 30 -- and differ from kanban's. Do not unify the two.

deleteElement = (el) ->
    $(el).scope().$destroy()
    $(el).off()
    $(el).remove()

BacklogSortableDirective = () ->
    link = ($scope, $el, $attrs) ->
        if !$scope.ctrl
            console.error('BacklogSortableDirective must have access to to BacklogCtrl')

        bindOnce $scope, "project", (project) ->
            # If the user has not enough permissions we don't enable the sortable
            if not (project.my_permissions.indexOf("modify_us") > -1) and !project.archived_code
                return

            initIsBacklog = false
            emptyBacklog = $('.js-empty-backlog')
            previousUs = null
            nextUs = null
            oldIndex = null

            drake = dragula([$el[0], emptyBacklog[0], emptyBacklog[1]], {
                copySortSource: false,
                copy: false,
                isContainer: (el) -> return el.classList.contains('sprint-table'),
                moves: (item) ->
                    if !$(item).hasClass('row')
                        return false

                    return true
            })

            drake.on 'drop', (item, target, source, sibling) ->
                previousUs = null
                nextUs = null

                prev = $(item).prevAll('.row:not(.gu-transit)')
                next = $(item).nextAll('.row:not(.gu-transit)')

                previousUs = null
                if prev.length && prev[0].dataset.id
                    previousUs = Number(prev[0].dataset.id)

                nextUs = null
                if !previousUs && next.length && next[0].dataset.id
                    nextUs = Number(next[0].dataset.id)

            drake.on 'drag', (item, container) ->
                if $scope.ctrl.displayVelocity
                    $scope.ctrl.toggleVelocityForecasting()

                # it doesn't move is the filter is open
                parent = $(item).parent()
                initIsBacklog = parent.hasClass('backlog-table-body')

                $(document.body).addClass("drag-active")

                isChecked = $(item).find("input[type='checkbox']").is(":checked")

                window.dragMultiple.start(item, container)

                dragMultipleItems = window.dragMultiple.getElements()

                firstElement = if dragMultipleItems.length then dragMultipleItems[0] else item

                parentEl = item.parentNode
                oldIndex = $(parentEl).find('tg-card').index(firstElement)

                if initIsBacklog
                    oldIndex = $(firstElement).index(".backlog-table-body .row")
                else
                    oldIndex = $(firstElement).index()

            drake.on 'cloned', (item) ->
                $(item).addClass('multiple-drag-mirror')

            drake.on 'dragend', (item) ->
                $('.doom-line').remove()

                parent = $(item).parent()

                isBacklog = parent.hasClass('backlog-table-body') || parent.hasClass('js-empty-backlog')

                if initIsBacklog || isBacklog
                    sameContainer = (initIsBacklog == isBacklog)
                else
                    sameContainer = parent && $(item).scope().sprint.id == parent.scope().sprint.id

                dragMultipleItems = window.dragMultiple.stop()

                $(document.body).removeClass("drag-active")

                sprint = null

                firstElement = if dragMultipleItems.length then dragMultipleItems[0] else item

                if isBacklog
                    index = $(firstElement).index(".backlog-table-body .row")
                else
                    index = $(firstElement).index()
                    sprint = parent.scope()?.sprint.id

                if index == oldIndex && sameContainer
                    return

                if !sameContainer
                    if dragMultipleItems.length
                        usList = _.map dragMultipleItems, (item) ->
                            return item = $(item).scope().us
                    else if $(item).scope()
                        usList = [$(item).scope().us]

                    if (dragMultipleItems.length)
                        _.each dragMultipleItems, (item) ->
                            deleteElement(item)
                    else
                        deleteElement(item)
                else
                    if dragMultipleItems.length
                        usList = _.map dragMultipleItems, (item) ->
                            return item = $(item).scope().us
                    else if $(item).scope()
                        usList = [$(item).scope().us]

                $scope.$applyAsync () =>
                    $scope.ctrl.moveUs("sprint:us:move", usList, index, sprint, previousUs, nextUs)

            scroll = autoScroll([window], {
                margin: 20,
                pixels: 30,
                scrollWhenOutside: true,
                autoScroll: () ->
                    return this.down && drake.dragging
            })

            $scope.$on "$destroy", ->
                $el.off()
                drake.destroy()

    return {link: link}

## RETIRED (React coexistence migration): the `tgBacklogSortable` directive
## registration that stood here, binding the name to `BacklogSortableDirective`,
## is removed. It is superseded by `app/react/shared/dnd/**` and
## `app/react/backlog/hooks/useStoryDrag.ts`; the factory above is retained as
## their behavioural reference, as explained at the top of this file. This file now
## registers nothing, which is deliberate. The `tg-backlog-sortable` attribute left
## on `app/partials/includes/modules/backlog-table.jade` is simply ignored by
## AngularJS. Note that `taigaBacklog` is still RETRIEVED above with no second
## argument: passing one would reset the module and silently detach
## `tgTaskboardSortable`, which attaches to it later in the build order from the
## out-of-scope `app/coffee/modules/taskboard/sortable.coffee`.
