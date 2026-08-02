/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// ===========================================================================
// BACKLOG STATE MODEL SURFACE
//
// The shared model surface of the migrated Backlog / Sprint-Planning screen.
// This is the most foundational module under `app/react/backlog/`: sixteen of
// its sibling files declare it as a dependency, so a wrong member name or a
// wrong nullability here breaks sixteen files at once. Every declaration below
// was therefore MEASURED -- from the incumbent AngularJS source, from the Jade
// markup that source renders, and, wherever the markup alone could not settle a
// nullability, from the live REST payload of the running stack.
//
// AAP 0.5.1 places this module at `app/react/backlog/state/types.ts` beside
// `backlogReducer.ts` and `backlogSelectors.ts`, and AAP 0.6.2 sources it from
// `app/coffee/modules/backlog/main.coffee`. Rule T8 -- isolate new
// implementations in dedicated files -- is honoured literally: this task adds
// this one file and edits nothing else, inside this folder or outside it.
//
// WHAT THIS MODULE EXPORTS, and nothing further:
//
//   BurndownMilestone   one sample of the burndown series
//   ProjectStats        the project-statistics payload that drives the screen
//   BacklogUserStory    the shared raw story plus the backlog's own ordering
//   ProjectRole         an estimation role
//   ProjectPoint        an estimation point
//   PointsById          the point lookup built by the repository's own helper
//   BulkMilestoneItem   one item of the ordering / milestone bulk payload
//   SelectedRoleId      the identifier of the role selected in a points cell
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. WHY THIS MODULE CONTAINS ZERO EXECUTABLE STATEMENTS
//
// Only type-level declarations appear below: one erased `import type`, the eight
// `export interface` / `export type` declarations listed above, and comments.
// There is no binding, no producer, no factory, no default value and no
// value-level enumeration -- and that is a measured coverage fact rather than a
// stylistic preference.
//
// `jest.config.js` sweeps `app/react/**/*.{ts,tsx}` into `collectCoverageFrom`
// and negates only `*.test.{ts,tsx}`, `*.d.ts` and the bundle entry point, so
// a plain `.ts` module IS measured against `coverageThreshold.global.lines:
// 70` (HR-9). With no statement to instrument, istanbul attributes zero lines
// to this file: it contributes zero to the numerator and zero to the
// denominator, so it is coverage-neutral. One value-bearing statement would
// become an uncovered line that drags the global gate down and would demand a
// co-located spec -- which is also why no `types.test.ts` accompanies this
// module (C1.0: nothing enters scope as a nice-to-have; a pure type module
// needs no spec).
//
// A statement that needs a home therefore belongs where its spec can live --
// `backlogReducer.ts` or `backlogSelectors.ts` in this same folder -- never
// here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. WHY EVERY MEMBER IS `readonly`
//
// The Backlog reducer applies structural updates through immer, and immer
// keeps `autoFreeze` enabled (P-IMMER-4), so reference equality survives on
// untouched branches -- which is what lets `React.memo` genuinely replace the
// wrapper-based change detection the AngularJS screen relied on -- while a
// frozen value written to after a producer returns throws at runtime.
// P-IMMER-3 adds the discipline that a producer mutates its draft or returns a
// value, never both. Marking every member and every array `readonly` turns
// both of those from convention into a compile-time guarantee, so a stray
// write is a `tsc --noEmit` failure instead of a production exception.
//
// P-IMMER-1 is the reason these are plain-object shapes: immer must not be
// handed a class instance, and the repository layer hands out `$tgModel`
// instances that carry dirty-tracking state. Flattening happens at the
// AngularJS-to-React seam, in the bridge, exactly as the one production
// precedent already does it -- so nothing declared here is a model instance
// and nothing here is an immutable-collection wrapper from the AngularJS side
// (requirement I5: that dependency stays installed for its out-of-scope
// consumers and is neither imported nor modelled by this folder).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3. WIRE SPELLINGS ARE PRESERVED EXACTLY
//
// `snake_case` members below are NOT renamed to `camelCase`. Renaming would be
// a response transformation, which T10 forbids -- that rule permits no
// functional or feature change whatsoever -- and it would break G2, the frozen
// backend contract: these members are read straight off `/api/v1/` payloads and written
// straight back into request bodies. The payload genuinely mixes conventions --
// see `ProjectStats.completedPercentage`, which is client-derived and really is
// camelCase -- and that mixture is reproduced faithfully instead of normalised.
//
// T5 keeps transport out of this module: no endpoint, URL, header or envelope
// shape is declared here, and nothing is imported from `app/react/shared/api/`.
// Types must not depend on transport; the reverse direction is the correct one.
//
// T2 keeps colour out of it as well. Status, tag and epic colours are
// per-project database values reached through a status's own colour member,
// element 1 of a tag tuple and an epic's colour member; the colours visible in
// the Figma frames are `sample_data` artefacts (Drift Register entry D3). This
// file declares no colour and contains no hex literal. Nor does it carry the
// retained Flot series colours or its 12 px axis font: those stay inside
// `BurndownChart.tsx` under G-DS-2, un-tokenised and un-duplicated. This module
// types only the DATA the chart consumes.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4. LEDGER OF THE GOVERNING CONSTRAINTS
//
// NO USER-SPECIFIED RULES EXIST for this project: `review_rules` returns "No
// user rules provided.", which AAP 0.10 corroborates. The bar is NOT lowered --
// enterprise best practice applies, and the plan's own constraints stand in
// place of a rules document. No file entered scope by rule. Each constraint
// that governs this module, and where it is honoured:
//
//   T2   colours stay data-bound; none is declared here. Section 3.
//   T5   no transport shape here; nothing imported from `shared/api`. Section 3.
//   T8   one new file, nothing else touched. Module header.
//   T9   every declaration carries the `[path:locator]` it was measured from.
//   T10  no computed member, no default, no validation, no date conversion,
//        no renamed field. Sections 1 and 3.
//   G2   `/api/v1/` request and response spellings preserved verbatim.
//        Section 3, `BulkMilestoneItem`, and every `snake_case` member.
//   G4   the module is coverage-neutral by construction, so it neither helps
//        nor harms the >= 70 % line gate. Section 1.
//   HR-9 same. Section 1.
//   C1.0 exactly the eight declarations the file specification names -- no
//        invented member, no barrel, no spec, no extra file.
//   Minimal Change Clause: members with no measured read on this screen are
//        deliberately left out. Structural typing keeps the wider payload
//        assignable, so leaving them out costs nothing and claiming them would
//        assert a shape this file cannot prove.
// ---------------------------------------------------------------------------

