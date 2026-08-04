/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for `boardSelectors.ts` -- the four derived views the incumbent
 * published onto the controller scope, plus the board's empty-state gate.
 *
 * WHAT IT PINS, AND WHY EACH ONE IS WORTH A SUITE OF ITS OWN. Four properties of
 * these derivations are individually invisible and collectively fatal, and every
 * one of them fails silently: no exception, no failing request, nothing in the
 * console.
 *
 *   1. THE KEY-TYPE ASYMMETRY. The flat grouping is STRING-keyed, the swimlane
 *      grouping is NUMERIC-keyed at both levels, and the card map is NUMERIC-keyed.
 *      Proved by one if/else in `moveUsToTop`
 *      [app/coffee/modules/kanban/main.coffee:L172-L178], which reads
 *      `[us.swimlane, us.status]` on the swimlane branch and
 *      `us.status.toString()` on the flat one. Collapse them onto one convention
 *      and every column renders empty, because a lookup with the wrong key simply
 *      misses.
 *   2. THE SYNTHETIC SWIMLANE'S CONDITIONAL PREPEND. It joins the rendered list
 *      only when some story belongs to no swimlane
 *      [app/coffee/modules/kanban/kanban-usertories.coffee:L284-L300]. Prepend it
 *      unconditionally and an empty swimlane sits at the top of every board;
 *      forget it and the unclassified cards disappear.
 *   3. FLAT MODE IS ABSENT, NOT EMPTY. `refreshSwimlanes` returns before touching
 *      either swimlane structure when the project has no swimlanes [:L278-L279],
 *      so on a flat board they are never populated at all. Confuse "absent" with
 *      "empty" and the board renders both layouts or neither.
 *   4. THE STORY-LESS STATUS. The incumbent reported that column's size as
 *      undefined; the React selector reports zero. That normalisation is
 *      deliberate and is reasoned out on `selectColumnCards`, so the tests below
 *      state it explicitly -- a reader who thinks it accidental will "restore" the
 *      undefined and break the column components' prop types.
 *
 * HOW THE EXPECTATIONS WERE OBTAINED (T6). Behaviour follows the AngularJS
 * implementation, so every non-obvious expected value is hand-derived from the
 * CoffeeScript it reproduces and carries a `[path:locator]` comment. Locators are
 * the ORIGINAL pre-migration line numbers, which is the numbering the migration
 * plan and `boardSelectors.ts` both use; those sources gained explanatory comments
 * during this migration, so their current line numbers sit lower down the file.
 *
 * NO TEST HERE ASSERTS AN IMPROVEMENT (T10, Minimal Change Clause). The suites
 * encode the incumbent's quirks as requirements: the three FALSY swimlane guards,
 * remove-then-append de-duplication, sorting before grouping rather than after,
 * a resolved assignee list that may be SHORTER than the id list it came from, and
 * a fold flag that stays undefined instead of defaulting to false. A test that
 * encoded an enhancement would be worse than no test, because it would force a
 * future agent to break shipped behaviour to make it pass.
 *
 * TECHNOLOGY SEAMS UNDER TEST (T9):
 *   - THE PERSISTENT-COLLECTION LIBRARY IS GONE. The incumbent held these four
 *     structures in the persistent collections it built at
 *     [kanban-usertories.coffee:L272/L281-L282/L315-L317] and read them with a
 *     nested two-key accessor and with each collection's own length property.
 *     React sees plain objects and plain arrays, flattened at the
 *     `react-bridge.coffee` seam, so every fixture below is a plain object, every
 *     nested read is spelled as two ordinary lookups, and every length is a plain
 *     array `length`. That library is not named anywhere in this folder, and this
 *     file adds no reference to it (I5).
 *   - PERSISTENT-COLLECTION STRUCTURAL SHARING -> `immer`. Fixtures are built through
 *     `produce`, which is how the board composes its reducer, so they arrive
 *     DEEP-FROZEN exactly as production state does (P-IMMER-4, auto-freezing on).
 *     That is the only mechanism that catches a selector sorting its input in
 *     place: a frozen array's `sort` throws at run time and no type check finds
 *     it.
 *   - `insert(0, entry)` -> `[synthetic, ...rest]`. The prepend at
 *     [kanban-usertories.coffee:L300] uses a persistent-list method that has NO
 *     array counterpart, and `unshift` is not a substitute because it mutates a
 *     frozen input.
 *   - The DOUBLY DEAD guard at [kanban-usertories.coffee:L287-L290] is asserted
 *     through its NET behaviour only. Its filter runs over a list emptied two
 *     statements earlier at [:L281], so its length is always zero, and the
 *     predicate it applies could not have matched even on a populated list. The
 *     tests state the reduced rule -- "at least one unclassified story" -- so that
 *     nobody resurrects the guard from the source.
 *   - `usStatusList` ORDERING IS NOT UNIFIED. The board sorts the project's
 *     statuses by their `order` field
 *     [app/coffee/modules/kanban/main.coffee:L576]; the backlog screen sorts the
 *     SAME project collection by `id` [app/coffee/modules/backlog/main.coffee:L482].
 *     Two orderings of one collection, both shipped, and the selectors re-sort
 *     neither.
 *
 * A RUN-TIME CAVEAT ON SUITE 1, STATED SO THE SUITE IS NOT MISREAD. Property keys
 * are strings in this language, so `bucket[1]` and `bucket['1']` reach the same
 * property and `Record<number, T>` versus `Record<string, T>` is erased once
 * compiled. These tests therefore pin the LOOKUP IDIOM -- which spelling each
 * consumer must use, asserted visibly in the assertion text -- rather than a
 * run-time type. That is what the templates depend on, and it is why the
 * expectations are written out in full: a stored snapshot would hide the very
 * thing this file exists to make legible.
 *
 * BROWSERLESS BY CONSTRUCTION (HR-5, I9). The units under test are plain
 * functions, so this file renders nothing, imports no React and no testing
 * library, touches no network, and refers to no build output. It runs in the jsdom
 * environment `jest.config.js` configures, with no browser binary present.
 *
 * OWNERSHIP SPLIT, so nothing is covered twice. Reducer behaviour -- the
 * order-map arithmetic, fold hydration, zoom thresholds -- belongs to
 * `./boardReducer.test.ts`. Viewport latching belongs to
 * `../../shared/useInViewport.test.ts`; the neighbour arithmetic that decides
 * which card is the drop anchor to `../../shared/dnd/useSortableList.test.ts`;
 * request bodies to `../../shared/api/userstories.test.ts`; fold persistence to
 * `../../shared/api/kanbanStorage.test.ts`; the limit-marker ladder to
 * `../WipLimitMarker.test.tsx`. Class names and markup belong to the components.
 * The backlog's drag-serialisation queue has no counterpart on this screen at all.
 */
import { produce } from 'immer';

import { UNCLASSIFIED_SWIMLANE_ID } from './boardReducer';
import {
    selectColumnCards,
    selectFlatStatuses,
    selectHasSwimlanes,
    selectHeaderStatuses,
    selectIsStatusFolded,
    selectIsStatusUnfolded,
    selectIsSwimlaneFolded,
    selectIsUsInArchivedHiddenStatus,
    selectIsUsMoved,
    selectIsUsSelected,
    selectShowPlaceholder,
    selectSwimlaneStatuses,
    selectSwimlanesList,
    selectSwimlanesListCount,
    selectUsByStatus,
    selectUsByStatusSwimlanes,
    selectUsMap,
} from './boardSelectors';
import type { ColumnCards } from './boardSelectors';
import type { BoardUser, KanbanBoardState } from './types';
import type { Status } from '../../shared/types/status';
import type { Swimlane } from '../../shared/types/swimlane';
import type { Tag } from '../../shared/types/tag';
import type { UserStory } from '../../shared/types/userStory';

/* ==========================================================================
 * FIXTURES
 *
 * Plain objects and plain arrays throughout, and deep-frozen through `produce`.
 * The convention being translated is
 * `move-to-sprint.controller.spec.coffee:L81-L85`, whose nested persistent-map
 * `taskMap` is the structural analogue of the card map derived here; it has no
 * counterpart on this side of the seam on purpose.
 * ========================================================================== */

const PROJECT_ID = 3;

/**
 * Status ids, deliberately NOT named after the statuses visible in the design
 * reference. Those five names and their colours are `sample_data` artefacts
 * (Drift Register D3), and a fixture that mimicked them would read as
 * configuration the product guarantees, which no project is obliged to have.
 */
const STATUS_FIRST = 1;

const STATUS_SECOND = 2;

const STATUS_THIRD = 3;

/** Archived and hidden are independent facts about a status; see the last suite. */
const STATUS_ARCHIVED = 5;

/** A status carried by a story but absent from the board's own status list. */
const STATUS_OFF_LIST = 99;

const SWIMLANE_A = 7;

const SWIMLANE_B = 8;

/**
 * A swimlane whose id is zero. Legitimate, and load-bearing for the falsy-guard
 * suites: zero is the value the incumbent's truthiness tests sweep onto the flat
 * path [main.coffee:L172/L319, kanban-usertories.coffee:L132].
 */
const SWIMLANE_ZERO = 0;

/** A swimlane id the board does not carry, for the miss branches. */
const SWIMLANE_ABSENT = 999;

const USER_PRIMARY = 11;

/** Referenced by a story but absent from the user map, so it resolves to nothing. */
const USER_MISSING = 12;

const USER_THIRD = 13;

const USER_FOURTH = 14;

const USER_FIFTH = 15;

const USER_SIXTH = 16;

/**
 * Every colour on this board is DATA -- a per-project database value read from
 * `status.color`, `tag[1]` or `epic.color` (T2, Drift Register D3). These
 * placeholders are obviously synthetic so no reader mistakes them for values the
 * product ships, and the only assertion made about a colour is that the tuple's
 * second element survives the mapping untouched, `null` included.
 */
const SYNTHETIC_COLOR = '#0f0f0f';

const SYNTHETIC_TAG_COLOR = '#123456';

/** The translation KEY the synthetic swimlane carries [kanban-usertories.coffee:L298]. */
const UNCLASSIFIED_SWIMLANE_NAME_KEY = 'KANBAN.UNCLASSIFIED_USER_STORIES';

function makeStory(
    overrides: Partial<UserStory> & { readonly id: number },
): UserStory {
    const base: UserStory = {
        id: overrides.id,
        ref: overrides.id,
        subject: `user story ${overrides.id}`,
        status: STATUS_FIRST,
        // Unclassified is spelled `null` and NEVER as the synthetic swimlane's id;
        // see the inverse-invariant test in the synthetic-swimlane suite.
        swimlane: null,
        milestone: null,
        project: PROJECT_ID,
        is_blocked: false,
        blocked_note: '',
        is_closed: false,
        due_date: null,
        total_points: null,
        points: {},
        tags: [],
        epics: null,
        // Raw ids. The card view model resolves them through `usersById`.
        assigned_users: [],
        assigned_to: null,
        kanban_order: 0,
        backlog_order: 0,
        total_attachments: 0,
        total_comments: 0,
        attachments: [],
        tasks: [],
        watchers: [],
        // Required: the optimistic-concurrency token a write has to round-trip.
        version: 1,
    };

    return { ...base, ...overrides };
}

function makeStatus(
    overrides: Partial<Status> & { readonly id: number },
): Status {
    const base: Status = {
        id: overrides.id,
        name: `status ${overrides.id}`,
        color: SYNTHETIC_COLOR,
        // `null` means NO limit, which is not a limit of zero. Nothing here asserts
        // on it: the limit ladder belongs to `../WipLimitMarker.test.tsx`.
        wip_limit: null,
        is_archived: false,
    };

    return { ...base, ...overrides };
}

function makeSwimlane(
    overrides: Partial<Swimlane> & { readonly id: number },
): Swimlane {
    const base: Swimlane = {
        id: overrides.id,
        name: `swimlane ${overrides.id}`,
    };

    return { ...base, ...overrides };
}

/**
 * The user map holds ONE USER PER KEY, despite the grouping-flavoured helper that
 * fills it: [app/coffee/modules/controllerMixins.coffee:L28] calls the utility at
 * [app/coffee/utils.coffee:L80-L85], which assigns `result[pred(item)] = item` --
 * a keyed map builder in which the last duplicate wins, not a grouper that
 * collects lists. A fixture shaped `{11: [user]}` would be wrong, and would break
 * every avatar on the board.
 */
function makeUser(id: number): BoardUser {
    return { id };
}

