/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Authentication fixture for the isolated Playwright end-to-end layer that
 * exercises the migrated React Kanban and Backlog screens.
 *
 * This module is the SINGLE source of the login credentials for the React
 * end-to-end layer. It is a Playwright-native behavioral port of two legacy
 * Protractor artifacts:
 *
 *   1. The Protractor bootstrap `onPrepare` from the legacy `conf.e2e.js`
 *      (navigate to `login`, type the admin username, type the password,
 *      submit, wait for the redirect to the application root, then dismiss the
 *      cookie banner and the product tour).
 *   2. The reusable `common.login(username, password)` helper from the legacy
 *      Protractor `common.js` utilities.
 *
 * Those legacy sources are consulted for behavior and DOM selectors ONLY — none
 * of their code is imported here. The two test frameworks are kept strictly
 * isolated: this file imports only Playwright's own test runner and the
 * Playwright-native stabilizer helpers from `./common`. It never reaches into
 * the browserless unit-test layer, the React application sources, or the legacy
 * Protractor CommonJS harness.
 *
 * The login screen itself is an unchanged, out-of-scope AngularJS screen, so
 * this fixture drives the exact same real login DOM in BOTH the baseline
 * (AngularJS) and the post-migration (React) capture passes — same credentials,
 * same selectors, same code path.
 *
 * THE ONE INTENTIONAL CHANGE from the legacy flow is the password source: it is
 * resolved from the environment (see `resolveAdminPassword`) rather than a
 * hardcoded literal, so the value is guaranteed identical to the password used
 * when the admin superuser was created.
 */

import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { primeE2eFlag, closeCookies, closeJoyride, waitLoader } from './common';

/**
 * The username used for every end-to-end login. This matches the admin account
 * created by the stack's `createsuperuser` step (`--username admin`).
 */
export const LOGIN_USERNAME = 'admin';

/**
 * Resolve the admin password.
 *
 * The password MUST be identical to the value supplied at `createsuperuser`
 * time and used at EVERY test login across BOTH capture phases — identical by
 * construction, not by convention. It is therefore read from the single
 * injected admin-password environment variable, falling back to the documented
 * localhost dev default `admin123` when that variable is not present. This is
 * the exact same resolution rule the setup performs at superuser-creation time.
 *
 * There is deliberately no alternate default and no branching logic that could
 * let the login password diverge from the created password. The legacy
 * Protractor hardcoded password is never used here.
 */
export function resolveAdminPassword(): string {
  return process.env.TAIGA_ADMIN_PASSWORD || 'admin123';
}

/**
 * Maximum time (in milliseconds) to wait for the post-submit redirect away from
 * the `login` route. Kept in step with the Playwright config `navigationTimeout`
 * (30000ms) so the login wait budget matches the rest of the suite.
 */
const LOGIN_NAV_TIMEOUT = 30000;

/**
 * Perform an interactive login against the real (unmigrated AngularJS) login
 * screen, leaving the browser on an authenticated session.
 *
 * This is the Playwright-native port of the legacy Protractor `onPrepare` /
 * `common.login` sequence. The functional steps are preserved exactly; only the
 * password source (environment-resolved) and the wait primitives
 * (Playwright-native) differ from the legacy code.
 *
 * @param page    The Playwright page to drive.
 * @param baseURL The configured base URL (nginx gateway on host port 9000),
 *                supplied by the fixture from `use.baseURL`. When provided, an
 *                absolute login URL is built from it; otherwise a relative URL
 *                is used so it inherits Playwright's own configured base URL.
 */
export async function login(page: Page, baseURL?: string): Promise<void> {
  // Prime the AngularJS shell's e2e flag BEFORE the app boots. Under the hood
  // (see `./common`) this uses page.addInitScript and never clears storage, so
  // the JWT the shell persists after login survives subsequent navigations.
  await primeE2eFlag(page);

  // Build an absolute `login` URL when the fixture passes baseURL; otherwise use
  // a relative URL and rely on Playwright's configured base URL. The host is
  // never hardcoded here.
  const loginUrl = baseURL ? new URL('login', baseURL).toString() : 'login';
  await page.goto(loginUrl);

  // Dismiss the cookie-consent banner up front so it cannot intercept the form.
  await closeCookies(page);

  // Fill the verified login form fields, then submit.
  await page.locator('input[name="username"]').waitFor({ state: 'visible' });
  await page.locator('input[name="username"]').fill(LOGIN_USERNAME);
  await page.locator('input[name="password"]').fill(resolveAdminPassword());

  // Submit control: the real login form's button carries the classes
  // `btn-small full` and has no literal `.submit-button` class (that class
  // belongs to other forms). A union selector honors both spellings and the
  // first match is clicked, guaranteeing the click lands on the real screen.
  await page.locator('.submit-button, form.login-form button[type="submit"]').first().click();

  // A successful login redirects AWAY from the `login` route (to the app root /
  // discover / a project). Waiting on the pathname leaving `/login` is more
  // robust than an exact URL match while preserving the legacy
  // "wait for redirect" semantics.
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: LOGIN_NAV_TIMEOUT });

  // Post-redirect stabilizers: re-dismiss cookies (the banner can re-render on
  // the destination view), close the product tour, and let the loader settle.
  await closeCookies(page);
  await closeJoyride(page);
  await waitLoader(page);
}

/**
 * Extended Playwright `test` whose built-in `page` fixture is already
 * authenticated. Every spec that imports this `test` starts on an authenticated
 * session with the e2e flag primed and the cookie banner / product tour
 * dismissed — which every Kanban and Backlog capture requires.
 *
 * The built-in `page` fixture is overridden (rather than adding a second named
 * fixture) so there is no double-login. `page` and `baseURL` are Playwright's
 * own built-in fixtures; `baseURL` comes from the config `use.baseURL`
 * (http://localhost:9000/). Each test receives a fresh context with clean
 * storage, so `login` runs once per test with the SAME resolved password —
 * satisfying "identical by construction".
 */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await login(page, baseURL);
    await use(page);
  },
});

/**
 * Re-export Playwright's `expect` so specs can import both `test` and `expect`
 * from the fixtures barrel and never pull the runner in from two places.
 */
export { expect };
