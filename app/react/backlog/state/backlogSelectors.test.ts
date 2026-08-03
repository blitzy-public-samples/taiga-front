/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Executable contract for `./backlogSelectors.ts`.
 *
 * WHAT THIS SPEC IS FOR
 * ---------------------
 * Not, primarily, to show that the selectors work. FIVE of the behaviours below are
 * PRE-EXISTING DEFECTS AND QUIRKS of the AngularJS screen that the migration rule forbidding
 * functional and feature change of every kind requires be REPRODUCED rather than repaired. A
 * defect that is deliberately preserved is indistinguishable from one that was accidentally
 * reintroduced -- or, worse, from one that a future contributor is about to "fix" -- unless
 * something asserts on it. So each one gets its own group, its own test, and a comment naming
 * the source line it comes from and what to do if the test ever starts failing:
 *
 *   DL-1  a story with no points at all poisons the doom-line running total to NaN, which
 *         suppresses the band for every story after it   [backlog/main.coffee:742]
 *   TP-1  the total-points reduce carries no seed; an earlier guard is the only thing that
 *         keeps it from throwing on an empty list        [common/estimation.coffee:179]
 *   PD-1  a project with exactly one computable role preselects that role for the click path
 *         and yet still displays the bare total          [backlog/main.coffee:1103 vs :1089]
 *   PD-2  the point of the selected role is dereferenced unguarded, so a role whose point is
 *         unset throws instead of degrading              [backlog/main.coffee:1108-1110]
 *   LS-1  the sprint ordering key is a decimal unix-seconds STRING, so ordering is
 *         lexicographic and a 1999 sprint beats a 2026 one  [backlog/lightboxes.coffee:124-125]
 *
 * The one non-defect assertion that matters just as much is the doom line's STRICT `>`
 * boundary: a running total that merely EQUALS the project total draws no band. Nothing else
 * in the codebase would notice `>` becoming `>=`, so the equal-and-exceeds pair below is what
 * stands between that edit and a silently misplaced band.
 *
 * The remaining groups pin the behaviour the incumbent screen has today: which guards return
 * nothing, that at most one band is ever drawn, that the running total is seeded from the
 * points already committed to sprints, that the rendered order is indexed exactly as given,
 * that the unestimated marker is the STRING `?` and never `0`, that role labels are point
 * NAMES, that the role list is derived without mutating its input, and that the points display
 * hands back structured data rather than the markup string the incumbent built by hand.
 *
 * HOW IT RUNS
 * -----------
 * Browserless by construction. Every unit under test is a pure function, so there is no
 * rendering, no timer, no injector and no transport here: the inputs are all hand-built
 * literals and the suite needs no browser binary, no built bundle and no network. Mock
 * clearing and restoring are configured centrally in `jest.config.js`, so neither is repeated
 * per test -- and nothing here installs a mock in the first place.
 */
import type { Sprint } from '../../shared/types/sprint';
import type { UserStory } from '../../shared/types/userStory';
import {
    calculateRoles,
    calculateTotalPoints,
    getLastSprint,
    selectDoomLineIndex,
    selectPointsDisplay,
} from './backlogSelectors';
import type { PointsDisplayData, RolePoints } from './backlogSelectors';
import type {
    BacklogUserStory,
    BurndownMilestone,
    PointsById,
    ProjectPoint,
    ProjectRole,
    ProjectStats,
    SelectedRoleId,
} from './types';

/* ==========================================================================
 * FIXTURES
 *
 * Every fixture is typed against the real model and built by spreading overrides over one
 * complete, valid base literal -- which is both the strict-mode answer and a readable record
 * of the shapes these selectors are handed. The builders accept an ABSENT value for a member
 * the model declares as present, because that is exactly what the preserved defects need and
 * exactly what a JSON response can deliver; no assertion or loosened type is involved.
 *
 * The one colour below is written in `rgb(...)` form. Status, tag and epic colours are
 * per-project database values, never design tokens, so no hex literal appears in this file
 * that could later be mistaken for one and hardcoded.
 * ========================================================================== */

function makeRole(overrides: Partial<ProjectRole> = {}): ProjectRole {
    return { id: 7, name: 'Back', computable: true, ...overrides };
}

/** The two computable roles of a project that estimates per role. */
const ROLE_BACK: ProjectRole = makeRole();
const ROLE_FRONT: ProjectRole = makeRole({ id: 8, name: 'Front' });

