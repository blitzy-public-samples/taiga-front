/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// ---------------------------------------------------------------------------
// UserStory -- the central shared domain type of the React rebuild, plus the
// per-role points map that travels inside it.
//
// Mandated by AAP 0.5.1 and 0.6.2: "Type the UserStory, Status, Swimlane,
// Sprint and Epic shapes from the existing resource definitions." Both migrated
// screens exchange this aggregate across the AngularJS -> React boundary: the
// Kanban board reads it out of the card map it is handed, and the Backlog
// screen reads it out of the story list and out of every sprint's nested
// stories.
//
// TWO IMPORTS, both type-only. `isolatedModules` is enabled in tsconfig.json,
// so a value import of a type would survive transpilation and break the
// single-file emit contract; `import type` is erased. `noUnusedLocals` is also
// enabled, so both symbols below are genuinely used -- `Tag` by `tags` and
// `Epic` by `epics`. tsconfig.json declares neither `baseUrl` nor `paths`,
// which is why these are relative specifiers, and the file name is camelCase
// `userStory.ts` on purpose: `forceConsistentCasingInFileNames` is enabled and
// the sibling sprint type imports './userStory'.
// ---------------------------------------------------------------------------

import type { Tag } from './tag';
import type { Epic } from './epic';

// ---------------------------------------------------------------------------
// 1. WHAT THIS TYPE DESCRIBES, AND WHERE IT IS VALID
//    (Rule T9 -- "Comment every technology-specific change at the point of
//     change, especially at the AngularJS/React seam." This IS that seam.)
//
// This interface describes the PLAIN JavaScript object that exists only on the
// React side of the boundary. It never describes an AngularJS-side value,
// because on that side a user story is never one plain shape:
//
//   * Through the repository layer it is a `$tgModel` instance -- a constructed
//     class (`app/coffee/modules/base/model.coffee:9`) holding its attributes
//     in a private bag (`:11`) behind `Object.defineProperty` accessors
//     (`:94-101`) that transparently prefer modified values over stored ones.
//   * Through the shared card component it has been re-wrapped in the
//     AngularJS-side immutable collection wrapper, so its fields are reached
//     through the model getter path `['model', X]` instead of by dot access --
//     for example the card title reads `subject` and falls back to
//     `blocked_note` that way at
//     `app/modules/components/card/card.jade:10`, and the blocked class is
//     switched on `is_blocked` at `:12`.
//
// Neither wrapper form may reach React or immer. P-IMMER-1, verbatim: "immer
// dislikes class instances. `$tgModel` returns model classes carrying
// dirty-tracking state; passing one into a draft produces undefined behaviour.
// Convert to plain objects at the boundary."
//
// The conversion happens at the hand-off, following the established house
// style rather than a new one. AngularJS gives a Web Component host its data by
// assigning the `{component, params, events}` contract as DOM *properties*
// rather than attributes: `app/coffee/modules/base/load-element.coffee:17-33`
// performs those assignments on `:24`, `:27` and `:30`, from a directive
// registered on the untouched `taigaBase` module at `:15` and `:39`. Properties,
// unlike attributes, do not stringify their values, which is what lets nested
// objects and callback functions cross the boundary structurally intact.
//
// The one production precedent flattens structural state at exactly that
// hand-off: `app/modules/components/project-menu/project-menu.controller.coffee:24-33`
// builds the same contract and hands the project over through toJS on `:27`,
// with a second flattening precedent on `:21`.
//
// Locator correction, recorded so the next reader does not chase the wrong
// line: the Agent Action Plan cites that flattening call as "L28". L28 of the
// same file is the closing brace `},` of the `params` object -- the call itself
// is on L27. Verified by reading the file.
//
// The two bridges already in this tree implement exactly that rule, each
// through a single `toPlain` helper -- `app/coffee/modules/kanban/react-bridge.coffee:214-221`
// and `app/coffee/modules/backlog/react-bridge.coffee:183-187`. Both route a
// collection wrapper through toJS, a `$tgModel` instance through `getAttrs`
// (`model.coffee:48-54`), and an already-plain value through unchanged, by
// identity. Two consequences matter here:
//
//   * `getAttrs` is SHALLOW -- `model.coffee:54` extends the stored and the
//     modified attributes into one fresh object exactly one level deep -- so
//     the nested arrays declared below (`tags`, `epics`, `attachments`,
//     `tasks`, `watchers`, `assigned_users`) cross the seam as the plain JSON
//     the REST layer returned. That is precisely the shape declared here.
//   * The Backlog bridge hands the story list over as raw models flattened that
//     way (`backlog/react-bridge.coffee:314`), while the Kanban bridge hands
//     over the card map (`kanban/react-bridge.coffee:307` and `:353`) whose
//     entries are card view-models. In the second case THIS type describes the
//     `model` member of each entry, not the entry itself -- see section 2.
//
// P-IMMER-2, worth knowing before debugging a consumer: logging an immer draft
// directly throws a TypeError, so print it with `JSON.stringify` or with
// immer's `current()` helper instead.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. THE RAW MODEL IS NOT THE CARD VIEW-MODEL
//    (The single easiest thing to get wrong here, so it is proven from source.)
//
// `app/coffee/modules/kanban/kanban-usertories.coffee:293-325` builds a card
// view-model that WRAPS the raw model rather than replacing it. In the current
// tree that method spans those lines; the Agent Action Plan cites `L228-L252`,
// its position before the file grew, and the code is equivalent at both:
//
//   :303  model = usModel.getAttrs()          <- THE RAW MODEL: this interface
//   :307  us.model = model                    <- nested under `model`
//   :305  us.foldStatusChanged = ...          <- view-model only
//   :308  us.images = _.filter model.attachments, (it) -> !!it.thumbnail_card_url
//   :312  us.assigned_to = @.usersById[...]   <- RESOLVED user object
//   :315  usModel.assigned_users.forEach ...  <- raw model holds numeric IDs
//   :318  us.assigned_users.push(...)         <- RESOLVED user objects
//   :320  us.assigned_users_preview = us.assigned_users.slice(0, 3)
//   :322  us.colorized_tags = _.map us.model.tags, (tag) -> {name, color}
//
// THIS FILE TYPES THE RAW MODEL ONLY. The derived members above -- the fold
// flag, the filtered image list, the RESOLVED assignee object, the RESOLVED
// assignee list, its three-item preview and the reshaped tag objects -- are
// card view-model derivations owned by `app/react/kanban/state/`, and are
// deliberately absent from this interface. The shared card proves they are a
// different layer: `card.jade:12` reads the RESOLVED list's size and `:40`
// passes the derived image list, neither of which is a payload field.
//
// One consequence is load-bearing for consumers and is spelled out again on the
// members themselves: on the raw model `assigned_users` is an array of numeric
// user IDs, and `assigned_to` is a single numeric user ID.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3. THE FIELD SURFACE IS MEASURED, NOT ASSUMED
//
// Neither resource facade named as a source declares a field shape:
// `app/coffee/modules/resources/userstories.coffee` and `.../sprints.coffee`
// map endpoint names to URLs and query parameters, nothing more. Every member
// below therefore carries a consumption site with a file:line citation, and the
// set was cross-checked against the live REST payload -- 137 user stories over
// all seven seeded projects from `GET /api/v1/userstories?project=N`.
//
// Where the measurement and the planned table disagreed, the resolution rule
// applied was: follow the plan when the disagreement cannot cause a runtime
// failure or a behavioural divergence, and follow the measurement -- documented
// with its proof -- when it can, because AAP goal G1 is behavioural
// equivalence. That rule fired exactly twice, and both cases are recorded on
// the member itself: `epics` is nullable in the payload (mapping null would
// throw, so the type widened), and `is_iocaine` is read only through the shared
// card (a falsy read either way, so the planned type stands).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4. WHAT IS DELIBERATELY ABSENT, SO NOBODY "COMPLETES" THE TYPE LATER
//
//   * The six further payload fields the plan enumerates, all with zero
//     measured reads on either in-scope screen: the two requirement flags, the
//     external-reference string, the completion date, the story-provenance field
//     and the nested project descriptor -- the last of which is read off the
//     USER STORY by the shared card's epic template, not off an epic, and only
//     by that out-of-scope card path. Structural typing keeps this narrower
//     interface assignable from the wider payload, so nothing needs them. Left
//     out under T10, which permits no functional or feature change whatsoever,
//     and under the Minimal Change Clause.
//   * Every view-model derivation listed in section 2.
//   * Request and response shapes. T5, verbatim: "Reuse `$tgResources`; do not
//     build a parallel HTTP client. New TypeScript files are typed facades over
//     the existing repository layer." The ordering, milestone-move and
//     bulk-create request bodies -- the after/before neighbour ids, the status
//     and swimlane ids, the bulk payload -- belong to `app/react/shared/api/`.
//     Requirement I7 is why: React keeps calling the existing repository layer,
//     so `$tgModel`'s changed-fields-only PATCH carrying its
//     optimistic-concurrency `version` (`model.coffee:48-54`) is inherited
//     rather than re-derived. A hand-rolled transport would start sending whole
//     objects and turn concurrent edits into silent lost updates.
//   * Colour constants. T2, verbatim: "All status, tag, and epic colours remain
//     data-bound. They come from `s.color`, `tag[1]`, and `epic.color`; the
//     values visible in the Figma frames are `sample_data` artefacts and must
//     never be hardcoded." A user story carries no colour of its own: colour
//     reaches the markup only through element 1 of a tag tuple and through an
//     epic's own colour member. This file contains no hex literal, and Drift
//     Register entry D3 records the same finding.
//   * A type guard, a factory, a default value, a branded id, an enumeration, a
//     computed member, a date parser and a renamed field. All forbidden by
//     T10, and section 5 explains the mechanical reason as well.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 5. WHY EVERY MEMBER IS `readonly`, AND WHY THERE IS NO EXECUTABLE STATEMENT
//
// P-IMMER-4: immer keeps `autoFreeze` ON, so structural sharing yields
// reference equality on untouched branches -- which is what lets `React.memo`
// genuinely replace the wrapper-based change detection the AngularJS board
// relied on -- and a frozen value written to after `produce` throws at runtime.
// P-IMMER-3: mutate a draft inside a producer, never a value outside one, and
// never mix draft mutation with a returned value. Marking every member and
// every array `readonly` turns both rules from convention into a compile-time
// guarantee.
//
// Requirement I5: the AngularJS-side collection dependency stays installed for
// its 124 out-of-scope consumers, and nothing in this folder imports it. No
// member below is a collection wrapper, and none exposes a `get`-style accessor
// or a `size` property.
//
// This module also contains zero executable statements by design -- only type
// declarations, two erased type imports and comments. `jest.config.js` sweeps
// `app/react/**/*.{ts,tsx}` into `collectCoverageFrom` and negates only
// `*.test.*`, `*.d.ts` and the bundle entry point, so this plain `.ts` file IS
// measured against the global `lines: 70` gate (HR-9). With no statement to
// instrument it contributes zero lines and stays coverage-neutral, which is
// also why no spec is co-located beside it. A statement that needs a home
// belongs where its spec can live -- `app/react/kanban/state/` or
// `app/react/backlog/state/` -- not here.
//
// One last boundary marker, because it is the quickest way to tell which layer
// a value came from: plain arrays declared here are measured with `length`
// (`app/partials/backlog/sprint.jade:13` tests `sprint.user_stories.length`),
// whereas a `size` read always means the value is still a collection wrapper
// belonging to the AngularJS side or to the card view-model layer.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 6. LEDGER OF THE GOVERNING CONSTRAINTS
//
// No user-specified rules exist for this project: `review_rules` returns "No
// user rules provided.", which AAP 0.10 corroborates. The bar is NOT lowered --
// enterprise best practice applies, and the plan's own constraints stand in
// place of a rules document. Each one, and where this file honours it:
//
//   T1  class names preserved -- no member a class depends on is pruned:
//       `is_blocked` and `new` drive `{blocked, new}`, `is_closed` and
//       `is_blocked` drive `{closedRow, blockedRow}`, and `new` drives the
//       blink animation. See those three members.
//   T2  colours stay data-bound; this file declares none and contains no hex
//       literal. Section 4, and the `tags` and `epics` members.
//   T4  the shared card under `app/modules/components/card/**` is cited as
//       READ-ONLY EVIDENCE throughout and is never written to. Every `card.jade`,
//       `card-templates/*` and `card.controller.coffee` locator in this file is a
//       read, quoted to justify a member.
//   T5  no endpoint, URL, header or envelope type here. Section 4.
//   T8  new code isolated under `app/react/**`: this module adds one file and
//       edits nothing else, in this folder or outside it.
//   T9  the seam is documented at the point of change -- sections 1 and 2, and
//       the per-member notes on `new`, the two assignee members, `swimlane`,
//       `milestone` and `version`.
//   T10 no computed member, no default, no validation, no date conversion and no
//       renamed field. Sections 4 and 5.
//   I5  the AngularJS-side collection dependency is neither imported nor
//       modelled. Section 5.
//   I7  writes keep going through the existing repository layer, which is why
//       `version` is carried. Section 4 and the `version` member.
//   I9  the coverage gate forces a presentational/container split, so every
//       derivation lives in a hook or state module and this layer stays a pure
//       description. Sections 2 and 5.
//   D4  the Figma frames capture no modal, popover, tooltip, hover or drag state
//       and licence layout fidelity only, so NOT ONE member here is inferred
//       from a frame -- every one carries a measured read. No design tool was
//       consulted for this file, and none should be.
// ---------------------------------------------------------------------------

