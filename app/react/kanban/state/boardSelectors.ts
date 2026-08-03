/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Every derived view of the Kanban board, as pure functions of `KanbanBoardState`.
 *
 * WHAT THIS REPLACES
 * The incumbent published four derived collections onto the controller scope through the
 * `taiga` immutable-property scope helper -- `usByStatus`, `usMap`, `usByStatusSwimlanes`
 * and `swimlanesList`, defined one per statement at
 * [app/coffee/modules/kanban/main.coffee:L93/L96/L99/L102, block L93-L103] -- each one a
 * live window onto a field the `tgKanbanUserstories` service mutated in place. Those four
 * fields were produced by
 * [app/coffee/modules/kanban/kanban-usertories.coffee:L254-L275] (`refresh`),
 * [:L277-L317] (`refreshSwimlanes`) and [:L228-L252] (`retrieveUserStoryData`), and the
 * board's empty-state gate by [app/coffee/modules/kanban/main.coffee:L316-L323]
 * (`showPlaceHolder`). All of that logic lives here now, as derivations.
 *
 * NO REDUCER FIELD CACHES ANY OF IT. `./boardReducer.ts` stores only normalised board
 * facts (`storiesById`, `order`, `swimlanes`, ...); every grouping below is recomputed
 * from those facts on demand. That is deliberate: a cached grouping in the reducer would
 * have to be invalidated by hand on each of the twenty-odd actions, which is exactly the
 * class of bug the four live scope properties existed to avoid.
 *
 * THE FRAMEWORK SEAM
 * The CoffeeScript service builds those collections with a persistent-collection library
 * [kanban-usertories.coffee:L23-L25], and the board template reads their own length
 * property (`size`). Those structures stay on the controller scope for the templates and
 * for the shared card controller that still reads them; they are flattened with a toJS
 * call at the `react-bridge.coffee` seam, so THIS FOLDER SEES PLAIN OBJECTS AND PLAIN
 * ARRAYS ONLY. Consequently every length below is a plain array `length`, and no nested
 * two-key accessor appears -- a nested read is spelled as two ordinary lookups. The
 * library is not named in this folder because the folder is verified to contain zero
 * references to it; do not reintroduce one.
 *
 * THE KEY-TYPE ASYMMETRY -- DO NOT NORMALISE IT
 * The three maps below are keyed differently, and the difference is load-bearing. It is
 * proved by a single if/else in `moveUsToTop`
 * [app/coffee/modules/kanban/main.coffee:L172-L178]: the swimlane branch reads
 * `[us.swimlane, us.status]` with both keys NUMERIC, while the flat branch reads
 * `us.status.toString()` -- a STRING. See each derivation for its own proof. Collapsing
 * them onto one key type silently empties every column, because a plain-object lookup
 * with the wrong key type simply misses. `Record<number, ...>` versus
 * `Record<string, ...>` is erased at run time, so the declarations here are a
 * documentation-and-discipline device rather than a run-time guarantee: they exist to
 * stop the next reader writing `usByStatus[statusId]` where the incumbent wrote
 * `.get(String(statusId))`.
 *
 * FORM
 * Pure functions, no state, no input mutation, no side effects, no timers, no
 * environment access. Importable by a plain unit spec with no React involvement, which
 * is what keeps the eleven sibling components in `../` pure functions of their props.
 *
 * The board state arrives frozen (the reducer runs under a producer with auto-freezing
 * on), so an in-place sort would throw at run time with nothing in the type system to
 * catch it. Every sort below therefore copies first.
 *
 * NOT MEMOISED, ON PURPOSE. Auto-freezing gives structural sharing, so an untouched
 * branch of the state keeps its reference and the components' own memo boundaries do the
 * caching where it is observable. A module-local last-input cache was considered and
 * rejected on three grounds: no performance improvement is promised by this migration and
 * the minimal-change rule forbids optimising past the requirement; a reference-keyed
 * entry would return a stale result for a caller that edited a fixture in place instead
 * of rebuilding it; and the sibling `../../backlog/state/backlogSelectors.ts` is
 * uncached, so this matches it.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * `notFoundUserstories` and `renderInProgress` get no selector: both are already plain
 * booleans on the state, read straight through by the not-found class
 * [kanban-table.jade:L146/L222] and the counter's disabled binding [:L127/L203], so a
 * pass-through would add a name without adding meaning.
 *
 * Card visibility belongs to the in-viewport hook in `../../shared/`; drop-position and
 * neighbour arithmetic to the sortable-list hook in `../../shared/dnd/`; every request and
 * request body to `../../shared/api/`; fold persistence to
 * `../../shared/api/kanbanStorage.ts`; the limit-marker ladder to
 * `../WipLimitMarker.tsx`. None of them is duplicated here.
 *
 * READING THE CITATIONS
 * Every `[path:Lnn]` below points at the ORIGINAL pre-migration line in that file. The
 * CoffeeScript sources cited here gained explanatory comments during this migration, so
 * their current line numbers have shifted; the original numbers are the ones the migration
 * plan uses throughout, so they are the ones used here.
 */

