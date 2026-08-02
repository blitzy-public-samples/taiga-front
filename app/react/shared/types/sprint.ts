/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// ---------------------------------------------------------------------------
// Sprint -- shared domain type for the React rebuild of the Backlog /
// Sprint-Planning screen, and the one shared type that nests another.
//
// Mandated by AAP 0.5.1 ("Shared TypeScript models: UserStory, Status,
// Swimlane, Sprint") and 0.6.2 ("Type the UserStory, Status, Swimlane, Sprint
// and Epic shapes from the existing resource definitions", sourced from
// `app/coffee/modules/resources/sprints.coffee`).
//
// ONE IMPORT, and it is type-only. `isolatedModules` is enabled in
// tsconfig.json, so a value import of a type would survive transpilation and
// break the single-file emit contract; `import type` is erased instead.
// `noUnusedLocals` is enabled as well, and the imported symbol is genuinely
// used -- by the `user_stories` member. tsconfig.json declares neither
// `baseUrl` nor `paths`, which is why the specifier is relative rather than
// aliased, and the sibling module's file name is camelCase `userStory.ts`,
// which `forceConsistentCasingInFileNames` makes load-bearing: a lower-cased
// specifier would resolve on a case-insensitive filesystem and then fail the
// type gate. The sibling states the same contract from its own side.
// ---------------------------------------------------------------------------

import type { UserStory } from './userStory';