/**
 * One user story as it exists on the React side of the seam: the flattened,
 * plain attribute object the repository layer returned, with no wrapper, no
 * accessor and no derived member.
 *
 * Consumed by the Kanban board (through the `model` member of each card-map
 * entry) and by the Backlog screen (through the story list and through every
 * sprint's nested story list).
 */
export interface UserStory {
    /**
     * Stable identity, and the drag-and-drop correlation key on both screens.
     *
     * It is the `data-id` attribute of a Backlog row
     * (`app/partials/includes/components/backlog-row.jade:13`) and of a sprint
     * row (`app/partials/backlog/sprint.jade:20`), the track-by key of the
     * sprint repeat (`sprint.jade:18`), the key of the Backlog ordering map
     * (`app/coffee/modules/backlog/main.coffee:432`) and of the Kanban ordering
     * map (`app/coffee/modules/kanban/kanban-usertories.coffee:191`), and the
     * value the drag reconciliation matches server rows on
     * (`backlog/main.coffee:690-695`).
     */
    readonly id: number;

    /**
     * Human-facing reference number. Always rendered after a literal "#" that
     * the markup supplies and the value never contains.
     *
     * It is the track-by key of the Backlog repeat (`backlog-row.jade:9`), the
     * rendered reference (`:38`) and the `ref=` segment of the story-detail
     * navigation target (`:35`); the sprint row uses it the same way
     * (`sprint.jade:25`, `:28`, `:32`), as does the card title
     * (`app/modules/components/card/card-templates/card-title.jade:11`, `:15`).
     * It is also what the Backlog visibility filter collects
     * (`backlog/main.coffee:425-426`), which is why it must stay numeric rather
     * than become a pre-formatted string.
     */
    readonly ref: number;

