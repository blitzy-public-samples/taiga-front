/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Foundational fixture module for the Playwright React-parity harness.
 *
 * This is the Playwright port of the legacy Protractor bootstrap:
 *   - `conf.e2e.js` `onPrepare` login flow (clear storage, sign in as admin,
 *     suppress the cookie banner and the intro.js joyride), and
 *   - `e2e/utils/common.js` `login` / `waitLoader` / `closeCookies` /
 *     `closeJoyride` helpers.
 *
 * It exports an EXTENDED `@playwright/test` `test` object that exposes a
 * `taiga` fixture. The fixture auto-logs-in as the seeded admin (password from
 * the `TAIGA_ADMIN_PASSWORD` environment variable, never hard-coded) before
 * every test and hands the test body a small navigation + screenshot harness.
 * `expect` is
 * re-exported so specs import both `test` and `expect` from the single
 * `./fixtures` barrel (`index.ts`) consumed by `../kanban.spec.ts` and
 * `../backlog.spec.ts`.
 *
 * The very same specs run UNCHANGED against BOTH Playwright projects on the one
 * origin `http://localhost:9000`:
 *   - `baseline` — the stock AngularJS build, and
 *   - `react`    — the migrated React build.
 * "baseline" vs "react" is purely temporal (which build is deployed); there is
 * never a second origin. Every navigation below is relative to the configured
 * `baseURL`, so no host is hard-coded in this module.
 *
 * Runtime contract: Node 16.19.1 + `@playwright/test` 1.44.1. Only
 * `@playwright/test` APIs are used — deliberately NO Protractor/Angular globals
 * (`browser`, `protractor`, `$`, `$$`, `element`, `by`, `waitForAngular`).
 * Timeouts here are generous safeguards for a cold Angular bootstrap, never a
 * performance SLA (assumption A-2).
 */

