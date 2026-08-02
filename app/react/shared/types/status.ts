/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Shared domain model: a user-story status, which on the Kanban board is also
 * a column.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DESCRIBES, AND WHY IT IS A PLAIN OBJECT (rule T9)
 * ---------------------------------------------------------------------------
 * React never sees an AngularJS model instance. Data crosses the
 * AngularJS -> React boundary through the `{component, params, events}`
 * hand-off that `tgLoadElement` assigns as DOM *properties* rather than as
 * attributes (app/coffee/modules/base/load-element.coffee L17-L39), and the
 * established house style flattens structural state to plain JavaScript at
 * exactly that boundary: the `params` object built in
 * app/modules/components/project-menu/project-menu.controller.coffee flattens
 * the project model with toJS on L27, with a second flattening precedent on
 * L21. The AAP quotes that flattening as "L28"; that locator is off by one --
 * L28 is the closing brace `},` of the `params` object. Recorded here so the
 * next reader does not chase the wrong line.
 *
 * Two consequences follow, and both are load-bearing:
 *
 *  - P-IMMER-1: immer dislikes class instances. `$tgModel` hands back model
 *    classes that carry dirty-tracking state -- see
 *    app/coffee/modules/base/model.coffee, where `Model` is declared on L9,
 *    its attribute accessors are installed through `Object.defineProperty` on
 *    L94-L101, and `getAttrs(patch=false)` on L48-L54 is what extracts the raw
 *    attributes. Feeding such an instance into an immer draft is undefined
 *    behaviour, so this interface deliberately describes ONLY the flattened,
 *    plain object that exists on the React side of the seam.
 *
 *  - I5: the legacy structural-collection dependency stays installed for its
 *    124 out-of-scope consumers, but nothing in this folder imports it. No
 *    member below is typed as one of its collections, and no `.get()` or
 *    `.size` accessor surface is exposed -- React reads these fields directly.
 *
 * ---------------------------------------------------------------------------
 * ONE SHAPE, THREE ROLES -- there is deliberately no second status type
 * ---------------------------------------------------------------------------
 * app/coffee/modules/kanban/main.coffee assigns two different collections into
 * the same lookup slot: `swimlanesStatuses[swimlane.id] = swimlane.statuses`
 * on L558, inside the `forEach` opened on L557, and
 * `swimlanesStatuses[-1] = project.us_statuses` on L560. Sharing one slot
 * proves the two collections share one shape, so this single `Status` serves
 * all three consumption sites:
 *
 *   1. `project.us_statuses`  -- the project-wide status list
 *   2. `swimlane.statuses`    -- the per-swimlane status list
 *   3. `usStatusList`         -- the flat, swimlane-less board list, repeated
 *      at app/partials/includes/modules/kanban-table.jade L191
 *
 * Do NOT add a `SwimlaneStatus` or `ColumnStatus` variant: no evidence in the
 * repository supports one, and inventing it would breach T10, which forbids
 * functional and feature changes outright, as well as the Minimal Change
 * Clause.
 *
 * ---------------------------------------------------------------------------
 * FIELD SURFACE -- measured at consumption sites, not guessed
 * ---------------------------------------------------------------------------
 * Neither resource facade -- app/coffee/modules/resources/userstories.coffee
 * nor app/coffee/modules/resources/swimlanes.coffee -- declares a field shape;
 * both are endpoint facades only. Every member below was therefore measured
 * where it is actually read, and each one cites those sites. Occurrence counts
 * in kanban-table.jade: `s.id` 38, `s.is_archived` 10, `s.wip_limit` 4,
 * `s.name` 4, `s.color` 3.
 *
 * `slug`, `order` and `is_closed` are excluded on purpose: each has ZERO
 * property reads on either in-scope screen. Note in particular that the
 * `is_closed` both screens read belongs to the user story, not to its status --
 * it is read off the item model in
 * app/coffee/modules/kanban/card-directives.coffee L150 and L156. Do not
 * conflate the two.
 *
 * ---------------------------------------------------------------------------
 * TYPE-ONLY BY CONTRACT
 * ---------------------------------------------------------------------------
 * This module holds declarations and comments and nothing else: no value
 * bindings, no functions, no runtime guards, no factories, no enums, no
 * imports. Jest collects coverage across the React tree while negating only
 * `*.test.*`, `*.d.ts` and `index.ts`, so a plain `.ts` file here IS swept by
 * `collectCoverageFrom`. With zero executable statements istanbul attributes
 * zero lines and this module stays coverage-neutral against the global
 * `lines: 70` threshold, whereas one value-bearing statement would become an
 * uncovered line that no co-located spec exists to cover. Runtime behaviour --
 * including the WIP threshold arithmetic that selects `one-left` / `reached` /
 * `exceeded` -- belongs to app/react/kanban/WipLimitMarker.tsx, not here.
 *
 * Every member is `readonly`. Board state lives in an immer-produced tree
 * whose `autoFreeze` stays enabled (P-IMMER-4), so structural sharing yields
 * reference equality on untouched branches and makes `React.memo` a genuine
 * replacement for the legacy change detection this migration retires.
 * Mutation happens only inside a producer (P-IMMER-3); `readonly` turns an
 * accidental write outside one into a compile-time error instead of a
 * frozen-object surprise at runtime.
 */