/**
 * A board with nothing on it. Every field is spelled out rather than borrowed from
 * the reducer's factory, because the suites below need exact control of `order`,
 * of the fold maps and of the per-swimlane status map -- and because a selector
 * spec that derived its fixtures from the reducer would fail for reducer reasons.
 */
const EMPTY_BOARD: KanbanBoardState = {
    storiesById: {},
    order: {},
    swimlanes: [],
    usStatusList: [],
    swimlanesStatuses: {},
    usersById: {},
    foldStatusChanged: {},
    statusHide: [],
    archivedStatus: [],
    folds: {},
    unfold: null,
    foldedSwimlane: {},
    selectedUss: {},
    movedUs: [],
    zoomLevel: -1,
    zoom: [],
    zoomLoading: false,
    renderInProgress: false,
    initialLoad: false,
    notFoundUserstories: false,
};

/**
 * Builds board state and DEEP-FREEZES it, which is the whole point of routing it
 * through `produce`: the board composes its reducer as `produce(reducer)` with
 * auto-freezing on, so production state is frozen and a selector that sorted its
 * input in place would throw. An empty recipe is enough -- `produce` freezes the
 * base and hands back the same object -- so no fixture has to be mutated to be
 * frozen (P-IMMER-4).
 */
function makeState(overrides: Partial<KanbanBoardState> = {}): KanbanBoardState {
    return produce({ ...EMPTY_BOARD, ...overrides }, () => {});
}

/** `storiesById` keyed by each story's own id, which is what the reducer builds. */
function indexById(
    stories: readonly UserStory[],
): Readonly<Record<number, UserStory>> {
    const byId: Record<number, UserStory> = {};

    for (const story of stories) {
        byId[story.id] = story;
    }

    return byId;
}

/**
 * The `order` map the reducer derives from each story's `kanban_order`. Held apart
 * from `storiesById` so a fixture can make the two DISAGREE, which is how the
 * ordering suite proves the grouping is driven by `order` and not by the sequence
 * stories were encountered in.
 */
function orderByKanbanOrder(
    stories: readonly UserStory[],
): Readonly<Record<number, number>> {
    const order: Record<number, number> = {};

    for (const story of stories) {
        order[story.id] = story.kanban_order;
    }

    return order;
}

/** Board state carrying the given stories, indexed and ordered as the reducer would. */
function makeBoard(
    stories: readonly UserStory[],
    overrides: Partial<KanbanBoardState> = {},
): KanbanBoardState {
    return makeState({
        storiesById: indexById(stories),
        order: orderByKanbanOrder(stories),
        ...overrides,
    });
}

/* ==========================================================================
 * HELPERS
 * ========================================================================== */

/**
 * The two members of a column result always have to agree: the badge and the card
 * list were separate template expressions in the source
 * [kanban-table.jade:L204 and :L229], so a divergence would show a count that
 * disagreed with the cards on screen. Asserted on every column this file derives.
 */
function expectColumnConsistency(column: ColumnCards): void {
    expect(column.count).toBe(column.cardIds.length);
}

/** The rendered swimlane ids, in rendered order. Read with `length`, never a collection's own size. */
function swimlaneIdsOf(state: KanbanBoardState): readonly number[] {
    return selectSwimlanesList(state).map((entry) => entry.id);
}

/**
 * A story as it can arrive across the untyped AngularJS seam with its swimlane
 * field ABSENT rather than null. The source's comparison at
 * [kanban-usertories.coffee:L285] is the loose one, which matches an absent field
 * and a null alike, so both have to be exercised. One deliberate widening through
 * `unknown` reproduces the run-time value; no escape hatch and no loosened type
 * is used, here or anywhere in this file.
 */
function withAbsentSwimlane(story: UserStory): UserStory {
    const raw: Record<string, unknown> = { ...story };

    delete raw.swimlane;

    return raw as unknown as UserStory;
}

/* ==========================================================================
 * SUITE 1 -- THE KEY-TYPE ASYMMETRY
 *
 * Three derived maps, three different key conventions, one proof each. This is
 * the suite the rest of the file is built around: conflating the conventions
 * empties every column, and it does so without an error.
 * ========================================================================== */

describe('the key-type asymmetry across the three derived maps', () => {
    const STORY_IN_A = 101;

    const STORY_IN_B = 102;

    const STORY_UNCLASSIFIED = 103;

    function makeMixedBoard(): KanbanBoardState {
        return makeBoard(
            [
                makeStory({
                    id: STORY_IN_A,
                    status: STATUS_FIRST,
                    swimlane: SWIMLANE_A,
                    kanban_order: 1,
                }),
                makeStory({
                    id: STORY_IN_B,
                    status: STATUS_SECOND,
                    swimlane: SWIMLANE_B,
                    kanban_order: 2,
                }),
                makeStory({
                    id: STORY_UNCLASSIFIED,
                    status: STATUS_FIRST,
                    swimlane: null,
                    kanban_order: 3,
                }),
            ],
            {
                swimlanes: [
                    makeSwimlane({ id: SWIMLANE_A }),
                    makeSwimlane({ id: SWIMLANE_B }),
                ],
                usStatusList: [
                    makeStatus({ id: STATUS_FIRST }),
                    makeStatus({ id: STATUS_SECOND }),
                ],
            },
        );
    }

    it('keys the flat grouping by STRING status id', () => {
        const usByStatus = selectUsByStatus(makeMixedBoard());

        // The string-ness is written into the assertion on purpose. Every consumer
        // reads this map with `s.id.toString()` -- the counter at
        // [kanban-table.jade:L204/L211] and the card repeat at [:L229] -- and the
        // grouping is created by indexing a plain object with the numeric status at
        // [kanban-usertories.coffee:L261-L267], which the language turns into a
        // string property name.
        expect(Object.keys(usByStatus)).toEqual(
            expect.arrayContaining(['1', '2']),
        );

        expect(usByStatus[String(STATUS_FIRST)]).toEqual([
            STORY_IN_A,
            STORY_UNCLASSIFIED,
        ]);

        expect(usByStatus[String(STATUS_SECOND)]).toEqual([STORY_IN_B]);
    });

    it('keys the swimlane grouping NUMERICALLY at both levels', () => {
        const bySwimlane = selectUsByStatusSwimlanes(makeMixedBoard());

        // Outer key: the raw swimlane id straight off the rendered entry
        // [kanban-usertories.coffee:L317]. Inner key: an explicit numeric
        // conversion of the flat grouping's string key [:L315]. Consumers read
        // both numerically, through one nested accessor at
        // [kanban-table.jade:L128/L135/L153].
        expect(bySwimlane[SWIMLANE_A][STATUS_FIRST]).toEqual([STORY_IN_A]);

        expect(bySwimlane[SWIMLANE_B][STATUS_SECOND]).toEqual([STORY_IN_B]);
    });

    it('admits the synthetic swimlane id as an OUTER key of the swimlane grouping', () => {
        const bySwimlane = selectUsByStatusSwimlanes(makeMixedBoard());

        // The sentinel is a legitimate grouping key even though it is never a
        // story's own swimlane value [kanban-usertories.coffee:L312].
        expect(Object.keys(bySwimlane)).toEqual(
            expect.arrayContaining(['-1', '7', '8']),
        );

        expect(bySwimlane[UNCLASSIFIED_SWIMLANE_ID][STATUS_FIRST]).toEqual([
            STORY_UNCLASSIFIED,
        ]);
    });

    it('gives a status with stories elsewhere an EMPTY list in each swimlane that lacks them', () => {
        const bySwimlane = selectUsByStatusSwimlanes(makeMixedBoard());

        // [kanban-usertories.coffee:L315] assigns unconditionally, so coverage of
        // the inner keys is inherited from the flat grouping: the second status
        // gets an entry in the first swimlane too, holding nothing.
        expect(bySwimlane[SWIMLANE_A][STATUS_SECOND]).toEqual([]);

        expect(bySwimlane[SWIMLANE_B][STATUS_FIRST]).toEqual([]);
    });

    it('keys the card map NUMERICALLY by story id', () => {
        const usMap = selectUsMap(makeMixedBoard());

        // Every write in the source uses the raw numeric id
        // [kanban-usertories.coffee:L226/L270] and the card repeat reads it back
        // with the same raw id [kanban-table.jade:L160/L163/L238].
        expect(Object.keys(usMap)).toEqual(
            expect.arrayContaining(['101', '102', '103']),
        );

        expect(usMap[STORY_IN_A].id).toBe(STORY_IN_A);

        expect(usMap[STORY_UNCLASSIFIED].id).toBe(STORY_UNCLASSIFIED);
    });

    it('MUST NOT have its three key conventions normalised onto one', () => {
        // THIS TEST EXISTS TO FAIL FIRST if a later change tidies the conventions
        // into agreement. The three spellings are proved by a single if/else in
        // `moveUsToTop` [main.coffee:L172-L178]: the swimlane branch reads
        // `[us.swimlane, us.status]` with both keys numeric, the flat branch reads
        // `us.status.toString()`.
        //
        // Property keys are strings once compiled, so `Record<number, T>` versus
        // `Record<string, T>` is erased and the declarations are a discipline
        // device rather than a run-time guarantee. What IS observable, and what is
        // asserted here, is the lookup idiom each consumer has to use -- which is
        // exactly what the templates depend on.
        //
        // MEASURED, SO NOBODY REPEATS THE EXPERIMENT: replacing the flat grouping's
        // `String(story.status)` with the bare numeric status changes NOTHING that
        // ANY test could observe, because indexing an object converts the key to a
        // string anyway -- the two spellings reach the identical property. The
        // defect this suite actually catches is the one that follows from mistaking
        // the conventions for each other: reading one grouping where the other was
        // meant. The final assertion in this test and the whole
        // "agreement with the groupings it reads" group below are what fail when
        // that happens, and they were verified to fail by making exactly that
        // substitution.
        const state = makeMixedBoard();

        const usByStatus = selectUsByStatus(state);

        const bySwimlane = selectUsByStatusSwimlanes(state);

        const usMap = selectUsMap(state);

        // Flat: string status key, no swimlane level.
        expect(usByStatus[String(STATUS_FIRST)]).toEqual([
            STORY_IN_A,
            STORY_UNCLASSIFIED,
        ]);

        // Swimlane: numeric swimlane key, then numeric status key.
        expect(bySwimlane[SWIMLANE_A][STATUS_FIRST]).toEqual([STORY_IN_A]);

        // Card map: numeric story key, one level.
        expect(usMap[STORY_IN_A].model.id).toBe(STORY_IN_A);

        // And the two groupings genuinely disagree about the same column, which is
        // why one cannot stand in for the other.
        expect(usByStatus[String(STATUS_FIRST)]).not.toEqual(
            bySwimlane[SWIMLANE_A][STATUS_FIRST],
        );
    });

    it('keys the swimlane fold map by STRING, including for the synthetic swimlane', () => {
        // The controller writes `foldedSwimlane.set(id.toString(), ...)`
        // [main.coffee:L329] and the template reads
        // `foldedSwimlane.get(swimlane.id.toString())` at
        // [kanban-table.jade:L82/L86/L90/L108]. The record keeps its string keys
        // all the way through because it is persisted verbatim, so rekeying it
        // would drop the user's collapsed swimlanes on the next load.
        const state = makeState({
            foldedSwimlane: { '7': true, '-1': true },
        });

        expect(selectIsSwimlaneFolded(state, SWIMLANE_A)).toBe(true);

        expect(selectIsSwimlaneFolded(state, UNCLASSIFIED_SWIMLANE_ID)).toBe(
            true,
        );

        expect(selectIsSwimlaneFolded(state, SWIMLANE_B)).toBe(false);
    });

    it('keys the column fold map and the unfolded column NUMERICALLY', () => {
        // Both are read numerically by both column repeats:
        // `{vfold: folds[s.id], vunfold: unfold == s.id}`
        // [kanban-table.jade:L113 and :L190].
        const state = makeState({
            folds: { 1: true },
            unfold: STATUS_SECOND,
        });

        expect(selectIsStatusFolded(state, STATUS_FIRST)).toBe(true);

        expect(selectIsStatusFolded(state, STATUS_SECOND)).toBe(false);

        expect(selectIsStatusUnfolded(state, STATUS_SECOND)).toBe(true);

        expect(selectIsStatusUnfolded(state, STATUS_FIRST)).toBe(false);
    });
});


/* ==========================================================================
 * SUITE 2 -- FLAT GROUPING: ORDERING AND DE-DUPLICATION
 *
 * Reproduces `refresh` [kanban-usertories.coffee:L254-L275].
 * ========================================================================== */