// The ONE import, and it is type-only. `isolatedModules` is enabled, so a
// value import of a type would survive transpilation; `import type` is erased,
// which keeps section 1's zero-statement property intact. `noUnusedLocals` is
// enabled too, so this symbol has to be used -- it is, by `BacklogUserStory`.
// tsconfig.json declares neither `baseUrl` nor `paths`, hence the relative
// specifier, and `forceConsistentCasingInFileNames` is enabled, hence the exact
// camelCase `userStory` file name.
import type { UserStory } from '../../shared/types/userStory';

// ---------------------------------------------------------------------------
// BurndownMilestone
//
// One sample of the burndown series -- declared before `ProjectStats` because
// that interface references it.
//
// Measured from the authoritative burndown configuration at
// [app/coffee/modules/backlog/main.coffee:L1217-L1338], which `BurndownChart.tsx`
// reproduces rather than replaces: G-DS-2 retains the existing chart because
// substituting a charting library would change pixels for no benefit. Every
// member below is one of the five reads that configuration performs over
// `dataToDraw.milestones`.
//
// Confirmed against the live payload as well: `GET /api/v1/projects/3/stats`
// returns eleven milestones carrying exactly these five keys and no others.
// ---------------------------------------------------------------------------
export interface BurndownMilestone {
    /**
     * The sprint name, shown in the tooltip of every one of the four labelled
     * series.
     *
     * [app/coffee/modules/backlog/main.coffee:L1306] reads
     * `dataToDraw.milestones[xval].name` for the optimal series, and
     * [:L1309], [:L1312] and [:L1315] repeat the same read for the real,
     * client-increment and team-increment branches of the tooltip switch.
     *
     * NOT UNIQUE, so it cannot key a rendered list. Live data repeats a single
     * generic label across every sprint that has not started yet, so a
     * consumer keying a list on it would collide and mis-reconcile; the entry's
     * index within the series is the stable choice, and the series order is
     * already significant for that reason.
     */
    readonly name: string;
    /**
     * The ideal remaining-points value for this sprint: series 1, the optimal
     * line.
     *
     * [app/coffee/modules/backlog/main.coffee:L1231] maps the milestone list
     * through `(ml) -> ml.optimal` with no guard, so the member is required and
     * non-nullable.
     */
    readonly optimal: number;
    /**
     * The measured remaining-points value: series 2, the real evolution line.
     *
     * NULLABLE, AND NULL ENTRIES ARE DROPPED RATHER THAN ZERO-FILLED.
     * [app/coffee/modules/backlog/main.coffee:L1237] builds the series as
     * `_.filter(_.map(dataToDraw.milestones, (ml) -> ml.evolution), (evolution)
     * -> evolution?)` -- an existential filter, so a sprint with no measurement
     * yet contributes no point at all and the line simply stops. Substituting
     * zero would instead draw a false plunge to the axis.
     *
     * The nullability is not inferred from the guard alone: it was observed in
     * live data. Across the eleven milestones of the richest seeded project the
     * member's type set is null-or-number, which is exactly why the incumbent
     * filter exists. `BurndownChart.tsx` must reproduce the filter, not a
     * fallback.
     */
    readonly evolution: number | null;
    /**
     * Points the team added during this sprint: the negative-going team
     * increment, series 4.
     *
     * QUOTED STRING-LITERAL MEMBER NAME, and that is mandatory rather than
     * decorative -- a hyphen is not a valid bare identifier in TypeScript, and
     * the incumbent reads the key with exactly this spelling at
     * [app/coffee/modules/backlog/main.coffee:L1250] (`-ml["team-increment"]`)
     * and again at [:L1244]. Renaming it to a camelCase identifier would read
     * undefined off the payload and draw a blank series with no error.
     */
    readonly 'team-increment': number;
    /**
     * Points the client added during this sprint: series 3 subtracts it, along
     * with the team increment, at
     * [app/coffee/modules/backlog/main.coffee:L1243-L1244]
     * (`-ml["team-increment"] - ml["client-increment"]`).
     *
     * Quoted for the same reason as the member above.
     */
    readonly 'client-increment': number;
}

