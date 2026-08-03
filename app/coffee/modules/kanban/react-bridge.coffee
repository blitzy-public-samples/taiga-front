###
# This source code is licensed under the terms of the
# GNU Affero General Public License found in the LICENSE file in
# the root directory of this source tree.
#
# Copyright (c) 2021-present Kaleidos INC
###

module = angular.module("taigaKanban")

# The AngularJS -> React seam for the Kanban board. `KanbanController` remains the
# data, permission, realtime and write layer; this factory only publishes the
# `{component, params, events}` payload that `tgLoadElement` assigns onto the host
# element as DOM PROPERTIES. Properties, not attributes, is the whole trick:
# attributes stringify their values, so only properties carry nested objects and
# callbacks across the boundary intact. The React root mounts in light DOM, because
# a shadow root would sever the global stylesheet cascade and break `<use>`
# references into the sprite inlined in the document.
#
# The payload is a ONE-TIME HAND-OFF, not a state stream. `tgLoadElement` watches it
# by reference identity, so rebuilding it re-renders React on every digest while
# mutating it in place notifies nothing at all. `params` is therefore an honest
# construction-time snapshot and every value that has to stay current is also
# reachable through an accessor in `events`.
#
# Nothing that is not plain JSON may cross: persistent collections and models are
# flattened here, because a model carries the dirty-tracking state that makes
# changed-fields-only PATCH work. The AngularJS-side structures stay persistent on
# the scope, since out-of-scope consumers depend on their `.size` and `.getIn()`
# contracts.
#
# It is a factory rather than a directive because the controller injects it by this
# exact name; a directive would be published as `…Directive` and the injector would
# fail to link the whole view subtree.

# A copy with AngularJS's private `$$` bookkeeping removed, which is mandatory
# rather than cosmetic: `ng-repeat` without a `track by` stamps `$$hashKey` onto
# every object it iterates, and anything React freezes would then make the next
# repeat pass throw. `angular.toJson` is reused because it already drops `$$` keys
# at every depth and substitutes a sentinel for a window, a document or a scope,
# which makes passing one of those across the seam structurally impossible.
stripAngularPrivates = (value) ->
    return value if not angular.isObject(value)
    json = angular.toJson(value)
    return value if not json?
    return angular.fromJson(json)

# MEMO FOR THE PERSISTENT-COLLECTION BRANCH OF `toPlain` BELOW.
#
# WHY THIS EXISTS. The four board projections are read through live accessors in
# `events`, so `getUsByStatus()` and its siblings are called whenever React needs
# the current board -- and each call used to walk the whole projection twice, once
# to flatten it and once more through `angular.toJson`/`angular.fromJson`. On a
# real board that is O(board-size) allocation per read, and worse, EVERY read
# handed back a fresh deep object graph. Fresh identities are exactly what
# `React.memo` cannot see through, so the structural sharing that replaces
# immutable.js change detection (`P-IMMER-4`) was being thrown away at the seam
# that exists to preserve it.
#
# WHY KEYING ON SOURCE IDENTITY IS SOUND HERE, AND ONLY HERE. Every value reaching
# this cache is a PERSISTENT collection -- the branch is guarded on `.toJS()`
# existing. `taiga.defineImmutableProperty` (`app/coffee/utils.coffee:177-190`)
# refuses to publish anything else: its getter throws
# "defineImmutableProperty must return immutable data" for an object with no
# `.size`, which is what guarantees that `usByStatus`, `usMap`,
# `usByStatusSwimlanes` and `swimlanesList` (`main.coffee:144-154`) really are
# persistent. A persistent collection is never mutated in place: any change
# produces a NEW object. Its identity therefore IS its version, and that is the
# explicit invalidation -- a changed collection arrives as a cache MISS by
# construction, with no version counter to maintain and nothing to remember to
# call. `foldedSwimlane` qualifies for the same reason (`Immutable.Map` at
# `main.coffee:132`, replaced wholesale at `:680`).
#
# WHY THE OTHER TWO BRANCHES ARE DELIBERATELY NOT MEMOISED. A `$tgModel` instance
# mutates its own attributes in place (`base/model.coffee`), and a plain scope
# object can be mutated in place by AngularJS as well, so for those two the
# identity says nothing about the contents and a cache would serve a stale copy.
# They keep converting on every read, which is exactly what they do today: this
# change removes repeated work without changing what any value converts to.
#
# A `WeakMap` rather than a `Map`, so a superseded collection is collected with its
# copy and the cache cannot grow without bound over a long session. One per
# `build(ctrl)` call, so two screens never share it.
createImmutableSnapshotCache = () ->
    cache = new WeakMap()

    return (collection) ->
        cached = cache.get(collection)
        return cached if cached isnt undefined

        snapshot = stripAngularPrivates(collection.toJS())
        cache.set(collection, snapshot)
        return snapshot