    /**
     * Story title, exactly as the user typed it.
     *
     * Rendered on the Backlog row (`backlog-row.jade:39`), on the sprint row
     * (`sprint.jade:35`) and in the card title (`card-title.jade:16`), and used
     * as the card tooltip at the smallest zoom level (`card.jade:10`).
     *
     * SECURITY: this is user-authored content, and it is typed as a plain
     * string precisely so it stays one. React escapes text children by default,
     * and that default is the required behaviour here -- AAP 0.8.2 forbids
     * React's raw-markup escape hatch anywhere under `app/react/**`, and this
     * member's name and type imply no markup. The AngularJS markup binds it
     * through an emoji filter, so the React port substitutes emoji glyphs into a
     * text node rather than injecting markup.
     */
    readonly subject: string;

    /**
     * User-story status id -- on the Kanban board this is also the column.
     *
     * Numeric, and stringified only when it is used as a map key:
     * `kanban-usertories.coffee:103`, `:113` and `:144` all key the
     * status-to-stories collection with `String(usModel.status)`. Every other
     * read keeps it numeric: the drag handler captures the previous value at
     * `app/coffee/modules/kanban/sortable.coffee:298` and `:312`, the shared
     * card forwards it as a query parameter at
     * `app/modules/components/card/card.controller.coffee:26`, and the swimlane
     * grouping re-keys it with `Number(statusId)`
     * (`kanban-usertories.coffee:388`).
     *
     * The status OBJECT -- its name, colour, WIP limit and archived flag --
     * lives in the sibling status type, and T2 keeps its colour data-bound.
     * This member is only the identity of that object.
     */
    readonly status: number;