/** Present in the project, excluded from every estimation: `computable` is false. */
const ROLE_DESIGN: ProjectRole = makeRole({ id: 9, name: 'Design', computable: false });

function makePoint(overrides: Partial<ProjectPoint> = {}): ProjectPoint {
    return { id: 101, name: '1', value: 1, ...overrides };
}

/** The estimation scale. `?` is a real, selectable point whose value is null. */
const POINT_UNSET: ProjectPoint = makePoint({ id: 100, name: '?', value: null });
const POINT_ONE: ProjectPoint = makePoint();
const POINT_FORTY: ProjectPoint = makePoint({ id: 102, name: 'enormous', value: 40 });
const POINT_HALF: ProjectPoint = makePoint({ id: 103, name: 'half', value: 0.5 });

/**
 * A point whose name never arrived. The model declares the name as present, so ABSENT is the
 * spelling a fixture can express -- and the incumbent guard reads null and absent alike, so one
 * of the two is enough to pin the branch.
 */
const POINT_NAMELESS: ProjectPoint = makePoint({ id: 104, name: undefined, value: 5 });

/** An id no point in the scale carries, so it resolves to nothing. */
const UNKNOWN_POINT_ID = 9999;

function makePointsById(points: readonly ProjectPoint[]): PointsById {
    const byId: Record<number, ProjectPoint> = {};

    for (const point of points) {
        byId[point.id] = point;
    }

    return byId;
}

const POINTS_BY_ID: PointsById = makePointsById([
    POINT_UNSET,
    POINT_ONE,
    POINT_FORTY,
    POINT_HALF,
    POINT_NAMELESS,
]);

/**
 * One burndown row. The hyphenated members are the wire spelling and are quoted rather than
 * renamed, which is the same reason the model quotes them.
 */
const MILESTONE: BurndownMilestone = {
    name: 'Sprint 1',
    optimal: 100,
    evolution: null,
    'team-increment': 0,
    'client-increment': 0,
};

function makeStats(overrides: Partial<ProjectStats> = {}): ProjectStats {
    const base: ProjectStats = {
        assigned_points: 0,
        closed_points: 0,
        completedPercentage: 0,
        defined_points: 0,
        milestones: [MILESTONE],
        speed: 0,
        total_milestones: 1,
        total_points: 10,
    };

    return { ...base, ...overrides };
}

/**
 * A backlog row. `sprint_order` is deliberately absent: it is optional on the backlog model
 * precisely because a story that belongs to no sprint does not have one.
 */
function makeUs(overrides: Partial<BacklogUserStory> = {}): BacklogUserStory {
    const base: BacklogUserStory = {
        id: 4242,
        ref: 12,
        subject: 'Support for bulk actions',
        status: 1,
        swimlane: null,
        milestone: null,
        project: 1,
        is_blocked: false,
        blocked_note: '',
        is_closed: false,
        due_date: null,
        total_points: 1,
        points: { 7: POINT_ONE.id, 8: null },
        tags: [['bug', 'rgb(1, 2, 3)']],
        epics: null,
        assigned_users: [],
        assigned_to: null,
        kanban_order: 1,
        backlog_order: 1,
        total_attachments: 0,
        total_comments: 0,
        attachments: [],
        tasks: [],
        watchers: [],
        version: 3,
    };

    return { ...base, ...overrides };
}

/**
 * A sprint. `estimated_start` and `estimated_finish` are `YYYY-MM-DD` strings, never dates,
 * and `closed` is this sprint's own boolean flag -- see the note on the `getLastSprint` group.
 */
function makeSprint(overrides: Partial<Sprint> = {}): Sprint {
    const base: Sprint = {
        id: 1,
        name: 'Sprint 1',
        slug: 'sprint-1',
        owner: null,
        project: 1,
        closed: false,
        disponibility: null,
        order: 1,
        created_date: '2026-05-01T09:00:00+0000',
        modified_date: '2026-05-01T09:00:00+0000',
        closed_points: null,
        total_points: null,
        estimated_start: '2026-05-15',
        estimated_finish: '2026-05-30',
        user_stories: [],
    };

    return { ...base, ...overrides };
}

/**
 * The ordering key `getLastSprint` sorts on, recomputed here from LOCAL midnight exactly as
 * the selector derives it, so the expectations below hold in every timezone rather than only
 * in the one this suite happens to run in.
 */
function localMidnightUnixSecondsKey(estimatedFinish: string): string {
    const [year, month, day] = estimatedFinish.split('-').map(Number);

    return String(Math.floor(new Date(year, month - 1, day).getTime() / 1000));
}

