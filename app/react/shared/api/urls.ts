/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Frozen `/api/v1/` endpoint-key -> URL-template map. Mirrors the subset of
 * `app/coffee/modules/resources.coffee` that the two migrated screens use.
 * CONTRACT-PRESERVING (C-1): do NOT add, rename, or version any key.
 * `%s` placeholders are positional id substitutions (mirrors base/urls.coffee `format`).
 */
export const URL_TEMPLATES = {
    projects: "/projects",
    userstories: "/userstories",
    "userstories-filters": "/userstories/filters_data",
    "bulk-create-us": "/userstories/bulk_create",
    "bulk-update-us-kanban-order": "/userstories/bulk_update_kanban_order",
    "bulk-update-us-backlog-order": "/userstories/bulk_update_backlog_order",
    "bulk-update-us-milestone": "/userstories/bulk_update_milestone",
    "userstory-upvote": "/userstories/%s/upvote",
    "userstory-downvote": "/userstories/%s/downvote",
    "userstory-watch": "/userstories/%s/watch",
    "userstory-unwatch": "/userstories/%s/unwatch",
    "userstory-statuses": "/userstory-statuses",
    swimlanes: "/swimlanes",
    milestones: "/milestones",
    "move-userstories-to-milestone": "/milestones/%s/move_userstories_to_sprint",
    resolver: "/resolver",
    // Per-user key/value storage (`GET/POST/PUT/DELETE /api/v1/user-storage[/<key>]`).
    // The legacy `tgFilterRemoteStorageService` (filter-remote.service.coffee)
    // persists custom filters here under a `generateHash([projectId, ...])` key.
    // This is an EXISTING frozen endpoint (present in the `/api/v1/` root), so
    // reproducing it is contract-preserving (C-1) — NOT a new/renamed key.
    "user-storage": "/user-storage",
} as const;

export type EndpointKey = keyof typeof URL_TEMPLATES;

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

const trimChar = (value: string, ch: string, fromStart: boolean): string => {
    let start = 0;
    let end = value.length;
    if (fromStart) {
        while (start < end && value[start] === ch) {
            start += 1;
        }
    } else {
        while (end > start && value[end - 1] === ch) {
            end -= 1;
        }
    }
    return value.slice(start, end);
};

const substitute = (template: string, ids: ReadonlyArray<string | number>): string => {
    const queue = ids.slice();
    return template.replace(/%s/g, () => String(queue.shift()));
};

/**
 * Resolve a frozen endpoint key to an absolute URL, mirroring
 * `base/urls.coffee` `resolve`: trimEnd(apiUrl,"/") + "/" + trimStart(template,"/"),
 * with positional `%s` substitution for id-bearing templates.
 */
export const resolveUrl = (
    apiUrl: string,
    key: EndpointKey,
    ...ids: ReadonlyArray<string | number>
): string => {
    const template = substitute(URL_TEMPLATES[key], ids);
    return `${trimChar(apiUrl, "/", false)}/${trimChar(template, "/", true)}`;
};

/** Append a query string, skipping null/undefined values (mirrors `$http` params). */
export const buildUrl = (baseUrl: string, params?: QueryParams): string => {
    if (!params) {
        return baseUrl;
    }
    const query = Object.keys(params)
        .filter((key) => params[key] !== undefined && params[key] !== null)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
        .join("&");
    if (!query) {
        return baseUrl;
    }
    return baseUrl.indexOf("?") === -1 ? `${baseUrl}?${query}` : `${baseUrl}&${query}`;
};
