/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// ===========================================================================
// BACKLOG SELECTORS -- THE PURE DERIVATION LAYER OF THE BACKLOG SCREEN
//
// Every export below is a PURE FUNCTION OF ITS ARGUMENTS. There is no React
// state, no injector access, no DOM read or write, no timer, no storage and no
// network call in this module, and there is no module-level mutable value
// either: called twice with the same inputs, each function returns the same
// result and leaves nothing behind.
//
// That is not a stylistic preference, it is requirement I9 of the migration
// plan made concrete. The unit layer for the new React tree runs browserless,
// against TypeScript source, with no generated bundle to lean on, so the work
// that needs a browser -- retrieving data, subscribing to realtime, dragging
// rows -- lives in the container and hook layer, and the arithmetic that
// decides WHAT the screen shows lives here where it can be exercised as plain
// functions. A specification for this module therefore needs neither a mock
// injector nor a bridge provider.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE REPLACES (transformation rule T9)
// ---------------------------------------------------------------------------
// Four separate pieces of incumbent AngularJS behaviour, each reduced to the
// calculation at its core and stripped of the DOM surgery that surrounded it:
//
//   selectDoomLineIndex   `linkDoomLine`, the doomline walk
//                         [app/coffee/modules/backlog/main.coffee:L727-L748]
//   calculateTotalPoints  `EstimationProcess.calculateTotalPoints`
//                         [app/coffee/modules/common/estimation.coffee:L169-L179]
//   calculateRoles        `EstimationProcess.calculateRoles`
//                         [app/coffee/modules/common/estimation.coffee:L181-L190]
//   selectPointsDisplay   the `render()` body of `UsPointsDirective`
//                         [app/coffee/modules/backlog/main.coffee:L1082-L1118]
//   getLastSprint         the sprint-form helper
//                         [app/coffee/modules/backlog/lightboxes.coffee:L120-L127]
//
// The incumbent versions all ended by touching the document: the doomline
// inserted a template before a row [main.coffee:L753-L755], the points cell
// replaced its own inner markup [main.coffee:L1119-L1122], and the sprint
// helper fed a date picker [lightboxes.coffee:L152-L157]. None of that is
// reproduced here. This module returns DATA; the components render it.
//
// ---------------------------------------------------------------------------
// PRESERVED DEFECTS AND PRESERVED BEHAVIOUR (transformation rule T10)
// ---------------------------------------------------------------------------
// Rule T10 forbids every functional change, which means the surprising parts of
// the incumbent are requirements, not bugs to be tidied. Six are reproduced
// deliberately, each numbered, each commented at the exact line that reproduces
// it, and each reported as a finding to the Drift Register that the end-to-end
// task keeps under `e2e-react/artifacts/figma-comparison/` -- reported, never
// silently corrected, and never written from this module:
//
//   DL-1  a nullish story total poisons the doomline sum to a non-number, after
//         which no divider is drawn at all       [main.coffee:L737,L742]
//   TP-1  the points total is summed by a seedless fold, which throws on an
//         empty list and is guarded only by an
//         earlier emptiness check               [estimation.coffee:L176-L179]
//   PD-1  a single computable role preselects that role for the click path yet
//         deliberately leaves the DISPLAY showing the bare total
//                                               [main.coffee:L1103 vs :L1089]
//   PD-2  the selected role's point is dereferenced unguarded, so an unset
//         point raises a TypeError              [main.coffee:L1109-L1110]
//   PD-3  cosmetic only: a double space in the render context literal
//                                               [main.coffee:L1116]
//   LS-1  the last open sprint is chosen by sorting formatted-string sort keys,
//         so the ordering is lexicographic instead of chronological
//                                               [lightboxes.coffee:L124-L125]
//
// A seventh finding is a piece of DEAD incumbent code that is deliberately NOT
// reproduced, because reproducing it would change behaviour: see the velocity
// discussion on `selectDoomLineIndex` below.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE DELIBERATELY DOES NOT DO
// ---------------------------------------------------------------------------
//   * It does not sort the backlog. Rendered order is decided upstream, by
//     `backlog_order` ascending [main.coffee:L423]; re-sorting here would
//     silently disagree with the rendered rows and move the divider.
//   * It does not emit markup or class names. The doomline template
//     [main.coffee:L723-L725] and the `not-clickable` class
//     [main.coffee:L1085] belong to the components, which reuse the incumbent
//     class contract verbatim under rule T1.
//   * It does not build the `"name / total"` string the incumbent assembled at
//     [main.coffee:L1109]. That string embeds a literal element, and injecting
//     raw markup from React is banned outright, so the parts are returned
//     separately for the component to compose.
//   * It does not decide WHEN to recalculate. The incumbent recomputed on
//     `userstories:loaded` [main.coffee:L761], on `sprint:us:moved` [:L763] and
//     on a watch of the statistics payload [:L764]; that scheduling is the
//     container's concern, and calling a pure function again is the whole
//     mechanism.
//   * It does not import a date, collection or immutable-structure library.
//     The pinned dependency set for new code admits none of them, and each
//     behaviour they provided is reproduced explicitly below.
// ===========================================================================