import { UNCLASSIFIED_SWIMLANE_ID } from './boardReducer';
import type {
    BoardUser,
    CardUserStoryVm,
    ColorizedTag,
    KanbanBoardState,
    SwimlaneListEntry,
    UsByStatus,
    UsByStatusSwimlanes,
    UsMap,
} from './types';
import type { Status } from '../../shared/types/status';
import type { UserStory } from '../../shared/types/userStory';

/**
 * The card view model carries at most three resolved avatars
 * [kanban-usertories.coffee:L247], while the full resolved list it is sliced from stays
 * available so the shared card can render its overflow badge from the difference.
 */
const ASSIGNED_USERS_PREVIEW_LIMIT = 3;

/**
 * The synthetic swimlane's `name` is a TRANSLATION KEY, not display text. The incumbent
 * resolved it eagerly through the translation service at
 * [kanban-usertories.coffee:L298], which forced the service to depend on that service
 * purely to build a label. Here the key travels unresolved and `../SwimlaneHeader.tsx`
 * translates it at render time, so this module stays free of React and of the bridge.
 */
const UNCLASSIFIED_SWIMLANE_NAME_KEY = 'KANBAN.UNCLASSIFIED_USER_STORIES';

/** Verbatim from the synthetic swimlane literal at [kanban-usertories.coffee:L297]. */
const UNCLASSIFIED_SWIMLANE_KANBAN_ORDER = 1;

/**
 * The swimlane that collects stories belonging to none, built at
 * [kanban-usertories.coffee:L295-L299]. Held as a module constant so repeated calls hand
 * back the same reference, which lets a consumer's memo boundary see an unchanged entry.
 *
 * Its id is the sentinel exported by `./boardReducer`, imported rather than written
 * inline so there is exactly one definition of it in this folder.
 */
const UNCLASSIFIED_SWIMLANE_ENTRY: SwimlaneListEntry = {
    id: UNCLASSIFIED_SWIMLANE_ID,
    kanban_order: UNCLASSIFIED_SWIMLANE_KANBAN_ORDER,
    name: UNCLASSIFIED_SWIMLANE_NAME_KEY,
};

/** Stable empty results, so a miss never allocates and never breaks reference equality. */
const NO_SWIMLANES: readonly SwimlaneListEntry[] = [];
const NO_SWIMLANE_GROUPS: UsByStatusSwimlanes = {};
const NO_STATUSES: readonly Status[] = [];

/**
 * Reads a numerically keyed record WITHOUT asserting the key is present.
 *
 * `noUncheckedIndexedAccess` is off in `tsconfig.json`, so a bare index expression is
 * typed as though every key existed. Routing lookups through a helper whose declared
 * return type admits `undefined` restores the honest type at the one place it matters,
 * with no assertion and no escape hatch.
 */
function lookup<TValue>(
    record: Readonly<Record<number, TValue>>,
    key: number,
): TValue | undefined {
    return record[key];
}

/** The string-keyed counterpart of {@link lookup}; see that comment for the rationale. */
function lookupByName<TValue>(
    record: Readonly<Record<string, TValue>>,
    key: string,
): TValue | undefined {
    return record[key];
}

/**
 * Mirrors the private order reader in `./boardReducer.ts`: a missing or non-finite entry
 * counts as zero.
 *
 * The incumbent sorted with a helper that placed a missing key LAST
 * [kanban-usertories.coffee:L255]. Zero places it FIRST instead, and the difference is
 * deliberate -- the reducer's move arithmetic already treats a missing order as zero, so
 * matching the sorting helper here would make a column's rendered order disagree with the
 * order the reducer just computed for it, which would show up as a card jumping after a
 * drag. The case is unreachable in practice: the reducer rebuilds `order` from the same
 * story set it rebuilds `storiesById` from, so every story has an entry.
 */
function readOrder(order: KanbanBoardState['order'], storyId: number): number {
    const value = lookup(order, storyId);

    if (value === undefined || !Number.isFinite(value)) {
        return 0;
    }

    return value;
}

/**
 * Orders stories the way the board does, copying first because the state is frozen.
 *
 * Ties keep the order the input arrived in, which for the object-values enumeration below
 * is ascending story id. The incumbent's tie-break was the position in its own raw array,
 * itself the order the collection endpoint returned. Both are deterministic; the
 * distinction is only visible when two cards carry the same order value, which happens on
 * a freshly seeded column.
 */
function sortStoriesByOrder(
    stories: readonly UserStory[],
    order: KanbanBoardState['order'],
): readonly UserStory[] {
    return [...stories].sort(
        (left, right) => readOrder(order, left.id) - readOrder(order, right.id),
    );
}

/** Every story on the board, in no particular order. */
function allStories(state: KanbanBoardState): readonly UserStory[] {
    return Object.values(state.storiesById);
}

/**
 * Whether a story belongs to no swimlane.
 *
 * [kanban-usertories.coffee:L285] tests `us.swimlane == null` and [:L313] compares with
 * the same loose operator, which in CoffeeScript matches BOTH `null` and `undefined`.
 * That is reproduced with two strict comparisons rather than one loose one, so the
 * behaviour is identical and the intent is explicit. It is emphatically NOT a falsy test:
 * zero is a legitimate swimlane id and must not be swept in here.
 *
 * The parameter admits `undefined` even though the story type does not, because the
 * loose comparison being reproduced did.
 */