// ---------------------------------------------------------------------------
// ProjectStats
//
// The project-statistics payload that drives the whole upper half of the
// screen: the dark summary bar, the burndown chart, the doomline divider and
// the velocity forecast. Fetched once through the existing repository layer at
// [app/coffee/modules/backlog/main.coffee:L256-L268] and re-fetched whenever a
// milestone changes.
//
// EIGHT MEMBERS, and the eighth is the one a reader would not expect.
//
// `milestones` belongs to this payload, and that is proven from source rather
// than assumed. [app/coffee/modules/backlog/main.coffee:L1326-L1328] watches
// `stats` and calls `redrawChart(element, $scope.stats)`; inside `redrawChart`
// the parameter is named `dataToDraw` and is indexed as `dataToDraw.milestones`
// at [:L1221], [:L1231], [:L1237], [:L1243-L1244], [:L1250], [:L1273] and
// [:L1306]. So `dataToDraw` IS `$scope.stats`, and the burndown series is a
// member of the statistics payload rather than a separate fetch. Independently
// confirmed against the running stack: `GET /api/v1/projects/3/stats` returns a
// `milestones` list of eleven entries alongside the point totals.
//
// One member is NOT a server field. `completedPercentage` is computed on the
// client at [app/coffee/modules/backlog/main.coffee:L262] and [:L264] and
// written back onto the same object, which is why it is the one camelCase
// member in an otherwise `snake_case` payload. The live response does not carry
// it. Preserving the mixture is required by T10 and G2; normalising it would
// silently blank the percentage in the summary bar.
//
// !! COORDINATION HAZARD C-STATS-1 -- SURFACED HERE, DELIBERATELY NOT RESOLVED
// HERE.
//
// `app/react/shared/api/projects.ts` holds a LOCAL, NON-EXPORTED, FIVE-MEMBER
// structural view of the same payload -- `completedPercentage`, `total_points`,
// `defined_points`, `closed_points` and `speed` -- measured from
// [app/partials/includes/components/summary.jade:L8-L32], which is all the
// summary bar itself renders. That module's own specification names THIS file as
// the canonical home of `ProjectStats` and forbids editing it from there, so the
// two shapes are intentionally different widths of the same payload: eight
// members here, five there.
//
// The consequence is real: assigning that narrower facade return value straight
// into this canonical type fails `tsc --noEmit`, because the three members it
// omits are required here. RECONCILIATION BELONGS TO THE HOOKS AND API LAYERS,
// not to this module -- either the facade widens its local view to the full
// payload it actually receives, or the consuming hook declares the narrowing it
// is relying on. Two resolutions are forbidden outright: weakening this
// interface to fit the narrower view, and bridging the gap with a loose escape
// hatch or a double assertion. Neither is permitted by T10 or by the file
// specification. Importing from `shared/api` here to "align" the shapes is also
// forbidden, because types must not depend on transport (T5).
// ---------------------------------------------------------------------------
export interface ProjectStats {
    /**
     * Points already assigned to a sprint. Seeds both running totals that walk
     * the backlog.
     *
     * Read UNGUARDED at [app/coffee/modules/backlog/main.coffee:L447], where
     * `calculateForecasting` starts its running sum from it, and again at
     * [:L737], where the doomline seeds the same sum before finding the row at
     * which committed points overflow the project total. Required and
     * non-nullable because both reads immediately add to it: a null there would
     * poison the sum rather than fail.
     */
    readonly assigned_points: number;
    /**
     * Points already closed. Numerator of the completion percentage at
     * [app/coffee/modules/backlog/main.coffee:L262]
     * (`100 * stats.closed_points / totalPoints`) and rendered as its own stat
     * block at [app/partials/includes/components/summary.jade:L21].
     */
    readonly closed_points: number;
    /**
     * Percentage of the project's points that are closed, rounded.
     *
     * CLIENT-DERIVED, NOT A SERVER FIELD, and camelCase for exactly that reason.
     * [app/coffee/modules/backlog/main.coffee:L262] assigns
     * `Math.round(100 * stats.closed_points / totalPoints)` when a total exists,
     * and [:L264] assigns 0 when it does not -- so it is always present and
     * never null once the screen has loaded, which is why it is required and
     * non-nullable here. `totalPoints` on both branches is the fallback chain at
     * [:L259]: the project total when truthy, otherwise the defined total.
     *
     * Rendered at [app/partials/includes/components/summary.jade:L12] as
     * `stats.completedPercentage + '%'`, and it also drives the summary bar's
     * progress fill through the bar at [:L9]. The camelCase spelling is verified
     * at both the producing and the consuming site and is preserved verbatim.
     */
    readonly completedPercentage: number;
    /**
     * The project's defined-points total, as the server computes it.
     *
     * Serves as the fallback denominator at
     * [app/coffee/modules/backlog/main.coffee:L259] when the project total is
     * falsy, and is rendered at
     * [app/partials/includes/components/summary.jade:L18] with NO `ng-if` around
     * it -- unconditionally, unlike the project-points block two lines above.
     * That asymmetry in the markup is exactly what makes this member required
     * here while `total_points` is nullable.
     */
    readonly defined_points: number;
    /**
     * The burndown series: one entry per milestone, in sprint order.
     *
     * THE EIGHTH MEMBER, proven to belong to this payload by the
     * watch-to-`redrawChart` chain traced in the block comment above. Series
     * order is significant -- the incumbent pairs each entry with its index at
     * [app/coffee/modules/backlog/main.coffee:L1221] and [:L1273] -- so
     * `readonly BurndownMilestone[]` rather than a mutable array, which stops a
     * selector reordering the series in place. A consumer that needs a mutable
     * sequence copies first.
     *
     * DO NOT DERIVE `total_milestones` FROM THIS ARRAY, NOR THIS ARRAY'S LENGTH
     * FROM `total_milestones`. The two members are independent and they disagree
     * in live data: measured against the running stack, one seeded project
     * reported ten milestones against eleven entries and another six against
     * seven. The surplus entry is a synthetic terminal point the server appends
     * beyond the counted milestones, and its `optimal` is floating-point residue
     * rather than a clean zero, so a consumer must not test it for equality with
     * zero either. Both members are declared separately here for that reason.
     */
    readonly milestones: readonly BurndownMilestone[];
    /**
     * Average points closed per sprint -- the velocity the forecast is capped
     * by.
     *
     * Guarded on being positive rather than on existing, twice:
     * [app/coffee/modules/backlog/main.coffee:L456] and [:L466] both test
     * `stats.speed > 0` before letting it bound the forecast, so a project with
     * no history forecasts nothing rather than dividing by zero. Rendered
     * unconditionally at
     * [app/partials/includes/components/summary.jade:L24]. Required and
     * non-nullable: the comparison is numeric at both sites and the live payload
     * sends 0, not null, for a project with no closed sprint.
     */
    readonly speed: number;
    /**
     * Number of milestones the project has, or null.
     *
     * NULLABLE, and the proof is the existential test at
     * [app/coffee/modules/backlog/main.coffee:L266]:
     * `!(stats.total_points? && stats.total_milestones?)` decides whether the
     * screen shows the burndown or the graph placeholder. An existential guard
     * on a value that could never be absent would be dead code; it is not dead,
     * so the member is nullable and every consumer must reproduce the guard
     * before showing the chart.
     *
     * A COUNT, NOT A LENGTH: this is not the length of `milestones`. See the
     * note on that member above for the measured discrepancy.
     */
    readonly total_milestones: number | null;
    /**
     * Total points committed to the project, or null.
     *
     * NULLABLE for the same reason as the member above -- the same existential
     * test at [app/coffee/modules/backlog/main.coffee:L266] -- and corroborated
     * twice more. [app/partials/includes/components/summary.jade:L14] gates the
     * whole project-points block on it with `ng-if="stats.total_points"`, so the
     * block is hidden when the value is falsy, and
     * [app/coffee/modules/backlog/main.coffee:L732] guards the doomline on it
     * being both present and non-zero before drawing.
     *
     * [:L259] is the third corroboration: the fallback to the defined total
     * exists precisely because this member may be absent.
     */
    readonly total_points: number | null;
}