describe('selectUsByStatus', () => {
    it('orders each column by the board order, NOT by the sequence stories are met in', () => {
        // [kanban-usertories.coffee:L255] sorts the WHOLE story set before [:L257]
        // begins grouping, so a column's order is the board order. This fixture
        // makes the two disagree on purpose: the stories are enumerated by
        // ascending id -- 201, 202, 203 -- while their order values run 30, 10, 20,
        // so grouping in encounter order would emit [201, 202, 203]. Inverting the
        // sort and the grouping reorders every column on the board, which is the
        // single most likely defect in this derivation.
        const state = makeBoard([
            makeStory({ id: 201, status: STATUS_FIRST, kanban_order: 30 }),
            makeStory({ id: 202, status: STATUS_FIRST, kanban_order: 10 }),
            makeStory({ id: 203, status: STATUS_FIRST, kanban_order: 20 }),
        ]);

        expect(selectUsByStatus(state)[String(STATUS_FIRST)]).toEqual([
            202, 203, 201,
        ]);
    });

    it('places a story with NO order entry first', () => {
        // The order reader treats a missing entry as zero, so the story sorts ahead
        // of every positive order. The incumbent's sorting helper placed a missing
        // key last instead; the departure is documented on `readOrder` in
        // `boardSelectors.ts` and is unreachable in practice, because the reducer
        // rebuilds `order` from the same story set it rebuilds the story map from.
        const stories = [
            makeStory({ id: 204, status: STATUS_FIRST, kanban_order: 5 }),
            makeStory({ id: 205, status: STATUS_FIRST, kanban_order: 6 }),
        ];

        const state = makeState({
            storiesById: indexById(stories),
            // Deliberately partial: 205 has no entry.
            order: { 204: 5 },
        });

        expect(selectUsByStatus(state)[String(STATUS_FIRST)]).toEqual([205, 204]);
    });

    it('treats a NON-FINITE order as zero', () => {
        const stories = [
            makeStory({ id: 206, status: STATUS_FIRST, kanban_order: 1 }),
            makeStory({ id: 207, status: STATUS_FIRST, kanban_order: 2 }),
        ];

        const state = makeState({
            storiesById: indexById(stories),
            // A value that arrived across the untyped seam and is not a number the
            // arithmetic can use. Zero sorts it first rather than letting the
            // comparator return a non-finite difference, which would leave the
            // column's order unspecified.
            order: { 206: 5, 207: Number.NaN },
        });

        expect(selectUsByStatus(state)[String(STATUS_FIRST)]).toEqual([207, 206]);
    });

    it('collapses a repeated story id to a single entry, at its post-append position', () => {
        // The source removes the story's own id from the bucket at
        // [kanban-usertories.coffee:L264-L265] before pushing it back at [:L267],
        // and `boardSelectors.ts` transcribes the pair in that order.
        //
        // The incumbent grouped a plain ARRAY of models, which could genuinely hold
        // the same story twice; the React state holds a normalised map, whose keys
        // are distinct by construction. So the only way to present a repeated id on
        // this side is two DIFFERENT record keys holding stories that carry the same
        // id, which is what this fixture does -- purely to exercise the
        // remove-then-append pair.
        const state = makeState({
            storiesById: {
                901: makeStory({ id: 501, status: STATUS_FIRST, kanban_order: 20 }),
                902: makeStory({ id: 502, status: STATUS_FIRST, kanban_order: 10 }),
                903: makeStory({ id: 501, status: STATUS_FIRST, kanban_order: 20 }),
            },
            order: { 501: 20, 502: 10 },
            usStatusList: [makeStatus({ id: STATUS_FIRST })],
        });

        const bucket = selectUsByStatus(state)[String(STATUS_FIRST)];

        expect(bucket).toEqual([502, 501]);

        expect(bucket.filter((cardId) => cardId === 501)).toHaveLength(1);

        // The badge counts what the column renders, so the collapse has to be
        // visible there too rather than only in the grouping.
        expectColumnConsistency(selectColumnCards(state, STATUS_FIRST));

        expect(selectColumnCards(state, STATUS_FIRST).count).toBe(2);
    });

    it('leaves one status untouched when another status changes', () => {
        const shared = [
            makeStory({ id: 208, status: STATUS_FIRST, kanban_order: 1 }),
            makeStory({ id: 209, status: STATUS_FIRST, kanban_order: 2 }),
        ];

        const before = selectUsByStatus(makeBoard(shared));

        const after = selectUsByStatus(
            makeBoard([
                ...shared,
                makeStory({ id: 210, status: STATUS_SECOND, kanban_order: 3 }),
            ]),
        );

        expect(after[String(STATUS_FIRST)]).toEqual(
            before[String(STATUS_FIRST)],
        );

        expect(after[String(STATUS_SECOND)]).toEqual([210]);
    });

    it('groups by the story\u2019s own status, even when the board\u2019s status list does not carry it', () => {
        // [kanban-usertories.coffee:L261] keys the bucket off `usModel.status`, not
        // off the status list, so a story whose status the board no longer lists
        // still gets a bucket of its own. Kept as-is: filtering it out here would
        // hide the story from every consumer without recording that it exists.
        const state = makeBoard(
            [
                makeStory({ id: 211, status: STATUS_FIRST, kanban_order: 1 }),
                makeStory({ id: 212, status: STATUS_OFF_LIST, kanban_order: 2 }),
            ],
            { usStatusList: [makeStatus({ id: STATUS_FIRST })] },
        );

        expect(selectUsByStatus(state)[String(STATUS_OFF_LIST)]).toEqual([212]);
    });

    it('is empty for a board with no stories', () => {
        expect(selectUsByStatus(makeState())).toEqual({});
    });
});

/* ==========================================================================
 * SUITE 3 -- ONE COLUMN'S CARDS, AND THE STORY-LESS STATUS
 * ========================================================================== */

describe('selectColumnCards', () => {
    const STORY_IN_A = 301;

    const STORY_IN_B = 302;

    const STORY_UNCLASSIFIED = 303;

    /** Two swimlanes plus one unclassified story, so the synthetic swimlane exists. */
    function makeThreeWayBoard(
        overrides: Partial<KanbanBoardState> = {},
    ): KanbanBoardState {
        return makeBoard(
            [
                makeStory({
                    id: STORY_IN_A,
                    status: STATUS_FIRST,
                    swimlane: SWIMLANE_A,
                    kanban_order: 1,
                }),
                makeStory({
                    id: STORY_IN_B,
                    status: STATUS_FIRST,
                    swimlane: SWIMLANE_B,
                    kanban_order: 2,
                }),
                makeStory({
                    id: STORY_UNCLASSIFIED,
                    status: STATUS_FIRST,
                    swimlane: null,
                    kanban_order: 3,
                }),
            ],
            {
                swimlanes: [
                    makeSwimlane({ id: SWIMLANE_A }),
                    makeSwimlane({ id: SWIMLANE_B }),
                ],
                usStatusList: [
                    makeStatus({ id: STATUS_FIRST }),
                    makeStatus({ id: STATUS_SECOND }),
                ],
                ...overrides,
            },
        );
    }

    describe('the story-less status', () => {
        it('reports an EMPTY card list and a count of ZERO, not undefined', () => {
            // THE NORMALISATION IS DELIBERATE AND IS DOCUMENTED SO IT IS NOT
            // REVERTED. It changes the DERIVED value and NOT the rendered one.
            //
            // What the incumbent derived: the board pre-created an empty bucket for
            // every status it had seen [kanban-usertories.coffee:L53-L58, called
            // from main.coffee:L403], but the refresh pass creates a bucket only on
            // meeting a story with that status [:L261] and then REPLACES THE WHOLE
            // MAP [:L272], discarding every pre-created empty bucket with it. So
            // `usByStatus.get(s.id.toString())` came back undefined, and the
            // template's length reads at [kanban-table.jade:L204/L211] are
            // UNGUARDED -- they survived only because the expression evaluator
            // behind those bindings tolerates a missing intermediate and yields
            // undefined instead of throwing.
            //
            // WHAT THE INCUMBENT DISPLAYED, HOWEVER, WAS A LITERAL ZERO: the
            // counter component those bindings feed falls back on exactly that,
            // `{{ renderCount.current || 0 }}` at
            // [app/modules/components/animated-counter/animated-counter.directive.coffee:L22],
            // and both undefined and 0 are falsy. Verified on the running AngularJS
            // build (`project-1`, whose DONE and ARCHIVED statuses hold no stories
            // anywhere on the board): each such badge renders the single character
            // `0`, never a blank.
            //
            // So zero preserves the rendering exactly AND gives the consumers the
            // type they declare: `../StatusColumn.tsx:L433/L445` and
            // `../ArchivedColumn.tsx:L21` declare `cardIds` and `count` as
            // NON-OPTIONAL, so undefined would not type-check at the consumer, and
            // the design reference for this screen agrees with the live build.
            // `../TaskCounter.tsx:L66` tolerates either, so it does not decide the
            // question.
            const column = selectColumnCards(makeThreeWayBoard(), STATUS_SECOND);

            expect(column.cardIds).toEqual([]);

            expect(column.count).toBe(0);

            expectColumnConsistency(column);
        });

        it('hands back the SAME empty result on repeated calls', () => {
            // A stable constant, so a miss neither allocates nor breaks the
            // reference equality a consumer's memo boundary depends on.
            const state = makeThreeWayBoard();

            expect(selectColumnCards(state, STATUS_SECOND)).toBe(
                selectColumnCards(state, STATUS_SECOND),
            );
        });

        it('reports zero for a swimlane column whose status has no stories anywhere', () => {
            const column = selectColumnCards(
                makeThreeWayBoard(),
                STATUS_SECOND,
                SWIMLANE_A,
            );

            expect(column.count).toBe(0);

            expectColumnConsistency(column);
        });

        it('reports zero for a swimlane the board does not carry', () => {
            const column = selectColumnCards(
                makeThreeWayBoard(),
                STATUS_FIRST,
                SWIMLANE_ABSENT,
            );

            expect(column.cardIds).toEqual([]);

            expectColumnConsistency(column);
        });
    });

    describe('the FALSY swimlane guard', () => {
        // `if us.swimlane` [main.coffee:L172] is the first of the module's three
        // truthiness tests on a swimlane id; the others are `if swimlaneId`
        // [main.coffee:L319] and `!swimlaneId` [kanban-usertories.coffee:L132].
        // Zero, null and an absent argument all take the FLAT path. Normalising
        // them into null checks would route a board whose first swimlane happened
        // to be identified as zero down the wrong branch (T10).
        const FLAT_SWIMLANE_ARGUMENTS: readonly (number | null | undefined)[] = [
            undefined,
            null,
            SWIMLANE_ZERO,
        ];

        for (const swimlaneArgument of FLAT_SWIMLANE_ARGUMENTS) {
            it(`takes the FLAT path for ${String(swimlaneArgument)}`, () => {
                const column = selectColumnCards(
                    makeThreeWayBoard(),
                    STATUS_FIRST,
                    swimlaneArgument,
                );

                // The flat grouping holds all three cards regardless of swimlane;
                // no swimlane-scoped column holds more than one of them.
                expect(column.cardIds).toEqual([
                    STORY_IN_A,
                    STORY_IN_B,
                    STORY_UNCLASSIFIED,
                ]);

                expectColumnConsistency(column);
            });
        }

        it('takes the SWIMLANE path for the synthetic swimlane, whose id is negative and therefore truthy', () => {
            const column = selectColumnCards(
                makeThreeWayBoard(),
                STATUS_FIRST,
                UNCLASSIFIED_SWIMLANE_ID,
            );

            // The flat path would have returned all three cards, so this result
            // proves the sentinel routed to the swimlane grouping.
            expect(column.cardIds).toEqual([STORY_UNCLASSIFIED]);

            expectColumnConsistency(column);
        });

        it('takes the SWIMLANE path for a real swimlane id', () => {
            const column = selectColumnCards(
                makeThreeWayBoard(),
                STATUS_FIRST,
                SWIMLANE_A,
            );

            expect(column.cardIds).toEqual([STORY_IN_A]);

            expectColumnConsistency(column);
        });

        it('still takes the FLAT path for a REAL swimlane whose id is zero', () => {
            // The quirk, preserved verbatim. A project may identify a swimlane as
            // zero, and the guard cannot tell that id from "no swimlane given", so
            // the column falls back to the flat grouping. Two stories live in that
            // swimlane and one does not, and the flat result carries all three.
            const state = makeBoard(
                [
                    makeStory({
                        id: 304,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_ZERO,
                        kanban_order: 1,
                    }),
                    makeStory({
                        id: 305,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_A,
                        kanban_order: 2,
                    }),
                    makeStory({
                        id: 306,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_ZERO,
                        kanban_order: 3,
                    }),
                ],
                {
                    swimlanes: [
                        makeSwimlane({ id: SWIMLANE_ZERO }),
                        makeSwimlane({ id: SWIMLANE_A }),
                    ],
                    usStatusList: [makeStatus({ id: STATUS_FIRST })],
                },
            );

            expect(
                selectColumnCards(state, STATUS_FIRST, SWIMLANE_ZERO).cardIds,
            ).toEqual([304, 305, 306]);

            // And the swimlane grouping itself does hold the scoped answer, so the
            // fallback is the guard's doing and not a gap in the grouping.
            expect(
                selectUsByStatusSwimlanes(state)[SWIMLANE_ZERO][STATUS_FIRST],
            ).toEqual([304, 306]);
        });
    });

    describe('agreement with the groupings it reads', () => {
        it('returns exactly the flat grouping\u2019s list for the column', () => {
            const state = makeThreeWayBoard();

            expect(selectColumnCards(state, STATUS_FIRST).cardIds).toEqual(
                selectUsByStatus(state)[String(STATUS_FIRST)],
            );
        });

        it('returns exactly the swimlane grouping\u2019s list for the column', () => {
            const state = makeThreeWayBoard();

            expect(
                selectColumnCards(state, STATUS_FIRST, SWIMLANE_B).cardIds,
            ).toEqual(selectUsByStatusSwimlanes(state)[SWIMLANE_B][STATUS_FIRST]);
        });

        it('keeps the count and the card list in step across every column of the board', () => {
            const state = makeThreeWayBoard();

            for (const status of selectHeaderStatuses(state)) {
                expectColumnConsistency(selectColumnCards(state, status.id));

                for (const entry of selectSwimlanesList(state)) {
                    expectColumnConsistency(
                        selectColumnCards(state, status.id, entry.id),
                    );
                }
            }
        });
    });
});


