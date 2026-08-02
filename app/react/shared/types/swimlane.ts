/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// ---------------------------------------------------------------------------
// Swimlane -- shared domain type for the React rebuild of the Kanban board.
// Mandated by AAP 0.5.1 ("Shared TypeScript models: UserStory, Status,
// Swimlane, Sprint") and 0.6.2 ("Type the UserStory, Status, Swimlane, Sprint
// and Epic shapes from the existing resource definitions").
//
// WHAT THIS FILE DESCRIBES, AND WHY IT IS A PLAIN OBJECT (rule T9)
// ---------------------------------------------------------------------------
// React never receives an AngularJS model instance. Data crosses the
// AngularJS -> React boundary through the `{component, params, events}`
// hand-off that `tgLoadElement` assigns as DOM *properties* rather than as
// attributes (app/coffee/modules/base/load-element.coffee L17-L39), and the
// established house style flattens structural state to plain JavaScript at
// exactly that boundary: the `params` object built in
// app/modules/components/project-menu/project-menu.controller.coffee flattens
// the project model with toJS on L27, with a second flattening precedent on
// L21. The AAP quotes that flattening as "L28"; that locator is off by one --
// L28 is the closing brace `},` of the `params` object. Recorded here so the
// next reader does not chase the wrong line.
//
// One consequence, and it is load-bearing (P-IMMER-1): `$tgModel` hands back
// model classes carrying dirty-tracking state. The file
// app/coffee/modules/base/model.coffee declares `Model` on L9, installs its
// attribute accessors through `Object.defineProperty` on L94-L101, and extracts
// the raw attributes with `getAttrs(patch=false)` on L48-L54. Feeding such an
// immer draft is undefined behaviour, so this interface deliberately describes
// ONLY the flattened, plain object that exists on the React side of the seam.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FINDING B -- the AngularJS side keeps its structural collection (rule T9)
// ---------------------------------------------------------------------------
// `swimlanesList` remains an immutable-collection value on the AngularJS
// `$scope`. It is published there by the `taiga` scope-property helper that
// mirrors a service field onto the scope as a read-only structural collection,
// applied four times in app/coffee/modules/kanban/main.coffee L93-L103
// (`usByStatus` L93, `usMap` L96, `usByStatusSwimlanes` L99, `swimlanesList`
// L102). That helper's name is described here rather than quoted, and the
// collection library is named nowhere in this folder, because a repository
// validation gate greps these type modules for it -- a reminder for the next
// reader, who would otherwise paste the identifier back in and break the gate.
//
// Four template read sites across two files consume the collection's `.size`
// property. app/partials/kanban/kanban.jade L17 binds
// `ng-class="{ 'swimlane': swimlanesList.size }"`, and
// app/partials/includes/modules/kanban-table.jade reads it again on L74, on
// L177 (twice) and on L185.
//
// `.size` is a collection accessor, not a plain-array accessor, and
// app/styles/layout/kanban.scss L10-L20 keys the whole swimlane-mode layout
// off the `swimlane` class that L17 toggles. Flattening `$scope.swimlanesList`
// to a plain array would therefore make that class stop applying and break the
// swimlane layout silently, with no error -- which T1 forbids, because it
// loses a class name the existing stylesheet targets. A fifth reader lives in
// app/modules/components/card/card.controller.coffee L31, a file T4 places out
// of scope and off limits; it is cited here as read-only evidence only.
//
// MANDATED RESOLUTION, already settled by the AAP: leave `swimlanesList`
// exactly as it is on the AngularJS `$scope` and flatten with toJS only at the
// react-bridge seam. app/coffee/modules/backlog/main.coffee initialises the
// same scope value the same way. THIS FILE TYPES THE POST-FLATTENING REACT
// SIDE ONLY. It is not licence to edit kanban.jade L17, to edit
// kanban/main.coffee L93-L103, or to "fix" the `.size` reads. Under I5 the
// legacy structural-collection dependency also stays installed for its 124
// out-of-scope consumers, so nothing in this folder imports it, no member
// below is typed as one of its collections, and no `.get()` or `.size`
// accessor surface is exposed -- React reads these fields directly.
// ---------------------------------------------------------------------------

// The single dependency of this module. `import type` rather than a plain
// `import` because `tsconfig.json` sets `isolatedModules`, under which a
// type-only import must be marked as such so every file can be transpiled on
// its own; it also guarantees the statement is erased and contributes no
// runtime require to the esbuild bundle. The specifier is relative because
// that same configuration declares neither `baseUrl` nor `paths`, so no alias
// exists to import through.
import type { Status } from './status';