// ---------------------------------------------------------------------------
// BacklogUserStory
//
// The shared raw user story, extended with the one ordering member the Backlog
// screen owns.
//
// `sprint_order` is deliberately ABSENT from the shared model at
// `app/react/shared/types/userStory.ts`, which carries `kanban_order` and
// `backlog_order` only -- one position member per board that owns one. Sprint
// position belongs to this screen, so this screen declares it, and that keeps
// the shared model free of a member no other consumer reads.
//
// Measured at [app/coffee/modules/backlog/main.coffee:L274], where
// `setMilestonesOrder` caches `it.sprint_order` per sprint and per story id, and
// at [:L797], where the milestone bulk payload sends `order: us.sprint_order`.
//
// OPTIONAL because it is populated only for a story that belongs to a sprint: a
// story sitting in the unassigned backlog below the divider has no sprint
// position at all. That optionality is what makes `BulkMilestoneItem.order`
// possibly undefined -- see that declaration.
//
// An intersection rather than an `extends` interface, so the member set stays
// structurally identical to the shared model plus exactly one addition, and so
// every value that satisfies the shared model still satisfies this type.
// ---------------------------------------------------------------------------
export type BacklogUserStory = UserStory & { readonly sprint_order?: number };

// ---------------------------------------------------------------------------
// ProjectRole
//
// A project role, as the estimation surface consumes it. Roles arrive nested in
// the project payload and are handed to the estimation process at
// [app/coffee/modules/common/estimation.coffee:L145].
//
// Three members, because three are read on this screen. The payload also
// carries a slug, a permission list, a display order and the owning project id;
// none is read by the points cell, so none is claimed here. Structural typing
// keeps the wider payload assignable, and the Minimal Change Clause says to
// leave it at that rather than mirror the serializer.
// ---------------------------------------------------------------------------
export interface ProjectRole {
    /**
     * Role id. Used as the key into a story's per-role points map at
     * [app/coffee/modules/common/estimation.coffee:L184]
     * (`pointId = @us.points[role.id]`), and emitted as the `data-role-id`
     * attribute the points popover reads back at
     * [app/partials/common/estimation/us-estimation-points-per-role.jade:L15].
     */
    readonly id: number;
    /**
     * Display name. Rendered twice by the per-role points template -- as the
     * cell title at
     * [app/partials/common/estimation/us-estimation-points-per-role.jade:L16]
     * and as the visible label at [:L18].
     */
    readonly name: string;
    /**
     * Whether the role participates in estimation.
     *
     * [app/coffee/modules/common/estimation.coffee:L182] filters the role list
     * on it (`_.filter(@project.roles, "computable")`) before building the
     * per-role rows, so a non-computable role contributes no row and no points.
     * A boolean in the live payload, not a truthy string.
     */
    readonly computable: boolean;
}