function isUnclassified(swimlane: UserStory['swimlane'] | undefined): boolean {
    return swimlane === null || swimlane === undefined;
}

/**
 * Whether a call is scoped to one swimlane, reproducing the incumbent's FALSY guards
 * exactly.
 *
 * The module tests a swimlane id for truthiness in three places -- `if us.swimlane`
 * [main.coffee:L172], `if swimlaneId` [main.coffee:L319] and `!swimlaneId`
 * [kanban-usertories.coffee:L132]. Zero, `null` and `undefined` all take the flat path,
 * and the unclassified sentinel -- being negative, therefore truthy -- takes the swimlane
 * path. Preserved verbatim: normalising these into null checks would route a board whose
 * first swimlane happened to be identified as zero down the wrong branch, and would make
 * the synthetic swimlane invisible to the derivations that depend on it being scoped.
 */
function isSwimlaneScoped(
    swimlaneId: number | null | undefined,
): swimlaneId is number {
    return Boolean(swimlaneId);
}

/**
 * The rendered swimlane list: the project's swimlanes, with the synthetic unclassified
 * swimlane prepended when -- and only when -- at least one story belongs to no swimlane.
 *
 * Reproduces the NET behaviour of [kanban-usertories.coffee:L277-L305].
 *
 * FLAT MODE RETURNS AN EMPTY LIST. [:L278-L279] returns early when the project has no
 * swimlanes, and because [:L281] had already emptied the list on the previous pass, flat
 * mode leaves it structurally absent rather than merely unpopulated. The board template
 * gates the whole swimlane branch on this list being non-empty
 * [kanban-table.jade:L74/L185], so an empty list IS the flat-mode signal.
 *
 * THE SOURCE GUARD AT [:L287-L290] IS DOUBLY DEAD AND IS DELIBERATELY NOT TRANSCRIBED.
 * It filters the list for an entry whose id is null and requires that filter to be empty.
 * The filter can never find one: [:L281] empties the list two statements earlier, so the
 * result is always empty and its length always zero. And even on a populated list the
 * predicate could not match, because the only entry that could have been sought is the
 * synthetic one, whose id is the negative sentinel rather than null. So the compound
 * condition reduces exactly to "there is at least one unclassified story", which is what
 * is implemented. This note exists because the two failure modes are symmetric:
 * transcribing the guard ships dead code, and deleting it silently invites the next reader
 * to restore it.
 *
 * The source prepends with the persistent list's own `insert(0, entry)` method
 * [:L300]. That method DOES NOT EXIST on a plain array -- it is one of the accessors that
 * looks portable and is not -- so the prepend is spelled as a spread instead. `unshift`
 * is not an option either: it mutates, and this input is frozen.
 *
 * The membership test the source wraps each push in [:L292/L304] is a second no-op, for a
 * reason worth recording next to the dead guard above: it starts from the list emptied at
 * [:L281] and walks the project's swimlane collection once, so it could only fire if that
 * collection held the SAME OBJECT twice, which the collection endpoint cannot produce.
 * It is not reproduced, and reproducing it would also cost the reference-preserving return
 * below.
 */
export function selectSwimlanesList(
    state: KanbanBoardState,
): readonly SwimlaneListEntry[] {
    if (state.swimlanes.length === 0) {
        return NO_SWIMLANES;
    }

    // [:L284-L285]: the synthetic swimlane earns its place only when something would
    // otherwise have nowhere to appear.
    const hasUnclassifiedStories = allStories(state).some((story) =>
        isUnclassified(story.swimlane),
    );

    if (!hasUnclassifiedStories) {
        // The else branch at [:L302-L305] pushes the real swimlanes in their existing
        // order and nothing else. Returning the state's own array preserves its reference,
        // which a consumer's memo boundary can take advantage of.
        return state.swimlanes;
    }

    return [UNCLASSIFIED_SWIMLANE_ENTRY, ...state.swimlanes];
}

/**
 * Whether the board renders in swimlane mode.
 *
 * The template's gate is the rendered list being non-empty
 * [kanban-table.jade:L74/L185], so this is derived from {@link selectSwimlanesList}
 * rather than from the raw swimlane array -- the two agree today, and deriving from the
 * list keeps them agreeing if the list's composition ever changes.
 *
 * Read as a plain array `length`. The list handed to the templates is a persistent
 * collection with its own length property, and five call sites still read it that way --
 * including the shared card controller, which must not be touched. This folder is on the
 * far side of the flattening seam and sees plain arrays only.
 */
export function selectHasSwimlanes(state: KanbanBoardState): boolean {
    return selectSwimlanesList(state).length > 0;
}

