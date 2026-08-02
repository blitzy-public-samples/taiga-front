###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

taiga = @.taiga

module = angular.module("taigaBacklog")

#############################################################################
## AngularJS / React coexistence seam (strangler-fig migration)
##
## This module is RETRIEVED, never re-declared. `angular.module("taigaBacklog")`
## must NEVER gain a second argument: the declaration is owned by
## `app/coffee/modules/backlog.coffee:9` (`angular.module("taigaBacklog", [])`)
## and `app/coffee/modules/taskboard/sortable.coffee:17` retrieves the SAME
## module *after* this folder in the Gulp `coffee_order`. Passing `[]` here would
## reset the module and silently detach the out-of-scope taskboard's
## `tgTaskboardSortable` at bootstrap.
##
## The four view-layer directives this file used to register are retired below.
## The sprint sidebar and its sprint cards are now rendered by the React tree
## under `app/react/backlog/**`, mounted through the `tg-react-loader` custom
## element and fed by `app/coffee/modules/backlog/react-bridge.coffee`:
##
##   tgBacklogSprint                           -> app/react/backlog/SprintCard.tsx
##   tgBacklogSprintHeader                     -> app/react/backlog/SprintCard.tsx (header region)
##   tgBacklogToggleClosedSprintsVisualization -> app/react/backlog/SprintSidebar.tsx (closed-sprints toggle)
##   tgSprint                                  -> app/react/backlog/SprintCard.tsx
##
## This file therefore now carries ZERO AngularJS registrations, BY DESIGN. That
## is a deliberate end state, not an oversight and not a half-finished edit: only
## the four directive-registration calls themselves are removed. Every factory
## function below is INTENTIONALLY RETAINED, unregistered, because the AAP
## designates these bodies as the authoritative behavioural specification the
## React successors are built from (AAP section 0.6.2). Nothing instantiates
## them, so they have no runtime effect. DO NOT DELETE THEM and DO NOT "clean up":
## the dead locals, the shared factory-scope state and the unused parameter they
## carry are pre-existing and are preserved deliberately so the reference stays
## faithful to the behaviour being reproduced.
##
## The contracts most easily broken while porting them:
##
##  * `$rootScope.$broadcast("sprintform:edit", sprint)` is what opens the
##    RETAINED sprint lightbox (`backlog/lightboxes.coffee:211`). React must fire
##    the identical event with the identical payload -- it already does, from
##    `backlog/react-bridge.coffee:430`.
##  * The closed-sprints toggle drives `backlog:unload-closed-sprints` /
##    `backlog:load-closed-sprints`, consumed by the retained `BacklogController`
##    (`backlog/main.coffee:258-259`), and listens for `closed-sprints:reloaded`,
##    which that controller fires (`backlog/main.coffee:325` and `:341`). All
##    three names must survive verbatim or the toggle silently stops reloading.
##  * Two DIFFERENT classes on two DIFFERENT elements express one open/closed
##    state: `active` on `.compact-sprint` and `open` on `.sprint-table`. React
##    must emit both so `app/styles/modules/backlog/sprints.scss` applies with
##    zero edits (rule T1).
##
## The now-inert `tg-backlog-sprint`, `tg-sprint`, `tg-backlog-sprint-header` and
## `tg-backlog-toggle-closed-sprints-visualization` attributes still present in
## `app/partials/includes/modules/sprints.jade` and `app/partials/backlog/sprint.jade`
## are simply ignored by AngularJS once nothing is registered for them. So is the
## `tg-sprint-sortable` attribute on that same partial, which was ALREADY dead
## before this change: no `tgSprintSortable` directive has ever been registered
## anywhere in the repository. It needs no React equivalent (rule T10).
##
## PRE-EXISTING DEFECTS DELIBERATELY PRESERVED (rule T10). Listed here in one
## place so they can be transcribed into the Drift Register under
## `e2e-react/artifacts/figma-comparison/` without hunting through the file, and
## so no later reader mistakes any of them for an oversight to tidy up:
##
##   1. `sprintTableMinHeight = 50` -- declared, never read (dead local).
##   2. `excludeClosedSprints = true` -- factory scope, therefore shared by every
##      instance of the directive rather than per-element.
##   3. `SprintDirective = (avatarService) ->` with `SprintDirective.$inject = []`
##      -- AngularJS injected nothing, so the parameter was always `undefined`.
##   4. `excludeClosedSprints  = not excludeClosedSprints` -- double space.
##   5. `toggleSprint = ($el) =>` -- a fat arrow where a thin one would do, which
##      is why coffeelint reports one `no_unnecessary_fat_arrows` warning here.
##      That warning predates this change and is left in place.
##
## A sixth defect left the file with the code it belonged to rather than being
## fixed: the retired `tgBacklogSprintHeader` registration was missing its comma
## after `"$translate"`. CoffeeScript treated the newline as the element
## separator, so the emitted DI array was always correct and the omission was
## purely cosmetic. It disappeared with the registration call itself.
#############################################################################

