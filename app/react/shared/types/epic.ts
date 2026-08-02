/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// ---------------------------------------------------------------------------
// Epic -- shared domain type for the React rebuild of the Kanban and Backlog
// screens. Mandated by AAP 0.6.2: "Type the UserStory, Status, Swimlane,
// Sprint and Epic shapes from the existing resource definitions."
//
// This module is TYPE-ONLY on purpose. It declares one interface, imports
// nothing and contains zero executable statements, so istanbul attributes zero
// lines to it and it stays neutral against the global line-coverage gate that
// sweeps `app/react/**`. A runtime statement does not belong in this folder.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. WHAT THIS TYPE DESCRIBES, AND WHERE IT IS VALID
//    (T9 -- technology-specific change documented at the point of change,
//     and this is the AngularJS -> React seam.)
//
// This interface describes the PLAIN JavaScript object that exists only on the
// React side of the seam. It deliberately does NOT describe the AngularJS-side
// value, which is never one plain shape:
//
//   * Reached through a `$tgModel` instance, a user story is a class
//     (`app/coffee/modules/base/model.coffee:9`) whose fields are
//     `Object.defineProperty` accessors (`:94-101`) over a private attribute
//     bag, so `us.epics` is read with plain dot access -- exactly what
//     `app/partials/includes/components/backlog-row.jade:54-58` does.
//   * Reached through the shared card, the whole user story has been re-wrapped
//     in a persistent-collection structure and each epic is read through the
//     model getter instead -- `epic.get('color')` at
//     `app/modules/components/card/card-templates/card-epics.jade:14`, and the
//     same style at
//     `app/modules/components/belong-to-epics/belong-to-epics-pill.jade:9-12`.
//
// Neither wrapper form may reach React or immer. P-IMMER-1, verbatim: "immer
// dislikes class instances. `$tgModel` returns model classes carrying
// dirty-tracking state; passing one into a draft produces undefined behaviour.
// Convert to plain objects at the boundary." The bridge therefore flattens
// every value before handing it over, following the established house style
// rather than inventing one:
// `app/modules/components/project-menu/project-menu.controller.coffee:27`
// hands the project over through `toJS`, with a second precedent at `:21`.
// (Locator correction: AAP 0.6.2 cites that call as "L28". L28 is the closing
// brace `},`; the call itself is on L27. Verified by reading the file.)
//
// The two bridges already in the tree implement precisely that rule --
// `app/coffee/modules/kanban/react-bridge.coffee:130-131` and
// `app/coffee/modules/backlog/react-bridge.coffee:185-186` route persistent
// collections through `toJS`, `$tgModel` instances through `getAttrs`
// (`model.coffee:48-54`), and pass already-plain values through untouched.
// Because `getAttrs` is shallow (`model.coffee:54` extends into a fresh
// object one level deep), the nested `epics` array crosses the seam as the
// plain JSON the REST layer returned -- which is the shape declared below.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. HOW AN EPIC IS REACHED
//    (Why this module needs no envelope type, no list type and no id-map type.)
//
// An `Epic` is only ever reached as nested data on a user story, through
// `UserStory.epics`. Neither in-scope screen ever addresses or fetches one
// independently:
//
//   * `backlog-row.jade:55` iterates `us.epics` for the backlog row pills.
//   * `app/partials/backlog/sprint.jade:37-42` forwards `us.epics` straight
//     into the shared `tg-belong-to-epics` component in `format="pill"` mode.
//   * The Kanban card reads the `epics` collection off the user story model
//     it was given (`card-epics.jade:8-10`).
//   * The epic endpoints declared at `app/coffee/modules/resources.coffee:98-104`
//     have zero call sites inside `app/coffee/modules/kanban/**` or
//     `app/coffee/modules/backlog/**`. The only epic-flavoured strings in those
//     two modules are the filter keys `'epic'` and `'exclude_epic'`
//     (`kanban/main.coffee:117-118`, `backlog/main.coffee:90-91`), which are
//     query-parameter names for the userstories-filters endpoint and not reads
//     of an epic object.
//
// T5 also applies: this module is a typed description of what the existing
// repository layer already hands over, so it declares no endpoint, no URL, no
// header and no response envelope.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3. THE FIELD SURFACE IS MEASURED, NOT ASSUMED
//
// Neither resource facade (`resources/userstories.coffee`,
// `resources/sprints.coffee`) declares a field shape -- they map endpoint names
// to URLs. Every member below is therefore justified by a consumption site with
// a file:line citation, and corroborated against the live REST payload: the 18
// nested epic objects inside `GET /api/v1/userstories?project=3` carry integer
// `id` and `ref`, string `subject` and string `color`.
//
// DELIBERATELY EXCLUDED, so that a later reader does not "complete" the type:
//
//   * The nested `project` descriptor that the payload also carries. It has
//     zero reads on either in-scope screen. Structural typing keeps the
//     narrower interface below assignable from the wider payload, so nothing
//     needs it. Omitted under T10 and the Minimal Change Clause.
//   * `project_extra_info`. `card-epics.jade:11` reads it through the model
//     getter off `vm.item` -- the USER STORY -- and not off the epic, so it is
//     not an epic field at all. That file is cited as READ-ONLY evidence under
//     T4, which forbids modifying the shared card component.
//   * `status`, `neighbors`, `is_blocked`, `description_html`. Every read of
//     these lives in the out-of-scope epic-detail screen
//     (`app/coffee/modules/epics/detail.coffee`, `app/partials/epic/`), never
//     on the Kanban board or the Backlog screen.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4. WHY EVERY MEMBER IS `readonly`
//
// P-IMMER-4: immer's `autoFreeze` stays ON, so structural sharing yields
// reference equality on untouched branches -- which is what makes `React.memo`
// a real replacement for the wrapper-based change detection the AngularJS board
// relied on. P-IMMER-3: state is only ever rewritten inside a producer, never
// by mutating a value in place. `readonly` moves both rules from convention to
// a compile-time guarantee, and a frozen value that is written to at runtime
// throws rather than corrupting state silently.
// ---------------------------------------------------------------------------