# Flatten one value at the seam. Persistent collections expose `.toJS()`;
# `$tgModel` instances expose `.getAttrs()` (`base/model.coffee:48`). The order
# matters because a persistent collection has no `.getAttrs()` and a model has no
# `.toJS()`, so at most one branch can ever apply. Whatever the unwrapping
# produces is then copied and cleaned by `stripAngularPrivates` above. Plain
# scalars, including `0`, `false` and `""`, fall through untouched.
#
# The persistent branch answers from `snapshotOf`, so an unchanged collection is
# converted ONCE and every later read returns the same object -- see
# `createImmutableSnapshotCache` for why that is sound for this branch alone. The
# conversion itself is unchanged: the same `.toJS()`, the same deep copy and the
# same `$$`-stripping, on the same values.
#
# ⭐ THE MODEL AND PLAIN BRANCHES ARE RECURSIVE, AND THAT IS A CORRECTNESS FIX
# RATHER THAN THOROUGHNESS. `getAttrs()` is `_.extend({}, @._attrs,
# @._modifiedAttrs)` (`base/model.coffee:48-54`), which is ONE LEVEL DEEP: every
# nested array and every nested object -- including nested `$tgModel` instances,
# which is what a milestone's `user_stories` holds -- survives the copy BY
# REFERENCE. A single-level flatten therefore hands React live, AngularJS-owned
# structures wearing a plain wrapper, and both consequences are silent:
#
#   * a nested model reaches React carrying its dirty-tracking state, so a
#     reducer sees `_attrs`/`_modifiedAttrs` bookkeeping instead of story fields,
#     and `immer` cannot proxy a class instance at all (`P-IMMER-1`); and
#   * with `autoFreeze` on (`P-IMMER-4`), anything React puts in state is FROZEN,
#     so the next in-place AngularJS mutation of that very object throws from
#     inside the retained controller -- a fault reported from a line that names
#     neither this file nor React.
#
# `stripAngularPrivates` already deep-copies through `angular.toJson`, so a plain
# value with no model and no persistent collection anywhere inside it is detached
# in one step. The recursion exists for the MIXED case: a plain array or object
# whose members are models or collections, which JSON cannot unwrap because a
# model serialises its private slots rather than its attributes. Every branch
# ends in a copy, so NOTHING mutable crosses by identity except a memoised
# persistent snapshot, whose source can never be mutated in place.
toPlain = (snapshotOf, value) ->
    return value if not value?
    return snapshotOf(value) if angular.isFunction(value.toJS)
    return toPlainDeep(snapshotOf, value.getAttrs()) if angular.isFunction(value.getAttrs)
    return toPlainDeep(snapshotOf, value)

# Deep-convert a value that is already plain at its top level but whose members
# may not be. Arrays and plain objects are rebuilt member by member through
# `toPlain`, so a nested model or collection is unwrapped at whatever depth it
# sits; anything else -- a scalar, a `Date`, a `RegExp` -- goes to
# `stripAngularPrivates`, which copies it and drops AngularJS's `$$` bookkeeping.
#
# `angular.isObject` is FALSE for a function and TRUE for an array, so the array
# test has to come first. A `Date` is deliberately left to
# `stripAngularPrivates`: `angular.toJson` renders it as its ISO string, which is
# exactly what the wire carries and what React should hold.
toPlainDeep = (snapshotOf, value) ->
    return value if not value?

    if angular.isArray(value)
        return (toPlain(snapshotOf, item) for item in value)

    return stripAngularPrivates(value) if not isPlainConvertibleObject(value)

    converted = {}
    for own key, member of value
        continue if key.charAt(0) == '$'
        converted[key] = toPlain(snapshotOf, member)
    return converted

# Whether `toPlainDeep` should walk this object's own members rather than hand it
# to `angular.toJson`. Only a plain object qualifies: a `Date`, a `RegExp`, a
# `File` and every other exotic host object must keep going through
# `stripAngularPrivates`, which has one well-defined rendering for each of them.
#
# `Object.getPrototypeOf` rather than `constructor`, because an object built by
# `angular.fromJson` or by an object literal has `Object.prototype`, while a
# `$tgModel` -- already handled by the caller -- and every other class instance
# does not. A null prototype qualifies too: `Object.create(null)` is as plain as
# a literal.
isPlainConvertibleObject = (value) ->
    return false if not angular.isObject(value) or angular.isArray(value)
    return false if angular.isDate(value) or angular.isElement(value)
    prototype = Object.getPrototypeOf(value)
    return prototype == null or prototype == Object.prototype

# Flatten a plain AngularJS array whose members may be models. Anything that is
# not an array -- most often a collection the async load chain has not populated
# yet -- becomes an empty array, so React never has to guard a `.map()`.
#
# The ARRAY itself is not memoised, and must not be: it is a plain JavaScript
# array on the scope, so AngularJS can push into it in place and its identity says
# nothing about its contents. Its persistent MEMBERS, if any, still come from the
# cache through `toPlain`.
toPlainList = (snapshotOf, list) ->
    return [] if not angular.isArray(list)
    return (toPlain(snapshotOf, item) for item in list)

toMyPermissions = (project) ->
    return [] if not project or not angular.isArray(project.my_permissions)
    return project.my_permissions.slice()

# Resolve the PLAIN USER-STORY ATTRIBUTES that the retained `moveUsToTop` reads --
# `us.id`, `us.status` and `us.swimlane` (`main.coffee:241-266`) -- out of whatever
# the React side hands over.
#
# ⭐ THIS EXISTS BECAUSE `moveToTopDropdown` CANNOT BE DELEGATED VERBATIM. The
# retained method is `@.moveUsToTop(us.toJS().model)` (`main.coffee:239-240`): it
# takes an IMMUTABLE card straight out of `usMap` and unwraps it in TWO steps --
# `.toJS()` for the persistent collection, then `.model` for the story attributes
# nested inside the card (`kanban-usertories.coffee:307` is where that member is
# written). §6 of the header flattens `usMap` AT THIS SEAM, so the value React
# holds is the ALREADY-`toJS()`-ed card and the first step has already happened.
# Calling the Immutable-only wrapper with it would throw
# `us.toJS is not a function` the first time a card's "move to top" action is
# used -- a crash inside the retained controller, reported from a line that names
# neither this file nor React. The SECOND unwrapping step is still required, and
# it is performed here.
#
# Accepts either shape so no call site can get it wrong: a flattened card, which
# carries `.model`, or the story attributes themselves. `moveUsToTop` and the
# `moveUs` it delegates to are safe with plain attributes -- `moveUs` re-resolves
# every live `$tgModel` by id at `main.coffee:695-696` -- which is why no model
# lookup is needed on this path, unlike the backlog seam.
toStoryAttrs = (card) ->
    return null if not angular.isObject(card)
    return card.model if angular.isObject(card.model)
    return card