// ---------------------------------------------------------------------------
// 1. WHAT THIS TYPE DESCRIBES, AND WHERE IT IS VALID
//    (Rule T9 -- "Comment every technology-specific change at the point of
//     change, especially at the AngularJS/React seam." This IS that seam.)
//
// This interface describes the PLAIN JavaScript object that exists only on the
// React side of the boundary. It never describes an AngularJS-side value,
// because on that side a sprint is a constructed model instance: `Model` is
// declared at `app/coffee/modules/base/model.coffee:9`, keeps its payload in a
// private bag at `:11`, and exposes every field through `Object.defineProperty`
// accessors installed at `:94-101` that transparently prefer a modified value
// over the stored one.
//
// That wrapper must never reach React or immer. P-IMMER-1, verbatim: "immer
// dislikes class instances. `$tgModel` returns model classes carrying
// dirty-tracking state; passing one into a draft produces undefined behaviour.
// Convert to plain objects at the boundary."
//
// The conversion happens at the hand-off, following the established house style
// rather than a new one. AngularJS gives a Web Component host its data by
// assigning the `{component, params, events}` contract as DOM *properties*
// rather than attributes, which is what lets nested objects and callback
// functions cross the boundary structurally intact instead of being
// stringified. The one production precedent flattens structural state at
// exactly that point:
// `app/modules/components/project-menu/project-menu.controller.coffee:24-33`
// builds that contract and hands the project over through toJS on `:27`, with a
// second flattening precedent on `:21` -- and `:21` is the closest precedent
// available for THIS type, because what it flattens there is the project's
// `milestones` collection, which is to say its sprints.
//
// Locator correction, recorded so the next reader does not chase the wrong
// line: the Agent Action Plan quotes that flattening call as "L28". L28 of the
// same file is the closing brace `},` of the `params` object -- the call itself
// is on L27. Verified by reading the file.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. THE SPRINT IS THE ONE *NESTED* CASE AT THIS SEAM
//    (The single most important thing to understand about this type, so it is
//     proven from the code that already performs the flattening.)
//
// A sprint arrives from the repository layer as a model instance whose
// `user_stories` member has been REPLACED by an array of further model
// instances. The resource facade does that deliberately, in both of its read
// paths:
//
//   `app/coffee/modules/resources/sprints.coffee`
//     :17     $repo.queryOne("milestones", sprintId)      <- single read
//     :19     uses = _.map(uses, (u) -> $model.make_model("userstories", u))
//     :20     sprint._attrs.user_stories = uses           <- REPLACED in place
//     :29     $repo.queryMany("milestones", params, {}, true)   <- list read
//     :33-36  the same re-wrap, per milestone
//
// And `getAttrs` is SHALLOW -- `model.coffee:54` extends the stored and the
// modified attributes into one fresh object exactly one level deep -- so
// unwrapping the sprint alone would still hand immer an array of class
// instances. BOTH LEVELS have to be flattened.
//
// The Backlog bridge already implements precisely that, and it is the producer
// of every value this interface describes:
//
//   `app/coffee/modules/backlog/react-bridge.coffee`
//     :183-187  toPlain          -- null by identity, a collection wrapper
//                                  through toJS, a `$tgModel` through
//                                  `getAttrs`, an already-plain value by
//                                  identity
//     :189      toPlainList
//     :196-199  toPlainSprint    -- toPlain, then re-map `user_stories`
//                                  through toPlainList: the second level
//     :201      toPlainSprintList
//     :205      toPlainSprintMap -- the same treatment for the grouped maps
//
// Consumed by the bridge getters at `:318` (open sprints), `:319` (closed
// sprints), `:320` and `:321` (the two grouped maps) and `:388`. Its own
// comment at `:191-195` records the same finding independently.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3. TRANSPORT NAME VERSUS DOMAIN NAME -- NOT A RENAME
//
// The REST resource is `milestones`; the domain and the user interface call it
// a sprint. Every endpoint proves the transport name:
// `resources/sprints.coffee:17` queries `"milestones"` by id, `:24` reads
// `milestones/{id}/stats`, `:29` queries `"milestones"` by parameters, and the
// three move endpoints at `:44-57` are named for milestones too.
//
// The Agent Action Plan names this type `Sprint` in both 0.5.1 and 0.6.2, so
// `Sprint` is what it is called here, and there is deliberately NO `Milestone`
// alias: a second name for one shape invites two half-populated definitions.
// The member names below are the wire names, unchanged, because renaming a
// payload field would be a behaviour change and T10 permits no functional or
// feature change whatsoever.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4. THE FIELD SURFACE IS MEASURED, NOT ASSUMED
//
// Neither file named as a source declares a field shape. `resources/sprints.coffee`
// is an endpoint facade -- it maps names to URLs and parameters, and its only
// structural contribution is the `user_stories` re-wrap quoted in section 2.
// Every member below therefore carries a consumption site with a file:line
// citation, and the citations were re-verified against the working tree rather
// than copied forward.
//
// TWO LOCATOR CORRECTIONS, recorded for the next reader:
//
//   * The Agent Action Plan cites the two `or 0` point fallbacks as
//     `backlog/sprints.coffee` "L88-L89". In the pristine file they are on
//     L92-L93, and in the current tree -- which grew a retirement commentary
//     block ahead of them -- they are on L191-L192. The code is identical at
//     every one of those positions; only the line number moved.
//   * The plan also attributes the date format used at that file's render step
//     to the shared picker format key. That file actually resolves the
//     sprint-header date key (current tree L170); the picker format key belongs
//     to the sprint lightbox (`backlog/lightboxes.coffee` L62, L168, L218).
//     Both are locale-driven DISPLAY formats, so the conclusion drawn in the
//     note on the two date members is unaffected either way.
//
// Line numbers quoted for `backlog/sprints.coffee` and `backlog/lightboxes.coffee`
// below are current-tree positions for that reason. Every other cited file is
// byte-stable against its original.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 5. WHAT IS DELIBERATELY ABSENT, SO NOBODY "COMPLETES" THE TYPE LATER
//
//   * THE LIST ENVELOPE. `resources/sprints.coffee:38-42` returns
//     `{milestones, closed, open}`, where `closed` and `open` are integers
//     parsed out of the two `Taiga-Info-Total-*-Milestones` response headers
//     (`:40` and `:41`). That envelope is a TRANSPORT shape and belongs to
//     `app/react/shared/api/` under T5, verbatim: "Reuse `$tgResources`; do not
//     build a parallel HTTP client. New TypeScript files are typed facades over
//     the existing repository layer."
//
//     COLLISION HAZARD, and it is the reason this bullet is first: the
//     envelope's `closed` is a COUNT of closed milestones across the project,
//     whereas the `closed` member below is a BOOLEAN on one sprint. Same word,
//     different type, different meaning. Do not conflate them, and do not let
//     one definition grow to serve both.
//
//   * THE STATS PAYLOAD. `service.stats` reads `milestones/{id}/stats` through
//     the raw query path at `:23-24`. It is a separate response, not part of
//     this model.
//
//   * THE PROJECT-WIDE STATISTICS. The dark summary bar reads a completion
//     percentage and project, defined, closed and per-sprint point figures
//     (`app/partials/includes/components/summary.jade` L11-L24). THREE of those
//     names collide with members here, which is exactly why that shape is NOT
//     declared in this file: it is owned by `app/react/backlog/state/types.ts`.
//     A sprint's point members describe one sprint; the summary bar's describe
//     the whole project.
//
//   * THE MOVE REQUEST BODIES. The three milestone-move endpoints at `:44-57`
//     each post a project id, a milestone id and a bulk collection. Request
//     shapes belong to `app/react/shared/api/` under T5. Requirement I7 is why
//     the transport is not rebuilt at all: React keeps calling the existing
//     repository layer, so `$tgModel`'s changed-fields-only PATCH carrying its
//     optimistic-concurrency `version` (`model.coffee:48-54`, with the version
//     copied forward on `:49-50`) is inherited rather than re-derived. A
//     hand-rolled transport would start sending whole objects and turn
//     concurrent edits into silent lost updates.
//
//   * THE SPRINT FORM'S VALIDATION. The lightbox markup declares three
//     required fields -- the name at
//     `app/partials/includes/modules/lightbox-sprint-add-edit.jade` L13-L18
//     (with a maximum length on L19), the start date on L26-L30 and the finish
//     date on L35-L39, submitted from L46. The surrounding behaviour is a
//     2,000 ms submit debounce (`backlog/lightboxes.coffee:59`), a reset when
//     the form opens (`:164-165`) and locale-driven date parsing (`:62`).
//     ALL OF THAT IS BEHAVIOUR, owned by
//     `app/react/backlog/SprintFormLightbox.tsx`. That markup is cited here
//     ONLY as evidence of which fields the server requires. Required-ness,
//     defaults and validation are deliberately not encoded into this type
//     (T10).
//
//   * A type guard, a factory, a default value, a branded id, an enumeration, a
//     computed progress percentage, a date parser and a renamed field. All
//     forbidden by T10, and section 7 explains the mechanical reason as well.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 6. NO COLOUR REACHES THIS TYPE
//
// T2, verbatim: "All status, tag, and epic colours remain data-bound. They come
// from `s.color`, `tag[1]`, and `epic.color`; the values visible in the Figma
// frames are `sample_data` artefacts and must never be hardcoded."
//
// A sprint carries no colour of its own, so there is nothing here to bind and
// no hex literal appears in this file -- not a status swatch, not the sprint
// progress bar's fill, not the taskboard button's. Those two are stylesheet
// concerns: `app/styles/modules/backlog/sprints.scss` already styles both and
// requires zero edits, which is the point of T1. Drift Register entry D3
// records the same finding for the data-bound colours.
//
// No design tool was consulted for this file and none should be. AAP 0.6.2
// marks the shared type modules with no Figma annotation, and Drift entry D4
// records that neither frame captures the sprint form at all, so nothing about
// this shape could be inferred from a frame even in principle.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 7. WHY EVERY MEMBER IS `readonly`, AND WHY THERE IS NO EXECUTABLE STATEMENT
//
// P-IMMER-4: immer keeps `autoFreeze` ON, so structural sharing yields
// reference equality on untouched branches -- which is what lets `React.memo`
// genuinely replace the wrapper-based change detection the AngularJS screen
// relied on -- and a frozen value written to after `produce` throws at runtime.
// P-IMMER-3: mutate a draft inside a producer, never a value outside one, and
// never mix draft mutation with a returned value. Marking every member and the
// nested array `readonly` turns both rules from convention into a compile-time
// guarantee.
//
// This matters concretely rather than theoretically, because the AngularJS
// screen mutates a sprint in place in two of its handlers:
// `app/coffee/modules/backlog/main.coffee:870` replaces `user_stories` with a
// union, and `:873` increments the total point figure with `+=`. Both are
// exactly the pattern a `produce` reducer replaces, and `readonly` is what
// stops either being ported over literally.
//
// Requirement I5: the AngularJS-side collection dependency stays installed for
// its many out-of-scope consumers, and nothing in this folder imports it. No
// member below is a collection wrapper, and none exposes a `get`-style accessor
// or a `size` property.
//
// This module also contains zero executable statements by design -- only type
// declarations, one erased type import and comments. `jest.config.js` sweeps
// `app/react/**/*.{ts,tsx}` into `collectCoverageFrom` and negates only
// `*.test.*`, `*.d.ts` and the bundle entry point, so this plain `.ts` file IS
// measured against the global `lines: 70` gate (HR-9). With no statement to
// instrument it contributes zero lines and stays coverage-neutral -- verified
// empirically: the sibling type modules do not appear in the coverage report at
// all. That is also why no spec is co-located beside it. A statement that needs
// a home belongs where its spec can live -- `app/react/backlog/state/` -- not
// here.
//
// One last boundary marker, because it is the quickest way to tell which layer
// a value came from: the array declared here is measured with `length`
// (`app/partials/backlog/sprint.jade:13`), whereas a `size` read always means
// the value is still a collection wrapper belonging to the AngularJS side.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 8. LEDGER OF THE GOVERNING CONSTRAINTS
//
// No user-specified rules exist for this project: `review_rules` returns "No
// user rules provided.", which AAP 0.10 corroborates. The bar is NOT lowered --
// enterprise best practice applies, and the plan's own constraints stand in
// place of a rules document. Each one, and where this file honours it:
//
//   T1  class names preserved, so no member a class depends on is pruned:
//       `user_stories` drives `sprint-empty-wrapper` and `sprint-empty`
//       (`sprint.jade:13-14`), and the two point members drive the progress
//       bar's width (`:11`). See those three members.
//   T2  colours stay data-bound; this file declares none. Section 6.
//   T5  no endpoint, URL, header, envelope or request-body type here.
//       Section 5.
//   T8  new code isolated under `app/react/**`: this module adds one file and
//       edits nothing else, in this folder or outside it.
//   T9  the seam is documented at the point of change -- sections 1 and 2, and
//       the per-member notes on `user_stories`, the two date members, `closed`
//       and `version`.
//   T10 no computed member, no default, no validation, no date conversion and
//       no renamed field. Sections 3, 5 and 7.
//   I5  the AngularJS-side collection dependency is neither imported nor
//       modelled. Section 7.
//   I7  writes keep going through the existing repository layer, which is why
//       `version` is carried. Section 5 and the `version` member.
//   I9  the coverage gate forces a presentational/container split, so every
//       derivation lives in a hook or a state module and this layer stays a
//       pure description. Section 7.
//   HR-2 the dependency set is closed; this file adds no package and imports
//       one sibling type module.
// ---------------------------------------------------------------------------

