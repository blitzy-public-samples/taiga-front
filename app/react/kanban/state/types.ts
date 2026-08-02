/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// ---------------------------------------------------------------------------
// Kanban board state contract.
//
// This module is the single shape that `./boardReducer.ts`, `./boardSelectors.ts`
// and every component under `app/react/kanban/` agree on. It declares four
// things and nothing else:
//
//   1. `CardUserStoryVm` -- the card view-model, and the three derivations that
//      belong to it (`ColorizedTag`, `BoardUser`, `CardZoomFeatures`).
//   2. The three key-type aliases for the grouped views the selectors rebuild.
//   3. `KanbanBoardState` -- NORMALISED state only.
//   4. `KanbanBoardAction` -- the reducer's discriminated action union.
//
// ZERO EXECUTABLE STATEMENTS. No `const`, `let`, `var`, `function`, `class`,
// `enum` or `export default` appears below -- only `interface`, `type` and
// erased type-only imports. That is a decision, not a style preference:
// `jest.config.js` sets `collectCoverageFrom` to `app/react/**/*.{ts,tsx}` and
// negates only `*.test.*`, `*.d.ts` and the bundle entry point, so this plain
// `.ts` file IS swept by coverage and measured against the global `lines: 70`
// gate (HR-9). With no statement to instrument it contributes zero lines and
// stays coverage-neutral, which is also why no spec is co-located beside it --
// exactly the precedent the six files in `../../shared/types/` already set. A
// statement that needs a home belongs in `./boardReducer.ts` or
// `./boardSelectors.ts`, where a co-located spec can cover it.
//
// LOCATOR CONVENTION. The Agent Action Plan measured the CoffeeScript sources
// before this migration added its seam comments to them, so its line numbers
// have shifted. Every citation below is the CURRENT tree position, verified by
// reading the file, with the plan's original locator noted where the two differ.
// This follows the precedent set by `../../shared/types/userStory.ts`.
// ---------------------------------------------------------------------------

// FOUR type-only imports, and no more. `isolatedModules` is enabled, so a
// value-form import of a type would survive transpilation; `import type` is
// erased. `noUnusedLocals` is enabled, so every symbol here is genuinely
// referenced below -- `UserStory` by `CardUserStoryVm.model` and
// `KanbanBoardState.storiesById`, `Status` by `usStatusList` and
// `swimlanesStatuses`, `Swimlane` by `swimlanes` and `SwimlaneListEntry`, and
// `Tag` by `ColorizedTag`. `Epic` is deliberately NOT imported: epics reach the
// card through `model.epics`, so importing the type here would be unused and
// would fail the build. `tsconfig.json` declares neither `baseUrl` nor `paths`,
// hence the relative specifiers, and `userStory` is camelCase on purpose --
// `forceConsistentCasingInFileNames` is enabled and rejects `userstory`.
import type { UserStory } from '../../shared/types/userStory';
import type { Status } from '../../shared/types/status';
import type { Swimlane } from '../../shared/types/swimlane';
import type { Tag } from '../../shared/types/tag';

// ---------------------------------------------------------------------------
// 1. THE OWNERSHIP BOUNDARY
//
// `../../shared/types/` owns the RAW API domain models. This folder owns the
// CARD VIEW-MODEL DERIVATIONS layered on top of them, and nothing else. The
// division is not arbitrary -- it mirrors what the AngularJS service actually
// does, which is to build a wrapper object around the raw model rather than to
// replace it (`app/coffee/modules/kanban/kanban-usertories.coffee:293-325`;
// the plan cites `L228-L252`, the same code before the file grew).
//
// Declared HERE, because `userStory.ts` and `tag.ts` explicitly disclaim them:
//   foldStatusChanged, images, the RESOLVED `assigned_to` user object, the
//   RESOLVED `assigned_users` user-object list, `assigned_users_preview`,
//   `colorized_tags`, and the `{name, color}` object the tag tuple is reshaped
//   into.
//
// Declared ELSEWHERE, and deliberately absent below so that nobody
// "completes" this module later:
//   * WIP-limit derivation -- `../WipLimitMarker.tsx` owns
//     `resolveWipLimitState`, `resolveWipLimitIndex` and the `WipLimitState`
//     union. There is no fourth variant and no re-export here.
//   * Viewport visibility -- `../../shared/useInViewport.ts` owns
//     `InViewportApi` and its `visibleIds` latch. `usCardVisibility`
//     (`main.coffee:673`) is NOT board state: the AngularJS bridge hands it
//     over read-only and React owns its own visibility.
//   * Drag, drop, neighbour and index types -- `../../shared/dnd/`.
//   * AngularJS service types -- `../../bridge/useAngularService.ts`.
//   * HTTP request and response shapes -- `../../shared/api/`. T5 forbids a
//     parallel client, and requirement I7 is why: routing writes through the
//     existing repository layer inherits `$tgModel`'s changed-fields-only
//     PATCH carrying its optimistic-concurrency `version`
//     (`app/coffee/modules/base/model.coffee:48-54`).
//   * Project statistics -- `app/react/backlog/state/types.ts`. That folder is
//     not generated yet, which does not transfer ownership here.
//   * Sprints, milestones, the burndown and anything else backlog-shaped.
//   * A `pendingDrag` queue. That FIFO and its re-entrancy guard are
//     BACKLOG-ONLY (`app/coffee/modules/backlog/main.coffee`, notably the
//     `if ctx && @.pendingDrag.length > 1 then return` guard). The kanban
//     module has no such path: `moveUs` (`main.coffee:699`) issues its bulk
//     update unconditionally.
//   * An icon-name union (T3: zero new icon assets) and any colour literal
//     (T2: colours are data, never tokens). Neither appears in this file.
// ---------------------------------------------------------------------------

/**
 * One tag, reshaped from the wire tuple into an object.
 *
 * Built at `kanban-usertories.coffee:322-323`:
 * `us.colorized_tags = _.map us.model.tags, (tag) -> {name: tag[0], color: tag[1]}`
 * and consumed by the shared card at
 * `app/modules/components/card/card-templates/card-tags.jade:8` and `:10`.
 *
 * The member types are written as indexed accesses into `Tag` rather than as
 * restated primitives, so this reshaping stays provably tied to its single
 * source of truth: `Tag[0]` resolves to `string` and `Tag[1]` to
 * `string | null`. `tag.ts` declares `Tag` as a readonly TUPLE, not an object,
 * and asks that the reshaped form live here rather than beside it.
 */
export interface ColorizedTag {
    /** `Tag[0]` -- the tag name. Resolves to `string`. */
    readonly name: Tag[0];