# Register a React handler for an AngularJS event on the CONTROLLER'S scope and
# hand back AngularJS's own deregistration function.
#
# ⭐ `snapshotOf` IS A REQUIRED FIRST PARAMETER, NOT AN OPTIONAL EXTRA. `toPlain`
# takes `(snapshotOf, value)`, so calling it with the payload alone would bind the
# payload to `snapshotOf` and leave `value` undefined -- and `toPlain` answers
# `undefined` for an absent value, which means EVERY broadcast would reach React
# with an undefined payload. Nothing would throw: the handler would simply be
# handed nothing, on every event, for the life of the screen. The per-screen cache
# is created inside `build(ctrl)`, so it is threaded down to here rather than
# reached through a module-level variable, which also keeps two screens from ever
# sharing one cache.
#
# ⭐ THE WRAPPER IS THE POINT, NOT CEREMONY. `$scope.$on` invokes its listener as
# `(event, payloadArgs...)`, so passing a React handler straight through would (a)
# hand React AngularJS's event object -- which carries `targetScope` and
# `currentScope` references and would put a live `$scope` on the React side of the
# seam, the one thing §6 forbids most firmly -- and (b) SHIFT every real payload
# argument by one position, silently. The wrapper drops the event object and
# forwards only the payload, flattened by the seam's single `toPlain` helper so no
# persistent collection and no `$tgModel` can cross either.
#
# ⭐ THE PAYLOAD ARRIVES AT THE REACT HANDLER AS ARGUMENT 1. A React consumer must
# therefore be written `(payload) -> …`, never `(event, payload) -> …`; the
# registrar types in `app/react/kanban/hooks/useKanbanRealtime.ts` and
# `app/react/backlog/hooks/useBacklogRealtime.ts` spell that out for the compiler.
#
# Returning the deregistration function is equally load-bearing: React MUST call
# it from its `useEffect` cleanup, and a leak here is silent -- it surfaces only as
# duplicated work after navigating away and back.
#
# The four events `app/react/kanban/hooks/useWipLimit.ts` subscribes to, matching
# the retired `KanbanWipLimitDirective` (`main.coffee:1097-1100`) event for event,
# all reach THIS scope:
#   * `redraw:wip` -- `@scope.$broadcast` on this very scope (`main.coffee:272`,
#     `:283`, `:429`, `:492`, `:724`); `$broadcast` fires the emitting scope's own
#     listeners as well as its descendants'.
#   * `kanban:us:move` -- `$rootscope.$broadcast` (`sortable.coffee:341`), which
#     propagates DOWN through this scope.
#   * `usform:new:success` / `usform:bulk:success` -- `$rootscope.$broadcast` from
#     the shared lightbox (`common/lightboxes.coffee:375`), same downward path.
# `$emit` would NOT be observable here, which is exactly why
# `app/react/bridge/useTranslate.ts` reaches the root scope through its own named
# accessor instead of through this channel.
registerAngularEvent = (snapshotOf, $scope, eventName, handler) ->
    return angular.noop if not angular.isFunction(handler)

    deregister = $scope.$on eventName, (event, args...) ->
        handler.apply(null, (toPlain(snapshotOf, arg) for arg in args))

    return deregister

# One prefix for every refusal this file can emit, so a denied action is greppable
# and cannot be mistaken for an application error.
DENIED_PREFIX = "[tgKanbanReactBridge]"

# Log a refusal WITHOUT logging what was refused beyond the permission name.
# Deliberately no ids, no story data, no user data and no project payload: a
# console diagnostic is readable by anyone with the page open, so it carries the
# rule that fired and nothing that could identify a record or a person.
denied = (action, reason) ->
    console.warn("#{DENIED_PREFIX} #{action} refused: #{reason}.")
    return false


