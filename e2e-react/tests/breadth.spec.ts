/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Optional E2E flow-breadth spec for the React Kanban & Backlog migration
 * (addresses QA finding F-E2E-1 / Issue 4, MINOR — "Optionally add E2E cases for
 * reload-persistence and a permission-denied path").
 *
 * What this adds
 * --------------
 * The two evidence specs (`tests/kanban.spec.ts`, `tests/backlog.spec.ts`) cover
 * the ported feature flows and produce the committed before/after visual
 * evidence. They do NOT exercise two breadth dimensions the QA report flagged as
 * unit-mitigated but absent at the E2E layer:
 *
 *   1. reload-persistence — no spec performed a full `page.reload()`, so the
 *      Web-Component coexistence remount was never proven end-to-end. A full
 *      reload forces `<tg-react-kanban>` / `<tg-react-backlog>`
 *      `disconnectedCallback` -> `connectedCallback`, tears down and recreates the
 *      React root, and re-fetches `/api/v1/` — all while reusing the AngularJS
 *      session token from `localStorage 'token'`. This is the core coexistence
 *      lifecycle the migration must survive, so it is worth a direct E2E check.
 *
 *   2. permission-denied — no spec verified that the shared coexistence session
 *      is actually REQUIRED. `project-3` is a PRIVATE sample project
 *      (`is_private=true`, `anon_permissions=[]`): its backlog must not be
 *      exposed to a session with no JWT. This proves the React screens do not
 *      leak private data when the shared session is absent.
 *
 * Evidence isolation (preserves the Issue-1 one-to-one artifact pairing)
 * ----------------------------------------------------------------------
 * This spec intentionally writes NO committed evidence. Unlike the two evidence
 * specs — which persist scenario-named PNG/WebM into the git-tracked
 * `e2e-react/artifacts/<variant>/` tree via an `afterEach` that calls
 * `page.video().saveAs(...)` / `page.screenshot({ path })` — this spec has NO
 * such `afterEach` and never calls `artifactsDir()`. Playwright still records a
 * transient per-test video, but (per `playwright.config.ts`) it lands in the
 * gitignored `outputDir` (`../tmp/playwright-output`) and is never copied into
 * `artifacts/`. Adding these tests therefore does NOT create any react-only
 * artifact and keeps the baseline<->react evidence sets paired one-to-one.
 *
 * Non-regressive & isolated
 * -------------------------
 * These are additive cases; the deleted legacy Protractor suites covered none of
 * them (reload=0, permission=0). They run under the same deterministic config
 * (`workers: 1`, `retries: 0`, Firefox) as the rest of the suite, touch only
 * `e2e-react/`, and make no source changes to the frozen React bundle or any
 * out-of-scope file.
 *
 * Playwright-only: imports `@playwright/test` (via the auth fixture) and the
 * sibling fixtures. NO Jest imports, NO `app/react/**` imports; the root
 * `jest.config.js` excludes `e2e-react/`, so `npm test` never loads this file —
 * it runs exclusively under `npm run e2e`.
 *
 * @module e2e-react/tests/breadth.spec
 */

import { test, expect } from '../fixtures/auth.fixture';
import { waitLoader, dismissChrome } from '../fixtures/helpers';
import { kanbanUrl, backlogUrl, BACKLOG_PROJECT } from '../fixtures/sampleData';

/**
 * Kanban column hook — `.task-column` (React) / `.taskboard-column` (baseline),
 * matching the `columns()` helper in `tests/kanban.spec.ts`.
 */
const KANBAN_COLUMNS = '.task-column, .taskboard-column';

/**
 * Kanban card hook — the card element is `tg-card.card`; `.card` is the primary
 * hook with `tg-card` as a fallback, matching `allCards()` in the kanban spec.
 */
const KANBAN_CARDS = '.card, tg-card';

/**
 * Backlog user-story row hook — React renders backlog rows as `.us-item-row`
 * inside `.backlog-table-body` (backlog-row.jade), matching `SEL.usRow` in
 * `tests/backlog.spec.ts`.
 */
const BACKLOG_ROWS = '.backlog-table-body .us-item-row';

test.describe('e2e breadth (react)', () => {
  test('kanban board re-renders after a full page reload', async ({ page }) => {
    await page.goto(kanbanUrl());
    await waitLoader(page);
    await dismissChrome(page);

    const columns = page.locator(KANBAN_COLUMNS);
    await expect(columns.first()).toBeVisible();
    const colsBefore = await columns.count();
    expect(colsBefore).toBeGreaterThan(0);
    const cardsBefore = await page.locator(KANBAN_CARDS).count();
    expect(cardsBefore).toBeGreaterThan(0);

    // Full reload: exercises the coexistence remount (custom element
    // disconnect -> reconnect, React root unmount -> remount) and a fresh board
    // fetch that reuses the AngularJS session token still present in
    // localStorage. Nothing is mutated between the two loads.
    await page.reload();
    await waitLoader(page);
    await dismissChrome(page);

    // Structural persistence: the same column set renders after the reload.
    await expect(columns.first()).toBeVisible();
    expect(await columns.count()).toBe(colsBefore);
    // Data persistence: the same seeded cards re-render (poll to allow the
    // remounted React root to finish its post-reload fetch/paint).
    await expect.poll(() => page.locator(KANBAN_CARDS).count()).toBe(cardsBefore);
  });

  test('backlog re-renders after a full page reload', async ({ page }) => {
    await page.goto(backlogUrl());
    await waitLoader(page);
    await dismissChrome(page);

    const rows = page.locator(BACKLOG_ROWS);
    await expect(rows.first()).toBeVisible();
    const rowsBefore = await rows.count();
    expect(rowsBefore).toBeGreaterThan(0);

    // Full reload: same coexistence remount + re-fetch as the kanban case, for
    // the backlog custom element.
    await page.reload();
    await waitLoader(page);
    await dismissChrome(page);

    await expect(rows.first()).toBeVisible();
    await expect.poll(() => page.locator(BACKLOG_ROWS).count()).toBe(rowsBefore);
  });

  test('private backlog is not exposed without an authenticated session', async ({ page }) => {
    // The fixture logs in as admin; establish the origin so localStorage is
    // addressable, then DROP the session (clear the JWT + session id) to
    // simulate an unauthenticated / expired session.
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    // project-3 is PRIVATE (is_private=true, anon_permissions=[]): the shared
    // coexistence session token is REQUIRED to read it. Navigate there with no
    // token.
    await page.goto(backlogUrl(BACKLOG_PROJECT));
    // Allow the app to settle on its denial outcome: an auth-guard redirect to
    // the login screen, or a rendered-but-empty backlog for the private project.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);

    const onLogin = /\/login\/?$/.test(new URL(page.url()).pathname);
    const rowCount = await page.locator(BACKLOG_ROWS).count();

    // Either valid denial outcome is acceptable; what must NEVER happen is the
    // private project's user stories rendering to an unauthenticated session.
    expect(onLogin || rowCount === 0).toBe(true);
  });
});