    /**
     * `Tag[1]` -- the tag colour. Resolves to `string | null`.
     *
     * T2, verbatim: "All status, tag, and epic colours remain data-bound. They
     * come from `s.color`, `tag[1]`, and `epic.color`; the values visible in
     * the Figma frames are `sample_data` artefacts and must never be
     * hardcoded." Null is a legitimate value -- an untagged colour falls back
     * inside the shared card at `card.controller.coffee:49-52`, which this
     * folder must not duplicate and must not pre-empt by substituting a
     * default here.
     */
    readonly color: Tag[1];
}

/**
 * A user resolved out of the board's user index.
 *
 * Provenance: `usersById` is built once per page as
 * `groupBy(users, (e) -> e.id)` at
 * `app/coffee/modules/controllerMixins.coffee:28`, and `taiga.groupBy`
 * (`app/coffee/utils.coffee:80-85`) assigns `result[pred(item)] = item` -- one
 * object per key, NOT an array per key. It reaches the card-building service
 * through `init(project, swimlanes, usersById)` (`main.coffee:599`,
 * `kanban-usertories.coffee:76-79`).
 *
 * WHY THIS IS ONLY AN ID. Measured across every consumer of a resolved user on
 * this screen: `card-assigned-to.jade` reads `assignedUser.id` at `:29-:32`
 * and `vm.item.getIn(['assigned_to', 'id'])` at `:47-:50`, and nothing else.
 * Every display value -- `url`, `fullName`, `bg` -- comes from a separate
 * `avatars[id]` lookup performed by the shared card, which is T4-protected and
 * out of scope for this folder. Declaring more would be inventing a contract.
 *
 * If a future component provably reads a further member, add that exact member
 * as `readonly`. Do NOT widen this to `any`, `unknown`, an index signature or
 * `Record<string, unknown>`: `strict` is non-negotiable, and a widened type
 * here would silently disable checking on every avatar on the board.
 */
export interface BoardUser {
    readonly id: number;
}

/**
 * The flat list of card features the current zoom level makes visible.
 *
 * Measured, because the name invites the wrong assumption -- this is neither an
 * object nor an enumeration. `kanban-board-zoom.directive.coffee:15-20`
 * declares four tiers of feature names, `:22-:35` reduces every tier whose
 * index is `<= zoomIndex` into ONE flat list, and `:37-:39` emits
 * `{zoomLevel, zoom}`. The shared card then tests membership by value:
 * `visible: (name) -> return @.zoom.indexOf(name) != -1`
 * (`card.controller.coffee:42-43`).
 *
 * At zoom level 1, for example, the list is
 * `['assigned_to', 'ref', 'subject', 'card-data', 'assigned_to_extended']`.
 * The values are feature keys, never CSS class names and never icon ids.
 */
export type CardZoomFeatures = readonly string[];

// ---------------------------------------------------------------------------
// 2. THE CARD VIEW-MODEL
//
// T9 comment site (1) -- THE IMMUTABLE -> PLAIN-OBJECT SEAM.
//
// On the AngularJS side each entry of `usMap` is an Immutable structure: the
// service stores `Immutable.fromJS(us)` (`kanban-usertories.coffee:150`, `:228`,
// `:280`, `:291`, `:343`) and the card reads it through `get` / `getIn`. React
// never sees that form. `swimlanesList` and the three grouped projections are
// flattened with `.toJS()` at the `react-bridge.coffee` seam, following the one
// in-repo precedent for handing data to a Web Component
// (`app/modules/components/project-menu/project-menu.controller.coffee:27`).
//
// Two consequences bind every consumer of the types below:
//
//   * THIS FOLDER RECEIVES PLAIN JAVASCRIPT OBJECTS AND ARRAYS, EXCLUSIVELY.
//     Measure a collection with `.length`, NEVER `.size`. A plain array has no
//     `size`, so a stray `.size` read evaluates to `undefined` -> falsy with no
//     error thrown anywhere -- which is exactly why the AngularJS service was
//     retained on Immutable instead of being converted in place: `.size` has
//     five surviving consumers, including the T4-protected
//     `card.controller.coffee:31` shared with the out-of-scope taskboard
//     (requirement I5, and the retention note at
//     `kanban-usertories.coffee:11-49`).
//   * Nothing here is a class instance. P-IMMER-1: immer drafts do not
//     tolerate them, and `$tgModel` instances carry dirty-tracking state. The
//     incumbent flattens at `getAttrs()` (`kanban-usertories.coffee:303`), and
//     `getAttrs` is shallow (`model.coffee:54`), so the nested arrays inside
//     `model` cross the seam as the plain JSON the REST layer returned.
// ---------------------------------------------------------------------------

/**
 * One card, as the board renders it.
 *
 * The literal definition is `retrieveUserStoryData(usModel)` at
 * `kanban-usertories.coffee:293-325` (plan locator `L228-L252`). Every member
 * below cites its constructing line. The name is fixed by the cross-folder
 * contract with `../KanbanCard.tsx`, whose props declare
 * `readonly item: CardUserStoryVm` -- do not rename it.
 *
 * T4 obliges this shape to satisfy everything the shared, protected card
 * already reads, without one byte of change to
 * `app/modules/components/card/**`: `foldStatusChanged`, `model`, `images`,
 * `assigned_to`, `assigned_users`, `assigned_users_preview`, `colorized_tags`
 * and `'loading-extra'`. That card is also rendered by the out-of-scope
 * taskboard (`app/partials/includes/modules/taskboard-table.jade:135`, `:186`),
 * so the contract is wider than this screen.
 *
 * T10 obliges the measured NULLABILITY to be preserved exactly. Three members
 * below are `| undefined` because a plain-object miss yields `undefined` rather
 * than a falsy default, and narrowing any of them would turn a benign falsy
 * read into a crash or a wrong render.
 */
export interface CardUserStoryVm {
    /** `:310` `us.id = usModel.id`. The `UsMap` key for this entry. */
    readonly id: number;

    /**
     * `:307` `us.model = model`, where `:303` `model = usModel.getAttrs()`.
     *
     * The raw story, already a plain object. `getAttrs` injects `version` from
     * the stored attributes when present and extends the stored over the
     * modified attributes exactly one level deep (`model.coffee:48-54`).
     * Everything the card reaches through `getIn(['model', X])` lives here.
     */
    readonly model: UserStory;

    /**
     * `:311` `us.swimlane = usModel.swimlane`.
     *
     * T9 comment site (4) -- THE `-1` SENTINEL RULE. THIS VALUE IS NEVER `-1`.
     *
     * `moveUs` converts the synthetic id BEFORE anything consumes it:
     * `main.coffee:700` `apiNewSwimlaneId = newSwimlaneId`, `:702-:703`
     * `if newSwimlaneId == -1 then apiNewSwimlaneId = null`. The already
     * converted value then goes to BOTH the local move (`:708`) and the API
     * (`:717`), and `move` writes it straight onto the story at
     * `kanban-usertories.coffee:223` `usModel.swimlane = swimlaneId` -- i.e.
     * `null`, never `-1`.
     *
     * Why it matters, and why the failure is silent: `refreshSwimlanes`
     * identifies unclassified stories by `us.swimlane == null` (`:358`) and
     * maps the synthetic id back to `null` for matching (`:385`). A story
     * holding `-1` would make that filter empty, the synthetic swimlane would
     * never be created, and its cards would vanish from the board with no
     * error, no warning and nothing in the console.
     *
     * `-1` is legitimate ONLY as a COLLECTION KEY: the `SwimlaneListEntry.id`
     * of the synthetic entry, the outer key of `UsByStatusSwimlanes`, the
     * `'-1'` string key of `foldedSwimlane`, and a `swimlanesStatuses` key.
     */
    readonly swimlane: number | null;