/**
 * One sprint (a milestone on the wire) as it exists on the React side of the
 * seam: the flattened, plain attribute object the repository layer returned,
 * with its nested user stories flattened too, and with no wrapper, no accessor
 * and no derived member.
 *
 * Consumed by the Backlog screen's sprint sidebar, by every sprint card and by
 * the story rows nested inside one.
 */
export interface Sprint {
    /**
     * Stable identity, and the correlation key for every sprint-scoped
     * operation on the screen.
     *
     * It is the track-by key of both sidebar repeats
     * (`app/partials/includes/modules/sprints.jade:41` for open sprints and
     * `:54` for closed ones), the key of the per-sprint story ordering map
     * (`app/coffee/modules/backlog/main.coffee:318`, populated at `:320`), the
     * value a story's own milestone member is compared against when deciding
     * whether it already belongs here (`:485`), and what the drag handler reads
     * to tell whether a drop landed in the same sprint it started in
     * (`app/coffee/modules/backlog/sortable.coffee:149`, and again at `:163`
     * when it resolves the destination container).
     */
    readonly id: number;

    /**
     * Sprint name, exactly as the user typed it.
     *
     * Rendered into the taskboard link's title
     * (`app/partials/backlog/sprint.jade:56`) and into the sprint header
     * (`app/coffee/modules/backlog/sprints.coffee:188`).
     *
     * SECURITY: this is user-authored content, and it is typed as a plain
     * string precisely so it stays one. React escapes text children by default,
     * and that default is the required behaviour here -- AAP 0.8.2 forbids
     * React's raw-markup escape hatch anywhere under `app/react/**`, and this
     * member's name and type imply no markup.
     */
    readonly name: string;