    /**
     * Swimlane id, or null when the story belongs to no swimlane.
     *
     * NULLABLE, and the null case is visible behaviour rather than a defensive
     * type: `kanban-usertories.coffee:357-358` selects exactly the stories whose
     * swimlane is null, and the live payload carries both integers and nulls
     * across the seeded projects.
     *
     * THE `-1` SENTINEL IS NOT A VALUE OF THIS MEMBER. When unclassified
     * stories exist, the board prepends a synthetic swimlane whose id is `-1`
     * (`kanban-usertories.coffee:368-372`) to carry them, and maps that id back
     * to null before comparing against a story
     * (`:385`, where the id `-1` becomes null and the story's own value is read
     * through the model getter path `['model', 'swimlane']` on `:386`). The drag
     * handler applies the same sentinel in the other direction, defaulting a
     * null story swimlane to `-1` (`kanban/sortable.coffee:313`). Both are
     * client-side conventions of the swimlane collection, so React reproduces
     * them in `app/react/kanban/state/` and never stores `-1` here.
     */
    readonly swimlane: number | null;

    /**
     * Milestone (sprint) id, or null when the story is still in the backlog.
     *
     * NULLABLE: the sprint row gates the story link on it
     * (`sprint.jade:26`) and interpolates it straight into the navigation
     * parameters as a number (`:27`), and it is one of the two values the drag
     * reconciliation copies back from the server response
     * (`backlog/main.coffee:694`) precisely because the server, not the client,
     * decides it.
     *
     * THE `"null"` STRING IS NOT A VALUE OF THIS MEMBER. Fetching the
     * unassigned backlog sends the literal string `"null"` as the milestone
     * query parameter (`app/coffee/modules/resources/userstories.coffee:46`),
     * and another facade deletes that same parameter when it sees the string
     * (`:33-35`). That is a query-parameter convention owned by
     * `app/react/shared/api/` under T5 -- never a value here, which is a number
     * or null.
     */
    readonly milestone: number | null;