    /**
     * `:305` `us.foldStatusChanged = @.foldStatusChanged[usModel.id]`.
     *
     * `undefined`, not `false`, when the story has never been folded -- the
     * index is a plain object seeded empty at `:62` and `:82`. Do NOT narrow
     * to `boolean`: the shared card distinguishes the three states explicitly
     * with `!_.isUndefined(@.item.get('foldStatusChanged'))` at
     * `card.controller.coffee:82`, so collapsing `undefined` into `false`
     * would change which sections a level-2 card shows.
     */
    readonly foldStatusChanged: boolean | undefined;

    /**
     * `:308` `us.images = _.filter model.attachments, (it) -> !!it.thumbnail_card_url`
     * -- the attachments that actually have a card thumbnail.
     *
     * Typed as the raw model's own attachment list so the element shape has
     * exactly one definition, in `userStory.ts`. Read as
     * `vm.item.get('images')` at `card.jade:40` and measured for emptiness at
     * `card.controller.coffee:59` and `:94`.
     */
    readonly images: UserStory['attachments'];

    /**
     * `:312` `us.assigned_to = @.usersById[usModel.assigned_to]`.
     *
     * A RESOLVED user object, not the raw `number | null` that
     * `model.assigned_to` carries. `undefined` when the lookup misses -- which
     * happens for a story assigned to a user who is no longer a project
     * member, and for every unassigned story, since `usersById[null]` is a
     * miss. The card relies on that falsiness at
     * `card-assigned-to.jade:12` and `:23` to choose the "not assigned"
     * avatar, so the union must stay wide.
     */
    readonly assigned_to: BoardUser | undefined;

    /**
     * `:313-:318` -- the RESOLVED user objects for `model.assigned_users`.
     *
     * MAY BE SHORTER THAN `model.assigned_users`. The loop pushes only truthy
     * lookups (`:317` `if assignedUserData`), so ids that no longer resolve to
     * a project member are dropped silently. Never derive a count from
     * `model.assigned_users.length` and apply it to this list.
     */
    readonly assigned_users: readonly BoardUser[];

    /**
     * `:320` `us.assigned_users_preview = us.assigned_users.slice(0, 3)`.
     *
     * At most three entries. The card iterates this list and cross-checks the
     * full one to decide whether to render the "+N" overflow badge
     * (`card-assigned-to.jade:24-:41`), so it is a genuine member of the
     * contract rather than a convenience the component could recompute.
     */
    readonly assigned_users_preview: readonly BoardUser[];

    /** `:322-:323` -- `model.tags` reshaped tuple-by-tuple. See `ColorizedTag`. */
    readonly colorized_tags: readonly ColorizedTag[];

    /**
     * T9 comment site (5) -- CARD-OWNED, AND NEVER SET BY THIS FOLDER.
     *
     * Quoted because the key is hyphenated, and OPTIONAL because
     * `retrieveUserStoryData` never produces it: the T4-protected shared card
     * writes it onto the entry itself. Its only reader is
     * `card-unfold.jade:24` (`tg-loading="vm.item.get('loading-extra')"`),
     * styled at `card.scss:21`. It is declared here so the card's read
     * type-checks against this view-model without one byte of card change.
     *
     * `./boardSelectors.ts` must NOT populate it, and it must NOT be renamed
     * to `loadingExtra` -- the hyphenated key IS the contract.
     *
     * Measured, so that nobody "completes" the set: the sibling flags
     * `'loading-edit'` and `'loading-delete'` are WRITTEN by
     * `main.coffee:376`, `:390`, `:395` and `:399` but are READ NOWHERE in the
     * repository -- no template, no stylesheet, no controller. They are
     * write-only in the incumbent, so declaring them would add dead surface
     * with no behaviour to preserve, which the Minimal Change Clause forbids.
     */
    readonly 'loading-extra'?: boolean;
}

// ---------------------------------------------------------------------------
// 3. THE THREE KEY-TYPE ALIASES
//
// T9 comment site (2) -- CONFLATING THESE SILENTLY EMPTIES COLUMNS.
//
// The three grouped views the board renders from do NOT share a key type. That
// is not an accident to be tidied away: it is observable in a single `if/else`
// in `moveUsToTop` (`main.coffee:254-260`), where the same status id is used
// two different ways depending on which structure is being read --
//
//   :255-:258   @scope.usByStatusSwimlanes.getIn([us.swimlane, us.status])
//   :260        @scope.usByStatus.get(us.status.toString())
//
// -- and it is created that way by the service:
//
//   usByStatus            STRING keys. `refresh` (`kanban-usertories.coffee:327-348`)
//                         indexes a PLAIN JS object with a number at `:335`,
//                         `:337` and `:340`, which JavaScript coerces to a
//                         string key, and `:345` `Immutable.fromJS(collection)`
//                         then yields a string-keyed Map. `initUsByStatusList`
//                         is explicit about it at `:103` -- `String(usModel.status)`.
//                         Read back as `.get(s.id.toString())` at
//                         `kanban-table.jade:204`, `:211` and `:229`.
//   usByStatusSwimlanes   Outer key NUMERIC swimlane id, INCLUDING the synthetic
//                         `-1` (`kanban-usertories.coffee:390`
//                         `set(swimlane.id, ...)`). Inner key NUMERIC status id,
//                         via an explicit cast at `:388`
//                         `set(Number(statusId), ...)`. Read back as
//                         `.getIn([swimlane.id, s.id])` at
//                         `kanban-table.jade:128`, `:135` and `:153`.
//   usMap                 NUMERIC story id (`kanban-usertories.coffee:150`,
//                         `:228`, `:280`, `:291`, `:343`). Read back as
//                         `.get(usId)` at `kanban-table.jade:160`, `:163`
//                         and `:238`.
//
// DO NOT NORMALISE THESE TO ONE KEY TYPE. `./boardSelectors.ts` rebuilds all
// three, and the incumbent's lookup expressions are the specification it has to
// match. A mismatched key produces an empty column, never an error.
//
// One honest caveat, so the aliases are used for what they are: TypeScript
// erases both `Record<string, T>` and `Record<number, T>` to string-keyed
// objects at runtime, so these two annotations cannot enforce anything by
// themselves. They are a documentation-and-discipline device that mirrors the
// incumbent's lookup expressions -- what stops a later change from writing
// `usByStatus[statusId]` with a number where the incumbent wrote
// `.get(String(statusId))`. The enforcement lives in `./boardSelectors.ts`,
// which must build each structure with the key type declared here.
// ---------------------------------------------------------------------------