import type { Sprint } from '../../shared/types/sprint';
import type { UserStory } from '../../shared/types/userStory';
import type {
    BacklogUserStory,
    PointsById,
    ProjectPoint,
    ProjectRole,
    ProjectStats,
    SelectedRoleId,
} from './types';

/**
 * A story's per-role points map: role id -> points id.
 *
 * Aliased from the canonical declaration at
 * [app/react/shared/types/userStory.ts:L499] rather than restated, so that a
 * change to the shared model reaches every signature in this module. The keys
 * are strings because that is what the payload sends, which is why a numeric
 * role id and a string role id both index it successfully.
 */
type UserStoryPoints = UserStory['points'];

/**
 * The placeholder the estimation surface prints when a points value cannot be
 * resolved.
 *
 * A literal question mark, from two independent sites that agree on it:
 * [app/coffee/modules/common/estimation.coffee:L173] and [:L177] return it in
 * place of a total, and [:L187] returns it in place of a single role's point
 * name. It is a STRING in both cases, which is why the total's return type is a
 * union rather than a number.
 *
 * Note that this token also occurs as a legitimate `name` on the seeded
 * estimation scale, so a rendered question mark does not by itself prove the
 * lookup failed. That ambiguity exists in the incumbent and is preserved.
 */
const UNESTIMATED_TOKEN = '?';

// ===========================================================================
// SECTION 1 -- THE DOOMLINE
// ===========================================================================

/**
 * Finds the backlog row at which the committed points overflow the project's
 * total -- the "doomline" divider position.
 *
 * REPRODUCES `reloadDoomLine` at
 * [app/coffee/modules/backlog/main.coffee:L727-L748], which walks the rendered
 * backlog accumulating story totals on top of the points already assigned to a
 * sprint, and marks the first row at which the running sum passes the project
 * total.
 *
 * THE RETURNED INDEX IS THE ROW **BEFORE** WHICH THE DIVIDER RENDERS. The
 * incumbent inserted its template with a before-insertion against the row
 * element at that index [:L753-L755], so the divider sits above that row, not
 * below it. A component that renders it after the row would move the divider
 * down by one story.
 *
 * AT MOST ONE DIVIDER, EVER: the incumbent breaks out of the walk on the first
 * hit [:L748], so this returns the first crossing index and stops looking.
 *
 * NO VELOCITY CONDITION IS IMPLEMENTED, AND ITS ABSENCE IS DELIBERATE.
 * The incumbent guards the whole calculation on velocity forecasting twice --
 * `if $scope.displayVelocity` at [:L729] and `!$scope.displayVelocity?` at
 * [:L732] -- and BOTH GUARDS ARE DEAD. Those two lines are the only places in
 * the repository that read the flag off the scope; every producer and every
 * other consumer reads it off the controller instead: it is initialised at
 * [:L132], toggled at [:L291-L292], read at [:L231], read as
 * `$scope.ctrl.displayVelocity` at
 * [app/coffee/modules/backlog/sortable.coffee:L111], and bound as
 * `ctrl.displayVelocity` at
 * [app/partials/includes/modules/backlog-table.jade:L21] and at
 * [app/partials/backlog/backlog.jade:L108], [:L117] and [:L144]. The scope
 * property is therefore always absent, so [:L729] never fires and the negated
 * existence test at [:L732] is always true. Implementing either guard here
 * would introduce a condition that has never run in production, so the live
 * behaviour -- calculate whenever the statistics carry a non-zero total -- is
 * what is implemented. Do not "restore" the guard.
 *
 * A THIRD DEAD PATH, recorded so it is not mistaken for a gap: the listener at
 * [:L762] clears the divider WITHOUT recalculating, and the event it listens
 * for has zero broadcasters anywhere in the repository -- that listener is its
 * only occurrence -- so the clear-without-recompute path is unreachable. The
 * helper at [:L757-L759] is likewise never called.
 *
 * @param stats   the project statistics payload, or nothing when the screen has
 *                not loaded them yet -- the incumbent's guard at [:L732] is an
 *                existence test, so absent and null behave identically.
 * @param userStories the backlog rows IN RENDERED ORDER. Not sorted here: order
 *                is established upstream by `backlog_order` ascending at
 *                [:L423]. Absent, null and empty all yield no divider.
 * @returns the index of the row before which the divider renders, or null when
 *          no row crosses the total.
 */