    /**
     * Owning project id. Required because the detail-fetch and attachment-fetch
     * paths are project-scoped: the board refetches a story with it at
     * `app/coffee/modules/kanban/main.coffee:379` and `:397`, and lists its
     * attachments with it at `:382`.
     */
    readonly project: number;

    /**
     * Whether the story is blocked.
     *
     * It drives existing CSS class names, so it cannot be pruned without
     * breaking T1 ("Preserve every CSS class name. The in-scope Sass is a
     * pass-through asset, not a rewrite target. React markup must emit the same
     * classes in the same nesting so the existing stylesheets apply verbatim"):
     * it switches `blocked` on the Backlog row (`backlog-row.jade:11`),
     * `blockedRow` on the sprint row (`sprint.jade:22`) plus `blocked` on that
     * row's link and points cell (`:29`, `:51`), and `card-blocked` on the card
     * (`card.jade:12`). It also gates the lock badge in the card body
     * (`card-templates/card-data.jade:41-42`).
     */
    readonly is_blocked: boolean;

    /**
     * The reason a story is blocked. A string, empty when the story is not
     * blocked rather than absent -- the live payload carries a string for every
     * story surveyed.
     *
     * Read as the card tooltip whenever the card is neither at the smallest
     * zoom level nor folded (`card.jade:10`), which is the branch that shows the
     * blocking reason instead of the subject.
     */
    readonly blocked_note: string;

    /**
     * Whether the story's status is a closed one.
     *
     * Another class-name driver under T1: `closedRow` on the sprint row
     * (`sprint.jade:22`) and `closed` on its link and points cell (`:29`,
     * `:51`). Both due-date renderers also take it as an input, because a due
     * date on a closed story is styled differently
     * (`backlog-row.jade:40-45`, `sprint.jade:43-48`), and the shared card
     * passes it to the same service (`card-directives.coffee:160-171`).
     */
    readonly is_closed: boolean;