/**
 * Status id, STRINGIFIED, to the ordered story ids in that status.
 *
 * Flat mode -- the board renders from this when the project has no swimlanes
 * (`kanban-table.jade:184-:245`, gated on `ng-if="!swimlanesList.size"`).
 * Order is significant: it is the render order, produced by sorting on the
 * `order` index (`kanban-usertories.coffee:328`).
 */
export type UsByStatus = Readonly<Record<string, readonly number[]>>;

/**
 * Swimlane id, NUMERIC and including `-1`, to status id, NUMERIC, to the
 * ordered story ids in that cell.
 *
 * Swimlane mode -- the board renders from this when the project has swimlanes
 * (`kanban-table.jade:73-:175`). `-1` is the synthetic "unclassified" swimlane;
 * see `SwimlaneListEntry` and the `-1` rule on `CardUserStoryVm.swimlane`.
 */
export type UsByStatusSwimlanes = Readonly<
    Record<number, Readonly<Record<number, readonly number[]>>>
>;

/**
 * Story id, NUMERIC, to the card view-model rendered for it.
 *
 * The board looks a card up by id at exactly the point of render --
 * `item="usMap.get(usId)"` (`kanban-table.jade:163`, `:238`) -- which is why
 * the grouped views above hold ids rather than cards: one card object, many
 * groupings.
 */
export type UsMap = Readonly<Record<number, CardUserStoryVm>>;

/**
 * One entry of the rendered swimlane list.
 *
 * `refreshSwimlanes` (`kanban-usertories.coffee:350-390`) builds this list from
 * the project's real swimlanes and, when any story is unclassified (`:357-:358`
 * `us.swimlane == null`), prepends ONE synthetic entry at index 0
 * (`:368-:373`):
 *
 *   `{ id: -1, kanban_order: 1, name: @translate.instant("KANBAN.UNCLASSIFIED_USER_STORIES") }`
 *
 * `kanban_order` is OPTIONAL, and that is measured rather than defensive: the
 * live `GET /api/v1/swimlanes` payload carries `id`, `name`, `order`, `project`
 * and `statuses` -- NO `kanban_order` -- so ONLY the synthetic entry has it. It
 * is added by intersection rather than by widening `Swimlane`, because
 * `swimlane.ts` owns that interface and none of `id`, `name` or `statuses` may
 * be redeclared here. The same asymmetry is why `Swimlane.statuses` is optional
 * there: the synthetic entry has no statuses, and the board therefore reads its
 * columns from `swimlanesStatuses[-1]`, which `main.coffee:656` seeds with ALL
 * project statuses.
 *
 * `name` on the synthetic entry is a TRANSLATION KEY, not display text. The
 * incumbent resolved it eagerly through `$translate.instant`; in React
 * translation belongs to `../../bridge/useTranslate.ts`. Do not resolve it here.
 */
export type SwimlaneListEntry = Swimlane & { readonly kanban_order?: number };

// ---------------------------------------------------------------------------
// 4. THE NORMALISED BOARD STATE
//
// T9 comment site (7) -- THIS INTERFACE HOLDS NO DERIVED VIEW.
//
// `usByStatus`, `usByStatusSwimlanes`, `usMap`, `swimlanesList`, the per-cell
// counts and the placeholder predicate are ALL absent by design. The incumbent
// recomputed them inside `refresh` / `refreshSwimlanes` and cached them on the
// service, then republished them onto `$scope` through
// `taiga.defineImmutableProperty` (`main.coffee:144-155`). In React they are
// pure derivations computed on read by `./boardSelectors.ts`.
//
// Putting any of them here would create two competing sources of truth for the
// same grouping, and would collapse the presentational/container split that
// requirement I9 exists to enforce -- the split that makes the >=70% line
// coverage gate reachable with a browserless suite, because a selector is a
// pure function of this state and a component is a pure function of props.
//
// The AngularJS bridge does hand the four projections over as first-frame
// `params` (`react-bridge.coffee`), and that is consistent with this boundary:
// they are an initial snapshot for the container to hydrate FROM, never state
// to keep.
// ---------------------------------------------------------------------------

/**
 * Everything the reducer owns, and nothing it can recompute.
 *
 * T1 lands on this interface as an obligation rather than a restriction: this
 * file emits no markup, so preserving the CSS class contract means declaring
 * the state those classes are bound to. Each of the following drives a rule in
 * a stylesheet that must not be edited --
 *
 *   folds               -> `vfold`                    (`kanban-table.jade:20`, `:113`, `:190`)
 *   unfold              -> `vunfold`                  (`:113`, `:190`)
 *   selectedUss         -> `kanban-task-selected` AND `ui-multisortable-multiple` (`:154`, `:230`)
 *   movedUs             -> `kanban-moved`             (`:154`)
 *   foldedSwimlane      -> the swimlane body render gate and `folded` (`:82`, `:86`, `:90`, `:108`)
 *   notFoundUserstories -> `not-found`                (`:146`, `:222`)
 *   renderInProgress    -> the counter's `disabled`   (`:127`, `:203`)
 *
 * -- so omitting any one of them would break a rule in
 * `app/styles/modules/kanban/kanban-table.scss`, which this migration keeps at
 * zero edits.
 */
export interface KanbanBoardState {
    /**
     * Story id -> raw story. The normalised replacement for the service's
     * mutable `userstoriesRaw` array (`kanban-usertories.coffee:60`, `:89`).
     *
     * Plain objects only: the incumbent's entries are post-`getAttrs()` models
     * (`:303`), and P-IMMER-1 forbids a class instance ever entering a draft.
     */
    readonly storiesById: Readonly<Record<number, UserStory>>;

    /**
     * Story id -> render order.
     *
     * The service's `order` index, rebuilt wholesale by `refreshRawOrder`
     * (`kanban-usertories.coffee:188-191`) as
     * `@.order[it.id] = it.kanban_order`, and then reassigned in place by
     * `move` (`:217`, `:225`) so that a drag renumbers only the affected run.
     * It is kept separate from `storiesById` for exactly that reason -- the
     * incumbent moves cards by rewriting this index, not the stories.
     *
     * Deliberately absent: an `ASSIGN_ORDERS` counterpart. `assignOrders`
     * (`:193-196`) has zero callers in the kanban module -- the only such call
     * in the repository is `taskboard/main.coffee:654` against the different
     * `taskboardTasksService` -- so there is no behaviour to preserve.
     */
    readonly order: Readonly<Record<number, number>>;

