/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Integration test for the api-folder barrel (`./index`).
 *
 * This is the module-level-integration guard for the review finding on
 * `app/react/shared/api/index.ts`: the barrel must publish the COMPLETE facade
 * — including the project / swimlane / stats / tags-colors / paginated-unassigned
 * loaders required by the future Kanban and Backlog hooks — PLUS its typed loader
 * response contracts, all through the single public import surface consumers use
 * (`import { createApiClient } from "../shared/api"`).
 *
 * The value assertions exercise the runtime re-exports; the typed-contract block
 * is a compile-time proof (the annotations fail `tsc` if any contract is missing
 * from the barrel), which is why the imports below are split into value vs. type.
 */

import { createApiClient, URL_TEMPLATES, resolveUrl, buildUrl, ApiError } from "./index";
import type {
    ApiClient,
    BulkStoryOrder,
    SavableEntity,
    ProjectStats,
    TagsColors,
    UnassignedUserStoriesResult,
    HttpMethod,
    HttpResponse,
    RequestOptions,
    EndpointKey,
    QueryParams,
} from "./index";
import type { MountContext } from "../types";

const context: MountContext = {
    projectSlug: "p",
    token: "t",
    sessionId: "s",
    apiUrl: "http://localhost:8000/api/v1",
    eventsUrl: null,
    language: "en",
};

describe("api barrel (index.ts) public surface", () => {
    it("re-exports the facade factory and the URL / http value helpers", () => {
        expect(typeof createApiClient).toBe("function");
        expect(typeof resolveUrl).toBe("function");
        expect(typeof buildUrl).toBe("function");
        // ApiError is a class => a value re-export (NOT `export type`).
        expect(typeof ApiError).toBe("function");
        expect(new ApiError(404, null)).toBeInstanceOf(Error);
    });

    it("re-exports the frozen URL template map, including the added project/swimlane keys", () => {
        expect(URL_TEMPLATES.userstories).toBe("/userstories");
        expect(URL_TEMPLATES.projects).toBe("/projects");
        expect(URL_TEMPLATES.swimlanes).toBe("/swimlanes");
        expect(URL_TEMPLATES.milestones).toBe("/milestones");
    });

    it("publishes the COMPLETE facade: existing operations plus the new metadata/pagination loaders", () => {
        const api = createApiClient(context);

        // Pre-existing operations remain published.
        expect(typeof api.resolveProject).toBe("function");
        expect(typeof api.listMilestones).toBe("function");
        expect(typeof api.bulkUpdateKanbanOrder).toBe("function");
        expect(typeof api.save).toBe("function");

        // New required loaders (review finding C1 + index.ts module-level integration):
        // full project metadata, stats, tag colors, swimlanes, paginated unassigned.
        expect(typeof api.getProjectBySlug).toBe("function");
        expect(typeof api.getProjectStats).toBe("function");
        expect(typeof api.getProjectTagsColors).toBe("function");
        expect(typeof api.listSwimlanes).toBe("function");
        expect(typeof api.listUnassignedUserStories).toBe("function");
    });

    it("exports every typed loader response contract through the barrel", () => {
        const api = createApiClient(context);

        // Compile-time proof each type is re-exported by the barrel (erased at
        // runtime); a missing export makes these annotations fail `tsc`.
        const typedApi: ApiClient = api;
        const stats: ProjectStats = { total_points: 1 };
        const colors: TagsColors = { urgent: null };
        const page: UnassignedUserStoriesResult = {
            userStories: [],
            count: 0,
            current: 1,
            paginatedBy: 30,
            hasNext: false,
            backlogTotal: 0,
        };
        const order: BulkStoryOrder = { us_id: 1, order: 2 };
        const savable: SavableEntity = { id: 1 };
        const method: HttpMethod = "GET";
        const options: RequestOptions = { enablePagination: true };
        const responseShape: HttpResponse<number> = { data: 1, headers: new Headers(), status: 200 };
        const key: EndpointKey = "userstories";
        const params: QueryParams = { project: 1 };

        expect(typeof typedApi.getProjectStats).toBe("function");
        expect(stats.total_points).toBe(1);
        expect(colors.urgent).toBeNull();
        expect(page.paginatedBy).toBe(30);
        expect(order.us_id).toBe(1);
        expect(savable.id).toBe(1);
        expect(method).toBe("GET");
        expect(options.enablePagination).toBe(true);
        expect(responseShape.status).toBe(200);
        expect(key).toBe("userstories");
        expect(params.project).toBe(1);
    });
});
