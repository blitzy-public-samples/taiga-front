/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * projects.ts — typed async wrappers over the `/api/v1/projects/…` endpoints
 * that the React Kanban and Backlog screens need to RESOLVE their project
 * context at runtime.
 *
 * WHY THIS EXISTS (F-REG-01 root cause)
 *   The migrated Jade partials host `<tg-react-kanban project-id="{{project.id}}"
 *   project-slug="{{project.slug}}">` / `<tg-react-backlog …>`. Those AngularJS
 *   interpolations resolve against a `project` scope variable that the now-deleted
 *   Kanban/Backlog controllers used to populate (AAP §0.2.1). With the controllers
 *   gone there is no such scope variable, so AngularJS interpolates BOTH attributes
 *   to the empty string — the React containers receive `project-id=""` /
 *   `project-slug=""` and render an inert "invalid-project" shell (the blank board).
 *
 *   Rather than reintroduce AngularJS controller wiring (which the AAP forbids —
 *   all changes stay inside `app/react/**`), the React screens SELF-RESOLVE their
 *   project from the browser URL, exactly as the `backlog.jade` host comment
 *   already documents ("React self-resolves the project from URL/session, so empty
 *   values are safe"). This adapter provides the single `/projects/by_slug` lookup
 *   that turns the URL slug into the numeric project id.
 *
 * FIDELITY
 *   `GET /projects/by_slug?slug=<slug>` is the SAME endpoint the AngularJS shell
 *   itself uses to resolve the current project (`resources/projects.coffee`
 *   `bySlug` → `GET /projects/by_slug`); the React screens therefore issue an
 *   identical request and remain indistinguishable from AngularJS to the backend.
 *   The `/api/v1/` base, the `Authorization: Bearer` token and the `X-Session-Id`
 *   header are all attached by the shared `api` client, so no contract changes.
 *
 * v16.19.1 compatible, bundled by esbuild into `dist/js/react.js`.
 */

import { api } from './client';
import type { Project } from '../types';

/**
 * Resolve a project by its URL slug.
 *
 * Reproduces the AngularJS `service.bySlug(slug)`
 * (`app/coffee/modules/resources/projects.coffee`) →
 * `GET /projects/by_slug?slug=<slug>`.
 *
 * The `slug` is passed as a query parameter (serialized by the shared client's
 * `buildQueryString`); the resolved body is the full {@link Project} detail,
 * including `id`, `my_permissions`, `us_statuses`, `members`, and the
 * `is_kanban_activated` / `is_backlog_activated` flags the screens later read.
 *
 * @param slug The project slug taken from the URL (e.g. `"project-1"`).
 * @returns The resolved {@link Project}.
 */
export function getProjectBySlug(slug: string): Promise<Project> {
    return api.get<Project>('/projects/by_slug', { slug });
}