    /**
     * The project's real swimlanes, in API order, as handed to the service by
     * `init(project, swimlanes, usersById)` (`main.coffee:599`,
     * `kanban-usertories.coffee:76-79`, seeded empty at `:61`).
     *
     * The SYNTHETIC `-1` entry is NOT here. It is a render-time concern, so
     * `./boardSelectors.ts` prepends it when building the swimlane list -- see
     * `SwimlaneListEntry`.
     */
    readonly swimlanes: readonly Swimlane[];

    /**
     * The project's user-story statuses, sorted BY `order`:
     * `main.coffee:672` `@scope.usStatusList = _.sortBy(project.us_statuses, "order")`.
     *
     * T10 HAZARD: the backlog screen sorts the SAME source list by a DIFFERENT
     * key (`app/coffee/modules/backlog/main.coffee`, `_.sortBy(..., "id")`).
     * The two orderings are independently observable -- kanban column order
     * versus the backlog status dropdown -- so DO NOT UNIFY them, and do not
     * "fix" either one. Preserving both is a behavioural requirement, not a
     * duplication to be removed.
     */
    readonly usStatusList: readonly Status[];

    /**
     * Swimlane id -> the statuses that swimlane renders as columns.
     *
     * Built at `main.coffee:648-658`: `:651` seeds `{}`, `:654` assigns
     * `[swimlane.id] = swimlane.statuses` per real swimlane, and `:656`
     * assigns `[-1] = project.us_statuses` -- the synthetic swimlane gets ALL
     * project statuses, because it has none of its own. Read back as
     * `swimlanesStatuses[swimlane.id]` at `kanban-table.jade:114`.
     *
     * `-1` is legitimate here: this is a swimlane COLLECTION, not a story.
     */
    readonly swimlanesStatuses: Readonly<Record<number, readonly Status[]>>;

    /**
     * User id -> resolved user, used to build `CardUserStoryVm.assigned_to` and
     * `assigned_users`. See `BoardUser` for the full provenance.
     *
     * The bridge exposes no getter for this index; the container derives it
     * from the project's members, which is the same source the incumbent uses
     * (`main.coffee:683` `@.fillUsersAndRoles(project.members, project.roles)`
     * -> `controllerMixins.coffee:28`). Hence `SET_USERS_BY_ID`.
     */
    readonly usersById: Readonly<Record<number, BoardUser>>;

    /**
     * Story id -> whether the card's extra sections have been toggled.
     *
     * The service's `foldStatusChanged` index (`kanban-usertories.coffee:62`,
     * `:82`, `:85`). Absence is meaningful and is preserved by
     * `CardUserStoryVm.foldStatusChanged` being `boolean | undefined`: a story
     * that has never been toggled must read `undefined`, so a selector must NOT
     * default a missing entry to `false` when projecting it onto a card.
     */
    readonly foldStatusChanged: Readonly<Record<number, boolean>>;

    /**
     * Status ids whose stories are currently withheld from the board.
     *
     * `kanban-usertories.coffee:68` seeds it, `:171-173` pushes on hide, and
     * `:175-176` removes on show. Combined with `archivedStatus` it drives
     * `isUsInArchivedHiddenStatus` (`:164-169`), which the board passes to each
     * card as `archived` (`kanban-table.jade:167`, `:242`).
     */
    readonly statusHide: readonly number[];

    /**
     * Status ids known to be archived columns.
     *
     * `kanban-usertories.coffee:71` seeds it and `:161-162` pushes, driven from
     * the archived column header once the first load completes --
     * `main.coffee:911` calls `addArchivedStatus(status.id)` and `:912`
     * immediately calls `hideStatus(status.id)`, so an archived column starts
     * both archived AND hidden. Distinct from `Status.is_archived`, which is
     * project configuration: this is the runtime record of which archived
     * columns the board has taken responsibility for, and the two together are
     * what `isUsInArchivedHiddenStatus` requires
     * (`kanban-usertories.coffee:164-169` -- it demands a hit in BOTH lists).
     */
    readonly archivedStatus: readonly number[];

    /**
     * Status id -> whether that column is folded.
     *
     * T9 comment site (3) -- THE FOLD KEY-TYPE SEAM.
     *
     * NUMERIC-keyed here, because every consumer indexes it with a raw status
     * id: `folds[s.id]` at `kanban-table.jade:20`, `:113` and `:190`, and
     * `$scope.folds[status.id]` at `main.coffee:1000`, `:1002` and `:1020`.
     * But its persisted form is STRING-keyed -- `getStatusColumnModes` returns
     * `$storage.get(hash) or {}` (`app/coffee/modules/resources/kanban.coffee:24-27`),
     * and a JSON round-trip through storage always yields string keys.
     *
     * The AngularJS incumbent performs NO conversion between the two: it reads
     * the stored object and indexes it with a number, relying on JavaScript
     * coercing the key. Declaring it numeric here is therefore a TYPING
     * ACCOMMODATION ONLY and is RUNTIME-IDENTICAL, because JavaScript object
     * keys are always strings. `./boardReducer.ts` performs the explicit
     * `Object.entries` + `Number(key)` rebuild at hydration -- see
     * `SET_FOLDS`, whose payload is deliberately string-keyed -- and that
     * rebuild MUST NOT drop or renumber any entry.
     */
    readonly folds: Readonly<Record<number, boolean>>;

    /**
     * The single status column just unfolded, or `null`.
     *
     * `main.coffee:999` resets it to `null` on every toggle and `:1003` sets it
     * to the status id when that column ends up unfolded, which is what makes
     * `vunfold` a one-shot class on one column
     * (`kanban-table.jade:113`, `:190`) rather than the inverse of `folds`.
     */
    readonly unfold: number | null;

    /**
     * Swimlane id, STRINGIFIED, -> whether that swimlane is collapsed.
     *
     * STRING-keyed VERBATIM, and not to be tidied. `main.coffee:425` writes
     * `.set(id.toString(), ...)`, `:237` writes
     * `.set(@scope.swimlanesList.first().id.toString(), false)`, `:680`
     * hydrates straight from `getSwimlanesModes`
     * (`resources/kanban.coffee:34-37`), and the template reads
     * `.get(swimlane.id.toString())` at `kanban-table.jade:82`, `:86`, `:90`
     * and `:108`. The synthetic swimlane's key is therefore the string `'-1'`.
     *
     * This is the counterpart of the `folds` seam above: `folds` is coerced to
     * numeric keys to match its consumers, this one keeps string keys to match
     * its consumers, and the two must not be made to agree.
     */
    readonly foldedSwimlane: Readonly<Record<string, boolean>>;

