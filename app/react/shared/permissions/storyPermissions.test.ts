/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    isProjectWritable,
    canEditStory,
    canDeleteStory,
    type PermissionProject,
} from "./storyPermissions";

/**
 * M4: the single, authoritative edit/delete gate. These unit tests pin the
 * exact combination the whole board/backlog now consults — the raw `modify_us`
 * / `delete_us` permission AND a writable (non-archived) project AND (for the
 * Kanban) a non-archived story — so no control, menu action, drag sensor or
 * hook guard can drift back to a bare-permission check.
 */

/** Minimal permission-project fixture (only the two fields the gates read). */
function proj(
    permissions: string[],
    archivedCode: string | null = null,
): PermissionProject {
    return { my_permissions: permissions, archived_code: archivedCode };
}

describe("storyPermissions — isProjectWritable", () => {
    it("is writable when archived_code is null / undefined / empty", () => {
        expect(isProjectWritable({ archived_code: null })).toBe(true);
        expect(isProjectWritable({ archived_code: undefined })).toBe(true);
        expect(isProjectWritable({ archived_code: "" })).toBe(true);
    });

    it("is NOT writable when archived_code is a non-empty code (read-only project)", () => {
        expect(isProjectWritable({ archived_code: "blocked-by-owner" })).toBe(false);
    });
});

describe("storyPermissions — canEditStory", () => {
    it("true only with modify_us AND writable project AND non-archived story", () => {
        expect(canEditStory(proj(["modify_us"]))).toBe(true);
    });

    it("false without modify_us even on a writable project", () => {
        expect(canEditStory(proj(["view_us", "delete_us"]))).toBe(false);
    });

    it("false on a read-only (archived_code) project even WITH modify_us", () => {
        expect(canEditStory(proj(["modify_us"], "archived"))).toBe(false);
    });

    it("false for an archived story (kanban ctx.archived === true) even WITH modify_us", () => {
        expect(canEditStory(proj(["modify_us"]), { archived: true })).toBe(false);
    });

    it("true with modify_us and ctx.archived explicitly false", () => {
        expect(canEditStory(proj(["modify_us"]), { archived: false })).toBe(true);
    });
});

describe("storyPermissions — canDeleteStory", () => {
    it("true only with delete_us AND writable project AND non-archived story", () => {
        expect(canDeleteStory(proj(["delete_us"]))).toBe(true);
    });

    it("false without delete_us (e.g. modify_us only) — delete NEVER rides on modify", () => {
        expect(canDeleteStory(proj(["modify_us"]))).toBe(false);
    });

    it("false on a read-only (archived_code) project even WITH delete_us", () => {
        expect(canDeleteStory(proj(["delete_us"], "archived"))).toBe(false);
    });

    it("false for an archived story (ctx.archived === true) even WITH delete_us", () => {
        expect(canDeleteStory(proj(["delete_us"]), { archived: true })).toBe(false);
    });

    it("edit and delete are gated INDEPENDENTLY (modify_us grants edit, not delete)", () => {
        const p = proj(["modify_us"]);
        expect(canEditStory(p)).toBe(true);
        expect(canDeleteStory(p)).toBe(false);
    });
});