import { test as base, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

/**
 * The per-test harness handed to specs via the `taiga` fixture.
 *
 * Exactly five members — mirroring precisely what `kanban.spec.ts` and
 * `backlog.spec.ts` consume — and nothing speculative beyond them (Minimal
 * Change Clause).
 */
export interface TaigaHarness {
  /** Sign in as the seeded `admin` user, clearing any prior client state. */
  login(): Promise<void>;
  /** Resolve once the global top loader is idle (or absent from the DOM). */
  waitLoader(): Promise<void>;
  /** Navigate to a project's Kanban board and wait for it to settle. */
  gotoKanban(slug: string): Promise<void>;
  /** Navigate to a project's Backlog / sprint-planning workspace and settle. */
  gotoBacklog(slug: string): Promise<void>;
  /** Capture a screenshot into the active project's git-tracked output dir. */
  screenshot(name: string): Promise<void>;
}

/**
 * Build a {@link TaigaHarness} closed over the current `page` and `testInfo`.
 *
 * The returned object is stored in a `const harness` so that its methods can
 * call each other through the stable `harness` reference (e.g. `gotoKanban`
 * delegates to `harness.waitLoader()`). We intentionally do NOT rely on `this`,
 * which is brittle once methods are destructured or passed around.
 *
 * @param page     The Playwright page for the current test.
 * @param testInfo The current test's info; used to resolve the per-project,
 *                 per-test `outputPath` for screenshot evidence.
 * @returns A fully-typed harness implementing every {@link TaigaHarness} member.
 */
function makeHarness(page: Page, testInfo: TestInfo): TaigaHarness {
  const harness: TaigaHarness = {
    async login(): Promise<void> {
      // Start from a pristine client: drop cookies, then clear web storage on
      // the origin and re-arm the app's own e2e flag (parity with
      // conf.e2e.js L121-123).
      await page.context().clearCookies();
      await page.goto("/");
      await page.evaluate(() => {
        sessionStorage.clear();
        localStorage.clear();
        localStorage.setItem("e2e", "true");
      });

      // Credentials come from the ENVIRONMENT, never hard-coded in source: the
      // seeded admin account's password is supplied as `TAIGA_ADMIN_PASSWORD`
      // (the same variable the Docker/setup flow uses to create the superuser).
      // Fail loudly if it is missing so a mis-configured environment surfaces a
      // clear error rather than an opaque 401/login-timeout downstream.
      const username = "admin";
      const password = process.env.TAIGA_ADMIN_PASSWORD;
      if (!password) {
        throw new Error(
          "TAIGA_ADMIN_PASSWORD is not set. The e2e login fixture requires the " +
            "admin password to be supplied via the environment (parity with the " +
            "Docker superuser-creation flow); it is never hard-coded in source."
        );
      }

      // Drive the login form exactly as the Protractor onPrepare did
      // (conf.e2e.js L127-135 / common.login L159-174), signing in as the
      // seeded admin using the environment-provided password.
      //
      // HASHBANG FALLBACK: the primary path is the PLAIN route "/login" (what
      // the Protractor source used: `host + 'login'`). If, against the running
      // app, the plain path does not reach the form because Taiga serves login
      // only under its hashbang route, switch this to the hashbang form
      // "/#!/login" — and apply the SAME form to gotoKanban/gotoBacklog for
      // consistency. Confirm against the live app; the plain path is primary.
      await page.goto("/login");
      await page.fill('input[name="username"]', username);
      await page.fill('input[name="password"]', password);
      // The shipped login control is `button[type="submit"].btn-small.full`
      // (the legacy `.submit-button` class is not present on the served build);
      // target the semantic submit button so the click resolves on both the
      // stock-AngularJS and the React builds.
      await page.locator('button[type="submit"]').click();

      // Wait until the app returns to the root after a successful login.
      // page.waitForURL's predicate receives a URL object in Playwright 1.44.
      // Be lenient about the hashbang (Taiga uses #! routing): the pathname is
      // "/" for both "http://localhost:9000/" and "http://localhost:9000/#!/...".
      // The 30s budget is a generous safeguard for a cold Angular bootstrap,
      // NOT a performance SLA (assumption A-2).
      await page.waitForURL((url: URL) => url.pathname === "/", { timeout: 30000 });

      // Suppress the cookie-consent banner (parity with common.closeCookies).
      await page.evaluate(() => {
        document.cookie = "cookieConsent=1";
      });

      // Dismiss the intro.js joyride if it is showing (parity with
      // common.closeJoyride L494-503). `.count()` returns 0 when absent, so the
      // truthiness guard skips the click cleanly on a fresh, joyride-free load.
      const skip = page.locator(".introjs-skipbutton");
      if (await skip.count()) {
        await skip.first().click();
      }
    },

    async waitLoader(): Promise<void> {
      // Port of common.waitLoader (L118-126): the Protractor helper polled
      // until the top ".loader" element no longer carried the "active" class.
      const loader = page.locator(".loader");
      if ((await loader.count()) === 0) {
        // No loader in the DOM — nothing to wait for.
        return;
      }
      // The regex MUST be word-bounded: `/\bactive\b/`, never `/active/`.
      // A loose `/active/` also matches the substring inside "inactive", so
      // `not.toHaveClass(/active/)` would never pass when the idle class is
      // "inactive". `\bactive\b` matches the standalone `active` token only.
      // `toHaveClass` with a RegExp tests against the element's full class
      // attribute and auto-retries — this replaces the Protractor browser.wait
      // poll with a first-class web assertion.
      await expect(loader).not.toHaveClass(/\bactive\b/, { timeout: 15000 });
    },

    async gotoKanban(slug: string): Promise<void> {
      // Relative path resolves against the configured baseURL
      // (http://localhost:9000). The original Protractor Kanban suite navigated
      // to the plain "project/<slug>/kanban" path.
      //
      // HASHBANG FALLBACK: if plain paths do not route in the live app, use
      // `/#!/project/${slug}/kanban` and apply the SAME form in gotoBacklog and
      // login. Plain path is the primary choice; keep the form consistent.
      await page.goto(`/project/${slug}/kanban`);
      await harness.waitLoader();
    },

    async gotoBacklog(slug: string): Promise<void> {
      // Identical shape to gotoKanban. Keep the path form (plain vs hashbang)
      // consistent across login / gotoKanban / gotoBacklog.
      await page.goto(`/project/${slug}/backlog`);
      await harness.waitLoader();

      // RENDER-RACE GUARD. The backlog paints in two async waves AFTER the
      // loader clears: first the backlog rows, then the sprint sidebar's
      // `.milestone-us-item-row` stories — each fetched by a separately-settling
      // XHR. Tests that read a backlog-row or sprint-story count at their start
      // (a self-population loop, a reorder baseline, a drag delta) must not
      // sample during that gap. Waiting for `networkidle` blocks until BOTH XHR
      // waves have settled (verified: idle is reached ~1.2s post-navigation on
      // this app, at which point the backlog rows AND the sprint stories have
      // painted, and the WebSocket does not keep the network busy). This
      // replaces a hand-rolled count-stability poll that watched ONLY the sprint
      // stories and could FALSE-STABILISE at 0 when two consecutive samples both
      // landed in the pre-render gap (two 0s look "stable"), letting a test
      // proceed against an empty, still-loading backlog (observed: an empty
      // `userStories()` skipped a self-population loop and a 0 sprint baseline
      // failed a delta). Bounded + best-effort so a stray lingering request
      // cannot wedge navigation.
      try {
        await page.waitForLoadState("networkidle", { timeout: 15000 });
      } catch {
        // Fall through: idle not reached within budget. The stability guard
        // below still ensures the sprint sidebar has stopped mutating.
      }

      // Secondary guard: the sprint-story count is stable across two samples.
      // After `networkidle` this reads the TRUE count (0 for a genuinely empty
      // backlog, its real total otherwise), so it no longer false-stabilises.
      // `-1` is a "not yet stable" sentinel that keeps the poll retrying until
      // two consecutive reads agree.
      await expect
        .poll(
          async () => {
            const first = await page.locator(".milestone-us-item-row").count();
            await page.waitForTimeout(250);
            const second = await page.locator(".milestone-us-item-row").count();
            return first === second ? second : -1;
          },
          { timeout: 15000 }
        )
        .not.toBe(-1);
    },

    async screenshot(name: string): Promise<void> {
      // Port of the Protractor takeScreenshot evidence capture. testInfo
      // .outputPath resolves under the running project's outputDir
      // (e2e-react/artifacts/baseline or .../react per playwright.config.ts),
      // preserving the git-tracked baseline-vs-react evidence sets.
      await page.screenshot({
        path: testInfo.outputPath(`${name}.png`),
        fullPage: false,
      });
    },
  };

  return harness;
}

/**
 * The extended Playwright `test`, adding the test-scoped `taiga` fixture.
 *
 * The fixture receives `testInfo` as its THIRD argument — the SAME `TestInfo`
 * the test body gets — so `taiga.screenshot(...)` writes into the correct
 * per-test output directory. Every spec that pulls in `taiga` therefore starts
 * already authenticated:
 *
 *   test("title", async ({ page, taiga }, testInfo) => { ... });
 */
export const test = base.extend<{ taiga: TaigaHarness }>({
  taiga: async ({ page }, use, testInfo) => {
    const harness = makeHarness(page, testInfo);
    await harness.login(); // AUTO-LOGIN before handing control to the test.
    await use(harness);
  },
});

// Re-export `expect` so specs pull both `test` and `expect` from the single
// `./fixtures` barrel rather than reaching into `@playwright/test` directly.
export { expect };