/* ==========================================================================
 * SUITE 4 -- THE SYNTHETIC SWIMLANE
 *
 * Reproduces `refreshSwimlanes` [kanban-usertories.coffee:L277-L317].
 * ========================================================================== */

describe('selectSwimlanesList and selectUsByStatusSwimlanes', () => {
    const CLASSIFIED_STORY = 401;

    const UNCLASSIFIED_STORY = 402;

    const TWO_SWIMLANES: readonly Swimlane[] = [
        makeSwimlane({ id: SWIMLANE_A }),
        makeSwimlane({ id: SWIMLANE_B }),
    ];

    function makeClassifiedOnlyBoard(): KanbanBoardState {
        return makeBoard(
            [
                makeStory({
                    id: CLASSIFIED_STORY,
                    status: STATUS_FIRST,
                    swimlane: SWIMLANE_A,
                    kanban_order: 1,
                }),
            ],
            { swimlanes: TWO_SWIMLANES },
        );
    }

    function makeBoardWithUnclassified(): KanbanBoardState {
        return makeBoard(
            [
                makeStory({
                    id: CLASSIFIED_STORY,
                    status: STATUS_FIRST,
                    swimlane: SWIMLANE_A,
                    kanban_order: 1,
                }),
                makeStory({
                    id: UNCLASSIFIED_STORY,
                    status: STATUS_FIRST,
                    swimlane: null,
                    kanban_order: 2,
                }),
            ],
            { swimlanes: TWO_SWIMLANES },
        );
    }

    describe('the conditional prepend', () => {
        it('prepends the synthetic swimlane when at least one story belongs to no swimlane', () => {
            // The NET behaviour of [kanban-usertories.coffee:L284-L300]: the
            // condition reduces to "there is at least one unclassified story".
            const list = selectSwimlanesList(makeBoardWithUnclassified());

            expect(list[0].id).toBe(UNCLASSIFIED_SWIMLANE_ID);

            expect(swimlaneIdsOf(makeBoardWithUnclassified())).toEqual([
                UNCLASSIFIED_SWIMLANE_ID,
                SWIMLANE_A,
                SWIMLANE_B,
            ]);
        });

        it('omits it entirely when every story belongs to a swimlane', () => {
            const state = makeClassifiedOnlyBoard();

            const list = selectSwimlanesList(state);

            expect(list[0].id).toBe(SWIMLANE_A);

            expect(
                list.some((entry) => entry.id === UNCLASSIFIED_SWIMLANE_ID),
            ).toBe(false);

            expect(selectUsByStatusSwimlanes(state)[UNCLASSIFIED_SWIMLANE_ID]).toBeUndefined();
        });

        it('returns the board\u2019s own swimlane array unchanged when nothing is unclassified', () => {
            // The else branch at [kanban-usertories.coffee:L302-L305] pushes the
            // real swimlanes in their existing order and nothing else, so the
            // state's array is handed back by reference and a consumer's memo
            // boundary sees an unchanged list.
            const state = makeClassifiedOnlyBoard();

            expect(selectSwimlanesList(state)).toBe(state.swimlanes);
        });

        it('carries exactly the synthetic entry the source builds', () => {
            // Verbatim from the literal at [kanban-usertories.coffee:L295-L299].
            expect(selectSwimlanesList(makeBoardWithUnclassified())[0]).toEqual({
                id: UNCLASSIFIED_SWIMLANE_ID,
                kanban_order: 1,
                name: UNCLASSIFIED_SWIMLANE_NAME_KEY,
            });
        });

        it('carries the TRANSLATION KEY as its name, not display text', () => {
            // The source resolved the label eagerly through the translation service
            // [kanban-usertories.coffee:L298], which forced that service to be
            // injected purely to build a string. Here the key travels unresolved and
            // `../SwimlaneHeader.tsx` translates it at render time through
            // `../../bridge/useTranslate.ts`, which keeps this module free of React
            // and of the bridge.
            const name = selectSwimlanesList(makeBoardWithUnclassified())[0].name;

            expect(name).toBe('KANBAN.UNCLASSIFIED_USER_STORIES');

            expect(name).not.toBe('Unclassified user stories');
        });

        it('keeps the real swimlanes in their original relative order after the prepend', () => {
            // Declared in descending id on purpose: the result must follow the
            // board's declaration order, not a sort.
            const state = makeBoard(
                [
                    makeStory({
                        id: 403,
                        status: STATUS_FIRST,
                        swimlane: null,
                        kanban_order: 1,
                    }),
                ],
                {
                    swimlanes: [
                        makeSwimlane({ id: SWIMLANE_B }),
                        makeSwimlane({ id: SWIMLANE_A }),
                    ],
                },
            );

            expect(swimlaneIdsOf(state)).toEqual([
                UNCLASSIFIED_SWIMLANE_ID,
                SWIMLANE_B,
                SWIMLANE_A,
            ]);
        });

        it('builds the list as the synthetic entry followed by the board\u2019s swimlanes', () => {
            // T9 SEAM. The source prepends with the persistent list's own
            // `insert(0, entry)` at [kanban-usertories.coffee:L300]. THAT METHOD HAS
            // NO ARRAY COUNTERPART -- it is one of the accessors that looks portable
            // and is not -- so the prepend is spelled as a spread. `unshift` is not
            // a substitute: it mutates, and this input is frozen.
            const state = makeBoardWithUnclassified();

            expect(selectSwimlanesList(state)).toEqual([
                {
                    id: UNCLASSIFIED_SWIMLANE_ID,
                    kanban_order: 1,
                    name: UNCLASSIFIED_SWIMLANE_NAME_KEY,
                },
                ...state.swimlanes,
            ]);
        });

        it('adds no entry of its own beyond the synthetic one', () => {
            // THE SOURCE GUARD AT [kanban-usertories.coffee:L287-L290] IS DOUBLY
            // DEAD AND IS DELIBERATELY NOT REPRODUCED, so only its net effect is
            // asserted. It filters the swimlane list for an entry whose id is null
            // and requires that filter to be empty: the filter runs over a list
            // emptied two statements earlier at [:L281], so its length is always
            // zero, and even on a populated list the predicate could not have
            // matched, because the only entry that could have been sought is the
            // synthetic one, whose id is the negative sentinel rather than null.
            // Transcribing it would ship dead code; deleting it without this note
            // would invite the next reader to restore it.
            //
            // The membership test the source wraps each push in [:L292/:L304] is a
            // second no-op, for the same reason: it starts from the emptied list and
            // walks the board's swimlanes once, so it could only fire if that
            // collection held the same object twice.
            const state = makeBoardWithUnclassified();

            expect(selectSwimlanesList(state)).toHaveLength(
                state.swimlanes.length + 1,
            );

            expect(selectSwimlanesList(makeClassifiedOnlyBoard())).toHaveLength(
                TWO_SWIMLANES.length,
            );
        });
    });

    describe('the sentinel-to-null grouping match', () => {
        it('groups an unclassified story under the synthetic OUTER key', () => {
            // [kanban-usertories.coffee:L310-L313] maps the synthetic swimlane back
            // onto the value a story actually carries before comparing.
            const bySwimlane = selectUsByStatusSwimlanes(
                makeBoardWithUnclassified(),
            );

            expect(bySwimlane[UNCLASSIFIED_SWIMLANE_ID][STATUS_FIRST]).toEqual([
                UNCLASSIFIED_STORY,
            ]);

            expect(bySwimlane[SWIMLANE_A][STATUS_FIRST]).toEqual([
                CLASSIFIED_STORY,
            ]);
        });

        it('never lets the sentinel reach a story\u2019s own swimlane field', () => {
            // THE INVERSE INVARIANT, and the failure mode is silent. A story spells
            // unclassified as `null` [kanban-usertories.coffee:L285]; the sentinel
            // exists only as a grouping key. If a story ever held it, the
            // unclassified filter at [:L284-L285] would find nothing, the synthetic
            // swimlane would never be created, and that story's card would vanish
            // from the board -- no error, no warning, nothing in the console.
            const state = makeBoardWithUnclassified();

            const story = state.storiesById[UNCLASSIFIED_STORY];

            expect(story.swimlane).toBeNull();

            expect(story.swimlane).not.toBe(UNCLASSIFIED_SWIMLANE_ID);

            expect(selectUsMap(state)[UNCLASSIFIED_STORY].swimlane).toBeNull();
        });

        it('treats an ABSENT swimlane field as unclassified, exactly as a null one', () => {
            // The source's comparison at [kanban-usertories.coffee:L285] is the
            // loose one, which matches an absent field and a null alike. Both are
            // reproduced with two strict comparisons rather than one loose one, so
            // the behaviour is identical and the intent is explicit.
            const state = makeBoard(
                [
                    withAbsentSwimlane(
                        makeStory({
                            id: 404,
                            status: STATUS_FIRST,
                            kanban_order: 1,
                        }),
                    ),
                ],
                { swimlanes: TWO_SWIMLANES },
            );

            expect(swimlaneIdsOf(state)[0]).toBe(UNCLASSIFIED_SWIMLANE_ID);

            expect(
                selectUsByStatusSwimlanes(state)[UNCLASSIFIED_SWIMLANE_ID][
                    STATUS_FIRST
                ],
            ).toEqual([404]);
        });

        it('does NOT treat a swimlane id of zero as unclassified', () => {
            // Emphatically not a falsy test: zero is a legitimate swimlane id, and
            // sweeping it in here would move a real swimlane's cards into the
            // synthetic one and create an empty swimlane at the top of the board.
            const state = makeBoard(
                [
                    makeStory({
                        id: 405,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_ZERO,
                        kanban_order: 1,
                    }),
                ],
                {
                    swimlanes: [
                        makeSwimlane({ id: SWIMLANE_ZERO }),
                        makeSwimlane({ id: SWIMLANE_A }),
                    ],
                },
            );

            expect(swimlaneIdsOf(state)).toEqual([SWIMLANE_ZERO, SWIMLANE_A]);

            expect(
                selectUsByStatusSwimlanes(state)[SWIMLANE_ZERO][STATUS_FIRST],
            ).toEqual([405]);
        });

        it('leaves a card whose story the board no longer holds out of every swimlane group', () => {
            // Reachable only where a record key and its story's own id disagree, as
            // in the de-duplication fixture: the grouping yields a card id the story
            // map cannot resolve. The source would have thrown on that branch -- it
            // calls a nested accessor on the lookup result without checking it --
            // so returning false instead keeps the derivation total and changes
            // nothing observable.
            const state = makeState({
                storiesById: {
                    901: makeStory({
                        id: 501,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_A,
                        kanban_order: 1,
                    }),
                },
                order: { 501: 1 },
                swimlanes: TWO_SWIMLANES,
                usStatusList: [makeStatus({ id: STATUS_FIRST })],
            });

            expect(selectUsByStatus(state)[String(STATUS_FIRST)]).toEqual([501]);

            expect(
                selectUsByStatusSwimlanes(state)[SWIMLANE_A][STATUS_FIRST],
            ).toEqual([]);
        });
    });

    describe('ordering within a swimlane', () => {
        it('orders each inner list by the board order', () => {
            // [kanban-usertories.coffee:L309] walks the flat grouping, which is
            // already in board order, and filtering preserves relative order -- so
            // each inner list is ordered by construction and needs no second sort.
            const state = makeBoard(
                [
                    makeStory({
                        id: 406,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_A,
                        kanban_order: 30,
                    }),
                    makeStory({
                        id: 407,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_A,
                        kanban_order: 10,
                    }),
                    makeStory({
                        id: 408,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_A,
                        kanban_order: 20,
                    }),
                ],
                { swimlanes: TWO_SWIMLANES },
            );

            expect(
                selectUsByStatusSwimlanes(state)[SWIMLANE_A][STATUS_FIRST],
            ).toEqual([407, 408, 406]);
        });
    });
});