#############################################################################
## Sprint Actions Directive
#############################################################################

BacklogSprintDirective = ($repo, $rootscope) ->
    sprintTableMinHeight = 50
    slideOptions = {
        duration: 500,
        easing: 'linear'
    }

    toggleSprint = ($el) =>
        sprintTable = $el.find(".sprint-table")
        sprintArrow = $el.find(".compact-sprint")

        sprintArrow.toggleClass('active')
        sprintTable.toggleClass('open')

    link = ($scope, $el, $attrs) ->
        $scope.$watch $attrs.tgBacklogSprint, (sprint) ->
            sprint = $scope.$eval($attrs.tgBacklogSprint)

            if sprint.closed
                $el.addClass("sprint-closed")
            else
                toggleSprint($el)

        # Event Handlers
        $el.on "click", ".sprint-name > .compact-sprint", (event) ->
            event.preventDefault()

            toggleSprint($el)

            $el.find(".sprint-table").slideToggle(slideOptions)

        $el.on "click", ".edit-sprint", (event) ->
            event.preventDefault()

            sprint = $scope.$eval($attrs.tgBacklogSprint)
            $rootscope.$broadcast("sprintform:edit", sprint)

        $scope.$on "$destroy", ->
            $el.off()

    return {link: link}

## RETIRED (React coexistence migration): the `tgBacklogSprint` directive
## registration that stood here, binding the name to `BacklogSprintDirective`
## with `["$tgRepo", "$rootScope", ...]`, is removed. The sprint card and its
## expand/collapse behaviour are superseded by `app/react/backlog/SprintCard.tsx`.
## The `BacklogSprintDirective` factory above is retained, unregistered, as that
## component's authoritative behavioural reference. What it specifies:
##
##  * `toggleSprint` toggles `active` on `.compact-sprint` and `open` on
##    `.sprint-table` -- TWO classes on TWO elements for one logical state.
##  * The initial `$watch` branches on `sprint.closed`: a closed sprint gets
##    `sprint-closed` on the host and is NOT toggled open; an open sprint is
##    toggled instead. React must reproduce that asymmetry, not normalise it.
##  * Clicking `.sprint-name > .compact-sprint` calls `preventDefault()`, toggles
##    the classes, and then ALSO runs jQuery `slideToggle` at
##    `{duration: 500, easing: 'linear'}` -- the class toggle and the animation
##    are separate effects, and the CSS alone does not produce the slide.
##  * Clicking `.edit-sprint` re-evaluates the sprint expression and broadcasts
##    `"sprintform:edit"` with it. That is the contract opening the retained
##    lightbox at `backlog/lightboxes.coffee:211`; the payload must be the sprint
##    object itself. `backlog/react-bridge.coffee:430` already fires it.
##  * `sprintTableMinHeight = 50` is declared and never read. It is a pre-existing
##    dead local, preserved deliberately (rule T10) -- do not port it and do not
##    delete it here.


#############################################################################
## Sprint Header Directive
#############################################################################