    /**
     * Story id -> whether the card is multi-select selected.
     *
     * `main.coffee:130` seeds `{}` and `:191-192` toggles. Note `:187-189`:
     * `cleanSelectedUss` sets every existing key to `false` and NEVER deletes
     * one, so this record grows monotonically within a page view. That is
     * preserved deliberately -- a selector must treat a missing key and a
     * `false` key identically, exactly as `ctrl.selectedUss[usId]` does at
     * `kanban-table.jade:154` and `:230`, where it drives BOTH
     * `kanban-task-selected` and `ui-multisortable-multiple`.
     */
    readonly selectedUss: Readonly<Record<number, boolean>>;

    /**
     * Story ids currently flashing the `kanban-moved` highlight
     * (`kanban-table.jade:154`).
     *
     * `main.coffee:131` seeds `[]`, `:249` pushes the moved id inside
     * `moveUsToTop`, and `:250-251` clears the WHOLE array after exactly
     * 1000 ms. Only the move-to-top path populates it -- an ordinary drag does
     * not -- which is why `MARK_US_MOVED` is a distinct action from
     * `MOVE_CARD`. The timer itself belongs to the hook, not to the reducer;
     * the reducer only exposes `CLEAR_MOVED_US`.
     */
    readonly movedUs: readonly number[];

    /**
     * The active zoom level, 0-3. `main.coffee:209-216` coerces it with
     * `Number(zoomLevel)` and returns early when unchanged, so it is always a
     * number here. Bound to the board's `zoom-0` ... `zoom-3` classes
     * (`kanban-table.jade:14`) and passed to every card as `zoom-level`
     * (`:166`, `:241`).
     */
    readonly zoomLevel: number;

    /**
     * The feature list the current zoom level exposes -- see
     * `CardZoomFeatures`. Assigned alongside `zoomLevel` at
     * `main.coffee:217` and passed to every card as `zoom`
     * (`kanban-table.jade:165`, `:240`).
     *
     * The reducer seeds `[]` rather than leaving it undefined. That is
     * behaviour-preserving, not a change: the incumbent only ever renders cards
     * after `initialLoad` becomes true (`kanban-table.jade:9`), by which point
     * the zoom directive's first `$watch` has already fired
     * (`kanban-board-zoom.directive.coffee:37`).
     */
    readonly zoom: CardZoomFeatures;

    /**
     * True while a zoom increase past level 2 is refetching stories, because
     * levels 3 and 4 need attachments and tasks the earlier levels did not
     * request. `main.coffee:225` sets it, `:228` clears it.
     */
    readonly zoomLoading: boolean;

    /**
     * True while the batched initial render is still draining its queue.
     * `main.coffee:469` sets it, `:489` clears it once the DOM has settled.
     * Bound to the animated counter's `disabled` input
     * (`kanban-table.jade:127`, `:203`) so the counts do not animate through
     * every intermediate batch.
     */
    readonly renderInProgress: boolean;

    /**
     * False until the first load has completed, then true.
     * `main.coffee:681` sets false and `:687` sets true inside a zero-delay
     * timeout. It gates the entire board (`kanban-table.jade:9`
     * `ng-if="ctrl.initialLoad"`), which is why several one-shot behaviours in
     * the incumbent watch it rather than running at link time.
     */
    readonly initialLoad: boolean;

    /**
     * True when a load returned no stories AND a filter or search was active --
     * `main.coffee:594` resets it, `:596-597` sets it. It distinguishes "no
     * results for this filter" from "this project is empty", and drives the
     * `not-found` class on the placeholder (`kanban-table.jade:146`, `:222`).
     */
    readonly notFoundUserstories: boolean;
}


// ---------------------------------------------------------------------------
// 5. THE REDUCER'S ACTION UNION
//
// A discriminated union on a `type` field carrying a string LITERAL. Not a TS
// `enum`: an enum emits runtime code, which would break the zero-statement
// contract this module depends on for coverage neutrality. `./boardReducer.ts`
// switches on that discriminant exhaustively, which `noFallthroughCasesInSwitch`
// requires, and which is also what makes a later addition here a COMPILE ERROR
// in the reducer rather than a silently ignored action.
//
// Payloads are flat argument lists rather than a nested `payload` bag, mirroring
// the controller and service methods each action stands in for. Every payload
// carries plain data ONLY -- no `$tgModel` instance, no Immutable structure, no
// promise, no callback and no DOM node. Anything asynchronous or effectful is
// the hook's business (`../hooks/`), and the reducer stays a pure function so it
// is testable without a browser (requirement I9).
//
// Two members are NOT in the plan's enumeration and are present because the
// state they reach would otherwise be unreachable dead weight:
//
//   MARK_US_MOVED     `movedUs` is pushed to at `main.coffee:249`, and without a
//                     corresponding action the `kanban-moved` class
//                     (`kanban-table.jade:154`) could never apply -- a T1
//                     regression. It is deliberately separate from `MOVE_CARD`
//                     because only the move-to-top path populates that list.
//   SET_ZOOM_LOADING  `zoomLoading` is written at `main.coffee:225` and `:228`
//                     around the refetch a zoom increase past level 2 triggers.
//
// One member from the service is deliberately NOT here: `ASSIGN_ORDERS`. See
// `KanbanBoardState.order` -- `assignOrders` has zero callers in this module, so
// there is no behaviour to preserve, and adding it would be an enhancement the
// Minimal Change Clause forbids.
// ---------------------------------------------------------------------------

/**
 * The first-frame snapshot the container hydrates from.
 *
 * EVERY MEMBER IS OPTIONAL, and that is a property of the seam rather than
 * laxity. The AngularJS bridge builds its payload at controller-construction
 * time, before the asynchronous `loadInitialData` chain (`main.coffee:678`) has
 * populated anything, so on the first frame most of these are genuinely absent
 * or empty and arrive later through the individual `SET_*` actions. The reducer
 * must therefore treat an absent member as "leave the current value alone", not
 * as "reset to empty".
 *
 * `folds` and `foldedSwimlane` are STRING-KEYED HERE, deliberately, because that
 * is the shape persistence returns: `getStatusColumnModes` and
 * `getSwimlanesModes` both end `$storage.get(hash) or {}`
 * (`app/coffee/modules/resources/kanban.coffee:24-27` and `:34-37`), and a JSON
 * round-trip yields string keys. `foldedSwimlane` STAYS string-keyed in state;
 * `folds` does not, so this is the exact point at which `./boardReducer.ts`
 * performs the `Object.entries` + `Number(key)` rebuild described on
 * `KanbanBoardState.folds`. It must not drop or renumber an entry.
 */
export interface KanbanBoardHydration {
    /** Raw stories, plain objects post-`getAttrs()`. Normalised into `storiesById` and `order`. */
    readonly stories?: readonly UserStory[];

    /** The project's real swimlanes; the synthetic `-1` entry is never among them. */
    readonly swimlanes?: readonly Swimlane[];

    /** Statuses ALREADY sorted by `order` (`main.coffee:672`). Do not re-sort. */
    readonly usStatusList?: readonly Status[];