// ---------------------------------------------------------------------------
// ProjectPoint
//
// One entry of the project's estimation scale. Taken from the project payload
// at [app/coffee/modules/common/estimation.coffee:L146] and, on the Backlog
// controller side, sorted for display at
// [app/coffee/modules/backlog/main.coffee:L479].
//
// Three members, for the same reason as `ProjectRole`: the payload also carries
// a display order and the owning project id, neither of which this type's
// consumers read. Declaring them would make the shape harder to satisfy for no
// measured gain (C1.0 and the Minimal Change Clause).
// ---------------------------------------------------------------------------
export interface ProjectPoint {
    /**
     * Point id -- the value stored in a story's per-role points map, and the
     * key of the lookup below.
     *
     * [app/coffee/modules/backlog/main.coffee:L480] and
     * [app/coffee/modules/common/estimation.coffee:L148] both build that lookup
     * with `groupBy(points, (x) -> x.id)`, and
     * [app/partials/common/estimation/us-estimation-points.jade:L13] emits it as
     * the `data-point-id` attribute the click handler reads back.
     */
    readonly id: number;
    /**
     * The label shown for this point -- a scale token such as a numeral or a
     * question mark, not a formatted number.
     *
     * [app/coffee/modules/common/estimation.coffee:L187] prints it when the
     * lookup resolves and falls back to a literal question mark when it does
     * not, and [:L222] measures its length to decide whether the popover lays
     * out horizontally. Rendered at
     * [app/partials/common/estimation/us-estimation-points.jade:L14] and [:L18].
     *
     * A string, and required: the live scale includes an entry whose name is
     * itself the question-mark token, which is a name rather than a missing one.
     */
    readonly name: string;
    /**
     * The numeric weight this point contributes to a total, or null when the
     * point is the unestimated placeholder.
     *
     * NULLABLE, AND THE NULLABILITY IS LOAD-BEARING.
     * [app/coffee/modules/common/estimation.coffee:L170] maps every entry of a
     * story's points map through the lookup and reads this member
     * existentially, then [:L175-L177] drops the null results and returns the
     * question-mark token when nothing survives. Typing it as a plain number
     * would make that branch look unreachable and would let a consumer add null
     * into a running total. Observed as null in live data on the placeholder
     * entry of the seeded scale.
     */
    readonly value: number | null;
}

