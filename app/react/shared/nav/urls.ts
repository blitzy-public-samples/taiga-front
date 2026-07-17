/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Navigation URL resolver (React port of the AngularJS `$navUrls` service).
 *
 * The legacy client resolved in-app destinations through `$navUrls.resolve(key,
 * params)` against a central key → route-template registry
 * (`app/coffee/modules/base.coffee`), then HTML5-mode routing prefixed the
 * result with the document `<base href>`. The migrated React screens link to a
 * handful of those destinations (epic / task / user-story detail, project
 * modules admin); this module reproduces the exact templates and the baseHref
 * prefixing so the emitted links resolve to the SAME surviving AngularJS routes.
 *
 * [N-04] Replaces the placeholder `href=""` / `href="#"` anchors the initial
 * migration emitted for the card epic/task links and the burndown "Admin" link.
 * The shared resolver is also the mechanism M-07 uses for the user-story links
 * in the Backlog screen, so the two findings share one tested implementation.
 */

import { getBaseHref } from "../config/taigaConfig";

// Legacy `$navUrls` key → HTML5 route template, copied VERBATIM from the
// AngularJS nav-url registry (app/coffee/modules/base.coffee L71-73, L87). Only
// the subset the React screens link to is reproduced.
const NAV_URL_TEMPLATES = {
    "project-userstories-detail": "/project/:project/us/:ref",
    "project-epics-detail": "/project/:project/epic/:ref",
    "project-tasks-detail": "/project/:project/task/:ref",
    "project-taskboard": "/project/:project/taskboard/:sprint",
    "project-admin-project-profile-modules":
        "/project/:project/admin/project-profile/modules",
} as const;

export type NavUrlKey = keyof typeof NAV_URL_TEMPLATES;

/**
 * Resolve a legacy nav-url key to a baseHref-aware, HTML5 (non-hash) URL.
 *
 * Named path params (`:project`, `:ref`, …) are substituted from `params` and
 * URL-encoded (defense-in-depth for the href attribute; valid Taiga slugs and
 * numeric refs are unaffected). The configured baseHref
 * (`window.taigaConfig.baseHref`, default `"/"`) is normalized to a trailing
 * slash and joined to the template with its leading slash removed, so a
 * deployment mounted under a sub-path (e.g. baseHref `"/taiga/"`) yields
 * `"/taiga/project/…"` rather than a root-relative `"/project/…"` that would
 * bypass the base.
 */
export function resolveNavUrl(
    key: NavUrlKey,
    params: Record<string, string | number> = {},
): string {
    let path: string = NAV_URL_TEMPLATES[key];
    for (const [name, value] of Object.entries(params)) {
        path = path.replace(`:${name}`, encodeURIComponent(String(value)));
    }
    const rawBase = getBaseHref();
    const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
    return base + path.replace(/^\//, "");
}

/** `/project/:project/us/:ref` — user-story detail. */
export function projectUserStoryUrl(
    slug: string,
    ref: number | string,
): string {
    return resolveNavUrl("project-userstories-detail", { project: slug, ref });
}

/** `/project/:project/epic/:ref` — epic detail. */
export function projectEpicUrl(slug: string, ref: number | string): string {
    return resolveNavUrl("project-epics-detail", { project: slug, ref });
}

/** `/project/:project/task/:ref` — task detail. */
export function projectTaskUrl(slug: string, ref: number | string): string {
    return resolveNavUrl("project-tasks-detail", { project: slug, ref });
}

/**
 * `/project/:project/taskboard/:sprint` — sprint taskboard.
 *
 * The legacy `tgBacklogSprintHeader` resolved this with `{project:
 * project.slug, sprint: sprint.slug}` (`backlog/sprints.coffee` L80-81) and
 * HTML5-mode routing turned it into a real navigation — NOT a `#`-fragment
 * change. [M-07] The React Backlog reuses the same key so the header name link
 * and the "go to taskboard" button navigate identically.
 */
export function projectTaskboardUrl(
    slug: string,
    sprintSlug: string,
): string {
    return resolveNavUrl("project-taskboard", {
        project: slug,
        sprint: sprintSlug,
    });
}

/** `/project/:project/admin/project-profile/modules` — project modules admin. */
export function projectAdminModulesUrl(slug: string): string {
    return resolveNavUrl("project-admin-project-profile-modules", {
        project: slug,
    });
}