export function selectDoomLineIndex(
    stats: ProjectStats | null | undefined,
    userStories: readonly BacklogUserStory[] | null | undefined,
): number | null {
    // [main.coffee:L732], first clause: `$scope.stats?` -- an existence test, so
    // it covers both an absent and an explicitly null payload.
    if (stats === null || stats === undefined) {
        return null;
    }

    // [main.coffee:L732], remaining clauses: `$scope.stats.total_points?` and
    // `!= 0`. The incumbent's loose inequality is reproduced as a strict one
    // because it is provably equivalent here: the existence test above has
    // already excluded null and absent, so the only value the loose form would
    // additionally exclude is one that is not a number at all -- which the
    // `typeof` test excludes explicitly, and which the declared type forbids.
    const totalPoints = stats.total_points;
    if (typeof totalPoints !== 'number' || totalPoints === 0) {
        return null;
    }

    // [main.coffee:L739] `return if not $scope.userstories`. An EMPTY array is
    // truthy in JavaScript, so the incumbent passed this guard and then simply
    // never entered the walk; falling through to the loop below reaches the same
    // null by the same route.
    if (userStories === null || userStories === undefined) {
        return null;
    }

    // [main.coffee:L737] the walk starts from the points already committed to a
    // sprint, NOT from zero.
    let currentSum: number = stats.assigned_points;

    for (let index = 0; index < userStories.length; index += 1) {
        const story = userStories[index];

        // PRESERVED DEFECT DL-1 [main.coffee:L737,L742] -- a nullish
        // `total_points` poisons `currentSum` to a non-number, after which every
        // strict greater-than comparison below is false forever and NO DIVIDER
        // RENDERS for the rest of the list. An unestimated story sends null,
        // which the addition coerces to zero harmlessly; what poisons the sum is
        // an absent member, an absent `assigned_points` seed, or a contribution
        // that is already not a number. Reproduced deliberately per T10 -- there
        // is no coalescing here, by design, and none may be added. Reported to
        // the Drift Register.
        //
        // The assertion below asserts nothing at run time: it exists only so the
        // compiler accepts the incumbent's unguarded addition, and the arithmetic
        // that follows is byte-for-byte the arithmetic of [:L742].
        currentSum += story.total_points!;

        // [main.coffee:L744] STRICT greater-than. A story that lands exactly on
        // the total does not cross it.
        if (currentSum > totalPoints) {
            // [main.coffee:L745-L746] the incumbent looked the row element up by
            // this index and inserted before it. Worth knowing when reading the
            // consuming component: an index past the end of the rendered row list
            // produced an absent element there, and the insertion against it was
            // a silent no-op, so the incumbent could compute a crossing and still
            // draw nothing.
            return index;
        }
    }

    // [main.coffee:L748] the walk ended without a crossing: no divider.
    return null;
}

// ===========================================================================
// SECTION 2 -- POINT RESOLUTION AND THE POINTS TOTAL
// ===========================================================================

/**
 * Resolves a points id to the point it names, reproducing the incumbent's
 * one-step lookup including its behaviour for an unresolvable id.
 *
 * The lookup itself is `@pointsById[pointId]`, which occurs three times in the
 * incumbent -- [app/coffee/modules/common/estimation.coffee:L170] and [:L185],
 * and [app/coffee/modules/backlog/main.coffee:L1108]. The map it indexes is
 * built by the repository's own grouping helper at
 * [app/coffee/utils.coffee:L80-L85], which ASSIGNS rather than accumulates, so
 * the value is one point and a duplicate id would leave the last entry winning.
 *
 * WHY THE `typeof` TEST RATHER THAN A NULL COMPARISON. A story's points map
 * sends null for a role that has been given no estimate, and omits the key
 * entirely for a role that was never offered one, so the id reaching here is a
 * number, null or absent. The incumbent indexed the map with whichever of the
 * three it held; a non-numeric key never matches a numerically keyed map, so the
 * lookup returned nothing. Testing for a number reproduces that outcome for all
 * three cases at once, and it is the form the compiler accepts: the map is keyed
 * by number [app/react/backlog/state/types.ts:L567], so a possibly-null index
 * expression is rejected outright.
 *
 * A numeric id that simply has no entry also resolves to nothing, exactly as it
 * did in the incumbent -- the explicit absence in the map's value type is what
 * keeps that outcome visible to the compiler, since unchecked indexed access is
 * not enabled for this project.
 */