/** Asserts that nothing the points display hands back is markup rather than data. */
function expectNoMarkup(display: PointsDisplayData): void {
    const serialised = JSON.stringify(display);

    expect(serialised).not.toContain('<span');
    expect(serialised).not.toContain('</span');
    expect(serialised).not.toContain('<');
}

/* ==========================================================================
 * THE DOOM LINE
 * ========================================================================== */

/**
 * Reproduces `reloadDoomLine` [app/coffee/modules/backlog/main.coffee:727-748], which walks the
 * rendered backlog accumulating points from the total already committed to sprints and marks
 * the first row that takes the project past its own total.
 */
describe('selectDoomLineIndex', () => {
    describe('the guards that draw no band at all', () => {
        it('returns nothing when the project has no stats yet', () => {
            // :732 `$scope.stats?` -- the band is redrawn on a stats watch, so it is asked for
            // before the first stats response has arrived.
            expect(selectDoomLineIndex(null, [makeUs({ total_points: 999 })])).toBeNull();
            expect(selectDoomLineIndex(undefined, [makeUs({ total_points: 999 })])).toBeNull();
        });

        it('returns nothing when the project total is unknown', () => {
            // :732 `$scope.stats.total_points?`
            const stats = makeStats({ total_points: null });

            expect(selectDoomLineIndex(stats, [makeUs({ total_points: 999 })])).toBeNull();
        });

        it('returns nothing when the project total is zero', () => {
            // :732 `!= 0`. A project estimated at nothing would put EVERY row beyond scope, and
            // the incumbent draws no band rather than one above the first row.
            const stats = makeStats({ total_points: 0 });

            expect(selectDoomLineIndex(stats, [makeUs({ total_points: 999 })])).toBeNull();
        });

        it('returns nothing when there are no stories', () => {
            // :739 `return if not $scope.userstories` -- absent before the first page loads, and
            // empty for a project whose backlog is empty or fully filtered out.
            expect(selectDoomLineIndex(makeStats(), null)).toBeNull();
            expect(selectDoomLineIndex(makeStats(), undefined)).toBeNull();
            expect(selectDoomLineIndex(makeStats(), [])).toBeNull();
        });
    });

    describe('the threshold', () => {
        it('draws no band when the running total only EQUALS the project total', () => {
            // ⭐ STRICT `>` [:744]. Exactly filling the project is not overflowing it. Nothing
            // else would notice `>` silently becoming `>=`, which is why this pairs with the
            // test below rather than standing alone.
            const stats = makeStats({ assigned_points: 0, total_points: 10 });

            expect(selectDoomLineIndex(stats, [makeUs({ total_points: 10 })])).toBeNull();
        });

        it('draws the band on the story that takes the running total PAST the project total', () => {
            const stats = makeStats({ assigned_points: 0, total_points: 10 });

            expect(selectDoomLineIndex(stats, [makeUs({ total_points: 11 })])).toBe(0);
        });

        it('returns one index only, the earliest that qualifies', () => {
            // :748 `break`. Three of these four rows individually exceed the remaining scope;
            // the incumbent marks the first and stops, so the answer is a single position.
            const stats = makeStats({ assigned_points: 0, total_points: 10 });
            const stories = [
                makeUs({ id: 1, total_points: 4 }),
                makeUs({ id: 2, total_points: 20 }),
                makeUs({ id: 3, total_points: 30 }),
                makeUs({ id: 4, total_points: 40 }),
            ];

            const index = selectDoomLineIndex(stats, stories);

            expect(index).toBe(1);
            expect(typeof index).toBe('number');
        });

        it('returns nothing when the whole backlog fits inside the project total', () => {
            const stats = makeStats({ assigned_points: 2, total_points: 10 });
            const stories = [
                makeUs({ id: 1, total_points: 3 }),
                makeUs({ id: 2, total_points: 3 }),
                makeUs({ id: 3, total_points: 2 }),
            ];

            expect(selectDoomLineIndex(stats, stories)).toBeNull();
        });
    });

    describe('the running total', () => {
        it('starts from the points already committed to sprints', () => {
            // :737 `current_sum = stats.assigned_points`. Two points of work crosses a total of
            // ten only because nine are already committed.
            const stats = makeStats({ assigned_points: 9, total_points: 10 });

            expect(selectDoomLineIndex(stats, [makeUs({ total_points: 2 })])).toBe(0);
        });

        it('is the only reason that story crosses at all: from zero it does not', () => {
            const stats = makeStats({ assigned_points: 0, total_points: 10 });

            expect(selectDoomLineIndex(stats, [makeUs({ total_points: 2 })])).toBeNull();
        });
    });

    describe('ordering', () => {
        it('indexes the collection exactly as given and never re-sorts it', () => {
            // :741 iterates the RENDERED collection, which the loader already sorted by
            // `backlog_order` [:377]. Sorting again here would return a position that does not
            // match the row the band has to be drawn above. The first element carries the LATER
            // `backlog_order`, so a re-sort would answer 1 instead of 0.
            const stats = makeStats({ assigned_points: 0, total_points: 10 });
            const asRendered = [
                makeUs({ id: 1, backlog_order: 5, total_points: 20 }),
                makeUs({ id: 2, backlog_order: 1, total_points: 1 }),
            ];

            expect(selectDoomLineIndex(stats, asRendered)).toBe(0);
        });
    });

    describe('PRESERVED DEFECT DL-1', () => {
        it('suppresses the band for the rest of the backlog once a story has no points at all', () => {
            // LOCKS PRESERVED DEFECT DL-1 [backlog/main.coffee:742] -- nullish total_points
            // poisons the sum to NaN and suppresses the band for the rest of the list.
            // Preserved per T10. If this test starts failing, someone added coalescing --
            // revert it.
            const stats = makeStats({ assigned_points: 0, total_points: 10 });
            const stories = [
                makeUs({ id: 1, total_points: undefined }),
                makeUs({ id: 2, total_points: 999 }),
            ];

            expect(selectDoomLineIndex(stats, stories)).toBeNull();
        });

        it('suppresses the band from the very first story when the committed total is absent', () => {
            // The same poisoning one step earlier, at the seed [backlog/main.coffee:737].
            const stats = makeStats({ assigned_points: undefined, total_points: 10 });

            expect(selectDoomLineIndex(stats, [makeUs({ total_points: 999 })])).toBeNull();
        });

        it('is asymmetric: an explicit null counts as zero, an absent value poisons the sum', () => {
            // The subtlest half of DL-1, and the reason it survived: adding null yields the
            // running total unchanged, so an unestimated story merely contributes nothing --
            // while adding an ABSENT value yields NaN and every later comparison is false.
            const stats = makeStats({ assigned_points: 0, total_points: 10 });
            const withNull = [
                makeUs({ id: 1, total_points: null }),
                makeUs({ id: 2, total_points: 11 }),
            ];
            const withAbsent = [
                makeUs({ id: 1, total_points: undefined }),
                makeUs({ id: 2, total_points: 11 }),
            ];

            expect(selectDoomLineIndex(stats, withNull)).toBe(1);
            expect(selectDoomLineIndex(stats, withAbsent)).toBeNull();
        });
    });
});