    /**
     * URL-safe identifier, generated by the server from the name.
     *
     * Its only measured use is navigation: it is the `sprint=` segment of the
     * taskboard target (`sprint.jade:57`), which the sprint header resolves the
     * same way (`backlog/sprints.coffee:180`).
     *
     * The destination taskboard screen stays AngularJS and out of scope, so
     * this member exists to be handed straight back to the existing navigation
     * helper, never to be parsed or rebuilt.
     */
    readonly slug: string;

    /**
     * Whether the sprint has been closed.
     *
     * Four measured reads, and each one is visible behaviour rather than a
     * defensive check: the sidebar splits open from closed sprints on it
     * (`backlog/main.coffee:238`, and `:379` filters the open ones), the sprint
     * directive adds the `sprint-closed` class and skips the expand animation
     * when it is set (`backlog/sprints.coffee:113`), and the lightbox considers
     * only open sprints when it works out which sprint ended last
     * (`backlog/lightboxes.coffee:143`).
     *
     * NOT THE ENVELOPE'S `closed`. The list response carries a same-named
     * integer that counts the project's closed milestones
     * (`app/coffee/modules/resources/sprints.coffee:40`). That one is transport
     * and lives in `app/react/shared/api/`; this one is a boolean about a
     * single sprint. Section 5 explains the hazard in full.
     */
    readonly closed: boolean;