function resolvePoint(pointsById: PointsById, pointId: number | null | undefined): ProjectPoint | undefined {
    if (typeof pointId !== 'number') {
        return undefined;
    }

    return pointsById[pointId];
}

/**
 * Sums a story's per-role points into the single total the backlog row shows.
 *
 * REPRODUCES `calculateTotalPoints` at
 * [app/coffee/modules/common/estimation.coffee:L169-L179]: map every entry of
 * the story's points map through the point lookup, take each point's numeric
 * weight, drop the ones that resolve to nothing, and add the rest together.
 *
 * THE RETURN TYPE IS A UNION WITH A STRING, AND BOTH BRANCHES THAT PRODUCE IT
 * ARE REAL. The incumbent returns the placeholder token when the points map is
 * empty [:L172-L173], and again when every mapped weight is absent [:L176-L177]
 * -- a story on a scale whose entries carry no numeric weight, for instance.
 * Neither branch returns null, zero or nothing, and a consumer must render the
 * token rather than substitute a numeric fallback.
 *
 * The signature deliberately takes the points map and the lookup rather than a
 * whole story: the story row needs this same total, and a narrow signature keeps
 * both call sites -- and the specification -- free of a full story fixture.
 *
 * @param points     the story's per-role points map.
 * @param pointsById the project's point lookup.
 * @returns the summed weight, or the placeholder token.
 */
export function calculateTotalPoints(points: UserStoryPoints, pointsById: PointsById): number | '?' {
    // [estimation.coffee:L170] maps over the map's VALUES -- the points ids --
    // and reads each resolved point's weight existentially, so an unresolvable id
    // contributes an absent weight rather than throwing.
    const values = Object.values(points).map((pointId) => resolvePoint(pointsById, pointId)?.value);

    // [estimation.coffee:L172-L173] an empty points map yields the token.
    if (values.length === 0) {
        return UNESTIMATED_TOKEN;
    }

    // [estimation.coffee:L175] keeps the weights that exist. The incumbent's
    // existence test admits zero and rejects only null and absent, so a point
    // legitimately worth zero still counts towards the total.
    const notNullValues = values.filter((value): value is number => value !== null && value !== undefined);

    // [estimation.coffee:L176-L177] every weight was absent: the token again.
    if (notNullValues.length === 0) {
        return UNESTIMATED_TOKEN;
    }

    // PRESERVED DEFECT TP-1 [estimation.coffee:L179] -- the fold is SEEDLESS, so
    // it uses the first element as its starting value and throws on an empty
    // list. The emptiness check immediately above is the only thing that stops it
    // from throwing, which is why these two statements must stay adjacent and in
    // this order. Adding a zero seed would be a behaviour change under T10 -- the
    // sum is identical for numbers, but the throw the incumbent is capable of
    // would disappear -- so no seed is passed. Reported to the Drift Register.
    return notNullValues.reduce((accumulator, weight) => accumulator + weight);
}

// ===========================================================================
// SECTION 3 -- PER-ROLE POINTS
// ===========================================================================

/**
 * One computable project role together with the point NAME to show for it.
 *
 * Extends the canonical role rather than restating it, so the three members the
 * estimation surface reads stay declared in one place at
 * [app/react/backlog/state/types.ts:L437-L462] and this type adds exactly the
 * one member the incumbent added.
 *
 * `points` IS A STRING, NEVER A NUMBER: [estimation.coffee:L187] assigns the
 * resolved point's `name` -- a scale label -- or the placeholder token, and the
 * per-role popover renders it as text at
 * [app/partials/common/estimation/us-estimation-points-per-role.jade:L18].
 */
export interface RolePoints extends ProjectRole {
    readonly points: string;
}

