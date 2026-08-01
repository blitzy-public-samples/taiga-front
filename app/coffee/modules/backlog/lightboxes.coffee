###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

taiga = @.taiga
bindOnce = @.taiga.bindOnce
debounce = @.taiga.debounce

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
## This file now carries ZERO AngularJS registrations, BY DESIGN. Its single
## directive registration (`tgLbCreateEditSprint`) is retired at the foot of the
## file; the sprint create/edit form is rendered by
## `app/react/backlog/SprintFormLightbox.tsx`. The `CreateEditSprint` factory
## below is deliberately LEFT IN PLACE, unregistered, because it is the
## authoritative validation-behaviour reference for that React successor -- only
## the registration call itself is removed. See the retirement comment at the
## foot of the file for the full behavioural inventory.
#############################################################################

#############################################################################
## Creare/Edit Sprint Lightbox Directive
#############################################################################

CreateEditSprint = ($repo, $confirm, $rs, $rootscope, lightboxService, $loading, $translate, projectService, $timeout) ->
    link = ($scope, $el, attrs) ->
        hasErrors = false
        createSprint = true
        form = null
        $scope.newSprint = {}
        ussToAdd = null
        $scope.createEditOpen = false

        resetSprint = () ->
            form.reset() if form

            $scope.newSprint = {
                project: null
                name: null
                estimated_start: null
                estimated_finish: null
            }

        submit = debounce 2000, (event) =>
            event.preventDefault()
            target = angular.element(event.currentTarget)
            prettyDate = $translate.instant("COMMON.PICKERDATE.FORMAT")

            submitButton = $el.find(".submit-button")
            form = $el.find("form").checksley()

            if not form.validate()
                hasErrors = true
                $el.find(".last-sprint-name").addClass("disappear")
                return

            hasErrors = false
            broadcastEvent = null

            estimated_start = $('.date-start').val()
            estimated_end = $('.date-end').val()

            if createSprint
                newSprint = angular.copy($scope.newSprint)
                newSprint.estimated_start = moment(estimated_start, prettyDate).format("YYYY-MM-DD")
                newSprint.estimated_finish = moment(estimated_end, prettyDate).format("YYYY-MM-DD")

                promise = $repo.create("milestones", newSprint)
                broadcastEvent = "sprintform:create:success"
            else
                newSprint = $scope.newSprint.realClone()
                newSprint.estimated_start =  moment(estimated_start, prettyDate).format("YYYY-MM-DD")
                newSprint.estimated_finish = moment(estimated_end, prettyDate).format("YYYY-MM-DD")

                promise = $repo.save(newSprint)
                broadcastEvent = "sprintform:edit:success"

            currentLoading = $loading()
                .target(submitButton)
                .start()

            promise.then (data) ->
                currentLoading.finish()
                $scope.sprintsCounter += 1 if createSprint

                $scope.sprints = _.map $scope.sprints, (it) ->
                    if it.id == data.id
                        return data
                    else
                        return it

                if broadcastEvent == "sprintform:create:success" && ussToAdd
                    $rootscope.$broadcast(broadcastEvent, data, ussToAdd)
                else
                    $rootscope.$broadcast(broadcastEvent, data)

                lightboxService.close($el)
                $scope.createEditOpen = false

            promise.then null, (data) ->
                currentLoading.finish()

                form.setErrors(data)
                if data._error_message
                    $confirm.notify("light-error", data._error_message)
                else if data.__all__
                    $confirm.notify("light-error", data.__all__[0])

        remove = ->
            title = $translate.instant("LIGHTBOX.DELETE_SPRINT.TITLE")
            message = $scope.newSprint.name

            $confirm.askOnDelete(title, message).then (askResponse) =>
                onSuccess = ->
                    askResponse.finish()
                    $scope.milestonesCounter -= 1
                    lightboxService.close($el)
                    $scope.createEditOpen = false
                    $rootscope.$broadcast("sprintform:remove:success", $scope.newSprint)

                onError = ->
                    askResponse.finish(false)
                    $confirm.notify("error")
                $repo.remove($scope.newSprint).then(onSuccess, onError)

        getLastSprint = ->
            openSprints = _.filter $scope.sprints, (sprint) ->
                return !sprint.closed

            sortedSprints = _.sortBy openSprints, (sprint) ->
                return moment(sprint.estimated_finish, 'YYYY-MM-DD').format('X')

            return sortedSprints[sortedSprints.length - 1]

        # wait to ensure that scope.createEditOpen has been updated in the html
        openFn = (cb) ->
            $scope.$applyAsync () ->
                $timeout () ->
                    cb()
                , 0

         $scope.$on "sprintform:create", (event, projectId, uss) ->
            $scope.createEditOpen = true

            openFn () ->
                ussToAdd = uss
                resetSprint()

                form = $el.find("form").checksley()
                form.reset()

                createSprint = true
                prettyDate = $translate.instant("COMMON.PICKERDATE.FORMAT")
                $scope.newSprint.project = projectId
                $scope.newSprint.name = null
                $scope.newSprint.slug = null

                lastSprint = getLastSprint()

                estimatedStart = moment()

                if lastSprint
                    estimatedStart = moment(lastSprint.estimated_finish)
                else if $scope.newSprint.estimated_start
                    estimatedStart = moment($scope.newSprint.estimated_start)

                $scope.newSprint.estimated_start = estimatedStart.format(prettyDate)

                estimatedFinish = moment().add(2, "weeks")

                if lastSprint
                    estimatedFinish = moment(lastSprint.estimated_finish).add(2, "weeks")
                else if $scope.newSprint.estimated_finish
                    estimatedFinish = moment($scope.newSprint.estimated_finish)

                $scope.newSprint.estimated_finish = estimatedFinish.format(prettyDate)

                lastSprintNameDom = $el.find(".last-sprint-name")
                if lastSprint?.name?
                    text = $translate.instant("LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME", {
                                lastSprint: lastSprint.name})
                    lastSprintNameDom.html(text)

                $el.find(".delete-sprint").addClass("hidden")

                text = $translate.instant("LIGHTBOX.ADD_EDIT_SPRINT.TITLE")
                $el.find(".title").text(text)

                text = $translate.instant("COMMON.CREATE")
                $el.find(".button-green").text(text)

                lightboxService.open($el)
                $el.find(".sprint-name").focus()
                $el.find(".last-sprint-name").removeClass("disappear")

        $scope.$on "sprintform:edit", (ctx, sprint) ->
            $scope.createEditOpen = true

            openFn () ->
                resetSprint()

                createSprint = false
                prettyDate = $translate.instant("COMMON.PICKERDATE.FORMAT")

                $scope.$apply () ->
                    $scope.newSprint = sprint.realClone()
                    $scope.newSprint.estimated_start = moment($scope.newSprint.estimated_start).format(prettyDate)
                    $scope.newSprint.estimated_finish = moment($scope.newSprint.estimated_finish).format(prettyDate)

                if projectService.canEdit('delete_milestone')
                    $el.find(".delete-sprint").removeClass("hidden")

                editSprint = $translate.instant("BACKLOG.EDIT_SPRINT")
                $el.find(".title").text(editSprint)

                save = $translate.instant("COMMON.SAVE")
                $el.find(".button-green").text(save)

                lightboxService.open($el)
                $el.find(".sprint-name").focus().select()
                $el.find(".last-sprint-name").addClass("disappear")

        $el.on "keyup", ".sprint-name", (event) ->
            if $el.find(".sprint-name").val().length > 0 or hasErrors
                $el.find(".last-sprint-name").addClass("disappear")
            else
                $el.find(".last-sprint-name").removeClass("disappear")

        $el.on "submit", "form", submit

        $el.on "click", ".delete-sprint", (event) ->
            event.preventDefault()
            remove()

        $scope.$on "$destroy", ->
            $el.off()

        resetSprint()

    return {link: link}