    /**
     * Points already completed in this sprint, or null when the server has
     * none to report.
     *
     * NULLABLE, and the null case is proven rather than assumed: the sprint
     * header substitutes zero for a falsy value before rendering
     * (`backlog/sprints.coffee:191`), which it would have no reason to do for a
     * member that is always numeric. Section 4 records that the plan cites that
     * fallback at an older line number.
     *
     * Together with the member below it drives the progress bar's width, which
     * the existing markup computes inline as a percentage of the total
     * (`sprint.jade:11`). The percentage is NOT computed here -- deriving it
     * would be a behaviour change of the kind T10 forbids, and it belongs to
     * the component that renders the bar.
     */
    readonly closed_points: number | null;

    /**
     * Total points assigned to this sprint, or null when the server has none to
     * report.
     *
     * NULLABLE for the same measured reason as the member above: the sprint
     * header substitutes zero for a falsy value at
     * `backlog/sprints.coffee:192`. It is the denominator of the progress-bar
     * expression at `sprint.jade:11`.
     *
     * The AngularJS screen increments this member in place when stories are
     * moved into the sprint (`backlog/main.coffee:873`). On the React side that
     * becomes a reducer producing a new value, which is what `readonly`
     * enforces -- see section 7.
     */
    readonly total_points: number | null;