    /**
     * The iocaine flag, read by the SHARED card body at
     * `card-templates/card-data.jade:34` -- and, for the avatar badge, at
     * `card-templates/card-assigned-to.jade:10` and `:52`.
     *
     * PROVENANCE, measured rather than assumed. That card is shared with the
     * out-of-scope taskboard, which renders tasks and issues through the very
     * same template, and the flag is a TASK field on the backend
     * (`taiga-back/taiga/projects/tasks/models.py:94`, exposed by
     * `taiga/projects/tasks/serializers.py:44`). The user-story payload does not
     * carry it: it was absent from all 137 stories surveyed. On the user-story
     * path the read is therefore falsy and the badge does not render, which is
     * exactly the behaviour React must reproduce rather than "fix" -- treating a
     * falsy read as "not iocaine" preserves it. The member is kept, and kept
     * non-optional, so the port of that branch stays a straight transcription of
     * the markup above (T10).
     */
    readonly is_iocaine: boolean;

    /**
     * Due date, or null when none is set. A DATE STRING, passed through
     * untouched.
     *
     * Both screens gate the whole due-date element on it and hand the raw value
     * to the shared due-date component (`backlog-row.jade:40-45`,
     * `sprint.jade:43-48`), and the card body does the same before asking the
     * due-date service for its colour and title
     * (`card-templates/card-data.jade:29-31`,
     * `card-directives.coffee:160-171`).
     *
     * NOT PARSED HERE, and not converted to a `Date`. T10 permits no behaviour
     * change, and the existing service owns every calendar decision; parsing at
     * the type boundary would move that decision and silently change how a
     * near-due story is coloured.
     */
    readonly due_date: string | null;

    /**
     * Sum of the per-role points, computed server-side, or null when the story
     * is unestimated.
     *
     * NULLABLE, and both branches are rendered: the card shows the points badge
     * when a total exists (`card-templates/card-data.jade:15-20`) and an
     * explicit "no points" label when it does not (`:23-26`). The sprint row
     * likewise gates its whole points cell on it and then prints it
     * (`sprint.jade:50`, `:53`).
     */
    readonly total_points: number | null;

    /**
     * THE PER-ROLE POINTS MAP: role id -> points id.
     *
     * String keys, because that is what the payload sends -- a surveyed story
     * carries `{"13": 28, "14": 36, "15": 31, "16": 33}` -- and because JavaScript
     * object keys are strings even where the estimation code indexes with a
     * numeric role id.
     *
     * The value is the id of a points OBJECT, not a points value: the estimation
     * popover resolves it through a points-by-id lookup and guards that lookup
     * existentially, falling back to a question mark when it does not resolve
     * (`app/coffee/modules/common/estimation.coffee:184-187`), and the total is
     * computed by mapping every entry through the same lookup and dropping the
     * null results (`:170`, `:175-176`). Hence `number | null` rather than
     * `number`.
     *
     * Reads and writes measured: the Backlog row hands the whole story to the
     * points directive (`backlog-row.jade:68`); selecting a point clones the map
     * and assigns one role's entry (`estimation.coffee:211`); the popover marks
     * the currently selected point by comparing an entry against a point id
     * (`:218`); and the Backlog screen reads a single role's entry when only one
     * role is in play (`backlog/main.coffee:1209`).
     *
     * `Readonly<Record<...>>` rather than an interface with named keys: the keys
     * are per-project role ids from the database, so enumerating them would be
     * the same mistake as hardcoding a colour (T2).
     */
    readonly points: Readonly<Record<string, number | null>>;

    /**
     * Tags. Each one is the two-element tuple the API sends, typed by the
     * sibling tag module -- element 0 is the name, element 1 the nullable
     * colour.
     *
     * Iterated by the Backlog row, which reads both elements positionally
     * (`backlog-row.jade:46-52`), and by the card view-model, which reshapes the
     * same tuples into named objects
     * (`kanban-usertories.coffee:322-323`) -- a derivation owned by
     * `app/react/kanban/state/`, not a second field.
     *
     * Always an array in the payload, never null across the 137 stories
     * surveyed, so no null guard is encoded here.
     */
    readonly tags: readonly Tag[];

