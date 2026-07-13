/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    userStoryUrl,
    taskUrl,
    epicUrl,
    taskboardUrl,
    kanbanUrl,
    backlogUrl,
    adminModulesUrl,
    adminKanbanPowerUpsUrl,
} from "./routes";

describe("shared/nav/routes — HTML5 push-state URL builders", () => {
    it("builds PLAIN (non-hashbang) pathnames for html5Mode routing", () => {
        // The single most important contract: NO leading '#'. A hashbang href
        // would be treated as an in-page fragment and never trigger $route.
        expect(userStoryUrl("proj", 42)).toBe("/project/proj/us/42");
        expect(userStoryUrl("proj", 42).startsWith("#")).toBe(false);
        expect(taskUrl("proj", 7)).toBe("/project/proj/task/7");
        expect(epicUrl("proj", 9)).toBe("/project/proj/epic/9");
    });

    it("builds the taskboard URL with the sprint slug (empty when absent)", () => {
        expect(taskboardUrl("proj", "sprint-1")).toBe("/project/proj/taskboard/sprint-1");
        expect(taskboardUrl("proj", null)).toBe("/project/proj/taskboard/");
        expect(taskboardUrl("proj", undefined)).toBe("/project/proj/taskboard/");
    });

    it("builds the kanban and backlog screen routes", () => {
        expect(kanbanUrl("proj")).toBe("/project/proj/kanban");
        expect(backlogUrl("proj")).toBe("/project/proj/backlog");
    });

    it("builds the admin routes the migrated screens link to", () => {
        expect(adminModulesUrl("proj")).toBe("/project/proj/admin/project-profile/modules");
        expect(adminKanbanPowerUpsUrl("proj")).toBe(
            "/project/proj/admin/project-values/kanban-power-ups",
        );
    });

    it("appends an optional query string and drops nullish values", () => {
        expect(userStoryUrl("proj", 42, { milestone: 5 })).toBe(
            "/project/proj/us/42?milestone=5",
        );
        expect(userStoryUrl("proj", 42, { milestone: null })).toBe("/project/proj/us/42");
        expect(userStoryUrl("proj", 42, { milestone: undefined })).toBe("/project/proj/us/42");
        expect(userStoryUrl("proj", 42, { milestone: "" })).toBe("/project/proj/us/42");
    });

    it("URL-encodes dynamic segments so reserved characters cannot break the href", () => {
        expect(userStoryUrl("a/b proj", 1)).toBe("/project/a%2Fb%20proj/us/1");
        expect(taskboardUrl("proj", "a b")).toBe("/project/proj/taskboard/a%20b");
    });
});