/**
 * How many entries the rendered swimlane list has, INCLUDING the synthetic one.
 *
 * Backs the template's create-a-swimlane hint, which fires for an administrator while the
 * rendered list still holds one entry or fewer [kanban-table.jade:L177]. Exposed as a
 * count rather than as a second boolean so the consumer can apply its own comparison.
 *
 * NOT INTERCHANGEABLE with the project's own swimlane count. The default-swimlane marker
 * [kanban-table.jade:L102] gates on `project.swimlanes.length`, which excludes the
 * synthetic entry; that number is a project fact the container passes down, and
 * `../SwimlaneHeader.tsx` receives it separately. Feeding this count there would show the
 * marker one swimlane too early.
 */
export function selectSwimlanesListCount(state: KanbanBoardState): number {
    return selectSwimlanesList(state).length;
}

/**
 * Flat-mode card grouping: STRING status key -> card ids in board order.
 *
 * Reproduces [kanban-usertories.coffee:L254-L275] (`refresh`).
 *
 * THE KEYS ARE STRINGS, and that is not a stylistic choice. [:L261/L264/L267] index a
 * plain object with a NUMBER (`collection[usModel.status]`), which the language coerces to
 * a string property name; [:L272] then wraps that object, producing a string-keyed map.
 * Every consumer reads it back the same way -- the counter at
 * [kanban-table.jade:L204/L211] and the card repeat at [:L229] all go through
 * `.get(s.id.toString())`.
 *
 * SORT FIRST, THEN GROUP. [:L255] orders the whole story set before [:L257] starts
 * grouping, so a column's order comes from the board order and NOT from the order stories
 * happened to be encountered in. Inverting the two reorders every column.
 *
 * The remove-then-append pair is transcribed in source order: [:L264] drops the story's
 * own id from the bucket before [:L267] pushes it back. The net effect matches
 * de-duplicating and appending, and it is written this way to stay recognisable against
 * the source rather than to be clever.
 */
export function selectUsByStatus(state: KanbanBoardState): UsByStatus {
    const orderedStories = sortStoriesByOrder(allStories(state), state.order);

    const collection: Record<string, number[]> = {};

    for (const story of orderedStories) {
        const statusKey = String(story.status);

        // Falsy test, exactly as [:L261]: an existing bucket is truthy even when empty, so
        // this creates each bucket once.
        if (!collection[statusKey]) {
            collection[statusKey] = [];
        }

        collection[statusKey] = collection[statusKey].filter(
            (cardId) => cardId !== story.id,
        );

        collection[statusKey].push(story.id);
    }

    return collection;
}

/**
 * Swimlane-mode card grouping: NUMERIC swimlane id -> NUMERIC status id -> card ids.
 *
 * Reproduces [kanban-usertories.coffee:L277-L317] (`refreshSwimlanes`).
 *
 * FLAT MODE IS ABSENT, NOT EMPTY. [:L278-L279] returns before touching this structure, so
 * on a board without swimlanes it is never populated at all. An empty record is returned
 * to say so; the templates gate on {@link selectHasSwimlanes} and never inspect the
 * contents.
 *
 * BOTH KEY LEVELS ARE NUMERIC, and neither matches the string keys of
 * {@link selectUsByStatus}. The outer key is the raw swimlane id straight from the entry
 * [:L317], INCLUDING the negative sentinel of the synthetic swimlane -- which is why the
 * sentinel is a legitimate grouping key even though it is never a story's own swimlane
 * value. The inner key is numeric through an explicit numeric conversion of the flat
 * grouping's string key [:L315]. Consumers read both numerically, at
 * [kanban-table.jade:L128/L135] and [:L153].
 *
 * ORDERING NEEDS NO SECOND SORT. [:L309] iterates the flat grouping, which is already in
 * board order, and filtering preserves relative order, so each inner list is ordered by
 * construction. Sorting again here would be redundant work that could only introduce a
 * disagreement.
 *
 * COVERAGE OF STATUSES IS INHERITED, TOO. [:L315] assigns unconditionally, so a status
 * with stories somewhere on the board gets an entry in EVERY swimlane -- an empty array
 * where that swimlane has none of them -- while a status with no stories at all appears in
 * neither grouping. {@link selectColumnCards} is where that distinction is resolved.
 */
export function selectUsByStatusSwimlanes(
    state: KanbanBoardState,
): UsByStatusSwimlanes {
    if (state.swimlanes.length === 0) {
        return NO_SWIMLANE_GROUPS;
    }

    const usByStatus = selectUsByStatus(state);

    const bySwimlane: Record<number, Record<number, readonly number[]>> = {};

    for (const swimlane of selectSwimlanesList(state)) {
        // [:L312] maps the synthetic swimlane back onto the value a story actually
        // carries. A story's own swimlane spells unclassified as null and NEVER as the
        // sentinel, so the translation has to happen before the comparison.
        const storySwimlaneId =
            swimlane.id === UNCLASSIFIED_SWIMLANE_ID ? null : swimlane.id;

        const byStatus: Record<number, readonly number[]> = {};

        for (const [statusKey, cardIds] of Object.entries(usByStatus)) {
            byStatus[Number(statusKey)] = cardIds.filter((cardId) =>
                belongsToSwimlane(state, cardId, storySwimlaneId),
            );
        }

        bySwimlane[swimlane.id] = byStatus;
    }

    return bySwimlane;
}