/**
 * Builds the per-role points rows for a story: one row per computable role,
 * carrying that role's point name.
 *
 * REPRODUCES `calculateRoles` at
 * [app/coffee/modules/common/estimation.coffee:L181-L190].
 *
 * THE FILTER IS A TRUTHINESS TEST, NOT AN EQUALITY TEST. [:L182] passes the
 * member name to the incumbent's collection utility as a property shorthand,
 * which keeps every role whose flag is truthy; it is reproduced as a truthiness
 * test rather than a comparison against true, so a role the payload marks with
 * a truthy non-boolean is kept exactly as the incumbent kept it.
 *
 * NEW OBJECTS, NEVER MUTATION. [:L186] deep-copies each role before writing the
 * point name onto the copy, precisely so the project's own role objects are left
 * untouched -- the same project payload feeds every row of the table, so
 * mutating a role would leak one story's estimate into all of them. Spreading
 * into a fresh object reproduces that isolation without copying a library in to
 * do it, and the readonly inputs make the guarantee a compile-time one.
 *
 * CALLED TWICE PER RENDER IN THE INCUMBENT -- once while linking at
 * [app/coffee/modules/backlog/main.coffee:L1082] and again inside the render
 * body at [:L1114]. That redundancy is harmless because the function is pure,
 * and it is left alone deliberately: caching or memoising it would be an
 * optimisation beyond what the technology transition requires, which the Minimal
 * Change Clause forbids.
 *
 * @param points the story's per-role points map. A role with no entry in it, and
 *               a role whose entry resolves to no point, both fall back to the
 *               placeholder token.
 * @returns one row per computable role, in the order the roles arrive.
 */
export function calculateRoles(
    roles: readonly ProjectRole[],
    points: UserStoryPoints,
    pointsById: PointsById,
): readonly RolePoints[] {
    // [estimation.coffee:L182]
    const computableRoles = roles.filter((role) => role.computable);

    // [estimation.coffee:L183-L188]
    return computableRoles.map((role) => {
        // [estimation.coffee:L184-L185] the two-step resolution: the role id
        // indexes the story's string-keyed points map, and the points id it
        // yields indexes the numerically keyed point lookup. The order matters --
        // a role id must never be used against the point lookup directly.
        const point = resolvePoint(pointsById, points[role.id]);

        // [estimation.coffee:L187] `if pointObj? and pointObj.name?`. Both halves
        // of that test are reproduced by the single string test below: the
        // resolved point is absent, or it carries no usable name, and either way
        // the placeholder token is shown. Testing for a string rather than
        // comparing against null is what the compiler accepts here, because the
        // name is declared as always present -- and it is equivalent across the
        // declared domain while still covering the run-time absence the
        // incumbent's existence test was written for.
        const pointName = point !== undefined && typeof point.name === 'string' ? point.name : UNESTIMATED_TOKEN;

        return { ...role, points: pointName };
    });
}

// ===========================================================================
// SECTION 4 -- THE POINTS CELL
// ===========================================================================

/**
 * Everything the backlog row's points cell needs in order to render itself,
 * derived once from the story and the project.
 *
 * THIS IS DATA, NOT MARKUP, AND THE DIFFERENCE IS FORCED. The incumbent built
 * its cell contents as a string at
 * [app/coffee/modules/backlog/main.coffee:L1109], embedding a literal element
 * around the total so the two halves could be styled differently, and handed
 * that string to a template. React cannot consume it: rendering a string as
 * markup requires the escape hatch this migration bans outright. So the halves
 * travel separately in `roleName` and `totalPoints`, and the component composes
 * them as elements. The rendered result is identical; only the transport
 * changes.
 *
 * The incumbent's context literal [:L1112-L1118] carried five members. Four are
 * here under the same meaning; the fifth, its `title`, was the same content
 * without the embedded element [:L1110] and is therefore composed by the
 * component from these same parts rather than duplicated as a second field.
 * PRESERVED DEFECT PD-3 [main.coffee:L1116] is cosmetic and lives entirely in
 * that literal -- a double space before the value -- so it has no representation
 * here at all. Recorded for the Drift Register and nothing more.
 */