BacklogSprintHeaderDirective = ($navUrls, $template, $compile, $translate) ->
    template = $template.get("backlog/sprint-header.html")

    link = ($scope, $el, $attrs, $model) ->
        prettyDate = $translate.instant("BACKLOG.SPRINTS.DATE")

        isEditable = ->
            return !$scope.project.archived_code and $scope.project.my_permissions.indexOf("modify_milestone") != -1

        isVisible = ->
            return $scope.project.my_permissions.indexOf("view_milestones") != -1

        render = (sprint) ->
            taskboardUrl = $navUrls.resolve("project-taskboard",
                                            {project: $scope.project.slug, sprint: sprint.slug})

            start = moment(sprint.estimated_start).format(prettyDate)
            finish = moment(sprint.estimated_finish).format(prettyDate)

            estimatedDateRange = "#{start}-#{finish}"

            ctx = {
                name: sprint.name
                taskboardUrl: taskboardUrl
                estimatedDateRange: estimatedDateRange
                closedPoints: sprint.closed_points or 0
                totalPoints: sprint.total_points or 0
                isVisible: isVisible()
                isEditable: isEditable()
            }

            templateScope = $scope.$new()

            _.assign(templateScope, ctx)

            compiledTemplate = $compile(template)(templateScope)
            $el.html(compiledTemplate)

        $scope.$watch "sprint", (sprint) ->
            render(sprint)

        $scope.$on "$destroy", ->
            $el.off()

    return {
        link: link
        restrict: "EA"
    }

## RETIRED (React coexistence migration): the `tgBacklogSprintHeader` directive
## registration that stood here, binding the name to
## `BacklogSprintHeaderDirective` with
## `["$tgNavUrls", "$tgTemplate", "$compile", "$translate", ...]`, is removed. It
## is superseded by the header region of `app/react/backlog/SprintCard.tsx`. The
## `BacklogSprintHeaderDirective` factory above is retained, unregistered, as that
## region's authoritative behavioural reference. What it specifies:
##
##  * `restrict: "EA"` -- the only directive in this file with an explicit
##    restrict, so it matched BOTH `<tg-backlog-sprint-header>` and the attribute
##    form used at `app/partials/backlog/sprint.jade:8` (`header(...)`).
##  * The date range is `"#{start}-#{finish}"` with NO spaces around the hyphen,
##    each side formatted by `moment(...).format(prettyDate)` where `prettyDate`
##    is the locale-driven `BACKLOG.SPRINTS.DATE` translation. Reproduce the
##    concatenation exactly; a padded hyphen is a visible regression.
##  * `closedPoints` and `totalPoints` both default via `or 0`, so a sprint with
##    null points renders 0 rather than blank.
##  * TWO independent permission gates, both read from `my_permissions`:
##    `isVisible` needs `view_milestones`; `isEditable` needs `modify_milestone`
##    AND `!project.archived_code`. React must evaluate the same array rather
##    than deriving its own notion of what the user may do.
##  * The taskboard link is resolved through `$tgNavUrls` as
##    `"project-taskboard"` with `{project: <slug>, sprint: <slug>}` -- the
##    destination screen stays AngularJS and out of scope, so the resolved URL
##    must keep pointing at it.
##  * Rendering re-runs on every `$watch "sprint"` tick, rebuilding the context
##    from scratch. The `$compile`/`$scope.$new()` template mechanics are an
##    AngularJS implementation detail with no React counterpart; only the context
##    values above carry over.


#############################################################################
## Toggle Closed Sprints Directive
#############################################################################

ToggleExcludeClosedSprintsVisualization = ($rootscope, $loading, $translate) ->
    excludeClosedSprints = true

    link = ($scope, $el, $attrs) ->
        # insert loading wrapper
        loadingElm = $("<div>")
        $el.after(loadingElm)

        currentLoading = null

        # Event Handlers
        $el.on "click", (event) ->
            event.preventDefault()
            excludeClosedSprints  = not excludeClosedSprints

            currentLoading = $loading()
                .target(loadingElm)
                .start()

            if excludeClosedSprints
                $rootscope.$broadcast("backlog:unload-closed-sprints")
            else
                $rootscope.$broadcast("backlog:load-closed-sprints")

        $scope.$on "$destroy", ->
            $el.off()

        $scope.$on "closed-sprints:reloaded", (ctx, sprints) ->
            if currentLoading
                currentLoading.finish()

            if sprints.length > 0
                key = "BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS"
            else
                key = "BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS"

            text = $translate.instant(key)

            $el.find(".text").text(text)

    return {link: link}

