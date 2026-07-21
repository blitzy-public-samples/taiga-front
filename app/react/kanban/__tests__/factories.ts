/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * factories.ts — shared, framework-agnostic test-data builders for the Kanban
 * React unit specs.
 *
 * WHY THIS EXISTS
 *   Every Jest spec under `app/react/kanban/__tests__/**` needs valid, typed
 *   domain objects (`Status`, `Swimlane`, `AssignedUser`, `Project`,
 *   `UserStory`, `BoardCard`) to render components and drive reducers/DnD. This
 *   module centralises those builders so the specs stay DRY and every fixture
 *   stays type-consistent with the single source of truth: `../../shared/types`.
 *
 * THIS FILE IS NOT A TEST
 *   Its name has no `.test`/`.spec` segment, so the root `jest.config.js`
 *   `testMatch` (which only accepts `*.test.(ts|tsx)` / `*.spec.(ts|tsx)` files
 *   inside an `__tests__` directory under `app/react`) never picks it up as a
 *   suite — it therefore cannot trigger a "your test suite must contain at
 *   least one test" failure. Because it lives inside an `__tests__` directory it
 *   is also excluded from coverage (`collectCoverageFrom` skips the `__tests__`
 *   trees). It is imported only by sibling specs via `./factories`.
 *
 * DESIGN CONTRACT (hard constraints)
 *   - Pure data builders: NO JSX, NO `React` import, NO DOM/`window`/network
 *     access, and NO side effects at import time.
 *   - Domain types are imported (type-only) from `../../shared/types` and never
 *     redefined here. Each builder's default object is authored to EXACTLY
 *     satisfy the real exported interface — no `as`-casts.
 *   - The builder idiom is a shallow spread merge where caller overrides win:
 *       `export function makeX(overrides: Partial<X> = {}): X`
 *         `{ return { ...defaults, ...overrides }; }`
 *     Because `Partial<T>` preserves the index signature on the API payload
 *     interfaces (`AssignedUser`, `Swimlane`, `Project`, `UserStory`), specs may
 *     also override backend fields this module does not model explicitly
 *     (e.g. `is_blocked`, `is_iocaine`) without needing a cast.
 */

import type {
    Status,
    Swimlane,
    AssignedUser,
    Project,
    UserStory,
    BoardCard,
} from '../../shared/types';

/* ========================================================================== *
 * Column / status builders
 * ========================================================================== */

/**
 * Build a Kanban column {@link Status}. `Status` has no index signature, so the
 * default object carries exactly the declared fields.
 *
 * Defaults describe an open, non-archived "New" column with no WIP limit (so no
 * WIP colouring). WIP specs override `wip_limit`; archived-column specs override
 * `is_archived`.
 *
 * @param overrides Partial status fields; caller values win.
 */
export function makeStatus(overrides: Partial<Status> = {}): Status {
    return {
        id: 100,
        name: 'New',
        slug: 'new',
        color: '#999999',
        order: 1,
        is_closed: false,
        is_archived: false,
        wip_limit: null,
        ...overrides,
    };
}

/**
 * Build an ordered list of {@link Status} columns from a list of ids. Each id
 * maps to `makeStatus({ id, name: 'S' + id, order: id })`, which keeps names and
 * ordering distinct and predictable for board-layout specs.
 *
 * @param ids Status ids, in the desired column order.
 */
export function makeStatuses(ids: number[]): Status[] {
    return ids.map((id) => makeStatus({ id, name: `S${id}`, order: id }));
}

/* ========================================================================== *
 * Swimlane builder
 * ========================================================================== */

/**
 * Build a {@link Swimlane} row. `Swimlane` carries an index signature, so
 * additional backend fields may be supplied via `overrides` without a cast.
 *
 * @param overrides Partial swimlane fields; caller values win.
 */
export function makeSwimlane(overrides: Partial<Swimlane> = {}): Swimlane {
    return {
        id: 10,
        name: 'Swimlane A',
        order: 1,
        project: 1,
        ...overrides,
    };
}

/* ========================================================================== *
 * Member / assigned-user builder
 * ========================================================================== */

/**
 * Build a resolved {@link AssignedUser} — the member object stored in the
 * board's `usersById` lookup and attached to each card's `assigned_to` /
 * `assigned_users` view fields.
 *
 * `photo` defaults to `null` (no avatar). `AssignedUser` carries an index
 * signature, so extra backend fields (e.g. `is_active`) type-check and may be
 * overridden freely.
 *
 * @param overrides Partial user fields; caller values win.
 */