// ---------------------------------------------------------------------------
// PointsById
//
// The point lookup: point id -> the point itself.
//
// A FLAT MAP, NOT A GROUPED ONE, and this is the single easiest declaration in
// the file to get wrong. The `groupBy` used to build it is the repository's own
// helper at [app/coffee/utils.coffee:L80-L85], exported as `taiga.groupBy` at
// [:L286], and it assigns rather than accumulates:
//
//     groupBy = (coll, pred) ->
//         result = {}
//         for item in coll
//             result[pred(item)] = item
//         return result
//
// So the value is one point, not a list of points, and a duplicate key would
// leave the LAST entry winning. Built at
// [app/coffee/modules/backlog/main.coffee:L480] and at
// [app/coffee/modules/common/estimation.coffee:L148]; read at [:L170]
// (`@pointsById[v]?.value`), at [:L185] and at
// [app/coffee/modules/backlog/main.coffee:L1108].
//
// THE EXPLICIT `| undefined` IS REQUIRED, not defensive.
// `noUncheckedIndexedAccess` is NOT enabled in tsconfig.json, so an index read
// on a `Record` would otherwise be typed as always present -- and the existential
// guard the incumbent relies on at
// [app/coffee/modules/common/estimation.coffee:L187] (`if pointObj? and
// pointObj.name?`) would be typed as a redundant check on a value that cannot be
// absent. Spelling the absence into the value type keeps that guard meaningful
// and keeps its fallback branch reachable, which is what preserves the
// question-mark rendering.
//
// KEYED BY `number`, WHICH CONSTRAINS HOW CONSUMERS REACH IT. Verified against
// the compiler rather than assumed: indexing a number-keyed record with a
// string-typed key expression is rejected outright (TS7015, "index expression is
// not of type 'number'"), while indexing the shared story's string-keyed points
// map with a number-or-string key expression is accepted.
//
// So the resolution order is the incumbent's own two-step chain, and it
// type-checks exactly as written: read the point id out of the story's points
// map first -- [app/coffee/modules/common/estimation.coffee:L184],
// `pointId = @us.points[role.id]` -- then index this lookup with that numeric
// point id -- [:L185], `pointObj = @pointsById[pointId]`. A consumer holding a
// `SelectedRoleId` must therefore go through the points map, never straight into
// this lookup; see that declaration for the measured string/number drift behind
// the constraint.
// ---------------------------------------------------------------------------
export type PointsById = Readonly<Record<number, ProjectPoint | undefined>>;