/* ==========================================================================
 * TOTAL POINTS
 * ========================================================================== */

/**
 * Reproduces `calculateTotalPoints` [app/coffee/modules/common/estimation.coffee:169-179], which
 * resolves each of a story's role points through the project scale and sums the ones that carry
 * a value.
 */
describe('calculateTotalPoints', () => {
    it('returns the unestimated TOKEN, a string, when the story carries no role points', () => {
        // :172-173. The distinction matters twice over: a numeric zero would read as "estimated
        // at nothing" in the row, and it would also be summed into the doom line above as real
        // committed work.
        const total = calculateTotalPoints({}, POINTS_BY_ID);

        expect(total).toBe('?');
        expect(typeof total).toBe('string');
    });

    it('returns the token when every role point resolves to a point with no value', () => {
        // :176-177. `?` is a selectable point of the scale whose value is null, so this is the
        // ordinary state of a story nobody has estimated yet.
        const total = calculateTotalPoints({ 7: POINT_UNSET.id, 8: POINT_UNSET.id }, POINTS_BY_ID);

        expect(total).toBe('?');
        expect(typeof total).toBe('string');
    });

    it('returns the token when no role point resolves to a known point at all', () => {
        // A point deleted from the scale leaves stories referring to an id that resolves to
        // nothing; :175 drops it exactly as it drops a null value.
        expect(calculateTotalPoints({ 7: UNKNOWN_POINT_ID, 8: null }, POINTS_BY_ID)).toBe('?');
    });

    it('sums only the role points that resolve to a value', () => {
        // :175 then :179 -- one valued point, one valued point, one unvalued point, one id that
        // resolves to nothing and one unset role: the answer is the two values.
        const points: UserStory['points'] = {
            7: POINT_ONE.id,
            8: POINT_FORTY.id,
            9: POINT_UNSET.id,
            10: UNKNOWN_POINT_ID,
            11: null,
        };

        expect(calculateTotalPoints(points, POINTS_BY_ID)).toBe(41);
    });

    it('sums fractional values exactly', () => {
        // Non-integer estimates are real -- the incumbent summary bar renders totals such as
        // `392.5 defined points` -- and both operands here are exactly representable.
        expect(calculateTotalPoints({ 7: POINT_HALF.id, 8: POINT_ONE.id }, POINTS_BY_ID)).toBe(1.5);
    });

    describe('PRESERVED DEFECT TP-1', () => {
        it('returns a lone value as itself, because the reduce carries no seed', () => {
            // LOCKS PRESERVED DEFECT TP-1 [common/estimation.coffee:179] -- the reduce is
            // seedless; the :176-177 empty guard is what prevents it throwing. Do NOT add a 0
            // seed (T10).
            expect(calculateTotalPoints({ 7: POINT_FORTY.id }, POINTS_BY_ID)).toBe(40);
        });

        it('never reaches that reduce when nothing resolves, which is what keeps it safe', () => {
            // The other half of TP-1: a seedless reduce over an empty list throws, so the guard
            // is load-bearing rather than defensive. Both empty shapes short-circuit above it.
            expect(() => calculateTotalPoints({}, POINTS_BY_ID)).not.toThrow();
            expect(() => calculateTotalPoints({ 7: POINT_UNSET.id }, POINTS_BY_ID)).not.toThrow();
            expect(calculateTotalPoints({ 7: POINT_UNSET.id }, POINTS_BY_ID)).toBe('?');
        });
    });
});