#############################################################################
## AUTHORIZATION AT THE SEAM -- WHY IT LIVES HERE
##
## `.events` is assigned onto the host element as a DOM PROPERTY
## (`load-element.coffee:29-30`). Anything holding a reference to that element
## can therefore invoke any callback on it directly, with arguments of its own
## choosing, and nothing in React is in the call path. Hiding a React control is
## presentation, not protection.
##
## The incumbent markup gated each control declaratively, and those gates are
## reproduced here VERBATIM rather than reinvented -- same permission codenames,
## same service, same archived-project semantics:
##
##   `tg-check-permission="add_us"`   kanban-table.jade:34, :43 (also `ng-hide`
##                                    on an archived status)
##   `tg-check-permission="modify_us"` us-edit-popover.jade edit / move-to-top
##   `tg-check-permission="delete_us"` us-edit-popover.jade delete
##
## `tgCheckPermission` renders through `projectService.canEdit(permission)`
## (`common.coffee:86-89`), and `canEdit` is `false` for an ARCHIVED project
## before it even looks at the permission
## (`app/modules/services/project.service.coffee:107-110`):
##
##     isArchived: () -> @._project.get('archived_code')
##     canEdit: (permission) ->
##         return false if this.isArchived()
##         return this.hasPermission(permission)
##
## So delegating to `canEdit` gets BOTH gates from one call, and gets them LIVE:
## `tgProjectService` holds the current project, so a permission revoked or a
## project archived after this payload was built is honoured on the next call.
## Reading `$scope.project.my_permissions` instead would read a snapshot.
##
## The screen-level feature gate is checked too. `loadProject` (`main.coffee:663`
## -`:664`) sends the user to the permission-denied view when
## `is_kanban_activated` is false, but that only governs NAVIGATION; a callback
## invoked directly needs the check itself.
##
## Finally every id is resolved against the controller's OWN collections before
## it is used. `editUs`/`deleteUs` call `getUs(id).set(...)` and
## `changeUsAssignedUsers` calls `getUsModel(id)` (`main.coffee:374`, `:393`,
## `:435`), so an unknown id currently throws a raw TypeError from inside
## AngularJS; an id belonging to ANOTHER project would be worse, because it would
## be forwarded to a write. `usMap` is keyed by NUMERIC id
## (`kanban-usertories.coffee:64`, `:150`, `:282`-`:283`), which is why the
## helpers below normalise before looking up.
##
## WHAT IS DELIBERATELY NOT GATED, ENUMERATED SO THE OMISSION IS AUDITABLE:
##
##   * every `get*` accessor -- they expose exactly what the screen already
##     renders to the user who is looking at it, they perform no write, and
##     gating them would break the board for a viewer with read-only
##     permissions, which the incumbent supports;
##   * the view-state toggles `setZoom`, `toggleFold`, `toggleSwimlane`,
##     `toggleSelectedUs`, `cleanSelectedUss`, `toggleOpenFilter`, and the
##     `showPlaceHolder` / `isUsInArchivedHiddenStatus` predicates;
##   * the filter callbacks `changeQ`, `addFilter`, `removeFilter`,
##     `saveCustomFilter`, `selectCustomFilter`, `removeCustomFilter`.
##
## The last two groups do persist -- `toggleSwimlane` writes swimlane fold modes
## through `rs.kanban.storeSwimlanesModes` (`main.coffee:429`) and the custom
## filters go through `tgFilterRemoteStorageService` -- but what they persist is
## PER-USER interface preference, not project data: it is stored against the
## calling user, it changes nothing another member can observe, and the incumbent
## markup carries no permission attribute on any of these controls. Gating them
## would be a behaviour change, not a hardening (rule T10).
#############################################################################
KanbanReactBridgeFactory = (projectService) ->
    service = {}

    service.build = (ctrl) ->
        if not ctrl or not ctrl.scope
            # Throw rather than return a falsy payload: the watcher would never see a
            # truthy value, the host element would keep its default properties, and
            # the board would render empty with no error anywhere.
            throw new Error(
                "tgKanbanReactBridge.build() requires the KanbanController instance and its scope")

        $scope = ctrl.scope

        # One cache per screen, closed over by every accessor below, so a board
        # projection that has not changed is converted once and read back with a
        # STABLE identity for as long as it stands. See
        # `createImmutableSnapshotCache` for why source identity is a sound key for
        # the persistent branch and for no other. It holds nothing until the first
        # read and, being weakly keyed, releases each entry when the collection it
        # copied is superseded.
        snapshotOf = createImmutableSnapshotCache()

        # ---------------------------------------------------------------------
        # GUARD HELPERS. All four read LIVE state on every call, so a permission
        # revoked, a project archived or a story deleted after this payload was
        # built is honoured immediately. None of them throws: a refused action
        # returns a falsy value and warns, which is what a hidden control does
        # today -- nothing happens.
        # ---------------------------------------------------------------------

        # The screen-level feature gate of `main.coffee:663`-`:664`, evaluated
        # per call rather than once at load.
        kanbanEnabled = ->
            project = projectService.project
            return true if not project           # not loaded yet: no basis to refuse
            return project.get('is_kanban_activated') != false

        # `tgCheckPermission`'s own test (`common.coffee:88`), which is archived
        # -project-then-permission (`project.service.coffee:107`-`:110`).
        #
        # FAILS CLOSED WHEN THE PROJECT IS NOT LOADED. `projectService.project` is
        # null until `setProject` runs (`project.service.coffee:22`, `:77`), and a
        # mutation whose permission set is unknown cannot be authorised -- so it is
        # refused rather than allowed through. This is also what keeps `canEdit`
        # from being called on a null project, where `@._project.get(...)` would
        # throw. In practice the project is always loaded long before any user
        # interaction, because the board does not render without it.
        allowed = (action, permission) ->
            project = projectService.project
            return denied(action, "the project is not loaded yet") if not project
            return denied(action, "the kanban module is disabled for this project") if not kanbanEnabled()
            return true if projectService.canEdit(permission)
            return denied(action, "'#{permission}' is not granted, or the project is archived")

        # Resolve a user-story id against the controller's OWN map. Returns the
        # NORMALISED numeric id, or NULL when the id is not one this board holds --
        # which covers a malformed id, a stale id and an id from another project.
        # `usMap` is keyed by numeric id, so the coercion is required for the lookup
        # to hit at all.
        canonicalUsId = (action, usId) ->
            usMap = $scope.usMap
            if not usMap
                denied(action, "the board has no user-story map yet")
                return null
            id = Number(if angular.isObject(usId) then usId.id else usId)
            if not _.isFinite(id)
                denied(action, "the user-story id is not a number")
                return null
            if not usMap.get(id)
                denied(action, "that user story is not on this board")
                return null
            return id

        # ⭐⭐ RE-HYDRATE A VALIDATED ID TO THE STORY ATTRIBUTES THE CONTROLLER READS.
        #
        # WHY VALIDATING THE ID IS NOT ENOUGH. React holds NUMERIC ids -- that is
        # what `app/react/shared/dnd/useSortableList.ts` produces and what the board's
        # own action shape carries -- but the retained controller does NOT read a
        # number. `moveUs` opens with
        #
        #     usList = _.map usList, (us) => @kanbanUserstoriesService.getUsModel(us.id)
        #
        # (`main.coffee:653-655`), and `getUsModel` is
        # `_.find(userstoriesRaw, (us) -> us.id == id)`
        # (`kanban-usertories.coffee:237-238`). Hand it a number and `us.id` is
        # `undefined`, the lookup misses for every entry, and the very next line --
        # `usList.map((it) => it.id)` (`:667`) -- dies on `undefined`. The drag write
        # never reaches the wire. `moveUsToTop` fails one frame earlier still: it
        # reads `us.id`, `us.status` AND `us.swimlane` (`main.coffee:175-199`) to pick
        # the destination column before it delegates.
        #
        # WHAT IS HANDED OVER INSTEAD, AND WHY IT IS THE SAME VALUE THE INCUMBENT USED.
        # `usMap` holds one CARD per story and each card's `model` member is the story
        # attributes: `retrieveUserStoryData` writes `us.model = usModel.getAttrs()`
        # (`kanban-usertories.coffee:245-257`). Those attributes carry `id`, `status`
        # and `swimlane`, which is exactly what both retained methods read -- and
        # exactly what the retained `moveToTopDropdown` already forwards, since
        # `us.toJS().model` (`main.coffee:172-173`) resolves to the same member. So
        # this is the incumbent's own value, not an approximation of it.
        #
        # WHY NOT THE LIVE MODEL. `moveUs` re-resolves every live `$tgModel` by id
        # itself, so a model here would be immediately discarded and re-looked-up;
        # plain attributes are sufficient and keep no AngularJS-owned object in the
        # argument list. The backlog seam is deliberately ASYMMETRIC on this point --
        # its queue splices and reconciles live models, so it re-hydrates to the model.
        #
        # Flattened through the seam's own converter, so the value handed to the
        # controller is detached like every other value that crosses here.
        toControllerStory = (action, usId) ->
            id = canonicalUsId(action, usId)
            return null if not id?

            card = $scope.usMap.get(id)
            model = card?.get?('model')

            if not model?
                # Only reachable if `usMap` holds a card with no `model` member, which
                # `retrieveUserStoryData` never produces. Refused rather than
                # forwarded, because a story without `status` would send the board's
                # ordering arithmetic somewhere unreadable.
                denied(action, "that user story has no attributes on this board")
                return null

            return toPlain(snapshotOf, model)

        # Every entry in a list re-hydrated, or NULL IF ANY ONE OF THEM FAILS.
        # All-or-nothing on purpose: a partially validated list would still be
        # written, and the write is POSITION-RELATIVE, so persisting a subset of a
        # multi-card move reorders the board in a way the user never asked for -- and
        # the endpoint reports no error for it. A single value is accepted as well as
        # an array, because `moveUsToTop` is legitimately called with one story.
        toControllerStories = (action, usList) ->
            list = if angular.isArray(usList) then usList else [usList]
            return null if list.length == 0

            stories = []
            for us in list
                story = toControllerStory(action, us)
                return null if not story?
                stories.push(story)
            return stories

        # ⭐ CANONICALISE AND VALIDATE A DESTINATION SWIMLANE.
        #
        # WHY THIS IS A WRITE-PATH CHECK AND NOT A FORMALITY. `moveUs` mutates local
        # board state OPTIMISTICALLY -- `kanbanUserstoriesService.move(...)` reassigns
        # each story's `swimlane` and re-derives the projections (`main.coffee:665`,
        # `kanban-usertories.coffee:182-187`) -- and only then issues the write. There
        # is no rollback. So a swimlane id that the backend will reject still moves
        # every dragged card on screen first, and the board stays wrong until the next
        # full reload.
        #
        # THE THREE LEGITIMATE VALUES, taken from the controller and the service
        # rather than invented here:
        #   * NULLISH -- flat mode, no swimlanes on this project. Forwarded as `null`.
        #   * `-1` -- the SYNTHETIC "unclassified" swimlane the service inserts when
        #     some stories have no swimlane (`kanban-usertories.coffee:315-321`), and
        #     for which the controller registers a statuses entry
        #     (`main.coffee:615`). `moveUs` maps it to `null` for the API itself
        #     (`main.coffee:659-661`), so it is forwarded UNCHANGED -- rewriting it
        #     here would lose the distinction the local mutation still needs.
        #   * a real swimlane id present in `$scope.swimlanes`, which is what
        #     `loadSwimlanes` stores (`main.coffee:608-609`).
        # Everything else -- a malformed value, a stale id, an id belonging to another
        # project -- is refused before delegation.
        canonicalSwimlaneId = (action, swimlaneId) ->
            return {ok: true, value: null} if not swimlaneId?

            id = Number(swimlaneId)
            if not _.isFinite(id)
                denied(action, "the swimlane id is not a number")
                return {ok: false}

            # The unclassified swimlane, forwarded verbatim.
            return {ok: true, value: id} if id == -1

            swimlanes = $scope.swimlanes
            if not angular.isArray(swimlanes)
                denied(action, "the board has no swimlanes yet")
                return {ok: false}

            if not _.some(swimlanes, (swimlane) -> swimlane? and Number(swimlane.id) == id)
                denied(action, "that swimlane does not belong to this project")
                return {ok: false}

            return {ok: true, value: id}

        # Whether a status id may be used. A NULLISH id is accepted and left
        # untouched: `addNewUs` is legitimately called with no status from the
        # toolbar. `requireOpen` additionally rejects an ARCHIVED status,
        # reproducing `ng-hide="s.is_archived"` on the two add controls
        # (`kanban-table.jade:35`, `:44`).
        isCanonicalStatusId = (action, statusId, requireOpen = false) ->
            return true if not statusId?
            byId = $scope.usStatusById
            return denied(action, "the board has no status map yet") if not byId
            id = Number(statusId)
            return denied(action, "the status id is not a number") if not _.isFinite(id)
            status = byId[id]
            return denied(action, "that status does not belong to this project") if not status
            return denied(action, "that status is archived") if requireOpen and status.is_archived
            return true

        # Whether a position anchor may be used. Anchors become
        # `after_userstory_id` / `before_userstory_id` on the bulk-order write
        # (`main.coffee:714`), so an anchor that is not on this board persists an
        # order nobody asked for, silently. Absent anchors are legitimate -- a move
        # to either end of a column has only one neighbour.
        isCanonicalAnchor = (action, anchorId) ->
            return true if not anchorId?
            return canonicalUsId(action, anchorId)?

        return {
            component: 'kanban-board'

            params: {
                sectionName: $scope.sectionName

                # Already a plain object: `loadProject` (`main.coffee:661`) stores
                # `@projectService.project.toJS()`. Flattened anyway so the seam
                # never depends on that staying true.
                project: toPlain(snapshotOf, $scope.project)
                myPermissions: toMyPermissions($scope.project)

                # Board taxonomies, sorted and grouped by the controller
                # (`main.coffee:669-672`).
                points: toPlainList(snapshotOf, $scope.points)
                pointsById: toPlain(snapshotOf, $scope.pointsById)
                usStatusList: toPlainList(snapshotOf, $scope.usStatusList)
                usStatusById: toPlain(snapshotOf, $scope.usStatusById)

                # The four persistent projections defined at `main.coffee:144-154`.
                # `kanbanUserstoriesService.reset()` runs first (`:128`), so all
                # four are real empty collections rather than `undefined`, and
                # `.toJS()` here yields `{}` / `[]` on the first frame.
                usByStatus: toPlain(snapshotOf, $scope.usByStatus)
                usByStatusSwimlanes: toPlain(snapshotOf, $scope.usByStatusSwimlanes)
                usMap: toPlain(snapshotOf, $scope.usMap)
                swimlanesList: toPlain(snapshotOf, $scope.swimlanesList)
                swimlanes: toPlainList(snapshotOf, $scope.swimlanes)
                swimlanesStatuses: toPlain(snapshotOf, $scope.swimlanesStatuses)

                # Fold state: a persistent `Map` at `main.coffee:132`, replaced
                # from stored modes at `:680`. Its persisted form is already plain
                # -- `:426` stores `@.foldedSwimlane.toJS()` -- so flattening here
                # hands React exactly the shape the server round-trips.
                foldedSwimlane: toPlain(snapshotOf, ctrl.foldedSwimlane)

                # `zoom` is an ARRAY of card-feature names, not a scalar: the shared
                # zoom component reduces its four tiers into one list and hands it
                # over (`kanban-board-zoom.directive.coffee:31-39`). It is therefore
                # detached like every other array at this seam. `zoomLevel` beside it
                # is a number and needs nothing.
                zoom: toPlainList(snapshotOf, ctrl.zoom)
                zoomLevel: ctrl.zoomLevel

                filterQ: ctrl.filterQ
                openFilter: ctrl.openFilter
                filters: toPlain(snapshotOf, ctrl.filters)
                # Detached for the same reason the matching accessors are: the
                # retained filter mixin replaces and splices these arrays in place,
                # and `params` is what React seeds its state from, so a live array
                # here is the shortest path to a frozen-then-mutated AngularJS
                # object.
                selectedFilters: toPlainList(snapshotOf, ctrl.selectedFilters)
                customFilters: toPlainList(snapshotOf, ctrl.customFilters)
            }

            # Stable function references, so the payload keeps one identity for the
            # life of the screen. Accessors read live state on every call; actions
            # delegate to the controller and never reimplement it.
            events: {
                # --- project, taxonomies and permissions ----------------------
                getProject: => toPlain(snapshotOf, $scope.project)
                getProjectId: => $scope.projectId
                getMyPermissions: => toMyPermissions($scope.project)
                getPoints: => toPlainList(snapshotOf, $scope.points)
                getPointsById: => toPlain(snapshotOf, $scope.pointsById)
                getUsStatusList: => toPlainList(snapshotOf, $scope.usStatusList)
                getUsStatusById: => toPlain(snapshotOf, $scope.usStatusById)

                # --- board data: persistent on the scope, flattened here -------
                getUsByStatus: => toPlain(snapshotOf, $scope.usByStatus)
                getUsByStatusSwimlanes: => toPlain(snapshotOf, $scope.usByStatusSwimlanes)
                getUsMap: => toPlain(snapshotOf, $scope.usMap)
                getSwimlanes: => toPlainList(snapshotOf, $scope.swimlanes)
                getSwimlanesList: => toPlain(snapshotOf, $scope.swimlanesList)
                getSwimlanesStatuses: => toPlain(snapshotOf, $scope.swimlanesStatuses)
                getFoldedSwimlane: => toPlain(snapshotOf, ctrl.foldedSwimlane)

                # ⭐ EVERY MUTABLE READ IS DETACHED, and the four below are the ones
                # that used to cross BY REFERENCE. `usCardVisibility` is a plain
                # object AngularJS keys per card (`main.coffee:757`), `movedUs` is
                # an array the controller pushes into and empties on a timer
                # (`main.coffee:183`-`:186`), `selectedUss` is a map the selection
                # toggle mutates in place, and the two filter arrays are replaced
                # and spliced by the retained filter mixin. Handing any of them
                # over unconverted put a LIVE, AngularJS-OWNED object into React
                # state, which fails in both directions: React would observe
                # mutations it never rendered for, and `immer`'s `autoFreeze`
                # (`P-IMMER-4`) would freeze the object the controller is still
                # about to mutate, throwing from inside AngularJS.
                #
                # `toPlain` on a plain object now deep-copies (see `toPlainDeep`),
                # so each call hands back a fresh detached value. That is a NEW
                # object per read by construction, which is correct rather than
                # wasteful here: these are exactly the values that change, so a
                # stable identity would be a lie. The four persistent projections
                # above keep their memoised identity, which is where `React.memo`
                # gets its purchase.
                getUsCardVisibility: => toPlain(snapshotOf, $scope.usCardVisibility) or {}
                # An array of card-feature names; see the `params.zoom` note above.
                getZoom: => toPlainList(snapshotOf, ctrl.zoom)
                getZoomLevel: => ctrl.zoomLevel
                getZoomLoading: => ctrl.zoomLoading
                getInitialLoad: => ctrl.initialLoad
                getRenderInProgress: => ctrl.renderInProgress
                getNotFoundUserstories: => ctrl.notFoundUserstories
                getMovedUs: => toPlainList(snapshotOf, ctrl.movedUs)
                getSelectedUss: => toPlain(snapshotOf, ctrl.selectedUss) or {}

                getFilterQ: => ctrl.filterQ
                getFilters: => toPlain(snapshotOf, ctrl.filters)
                getSelectedFilters: => toPlainList(snapshotOf, ctrl.selectedFilters)
                getCustomFilters: => toPlainList(snapshotOf, ctrl.customFilters)
                getOpenFilter: => ctrl.openFilter

                # `moveUs` keeps the controller's ARGUMENT ORDER verbatim, including the
                # leading `ctx` -- the event object when it is driven from the event
                # bus, `null` when it is called directly, and forwarded untouched
                # because the drag serialisation keys on its truthiness. Its write is
                # position-relative: the two neighbour ids become
                # `after_userstory_id` / `before_userstory_id`, so an off-by-one in
                # the caller persists a wrong order with no error surface.
                #
                # ⭐ THE STORY LIST IS RE-HYDRATED, NOT MERELY VALIDATED. React passes
                # numeric ids and the controller reads `us.id`, so forwarding the
                # caller's own list would abort every drag write inside AngularJS --
                # see `toControllerStory` above for the full trace. The two anchors
                # stay as IDS, because that is what the ordering arithmetic and the
                # request body take (`main.coffee:668-680`).
                #
                # ⭐ THE DESTINATION SWIMLANE IS VALIDATED BEFORE DELEGATION, because
                # `moveUs` mutates the board optimistically and has no rollback.
                moveUs: (ctx, usList, newStatusId, newSwimlaneId, index, previousCard, nextCard) =>
                    return if not allowed("moveUs", "modify_us")
                    stories = toControllerStories("moveUs", usList)
                    return if not stories?
                    return if not isCanonicalStatusId("moveUs", newStatusId)
                    swimlane = canonicalSwimlaneId("moveUs", newSwimlaneId)
                    return if not swimlane.ok
                    return if not isCanonicalAnchor("moveUs", previousCard)
                    return if not isCanonicalAnchor("moveUs", nextCard)
                    ctrl.moveUs(
                        ctx, stories, newStatusId, swimlane.value, index, previousCard, nextCard)
                # Re-hydrated for the same reason, and it matters one step sooner here:
                # `moveUsToTop` reads `us.status` and `us.swimlane` to choose the
                # destination column before it ever reaches `moveUs`
                # (`main.coffee:175-199`). It normalises a single value to an array
                # itself, so the shape the caller used is preserved.
                moveUsToTop: (uss) =>
                    return if not allowed("moveUsToTop", "modify_us")
                    stories = toControllerStories("moveUsToTop", uss)
                    return if not stories?
                    ctrl.moveUsToTop(if angular.isArray(uss) then stories else stories[0])

                # NOT a verbatim delegation, and `toStoryAttrs` above documents why in
                # full: the retained `moveToTopDropdown` unwraps an IMMUTABLE card with
                # `us.toJS().model` (`main.coffee:239-240`), and the value React holds
                # was already flattened at this seam, so calling it would throw. The
                # second unwrapping step is performed here and the plain attributes go
                # to `moveUsToTop`, which is the method the retained wrapper itself
                # calls -- so the behaviour is identical, not merely equivalent.
                moveToTopDropdown: (card) =>
                    return if not allowed("moveToTopDropdown", "modify_us")

                    story = toStoryAttrs(card)

                    if not story? or not story.id? or not story.status?
                        # Fail loudly at the seam rather than let an unusable value
                        # reach the controller, where the symptom would be an
                        # unreadable failure inside the board's ordering arithmetic.
                        throw new Error(
                            "tgKanbanReactBridge: moveToTopDropdown needs the flattened card " +
                            "or its story attributes, carrying `id` and `status`")

                    # Resolved through the SAME re-hydration every other write path
                    # uses, so the controller receives the board's own attributes
                    # rather than whatever the caller happened to hold -- which also
                    # means a stale `status` on a card React has kept around cannot
                    # send the story to the wrong column.
                    resolved = toControllerStory("moveToTopDropdown", story)
                    return if not resolved?

                    ctrl.moveUsToTop(resolved)

                setZoom: (zoomLevel, zoom) => ctrl.setZoom(zoomLevel, zoom)

                toggleFold: (id) => ctrl.toggleFold(id)
                toggleSwimlane: (id) => ctrl.toggleSwimlane(id)
                toggleSelectedUs: (usId) => ctrl.toggleSelectedUs(usId)
                cleanSelectedUss: => ctrl.cleanSelectedUss()
                showPlaceHolder: (statusId, swimlaneId) => ctrl.showPlaceHolder(statusId, swimlaneId)
                isUsInArchivedHiddenStatus: (usId) => ctrl.isUsInArchivedHiddenStatus(usId)

                # `type` is "standard" or "bulk" (`main.coffee:362-372`); both open
                # the existing shared lightboxes, which stay AngularJS. Gated on
                # `add_us` and on the status being an OPEN status of this project,
                # reproducing `tg-check-permission="add_us"` together with
                # `ng-hide="s.is_archived"` (`kanban-table.jade:34-35`, `:43-44`).
                # The original `statusId` is forwarded byte-for-byte once validated,
                # including when it is absent, because the lightbox payload
                # distinguishes absent from present.
                addNewUs: (type, statusId) =>
                    return if not allowed("addNewUs", "add_us")
                    return if not isCanonicalStatusId("addNewUs", statusId, true)
                    ctrl.addNewUs(type, statusId)
                # `modify_us`: `us-edit-popover.jade` gates the edit control with it.
                # The id is resolved first because `main.coffee:374` calls
                # `getUs(id).set(...)`, which throws a raw TypeError on an unknown id.
                editUs: (id) =>
                    return if not allowed("editUs", "modify_us")
                    return if not canonicalUsId("editUs", id)?
                    ctrl.editUs(id)
                # `delete_us`, its own permission -- NOT `modify_us`
                # (`us-edit-popover.jade` delete control).
                deleteUs: (id) =>
                    return if not allowed("deleteUs", "delete_us")
                    return if not canonicalUsId("deleteUs", id)?
                    ctrl.deleteUs(id)
                # Reassignment is a write to the story: `modify_us`. `main.coffee:435`
                # calls `getUsModel(id)` and then `repo.save`, so an unresolvable id
                # would throw before the save.
                changeUsAssignedUsers: (id) =>
                    return if not allowed("changeUsAssignedUsers", "modify_us")
                    return if not canonicalUsId("changeUsAssignedUsers", id)?
                    ctrl.changeUsAssignedUsers(id)

                # Read paths. No permission gate -- the incumbent shows the archived
                # column to anyone who can see the board, and gating reads would
                # break a read-only member's view. The FEATURE gate and the canonical
                # status id are still enforced: the id reaches a query
                # (`main.coffee:607`-`:632`) and a broadcast, so an id from another
                # project must not be forwarded.
                loadUserstories: => ctrl.loadUserstories()
                loadUserStoriesForStatus: (ctx, statusId) =>
                    return if not kanbanEnabled()
                    return if not isCanonicalStatusId("loadUserStoriesForStatus", statusId)
                    ctrl.loadUserStoriesForStatus(ctx, statusId)
                hideUserStoriesForStatus: (ctx, statusId) =>
                    return if not kanbanEnabled()
                    return if not isCanonicalStatusId("hideUserStoriesForStatus", statusId)
                    ctrl.hideUserStoriesForStatus(ctx, statusId)
                loadSwimlanes: => ctrl.loadSwimlanes()

                changeQ: (q) => ctrl.changeQ(q)
                addFilter: (newFilter) => ctrl.addFilter(newFilter)
                removeFilter: (filter) => ctrl.removeFilter(filter)
                saveCustomFilter: (name) => ctrl.saveCustomFilter(name)
                selectCustomFilter: (filter) => ctrl.selectCustomFilter(filter)
                removeCustomFilter: (filter) => ctrl.removeCustomFilter(filter)

                toggleOpenFilter: => ctrl.openFilter = !ctrl.openFilter

                # --- the AngularJS -> React event channel ---------------------
                # `params`/`events` are a ONE-TIME hand-off (§5), so this is the only
                # way React observes an AngularJS-side broadcast. It is required, not
                # optional: `app/react/kanban/hooks/useWipLimit.ts` takes a
                # `registerEvent(eventName, handler) => deregister` seam and subscribes
                # to `redraw:wip`, `kanban:us:move`, `usform:new:success` and
                # `usform:bulk:success` -- the same four the retired
                # `KanbanWipLimitDirective` used (`main.coffee:1097-1100`) -- so WIP
                # marker redraw parity is unreachable without it.
                #
                # Registered on the controller's own scope, with the Angular event
                # object stripped and the payload flattened; returns AngularJS's own
                # deregistration function, which React MUST invoke from its
                # `useEffect` cleanup. See `registerAngularEvent` above for the
                # argument-shifting and `$scope`-leak hazards this closes, and for the
                # proof that all four events reach this scope.
                #
                # Other names React may legitimately observe on this screen, all
                # emitted from this module: `kanban:userstories:loaded`
                # (`main.coffee:698`), `usform:edit:success`, `usform:bulk:success`,
                # `usform:new:success`, `redraw:wip`, `kanban:us:move`, and the shared
                # `filters:update`. A React handler must never call
                # `$rootScope.$apply()`: these handlers already run inside a digest.
                onAngularEvent: (eventName, handler) =>
                    registerAngularEvent(snapshotOf, $scope, eventName, handler)
            }
        }

    return service

# The array annotation is REQUIRED now that the factory takes an injectable:
# `gulpfile.js` minifies the concatenated bundle for a deploy build, and a
# minifier renames the parameter, after which AngularJS's implicit annotation
# would ask the injector for a one-letter provider and abort linking the whole
# `ng-view` subtree. `main.coffee:730` registers its controller without one only
# because that controller carries its own `@.$inject` list.
module.factory("tgKanbanReactBridge", ["tgProjectService", KanbanReactBridgeFactory])