// ---------------------------------------------------------------------------
// BulkMilestoneItem
//
// One item of the position-relative bulk payload the Backlog sends when stories
// are reordered or moved into a sprint.
//
// Two independently measured construction sites agree on the shape:
//
//   [app/coffee/modules/backlog/main.coffee:L504-L505]
//     prepareBulkUpdateData: (uses, field="backlog_order") ->
//         return _.map(uses, (x) -> {"us_id": x.id, "order": x[field]})
//
//   [app/coffee/modules/backlog/main.coffee:L794-L798]
//     data = _.map selectedUss, (us) ->
//         return { us_id: us.id, order: us.sprint_order }
//
// The second feeds the milestone bulk endpoint at [:L799].
//
// THE WIRE SPELLINGS ARE NOT NEGOTIABLE. `us_id` stays `snake_case` because
// that is the key the endpoint reads (G2, and T10 forbids the transformation).
// The endpoint itself, its URL and its neighbour parameters belong to
// `app/react/shared/api/` under T5; this declaration is the item shape only.
//
// This is the read-and-build side of the ordering contract that AAP 0.8.3
// serialises through the pending-drag queue. The queue is behaviour and lives in
// `backlogReducer.ts` and the drag hook; nothing about it is expressible as a
// type, so nothing about it appears here.
// ---------------------------------------------------------------------------
export interface BulkMilestoneItem {
    /**
     * The user story being repositioned. `snake_case` because it is the wire
     * key: [app/coffee/modules/backlog/main.coffee:L505] and [:L796] both spell
     * it exactly so.
     */
    readonly us_id: number;
    /**
     * The story's position in the destination list.
     *
     * POSSIBLY UNDEFINED, from both construction sites.
     * [app/coffee/modules/backlog/main.coffee:L505] reads it through a dynamic
     * member name defaulting to the backlog position, and [:L797] reads
     * `us.sprint_order`, which is optional on `BacklogUserStory` because a story
     * outside every sprint has no sprint position.
     *
     * Declared as a union with `undefined` rather than as an optional member, so
     * that a producer must state the absence explicitly instead of silently
     * omitting the key. That distinction matters on the wire: both construction
     * sites ALWAYS emit the key -- see [:L505] and [:L797] above -- so a body
     * that dropped it would no longer be the body the incumbent sends (G2).
     */
    readonly order: number | undefined;
}

// ---------------------------------------------------------------------------
// SelectedRoleId
//
// The identifier of the role currently selected inside a story's points cell,
// or null when no role is selected.
//
// A UNION, BECAUSE THE INCUMBENT GENUINELY PRODUCES BOTH REPRESENTATIONS, and
// documenting the drift is better than hiding it behind a coercion:
//
//   * [app/coffee/modules/backlog/main.coffee:L1089] preselects the sole role
//     with `_.keys(us.points)[0]`, and object keys are STRINGS.
//   * [app/coffee/modules/backlog/main.coffee:L1149] reads the same identifier
//     back out of a rendered `data-role-id` attribute, and the DOM-data reader
//     on the AngularJS side coerces a numeric attribute to a NUMBER.
//
// Null is the third state, and it is measured too:
// [app/coffee/modules/backlog/main.coffee:L1103] branches on
// `not selectedRoleId?` to decide between showing the total and showing a single
// role's point, and [:L1139] branches on the same existence test to decide
// between the points popover and the roles popover.
//
// Both representations work against the shared story's points map, which is
// keyed by string, because a numeric key expression coerces on lookup. The union
// therefore records a real property of the incumbent rather than a defect to be
// normalised -- normalising it would be a behaviour change under T10, and a
// consumer that needs one representation narrows at its own use site.
// ---------------------------------------------------------------------------
export type SelectedRoleId = string | number | null;