/**
 * Whether a card sits in the given swimlane, where null means "in none of them".
 *
 * [:L310-L313] resolves the card through the view-model map and reads the swimlane out of
 * its nested `model`; here the raw story is read straight from `storiesById`, which is the
 * same value one indirection earlier.
 *
 * A missing story yields false. The source would have thrown on that branch -- it calls a
 * nested accessor on the lookup result without checking it -- and the branch is
 * unreachable either way, because the card ids being filtered were derived from
 * `storiesById` in the first place. Replacing a crash with false changes nothing
 * observable and keeps this module total.
 */
function belongsToSwimlane(
    state: KanbanBoardState,
    cardId: number,
    swimlaneId: number | null,
): boolean {
    const story = lookup(state.storiesById, cardId);

    if (story === undefined) {
        return false;
    }

    if (swimlaneId === null) {
        return isUnclassified(story.swimlane);
    }

    return story.swimlane === swimlaneId;
}

/**
 * One card view model per story, keyed NUMERICALLY by story id.
 *
 * Reproduces [kanban-usertories.coffee:L228-L252] (`retrieveUserStoryData`), which the
 * refresh pass applied to every story it walked [:L269-L270].
 *
 * THE KEYS ARE NUMBERS, unlike {@link selectUsByStatus}. Every write in the source uses
 * the raw numeric story id [:L180/L215/L226/L270], and every consumer reads it back with
 * the raw numeric id the card repeat yields
 * [kanban-table.jade:L160/L163/L238]. Third distinct key convention, third proof; see the
 * key-type note at the top of this file.
 *
 * The incumbent's map ACCUMULATED: the refresh pass set entries for the stories it walked
 * and only story removal [:L60-L73] ever deleted one, so a view model could outlive its
 * story until the next full pass. Deriving the whole map from `storiesById` means a removed
 * story simply has no view model, which is what the reducer's removal action already
 * establishes -- a strictly narrower result, never a wider one.
 */
export function selectUsMap(state: KanbanBoardState): UsMap {
    const usMap: Record<number, CardUserStoryVm> = {};

    for (const story of allStories(state)) {
        usMap[story.id] = buildCardUserStoryVm(state, story);
    }

    return usMap;
}

/**
 * Builds the view model the shared card component consumes, member by member, from
 * [kanban-usertories.coffee:L228-L252].
 *
 * `model` [:L230/L234] -- the source flattened a live model through its attribute getter
 * before storing it. The story held here is already plain, precisely so that a model's
 * dirty-tracking state never gets frozen into board state, so it is passed straight
 * through.
 *
 * `foldStatusChanged` [:L232] -- STAYS `undefined` WHEN THE STORY HAS NO ENTRY. It is not
 * defaulted to false: a plain-object miss yields `undefined`, the declared member type
 * admits it, and `../KanbanCard.tsx` distinguishes the two states. Collapsing them would
 * change which cards render their fold affordance.
 *
 * `images` [:L235] -- the attachments carrying a card thumbnail, selected with the
 * source's own double-negation test so an empty string is excluded exactly as it was.
 *
 * `swimlane` [:L238] -- the story's own value, so `null` for unclassified and NEVER the
 * synthetic sentinel. The reducer guarantees it, and it is deliberately not re-normalised
 * here: the sentinel is a grouping key, not a story attribute.
 *
 * `assigned_to` [:L239] -- a RESOLVED user object rather than an id, or `undefined` on a
 * miss. See {@link resolveAssignedTo} for why the null branch is spelled out.
 *
 * `assigned_users` [:L240-L245] -- resolved one id at a time, KEEPING ONLY THE HITS
 * [:L244], so this array MAY BE SHORTER THAN THE ID LIST when a story references someone
 * no longer in the project. Preserved as-is: padding it would put a hole in the shared
 * card's avatar row.
 *
 * `assigned_users_preview` [:L247] -- the first three of the resolved list. The shared card
 * renders the preview but sizes its overflow badge from the FULL list
 * [card-assigned-to.jade:L27/L38-L41], so the two members have to be derived from one
 * another, as they are here, or that badge counts wrongly.
 *
 * `colorized_tags` [:L249-L250] -- a genuine transformation, because a raw tag is a
 * two-element TUPLE and the card wants a named pair. The colour comes from the tuple's
 * second element and from nowhere else: it is a per-project database value, so no default
 * and no substitute is supplied, and a null stays null so the stylesheet paints the pill.
 *
 * `loading-extra` IS NEVER SET HERE. It belongs to the shared card, which owns both the
 * flag and the style rule keyed on it, and that component must not be modified. The member
 * is optional on the view-model type precisely so this file can leave it out.
 */