## RETIRED (React coexistence migration): the `tgLbCreateEditSprint` directive
## registration is removed. The sprint create/edit lightbox is superseded by
## `app/react/backlog/SprintFormLightbox.tsx`, which builds its shell from the
## in-repo `lightbox()` mixin (`app/styles/dependencies/mixins/lightbox.scss`)
## and its markup from `app/partials/includes/modules/lightbox-sprint-add-edit.jade`
## -- never from a Figma frame, because neither frame captures any lightbox state.
## With this registration gone the file registers nothing at all; the now-inert
## `tg-lb-create-edit-sprint` attribute on `app/partials/backlog/backlog.jade:201`
## is simply ignored by AngularJS.
##
## The `CreateEditSprint` factory above is retained as the authoritative
## behavioural reference for that successor. What it specifies:
##
##  * FOUR validation rules, declared in the jade, replacing `checksley`:
##    `name` required + maxlength 500, `estimated_start` required,
##    `estimated_finish` required. No custom validator needs porting -- the
##    global `re_weburl` validator from `app/coffee/app.coffee:957` is unused here.
##  * TWO DISTINCT debounces: a 200 ms *model* debounce on `name`
##    (`ng-model-options` in the jade) and the 2,000 ms *submit* debounce at the
##    head of `submit` above. They are not interchangeable.
##  * Reset-on-open: `form.reset()` runs inside the `sprintform:create` handler,
##    after `resetSprint()`, every time the lightbox opens.
##  * Dates are read FROM THE DOM (`.date-start` / `.date-end`), not from the
##    model, then converted with `moment(value, prettyDate).format("YYYY-MM-DD")`
##    where `prettyDate` is the locale-driven `COMMON.PICKERDATE.FORMAT`.
##  * The failure path adds `.disappear` to `.last-sprint-name` and returns.
##  * Delete is gated on the `delete_milestone` permission.
##  * Writes go through `$tgRepo`: `$repo.create("milestones", ...)` on create and
##    `$repo.save(...)` after `realClone()` on edit, so `$tgModel` dirty-tracking
##    keeps PATCHing only changed fields plus the optimistic-concurrency
##    `version`. React must reuse this layer, never a hand-rolled HTTP client.
##  * Three broadcasts MUST keep firing: `sprintform:create:success`,
##    `sprintform:edit:success` and `sprintform:remove:success`. The out-of-scope
##    `app/modules/services/project.service.coffee:43-45` lists all three in
##    `fetchRequiredSignals`, so dropping any one silently stops the project
##    refetch -- a cross-screen regression. `BacklogController` also listens.
