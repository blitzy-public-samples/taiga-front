/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * factories.ts — shared, strongly-typed test-data builders for the Backlog
 * Jest unit specs (`app/react/backlog/__tests__/**`).
 *
 * WHAT THIS IS
 *   A collection of tiny `makeX(overrides)` builder functions that return
 *   fully-typed domain objects (`Status`, `Project`, `UserStory`, `Milestone`,
 *   …) drawn from `../../shared/types`. Every Backlog spec in this folder
 *   (`backlogReducer.test.ts`, `computeBacklogMovePayload.test.ts`,
 *   `validation.test.ts`, the component render specs, `useBacklog.test.tsx`,
 *   `BacklogApp.test.tsx`) imports these helpers so each test can assemble a
 *   small, explicit fixture without duplicating field-by-field boilerplate.
 *   It mirrors, one-for-one, the sibling Kanban precedent
 *   (`app/react/kanban/__tests__/factories.ts`) in shape and conventions.
 *
 * WHAT THIS IS NOT
 *   This file is deliberately NOT a Jest suite. Its name has no `.test` / `.spec`
 *   segment, so the root `jest.config.js` `testMatch`
 *   (`app/react/** /__tests__/** /*.(test|spec).(ts|tsx)`) never collects it, and
 *   because it lives under `__tests__/` it is excluded from coverage
 *   (`collectCoverageFrom` carries `!app/react/** /__tests__/**`). It contains no
 *   `describe` / `it` / `test` / `expect` and performs no assertions, network
 *   calls, or DOM side effects — it is a pure utility module imported by specs.
 *
 * CONVENTIONS (must hold for every builder)
 *   - Pure function: signature is `makeX(overrides: Partial<X> = {}): X` and the
 *     body returns `{ ...inlineDefaults, ...overrides }`. Callers override only
 *     the fields they care about; everything else falls back to a realistic
 *     default.
 *   - Fresh objects: defaults (including nested arrays/objects) are constructed
 *     inline on every call, never shared at module scope, so two invocations
 *     never alias — one spec mutating a fixture can never leak into another.
 *   - Wire-accurate shapes: field names are the snake_case `/api/v1/` names
 *     exactly as declared in `../../shared/types` (`my_permissions`,
 *     `kanban_order`, `estimated_start`, …); no fields are invented.
 *   - View-only permissions by default: `makeProject().my_permissions` grants
 *     only view codes. Specs exercising mutating UI (drag, edit/delete handles,
 *     checkboxes, sprint create/edit) opt in explicitly by passing
 *     `my_permissions`, and read-only specs can assert the disabled/absent
 *     state — matching the Kanban factories precedent.
 *
 * The single import is type-only (required by `isolatedModules`); there is no
 * `import React` and no runtime dependency of any kind.
 */

import type {
    Status,
    Swimlane,
    AssignedUser,
    Project,
    UserStory,
    Milestone,
    FilterOption,
    FiltersData,
    SprintFormValues,
} from '../../shared/types';

/* ========================================================================== *
 * Core domain builders
 * ========================================================================== */

/**
 * Build a user-story {@link Status} (a board/backlog column).
 *
 * Defaults model a plain, open "New" column with no WIP limit (`wip_limit:
 * null` disables WIP colouring). `Status` has no index signature, so the
 * defaults intentionally contain only its declared fields.
 */
export function makeStatus(overrides: Partial<Status> = {}): Status {
    return {
        id: 1,
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
 * Build a {@link Swimlane} row. `project` is optional on the type but included
 * here so fixtures mirror a real backend payload (a swimlane always belongs to
 * a project).
 */
export function makeSwimlane(overrides: Partial<Swimlane> = {}): Swimlane {
    return {
        id: 1,
        name: 'Default',
        order: 1,
        project: 1,
        ...overrides,
    };
}

/**
 * Build a resolved project member ({@link AssignedUser}), as stored in the
 * board's `usersById` lookup. `full_name` and `is_active` are real backend
 * fields carried through the type's index signature.
 */
export function makeAssignedUser(overrides: Partial<AssignedUser> = {}): AssignedUser {
    return {
        id: 1,
        username: 'user1',
        full_name: 'User One',
        full_name_display: 'User One',
        photo: null,
        is_active: true,
        ...overrides,
    };
}

/**
 * Build the {@link Project} a board/backlog belongs to — the most important
 * builder, since permission and configuration gating flows from it.
 *
 * The default `my_permissions` is VIEW-ONLY (no `modify_us` / `add_us` /
 * `delete_us` / `modify_milestone` / `add_milestone`): view-level UI must render
 * by default, while mutating UI stays gated off until a spec opts in by passing
 * `my_permissions` explicitly. The extra configuration fields (`roles`,
 * `us_statuses`, `points`, `default_us_status`, `is_backlog_activated`,
 * `is_kanban_activated`) are carried through the type's index signature and are
 * constructed fresh on every call to avoid cross-test aliasing.
 */
export function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 1,
        slug: 'project-1',
        name: 'Project One',
        // VIEW-ONLY by default — permission specs opt in to mutating codes.
        my_permissions: ['view_project', 'view_us', 'view_tasks', 'view_milestones'],
        archived_code: null,
        default_swimlane: null,
        is_backlog_activated: true,
        is_kanban_activated: false,
        roles: [
            { id: 1, name: 'Back', slug: 'back', computable: true, order: 1 },
            { id: 2, name: 'Front', slug: 'front', computable: true, order: 2 },
            { id: 3, name: 'Design', slug: 'design', computable: false, order: 3 },
        ],
        us_statuses: [
            { id: 1, name: 'New', color: '#999999', order: 1, is_closed: false, is_archived: false, wip_limit: null },
            { id: 2, name: 'Done', color: '#00ff00', order: 2, is_closed: true, is_archived: false, wip_limit: null },
        ],
        points: [
            { id: 10, name: '?', value: null, order: 1 },
            { id: 11, name: '1', value: 1, order: 2 },
        ],
        default_us_status: 1,
        ...overrides,
    };
}