/**
 * One epic as it appears nested on a user story, after the AngularJS -> React
 * seam has flattened it to a plain object.
 *
 * Consumed by the epic pills on the Backlog rows and in the sprint sidebar, and
 * by the epic swatch and label on the Kanban card.
 */
export interface Epic {
    /**
     * Stable identity. The track-by key of every epic repeat on both screens --
     * `belong-to-epics-pill.jade:9` and `card-epics.jade:10` -- and the value
     * collected by `us.epics.map (epic) -> epic.id` at
     * `app/coffee/modules/common/lightboxes.coffee:951`.
     */
    readonly id: number;

    /**
     * Human-facing reference number, always rendered after a literal "#" that
     * the markup supplies and the value never contains: `backlog-row.jade:53`
     * declares the prefix and `:57` composes the pill tooltip as
     * `#{ref} {subject}`; `belong-to-epics-pill.jade:8` and `:12` do the same.
     * `card-epics.jade:11` uses it as the `ref=` segment of the epic-detail
     * navigation target. Numeric, matching the payload.
     */
    readonly ref: number;

    /**
     * Epic title. Second half of the pill tooltip at `backlog-row.jade:57` and
     * `belong-to-epics-pill.jade:12`; on the card it is the swatch title
     * (`card-epics.jade:15`) and, for the first epic above the smallest zoom
     * level, the visible label (`:18-20`).
     */
    readonly subject: string;

    /**
     * T2, verbatim: "All status, tag, and epic colours remain data-bound. They
     * come from `s.color`, `tag[1]`, and `epic.color`; the values visible in the
     * Figma frames are `sample_data` artefacts and must never be hardcoded."
     *
     * So this is an OPEN `string` carrying a per-project value that lives in the
     * database -- never a union of literals, never an enum, and never a constant
     * in this repository. Drift Register entry D3 records the same finding: the
     * gold/amber epic pills in the Figma frames are `sample_data` artefacts, and
     * hardcoding one would break every real project.
     *
     * Applied inline exactly as the AngularJS markup applies it today: as the
     * pill background at `backlog-row.jade:56`, as background plus a darkened
     * border at `belong-to-epics-pill.jade:11`, and as the swatch background at
     * `card-epics.jade:14`.
     */
    readonly color: string;
}