/* ==========================================================================
 * SUITE 5 -- FLAT MODE IS ABSENT, NOT EMPTY
 *
 * `refreshSwimlanes` returns at [kanban-usertories.coffee:L278-L279] when the
 * board has no swimlanes, so neither swimlane structure is ever populated.
 * ========================================================================== */

describe('flat mode', () => {
    function makeFlatBoard(): KanbanBoardState {
        return makeBoard(
            [
                makeStory({ id: 601, status: STATUS_FIRST, kanban_order: 1 }),
                makeStory({ id: 602, status: STATUS_SECOND, kanban_order: 2 }),
            ],
            {
                // No swimlanes at all: the board renders one set of columns.
                swimlanes: [],
                usStatusList: [
                    makeStatus({ id: STATUS_FIRST }),
                    makeStatus({ id: STATUS_SECOND }),
                ],
            },
        );
    }

    it('renders NO swimlane list even though the board holds stories', () => {
        const list = selectSwimlanesList(makeFlatBoard());

        // Read with a plain array `length`. The list handed to the templates was a
        // persistent collection with its own length property, and several call
        // sites still read it that way -- including the shared card controller,
        // which must not be touched. This folder is on the far side of the
        // flattening seam and sees plain arrays only.
        expect(list).toHaveLength(0);

        expect(list).toEqual([]);
    });

    it('populates NO swimlane grouping even though the board holds stories', () => {
        expect(selectUsByStatusSwimlanes(makeFlatBoard())).toEqual({});

        expect(Object.keys(selectUsByStatusSwimlanes(makeFlatBoard()))).toHaveLength(
            0,
        );
    });

    it('still populates the flat grouping in the same fixture', () => {
        // The distinction the two structures draw: absent on one side, present on
        // the other. Confusing them renders both layouts or neither.
        const usByStatus = selectUsByStatus(makeFlatBoard());

        expect(usByStatus[String(STATUS_FIRST)]).toEqual([601]);

        expect(usByStatus[String(STATUS_SECOND)]).toEqual([602]);
    });

    it('reports that the board has no swimlanes', () => {
        // The template gates the whole swimlane branch on the rendered list being
        // non-empty [kanban-table.jade:L74] and gates the flat body on the
        // complement -- the rendered list being empty [:L185] -- so this boolean is
        // what the board switches on.
        expect(selectHasSwimlanes(makeFlatBoard())).toBe(false);
    });

    it('hands back the SAME empty structures on repeated calls', () => {
        const state = makeFlatBoard();

        expect(selectSwimlanesList(state)).toBe(selectSwimlanesList(state));

        expect(selectUsByStatusSwimlanes(state)).toBe(
            selectUsByStatusSwimlanes(state),
        );
    });

    it('reports that a board WITH swimlanes has them', () => {
        const state = makeBoard(
            [
                makeStory({
                    id: 603,
                    status: STATUS_FIRST,
                    swimlane: SWIMLANE_A,
                    kanban_order: 1,
                }),
            ],
            { swimlanes: [makeSwimlane({ id: SWIMLANE_A })] },
        );

        expect(selectHasSwimlanes(state)).toBe(true);
    });

    describe('selectSwimlanesListCount', () => {
        // Backs the create-a-swimlane hint, which fires for an administrator while
        // the rendered list still holds one entry or fewer
        // [kanban-table.jade:L177]. Exposed as a count so the consumer applies its
        // own comparison. NOT interchangeable with the board's own swimlane count:
        // the default-swimlane marker [:L102] gates on the project's swimlanes,
        // which exclude the synthetic entry, and `../SwimlaneHeader.tsx` receives
        // that number separately.
        it('counts zero in flat mode', () => {
            expect(selectSwimlanesListCount(makeFlatBoard())).toBe(0);
        });

        it('counts one real swimlane as one', () => {
            const state = makeBoard(
                [
                    makeStory({
                        id: 604,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_A,
                        kanban_order: 1,
                    }),
                ],
                { swimlanes: [makeSwimlane({ id: SWIMLANE_A })] },
            );

            expect(selectSwimlanesListCount(state)).toBe(1);
        });

        it('counts the synthetic entry, so one real swimlane plus unclassified stories reads two', () => {
            const state = makeBoard(
                [
                    makeStory({
                        id: 605,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_A,
                        kanban_order: 1,
                    }),
                    makeStory({
                        id: 606,
                        status: STATUS_FIRST,
                        swimlane: null,
                        kanban_order: 2,
                    }),
                ],
                { swimlanes: [makeSwimlane({ id: SWIMLANE_A })] },
            );

            expect(selectSwimlanesListCount(state)).toBe(2);
        });

        it('counts two real swimlanes as two', () => {
            const state = makeBoard(
                [
                    makeStory({
                        id: 607,
                        status: STATUS_FIRST,
                        swimlane: SWIMLANE_A,
                        kanban_order: 1,
                    }),
                ],
                {
                    swimlanes: [
                        makeSwimlane({ id: SWIMLANE_A }),
                        makeSwimlane({ id: SWIMLANE_B }),
                    ],
                },
            );

            expect(selectSwimlanesListCount(state)).toBe(2);
        });
    });
});


/* ==========================================================================
 * SUITE 6 -- THE EMPTY-STATE GATE
 *
 * Reproduces `showPlaceHolder` [main.coffee:L316-L323]:
 *
 *   L317  firstStatus = @scope.usStatusList[0].id == statusId &&
 *                       !@kanbanUserstoriesService.userstoriesRaw.length
 *   L319  if swimlaneId
 *   L320      firstSwimlane = @scope.swimlanesList.first().id == swimlaneId
 *   L321      return firstStatus && firstSwimlane
 *   L323  return firstStatus
 *
 * The AngularJS method is spelled `showPlaceHolder`, with a capital H, while the
 * derivation here is `selectShowPlaceholder` -- recorded so a search for either
 * spelling finds both.
 * ========================================================================== */

describe('selectShowPlaceholder', () => {
    const TWO_STATUSES: readonly Status[] = [
        makeStatus({ id: STATUS_FIRST }),
        makeStatus({ id: STATUS_SECOND }),
    ];

    /** An empty board in flat mode: two statuses, no swimlanes, no stories. */
    function makeEmptyFlatBoard(): KanbanBoardState {
        return makeState({ usStatusList: TWO_STATUSES });
    }

    /**
     * An empty board in swimlane mode, with the swimlanes declared in DESCENDING
     * id so that the first entry of the rendered list is not the lowest id. That is
     * what makes the falsy-guard cases below discriminating rather than incidental.
     */
    function makeEmptySwimlaneBoard(): KanbanBoardState {
        return makeState({
            usStatusList: TWO_STATUSES,
            swimlanes: [
                makeSwimlane({ id: SWIMLANE_B }),
                makeSwimlane({ id: SWIMLANE_A }),
            ],
        });
    }

    describe('the first condition', () => {
        it('shows the placeholder for the FIRST status of an empty board', () => {
            // One-argument arity, as the flat column calls it at
            // [kanban-table.jade:L221].
            expect(
                selectShowPlaceholder(makeEmptyFlatBoard(), STATUS_FIRST),
            ).toBe(true);
        });

        it('hides it for a later status, even on an empty board', () => {
            expect(
                selectShowPlaceholder(makeEmptyFlatBoard(), STATUS_SECOND),
            ).toBe(false);
        });

        it('hides it for the first status when ANY story exists ANYWHERE on the board', () => {
            // The condition is `!userstoriesRaw.length` [main.coffee:L317] -- THE
            // WHOLE BOARD, not this column. One card in a different status
            // suppresses the placeholder in the first column too, and this
            // assertion is what pins that reading.
            const state = makeBoard(
                [makeStory({ id: 701, status: STATUS_SECOND, kanban_order: 1 })],
                { usStatusList: TWO_STATUSES },
            );

            expect(selectColumnCards(state, STATUS_FIRST).count).toBe(0);

            expect(selectShowPlaceholder(state, STATUS_FIRST)).toBe(false);
        });

        it('hides it for the first status when a story exists in that same status', () => {
            const state = makeBoard(
                [makeStory({ id: 702, status: STATUS_FIRST, kanban_order: 1 })],
                { usStatusList: TWO_STATUSES },
            );

            expect(selectShowPlaceholder(state, STATUS_FIRST)).toBe(false);
        });
    });

    describe('the additional swimlane condition', () => {
        it('shows the placeholder for the FIRST entry of the rendered swimlane list', () => {
            // Two-argument arity, as the swimlane column calls it at
            // [kanban-table.jade:L145]. The board declares its swimlanes in
            // descending id, so the first ENTRY is the higher id.
            expect(
                selectShowPlaceholder(
                    makeEmptySwimlaneBoard(),
                    STATUS_FIRST,
                    SWIMLANE_B,
                ),
            ).toBe(true);
        });

        it('hides it for a later swimlane', () => {
            expect(
                selectShowPlaceholder(
                    makeEmptySwimlaneBoard(),
                    STATUS_FIRST,
                    SWIMLANE_A,
                ),
            ).toBe(false);
        });

        it('hides it for the first swimlane paired with a later status', () => {
            expect(
                selectShowPlaceholder(
                    makeEmptySwimlaneBoard(),
                    STATUS_SECOND,
                    SWIMLANE_B,
                ),
            ).toBe(false);
        });
    });

    describe('the THIRD falsy guard', () => {
        // `if swimlaneId` [main.coffee:L319]. Zero, null and an absent argument all
        // take the one-argument path; the negative sentinel does not.
        const FLAT_SWIMLANE_ARGUMENTS: readonly (number | null | undefined)[] = [
            undefined,
            null,
            SWIMLANE_ZERO,
        ];

        for (const swimlaneArgument of FLAT_SWIMLANE_ARGUMENTS) {
            it(`takes the FLAT path for ${String(swimlaneArgument)}`, () => {
                // Discriminating by construction: the first entry of this board's
                // rendered list is the OTHER swimlane, so a swimlane-scoped reading
                // of a zero or a null would have answered false. It answers true,
                // which is the flat path.
                expect(
                    selectShowPlaceholder(
                        makeEmptySwimlaneBoard(),
                        STATUS_FIRST,
                        swimlaneArgument,
                    ),
                ).toBe(true);
            });
        }

        it('takes the SWIMLANE path for the synthetic swimlane, whose negative id is truthy', () => {
            // The sentinel is truthy, so the swimlane condition applies and the
            // rendered list's first entry -- a real swimlane on this board -- does
            // not match it. The flat path would have answered true, so this answer
            // proves the guard let the sentinel through to the swimlane branch.
            expect(
                selectShowPlaceholder(
                    makeEmptySwimlaneBoard(),
                    STATUS_FIRST,
                    UNCLASSIFIED_SWIMLANE_ID,
                ),
            ).toBe(false);
        });

        it('leaves the synthetic swimlane ELIGIBLE and FIRST, yet never showing the placeholder', () => {
            // A CONSEQUENCE WORTH KNOWING BEFORE IT LOOKS LIKE A DEFECT, and the
            // incumbent behaves identically. The sentinel passes the guard and is
            // prepended at index 0, so it IS the entry the swimlane condition
            // accepts. But it only joins the list when some story belongs to no
            // swimlane [kanban-usertories.coffee:L284-L300], while the first
            // condition demands that the board hold no stories at all
            // [main.coffee:L317] -- so the two requirements exclude one another and
            // no state satisfies both. This is a property of the two rules, not a
            // difference introduced by the migration, and it is asserted rather
            // than "fixed" (T10).
            const state = makeBoard(
                [
                    makeStory({
                        id: 703,
                        status: STATUS_FIRST,
                        swimlane: null,
                        kanban_order: 1,
                    }),
                ],
                {
                    usStatusList: TWO_STATUSES,
                    swimlanes: [makeSwimlane({ id: SWIMLANE_A })],
                },
            );

            // Eligible and first.
            expect(swimlaneIdsOf(state)[0]).toBe(UNCLASSIFIED_SWIMLANE_ID);

            // And still false, because the board holds a story.
            expect(
                selectShowPlaceholder(
                    state,
                    STATUS_FIRST,
                    UNCLASSIFIED_SWIMLANE_ID,
                ),
            ).toBe(false);
        });
    });

    describe('the two empty-list guards', () => {
        // Both are additions. The source indexes the status list at
        // [main.coffee:L317] and takes the first swimlane at [:L320] without
        // checking either, so both would throw on an empty list. Returning false
        // replaces a crash and changes nothing on every non-empty input, which are
        // the only inputs the source survived (T10).
        it('answers false, without throwing, when the board has no statuses', () => {
            const state = makeState();

            expect(selectShowPlaceholder(state, STATUS_FIRST)).toBe(false);

            expect(
                selectShowPlaceholder(state, STATUS_FIRST, SWIMLANE_A),
            ).toBe(false);
        });

        it('answers false, without throwing, when a swimlane is named on a board with none', () => {
            expect(
                selectShowPlaceholder(
                    makeEmptyFlatBoard(),
                    STATUS_FIRST,
                    SWIMLANE_A,
                ),
            ).toBe(false);

            // The one-argument reading of the same board is unaffected.
            expect(
                selectShowPlaceholder(makeEmptyFlatBoard(), STATUS_FIRST),
            ).toBe(true);
        });
    });
});