/**
 * One Kanban swimlane: the horizontal band that groups user stories, crossed
 * by every status column of the board.
 *
 * ---------------------------------------------------------------------------
 * FIELD SURFACE -- measured at consumption sites, not guessed
 * ---------------------------------------------------------------------------
 * app/coffee/modules/resources/swimlanes.coffee declares no field shape. It is
 * an endpoint facade whose `list` on L16-L18 hands back whatever the
 * collection endpoint sends, so there is no server-side contract in the
 * repository to copy. Every member below was therefore measured where it is
 * actually read, and each one cites those sites. Exactly three fields are
 * read: `id`, `name` and `statuses` -- and no others.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY EXCLUDED -- each with the reason it is absent
 * ---------------------------------------------------------------------------
 *  - `kanban_order`: written into the synthetic swimlane literal at
 *    app/coffee/modules/kanban/kanban-usertories.coffee L297 and then never
 *    read back off a swimlane by either screen. Every other `kanban_order` in
 *    the repository belongs to a USER STORY rather than to a swimlane -- the
 *    sort at kanban-usertories.coffee L130, the order map at L191, the
 *    write-back at L263, and the next-order arithmetic at kanban/main.coffee
 *    L298-L299. Zero swimlane reads, so T10 and the Minimal Change Clause keep
 *    it out.
 *
 *  - `order`: a REQUEST field, not a response field. It exists only as the
 *    third parameter of `swimlanes.create(projectId, name, order)`, copied
 *    into the POST body at swimlanes.coffee L26-L27. Under T5 the request
 *    shapes of `create`, `edit`, `bulkUpdateOrder`, `wipLimitUpdate` and
 *    `delete` are typed by the facades under app/react/shared/api/, layered
 *    over the existing repository layer, and never by this domain model.
 *
 *  - `class`: not a domain field at all. The apparent `swimlane.class` matches
 *    in app/coffee/modules/kanban/main.coffee L1168-L1176 are `classList`
 *    reads on a DOM element that happens to be held in a variable named
 *    `swimlane`.
 *
 *  - `default_swimlane` and `swimlanes`: PROJECT-level fields, not swimlane
 *    fields. kanban-table.jade L102 reads both to decide whether to draw the
 *    default-swimlane star -- `swimlane.id == project.default_swimlane &&
 *    project.swimlanes.length > 1` -- so that comparison deliberately crosses
 *    two shapes. Both belong to the project shape consumed by the screen
 *    containers; neither is added here, and no project type is declared in
 *    this folder.
 *
 * ---------------------------------------------------------------------------
 * TYPE-ONLY BY CONTRACT
 * ---------------------------------------------------------------------------
 * This module holds one type-only import, one interface and comments, and
 * nothing else: no value bindings, no functions, no runtime guards, no
 * factories, no enums. Jest collects coverage across the React tree while
 * negating only `*.test.*`, `*.d.ts` and `index.ts`, so a plain `.ts` file
 * here IS swept by `collectCoverageFrom`. With zero executable statements
 * istanbul attributes zero lines and this module stays neutral against the
 * global `lines: 70` threshold, whereas one value-bearing statement would
 * become an uncovered line that no co-located spec exists to cover -- this
 * folder deliberately carries no spec of its own. Runtime behaviour that
 * branches on a swimlane, the unclassified sentinel included, belongs under
 * app/react/kanban/, where a spec can live beside it.
 *
 * Every member is `readonly`. Board state lives in an immer-produced tree
 * whose `autoFreeze` stays enabled (P-IMMER-4), so structural sharing yields
 * reference equality on untouched branches and makes `React.memo` a genuine
 * replacement for the change detection this migration retires. Mutation
 * happens only inside a producer (P-IMMER-3); `readonly` turns an accidental
 * write outside one into a compile-time error instead of a frozen-object
 * surprise at run time.
 */