export interface PointsDisplayData {
    /**
     * The story's total, or the placeholder token.
     *
     * [main.coffee:L1102] and [:L1113]. Shown alone in the common case; shown
     * after the selected role's point name when a role is selected.
     */
    readonly totalPoints: number | '?';
    /**
     * The point name to show BEFORE the total, or null when the cell shows the
     * bare total.
     *
     * DESPITE THE NAME, THIS IS THE SELECTED ROLE'S POINT NAME, NOT THE ROLE'S
     * OWN NAME: [main.coffee:L1109] interpolates the resolved point's `name`,
     * which is a scale label such as a numeral. The field keeps the name the
     * consuming cell's contract uses, and this note exists so the value is not
     * mistaken for the role label.
     *
     * Null is the normal state, for the reason set out under PD-1 below.
     */
    readonly roleName: string | null;
    /**
     * The computable roles with their point names, for the roles popover.
     *
     * [main.coffee:L1114], recomputed on every render there. Also what the
     * popover at [:L1127-L1128] renders.
     */
    readonly roles: readonly RolePoints[];
    /**
     * Whether the cell may be edited at all.
     *
     * [main.coffee:L1115], sourced from the estimation process's own permission
     * check at [app/coffee/modules/common/estimation.coffee:L144] -- a project
     * that is not archived, and a member holding the story-modification
     * permission. Passed in rather than derived here, because permission
     * evaluation belongs to the layer that holds the project payload.
     */
    readonly editable: boolean;
    /**
     * Whether the cell responds to a click.
     *
     * False exactly when there is no computable role at all: [main.coffee:L1083]
     * detects that case and [:L1084-L1085] responds by removing the disclosure
     * arrow and adding the existing `not-clickable` class. Exposed as a boolean
     * so the component applies that same class name rather than inventing one
     * (rule T1), and drops the arrow on the same condition.
     */
    readonly clickable: boolean;
    /**
     * The role id the incumbent preselects when there is exactly one computable
     * role, or null.
     *
     * [main.coffee:L1087-L1089]: with one computable role the cell preselects the
     * first key of the story's points map, and object keys are strings -- which
     * is one half of why a selected role id may be either a string or a number.
     *
     * FOR THE CLICK PATH ONLY. It never affects the display, because of PD-1
     * below. Its purpose is [:L1139-L1140]: with a selection present a click
     * opens the points selector for that role directly, and without one it opens
     * the roles popover first. A container assigns this to its selection state
     * when it mounts the cell, exactly as the incumbent's link step did, and owns
     * every later reassignment through the selection events at [:L1067-L1075];
     * this module reports the value and applies no precedence of its own, so no
     * user selection can be lost to a recomputation.
     *
     * Null when there is not exactly one computable role, and null too when the
     * points map is empty -- the incumbent's read produced an absent value there,
     * which behaves identically to null at both of the sites that test it,
     * [:L1103] and [:L1139].
     */
    readonly preselectedRoleId: string | null;
}

/**
 * The first role id in a story's points map, or null when the map is empty.
 *
 * Reproduces the key read at [app/coffee/modules/backlog/main.coffee:L1089].
 * Insertion order is what "first" means, for the incumbent and here alike.
 */
function firstPointsMapRoleId(points: UserStoryPoints): string | null {
    const roleIds = Object.keys(points);

    if (roleIds.length === 0) {
        return null;
    }

    return roleIds[0];
}

/**
 * Derives everything the points cell of one backlog row renders.
 *
 * REPRODUCES the render body of `UsPointsDirective` at
 * [app/coffee/modules/backlog/main.coffee:L1082-L1118], minus the markup
 * assembly discussed on `PointsDisplayData`.
 *
 * PRESERVED BEHAVIOUR PD-1 [main.coffee:L1103 vs :L1089] -- the second disjunct
 * of the display test, one computable role, DEFEATS the preselection made four
 * lines earlier, for display purposes only. With exactly one computable role the
 * cell shows the bare total and never the "name / total" form, even though a
 * role is selected at that instant. The preselection is not pointless: it exists
 * so that clicking the cell opens the points selector for that role directly
 * instead of asking which role to estimate [:L1139-L1140]. Both halves are
 * implemented faithfully -- the bare total on the display path, the preselected
 * id exposed for the click path -- and neither may be "fixed" into agreement
 * (T10). Reported to the Drift Register.
 *
 * PRESERVED DEFECT PD-2 [main.coffee:L1109-L1110] -- when a role IS selected and
 * that role's point is unset, the incumbent dereferences a value that resolved
 * to nothing and raises a TypeError. It is left unguarded here on purpose: a
 * defensive fallback would be a behaviour change under T10, and a caller that
 * selects a role with no estimate is the reachable path to it. Reported to the
 * Drift Register; commented again at the exact line below.
 *
 * @param roles          the project's roles, filtered to the computable ones
 *                       internally.
 * @param points         the story's per-role points map.
 * @param pointsById     the project's point lookup.
 * @param selectedRoleId the role currently selected in this cell, or null when
 *                       none is. A string and a number are both legitimate --
 *                       see the declaration at
 *                       [app/react/backlog/state/types.ts:L649] -- and both
 *                       index the string-keyed points map correctly.
 * @param editable       whether the cell may be edited [main.coffee:L1115].
 */
