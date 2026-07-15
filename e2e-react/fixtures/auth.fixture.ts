/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Authenticated-page Playwright fixture for the React Kanban & Backlog E2E
 * project (`e2e-react/`).
 *
 * This module reproduces the legacy Protractor login as a Playwright fixture
 * (ported, NOT copied). The behavioral source is `conf.e2e.js` `onPrepare`
 * (which navigates to the host, clears storage, flags the e2e session, submits
 * the login form and waits for the post-auth redirect) together with
 * `e2e/utils/common.js` `login` / `closeJoyride`. Neither source is edited.
 *
 * Why this fixture only drives the login FORM
 * -------------------------------------------
 * The React screens run INSIDE the same AngularJS deployable client via the
 * Web Component coexistence pattern. When the AngularJS login succeeds it stores
 * the JWT under `localStorage 'token'` (see
 * `app/coffee/modules/base/storage.coffee`, stored JSON-serialized), which
 * `app/coffee/modules/base/http.coffee:23` sends as `Authorization: Bearer
 * <token>`, and it sets `window.taiga.sessionId` (`app/coffee/app.coffee`) which
 * is sent as `X-Session-Id`. Because the React custom elements
 * (`<tg-react-kanban>` / `<tg-react-backlog>`) execute in the SAME page/origin,
 * they reuse that exact session with NO re-authentication. Therefore this
 * fixture MUST perform ONLY the UI login and MUST NOT write `token` /
 * `sessionId` itself — doing so would diverge from the coexistence contract and
 * risk masking a real session-sharing regression.
 *
 * Design constraints (kept deliberately narrow):
 *  - Playwright-only module. The only imports are `@playwright/test` and the
 *    sibling `./helpers`; there are NO Jest/unit imports and NO React
 *    (`app/react/**`) imports. The root `jest.config.js` excludes `e2e-react/`,
 *    so `npm test` never loads this file — it runs exclusively under
 *    `npm run e2e` (Playwright, Firefox engine).
 *  - Relative navigation only. `page.goto('/')` and `page.goto('/login')`
 *    resolve against the Playwright `baseURL` configured in
 *    `../playwright.config.ts` (default `http://localhost:9000`, the Docker
 *    gateway; override with `TAIGA_HOST`). No host literal and no `:9001` are
 *    hard-coded here.
 *  - Coexistence / contract freeze. Drives the SAME running deployable client
 *    against the frozen `/api/v1/` backend; there is no mock server and no
 *    second origin.
 *  - Credentials come from the environment. The default admin account is
 *    `admin` / `admin123` (the seeded Django superuser); the legacy hard-coded
 *    Protractor test password is NEVER reproduced.
 *
 * Consumed by `../tests/*.spec.ts`:
 *
 * ```ts
 * import { test, expect } from '../fixtures/auth.fixture';
 *
 * test('kanban board renders', async ({ page }) => {
 *   await page.goto(kanbanUrl());           // already authenticated
 *   await expect(page.locator('.kanban-table')).toBeVisible();
 * });
 * ```
 *
 * @module e2e-react/fixtures/auth.fixture
 */

import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeCookies, closeJoyride } from './helpers';

/**
 * Admin username used to authenticate the E2E session.
 *
 * Read from `TAIGA_ADMIN_USERNAME`, defaulting to `admin` — the username of the
 * seeded Django superuser created during environment setup
 * (`createsuperuser --username admin`). Overridable so the suite can target a
 * differently-named account without code changes.
 */
const ADMIN_USERNAME = process.env.TAIGA_ADMIN_USERNAME || 'admin';

/**
 * Admin password used to authenticate the E2E session.
 *
 * Resolved from the environment in priority order:
 *   1. `DJANGO_SUPERUSER_PASSWORD` — the canonical Blitzy Environment secret
 *      name (matches the `createsuperuser` invocation in the AAP build steps).
 *   2. `TAIGA_ADMIN_PASSWORD` — a secondary override for local/dev runs.
 *   3. `'admin123'` — the seeded default, used only when neither var is set.
 *
 * The legacy Protractor test password is deliberately NOT used; the migration
 * seeds the admin account with `admin123`, and secrets are sourced from the
 * environment rather than hard-coded.
 */