## RETIRED (React coexistence migration): the
## `tgBacklogToggleClosedSprintsVisualization` directive registration that stood
## here, binding the name to `ToggleExcludeClosedSprintsVisualization` with
## `["$rootScope", "$tgLoading", "$translate", ...]`, is removed. It is superseded
## by the closed-sprints toggle in `app/react/backlog/SprintSidebar.tsx`. The
## `ToggleExcludeClosedSprintsVisualization` factory above is retained,
## unregistered, as that toggle's authoritative behavioural reference. What it
## specifies:
##
##  * THREE event names must survive verbatim, or the toggle silently stops
##    working with no error: it broadcasts `"backlog:unload-closed-sprints"` when
##    excluding and `"backlog:load-closed-sprints"` when including -- both consumed
##    by the retained `BacklogController` at `backlog/main.coffee:258-259` -- and
##    it listens for `"closed-sprints:reloaded"`, which that same controller fires
##    at `backlog/main.coffee:325` and `:341`. React reaches the first two through
##    `loadClosedSprints` / `unloadClosedSprints` on the bridge
##    (`backlog/react-bridge.coffee:383-384`).
##  * The label is driven by the RELOADED PAYLOAD, not by the toggle's own flag:
##    `sprints.length > 0` selects `BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS`,
##    otherwise `BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS`, written into
##    `.text` inside the control. Deriving it from local state instead desynchs
##    the label whenever the server returns nothing.
##  * A `$tgLoading` spinner targets a bare `$("<div>")` inserted AFTER the
##    control, started on click and finished only when `closed-sprints:reloaded`
##    arrives -- so the spinner's lifetime spans the round trip.
##  * `excludeClosedSprints = true` lives at FACTORY scope, so it was shared by
##    every instance of the directive rather than per-element, and it starts
##    excluded. This is a pre-existing quirk, preserved deliberately (rule T10);
##    it is recorded in the Drift Register rather than fixed here. React owns this
##    state per sidebar, which is the same observable behaviour while the sidebar
##    is rendered once, as it is on this screen.

SprintDirective = (avatarService) ->
    return {
        templateUrl: 'backlog/sprint.html'
        scope: {
            sprint: '=',
            project: '=',
        }
    }

SprintDirective.$inject = []

## RETIRED (React coexistence migration): the `tgSprint` directive registration
## that stood here -- a BARE factory reference with no DI array, unlike the other
## three in this file -- is removed. It is superseded by
## `app/react/backlog/SprintCard.tsx`. The `SprintDirective` factory above is
## retained, unregistered, as that component's authoritative behavioural
## reference. What it specifies:
##
##  * An isolate scope of exactly `{sprint: '=', project: '='}` -- those two
##    values, and nothing else, are the component's inputs.
##  * `templateUrl: 'backlog/sprint.html'`, i.e. the compiled
##    `app/partials/backlog/sprint.jade`. That partial stays the markup and
##    class-name source for the React card (rule T1), never a Figma frame, since
##    neither frame captures this element's non-default states.
##  * `avatarService` is declared as a parameter while `SprintDirective.$inject`
##    is `[]`, so AngularJS injected nothing and the parameter was always
##    `undefined` and unused. A pre-existing latent defect, harmless, preserved
##    deliberately (rule T10) and recorded in the Drift Register -- do not "fix"
##    it and do not give the React component an avatar dependency because of it.
##
## Retiring this name is safe: an exact-token sweep of `app/` and `e2e/` finds no
## consumer of `tgSprint` outside this folder. The four apparent hits are all
## substring false positives -- `tgSprintProgressbar`
## (`common/components.coffee:95` and `:111`), `$tgSprintsResourcesProvider`
## (`resources.coffee:273`, `resources/sprints.coffee:63`) and `tgSprintChart`
## (`taskboard/charts.coffee:127`) -- and none of them resolves to this directive.
##
## With this last registration gone the file registers NOTHING AT ALL, which is
## the deliberate end state described at the head of the file.