function buildCardUserStoryVm(
    state: KanbanBoardState,
    story: UserStory,
): CardUserStoryVm {
    const assignedUsers: BoardUser[] = [];

    story.assigned_users.forEach((assignedUserId) => {
        const assignedUserData = lookup(state.usersById, assignedUserId);

        if (assignedUserData) {
            assignedUsers.push(assignedUserData);
        }
    });

    const colorizedTags: readonly ColorizedTag[] = story.tags.map((tag) => ({
        name: tag[0],
        color: tag[1],
    }));

    return {
        id: story.id,
        model: story,
        swimlane: story.swimlane,
        foldStatusChanged: lookup(state.foldStatusChanged, story.id),
        images: story.attachments.filter(
            (attachment) => !!attachment.thumbnail_card_url,
        ),
        assigned_to: resolveAssignedTo(state, story.assigned_to),
        assigned_users: assignedUsers,
        assigned_users_preview: assignedUsers.slice(
            0,
            ASSIGNED_USERS_PREVIEW_LIMIT,
        ),
        colorized_tags: colorizedTags,
    };
}

/**
 * Resolves the primary assignee id to the user record, or `undefined` when there is none.
 *
 * [:L239] indexes the user map with an id that is legitimately nullable and relies on the
 * miss returning `undefined`; the language coerces the null into a property name that
 * cannot be present. TypeScript refuses to index with null, so the null branch is written
 * out and returns the same `undefined` the coercion produced. Behaviour identical, one
 * fewer implicit conversion.
 *
 * The map is ONE USER PER KEY, despite the grouping-flavoured helper that builds it: the
 * helper at [app/coffee/utils.coffee:L80-L85] assigns `result[pred(item)] = item`, so it
 * is a keyed map builder in which the LAST duplicate wins, not a grouper that collects
 * lists. The board fills it at [app/coffee/modules/controllerMixins.coffee:L28]. Treating
 * a value here as a list of users would break every avatar on the board.
 */
function resolveAssignedTo(
    state: KanbanBoardState,
    assignedTo: UserStory['assigned_to'],
): BoardUser | undefined {
    if (assignedTo === null) {
        return undefined;
    }

    return lookup(state.usersById, assignedTo);
}


/**
 * One status column's cards, together with the count the column badge renders.
 *
 * The two members always agree, which is the point of returning them together: the badge
 * and the card list are rendered from separate template expressions in the source and could
 * drift apart if they were derived separately.
 */
export interface ColumnCards {
    readonly cardIds: readonly number[];

    readonly count: number;
}

/** Stable result for a status the board holds no stories for; see {@link selectColumnCards}. */
const EMPTY_COLUMN: ColumnCards = { cardIds: [], count: 0 };

/**
 * The cards in one column, routed by mode: swimlane-scoped when a swimlane id is supplied
 * and truthy, flat otherwise.
 *
 * The two lookups are NOT interchangeable, and each is spelled the way its own grouping is
 * keyed -- numeric-then-numeric for the swimlane grouping
 * [kanban-table.jade:L128/L135/L153], string for the flat one [:L204/L211/L229]. Mode
 * selection is the FALSY guard documented on {@link isSwimlaneScoped}, so the synthetic
 * swimlane's negative sentinel routes to the swimlane grouping while zero, `null` and
 * `undefined` all route to the flat one.
 *
 * A STORY-LESS STATUS REPORTS ZERO, WHICH IS A DELIBERATE, DOCUMENTED DEPARTURE.
 * In the source that case produced `undefined`, by this route: the board pre-created an
 * empty bucket for every status it had seen
 * [kanban-usertories.coffee:L53-L58, called from main.coffee:L403], but the refresh pass
 * creates a bucket only on encountering a story with that status [:L261] and then REPLACES
 * THE WHOLE MAP [:L272], discarding every pre-created empty bucket along with it. So the
 * read came back `undefined`, and the template's length reads at
 * [kanban-table.jade:L204/L211] are UNGUARDED -- they survived only because the expression
 * evaluator behind those bindings is forgiving of a missing intermediate and yields
 * `undefined` instead of throwing, which renders as a blank badge.
 *
 * Zero is returned instead, for two independent reasons. The column components declare the
 * count as a NON-OPTIONAL number -- `../ArchivedColumn.tsx` does so today and
 * `../StatusColumn.tsx` is specified the same way -- so `undefined` would not type-check
 * at the consumer. And the board's design reference
 * (`design-reference/kanban-screen.png`, node 1:7) shows a bare zero on story-less
 * columns, so zero is also the rendering that was observed. `../TaskCounter.tsx` tolerates
 * either, so it does not decide the question.
 *
 * This paragraph is the point of the change, not a footnote to it: without it the next
 * reader sees a normalisation that looks accidental, restores `undefined`, and breaks the
 * column components' prop types.
 *
 * WIP arithmetic is NOT computed here. `../WipLimitMarker.tsx` already owns the threshold
 * ladder and the marker's anchor index; deriving either from this count would be a second
 * implementation of it.
 */
export function selectColumnCards(
    state: KanbanBoardState,
    statusId: number,
    swimlaneId?: number | null,
): ColumnCards {
    const cardIds = isSwimlaneScoped(swimlaneId)
        ? readSwimlaneColumn(selectUsByStatusSwimlanes(state), swimlaneId, statusId)
        : lookupByName(selectUsByStatus(state), String(statusId));

    if (cardIds === undefined) {
        return EMPTY_COLUMN;
    }

    return { cardIds, count: cardIds.length };
}