export function makeAssignedUser(overrides: Partial<AssignedUser> = {}): AssignedUser {
    return {
        id: 1,
        full_name_display: 'User One',
        photo: null,
        is_active: true,
        ...overrides,
    };
}

/* ========================================================================== *
 * Project builder
 * ========================================================================== */

/**
 * Build a {@link Project}.
 *
 * IMPORTANT — `my_permissions` DELIBERATELY excludes the drag-and-drop /
 * mutation gates (`modify_us`, `delete_us`, `add_us`). Permission-gated specs
 * (CardActions / Card / TaskboardColumn, which call
 * `permissions.can(project, 'modify_us')`) must opt in explicitly by overriding
 * `my_permissions`. `archived_code` defaults to `null` (project not archived),
 * which — together with the missing `modify_us` — mirrors the legacy
 * drag-enable gate in `kanban/sortable.coffee:37,40`.
 *
 * `Project` carries an index signature, so the convenience fields below
 * (`i_am_admin`, `is_kanban_activated`, `us_statuses`, `members`, `roles`,
 * `points`) that the board reads are included without a cast.
 *
 * @param overrides Partial project fields; caller values win.
 */
export function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 1,
        slug: 'proj',
        name: 'Proj',
        // Intentionally NOT including modify_us/delete_us/add_us — specs opt in.
        my_permissions: ['view_us'],
        archived_code: null,
        i_am_admin: true,
        is_kanban_activated: true,
        default_swimlane: null,
        us_statuses: [makeStatus()],
        members: [],
        roles: [],
        points: [],
        ...overrides,
    };
}

/* ========================================================================== *
 * User-story builder
 * ========================================================================== */

/**
 * Build a raw {@link UserStory} as returned by `/api/v1/userstories`.
 *
 * `assigned_to` / `assigned_users` are member IDs here (they are resolved to
 * `AssignedUser` objects only in the derived {@link BoardCard}). `tags` are
 * `[name, color]` tuples. Only fields the real `UserStory` interface declares
 * are set; because the interface carries an index signature, specs needing
 * extra backend fields (`is_blocked`, `is_iocaine`, statistics, …) can pass
 * them through `overrides` without a cast.
 *
 * @param overrides Partial user-story fields; caller values win.
 */
export function makeUserStory(overrides: Partial<UserStory> = {}): UserStory {
    return {
        id: 1,
        ref: 1,
        subject: 'Story 1',
        project: 1,
        status: 100,
        swimlane: null,
        milestone: null,
        kanban_order: 1,
        assigned_to: null,
        assigned_users: [],
        tags: [],
        attachments: [],
        total_points: null,
        ...overrides,
    };
}

/* ========================================================================== *
 * Derived board-card builder
 * ========================================================================== */

/**
 * Build a per-card view model {@link BoardCard}, mirroring the object produced
 * by `KanbanUserstoriesService.retrieveUserStoryData`
 * (`kanban-usertories.coffee:228-252`): `model` is the raw story, `images` is
 * the subset of attachments that have a card thumbnail, `assigned_to` /
 * `assigned_users` are RESOLVED member objects, `assigned_users_preview` is the
 * first three assignees, and `colorized_tags` are the flattened tags.
 *
 * If no `model` override is supplied, one is synthesised via
 * {@link makeUserStory}. The card's `id` and `swimlane` are derived from the
 * model so `id === model.id` holds, unless the caller overrides them explicitly
 * (the trailing `...overrides` spread wins). `BoardCard` has no index signature,
 * so only its declared fields are set (`foldStatusChanged` is optional and left
 * unset by default).
 *
 * @param overrides Partial board-card fields (may include a full `model`);
 *   caller values win.
 */
export function makeBoardCard(overrides: Partial<BoardCard> = {}): BoardCard {
    const model: UserStory = overrides.model ?? makeUserStory();

    return {
        id: model.id,
        model,
        swimlane: model.swimlane ?? null,
        images: [],
        assigned_to: null,
        assigned_users: [],
        assigned_users_preview: [],
        colorized_tags: [],
        ...overrides,
    };
}

/* ========================================================================== *
 * Board-index convenience builder
 * ========================================================================== */

/**
 * Build the `usMap` board index (`user-story id -> BoardCard`) from a list of
 * cards. Used by the DnD and TaskboardColumn specs, which look cards up by id.
 *
 * @param cards The board cards to index.
 */
export function makeUsMap(cards: BoardCard[]): Record<number, BoardCard> {
    const map: Record<number, BoardCard> = {};

    for (const card of cards) {
        map[card.id] = card;
    }

    return map;
}
