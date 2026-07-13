/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Authoritative navigation URL builders for the React screens.
 *
 * The surviving AngularJS application runs with HTML5 push-state routing enabled
 * (`$locationProvider.html5Mode({enabled: true, requireBase: true})` in
 * `app/coffee/app.coffee`). Consequently the browser location for every in-app
 * route is a PLAIN pathname (`/project/<slug>/us/<ref>`), NOT a hashbang
 * (`#/project/...`). A hashbang href would be interpreted by the browser as an
 * in-page fragment and would NOT trigger an AngularJS `$route` change, so the
 * link would silently fail to navigate.
 *
 * These helpers reproduce the exact targets the legacy `tg-nav` directive
 * generated for the two migrated screens, mirroring the `$routeProvider.when`
 * paths declared in `app.coffee`:
 *
 *   - `project-userstories-detail`              -> /project/:pslug/us/:usref
 *   - `project-tasks-detail`                    -> /project/:pslug/task/:taskref
 *   - `project-epics-detail`                    -> /project/:pslug/epic/:epicref
 *   - `project-taskboard`                       -> /project/:pslug/taskboard/:sslug
 *   - `project-kanban`                          -> /project/:pslug/kanban
 *   - `project-backlog`                         -> /project/:pslug/backlog
 *   - `project-admin-project-profile-modules`   -> /project/:pslug/admin/project-profile/modules
 *   - `project-admin-project-values-kanban-power-ups`
 *                                               -> /project/:pslug/admin/project-values/kanban-power-ups
 *
 * All builders return leading-slash absolute pathnames and URL-encode the
 * dynamic segments so subjects/slugs with reserved characters cannot break the
 * generated href.
 */

/** A flat query-parameter bag; nullish values are dropped. */
export type NavQuery = Record<string, string | number | null | undefined>;

/** Encode a single path segment, tolerating already-primitive values. */
function seg(value: string | number): string {
    return encodeURIComponent(String(value));
}

/**
 * Append a query string (if any non-nullish params are present). Mirrors the
 * legacy behaviour where `tg-nav` forwarded extra params (e.g. the sprint's
 * `?milestone=<id>` deep-link from the backlog sprint list).
 */
function withQuery(path: string, query?: NavQuery): string {
    if (!query) {
        return path;
    }
    const parts: string[] = [];
    for (const key of Object.keys(query)) {
        const value = query[key];
        if (value !== null && value !== undefined && value !== "") {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        }
    }
    return parts.length > 0 ? `${path}?${parts.join("&")}` : path;
}

/** `/project/<slug>/us/<ref>` — user-story detail. */
export function userStoryUrl(slug: string, ref: number | string, query?: NavQuery): string {
    return withQuery(`/project/${seg(slug)}/us/${seg(ref)}`, query);
}

/** `/project/<slug>/task/<ref>` — task detail. */
export function taskUrl(slug: string, ref: number | string, query?: NavQuery): string {
    return withQuery(`/project/${seg(slug)}/task/${seg(ref)}`, query);
}

/** `/project/<slug>/epic/<ref>` — epic detail. */
export function epicUrl(slug: string, ref: number | string, query?: NavQuery): string {
    return withQuery(`/project/${seg(slug)}/epic/${seg(ref)}`, query);
}

/** `/project/<slug>/taskboard/<sprintSlug>` — sprint taskboard. */
export function taskboardUrl(slug: string, sprintSlug: string | null | undefined): string {
    return `/project/${seg(slug)}/taskboard/${seg(sprintSlug ?? "")}`;
}

/** `/project/<slug>/kanban` — the Kanban board route. */
export function kanbanUrl(slug: string): string {
    return `/project/${seg(slug)}/kanban`;
}

/** `/project/<slug>/backlog` — the Backlog route. */
export function backlogUrl(slug: string): string {
    return `/project/${seg(slug)}/backlog`;
}

/** `/project/<slug>/admin/project-profile/modules` — module activation admin. */
export function adminModulesUrl(slug: string): string {
    return `/project/${seg(slug)}/admin/project-profile/modules`;
}

/**
 * `/project/<slug>/admin/project-values/kanban-power-ups` — the target the
 * legacy kanban-table "create swimlane" affordance used
 * (`tg-nav="project-admin-project-values-kanban-power-ups:project=project.slug"`).
 */
export function adminKanbanPowerUpsUrl(slug: string): string {
    return `/project/${seg(slug)}/admin/project-values/kanban-power-ups`;
}