    /** Includes the `-1` entry seeded with all project statuses (`main.coffee:656`). */
    readonly swimlanesStatuses?: Readonly<Record<number, readonly Status[]>>;

    /** One resolved user per id -- see `BoardUser`. */
    readonly usersById?: Readonly<Record<number, BoardUser>>;

    /** STRING-keyed as stored; the reducer converts to numeric keys. */
    readonly folds?: Readonly<Record<string, boolean>>;

    /** STRING-keyed as stored, and STRING-keyed in state. No conversion. */
    readonly foldedSwimlane?: Readonly<Record<string, boolean>>;

    /** May be absent: the zoom directive's first `$watch` may not have fired yet. */
    readonly zoom?: CardZoomFeatures;

    /** May be absent for the same reason as `zoom`; the two always travel together. */
    readonly zoomLevel?: number;
}

/**
 * Move one or more cards to a position within a status column, optionally in a
 * different swimlane. The load-bearing action of this union.
 *
 * It reproduces the argument list of `move` (`kanban-usertories.coffee:198`) and
 * carries everything its caller needs back (`:243-:249`), which the
 * position-relative write API then consumes as `after_userstory_id` /
 * `before_userstory_id` (`main.coffee:714-:721`).
 *
 * Why an off-by-one here is dangerous: the ordering endpoint is
 * POSITION-RELATIVE, not index-based. A wrong neighbour persists a wrong order
 * with no error surface at all, and the divergence only becomes visible on the
 * next page load.
 */
export interface KanbanMoveCardAction {
    readonly type: 'MOVE_CARD';

    /**
     * The moving stories, as IDS -- never models. Proven by
     * `kanban-usertories.coffee:210`, which compares `listIt.id == moveIt`, so
     * each element of the list is compared against an `id`.
     */
    readonly usList: readonly number[];

    /** The destination status id. */
    readonly statusId: number;

    /**
     * The destination swimlane, or `null` for the unclassified swimlane.
     *
     * `-1` is TOLERATED ON INPUT, because that is the id the synthetic swimlane
     * renders with and therefore the value a drop handler naturally reads off
     * the DOM. The reducer normalises it to `null`, exactly as
     * `main.coffee:702-:703` does before touching either the local state or the
     * API. What must never happen is `-1` being STORED on a story -- see the
     * `-1` rule on `CardUserStoryVm.swimlane` for why that silently hides cards.
     */
    readonly swimlaneId: number | null;

    /**
     * The drop index within the destination cell.
     *
     * Carried because the incumbent's signature carries it -- `move` accepts it
     * at `kanban-usertories.coffee:198` and `moveUs` forwards it at
     * `main.coffee:709`, and it is also broadcast at `:698`. Note that `move`
     * itself derives its insertion point from `previousCard` (`:202-:207`)
     * rather than from this value, so the neighbours below are authoritative
     * whenever the two could disagree.
     */
    readonly index: number;

    /**
     * The id of the card the moved run lands AFTER, or `null` when it lands
     * first. Becomes `after_userstory_id` on the wire.
     */
    readonly previousCard: number | null;

    /**
     * The id of the card the moved run lands BEFORE, or `null`. Becomes
     * `before_userstory_id` on the wire.
     *
     * Both neighbours are COMPUTED by `../../shared/dnd/useSortableList.ts` and
     * merely CARRIED through this payload -- PREVIOUS WINS there, so this is
     * non-null only when `previousCard` is falsy. This folder must never
     * re-derive them: a second implementation of that arithmetic is exactly how
     * the two would drift.
     */
    readonly nextCard: number | null;
}

/**
 * Every transition `./boardReducer.ts` implements.
 *
 * Ordered to match the lifecycle: hydration, story collection, movement, fold
 * state, selection, zoom, load flags, status visibility, then taxonomies.
 */
