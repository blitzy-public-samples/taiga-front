/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Per-project `my_permissions` gate helpers for the React Kanban / Backlog
 * screens (`app/react/**`).
 *
 * WHY THIS EXISTS
 *   The Kanban board and the Backlog / Sprint-planning view were migrated from
 *   AngularJS 1.5.10 to React 18 and run in-place inside the still-AngularJS
 *   shell. Security must behave IDENTICALLY to the legacy screens: the same
 *   per-project `my_permissions` gates decide whether drag-and-drop is enabled
 *   and whether mutating actions are shown. Centralizing those checks here means
 *   every React consumer (`../kanban/**`, `../backlog/**`) enforces the exact
 *   same rule the AngularJS directives enforced, byte-for-byte in behaviour, and
 *   the Django `/api/v1/` backend cannot distinguish React traffic from
 *   AngularJS traffic.
 *
 * SOURCE OF TRUTH (legacy AngularJS gates reproduced here)
 *   - `app/coffee/modules/kanban/sortable.coffee:37`
 *       `if not ($scope.project.my_permissions.indexOf("modify_us") > -1) return`
 *       — the drag-and-drop board is only wired up when the current user holds
 *       the `modify_us` permission on the project.
 *   - `app/coffee/modules/kanban/sortable.coffee:40`
 *       `if $scope.project.archived_code return`
 *       — dragging is additionally disabled while the project is archived
 *       (a truthy `archived_code`).
 *   - `app/coffee/modules/backlog/sortable.coffee:30`
 *       `if not (project.my_permissions.indexOf("modify_us") > -1) and
 *       !project.archived_code return`
 *       — the backlog sortable is gated on the same `modify_us` permission and
 *       the same archived state.
 *
 * DESIGN
 *   Every export is a PURE function of its arguments: no `window`, no DOM, no
 *   network, no module-level mutable state and no side effects. This keeps the
 *   helpers trivially unit-testable with fabricated `Project` objects and safe
 *   to call from render paths. The only dependency is the `Project` TYPE, which
 *   is erased at compile time (`import type`), so this module contributes zero
 *   runtime imports to the esbuild bundle.
 */

import type { Project } from './types';

/**
 * Core permission gate: does the current user hold `permission` on `project`?
 *
 * This reproduces the legacy AngularJS check `my_permissions.indexOf(code) > -1`
 * exactly (see `kanban/sortable.coffee:37` and `backlog/sortable.coffee:30`).
 * `indexOf(...) > -1` is used rather than `Array.prototype.includes` to mirror
 * the original semantics literally; the two are equivalent for the string codes
 * stored in `my_permissions`.
 *
 * The function is defensively null-guarded so callers may pass a not-yet-loaded
 * project (`null` / `undefined`) or a malformed payload without throwing:
 *   - a missing project always denies the permission;
 *   - a project whose `my_permissions` is not an array always denies it.
 *
 * @param project    The project whose permissions are checked, or `null` /
 *                    `undefined` when the project has not loaded yet.
 * @param permission The permission code to test, e.g. `"modify_us"`,
 *                    `"add_us"`, `"add_milestone"`.
 * @returns `true` only when `project` exists, exposes an array
 *          `my_permissions`, and that array contains `permission`.
 */
export function can(
    project: Project | null | undefined,
    permission: string,
): boolean {
    return (
        !!project &&
        Array.isArray(project.my_permissions) &&
        project.my_permissions.indexOf(permission) > -1
    );
}

/**
 * Convenience gate: may the current user modify user stories on `project`?
 * Drives Kanban / Backlog drag-and-drop enablement and story-editing affordances
 * (legacy code: `my_permissions` contains `"modify_us"`).
 */
export const canModifyUs = (project: Project | null | undefined): boolean =>
    can(project, 'modify_us');

/**
 * Convenience gate: may the current user create user stories on `project`?
 * (legacy permission code `"add_us"`).
 */
export const canAddUs = (project: Project | null | undefined): boolean =>
    can(project, 'add_us');

/**
 * Convenience gate: may the current user create sprints / milestones on
 * `project`? Drives the "create sprint" affordance in the Backlog view
 * (legacy permission code `"add_milestone"`).
 */
export const canAddMilestone = (project: Project | null | undefined): boolean =>
    can(project, 'add_milestone');

/**
 * Convenience gate: may the current user edit existing sprints / milestones on
 * `project`? Drives the "edit sprint" affordance in the Backlog view
 * (legacy permission code `"modify_milestone"`).
 */
export const canModifyMilestone = (
    project: Project | null | undefined,
): boolean => can(project, 'modify_milestone');

/**
 * Combined drag-and-drop gate for both the Kanban board and the Backlog:
 * dragging is enabled only when the user can modify user stories AND the
 * project is not archived.
 *
 * This reproduces the combined AngularJS sortable gate exactly:
 *   - `kanban/sortable.coffee:37` — require the `modify_us` permission; and
 *   - `kanban/sortable.coffee:40` — disable dragging when `archived_code` is
 *     truthy (the project is archived).
 * The backlog equivalent (`backlog/sortable.coffee:30`) enforces the same
 * `modify_us` + not-archived pairing.
 *
 * The optional chain (`project?.archived_code`) means a `null` / `undefined`
 * project short-circuits to `false` via `canModifyUs`, so no guard is lost.
 *
 * @param project The board's project, or `null` / `undefined` before load.
 * @returns `true` when the board/backlog should allow drag-and-drop reordering.
 */
export function isBoardDraggable(
    project: Project | null | undefined,
): boolean {
    return canModifyUs(project) && !project?.archived_code;
}
