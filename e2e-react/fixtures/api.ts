/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Playwright-native REST helpers for the isolated React e2e layer (M-04).
 *
 * WHY THIS EXISTS
 *   The committed visual-evidence specs (`kanban.spec.ts`, `backlog.spec.ts`)
 *   are deliberately NON-MUTATING (F-AAP-06): every write is opened for evidence
 *   and then cancelled/dismissed, and every drag is released at its origin. That
 *   keeps the seed-once database byte-for-byte identical across the baseline and
 *   react passes so the before/after artifacts stay comparable (AAP §0.6.3).
 *   The trade-off flagged by QA finding M-04 is that a suite which only ever
 *   cancels can never prove that a write actually PERSISTS end-to-end.
 *
 *   These helpers close that gap WITHOUT breaking net-zero. They let a dedicated
 *   persisted-outcome spec (`persistence.spec.ts`) drive a REAL create through
 *   the React UI, then assert the row was persisted SERVER-SIDE, and finally
 *   remove exactly the row(s) it created — a create+delete round-trip that is
 *   net-zero as a whole (the "guarantee net-zero via snapshot/restore" the M-04
 *   suggested fix asks for). The seeded `sample_data` rows are never touched;
 *   only disposable, uniquely-named `BLITZY-E2E-*` rows are created and deleted.
 *
 * LAYER ISOLATION (AAP §0.6.4)
 *   This module imports ONLY `@playwright/test` type surface plus the shared
 *   credential resolver from `./auth`. It never imports the browserless Jest
 *   layer, the React application sources under `app/react/**`, or the legacy
 *   Protractor harness. All calls go over the same `/api/v1/` REST contract the
 *   application itself uses, through Playwright's built-in `APIRequestContext`
 *   (bundled with `@playwright/test@1.44.1`) — so there is NO new dependency and
 *   nothing Node-16-incompatible is introduced.
 *
 * SECURITY (F-SEC-01)
 *   The bearer token minted here is held only in memory for the duration of the
 *   test run and is never written to disk, logged, or rendered into the DOM/
 *   video. The password is resolved from the environment via `resolveAdminPassword`
 *   (never a literal). Tracing stays disabled in `playwright.config.ts`, so no
 *   request/response record (which would contain the token) is ever committed.
 */

import type { APIRequestContext } from '@playwright/test';
import { LOGIN_USERNAME, resolveAdminPassword } from './auth';

/** Base path of the unchanged Django REST contract (AAP §0.6.1). */
const API_BASE = '/api/v1';

/**
 * The disposable-data name prefix. Every row a persisted-outcome test creates is
 * named `${BLITZY_PROBE_PREFIX}-...` so {@link cleanupBlitzyProbes} can find and
 * delete strays deterministically, and so a human scanning the DB can instantly
 * tell a probe row from a seeded `sample_data` row.
 */
export const BLITZY_PROBE_PREFIX = 'BLITZY-E2E-PERSIST';

/**
 * Minimal shape of a Taiga user story as returned by
 * `GET /api/v1/userstories`. Only the fields the persisted-outcome spec asserts
 * on are typed; the endpoint returns many more.
 */
export interface E2eUserStory {
  /** Immutable primary key — used for the `DELETE /userstories/{id}` cleanup. */
  id: number;
  /** Human-facing per-project reference (e.g. `#182`). */
  ref: number;
  /** The story title the spec creates and matches on. */
  subject: string;
  /** Owning project id. */
  project: number;
  /** Sprint/milestone id, or `null` for a backlog (unassigned) story. */
  milestone: number | null;
}

/**
 * Generate a globally-unique disposable subject for one probe row.
 *
 * Combines the {@link BLITZY_PROBE_PREFIX}, a millisecond timestamp, and a
 * random suffix so concurrent or repeated runs never collide and a matcher can
 * assert on an unambiguous string.
 *
 * @returns e.g. `BLITZY-E2E-PERSIST-1784586108221-483920`.
 */