export type KanbanBoardAction =
    // --- hydration -------------------------------------------------------
    /** Merge a first-frame snapshot. See `KanbanBoardHydration`. */
    | ({ readonly type: 'HYDRATE' } & KanbanBoardHydration)

    // --- story collection ------------------------------------------------
    /** Replace the whole collection and rebuild `order` from `kanban_order` (`kanban-usertories.coffee:88-91`). */
    | { readonly type: 'SET_STORIES'; readonly stories: readonly UserStory[] }
    /** Upsert a batch, replacing any existing entry with the same id (`:126-:159`). */
    | { readonly type: 'ADD_STORIES'; readonly stories: readonly UserStory[] }
    /** Drop one story and its `order` entry (`:108-:123`). */
    | { readonly type: 'REMOVE_STORY'; readonly storyId: number }
    /** Swap in a fresh copy of one story, keeping its position (`:274-:280`). */
    | { readonly type: 'REPLACE_STORY'; readonly story: UserStory }

    // --- movement --------------------------------------------------------
    | KanbanMoveCardAction
    /**
     * Send one story to the end of a status column by assigning order `-1`
     * (`kanban-usertories.coffee:257-:267`, which also writes
     * `us.kanban_order = @.order[us.id]`).
     *
     * `-1` here is an ORDER value, unrelated to the swimlane sentinel. Measured
     * for the record: `moveToEnd` has no caller in the current tree, and it is
     * declared here because `./boardReducer.ts` implements the transition.
     */
    | { readonly type: 'MOVE_TO_END'; readonly storyId: number; readonly statusId: number }

    // --- fold state ------------------------------------------------------
    /** Flip one card's extra-section fold (`kanban-usertories.coffee:84-86`). */
    | { readonly type: 'TOGGLE_FOLD'; readonly storyId: number }
    /** Clear every card fold (`:81-82`), as `setZoom` does after a zoom change (`main.coffee:222`, `:229`). */
    | { readonly type: 'RESET_FOLDS' }
    /**
     * Fold or unfold one status COLUMN, reproducing `foldStatus`
     * (`main.coffee:995-:1005`): clear `unfold` first, flip `folds[statusId]`,
     * then set `unfold` to that id only if the column ended up UNfolded.
     */
    | { readonly type: 'TOGGLE_STATUS_COLUMN_FOLD'; readonly statusId: number }
    /** Seed column folds from storage; STRING-keyed on input (`main.coffee:997`, `:1014-:1020`). */
    | { readonly type: 'SET_FOLDS'; readonly folds: Readonly<Record<string, boolean>> }
    /** Flip one swimlane's collapsed state (`main.coffee:424-425`). */
    | { readonly type: 'TOGGLE_SWIMLANE'; readonly swimlaneId: number }
    /** Seed swimlane folds from storage; STRING-keyed on input AND in state (`main.coffee:680`). */
    | {
          readonly type: 'SET_FOLDED_SWIMLANES';
          readonly foldedSwimlane: Readonly<Record<string, boolean>>;
      }

    // --- selection and the moved highlight -------------------------------
    /** Flip one card's multi-select state (`main.coffee:191-192`). */
    | { readonly type: 'TOGGLE_SELECTED_US'; readonly storyId: number }
    /** Set every existing selection key to `false` WITHOUT deleting any (`main.coffee:187-189`). */
    | { readonly type: 'CLEAN_SELECTED_USS' }
    /** Start the `kanban-moved` highlight for one story (`main.coffee:249`). */
    | { readonly type: 'MARK_US_MOVED'; readonly storyId: number }
    /** Clear the WHOLE highlight list, as the 1000 ms timer does (`main.coffee:250-251`). */
    | { readonly type: 'CLEAR_MOVED_US' }

    // --- zoom ------------------------------------------------------------
    /** Both values always travel together (`main.coffee:216-217`). */
    | { readonly type: 'SET_ZOOM'; readonly zoomLevel: number; readonly zoom: CardZoomFeatures }
    /** Bracket the refetch a zoom increase past level 2 triggers (`main.coffee:225`, `:228`). */
    | { readonly type: 'SET_ZOOM_LOADING'; readonly zoomLoading: boolean }

    // --- load and render flags -------------------------------------------
    /** Bracket the batched initial render (`main.coffee:469`, `:489`). */
    | { readonly type: 'SET_RENDER_IN_PROGRESS'; readonly renderInProgress: boolean }
    /** Gate the board on first load (`main.coffee:681`, `:687`). */
    | { readonly type: 'SET_INITIAL_LOAD'; readonly initialLoad: boolean }
    /** Distinguish "no results for this filter" from "empty project" (`main.coffee:594`, `:597`). */
    | { readonly type: 'SET_NOT_FOUND_USERSTORIES'; readonly notFoundUserstories: boolean }

    // --- status visibility -----------------------------------------------
    /** Withhold a status's stories from the board (`kanban-usertories.coffee:171-173`). */
    | { readonly type: 'HIDE_STATUS'; readonly statusId: number }
    /** Stop withholding it (`:175-176`). */
    | { readonly type: 'SHOW_STATUS'; readonly statusId: number }
    /** Record that an archived column is now the board's responsibility (`:161-162`). */
    | { readonly type: 'ADD_ARCHIVED_STATUS'; readonly statusId: number }

    // --- taxonomies, all arriving from the async load chain ---------------
    /** `main.coffee:648-:662` -> `kanban-usertories.coffee:76-79`. */
    | { readonly type: 'SET_SWIMLANES'; readonly swimlanes: readonly Swimlane[] }
    /** `main.coffee:651-:656`, including the `-1` entry. */
    | {
          readonly type: 'SET_SWIMLANES_STATUSES';
          readonly swimlanesStatuses: Readonly<Record<number, readonly Status[]>>;
      }
    /** `main.coffee:672`, ALREADY sorted by `order`. Do not re-sort. */
    | { readonly type: 'SET_US_STATUS_LIST'; readonly usStatusList: readonly Status[] }
    /** `main.coffee:683` -> `controllerMixins.coffee:28`. */
    | {
          readonly type: 'SET_USERS_BY_ID';
          readonly usersById: Readonly<Record<number, BoardUser>>;
      };


// ---------------------------------------------------------------------------
// 6. LEDGER OF THE GOVERNING CONSTRAINTS
//
// NO USER-SPECIFIED RULES EXIST FOR THIS PROJECT. `review_rules` returns "No
// user rules provided.", which the Agent Action Plan corroborates. The bar is
// NOT lowered and nothing is invented in their place: enterprise practice
// applies, and the plan's own constraints stand in for a rules document. Each
// one, summarised, with where this module honours it:
//
//   T1   Class names preserved. This file emits no markup, so the obligation is
//        to declare the state the untouched stylesheets are bound to -- the
//        seven-way mapping on `KanbanBoardState`, from `folds` -> `vfold` to
//        `renderInProgress` -> the counter's `disabled`.
//   T2   Colours stay data-bound. `ColorizedTag.color` is `Tag[1]`, nullable,
//        and there is no colour literal anywhere in this file -- no status
//        palette, no default swatch.
//   T3   Zero new icon assets, hence no icon-name union or enum.
//   T4   The shared card under `app/modules/components/card/**` is cited only as
//        read-only evidence and is never written to. `CardUserStoryVm` is shaped
//        so the card's existing reads type-check unchanged, `'loading-extra'`
//        included, which also keeps the out-of-scope taskboard working.
//   T5   No endpoint, URL, header or envelope type. `KanbanMoveCardAction`
//        carries the neighbour ids the ordering call needs, and the request
//        itself belongs to `../../shared/api/`.
//   T8   New code isolated under `app/react/**`. This module adds one file and
//        edits nothing, in this folder or outside it.
//   T9   The seam is documented at each point of change. All seven mandated
//        sites are present: the Immutable -> plain-object boundary and the
//        `.length`-never-`.size` rule (section 2); the three key-type aliases
//        with their proofs and the do-not-normalise instruction (section 3); the
//        `folds` string -> numeric coercion as a typing-only accommodation (on
//        `folds`); the `-1` sentinel rule (on `CardUserStoryVm.swimlane`);
//        `'loading-extra'` being card-owned (on that member); the
//        `usStatusList` sort-key divergence from the backlog (on that member);
//        and `KanbanBoardState` holding no derived view (section 4).
//   T10  No functional change. The measured nullability is preserved exactly --
//        `foldStatusChanged` is `boolean | undefined`, `assigned_to` is
//        `BoardUser | undefined`, `assigned_users` may be shorter than the id
//        list, and `colorized_tags[].color` may be `null`. No default, no
//        computed member, no validation, no type guard, no branded id, no date
//        conversion and no renamed field.
//   HR-2 The dependency set is closed. This module imports four types from
//        `../../shared/types/` and nothing else -- no `immer` (not even
//        `Draft`, which belongs in `./boardReducer.ts`), no schema library, no
//        class-name helper, no lodash, no UI or icon package, and no React.
//   HR-9 >=70% line coverage with Jest. Honoured by contributing zero coverable
//        lines rather than by adding a spec for declarations -- see the
//        zero-statement note in the module header.
//   HR-11 / Minimal Change Clause. Three measured omissions are the discipline
//        in practice: no `ASSIGN_ORDERS` action, because `assignOrders` has no
//        caller in this module; no `'loading-edit'` or `'loading-delete'`
//        member, because both are write-only in the incumbent with no reader
//        anywhere; and no widening of `Swimlane`, whose `order` and `project`
//        members exist on the wire but are not this folder's to declare.
//   I5   The AngularJS-side collection library is neither imported nor modelled.
//        Nothing here exposes `get`, `getIn`, `toJS` or `size`.
//   I9   The presentational/container split this folder exists to serve is
//        preserved by keeping every derived view out of `KanbanBoardState`.
// ---------------------------------------------------------------------------