/**
 * The nested read the source performs with a single two-key accessor
 * [kanban-table.jade:L128/L135/L153], spelled as two ordinary lookups because this side of
 * the seam holds plain objects. Either level may miss, and a miss at either level means the
 * same thing to the caller.
 */
function readSwimlaneColumn(
    bySwimlane: UsByStatusSwimlanes,
    swimlaneId: number,
    statusId: number,
): readonly number[] | undefined {
    const byStatus = lookup(bySwimlane, swimlaneId);

    if (byStatus === undefined) {
        return undefined;
    }

    return lookup(byStatus, statusId);
}

/**
 * Whether a column shows the board's empty-state placeholder.
 *
 * Reproduces [app/coffee/modules/kanban/main.coffee:L316-L323] (`showPlaceHolder`; note
 * the source spells it with a capital H, so a search for either spelling finds both).
 *
 * The first condition [:L317] is narrower than it looks: the column must be the FIRST of
 * the ordered status list AND THE WHOLE BOARD must hold no stories -- not merely this
 * column. One card in the last column of the last swimlane suppresses the placeholder
 * everywhere.
 *
 * In swimlane mode [:L319-L321] the column must additionally sit in the FIRST entry of the
 * rendered swimlane list. That test is gated by the third of the module's falsy guards, so
 * the synthetic swimlane -- negative, therefore truthy -- IS eligible, and since it is
 * prepended at index 0 it is precisely the entry the test accepts.
 *
 * A CONSEQUENCE WORTH KNOWING BEFORE IT LOOKS LIKE A BUG: the synthetic swimlane can never
 * show the placeholder, even though it is eligible on paper. It only joins the rendered
 * list when some story belongs to no swimlane, and the first condition demands that the
 * board hold no stories at all, so the two requirements exclude one another. The incumbent
 * behaves identically; this is a property of the two rules, not a difference introduced
 * here.
 *
 * The two empty-list guards are additions. The source indexes the status list and takes the
 * first swimlane without checking either, so both would throw on an empty list; returning
 * false instead replaces a crash and changes nothing on every non-empty input, which are
 * the only inputs the source survived.
 *
 * Both call arities are supported, matching [kanban-table.jade:L145] in swimlane mode and
 * [:L221] in flat mode.
 */
export function selectShowPlaceholder(
    state: KanbanBoardState,
    statusId: number,
    swimlaneId?: number | null,
): boolean {
    if (state.usStatusList.length === 0) {
        return false;
    }

    const isFirstStatus =
        state.usStatusList[0].id === statusId && allStories(state).length === 0;

    if (isSwimlaneScoped(swimlaneId)) {
        const swimlanesList = selectSwimlanesList(state);

        if (swimlanesList.length === 0) {
            return false;
        }

        return isFirstStatus && swimlanesList[0].id === swimlaneId;
    }

    return isFirstStatus;
}


/**
 * The statuses the column header band repeats over [kanban-table.jade:L18].
 *
 * That repeat is NOT one-time-bound, unlike both column repeats below -- it carries no
 * one-time-binding prefix -- so the band tracks later changes to the status list while the
 * columns do not. The three repeats are exposed as three selectors because they are three
 * separate contracts, even where two of them currently read the same list; collapsing them
 * into one export would erase the distinction the template draws.
 *
 * THE LIST IS ALREADY ORDERED AND IS NOT RE-SORTED HERE. The board orders the project's
 * statuses by their `order` field [app/coffee/modules/kanban/main.coffee:L576] and the
 * reducer stores that ordered list as it arrives. The backlog screen sorts THE SAME project
 * collection by `id` instead [app/coffee/modules/backlog/main.coffee:L482]. The two are
 * genuinely different orderings of the same data and MUST NOT BE UNIFIED: each screen
 * renders the order its own users see today.
 */
export function selectHeaderStatuses(state: KanbanBoardState): readonly Status[] {
    return state.usStatusList;
}

/**
 * The statuses the flat-mode column repeat walks
 * [kanban-table.jade:L191], which IS one-time-bound.
 *
 * Same list as {@link selectHeaderStatuses} and a deliberately separate export; see that
 * comment for why, and for the ordering note.
 */
export function selectFlatStatuses(state: KanbanBoardState): readonly Status[] {
    return state.usStatusList;
}

/**
 * The statuses one swimlane's column repeat walks [kanban-table.jade:L114], one-time-bound.
 *
 * Built at [app/coffee/modules/kanban/main.coffee:L552-L562]: an empty map at [:L555], then
 * one entry per swimlane holding that swimlane's OWN statuses at [:L558], then an entry for
 * the synthetic swimlane holding ALL of the project's statuses at [:L560]. That last entry
 * takes the project's raw status collection rather than the ordered list, so the synthetic
 * swimlane's columns can differ in ORDER from the header band -- reproduced by the reducer
 * as it arrives, and not corrected here.
 *
 * An unrecognised swimlane id yields an EMPTY LIST rather than `undefined`, so
 * `../Swimlane.tsx` can walk the result without a guard. The template's read is unguarded
 * for the same reason, and this normalisation is what makes that safe on this side.
 */
