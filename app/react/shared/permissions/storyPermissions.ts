/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { Project } from "../types";

/**
 * Centralized, authoritative user-story edit/delete gates (finding M4).
 *
 * The two screens previously combined raw permissions with the project
 * read-only (`archived_code`) state and the per-item archived flag
 * INCONSISTENTLY: drag used the full combination while the edit/delete/menu
 * controls used bare `modify_us` / `delete_us`, so owner actions leaked onto
 * archived (read-only) projects and archived cards. These helpers give ONE
 * definition of editability that every control, menu action, drag sensor,
 * listener and hook guard consults.
 *
 * They are DISPLAY-only gates: the Django backend remains the single
 * authorization enforcement point (constraint C-1). There is no parallel
 * client-side authorization — these only decide which affordances to show and
 * which pointer sensors to arm, exactly as the legacy `tg-check-permission`
 * directives + the `sortable.coffee` drag-init guards did.
 */

/** The minimal project shape the gates read (permissions + read-only marker). */
export type PermissionProject = Pick<Project, "my_permissions" | "archived_code">;

/** Extra per-item context (kanban: the story sits in an archived status). */
export interface StoryEditContext {
    /** `true` when the story is in an archived/hidden status (kanban only). */
    archived?: boolean;
}

/**
 * `true` when the project itself accepts mutations — i.e. it is NOT archived /
 * read-only. Every edit gate short-circuits on this so a read-only project shows
 * no mutating affordance regardless of the caller's permissions.
 */
export function isProjectWritable(project: Pick<Project, "archived_code">): boolean {
    return !project.archived_code;
}

/**
 * Authoritative "can modify this story" gate: `modify_us` AND a writable
 * (non-archived) project AND a non-archived story. This is the single source of
 * truth the drag sensor, the edit control, the inline editors and the edit menu
 * item all share (reproducing the legacy `sortable.coffee` init guard —
 * `modify_us AND not archived_code AND not per-card archived`).
 */
export function canEditStory(
    project: PermissionProject,
    ctx: StoryEditContext = {},
): boolean {
    return (
        project.my_permissions.includes("modify_us") &&
        isProjectWritable(project) &&
        ctx.archived !== true
    );
}

/**
 * Authoritative "can delete this story" gate: `delete_us` AND a writable
 * (non-archived) project AND a non-archived story. Gated identically to
 * {@link canEditStory} so the delete affordance never drifts from the edit one.
 */
export function canDeleteStory(
    project: PermissionProject,
    ctx: StoryEditContext = {},
): boolean {
    return (
        project.my_permissions.includes("delete_us") &&
        isProjectWritable(project) &&
        ctx.archived !== true
    );
}