/**
 * Build a {@link UserStory}. Defaults model a single open story that is not yet
 * in a sprint (`milestone: null`) nor a swimlane (`swimlane: null`), unassigned,
 * with the three ordering fields (`kanban_order` / `sprint_order` /
 * `backlog_order`) all set to `1`. Collection fields (`assigned_users`, `tags`,
 * `attachments`, `points`) are fresh empty containers on every call.
 */
export function makeUserStory(overrides: Partial<UserStory> = {}): UserStory {
    return {
        id: 1,
        ref: 1,
        subject: 'Story 1',
        project: 1,
        status: 1,
        swimlane: null,
        milestone: null,
        is_closed: false,
        kanban_order: 1,
        sprint_order: 1,
        backlog_order: 1,
        assigned_to: null,
        assigned_users: [],
        tags: [],
        attachments: [],
        total_points: null,
        points: {},
        version: 1,
        ...overrides,
    };
}

/**
 * Build a {@link Milestone} (sprint). Dates are `YYYY-MM-DD` strings, as the
 * backend contract requires. `user_stories` starts as a fresh empty array so
 * specs can push in stories (e.g. from {@link makeUserStories}) without aliasing.
 */
export function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
    return {
        id: 1,
        name: 'Sprint 1',
        slug: 'sprint-1',
        project: 1,
        estimated_start: '2021-01-01',
        estimated_finish: '2021-01-15',
        closed: false,
        user_stories: [],
        total_points: 0,
        closed_points: 0,
        order: 1,
        ...overrides,
    };
}

/**
 * Build a single {@link FilterOption} within a `/userstories/filters_data`
 * facet. `id` may be `null` for the "unassigned"/"no-status" bucket; the default
 * uses a concrete id with a zero `count`.
 */
export function makeFilterOption(overrides: Partial<FilterOption> = {}): FilterOption {
    return {
        id: 1,
        name: 'Option',
        count: 0,
        ...overrides,
    };
}

/**
 * Build a {@link FiltersData} response. Every facet defaults to a fresh empty
 * array so specs can populate only the facets they exercise.
 */
export function makeFiltersData(overrides: Partial<FiltersData> = {}): FiltersData {
    return {
        statuses: [],
        tags: [],
        assigned_to: [],
        owner: [],
        epics: [],
        roles: [],
        ...overrides,
    };
}

/**
 * Build the editable values of the sprint create/edit lightbox
 * ({@link SprintFormValues}). Defaults are a valid, fully-populated form so
 * validation specs start from a passing baseline and can null out individual
 * fields to assert the required-field errors. `SprintFormValues` has no index
 * signature, so the defaults contain only its declared fields.
 */
export function makeSprintFormValues(overrides: Partial<SprintFormValues> = {}): SprintFormValues {
    return {
        name: 'Sprint 1',
        estimated_start: '2021-01-01',
        estimated_finish: '2021-01-15',
        project: 1,
        ...overrides,
    };
}

/* ========================================================================== *
 * Convenience list builders
 * ========================================================================== */

/**
 * Build a canonical ordered list of three statuses — "New", "In progress" and a
 * closed "Done" — for column-rendering and ordering assertions. Each element is
 * a fresh {@link Status} produced by {@link makeStatus}.
 */
export function makeStatuses(): Status[] {
    return [
        makeStatus({ id: 1, name: 'New', order: 1 }),
        makeStatus({ id: 2, name: 'In progress', order: 2 }),
        makeStatus({ id: 3, name: 'Done', order: 3, is_closed: true }),
    ];
}

/**
 * Build `count` user stories with sequential `id` / `ref` / `backlog_order` of
 * `i + 1` (1-based), so ordering assertions are trivial. `base` is merged into
 * every story first; the sequential fields are applied afterwards so they can
 * never be clobbered by `base`. Each story is a fresh object.
 */
export function makeUserStories(count: number, base: Partial<UserStory> = {}): UserStory[] {
    return Array.from({ length: count }, (_unused, i) =>
        makeUserStory({ ...base, id: i + 1, ref: i + 1, backlog_order: i + 1 }),
    );
}