/* ==========================================================================
 * SUITE 7 -- THE CARD VIEW MODEL
 *
 * Reproduces `retrieveUserStoryData` [kanban-usertories.coffee:L228-L252], which
 * the refresh pass applied to every story it walked [:L269-L270].
 * ========================================================================== */

describe('selectUsMap', () => {
    const RICH_STORY = 801;

    const PLAIN_STORY = 802;

    /**
     * Two tags, one of them with NO colour. Annotated so each literal is read as
     * the two-element TUPLE the API sends rather than as a loose array.
     */
    const TAGS: readonly Tag[] = [
        ['ux', SYNTHETIC_TAG_COLOR],
        ['no-colour', null],
    ];

    const THUMBNAIL_URL = 'https://example.invalid/thumbnail-card.png';

    function makeCardBoard(
        overrides: Partial<KanbanBoardState> = {},
    ): KanbanBoardState {
        return makeBoard(
            [
                makeStory({
                    id: RICH_STORY,
                    status: STATUS_FIRST,
                    swimlane: SWIMLANE_A,
                    kanban_order: 1,
                    assigned_to: USER_PRIMARY,
                    // The middle id is absent from the user map below.
                    assigned_users: [USER_PRIMARY, USER_MISSING, USER_THIRD],
                    tags: TAGS,
                    attachments: [
                        { thumbnail_card_url: null },
                        { thumbnail_card_url: '' },
                        { thumbnail_card_url: THUMBNAIL_URL },
                    ],
                    total_attachments: 3,
                }),
                makeStory({
                    id: PLAIN_STORY,
                    status: STATUS_FIRST,
                    swimlane: null,
                    kanban_order: 2,
                }),
            ],
            {
                // ONE USER PER KEY. See `makeUser` for why a list-valued entry would
                // be the wrong shape.
                usersById: {
                    [USER_PRIMARY]: makeUser(USER_PRIMARY),
                    [USER_THIRD]: makeUser(USER_THIRD),
                },
                foldStatusChanged: { [RICH_STORY]: true },
                swimlanes: [makeSwimlane({ id: SWIMLANE_A })],
                usStatusList: [makeStatus({ id: STATUS_FIRST })],
                ...overrides,
            },
        );
    }

    it('derives one view model per story, and none for a story the board does not hold', () => {
        const usMap = selectUsMap(makeCardBoard());

        expect(Object.keys(usMap)).toHaveLength(2);

        expect(usMap[RICH_STORY].id).toBe(RICH_STORY);

        expect(usMap[999]).toBeUndefined();
    });

    it('passes the story through as `model`, by reference', () => {
        // The source flattened a live model through its attribute getter before
        // storing it [kanban-usertories.coffee:L230/L234]. The story held in React
        // state is already plain -- precisely so a live model's dirty-tracking state
        // never gets frozen into board state -- so it is passed straight through.
        const state = makeCardBoard();

        expect(selectUsMap(state)[RICH_STORY].model).toBe(
            state.storiesById[RICH_STORY],
        );
    });

    describe('foldStatusChanged', () => {
        it('carries the recorded flag when the story has one', () => {
            expect(
                selectUsMap(makeCardBoard())[RICH_STORY].foldStatusChanged,
            ).toBe(true);
        });

        it('stays UNDEFINED when the story has none, rather than defaulting to false', () => {
            // [kanban-usertories.coffee:L232] reads the map and stores whatever comes
            // back, so a miss yields undefined. `../KanbanCard.tsx` distinguishes
            // the two states, so collapsing them would change which cards render
            // their fold affordance (T10).
            const vm = selectUsMap(makeCardBoard())[PLAIN_STORY];

            expect(vm.foldStatusChanged).toBeUndefined();

            expect(vm.foldStatusChanged).not.toBe(false);
        });
    });

    describe('images', () => {
        it('keeps only the attachments that carry a card thumbnail', () => {
            // [kanban-usertories.coffee:L235] filters on a double negation, so an
            // empty string is excluded exactly as a null is.
            expect(selectUsMap(makeCardBoard())[RICH_STORY].images).toEqual([
                { thumbnail_card_url: THUMBNAIL_URL },
            ]);
        });

        it('is empty for a story with no attachments', () => {
            expect(selectUsMap(makeCardBoard())[PLAIN_STORY].images).toEqual([]);
        });
    });

    describe('assigned_to', () => {
        it('resolves to the user OBJECT, not the raw id', () => {
            const state = makeCardBoard();

            expect(selectUsMap(state)[RICH_STORY].assigned_to).toBe(
                state.usersById[USER_PRIMARY],
            );

            // A single user per key, never a list of them: the helper that fills the
            // map assigns rather than accumulates
            // [app/coffee/utils.coffee:L80-L85].
            expect(
                Array.isArray(selectUsMap(state)[RICH_STORY].assigned_to),
            ).toBe(false);
        });

        it('is UNDEFINED when the story has no assignee', () => {
            // [kanban-usertories.coffee:L239] indexes the user map with a nullable
            // id and relies on the miss. Undefined, not null and not the raw number.
            expect(
                selectUsMap(makeCardBoard())[PLAIN_STORY].assigned_to,
            ).toBeUndefined();
        });

        it('is UNDEFINED when the assignee is no longer in the project', () => {
            const state = makeCardBoard({
                storiesById: indexById([
                    makeStory({
                        id: RICH_STORY,
                        status: STATUS_FIRST,
                        assigned_to: USER_MISSING,
                    }),
                ]),
                order: { [RICH_STORY]: 1 },
            });

            expect(selectUsMap(state)[RICH_STORY].assigned_to).toBeUndefined();
        });
    });

    describe('assigned_users', () => {
        it('MAY BE SHORTER than the id list, because only resolved users are kept', () => {
            // [kanban-usertories.coffee:L242-L245] pushes only the truthy lookups,
            // so a story referencing someone no longer in the project resolves to a
            // shorter list. Preserved as-is: padding it would put a hole in the
            // shared card's avatar row (T10).
            const state = makeCardBoard();

            const vm = selectUsMap(state)[RICH_STORY];

            expect(state.storiesById[RICH_STORY].assigned_users).toHaveLength(3);

            expect(vm.assigned_users).toHaveLength(2);

            expect(vm.assigned_users).toEqual([
                state.usersById[USER_PRIMARY],
                state.usersById[USER_THIRD],
            ]);
        });

        it('is empty for a story with no assigned users', () => {
            expect(
                selectUsMap(makeCardBoard())[PLAIN_STORY].assigned_users,
            ).toEqual([]);
        });
    });

    describe('assigned_users_preview', () => {
        function makeFiveUserBoard(): KanbanBoardState {
            const everyUserId: readonly number[] = [
                USER_PRIMARY,
                USER_THIRD,
                USER_FOURTH,
                USER_FIFTH,
                USER_SIXTH,
            ];

            const usersById: Record<number, BoardUser> = {};

            for (const userId of everyUserId) {
                usersById[userId] = makeUser(userId);
            }

            return makeBoard(
                [
                    makeStory({
                        id: RICH_STORY,
                        status: STATUS_FIRST,
                        assigned_users: everyUserId,
                        kanban_order: 1,
                    }),
                ],
                { usersById },
            );
        }

        it('carries AT MOST three resolved users', () => {
            // [kanban-usertories.coffee:L247] slices the resolved list.
            const vm = selectUsMap(makeFiveUserBoard())[RICH_STORY];

            expect(vm.assigned_users).toHaveLength(5);

            expect(vm.assigned_users_preview).toHaveLength(3);
        });

        it('is a PREFIX of the full resolved list', () => {
            // The shared card renders the preview but sizes its overflow badge from
            // the FULL list, showing `size - 2` at
            // [card-assigned-to.jade:L27/L38-L41], so the two members have to be
            // derived from one another or that badge counts wrongly.
            const vm = selectUsMap(makeFiveUserBoard())[RICH_STORY];

            expect(vm.assigned_users_preview).toEqual(
                vm.assigned_users.slice(0, 3),
            );

            expect(vm.assigned_users.length - 2).toBe(3);
        });

        it('is the whole list when there are fewer than three resolved users', () => {
            const state = makeCardBoard();

            const vm = selectUsMap(state)[RICH_STORY];

            expect(vm.assigned_users_preview).toEqual(vm.assigned_users);
        });
    });

    describe('colorized_tags', () => {
        it('maps the two-element TUPLE onto a named pair', () => {
            // [kanban-usertories.coffee:L249-L250]. A genuine transformation,
            // because the API sends a positional pair and the card wants members.
            expect(
                selectUsMap(makeCardBoard())[RICH_STORY].colorized_tags,
            ).toEqual([
                { name: 'ux', color: SYNTHETIC_TAG_COLOR },
                { name: 'no-colour', color: null },
            ]);
        });

        it('lets a NULL colour survive as null', () => {
            // Colour is DATA -- a per-project database value (T2, Drift Register
            // D3). On the null branch the markup emits no inline background at all
            // and the stylesheet paints the pill, so substituting a default here
            // would change how untagged colours render for every project.
            const colorizedTags =
                selectUsMap(makeCardBoard())[RICH_STORY].colorized_tags;

            expect(colorizedTags[1].color).toBeNull();
        });

        it('is empty for a story with no tags', () => {
            expect(
                selectUsMap(makeCardBoard())[PLAIN_STORY].colorized_tags,
            ).toEqual([]);
        });
    });

    describe('swimlane', () => {
        it('carries the story\u2019s own value, and null for an unclassified story', () => {
            const usMap = selectUsMap(makeCardBoard());

            expect(usMap[RICH_STORY].swimlane).toBe(SWIMLANE_A);

            expect(usMap[PLAIN_STORY].swimlane).toBeNull();

            expect(usMap[PLAIN_STORY].swimlane).not.toBe(
                UNCLASSIFIED_SWIMLANE_ID,
            );
        });
    });

    describe('loading-extra', () => {
        it('is NOT set by this derivation', () => {
            // It belongs to the shared card, which owns both the flag and the style
            // rule keyed on it, and that component is read-only for this migration
            // (T4): it also renders the out-of-scope taskboard. The member is
            // optional on the view-model type precisely so this derivation can leave
            // it out.
            const vm = selectUsMap(makeCardBoard())[RICH_STORY];

            expect('loading-extra' in vm).toBe(false);
        });
    });
});