export interface Status {
    /**
     * Server-side primary key, and the identity of the board column.
     *
     * A number, not a string: it is stringified only where it is used as a
     * lookup key -- `usByStatus.get(s.id.toString())` in kanban-table.jade
     * L204 and L211 -- while the field itself arrives numeric.
     *
     * Read as the repeat key and the column identity throughout the board:
     * kanban-table.jade L114 (`track by s.id` over the per-swimlane statuses),
     * L115 (`id="column-{{s.id}}"`), L119 (`data-status="{{s.id}}"`) and L191
     * (`track by s.id` over the flat `usStatusList`).
     */
    readonly id: number;

    /**
     * Human-readable status label -- the board column title.
     *
     * Rendered in the column header at kanban-table.jade L19 and L28, and
     * inside the collapsed-column placeholder at L139 and L215.
     */
    readonly name: string;

    /**
     * Status colour, as an opaque CSS colour string.
     *
     * T2, verbatim: "All status, tag, and epic colours remain data-bound. They
     * come from `s.color`, `tag[1]`, and `epic.color`; the values visible in
     * the Figma frames are `sample_data` artefacts and must never be
     * hardcoded." This member is therefore an OPEN `string` carrying a
     * per-project DATABASE value -- never a union of literals, never an enum,
     * and never a constant declared in this repository.
     *
     * Drift Register entry D3 records the same finding from the design side:
     * the palette visible in the linked frames is seeded demo content, and
     * hardcoding it "would break every real project".
     *
     * Consumed only as an inline style bound straight from the datum:
     * kanban-table.jade L23-L26 (`div.deco-square`) and L140-L142 plus
     * L216-L218 (`.square-color`).
     */
    readonly color: string;

    /**
     * Work-in-progress limit for this status, or `null` when no limit is
     * configured.
     *
     * NULLABLE ON PURPOSE, and the null case is visible behaviour rather than
     * a defensive type. kanban-table.jade passes this value straight through
     * as the counter's `wip` input -- L128 and L135 for the per-swimlane
     * columns, L204 and L211 for the flat columns -- and the counter renders a
     * bare count when the limit is null but `count / limit` when a limit
     * exists. Typing this `number` would erase that branch; `number |
     * undefined` would not describe the value the API actually sends.
     *
     * It is also the ONLY status field the API mutates, on both variants of
     * the resource: app/coffee/modules/resources/userstories.coffee L141-L147
     * PATCHes `userstory-statuses/{id}` with a body of exactly `{wip_limit}`,
     * and app/coffee/modules/resources/swimlanes.coffee L48-L54 PATCHes
     * `swimlane-userstory-statuses/{id}` with the same single-key body. Per T5
     * those request shapes are typed under app/react/shared/api/, not here;
     * the facades are cited only as evidence of the one mutable field.
     */
    readonly wip_limit: number | null;

    /**
     * Whether this status is the archived column.
     *
     * It gates conditional markup that existing CSS class names depend on, so
     * it cannot be pruned without breaking T1 ("Preserve every CSS class name.
     * The in-scope Sass is a pass-through asset, not a rewrite target"):
     * kanban-table.jade L132 and L208 gate `div.ammount`, L138 and L214 gate
     * `div.archived`, L173 and L248 gate `div.kanban-column-intro`, and L35,
     * L44, L60 and L69 gate the header action buttons plus the unfold control
     * that belongs to the squished archived rail.
     *
     * The same flag filters statuses administratively, which is further
     * evidence that it is a plain boolean on this shape:
     * app/coffee/modules/admin/project-values.coffee keeps only the statuses
     * whose `is_archived` is not true, at L191-L193 over `project.us_statuses`
     * and again at L195-L198 over `swimlane.statuses`. One predicate applied to
     * both collections independently corroborates the one-shape finding above.
     */
    readonly is_archived: boolean;
}
