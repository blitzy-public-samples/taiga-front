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

## RETIRED (React coexistence migration): the `tgKanbanSortable` registration is
## removed -- see the note at the removal point at the bottom of this file. React
## now owns Kanban drag-and-drop, so `dragula` + `dom-autoscroller` no longer drive
## this screen. The directive was applied as an attribute on `div.kanban-table` in
## `app/partials/includes/modules/kanban-table.jade` L11, alongside `tg-kanban`,
## `tg-kanban-swimlane` and `tg-kanban-squish-column`; that whole element is
## replaced by a single `tg-react-loader` host, and an unmatched attribute is
## ignored by AngularJS in any case, so nothing breaks while both trees coexist.
##
## THE FACTORY BELOW IS DELIBERATELY RETAINED, UNREGISTERED, as the AUTHORITATIVE
## BEHAVIOURAL SPECIFICATION for its React successors. It is dead code by design:
## nothing links it, so `dragula(...)` and `autoScroll(...)` are never called from
## here, yet every ordering rule, class name, DOM contract and event signature the
## React adapter must reproduce is recorded here and nowhere else. Successors:
##   * `app/react/shared/dnd/DndProvider.tsx`  -- the single `@dnd-kit/core`
##     `DndContext` shared by BOTH migrated screens (Kanban board + Backlog list).
##   * `app/react/shared/dnd/useSortableList.ts` -- ordering computed MANUALLY from
##     collision data.
##   * `app/react/shared/dnd/multiDrag.ts`     -- hand-built multi-select,
##     replacing `window.dragMultiple`.
##   * `app/react/kanban/hooks/useCardDrag.ts` -- the board-side consumer that must
##     emit the `kanban:us:move` contract documented at the broadcast below.
##
## THREE NAMED RISKS, because `@dnd-kit` does not cover these:
##
## R-DND-1  NO BUILT-IN MULTI-ITEM DRAG. Everything `window.dragMultiple`
##          (`app/js/dragula-drag-multiple.js` L223) provides must be hand-built in
##          `multiDrag.ts`: the selection set, the `getElements()` / `start()` /
##          `stop()` lifecycle used at the `drag` and `dragend` handlers below, AND
##          the multi-drag FEEDBACK MARKUP -- the `.card-transit-multi` wrapper with
##          its two `div.fake-us` ghost blocks that
##          `app/modules/components/card/card.jade` renders at L45-L55 as siblings
##          of `.card-inner`. That file is T4-protected (shared with the
##          out-of-scope taskboard): read it, never edit it.
##
## R-DND-2  ONLY `@dnd-kit/core` IS PINNED -- `@dnd-kit/sortable` is deliberately
##          NOT added -- so reordering must be computed manually from collision
##          data. Combined with the POSITION-RELATIVE write API
##          (`previousCard` / `nextCard` -> `after_userstory_id` /
##          `before_userstory_id`, resolved by `KanbanController.moveUs`
##          (`app/coffee/modules/kanban/main.coffee:692`) into
##          `data.afterUserstoryId` / `data.beforeUserstoryId` for
##          `bulkUpdateKanbanOrder`) an off-by-one SILENTLY PERSISTS A WRONG ORDER
##          with no error surface -- no toast, no console warning; it shows up only
##          on the next page load. `useSortableList` must therefore be unit-tested
##          with explicit FIRST-position, LAST-position and CROSS-CONTAINER cases.
##
## R-DND-3  NO VIRTUAL-LIST SUPPORT. Taiga already virtualises cards through the
##          `IntersectionObserver` in `app/js/boards.js`, which drives
##          `vm.inViewPort`. `app/react/shared/useInViewport.ts` must keep drag
##          targets REGISTERED FOR OFF-SCREEN CARDS, or dragging toward a collapsed
##          or not-yet-latched region finds no drop target.
##
## RETAINED DEPENDENCIES (requirement I3): `dragula` and `dom-autoscroller` STAY in
## `package.json` -- out-of-scope code still uses them, namely
## `app/coffee/modules/wiki/nav.coffee`,
## `app/coffee/modules/admin/project-values.coffee` (several call sites) and
## `app/coffee/modules/taskboard/sortable.coffee`. Do not touch `package.json` from
## this migration.
##
## RETAINED IMMUTABLE READS (requirement I5): the `dragend` handler below reads
## `kanbanUserstoriesService.usMap` (an `Immutable.Map`, see
## `app/coffee/modules/kanban/kanban-usertories.coffee:64`) with `.get('id')` and
## `.getIn(['model', ...])`. Those calls are NOT converted here; only the React
## reducers move to `immer`, and `immutable` stays installed for 124 other files.
KanbanSortableDirective = ($repo, $rs, $rootscope, kanbanUserstoriesService) ->
    link = ($scope, $el, $attrs) ->
        drake = null
        oldIndex = null

        # PER-SWIMLANE DROP-CONTAINER ENTRY POINT -- an entry point no summary of this
        # migration mentions, and the reason drag works at all in swimlane mode.
        # `KanbanController` calls it at `app/coffee/modules/kanban/main.coffee:848`,
        # from inside `$scope.kanbanTableLoaded`, whenever a swimlane is opened. The
        # containers are resolved by DOM query, NOT from model state:
        # `.kanban-swimlane[data-swimlane="<id>"] .taskboard-column`.
        # `app/react/shared/dnd/DndProvider.tsx` must register the newly rendered
        # swimlane's columns as drop targets on the SAME trigger; with the
        # registration retired this coupling now survives only as documentation.
        $scope.openSwimlane = (id) =>
            containers = _.map $('.kanban-swimlane[data-swimlane="' + id + '"] .taskboard-column'), (item) ->
                return item

            init(containers)

        # THREE GATES, IN THIS ORDER, and React must apply all three:
        #   1. `modify_us` must be present in `$scope.project.my_permissions` --
        #      read-only members get NO drag at all, not a rejected drop.
        #   2. an archived project (`archived_code`) gets NO drag.
        #   3. RE-ENTRANT REGISTRATION: when `drake` already exists this only PUSHES
        #      the new containers onto `drake.containers` and returns. One drake
        #      instance therefore accumulates containers as swimlanes open, which is
        #      why `DndProvider` is a SINGLE `DndContext` with a growing target set
        #      rather than one context per swimlane.
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

            # `deleteElement` removes the dragged clone from its ORIGINATING column
            # once the move is committed, so the card is not shown twice while the
            # digest catches up. NOTE, and this is not an oversight: unlike the
            # backlog equivalent there is NO `.scope().$destroy()` here -- only
            # `.off()` then `.remove()`. React's equivalent is simply not rendering
            # the card in its old column; do not port a scope teardown that the
            # original never performed.
            deleteElement = (itemEl) ->
                itemEl.off()
                itemEl.remove()

            # DRAGULA INIT (the `@dnd-kit` replacement target). `copy` and
            # `copySortSource` are both false, so this MOVES nodes, never clones them.
            # The drag-handle predicate is ELEMENT-NAME-BASED -- `$(item).is('tg-card')`
            # -- not class- or attribute-based: only a whole `tg-card` element is
            # draggable, and anything else inside a column is inert. React must keep
            # the draggable unit at the card root for the same reason.
            drake = dragula(containers, {
                copySortSource: false,
                copy: false,
                moves: (item) ->
                    return $(item).is('tg-card')
            })

            initialContainer = null

            # DROP-TARGET HIGHLIGHT (T1: the class name `target-drop` is the contract
            # `app/styles/modules/kanban/kanban-table.scss` styles, so React must emit
            # it verbatim). The FIRST `over` merely LATCHES the source column into
            # `initialContainer`; the highlight is added only for a container that is
            # NOT the source, so hovering your own column never highlights it.
            # `initialContainer` is reset to null on every `drag` below, which is what
            # makes the latch per-gesture rather than per-session.
            drake.on 'over', (item, container) ->
                if !initialContainer
                    initialContainer = container
                else if container != initialContainer
                    $(container).addClass('target-drop')

            drake.on 'out', (item, container) ->
                if container != initialContainer
                    $(container).removeClass('target-drop')

            # DRAG START. `window.dragMultiple.getElements()` returns the current
            # multi-selection; when EMPTY it falls back to `[item]`, so single-card and
            # multi-card drags share one code path from here on -- R-DND-1 requires
            # `app/react/shared/dnd/multiDrag.ts` to preserve exactly that fallback.
            # `oldIndex` is captured from the FIRST selected element's position among
            # its siblings and is compared in `dragend` to detect a no-op drop.
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

            # DRAG MIRROR. T1: `multiple-drag-mirror` on the floating mirror node is a
            # styling contract, and dragula's own `gu-mirror` / `gu-transit` classes are
            # read elsewhere -- `app/coffee/modules/kanban/main.coffee:1219` probes
            # `tg-card.gu-mirror` to answer "is a drag in progress?". React's drag
            # overlay must carry equivalent hooks for both purposes.
            drake.on 'cloned', (item, dropTarget) ->
                $(item).addClass('multiple-drag-mirror')

            # POSITION-RELATIVE NEIGHBOURS (R-DND-2). These two are the ONLY ordering
            # information sent to the server: `KanbanController.moveUs`
            # (`app/coffee/modules/kanban/main.coffee:692`) forwards them as
            # `after_userstory_id` / `before_userstory_id`. They are declared out here,
            # OUTSIDE the handlers, because `drop` computes them and `dragend` -- a
            # separate dragula event -- consumes them.
            previousCard = null
            nextCard = null

            # DROP. Neighbours are resolved from the LIVE DOM, skipping `.gu-transit`
            # (dragula's placeholder for the node being moved), so the reference cards
            # are real siblings and never the ghost.
            # THE ASYMMETRY IS DELIBERATE AND LOAD-BEARING: `previousCard` is taken
            # whenever a preceding card exists, and `nextCard` is computed ONLY when
            # `previousCard` is falsy -- i.e. only when the card was dropped at the head
            # of the column. Sending both, or sending `nextCard` unconditionally, would
            # change the server-side anchor. `useSortableList` must reproduce this
            # exactly; an off-by-one here persists a wrong order with NO error surface.
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

            # DRAG END -- the commit step, and the densest behaviour in this file.
            # `window.dragMultiple.stop()` both clears the selection and RETURNS it,
            # with the same `[item]` fallback as `drag`. Read the numbered notes inside
            # before writing `app/react/kanban/hooks/useCardDrag.ts`.
            drake.on 'dragend', (item, target, source, sibling) ->
                parentEl = item.parentNode
                dragMultipleItems = window.dragMultiple.stop()

                # if it is not drag multiple
                if !dragMultipleItems.length
                    dragMultipleItems = [item]

                firstElementId = dragMultipleItems[0].dataset.id
                firstElement = dragMultipleItems[0]

                # 1. THE DESTINATION IS READ FROM DOM DATA ATTRIBUTES, never from React
                #    or model state. `app/partials/includes/modules/kanban-table.jade`
                #    renders `.taskboard-column` (L112, L189) carrying
                #    `data-status="{{s.id}}"` (L119, L196) and
                #    `data-swimlane="{{swimlane.id}}"` (L76, L120), and each card carries
                #    `data-id="{{ usId }}"` (L151, L227). React MUST emit all of them
                #    verbatim: without `data-status` / `data-swimlane` drop resolution
                #    breaks, and without `data-id` the `usMap` lookup below and the
                #    `app/js/boards.js` virtualisation silently return nothing.
                #    `index` is the new position of the FIRST dragged card among its new
                #    siblings, and it is what `moveUs` forwards as the order index.
                index = $(parentEl).find('tg-card').index(firstElement)
                newStatus = Number(parentEl.dataset.status)
                newSwimlane = Number(parentEl.dataset.swimlane)

                # 2. NO-OP GUARD: same index AND same container means nothing moved, so
                #    NO event is broadcast and NO request is issued. React must keep this
                #    guard, or every click-and-release on a card writes to the API.
                if index == oldIndex && initialContainer == parentEl
                    return

                # 3. LANDING ANIMATION (T1): the destination column gets the class `new`,
                #    removed on the FIRST `animationend` via `.one`, and only when the
                #    card actually changed container. Same class name, same one-shot
                #    binding in React -- a permanent class would replay the animation.
                if initialContainer != parentEl
                    $(parentEl).addClass('new')

                    $(parentEl).one 'animationend', ()  ->
                        $(parentEl).removeClass('new')

                # 4. IMMUTABLE READS (I5, preserved as-is): `usMap` is an `Immutable.Map`
                #    keyed by user-story id (`kanban-usertories.coffee:64`), so the
                #    entries are Immutable Maps accessed with `.get()` / `.getIn()`. The
                #    payload is deliberately MINIMAL -- id plus the OLD status and OLD
                #    swimlane per story -- because the controller re-resolves the live
                #    models itself. React reducers move to `immer`, but they must send
                #    this same minimal shape, and must flatten with `.toJS()` at the
                #    bridge seam rather than handing Immutable structures across it.
                usList = _.map dragMultipleItems, (item) ->
                    return kanbanUserstoriesService.usMap.get(Number(item.dataset.id))

                finalUsList = _.map usList, (item)  ->
                    return {
                        id: item.get('id'),
                        oldStatusId: item.getIn(['model', 'status'])
                        oldSwimlaneId: item.getIn(['model', 'swimlane'])
                    }

                # 5. `$scope.$apply` is required ONLY because dragula fires outside the
                #    digest. React owns its own update cycle and MUST NEVER call
                #    `$rootScope.$apply()` from the new code -- digests stay AngularJS's
                #    concern. Note `|| -1` on the old swimlane: a story with a null
                #    swimlane is compared as -1, which is the same sentinel
                #    `KanbanController.moveUs` maps back to `null` for the API. Per-story
                #    (not per-drag) container comparison is why a multi-selection
                #    spanning columns removes only the clones that really moved.
                $scope.$apply ->
                    _.each usList, (item, key) =>
                        oldStatus = item.getIn(['model', 'status'])
                        oldSwimlaneId = item.getIn(['model', 'swimlane']) || -1
                        sameContainer = newStatus == oldStatus && newSwimlane == oldSwimlaneId

                        if !sameContainer
                            itemEl = $(dragMultipleItems[key])
                            deleteElement(itemEl)

                    # 6. THE CONTRACT -- the single most important line in this file.
                    #    `app/react/kanban/hooks/useCardDrag.ts` MUST emit this event
                    #    with THIS name and THIS argument list, in this order:
                    #      (finalUsList, newStatus, newSwimlane, index, previousCard,
                    #       nextCard)
                    #    because two retained AngularJS consumers listen for it:
                    #      * `KanbanController` at
                    #        `app/coffee/modules/kanban/main.coffee:322`
                    #        (`@scope.$on("kanban:us:move", @.moveUs)`), whose handler
                    #        signature `moveUs: (ctx, usList, newStatusId,
                    #        newSwimlaneId, index, previousCard, nextCard)` (`:692`)
                    #        aligns positionally after the `$on` event object -- it
                    #        performs the ONLY persistence, via
                    #        `bulkUpdateKanbanOrder`, so React must NOT write directly
                    #        (T5).
                    #      * the retired-but-retained `KanbanWipLimitDirective`, which
                    #        registers this same event as a marker redraw trigger at
                    #        `app/coffee/modules/kanban/main.coffee:1098`.
                    #    Renaming the event, reordering the arguments or dropping
                    #    `previousCard` / `nextCard` breaks persistence AND the WIP
                    #    marker at once, with no error surface.
                    $rootscope.$broadcast("kanban:us:move", finalUsList, newStatus, newSwimlane, index, previousCard, nextCard)

            # AUTOSCROLL (`dom-autoscroller`): a 100 px activation margin,
            # `scrollWhenOutside: true` so the board keeps scrolling once the pointer
            # leaves the viewport, and an `autoScroll` predicate that only scrolls while
            # the pointer is down AND dragula reports an active drag.
            # `app/react/shared/dnd/**` must reproduce all three: dropping the margin
            # makes long columns unreachable, and dropping the predicate scrolls the
            # board on plain hover.
            scroll = autoScroll(containers, {
                margin: 100,
                scrollWhenOutside: true,
                autoScroll: () ->
                    return this.down && drake.dragging
            })

        # TWO MUTUALLY EXCLUSIVE INITIALISATION PATHS -- this is the part most likely
        # to be missed. FLAT MODE registers every `.taskboard-column` in one shot from
        # this watch, then unwatches; SWIMLANE MODE registers nothing here and instead
        # relies on `$scope.openSwimlane(id)` above, called per swimlane as it loads.
        # The discriminator is `$('.swimlane').length`, i.e. the class applied by
        # `app/partials/kanban/kanban.jade:17`
        # (`section.main.kanban(ng-class="{ 'swimlane': swimlanesList.size }")`, KEPT by
        # this migration), so it depends on `swimlanesList` remaining an Immutable List
        # with a truthy `.size`. NOTE the watch is NOT unwatched on the swimlane path --
        # it returns BEFORE `unwatch()` -- which is deliberate, because the flag can be
        # re-evaluated as swimlanes arrive. `$scope.isTableLoaded` starts false
        # (`app/coffee/modules/kanban/main.coffee:842`), so React needs an equivalent
        # "board not ready yet" gate before it registers any drop target.
        unwatch = $scope.$watch "isTableLoaded", (tableLoaded) ->
            return if !tableLoaded

            isSwimlane = $('.swimlane').length

            # in swimlanes we load every swimlane with kanbanTableLoaded
            return if isSwimlane

            unwatch()

            containers = _.map $el.find('.taskboard-column'), (item) ->
                return item

            init(containers)

        # TEARDOWN: detach the element handlers, then `drake.destroy()` if a drake was
        # ever created (it is not, on a read-only or archived project -- hence the
        # guard). The `useEffect` cleanup in `app/react/shared/dnd/DndProvider.tsx` is
        # the direct equivalent and is NOT optional: leaving listeners or drop
        # containers registered after unmount leaks across route changes, and the leak
        # is silent -- it shows up only as duplicate handling after navigating away and
        # back to the board.
        $scope.$on "$destroy", ->
            $el.off()

            if drake
                drake.destroy()

    return {link: link}

## The `tgKanbanSortable` registration used to sit here. It is UNREGISTERED ON
## PURPOSE (React coexistence migration) and nothing was lost by accident: the
## factory above is now REFERENCE-ONLY, kept as the behavioural specification for
## `app/react/shared/dnd/DndProvider.tsx`, `app/react/shared/dnd/useSortableList.ts`,
## `app/react/shared/dnd/multiDrag.ts` and `app/react/kanban/hooks/useCardDrag.ts`.
## See the retirement note above `KanbanSortableDirective` for the full rationale and
## for risks R-DND-1..3. This leaves the file with ZERO AngularJS registrations,
## which is expected here -- but the `module` handle assigned at L18 above is still a
## RETRIEVAL of `taigaKanban` and must never gain a second argument: passing `[]`
## from here would reset the shared module and, because `paths.coffee_order` in
## `gulpfile.js` concatenates `coffee/modules/taskboard/*.coffee` (L147) BEFORE
## `coffee/modules/kanban/*.coffee` (L148), would silently detach the out-of-scope
## taskboard's `tgTaskboardIssues` (`taskboard/taskboard-issues.coffee:81`) and
## `tgTaskboardTasks` (`taskboard/taskboard-tasks.coffee:157`) at bootstrap
## (requirement I1).