export function uniqueProbeSubject(): string {
  const rand = Math.floor(Math.random() * 1_000_000);
  return `${BLITZY_PROBE_PREFIX}-${Date.now()}-${rand}`;
}

/**
 * Mint a JWT bearer token over the SAME `/api/v1/auth` endpoint and credential
 * rule the application login uses (username `admin`, password resolved from the
 * environment with the documented dev fallback). This proves the API path is
 * reachable with the identical-by-construction credential and yields the token
 * the persisted-outcome assertions and cleanup use.
 *
 * @param request A Playwright {@link APIRequestContext} (built-in `request`
 *                fixture), pre-bound to the config `baseURL`.
 * @returns The `auth_token` string.
 * @throws If authentication does not return HTTP 200 with an `auth_token`.
 */
export async function apiToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE}/auth`, {
    headers: { 'Content-Type': 'application/json' },
    data: { type: 'normal', username: LOGIN_USERNAME, password: resolveAdminPassword() },
  });
  if (!res.ok()) {
    throw new Error(`POST ${API_BASE}/auth failed: HTTP ${res.status()} ${res.statusText()}`);
  }
  const body = (await res.json()) as { auth_token?: string };
  if (!body.auth_token) {
    throw new Error(`POST ${API_BASE}/auth returned no auth_token`);
  }
  return body.auth_token;
}

/**
 * List ALL user stories for a project (pagination disabled so the full set is
 * returned in one call, exactly as the migrated React data layer does via the
 * `x-disable-pagination` header — M-10 parity).
 *
 * @param request A Playwright {@link APIRequestContext}.
 * @param token   A bearer token from {@link apiToken}.
 * @param projectId Numeric project id (project-3 is `3`).
 * @returns The project's user stories.
 * @throws On a non-2xx response.
 */
export async function listProjectUserstories(
  request: APIRequestContext,
  token: string,
  projectId: number,
): Promise<E2eUserStory[]> {
  const res = await request.get(`${API_BASE}/userstories?project=${projectId}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-disable-pagination': '1' },
  });
  if (!res.ok()) {
    throw new Error(
      `GET ${API_BASE}/userstories?project=${projectId} failed: HTTP ${res.status()}`,
    );
  }
  return (await res.json()) as E2eUserStory[];
}

/**
 * Delete one user story by id (`DELETE /api/v1/userstories/{id}` → 204). Used to
 * restore net-zero after a persisted-outcome create.
 *
 * @param request A Playwright {@link APIRequestContext}.
 * @param token   A bearer token from {@link apiToken}.
 * @param id      The story id to delete.
 * @throws If the delete is neither 204 nor otherwise 2xx.
 */
export async function deleteUserstory(
  request: APIRequestContext,
  token: string,
  id: number,
): Promise<void> {
  const res = await request.delete(`${API_BASE}/userstories/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Django REST returns 204 No Content on a successful destroy.
  if (res.status() !== 204 && !res.ok()) {
    throw new Error(`DELETE ${API_BASE}/userstories/${id} failed: HTTP ${res.status()}`);
  }
}

/**
 * Delete every disposable probe row (subject containing {@link BLITZY_PROBE_PREFIX})
 * left in a project. This is the net-zero SAFETY NET: a persisted-outcome test
 * calls it from `afterEach`/`afterAll` so that even if an assertion fails midway
 * — before the test's own cleanup runs — no `BLITZY-E2E-*` row is ever left
 * behind in the seed-once database. Seeded `sample_data` rows are never matched.
 *
 * @param request A Playwright {@link APIRequestContext}.
 * @param token   A bearer token from {@link apiToken}.
 * @param projectId Numeric project id to sweep.
 * @returns The number of probe rows removed (0 when the project is already clean).
 */
export async function cleanupBlitzyProbes(
  request: APIRequestContext,
  token: string,
  projectId: number,
): Promise<number> {
  const all = await listProjectUserstories(request, token, projectId);
  const probes = all.filter((u) => (u.subject || '').includes(BLITZY_PROBE_PREFIX));
  for (const probe of probes) {
    await deleteUserstory(request, token, probe.id);
  }
  return probes.length;
}