    /**
     * Planned start date as a `"YYYY-MM-DD"` STRING, exactly as the REST layer
     * returns it.
     *
     * NOT PARSED HERE, and not converted to a date object. Three independent
     * measurements establish the wire format:
     *
     *   * the lightbox WRITES it in that format, formatting the picker's value
     *     on create (`backlog/lightboxes.coffee:80`) and on edit (`:87`);
     *   * the screen READS it back with that exact format string when it works
     *     out which sprint is current (`backlog/main.coffee:781`);
     *   * the sprint header reformats it for DISPLAY through a locale-driven
     *     format key (`backlog/sprints.coffee:182`), which only makes sense if
     *     the stored value is the format-neutral one.
     *
     * Typing it as a date object would invent a conversion the AngularJS screen
     * never performs, and T10 permits no behaviour change. Parsing and
     * formatting belong to the components and hooks that render or submit a
     * date; the format itself is recorded in this note rather than as a
     * constant, because section 7 requires this module to hold no executable
     * statement.
     */
    readonly estimated_start: string;

    /**
     * Planned finish date as a `"YYYY-MM-DD"` STRING, exactly as the REST layer
     * returns it. Same rules, and the same three kinds of evidence, as the
     * member above.
     *
     * Written in that format by the lightbox on create
     * (`backlog/lightboxes.coffee:81`) and on edit (`:88`); read back with the
     * explicit format string both when the lightbox sorts open sprints to find
     * the one that ended last (`:146`) and when the screen identifies the
     * current sprint (`backlog/main.coffee:782`); reformatted for display only
     * at `backlog/sprints.coffee:183`.
     *
     * NOT converted to a date object here, for the reason given above.
     */
    readonly estimated_finish: string;

    /**
     * The user stories assigned to this sprint, as a PLAIN ARRAY.
     *
     * This is the nested case section 2 documents. The resource facade replaces
     * whatever the payload carried with an array of `userstories` models
     * (`app/coffee/modules/resources/sprints.coffee:19-20` on the single read
     * and `:33-36` on the list read), and because `getAttrs` is shallow the
     * Backlog bridge has to flatten this level separately -- which it does, at
     * `app/coffee/modules/backlog/react-bridge.coffee:196-199`. By the time a
     * value reaches this type both levels are plain, so each entry is exactly
     * the sibling `UserStory` shape.
     *
     * IT IS AN ARRAY, NOT A COLLECTION WRAPPER, and the existing markup proves
     * it by measuring `length` three times over: the empty-state class is
     * toggled on it (`app/partials/backlog/sprint.jade:13`), the empty-state
     * block is gated on it (`:14`), and the rows repeat over it (`:18`). A
     * `size` read would mean the opposite. Keeping this member is a T1
     * requirement, not a convenience: those two class names are what
     * `app/styles/modules/backlog/sprints.scss` styles, and that stylesheet is
     * a pass-through asset with zero edits expected.
     *
     * The screen also sorts it by each story's sprint ordering
     * (`app/coffee/modules/backlog/main.coffee:338` and `:364`) and removes
     * entries from it when a story is dragged out (`:628`, `:633`) -- ordering
     * and mutation that belong to the reducer, which is why the array is
     * `readonly` here.
     */
    readonly user_stories: readonly UserStory[];

    /**
     * Optimistic-concurrency token, carried so it can be handed straight back.
     *
     * `getAttrs` copies it from the stored attributes into the modified set on
     * every call (`app/coffee/modules/base/model.coffee:49-50`, inside the
     * method spanning `:48-54`), which is what makes the repository layer's
     * changed-fields-only PATCH safe: the server receives the fields that
     * actually changed plus the version they were read at, and rejects the
     * write if the sprint moved on in between.
     *
     * Requirement I7 is why this member exists on a type that never writes
     * anything itself. React keeps calling the existing repository layer rather
     * than a new client, so this value has to survive the round trip through
     * React state intact. Dropping it would silently downgrade every sprint
     * edit into a last-writer-wins overwrite.
     */
    readonly version: number;
}