export function selectPointsDisplay(
    roles: readonly ProjectRole[],
    points: UserStoryPoints,
    pointsById: PointsById,
    selectedRoleId: SelectedRoleId,
    editable: boolean,
): PointsDisplayData {
    // [main.coffee:L1082] and [:L1114] both call the role derivation; it is
    // called once here and shared, which changes nothing observable because the
    // function is pure.
    const computedRoles = calculateRoles(roles, points, pointsById);

    // [main.coffee:L1102]
    const totalPoints = calculateTotalPoints(points, pointsById);

    // [main.coffee:L1083] drives the click affordance, and [:L1087-L1089] drives
    // the preselection. Both are decided by the count of computable roles.
    const clickable = computedRoles.length > 0;
    const preselectedRoleId = computedRoles.length === 1 ? firstPointsMapRoleId(points) : null;

    const bareTotal: PointsDisplayData = {
        totalPoints,
        roleName: null,
        roles: computedRoles,
        editable,
        clickable,
        preselectedRoleId,
    };

    // [main.coffee:L1103] first disjunct: `not selectedRoleId?` -- an existence
    // test, so an absent selection behaves exactly as a null one. Testing for the
    // two types the selection can actually hold covers both, and narrows the
    // value for the lookup below.
    if (typeof selectedRoleId !== 'string' && typeof selectedRoleId !== 'number') {
        return bareTotal;
    }

    // [main.coffee:L1103] second disjunct -- PRESERVED BEHAVIOUR PD-1. One
    // computable role means the bare total, in spite of the selection.
    if (computedRoles.length === 1) {
        return bareTotal;
    }

    // [main.coffee:L1107-L1108] the same two-step resolution as the per-role
    // rows: the selected role id indexes the story's points map, and the points
    // id it yields indexes the point lookup.
    const point = resolvePoint(pointsById, points[selectedRoleId]);

    // PRESERVED DEFECT PD-2 [main.coffee:L1109-L1110] -- the incumbent reads the
    // name straight off that lookup with no existence check, so a selected role
    // whose point is unset raises a TypeError here. Preserved verbatim per T10:
    // the assertion below satisfies the compiler and changes nothing at run time,
    // so the throw happens exactly where and when the incumbent's did. Do NOT add
    // an existence check, an optional read or a fallback.
    const roleName = point!.name;

    // [main.coffee:L1109-L1110] the two halves the component composes: the point
    // name, then the total.
    return { ...bareTotal, roleName };
}

// ===========================================================================
// SECTION 5 -- SPRINTS
// ===========================================================================

/**
 * Builds the sort key the incumbent sorted open sprints by: whole seconds since
 * the epoch, AS A DECIMAL STRING.
 *
 * REPRODUCES the key expression at
 * [app/coffee/modules/backlog/lightboxes.coffee:L125], which parses the sprint's
 * finish date and formats it with the seconds-since-epoch token. That token
 * yields a STRING, and the string is what makes `getLastSprint` order
 * lexicographically -- see PRESERVED DEFECT LS-1 there.
 *
 * DERIVED HERE RATHER THAN DELEGATED, deliberately. The date library the
 * incumbent used is not part of the pinned dependency set this migration may add
 * to for new code, so the two behaviours that matter are reproduced explicitly:
 *
 *   1. LOCAL MIDNIGHT, NOT UTC MIDNIGHT. The incumbent's parse of a bare
 *      year-month-day value produces local midnight, whereas the language's own
 *      parse of that same bare form is specified to produce UTC midnight.
 *      Building the value from its parsed components, as below, gives local
 *      midnight. Getting this wrong shifts every key by the environment's offset
 *      -- harmless for keys of equal length, but able to flip a comparison for
 *      keys that straddle a change of digit count, which is exactly the
 *      comparison LS-1 turns on. Cited at [lightboxes.coffee:L125].
 *   2. TRUNCATION TOWARDS MINUS INFINITY. The seconds-since-epoch token floors
 *      the millisecond value, so a pre-epoch date yields a negative key with a
 *      leading sign -- which sorts before every digit. Floor, not truncation
 *      towards zero, and not rounding.
 *
 * THE TWO-DIGIT-YEAR CORRECTION is not decoration. Constructing a date from
 * numeric components maps a year between 0 and 99 into the twentieth century,
 * while the incumbent's parse treats those digits as the literal year, so
 * without the correction a year written with leading zeroes would key as its
 * nineteen-hundreds counterpart and could reorder sprints. The correction is
 * skipped for a value that did not parse at all, because the component setter is
 * specified to resurrect an unparseable date into a real one, which would turn a
 * degenerate key into a plausible-looking wrong one.
 *
 * OUT-OF-DOMAIN INPUT, recorded so the difference is traceable rather than
 * discovered: the declared type is a well-formed year-month-day string and the
 * REST payload always sends one, so this path is not reachable from the live API.
 * Should a malformed value ever arrive, this returns the language's
 * not-a-number spelling, whereas the incumbent's library would have returned its
 * own locale-dependent invalid-date wording. Both are degenerate keys that sort
 * consistently against themselves; reproducing the library's wording would mean
 * hardcoding an internal of a library this module deliberately does not depend
 * on. Reported to the Drift Register alongside LS-1.
 */
