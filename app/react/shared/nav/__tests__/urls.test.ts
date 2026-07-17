/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import {
    projectAdminModulesUrl,
    projectEpicUrl,
    projectTaskUrl,
    projectTaskboardUrl,
    projectUserStoryUrl,
    resolveNavUrl,
} from "../urls";

// getBaseHref() reads window.taigaConfig.baseHref lazily, so each test controls
// it directly. Reset to the default ("/") between cases.
type ConfigWindow = { taigaConfig?: { baseHref?: string } };
function setBaseHref(value: string | undefined): void {
    (window as unknown as ConfigWindow).taigaConfig =
        value === undefined ? {} : { baseHref: value };
}

describe("[N-04] shared nav URL resolver", () => {
    afterEach(() => {
        delete (window as unknown as ConfigWindow).taigaConfig;
    });

    describe("default baseHref (\"/\")", () => {
        it("builds the exact HTML5 epic/task/us/admin destinations", () => {
            expect(projectEpicUrl("proj", 12)).toBe("/project/proj/epic/12");
            expect(projectTaskUrl("proj", 7)).toBe("/project/proj/task/7");
            expect(projectUserStoryUrl("proj", 42)).toBe("/project/proj/us/42");
            expect(projectAdminModulesUrl("proj")).toBe(
                "/project/proj/admin/project-profile/modules",
            );
        });

        it("[M-07] builds the HTML5 sprint taskboard destination", () => {
            expect(projectTaskboardUrl("proj", "sprint-7")).toBe(
                "/project/proj/taskboard/sprint-7",
            );
        });

        it("templates match the surviving AngularJS routes (base.coffee)", () => {
            // Verbatim key → template parity with app/coffee/modules/base.coffee.
            expect(resolveNavUrl("project-epics-detail", { project: "p", ref: 1 })).toBe(
                "/project/p/epic/1",
            );
            expect(resolveNavUrl("project-tasks-detail", { project: "p", ref: 2 })).toBe(
                "/project/p/task/2",
            );
            expect(
                resolveNavUrl("project-userstories-detail", { project: "p", ref: 3 }),
            ).toBe("/project/p/us/3");
            expect(
                resolveNavUrl("project-admin-project-profile-modules", { project: "p" }),
            ).toBe("/project/p/admin/project-profile/modules");
            expect(
                resolveNavUrl("project-taskboard", { project: "p", sprint: "s1" }),
            ).toBe("/project/p/taskboard/s1");
        });
    });

    describe("sub-path baseHref", () => {
        it("prefixes a trailing-slash baseHref (\"/taiga/\")", () => {
            setBaseHref("/taiga/");
            expect(projectEpicUrl("proj", 12)).toBe("/taiga/project/proj/epic/12");
            expect(projectAdminModulesUrl("proj")).toBe(
                "/taiga/project/proj/admin/project-profile/modules",
            );
        });

        it("normalizes a baseHref that lacks a trailing slash (\"/taiga\")", () => {
            setBaseHref("/taiga");
            expect(projectTaskUrl("proj", 7)).toBe("/taiga/project/proj/task/7");
        });
    });

    describe("param encoding", () => {
        it("URL-encodes path params (defense-in-depth for the href)", () => {
            // A slug with a space/special char is percent-encoded so the anchor
            // never emits a raw, potentially-breaking value.
            expect(projectEpicUrl("a b", 1)).toBe("/project/a%20b/epic/1");
            expect(projectUserStoryUrl("x/y", 5)).toBe("/project/x%2Fy/us/5");
        });

        it("accepts numeric or string refs identically", () => {
            expect(projectTaskUrl("p", 9)).toBe(projectTaskUrl("p", "9"));
        });
    });
});