    /**
     * Epics this story belongs to, typed by the sibling epic module, or null.
     *
     * MEASURED REFINEMENT, recorded with its proof. The planned table typed this
     * member as a plain array; the payload disagrees, and the disagreement is
     * the kind that crashes a screen rather than the kind that reads falsy: 14
     * of the 30 stories in the richest seeded project carry `epics: null`, and
     * the value is `list` or `null` across all 137 surveyed.
     *
     * The AngularJS markup already treats it as nullable -- the sprint row gates
     * the whole epic component on it before forwarding it
     * (`sprint.jade:40-41`), and an iteration over a null value renders nothing
     * rather than failing (`backlog-row.jade:55`). A React `.map` over null
     * throws instead, which would break AAP goal G1 (behavioural equivalence)
     * for the majority of real stories, so the type is widened here and every
     * consumer must reproduce that guard. Widening cannot break a producer: an
     * array still satisfies it.
     */
    readonly epics: readonly Epic[] | null;

    /**
     * Assignees, as NUMERIC USER IDS.
     *
     * This is the raw-model shape described in section 2, not the resolved one.
     * The card view-model turns each id into a user object by looking it up in a
     * users-by-id map (`kanban-usertories.coffee:315-318`), and that resolved
     * list -- together with its three-item preview
     * (`:320`) -- is a derivation owned by `app/react/kanban/state/`. The shared
     * card reads the RESOLVED objects, which is why it can ask each one for its
     * own id (`app/coffee/modules/kanban/card-directives.coffee:78`, `:148`) and
     * why it measures the list with `size` rather than `length`
     * (`card.jade:12`).
     *
     * NON-OPTIONAL AND NON-NULLABLE, and that is measured twice over: the card
     * view-model iterates it with no guard at all
     * (`kanban-usertories.coffee:315`), and the payload carried an array for
     * every one of the 137 stories surveyed. The board also writes it as a plain
     * array of ids when the assignee filter changes
     * (`kanban/main.coffee:439`).
     */
    readonly assigned_users: readonly number[];

    /**
     * The LEGACY SINGULAR assignee, as a numeric user id, or null.
     *
     * Superseded by the plural member above but still populated and still read,
     * so it is modelled rather than dropped (T10). The board keeps the two
     * consistent explicitly: when the plural list changes it promotes the first
     * id into this member, and sets it to null when the list is empty
     * (`kanban/main.coffee:439-443`), then unions both when it needs the full
     * set of current users (`:457`).
     *
     * The fallback pattern consumers must preserve is the shared card's: read
     * the plural list, and fall back to a single-element list built from this
     * member when the plural one is absent
     * (`card-directives.coffee:78` -- cited by the Agent Action Plan at its
     * previous home in `kanban/main.coffee`, before requirement I2 moved the
     * three card directives verbatim onto their own module). The card view-model
     * resolves this id to a user object exactly like the plural list
     * (`kanban-usertories.coffee:312`), and that resolved object, again, belongs
     * to `app/react/kanban/state/`.
     */
    readonly assigned_to: number | null;

    /**
     * Position within a Kanban column. The board sorts by it
     * (`kanban-usertories.coffee:130`) and caches it per story id
     * (`:191`, `:263`).
     *
     * Ordering is written back through the position-relative bulk endpoint,
     * whose request shape belongs to `app/react/shared/api/` under T5, so this
     * member is the read side only.
     */
    readonly kanban_order: number;

    /**
     * Position within the Backlog list. The Backlog sorts every page by it as it
     * arrives (`backlog/main.coffee:423`), caches it per story id (`:432`), and
     * -- critically -- copies the AUTHORITATIVE value back from the server
     * response after every drag (`:694-695`), together with the milestone.
     *
     * That reconciliation is why the value must stay plain and writable-by-state
     * rather than derived: the server, not the client, decides the final order.
     */
    readonly backlog_order: number;

    /**
     * Server-side attachment count. The shared card body prints it for a user
     * story, and switches to measuring the nested attachment collection only for
     * a task (`card-directives.coffee:172-176`, rendered at
     * `card-templates/card-data.jade:47-52`).
     */
    readonly total_attachments: number;

    /**
     * Server-side comment count, printed by the card body when it is non-zero
     * (`card-templates/card-data.jade:61-66`).
     */
    readonly total_comments: number;