export function selectSwimlaneStatuses(
    state: KanbanBoardState,
    swimlaneId: number,
): readonly Status[] {
    const statuses = lookup(state.swimlanesStatuses, swimlaneId);

    if (statuses === undefined) {
        return NO_STATUSES;
    }

    return statuses;
}

/**
 * Whether a status column is folded.
 *
 * The fold map drives the folded class on the header [kanban-table.jade:L20], on both
 * column repeats [:L113/L190], the hidden class on the header's colour square [:L25] and
 * its fold and unfold buttons [:L51/L59/L70], the presence of the counter [:L123/L199] and
 * of the collapsed placeholder [:L130/L206].
 *
 * A missing entry means "not folded". Normalised to a real boolean here because the
 * consuming components declare the prop as a required boolean, and because the template's
 * own reads were expressions that treated a missing entry as false.
 */
export function selectIsStatusFolded(
    state: KanbanBoardState,
    statusId: number,
): boolean {
    return lookup(state.folds, statusId) === true;
}

/**
 * Whether a status column is the one most recently unfolded
 * [kanban-table.jade:L113/L190].
 *
 * At most one column holds this at a time -- the reducer clears it on every column fold
 * toggle and sets it again only when the toggle opened a column -- so it is a single value
 * compared against the column's id rather than a second map. The source compares loosely;
 * strict comparison is equivalent here, because the stored value is either a status id or
 * null and null equals no id.
 */
export function selectIsStatusUnfolded(
    state: KanbanBoardState,
    statusId: number,
): boolean {
    return state.unfold === statusId;
}

/**
 * Whether a swimlane is collapsed.
 *
 * KEYED BY STRING, and that is the one key conversion in this file that is NOT about the
 * grouping asymmetry. The template converts the numeric swimlane id at each of its four
 * read sites [kanban-table.jade:L82/L86/L90/L108], and the map itself keeps string keys
 * all the way through because it is written back to persisted storage verbatim -- rekeying
 * it would drop the user's collapsed swimlanes on the next load. `./types.ts` records the
 * same constraint on the field.
 *
 * A missing entry means "expanded", which is the initial state of every swimlane.
 */
export function selectIsSwimlaneFolded(
    state: KanbanBoardState,
    swimlaneId: number,
): boolean {
    return lookupByName(state.foldedSwimlane, String(swimlaneId)) === true;
}

/**
 * Whether a card is part of the current multi-selection.
 *
 * Drives two classes from one flag in both modes -- the selected-card class and the
 * multi-sortable marker the drag layer keys on
 * [kanban-table.jade:L154] and [:L230]. Both are emitted from this single boolean, so they
 * cannot disagree.
 *
 * A missing entry means "not selected"; the reducer also writes an explicit false when it
 * clears the selection, so both representations occur and both mean the same thing.
 */
export function selectIsUsSelected(
    state: KanbanBoardState,
    storyId: number,
): boolean {
    return lookup(state.selectedUss, storyId) === true;
}

/**
 * Whether a card was just moved to the top of its column.
 *
 * MEMBERSHIP ONLY -- the mode asymmetry is left to the caller. The move-to-top marker class
 * is emitted in SWIMLANE MODE ONLY [kanban-table.jade:L154]; the flat-mode card OMITS it
 * [:L230], even though the controller records the move regardless of mode
 * [app/coffee/modules/kanban/main.coffee:L167] and clears the record on a deferred callback
 * a second later [:L168-L170]. That is the shipped behaviour and it is NOT corrected here:
 * a wrapper that quietly supplied the marker in flat mode would be a visual change to a
 * screen that must look exactly as it does today.
 *
 * The companion asymmetry needs no selector at all: the move-to-top command itself is wired
 * only in swimlane mode [:L160], so the action is simply unavailable on a board without
 * swimlanes.
 */
export function selectIsUsMoved(
    state: KanbanBoardState,
    storyId: number,
): boolean {
    return state.movedUs.includes(storyId);
}

/**
 * Whether a card sits in a status that is BOTH archived and hidden, which is what the
 * shared card renders as archived [kanban-table.jade:L167/L242].
 *
 * Reproduces [kanban-usertories.coffee:L116-L121]. Both conditions are required: an
 * archived status whose column is expanded shows its cards normally, and the two lists are
 * maintained independently by the reducer.
 *
 * The source resolves the story through the view-model map with an optional read, so a
 * missing story leaves the status undefined and both membership tests then fail -- yielding
 * false. Returning false directly on a missing story is the same answer by a shorter route.
 * Membership is tested with `includes`, which is what the source's index-of comparison
 * means for a list of ids.
 */
export function selectIsUsInArchivedHiddenStatus(
    state: KanbanBoardState,
    storyId: number,
): boolean {
    const story = lookup(state.storiesById, storyId);

    if (story === undefined) {
        return false;
    }

    return (
        state.archivedStatus.includes(story.status) &&
        state.statusHide.includes(story.status)
    );
}