/* ==========================================================================
 * ROLE LABELS
 * ========================================================================== */

/**
 * Reproduces `calculateRoles` [app/coffee/modules/common/estimation.coffee:181-190], which turns
 * the project's computable roles into the per-role labels the points selector lists.
 */
describe('calculateRoles', () => {
    it('excludes the roles that are not computable', () => {
        // :182 `_.filter(project.roles, "computable")` is a truthiness test, and the excluded
        // role here has a perfectly resolvable point -- it is dropped for being uncomputable,
        // not for being unestimated.
        const points: UserStory['points'] = { 7: POINT_ONE.id, 9: POINT_FORTY.id };

        const result = calculateRoles([ROLE_BACK, ROLE_DESIGN], points, POINTS_BY_ID);

        const expected: readonly RolePoints[] = [{ ...ROLE_BACK, points: POINT_ONE.name }];

        expect(result).toEqual(expected);
    });

    it('labels a resolved role with the point NAME rather than its value', () => {
        // :187 reads `pointObj.name`, so the label is a string from the scale -- `enormous`
        // here, worth 40 -- and never the number that is summed into the total.
        const result = calculateRoles([ROLE_FRONT], { 8: POINT_FORTY.id }, POINTS_BY_ID);

        expect(result[0].points).toBe('enormous');
        expect(typeof result[0].points).toBe('string');
    });

    it('falls back to the token when the role has no point set', () => {
        const result = calculateRoles([ROLE_BACK], { 7: null }, POINTS_BY_ID);

        expect(result[0].points).toBe('?');
    });

    it('falls back to the token when the point id resolves to nothing', () => {
        const result = calculateRoles([ROLE_BACK], { 7: UNKNOWN_POINT_ID }, POINTS_BY_ID);

        expect(result[0].points).toBe('?');
    });

    it('falls back to the token when the resolved point has no name', () => {
        // :187 guards BOTH `pointObj?` AND `pointObj.name?`, so a point that resolves but
        // carries no name takes the fallback too -- which is why the guard is two conditions
        // rather than one.
        const result = calculateRoles([ROLE_BACK], { 7: POINT_NAMELESS.id }, POINTS_BY_ID);

        expect(result[0].points).toBe('?');
    });

    it('leaves the roles it was given untouched and hands back new objects', () => {
        // :186 deep-clones each role before writing the label onto it. The clone is what keeps
        // the project's own role list free of a per-story member, so the same roles can be
        // labelled for every row of the backlog.
        const role = makeRole();
        const pristine = { id: 7, name: 'Back', computable: true };

        const result = calculateRoles([role], { 7: POINT_ONE.id }, POINTS_BY_ID);

        expect(role).toEqual(pristine);
        expect(result[0]).not.toBe(role);
        expect(result[0]).toEqual({ ...pristine, points: POINT_ONE.name });
    });

    it('returns nothing when the project has no roles', () => {
        // The consumer reads this emptiness as "the total is not clickable" -- see the points
        // display group below.
        expect(calculateRoles([], { 7: POINT_ONE.id }, POINTS_BY_ID)).toHaveLength(0);
    });
});