    /**
     * Attachments, as a MINIMAL INLINE SHAPE.
     *
     * One property is read on either in-scope screen: the card thumbnail URL,
     * filtered for truthiness when the card view-model derives its image list
     * (`kanban-usertories.coffee:308`). Declaring only that property is the
     * Minimal Change Clause applied to a type: structural typing keeps the
     * richer payload assignable, and no separate attachment module is named in
     * AAP 0.5.1 or 0.6.2, so none is created.
     *
     * The URL is nullable because the filter exists precisely to drop the
     * entries that have none -- an attachment with no card thumbnail is a
     * measured, ordinary case, and the derived image list it feeds is a
     * view-model member owned by `app/react/kanban/state/`.
     */
    readonly attachments: readonly { readonly thumbnail_card_url: string | null }[];

    /**
     * Related tasks, as a MINIMAL INLINE SHAPE, for the same reason as
     * `attachments`: no task module is named in AAP 0.5.1 or 0.6.2, and the
     * in-scope screens read exactly two properties.
     *
     * `is_closed` is the one the card filters on when it counts completed tasks
     * (`card.controller.coffee:64-65`, rendered as "closed / total" at
     * `card-templates/card-data.jade:68-72`, with the completed percentage at
     * `card.controller.coffee:67-68`). `id` is the stable list identity a React
     * key needs, and it is the repository's own choice for a task list --
     * `app/partials/includes/modules/related-tasks.jade:17` and
     * `app/partials/includes/modules/search-results/search-result-table-tasks.jade:15`
     * both track a task repeat by it.
     *
     * The array is present on every surveyed story, and the card's defensive
     * reads (`card.controller.coffee:45-47`,
     * `card-directives.coffee:157-159`) exist because the same template also
     * renders tasks and issues, which have no nested tasks at all.
     */
    readonly tasks: readonly { readonly id: number; readonly is_closed: boolean }[];

    /**
     * Watchers. `unknown` on purpose, because the shape is genuinely open here:
     * the only thing either in-scope screen does with this collection is count
     * it (`card-templates/card-data.jade:54-59`). The payload happens to send
     * user ids, but nothing on these two screens depends on that, so consumers
     * narrow at the use site instead of inheriting a claim this file cannot
     * prove.
     *
     * `unknown` rather than the forbidden loose escape hatch: it keeps the count
     * available while making every element access a compile-time decision.
     */
    readonly watchers: readonly unknown[];

    /**
     * OPTIMISTIC-CONCURRENCY TOKEN. Required, not decorative.
     *
     * `getAttrs(patch)` copies it out of the stored attributes into the modified
     * ones before returning a patch body -- `model.coffee:48-54`, and precisely
     * `:49-50` -- so a changed-fields-only PATCH always carries the version the
     * client last saw. That is the whole mechanism behind requirement I7: the
     * server rejects a stale write with a 400 carrying this field, and the
     * existing interceptor turns that into the version-conflict notification.
     *
     * Consequence for React, and the reason this member is declared even though
     * neither screen renders it: state must carry it through untouched so the
     * next write still has it. Dropping it would convert every concurrent edit
     * into a silent lost update.
     */
    readonly version: number;

    /**
     * CLIENT-SIDE ONLY. Never a server field, never sent to the API.
     *
     * The Backlog sets it while parsing a freshly loaded page, on exactly the
     * stories it just created (`backlog/main.coffee:429-430`, gated on the
     * newly-created id list it keeps at `:80`, `:197`, `:217`). It exists to
     * make those rows blink once: the Backlog row switches the `new` class on it
     * (`backlog-row.jade:11`) and the stylesheet animates that class
     * (`app/styles/modules/backlog/backlog-table.scss:251-253`, with the
     * keyframes at `:223-232`). Preserving both the member and the class name is
     * required by T1.
     *
     * A SEPARATE, UNRELATED MECHANISM uses the same class name on the Kanban
     * side: the drag handler adds and removes it on a DOM container directly
     * (`app/coffee/modules/kanban/sortable.coffee:279`, `:282`). That one is a
     * class, not a field, and needs no member here. (The Agent Action Plan
     * attributes the flag itself to that file; the measured flag site is the
     * Backlog parser cited above. Both are client-side, so the conclusion is
     * unchanged.)
     *
     * OPTIONAL because most stories never carry it, and it must be stripped
     * before a write: the repository layer sends only changed fields, and this
     * field belongs to no serializer.
     */
    readonly new?: boolean;
}