export interface Swimlane {
    /**
     * Swimlane identity: the server-side primary key, or the client-side
     * sentinel `-1` described below.
     *
     * A number, not a string. It is stringified only where it is used as a
     * lookup key -- `ctrl.foldedSwimlane.get(swimlane.id.toString())` in
     * app/partials/includes/modules/kanban-table.jade L82, L86, L90 and L108 --
     * while the field itself arrives numeric.
     *
     * It is the repeat key and the board identity throughout the swimlane
     * markup of that template: L75 (`track by swimlane.id`), L76 and L120
     * (`data-swimlane="{{swimlane.id}}"`), L80 and L83 (the hover and toggle
     * handlers), L109 (`kanbanTableLoaded($event, swimlane.id)`), L114 (the
     * per-swimlane column lookup `swimlanesStatuses[swimlane.id]`) and L116 --
     * 21 occurrences in that one file. It is also the key of the per-swimlane
     * story grouping built at
     * app/coffee/modules/kanban/kanban-usertories.coffee L317.
     *
     * -------------------------------------------------------------------
     * `-1` IS A CLIENT-SIDE SENTINEL, NEVER A SERVER VALUE
     * -------------------------------------------------------------------
     * When a project has swimlanes but some stories are unclassified,
     * app/coffee/modules/kanban/kanban-usertories.coffee L295-L300 inserts a
     * synthetic swimlane at index 0 whose `id` is `-1`. The same file maps
     * that sentinel back onto real data on L312-L313: it substitutes `null`
     * for `-1` and then keeps the stories whose own `swimlane` attribute
     * equals the substituted value, read through the story model's nested
     * attribute getter. So `-1` means exactly "the stories whose
     * `UserStory.swimlane` is `null`", and it never arrives from the API.
     *
     * The board renders that band differently, through class names T1
     * protects: kanban-table.jade L82 adds `unclassified-swimlane`, L94 adds
     * `unclassified-us-title`, and L96 gates `.unclassified-us-info` with its
     * help tooltip -- each of the three on `swimlane.id == -1`.
     *
     * The sentinel is documented here rather than modelled in the type, on
     * purpose. A literal union such as `-1 | number` widens straight back to
     * `number` and states nothing, while a type guard or a named `-1` constant
     * would be an executable statement this module must not contain. Code that
     * branches on the sentinel belongs where its spec can live, under
     * app/react/kanban/state/.
     */
    readonly id: number;

    /**
     * Human-readable swimlane label, rendered as the band title.
     *
     * Printed by app/partials/includes/modules/kanban-table.jade L95
     * (`h2.title-name` ... `{{ swimlane.name }}`), the single read on the
     * in-scope board template. Five reads exist repository-wide; the other four
     * belong to out-of-scope surfaces -- the admin swimlane editor, the
     * swimlane selector component and the admin values controller -- and are
     * not this file's concern.
     *
     * Required rather than optional, and required for the synthetic swimlane
     * too: the literal at
     * app/coffee/modules/kanban/kanban-usertories.coffee L295-L300 always
     * supplies a `name`, taking the translated
     * `KANBAN.UNCLASSIFIED_USER_STORIES` string on L298. Every swimlane
     * therefore has a title, so the React header needs no fallback branch --
     * adding one would be a behaviour change, which T10 forbids.
     */
    readonly name: string;

    /**
     * The status columns this swimlane shows, when the payload carries them.
     *
     * OPTIONAL ON PURPOSE, and the reason is the synthetic swimlane rather
     * than defensive typing. The literal at
     * app/coffee/modules/kanban/kanban-usertories.coffee L295-L300 carries
     * only `id`, `kanban_order` and `name`; it has NO `statuses` key. A
     * required member here would misdescribe a value the board really
     * constructs, and marking it optional records precisely that asymmetry.
     *
     * The synthetic swimlane still gets its columns, from the other side of
     * the same lookup. app/coffee/modules/kanban/main.coffee fills that map in
     * `loadSwimlanes`: the `forEach` opened on L557 assigns
     * `swimlanesStatuses[swimlane.id] = swimlane.statuses` on L558, and L560
     * then assigns `swimlanesStatuses[-1] = project.us_statuses`. The template
     * reads only the map -- `s in ::swimlanesStatuses[swimlane.id]` at
     * kanban-table.jade L114 -- and never this member directly, which is why
     * the missing key is invisible on the board.
     *
     * Sharing one map slot with `project.us_statuses` is also what proves the
     * element type is `Status` verbatim, with no per-swimlane variant. The
     * same conclusion follows independently from
     * app/coffee/modules/admin/project-values.coffee, which applies one
     * `is_archived` predicate to `project.us_statuses` at L191-L193 and to
     * `swimlane.statuses` at L195-L198 -- the read itself sits on L196, and it
     * is one of only two reads of this member in the repository, the other
     * being main.coffee L558 above. Do NOT introduce a `SwimlaneStatus`
     * variant; status.ts records the same finding from the status side.
     *
     * Typed `readonly Status[]` rather than `Status[]`: the collection is
     * read, grouped into derived views and rendered, never mutated in place.
     *
     * T2 compliance: a swimlane carries no colour of its own. Every colour on
     * the board reaches it through `Status.color`, which stays an open string
     * bound to the per-project database value, so no colour literal appears in
     * this file and none may be added.
     */
    readonly statuses?: readonly Status[];
}