/* ==========================================================================
 * SUITE 8 -- THE THREE REPEAT SHAPES
 *
 * The board walks three separate status lists:
 *   the column header band, over `s in usStatusList`   -- NOT one-time-bound;
 *   the swimlane columns, over `s in ::swimlanesStatuses[swimlane.id]`
 *     [kanban-table.jade:L114];
 *   the flat columns, over `s in ::usStatusList` [:L191].
 * Three contracts, three selectors, even where two of them read the same list --
 * collapsing them into one export would erase the distinction the template draws.
 * ========================================================================== */

describe('the status lists the board repeats over', () => {
    /**
     * Declared in an order that disagrees with ascending id, which is the point: the
     * board sorts the project's statuses by their `order` field
     * [main.coffee:L576] and the reducer stores the result as it arrives, so the
     * selectors must hand back this sequence untouched.
     */
    const ORDERED_STATUSES: readonly Status[] = [
        makeStatus({ id: STATUS_THIRD }),
        makeStatus({ id: STATUS_FIRST }),
        makeStatus({ id: STATUS_SECOND }),
    ];

    /**
     * The per-swimlane map as `loadSwimlanes` builds it [main.coffee:L552-L562]: one
     * entry per swimlane holding that swimlane's OWN statuses at [:L558], then an
     * entry for the synthetic swimlane holding ALL of the project's statuses at
     * [:L560]. That last entry takes the project's RAW status collection rather than
     * the ordered list, so the synthetic swimlane's columns can differ in ORDER from
     * the header band -- reproduced as it arrives, and not corrected.
     */
    function makeStatusBoard(): KanbanBoardState {
        return makeState({
            usStatusList: ORDERED_STATUSES,
            swimlanes: [makeSwimlane({ id: SWIMLANE_A })],
            swimlanesStatuses: {
                // The swimlane's own entry for the SAME status id deliberately
                // carries a DIFFERENT limit from the project-level entry above; see
                // the per-swimlane limit test below for why that matters.
                [SWIMLANE_A]: [
                    makeStatus({ id: STATUS_FIRST, wip_limit: 4 }),
                ],
                [UNCLASSIFIED_SWIMLANE_ID]: [
                    makeStatus({ id: STATUS_FIRST }),
                    makeStatus({ id: STATUS_SECOND }),
                    makeStatus({ id: STATUS_THIRD }),
                ],
            },
        });
    }

    it('hands the header band the board\u2019s status list, in the board\u2019s order', () => {
        const state = makeStatusBoard();

        expect(selectHeaderStatuses(state)).toBe(state.usStatusList);

        expect(selectHeaderStatuses(state).map((status) => status.id)).toEqual([
            STATUS_THIRD,
            STATUS_FIRST,
            STATUS_SECOND,
        ]);
    });

    it('does NOT re-sort the status list', () => {
        // T10 HAZARD, RECORDED HERE BECAUSE IT LOOKS LIKE AN INCONSISTENCY WORTH
        // TIDYING AND IS NOT. This screen sorts the project's statuses by their
        // `order` field [main.coffee:L576]; the backlog screen sorts THE SAME
        // project collection by `id` [app/coffee/modules/backlog/main.coffee:L482].
        // Two shipped orderings of one collection. DO NOT UNIFY THEM: each screen
        // renders the order its own users see today.
        const state = makeStatusBoard();

        const byAscendingId = [...state.usStatusList]
            .map((status) => status.id)
            .sort((left, right) => left - right);

        expect(selectHeaderStatuses(state).map((status) => status.id)).not.toEqual(
            byAscendingId,
        );
    });

    it('hands the flat columns the same list, through its own selector', () => {
        const state = makeStatusBoard();

        expect(selectFlatStatuses(state)).toBe(state.usStatusList);

        expect(selectFlatStatuses(state)).toEqual(selectHeaderStatuses(state));
    });

    it('hands a real swimlane its OWN statuses', () => {
        expect(
            selectSwimlaneStatuses(makeStatusBoard(), SWIMLANE_A).map(
                (status) => status.id,
            ),
        ).toEqual([STATUS_FIRST]);
    });

    it('hands a real swimlane the status records that carry ITS OWN limits', () => {
        // MEASURED ON THE RUNNING BOARD, and it is not a detail: a project stores a
        // work-in-progress limit PER SWIMLANE-AND-STATUS PAIR, alongside the
        // project-level one. On the seeded `project-1` every project-level
        // `wip_limit` is null while eight swimlane-level limits are set, and the
        // board's badges show a limit in exactly those eight cells -- the same
        // status reading a bare count in one swimlane and a count over a limit in
        // another.
        //
        // The board can only do that because the swimlane column repeat walks the
        // per-swimlane records [main.coffee:L558, kanban-table.jade:L114] rather
        // than the ordered project list, and reads `s.wip_limit` off THOSE. So this
        // derivation must hand back the swimlane's own records, limits included;
        // substituting the project-level list would silently show the wrong limit,
        // or none. The limit ARITHMETIC is not asserted here -- that belongs to
        // `../WipLimitMarker.test.tsx`; what is asserted is which records arrive.
        const state = makeStatusBoard();

        expect(selectSwimlaneStatuses(state, SWIMLANE_A)[0].wip_limit).toBe(4);

        expect(selectHeaderStatuses(state)[1].wip_limit).toBeNull();
    });

    it('hands the synthetic swimlane ALL of the project\u2019s statuses', () => {
        expect(
            selectSwimlaneStatuses(
                makeStatusBoard(),
                UNCLASSIFIED_SWIMLANE_ID,
            ).map((status) => status.id),
        ).toEqual([STATUS_FIRST, STATUS_SECOND, STATUS_THIRD]);
    });

    it('lets the synthetic swimlane\u2019s column order differ from the header band\u2019s', () => {
        // Because [main.coffee:L560] assigns the project's raw collection while
        // [:L576] sorts a copy of it for the band. Asserted so the difference reads
        // as reproduced rather than as a defect.
        const state = makeStatusBoard();

        expect(
            selectSwimlaneStatuses(state, UNCLASSIFIED_SWIMLANE_ID).map(
                (status) => status.id,
            ),
        ).not.toEqual(selectHeaderStatuses(state).map((status) => status.id));
    });

    it('hands an unrecognised swimlane an EMPTY list rather than nothing at all', () => {
        // So `../Swimlane.tsx` can walk the result without a guard, which is what
        // the template's unguarded read at [kanban-table.jade:L114] relies on.
        const state = makeStatusBoard();

        expect(selectSwimlaneStatuses(state, SWIMLANE_ABSENT)).toEqual([]);

        expect(selectSwimlaneStatuses(state, SWIMLANE_ABSENT)).toBe(
            selectSwimlaneStatuses(state, SWIMLANE_B),
        );
    });
});

/* ==========================================================================
 * SUITE 9 -- PER-CARD AND PER-COLUMN FLAGS
 *
 * These feed the class contract the existing stylesheets already target (T1):
 * the column fold map drives `vfold` and the unfolded column drives `vunfold`
 * [kanban-table.jade:L113/L190]; the selection drives both the selected-card class
 * and the multi-sortable marker [:L154/:L230]; the moved record drives the
 * move-to-top marker [:L154]; the archived-and-hidden pair drives the card's
 * archived state [:L167/:L242]. No class name is asserted here -- the components
 * own those.
 * ========================================================================== */

describe('the per-card and per-column flags', () => {
    describe('selectIsStatusFolded', () => {
        it('is true for a folded column and false for a column with no entry', () => {
            const state = makeState({ folds: { [STATUS_FIRST]: true } });

            expect(selectIsStatusFolded(state, STATUS_FIRST)).toBe(true);

            expect(selectIsStatusFolded(state, STATUS_SECOND)).toBe(false);
        });

        it('is false for an entry recorded as false', () => {
            // A missing entry and an explicit false both mean "not folded", and both
            // occur: the reducer writes the flag out when a column is unfolded.
            const state = makeState({ folds: { [STATUS_FIRST]: false } });

            expect(selectIsStatusFolded(state, STATUS_FIRST)).toBe(false);
        });
    });

    describe('selectIsStatusUnfolded', () => {
        it('is true only for the column most recently unfolded', () => {
            // At most one column holds this at a time, so it is a single value
            // compared against the column's id rather than a second map.
            const state = makeState({ unfold: STATUS_SECOND });

            expect(selectIsStatusUnfolded(state, STATUS_SECOND)).toBe(true);

            expect(selectIsStatusUnfolded(state, STATUS_FIRST)).toBe(false);
        });

        it('is false for every column when no column is unfolded', () => {
            const state = makeState({ unfold: null });

            expect(selectIsStatusUnfolded(state, STATUS_FIRST)).toBe(false);
        });
    });

    describe('selectIsSwimlaneFolded', () => {
        it('is true for a collapsed swimlane and false for one with no entry', () => {
            const state = makeState({ foldedSwimlane: { '7': true } });

            expect(selectIsSwimlaneFolded(state, SWIMLANE_A)).toBe(true);

            expect(selectIsSwimlaneFolded(state, SWIMLANE_B)).toBe(false);
        });

        it('is false for an entry recorded as false', () => {
            // The controller toggles the stored value at [main.coffee:L329], so an
            // expanded swimlane that was once collapsed holds an explicit false.
            const state = makeState({ foldedSwimlane: { '7': false } });

            expect(selectIsSwimlaneFolded(state, SWIMLANE_A)).toBe(false);
        });
    });

    describe('selectIsUsSelected', () => {
        it('is true for a selected card and false for one with no entry', () => {
            const state = makeState({ selectedUss: { 801: true } });

            expect(selectIsUsSelected(state, 801)).toBe(true);

            expect(selectIsUsSelected(state, 802)).toBe(false);
        });

        it('is false for an entry recorded as false', () => {
            // `cleanSelectedUss` writes false for every key rather than deleting it
            // [main.coffee:L105-L107], so both representations occur and both mean
            // "not selected".
            const state = makeState({ selectedUss: { 801: false } });

            expect(selectIsUsSelected(state, 801)).toBe(false);
        });
    });

    describe('selectIsUsMoved', () => {
        it('reports membership of the moved record', () => {
            // MEMBERSHIP ONLY -- the mode asymmetry is left to the caller. The
            // move-to-top marker is emitted in SWIMLANE MODE ONLY
            // [kanban-table.jade:L154] and the flat card omits it [:L230], even
            // though the controller records the move regardless of mode
            // [main.coffee:L167]. That is the shipped behaviour and this derivation
            // does not correct it: quietly supplying the marker in flat mode would
            // be a visual change to a screen that must look exactly as it does
            // today (T10).
            const state = makeState({ movedUs: [801, 803] });

            expect(selectIsUsMoved(state, 801)).toBe(true);

            expect(selectIsUsMoved(state, 803)).toBe(true);

            expect(selectIsUsMoved(state, 802)).toBe(false);
        });

        it('is false for every card once the record is cleared', () => {
            // The controller clears it on a deferred callback a second after the
            // move [main.coffee:L168-L170].
            expect(selectIsUsMoved(makeState({ movedUs: [] }), 801)).toBe(false);
        });
    });

    describe('selectIsUsInArchivedHiddenStatus', () => {
        // Reproduces [kanban-usertories.coffee:L116-L121]. BOTH conditions are
        // required: an archived status whose column is expanded shows its cards
        // normally, and the two lists are maintained independently.
        function makeArchivedBoard(
            overrides: Partial<KanbanBoardState>,
        ): KanbanBoardState {
            return makeBoard(
                [
                    makeStory({
                        id: 901,
                        status: STATUS_ARCHIVED,
                        kanban_order: 1,
                    }),
                ],
                {
                    usStatusList: [
                        makeStatus({ id: STATUS_ARCHIVED, is_archived: true }),
                    ],
                    ...overrides,
                },
            );
        }

        it('is true when the card\u2019s status is BOTH archived and hidden', () => {
            const state = makeArchivedBoard({
                archivedStatus: [STATUS_ARCHIVED],
                statusHide: [STATUS_ARCHIVED],
            });

            expect(selectIsUsInArchivedHiddenStatus(state, 901)).toBe(true);
        });

        it('is false when the status is archived but its column is expanded', () => {
            const state = makeArchivedBoard({
                archivedStatus: [STATUS_ARCHIVED],
                statusHide: [],
            });

            expect(selectIsUsInArchivedHiddenStatus(state, 901)).toBe(false);
        });

        it('is false when the status is hidden but not archived', () => {
            const state = makeArchivedBoard({
                archivedStatus: [],
                statusHide: [STATUS_ARCHIVED],
            });

            expect(selectIsUsInArchivedHiddenStatus(state, 901)).toBe(false);
        });

        it('is false for a card the board does not hold', () => {
            // The source resolved the story through the view-model map with an
            // optional read, so a miss left the status undefined and both membership
            // tests then failed. Returning false directly is the same answer by a
            // shorter route.
            const state = makeArchivedBoard({
                archivedStatus: [STATUS_ARCHIVED],
                statusHide: [STATUS_ARCHIVED],
            });

            expect(selectIsUsInArchivedHiddenStatus(state, 999)).toBe(false);
        });
    });
});