/* ==========================================================================
 * THE POINTS DISPLAY
 * ========================================================================== */

/**
 * Reproduces the render derivation of `tgBacklogUsPoints`
 * [app/coffee/modules/backlog/main.coffee:1082-1118], which decides what a backlog row shows in
 * its points cell, whether that cell can be clicked, and which role a click starts from.
 *
 * The incumbent built an HTML STRING for the two-part case [:1109]. This derivation hands back
 * the parts instead, so the row composes them as elements -- see the structured-data test.
 */
describe('selectPointsDisplay', () => {
    /** A project that estimates per role, and a story estimated for both of them. */
    const TWO_ROLES: readonly ProjectRole[] = [ROLE_BACK, ROLE_FRONT];
    const BOTH_ROLES_SET: UserStory['points'] = { 7: POINT_ONE.id, 8: POINT_FORTY.id };

    describe('the bare total', () => {
        it('is what a row shows while no role is selected', () => {
            // :1103-1105 `if not selectedRoleId?` -- the cell opens showing the sum of every
            // role, and only a click narrows it to one.
            const display = selectPointsDisplay(TWO_ROLES, BOTH_ROLES_SET, POINTS_BY_ID, null, true);

            expect(display.totalPoints).toBe(41);
            expect(display.roleName).toBeNull();
        });

        it('carries the per-role labels the roles selector lists', () => {
            // :1114 `roles: @calculateRoles()` travels with every render, because the popover
            // that opens on a click is built from it.
            const display = selectPointsDisplay(TWO_ROLES, BOTH_ROLES_SET, POINTS_BY_ID, null, true);

            expect(display.roles).toEqual([
                { ...ROLE_BACK, points: POINT_ONE.name },
                { ...ROLE_FRONT, points: POINT_FORTY.name },
            ]);
        });
    });

    describe('PRESERVED BEHAVIOUR PD-1', () => {
        it('shows the bare total with one computable role even though that role IS preselected', () => {
            // LOCKS PRESERVED BEHAVIOUR PD-1 [backlog/main.coffee:1103 vs :1089] -- one
            // computable role preselects the role for the click path (:1139-1140) but the
            // DISPLAY stays the bare total. Do NOT "fix" this (T10).
            const display = selectPointsDisplay([ROLE_BACK], { 7: POINT_ONE.id }, POINTS_BY_ID, '7', true);

            expect(display.roleName).toBeNull();
            expect(display.totalPoints).toBe(1);
            expect(display.preselectedRoleId).toBe('7');
        });

        it('preselects nothing when the story of that single role carries no points map', () => {
            // :1089 reads the FIRST KEY OF THE STORY POINTS, not the role id, so a story with no
            // role points has nothing to preselect and the click opens the roles selector.
            const display = selectPointsDisplay([ROLE_BACK], {}, POINTS_BY_ID, null, true);

            expect(display.preselectedRoleId).toBeNull();
            expect(display.totalPoints).toBe('?');
        });

        it('preselects nothing once the project has two or more computable roles', () => {
            const display = selectPointsDisplay(TWO_ROLES, BOTH_ROLES_SET, POINTS_BY_ID, null, true);

            expect(display.preselectedRoleId).toBeNull();
        });
    });

    describe('the two-part display', () => {
        it('exposes the point of the selected role alongside the total, once there are two roles or more', () => {
            // :1107-1110. The named part is the POINT of the selected role -- `pointObj.name`,
            // `enormous` here -- and NOT the role's own name, which the cell never shows.
            const display = selectPointsDisplay(TWO_ROLES, BOTH_ROLES_SET, POINTS_BY_ID, 8, true);

            expect(display.roleName).toBe(POINT_FORTY.name);
            expect(display.totalPoints).toBe(41);
        });

        it('returns structured data, never markup', () => {
            // ⭐ The incumbent interpolated `"#{pointObj.name} / <span>#{totalPoints}</span>"`
            // at :1109 and assigned it as HTML. Reintroducing that string here would force the
            // row to render raw HTML, so the two parts stay separate members and this assertion
            // is what keeps them that way.
            const display = selectPointsDisplay(TWO_ROLES, BOTH_ROLES_SET, POINTS_BY_ID, 8, true);

            expectNoMarkup(display);
        });
    });

    describe('PRESERVED DEFECT PD-2', () => {
        it('throws when the selected role has no point set', () => {
            // LOCKS PRESERVED DEFECT PD-2 [backlog/main.coffee:1108-1110] -- pointObj is
            // unguarded, so an unset point on the selected role throws TypeError. Preserved per
            // T10; if this test starts failing, someone added a guard -- revert it.
            //
            // Only the class is asserted, never the message: the wording of a property-access
            // TypeError differs between runtime major versions and would make this brittle.
            const points: UserStory['points'] = { 7: POINT_ONE.id, 8: null };

            expect(() => selectPointsDisplay(TWO_ROLES, points, POINTS_BY_ID, 8, true)).toThrow(TypeError);
        });

        it('throws when the point of the selected role resolves to nothing', () => {
            // The same unguarded dereference reached the other way: a point id no longer in the
            // project scale.
            const points: UserStory['points'] = { 7: POINT_ONE.id, 8: UNKNOWN_POINT_ID };

            expect(() => selectPointsDisplay(TWO_ROLES, points, POINTS_BY_ID, 8, true)).toThrow(TypeError);
        });
    });

    describe('the selected role id', () => {
        function displayForSelectedRole(selectedRoleId: SelectedRoleId): PointsDisplayData {
            return selectPointsDisplay(TWO_ROLES, BOTH_ROLES_SET, POINTS_BY_ID, selectedRoleId, true);
        }

        it('resolves an id that arrives as a string, which is what the preselection produces', () => {
            // :1089 takes it from the keys of the points map, and object keys are strings.
            expect(displayForSelectedRole('8').roleName).toBe(POINT_FORTY.name);
        });

        it('resolves an id that arrives as a number, which is what a click produces', () => {
            // :1149 takes it from a data attribute, which arrives already coerced to a number.
            // Both spellings have to resolve, because both reach the same render.
            expect(displayForSelectedRole(8).roleName).toBe(POINT_FORTY.name);
        });
    });

    describe('the clickable state', () => {
        it('is not clickable when the project has no computable role', () => {
            // :1083-1085 removes the arrow icon and marks the cell not clickable. Only the
            // decision is asserted here; applying the class belongs to the row component, whose
            // own spec covers it.
            const display = selectPointsDisplay([ROLE_DESIGN], { 9: POINT_ONE.id }, POINTS_BY_ID, null, true);

            expect(display.clickable).toBe(false);
            expect(display.roles).toHaveLength(0);
        });

        it('is clickable as soon as one role is computable', () => {
            const display = selectPointsDisplay([ROLE_BACK], { 7: POINT_ONE.id }, POINTS_BY_ID, null, true);

            expect(display.clickable).toBe(true);
        });
    });

    describe('the editable flag', () => {
        it('passes straight through, unchanged in both directions', () => {
            // :1115 `editable: @isEditable`. The derivation neither computes nor overrides it --
            // the permission decision is made before it is called.
            const editable = selectPointsDisplay(TWO_ROLES, BOTH_ROLES_SET, POINTS_BY_ID, null, true);
            const readOnly = selectPointsDisplay(TWO_ROLES, BOTH_ROLES_SET, POINTS_BY_ID, null, false);

            expect(editable.editable).toBe(true);
            expect(readOnly.editable).toBe(false);
        });
    });
});

