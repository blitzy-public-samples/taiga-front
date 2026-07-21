/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useResolvedProjectId — the shared React hook that gives the Kanban and Backlog
 * containers a VALID numeric project id, resolving it from the URL slug when the
 * hosting custom element does not carry a usable `project-id` attribute.
 *
 * WHY (F-REG-01 root cause — the blank board)
 *   The Jade partials host `<tg-react-kanban project-id="{{project.id}}"
 *   project-slug="{{project.slug}}">` / `<tg-react-backlog …>`. Those AngularJS
 *   interpolations resolve against a `project` scope variable that the deleted
 *   Kanban/Backlog controllers used to populate (AAP §0.2.1); with the controllers
 *   gone AngularJS interpolates BOTH attributes to the EMPTY STRING. The old code
 *   did `Number(props.projectId)` (= `Number("")` = 0), failed the
 *   `Number.isInteger(id) && id > 0` guard, and rendered a permanently blank
 *   "invalid-project" shell.
 *
 * WHAT THIS DOES ("props down, events up"; changes confined to app/react/**)
 *   1. FAST PATH — if `project-id` already carries a valid positive integer
 *      (either passed by a future AngularJS re-render via
 *      `attributeChangedCallback`, or set by a test/host that knows the id), use
 *      it directly with NO network request.
 *   2. SLOW PATH — otherwise derive the slug (from the `project-slug` attribute
 *      when populated, else by parsing `window.location.{pathname,hash}` for the
 *      `/project/<slug>/…` segment) and resolve it via `GET /projects/by_slug`
 *      (the SAME endpoint the AngularJS shell uses), yielding the real id.
 *
 *   While the slow path is in flight `resolving` is `true`, so the caller can
 *   render a transient LOADING shell rather than the misleading blank/invalid
 *   state. If no slug can be determined at all, `resolving` settles to `false`
 *   with an invalid id so the caller falls back to its inert invalid host.
 *
 * FIDELITY / SAFETY
 *   The lookup goes through the shared `api` client, so the `/api/v1/` base, the
 *   `Authorization: Bearer` token and the `X-Session-Id` header are identical to
 *   AngularJS — the backend cannot tell React from AngularJS. The hook never
 *   throws from render or effect; a failed lookup simply leaves the id invalid.
 *
 * v16.19.1 compatible, bundled by esbuild into `dist/js/react.js`.
 */

import { useState, useEffect } from 'react';
import { getProjectBySlug } from './api/projects';

/** The shape both screen containers accept for their project-context props. */
export interface ProjectContextProps {
    /** `project-id` — the numeric project id, received as a string (may be empty). */
    projectId?: string;
    /** `project-slug` — the project slug (may be empty when AngularJS has no `project`). */
    projectSlug?: string;
}

/** The resolved project context returned to the caller. */
export interface ResolvedProjectId {
    /** The resolved numeric project id (`0` while unresolved / unresolvable). */
    projectId: number;
    /** `true` iff `projectId` is a positive integer safe to fetch/subscribe with. */
    projectIdValid: boolean;
    /** `true` while a `/projects/by_slug` lookup is in flight (render a loading shell). */
    resolving: boolean;
}

/**
 * Matches the `/project/<slug>/…` segment in the URL. Taiga routes the two
 * screens at `/project/<slug>/kanban` and `/project/<slug>/backlog`; the pattern
 * is intentionally anchored on the `project/` prefix and captures the single
 * path segment that follows (the slug). Applied to `pathname + hash` so it works
 * under both HTML5 and hash-based routing.
 */
const PROJECT_SLUG_PATTERN = /\/project\/([^/?#]+)/;

/** `true` for a usable positive-integer id. */
function isValidId(id: number): boolean {
    return Number.isInteger(id) && id > 0;
}

/**
 * Normalize a candidate slug: trim it and reject empties or an UNRESOLVED
 * AngularJS interpolation literal (e.g. `"{{project.slug}}"`), returning `null`
 * so the caller keeps looking (or gives up cleanly).
 */
function normalizeSlug(candidate: string | null | undefined): string | null {
    const slug = (candidate ?? '').trim();
    if (!slug || slug.indexOf('{{') !== -1) {
        return null;
    }
    return slug;
}

/** Extract the project slug from the current browser URL, or `null`. */
function parseSlugFromLocation(): string | null {
    // Include the hash so hash-routed deployments (`#/project/<slug>/…`) resolve
    // too; the runtime-observed shell uses HTML5 pathname (`/project/<slug>/…`).
    const source = `${window.location.pathname}${window.location.hash}`;
    const match = PROJECT_SLUG_PATTERN.exec(source);
    return match ? normalizeSlug(match[1]) : null;
}

/**
 * Resolve the effective project id for a screen container.
 *
 * @param props The container's project-context props (`projectId`/`projectSlug`).
 * @returns `{ projectId, projectIdValid, resolving }` — see {@link ResolvedProjectId}.
 */
export function useResolvedProjectId(props: ProjectContextProps): ResolvedProjectId {
    // Direct attribute id (fast path). Recomputed every render so a later
    // AngularJS `attributeChangedCallback` that writes the real id is honored.
    const directId = Number(props.projectId);
    const directIdValid = isValidId(directId);

    // Seed state from the direct id so a valid attribute needs NO async round-trip
    // and NO loading flash. Otherwise start in the "resolving" state.
    const [resolvedId, setResolvedId] = useState<number>(directIdValid ? directId : 0);
    const [resolving, setResolving] = useState<boolean>(!directIdValid);

    useEffect(() => {
        // Fast path: a valid attribute id supersedes any prior slug resolution.
        if (directIdValid) {
            setResolvedId(directId);
            setResolving(false);
            return undefined;
        }

        // Slow path: prefer the explicit slug prop, else parse it from the URL.
        const slug = normalizeSlug(props.projectSlug) ?? parseSlugFromLocation();
        if (!slug) {
            // Nothing to resolve from — settle to an inert invalid state rather
            // than spinning forever (the caller renders its invalid host).
            setResolving(false);
            return undefined;
        }

        let cancelled = false;
        setResolving(true);
        void (async () => {
            try {
                const project = await getProjectBySlug(slug);
                if (cancelled) {
                    return;
                }
                const id = Number(project?.id);
                if (isValidId(id)) {
                    setResolvedId(id);
                }
            } catch {
                // Leave `resolvedId` invalid; the caller renders its inert host.
                // The lookup failure is intentionally swallowed here (never throws
                // from an effect); a real project always resolves in practice.
            } finally {
                if (!cancelled) {
                    setResolving(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [directId, directIdValid, props.projectSlug]);

    const projectIdValid = isValidId(resolvedId);
    return { projectId: resolvedId, projectIdValid, resolving };
}