/* ==========================================================================
 * SUITE 10 -- PURITY, FROZEN INPUT AND REFERENCE BEHAVIOUR
 * ========================================================================== */

describe('purity and reference behaviour', () => {
    /** A board with enough shape for every derivation to do real work. */
    function makeFullBoard(): KanbanBoardState {
        return makeBoard(
            [
                makeStory({
                    id: 1001,
                    status: STATUS_FIRST,
                    swimlane: SWIMLANE_A,
                    kanban_order: 30,
                    assigned_to: USER_PRIMARY,
                    assigned_users: [USER_PRIMARY, USER_THIRD],
                    tags: [['ux', SYNTHETIC_TAG_COLOR]],
                    attachments: [{ thumbnail_card_url: null }],
                }),
                makeStory({
                    id: 1002,
                    status: STATUS_SECOND,
                    swimlane: SWIMLANE_B,
                    kanban_order: 10,
                }),
                makeStory({
                    id: 1003,
                    status: STATUS_FIRST,
                    swimlane: null,
                    kanban_order: 20,
                }),
            ],
            {
                swimlanes: [
                    makeSwimlane({ id: SWIMLANE_A }),
                    makeSwimlane({ id: SWIMLANE_B }),
                ],
                usStatusList: [
                    makeStatus({ id: STATUS_FIRST }),
                    makeStatus({ id: STATUS_SECOND }),
                ],
                swimlanesStatuses: {
                    [SWIMLANE_A]: [makeStatus({ id: STATUS_FIRST })],
                    [SWIMLANE_B]: [makeStatus({ id: STATUS_SECOND })],
                    [UNCLASSIFIED_SWIMLANE_ID]: [
                        makeStatus({ id: STATUS_FIRST }),
                        makeStatus({ id: STATUS_SECOND }),
                    ],
                },
                usersById: {
                    [USER_PRIMARY]: makeUser(USER_PRIMARY),
                    [USER_THIRD]: makeUser(USER_THIRD),
                },
                folds: { [STATUS_SECOND]: true },
                unfold: STATUS_FIRST,
                foldedSwimlane: { '8': true },
                selectedUss: { 1001: true },
                movedUs: [1002],
                statusHide: [STATUS_SECOND],
                archivedStatus: [STATUS_SECOND],
            },
        );
    }

    /**
     * Every exported derivation, called once. Used by the frozen-input case and the
     * no-mutation case so neither can drift out of step with the module's surface.
     */
    function callEverySelector(state: KanbanBoardState): void {
        selectSwimlanesList(state);
        selectHasSwimlanes(state);
        selectSwimlanesListCount(state);
        selectUsByStatus(state);
        selectUsByStatusSwimlanes(state);
        selectUsMap(state);
        selectColumnCards(state, STATUS_FIRST);
        selectColumnCards(state, STATUS_FIRST, SWIMLANE_A);
        selectColumnCards(state, STATUS_FIRST, UNCLASSIFIED_SWIMLANE_ID);
        selectShowPlaceholder(state, STATUS_FIRST);
        selectShowPlaceholder(state, STATUS_FIRST, SWIMLANE_A);
        selectHeaderStatuses(state);
        selectFlatStatuses(state);
        selectSwimlaneStatuses(state, SWIMLANE_A);
        selectIsStatusFolded(state, STATUS_FIRST);
        selectIsStatusUnfolded(state, STATUS_FIRST);
        selectIsSwimlaneFolded(state, SWIMLANE_A);
        selectIsUsSelected(state, 1001);
        selectIsUsMoved(state, 1001);
        selectIsUsInArchivedHiddenStatus(state, 1001);
    }

    it('builds its fixtures DEEP-FROZEN, exactly as production state arrives', () => {
        // The mechanism, made visible: the board composes its reducer as
        // `produce(reducer)` with auto-freezing on, so every state a selector ever
        // sees is frozen. Fixtures here go through `produce` for that reason and no
        // other.
        const state = makeFullBoard();

        expect(Object.isFrozen(state)).toBe(true);

        expect(Object.isFrozen(state.swimlanes)).toBe(true);

        expect(Object.isFrozen(state.usStatusList)).toBe(true);

        expect(Object.isFrozen(state.storiesById[1001])).toBe(true);
    });

    it('runs EVERY derivation against frozen state without throwing, which is what catches an in-place sort', () => {
        // THE POINT OF THIS TEST, stated so it is not "simplified" away later. Two
        // derivations hand back one of the board's OWN arrays -- the swimlane list
        // when nothing is unclassified, and the status list for both column repeats.
        // A derivation that sorted or otherwise rewrote such an array in place would
        // throw here, and nothing in the type system would have found it: the
        // declared types are read-only, and a read-only array is only a
        // compile-time promise.
        expect(() => callEverySelector(makeFullBoard())).not.toThrow();

        // A board with NO swimlanes takes the other branch of every mode test, and
        // its two stories are ordered against ascending id so the sort does real
        // work, so it is exercised frozen too.
        expect(() =>
            callEverySelector(
                makeBoard(
                    [
                        makeStory({
                            id: 1004,
                            status: STATUS_FIRST,
                            kanban_order: 2,
                        }),
                        makeStory({
                            id: 1005,
                            status: STATUS_FIRST,
                            kanban_order: 1,
                        }),
                    ],
                    { usStatusList: [makeStatus({ id: STATUS_FIRST })] },
                ),
            ),
        ).not.toThrow();
    });

    it('leaves the state it was given completely unchanged', () => {
        const state = makeFullBoard();

        const before = JSON.stringify(state);

        callEverySelector(state);

        expect(JSON.stringify(state)).toBe(before);
    });

    it('derives a fresh grouping on each call, because nothing here is memoised', () => {
        // UNCACHED ON PURPOSE, and this assertion matches the shipped module rather
        // than an intention. `boardSelectors.ts` records the reasoning: no
        // performance improvement is promised by this migration and the
        // minimal-change rule forbids optimising past the requirement; a
        // reference-keyed cache would hand a stale result to a caller that edited a
        // fixture in place; and the sibling backlog selectors are uncached, so this
        // matches them. Structural sharing plus the components' own memo boundaries
        // do the caching where it is observable (P-IMMER-4).
        const state = makeFullBoard();

        expect(selectUsByStatus(state)).toEqual(selectUsByStatus(state));

        expect(selectUsByStatusSwimlanes(state)).toEqual(
            selectUsByStatusSwimlanes(state),
        );

        expect(selectUsMap(state)).toEqual(selectUsMap(state));
    });

    it('preserves the references it documents as stable', () => {
        // Four promises the module makes, each one worth a memo boundary at the
        // consumer, and each asserted rather than assumed.
        const withUnclassified = makeFullBoard();

        const classifiedOnly = makeBoard(
            [
                makeStory({
                    id: 1006,
                    status: STATUS_FIRST,
                    swimlane: SWIMLANE_A,
                    kanban_order: 1,
                }),
            ],
            { swimlanes: [makeSwimlane({ id: SWIMLANE_A })] },
        );

        const flat = makeBoard([
            makeStory({ id: 1007, status: STATUS_FIRST, kanban_order: 1 }),
        ]);

        // 1. The board's own swimlane array, when no story is unclassified.
        expect(selectSwimlanesList(classifiedOnly)).toBe(
            classifiedOnly.swimlanes,
        );

        // 2. The empty swimlane list in flat mode.
        expect(selectSwimlanesList(flat)).toBe(selectSwimlanesList(flat));

        // 3. The synthetic entry, held as a module constant.
        expect(selectSwimlanesList(withUnclassified)[0]).toBe(
            selectSwimlanesList(withUnclassified)[0],
        );

        // 4. The empty column and the empty status list.
        expect(selectColumnCards(flat, STATUS_OFF_LIST)).toBe(
            selectColumnCards(flat, STATUS_OFF_LIST),
        );

        expect(selectSwimlaneStatuses(flat, SWIMLANE_ABSENT)).toBe(
            selectSwimlaneStatuses(flat, SWIMLANE_ABSENT),
        );
    });

    it('answers for the state it is given, with no result carried over from the previous call', () => {
        // Guards against a module-local cache being introduced without an
        // invalidation story: the second answer has to be the second board's.
        const first = makeBoard(
            [makeStory({ id: 1008, status: STATUS_FIRST, kanban_order: 1 })],
            { usStatusList: [makeStatus({ id: STATUS_FIRST })] },
        );

        const second = makeBoard(
            [
                makeStory({ id: 1009, status: STATUS_FIRST, kanban_order: 1 }),
                makeStory({ id: 1010, status: STATUS_FIRST, kanban_order: 2 }),
            ],
            { usStatusList: [makeStatus({ id: STATUS_FIRST })] },
        );

        expect(selectUsByStatus(first)[String(STATUS_FIRST)]).toEqual([1008]);

        expect(selectUsByStatus(second)[String(STATUS_FIRST)]).toEqual([
            1009, 1010,
        ]);

        expect(selectColumnCards(first, STATUS_FIRST).count).toBe(1);

        expect(selectColumnCards(second, STATUS_FIRST).count).toBe(2);

        // And back again, so the order the two boards are visited in cannot matter.
        expect(selectUsByStatus(first)[String(STATUS_FIRST)]).toEqual([1008]);
    });

    it('recomputes from the branch that changed, leaving the untouched branch equal', () => {
        // Structural sharing in practice: a change confined to one branch of the
        // state leaves every derivation that does not read that branch answering
        // exactly as before. Deep equality, because the derivations are uncached --
        // see the memoisation case above.
        const before = makeFullBoard();

        const after = produce(before, (draft) => {
            draft.renderInProgress = true;
        });

        expect(after).not.toBe(before);

        expect(selectUsByStatus(after)).toEqual(selectUsByStatus(before));

        expect(selectUsMap(after)).toEqual(selectUsMap(before));

        // The story map itself was not touched, so it keeps its reference and the
        // derivations that read it see an unchanged input.
        expect(after.storiesById).toBe(before.storiesById);
    });

    describe('an empty board', () => {
        it('yields empty structures from every derivation, with no error', () => {
            const state = makeState();

            expect(() => callEverySelector(state)).not.toThrow();

            expect(selectSwimlanesList(state)).toEqual([]);

            expect(selectSwimlanesListCount(state)).toBe(0);

            expect(selectHasSwimlanes(state)).toBe(false);

            expect(selectUsByStatus(state)).toEqual({});

            expect(selectUsByStatusSwimlanes(state)).toEqual({});

            expect(selectUsMap(state)).toEqual({});

            expect(selectHeaderStatuses(state)).toEqual([]);

            expect(selectFlatStatuses(state)).toEqual([]);

            expect(selectSwimlaneStatuses(state, SWIMLANE_A)).toEqual([]);
        });

        it('yields a numeric zero count, never a non-numeric one', () => {
            const column = selectColumnCards(makeState(), STATUS_FIRST);

            expect(column.count).toBe(0);

            expect(Number.isNaN(column.count)).toBe(false);

            expectColumnConsistency(column);

            const swimlaneColumn = selectColumnCards(
                makeState(),
                STATUS_FIRST,
                SWIMLANE_A,
            );

            expect(swimlaneColumn.count).toBe(0);

            expect(Number.isNaN(swimlaneColumn.count)).toBe(false);
        });

        it('answers false for every flag and for the placeholder', () => {
            const state = makeState();

            expect(selectShowPlaceholder(state, STATUS_FIRST)).toBe(false);

            expect(selectIsStatusFolded(state, STATUS_FIRST)).toBe(false);

            expect(selectIsStatusUnfolded(state, STATUS_FIRST)).toBe(false);

            expect(selectIsSwimlaneFolded(state, SWIMLANE_A)).toBe(false);

            expect(selectIsUsSelected(state, 1001)).toBe(false);

            expect(selectIsUsMoved(state, 1001)).toBe(false);

            expect(selectIsUsInArchivedHiddenStatus(state, 1001)).toBe(false);
        });
    });
});