/* ==========================================================================
 * THE LAST SPRINT
 * ========================================================================== */

/**
 * Reproduces `getLastSprint` [app/coffee/modules/backlog/lightboxes.coffee:120-127], which the
 * sprint form uses to offer the name and dates of the sprint that finishes last.
 *
 * NOTE ON `closed`: the boolean filtered here [:121-122] is the SPRINT's own flag. The sprint
 * LIST envelope carries an unrelated member of the same name -- a COUNT parsed from the
 * `Taiga-Info-Total-Closed-Milestones` header
 * [app/coffee/modules/resources/sprints.coffee:41] -- so feeding an envelope value into this
 * filter would discard every sprint or none of them, silently.
 */
describe('getLastSprint', () => {
    it('returns nothing when there are no sprints', () => {
        // :127 indexes position -1 of an empty list, which is absent rather than null. A caller
        // that checks for null instead would read the absence as a real sprint.
        expect(getLastSprint([])).toBeUndefined();
    });

    it('returns nothing when every sprint is closed', () => {
        const sprints = [
            makeSprint({ id: 1, closed: true }),
            makeSprint({ id: 2, closed: true, estimated_finish: '2030-01-01' }),
        ];

        expect(getLastSprint(sprints)).toBeUndefined();
    });

    it('ignores closed sprints even when one of them finishes last of all', () => {
        const open = makeSprint({ id: 1, name: 'Open', estimated_finish: '2026-05-30' });
        const closedLater = makeSprint({ id: 2, name: 'Closed', closed: true, estimated_finish: '2030-01-01' });

        expect(getLastSprint([closedLater, open])).toBe(open);
    });

    it('returns the only open sprint there is', () => {
        const only = makeSprint();

        expect(getLastSprint([only])).toBe(only);
    });

    it('keeps the given order when two open sprints finish on the same day', () => {
        // Equal keys compare equal, and the sort is stable, so the later of the two in the
        // rendered order is the one offered.
        const first = makeSprint({ id: 1, estimated_finish: '2026-05-30' });
        const second = makeSprint({ id: 2, estimated_finish: '2026-05-30' });

        expect(getLastSprint([first, second])).toBe(second);
    });

    describe('PRESERVED DEFECT LS-1', () => {
        it('prefers a 1999 sprint over a 2026 one, whichever order they arrive in', () => {
            // LOCKS PRESERVED DEFECT LS-1 [backlog/lightboxes.coffee:124-125] -- the sort key is
            // a decimal unix-seconds STRING, so ordering is lexicographic, not chronological. A
            // 1999 sprint therefore beats a 2026 sprint. Preserved per T10; if this test starts
            // failing, someone made the comparison numeric -- revert it.
            //
            // A chronologically-correct implementation FAILS this test. That is the point.
            const ancient = makeSprint({
                id: 1,
                name: 'Ancient',
                estimated_start: '1998-12-01',
                estimated_finish: '1999-01-01',
            });
            const current = makeSprint({
                id: 2,
                name: 'Current',
                estimated_start: '2026-05-15',
                estimated_finish: '2026-05-30',
            });

            expect(getLastSprint([ancient, current])).toBe(ancient);
            expect(getLastSprint([current, ancient])).toBe(ancient);
        });

        it('orders chronologically while both keys have the same number of digits', () => {
            // Why LS-1 went unnoticed: every sprint of this decade produces a ten-digit key, so
            // the lexicographic order and the calendar order agree until a date crosses a
            // digit-count boundary.
            const earlier = makeSprint({ id: 1, estimated_finish: '2024-01-01' });
            const later = makeSprint({ id: 2, estimated_finish: '2026-05-30' });

            expect(getLastSprint([later, earlier])).toBe(later);
        });

        it('derives the key from LOCAL midnight, which is what keeps the digit boundary stable', () => {
            // The incumbent formats the finish date through its date library with `format('X')`
            // after parsing it as `YYYY-MM-DD`, which is a LOCAL-time parse -- unlike
            // `Date.parse` of a bare date string, which is UTC. The keys are recomputed here
            // with the same local-midnight arithmetic, so the digit counts and the comparison
            // below hold wherever this suite runs rather than only at UTC.
            const ancientKey = localMidnightUnixSecondsKey('1999-01-01');
            const currentKey = localMidnightUnixSecondsKey('2026-05-30');

            expect(ancientKey).toHaveLength(9);
            expect(currentKey).toHaveLength(10);
            expect(currentKey < ancientKey).toBe(true);

            const ancient = makeSprint({ id: 1, estimated_finish: '1999-01-01' });
            const current = makeSprint({ id: 2, estimated_finish: '2026-05-30' });

            expect(getLastSprint([ancient, current])).toBe(ancient);
        });
    });

    it('does not shift a year below one hundred into the twentieth century', () => {
        // The incumbent parses the year as written, so a two-digit year stays in the first
        // century and sorts before everything. Reading it as 1999 instead would make this
        // sprint the one offered, because a nine-digit key beats a ten-digit one lexicographically.
        const firstCentury = makeSprint({ id: 1, estimated_finish: '0099-12-31' });
        const current = makeSprint({ id: 2, estimated_finish: '2026-05-30' });

        expect(getLastSprint([firstCentury, current])).toBe(current);
    });
});