function unixSecondsSortKey(estimatedFinish: string): string {
    const parts = estimatedFinish.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);

    // Local midnight, from the components -- see point 1 above.
    const localMidnight = new Date(year, month - 1, day);

    if (year >= 0 && year <= 99 && !Number.isNaN(localMidnight.getTime())) {
        localMidnight.setFullYear(year);
    }

    // Point 2 above: floor to whole seconds, then spell the number in decimal --
    // which is precisely what the incumbent's formatting token produced.
    return String(Math.floor(localMidnight.getTime() / 1000));
}

/**
 * Picks the open sprint that sorts last by finish date -- the sprint the create
 * form starts the next one after.
 *
 * REPRODUCES `getLastSprint` at
 * [app/coffee/modules/backlog/lightboxes.coffee:L120-L127]: keep the sprints
 * that are not closed, sort them by their finish date, take the last.
 *
 * PRESERVED DEFECT LS-1 [lightboxes.coffee:L124-L125] -- THE SORT IS
 * LEXICOGRAPHIC, NOT CHRONOLOGICAL. The incumbent's key is a formatted STRING of
 * seconds since the epoch, and the sort compares those strings, so ordering
 * follows character order rather than magnitude. This is not a theoretical
 * quibble: seconds-since-epoch strings change length as the count crosses a
 * power of ten, and comparing different lengths character by character puts the
 * shorter one wherever its first character falls. Worked example, in an
 * environment at zero offset -- a sprint finishing on the first day of 1999 keys
 * as "915148800", nine characters, and a sprint finishing on the thirtieth of
 * May 2026 keys as "1780099200", ten characters; character order puts "1..."
 * before "9...", so the 2026 sprint sorts FIRST and this function returns the
 * 1999 one. That is the incumbent's behaviour and it is preserved under T10.
 * Comparing numerically, or sorting the raw date strings -- which would order
 * correctly and therefore differently -- would both be behaviour changes.
 * Reported to the Drift Register.
 *
 * The comparison below is a plain character comparison rather than a
 * locale-aware one, because a locale-aware collation would reorder the very
 * cases LS-1 depends on. The sort is stable, matching the stability of the
 * incumbent's sort, so sprints with equal keys keep their arrival order.
 *
 * NEITHER INPUT NOR ELEMENT IS MUTATED: the filter and the decoration each
 * produce a fresh array, and only the decorated copy is sorted.
 *
 * @param sprints the sprint list, closed ones included -- they are filtered out
 *                here. `closed` is the per-sprint BOOLEAN
 *                [app/react/shared/types/sprint.ts:L378]; do not confuse it with
 *                the identically named COUNT on the list envelope at
 *                [app/coffee/modules/resources/sprints.coffee:L40], which is
 *                parsed from a response header and is a number.
 * @returns the last open sprint in that lexicographic ordering, or nothing when
 *          there is no open sprint at all -- [lightboxes.coffee:L127] indexes one
 *          past the end of an empty list, which yields an absent value, and its
 *          caller at [:L156] tests exactly that. Never null, and never a throw.
 */
export function getLastSprint(sprints: readonly Sprint[]): Sprint | undefined {
    // [lightboxes.coffee:L121-L122] a truthiness negation on the sprint's own
    // closed flag.
    const openSprints = sprints.filter((sprint) => !sprint.closed);

    // Decorate with the key, so each key is built once per sprint rather than
    // once per comparison. [lightboxes.coffee:L124] does the same thing.
    const keyed = openSprints.map((sprint) => ({
        sprint,
        sortKey: unixSecondsSortKey(sprint.estimated_finish),
    }));

    // PRESERVED DEFECT LS-1, at the line that preserves it: character order on a
    // formatted string, ascending.
    keyed.sort((left, right) => {
        if (left.sortKey < right.sortKey) {
            return -1;
        }

        if (left.sortKey > right.sortKey) {
            return 1;
        }

        return 0;
    });

    // [lightboxes.coffee:L127] the last element -- guarded, because reading one
    // past the end of an empty list must yield an absent value here too rather
    // than raise.
    if (keyed.length === 0) {
        return undefined;
    }

    return keyed[keyed.length - 1].sprint;
}