const ADMIN_PASSWORD =
  process.env.DJANGO_SUPERUSER_PASSWORD ||
  process.env.TAIGA_ADMIN_PASSWORD ||
  'admin123';

/**
 * Perform the AngularJS UI login on `page`.
 *
 * Mirrors `conf.e2e.js` `onPrepare` and `common.login` / `common.closeJoyride`:
 * it establishes the origin, clears and flags the e2e session, submits the
 * login form, waits for the post-authentication redirect, and dismisses the
 * cookie banner and intro.js joyride so subsequent assertions and screenshots
 * are not obscured.
 *
 * Navigation is RELATIVE so the configured Playwright `baseURL` (the Docker
 * gateway, default `http://localhost:9000`) applies. The form selectors
 * (`input[name="username"]`, `input[name="password"]`, `.submit-button`) are
 * the AngularJS login controls confirmed in `conf.e2e.js:129-135`;
 * `page.fill` / `page.click` auto-wait for those elements to be actionable.
 *
 * @param page     - The Playwright page driving the deployable client.
 * @param username - Login username. Defaults to {@link ADMIN_USERNAME}.
 * @param password - Login password. Defaults to {@link ADMIN_PASSWORD}.
 * @returns A promise that resolves once the page is authenticated and the
 *          transient chrome (cookie banner + joyride) has been dismissed.
 */
export async function login(
  page: Page,
  username: string = ADMIN_USERNAME,
  password: string = ADMIN_PASSWORD,
): Promise<void> {
  // Establish the origin and flag the e2e session (mirrors conf.e2e.js
  // onPrepare lines 119-123: get host, clear session/local storage, set the
  // `e2e` flag). Setting `localStorage.e2e = 'true'` reproduces
  // `conf.e2e.js:123` so the app takes its e2e-aware code paths.
  await page.goto('/');
  await page.evaluate(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.localStorage.setItem('e2e', 'true');
  });

  // Submit the AngularJS login form (conf.e2e.js:127-135).
  await page.goto('/login');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  // The current `login-form.jade` renders the sign-in control as
  // `button.btn-small.full[type="submit"]` inside `form.login-form`; the legacy
  // `.submit-button` class no longer exists in this markup revision. Scope to the
  // login form's submit button (robust across the markup change) and keep the
  // historical `.submit-button` as a comma fallback so either revision resolves.
  await page.click('.login-form button[type="submit"], .submit-button');

  // The legacy harness waited (10000ms) for a redirect to the host root as its
  // success signal (conf.e2e.js:137-145). Waiting for navigation AWAY from
  // `/login` is a robust, equivalent proxy: it succeeds whether Taiga lands on
  // the host root (`/`) or on a default-project route after admin login,
  // avoiding brittleness tied to a single expected landing URL.
  await page.waitForURL((url) => !/\/login\/?$/.test(url.pathname), {
    timeout: 10_000,
  });

  // Dismiss transient chrome so it never overlays the screen under test
  // (conf.e2e.js:138-147 -> common.closeCookies / common.closeJoyride).
  await closeCookies(page);
  await closeJoyride(page);
}

/**
 * Playwright `test` with the built-in `page` fixture overridden to yield an
 * already-authenticated page.
 *
 * Every spec that imports `test` from this module receives a `page` that has
 * already completed {@link login} before the test body runs, so navigations to
 * `sampleData.kanbanUrl()` / `backlogUrl()` are authorized with no token
 * juggling. Because the built-in `page` fixture is simply overridden, no custom
 * fixture generic types are required.
 *
 * ```ts
 * import { test, expect } from '../fixtures/auth.fixture';
 * ```
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});

/**
 * Re-export Playwright's `expect` so specs can import both the authenticated
 * `test` and `expect` from this single module:
 *
 * ```ts
 * import { test, expect } from '../fixtures/auth.fixture';
 * ```
 */
export { expect };
