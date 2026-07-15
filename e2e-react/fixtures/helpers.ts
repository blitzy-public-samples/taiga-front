/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Setup / DOM helper primitives for the React Kanban & Backlog Playwright E2E
 * project (`e2e-react/`).
 *
 * These are Playwright/Firefox re-implementations (ported, NOT copied) of the
 * legacy Protractor primitives that live in `e2e/utils/common.js`. They drive
 * the SAME running deployable client — the Docker gateway served at the
 * Playwright `baseURL` — against the frozen `/api/v1/` backend. No mock server
 * and no second origin are introduced: coexistence and the backend contract are
 * preserved exactly as the AngularJS screens use them.
 *
 * Design constraints (kept deliberately narrow):
 *  - Playwright-only module. The sole import is a type-only import from
 *    `@playwright/test`; there are NO Jest/unit imports and NO React
 *    (`app/react/**`) imports. The root `jest.config.js` excludes `e2e-react/`,
 *    so `npm test` never loads this file — it runs exclusively under
 *    `npm run e2e` (Playwright, Firefox engine).
 *  - Firefox is the mandated engine: `page.mouse` emits real pointer events that
 *    `@dnd-kit`'s `PointerSensor` consumes, and it avoids the Chromium
 *    `os.pidfd_open` teardown crash observed in the harness.
 *
 * Consumed by `../tests/*.spec.ts` and by `./auth.fixture.ts` (which imports
 * {@link closeCookies} and {@link closeJoyride}). The named exports below are a
 * stable contract for those consumers.
 *
 * @module e2e-react/fixtures/helpers
 */

import type { Locator, Page } from '@playwright/test';

/**
 * Maximum time to wait for the AngularJS shell loader to finish, in
 * milliseconds. Mirrors the legacy `common.waitLoader` 5000ms budget.
 */
const LOADER_TIMEOUT = 5_000;

/**
 * Maximum time to wait for the intro.js joyride skip button to appear before
 * treating the joyride as "not shown". Kept short so the no-op path stays fast.
 */
const JOYRIDE_TIMEOUT = 3_000;

/**
 * Settle delay after dismissing the joyride, in milliseconds. Preserves the
 * legacy `common.closeJoyride` `browser.sleep(600)` pause that lets the intro.js
 * exit animation complete before the caller proceeds.
 */
const JOYRIDE_SETTLE_MS = 600;

/**
 * Wait until the AngularJS shell loader has finished (port of
 * `common.waitLoader`).
 *
 * The legacy helper waited for the `.loader` element to lose its `active` class
 * (`browser.wait(() => !hasClass($('.loader'), 'active'), 5000)`). This port
 * reproduces that condition and additionally resolves when `.loader` is absent
 * entirely — the React-hosted routes (`<tg-react-kanban>` / `<tg-react-backlog>`)
 * may never render the AngularJS `.loader` node, so tolerating its absence keeps
 * this helper safe to call on both AngularJS and React routes.
 *
 * @param page - The Playwright page driving the deployable client.
 * @returns A promise that resolves once the loader is inactive or absent.
 */
export async function waitLoader(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.loader');
      return !el || !el.classList.contains('active');
    },
    undefined,
    { timeout: LOADER_TIMEOUT },
  );
}

/**
 * Dismiss the cookie-consent banner (port of `common.closeCookies`).
 *
 * Sets the `cookieConsent=1` cookie in the page context exactly as the legacy
 * `browser.executeScript(() => { document.cookie = 'cookieConsent=1'; })` did,
 * so the banner does not overlay the board/backlog during assertions or
 * screenshots.
 *
 * @param page - The Playwright page driving the deployable client.
 * @returns A promise that resolves once the consent cookie has been set.
 */
export async function closeCookies(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.cookie = 'cookieConsent=1';
  });
}

/**
 * Dismiss the intro.js joyride if it is showing (port of `common.closeJoyride`).
 *
 * The legacy helper called `browser.waitForAngular()` and then clicked
 * `.introjs-skipbutton` when present, followed by `browser.sleep(600)`. There is
 * no `waitForAngular()` in Playwright; instead we briefly wait for the skip
 * button to become visible and click it when it appears, otherwise we no-op. The
 * legacy 600ms settle is preserved so the intro.js exit animation completes
 * before the caller continues.
 *
 * @param page - The Playwright page driving the deployable client.
 * @returns A promise that resolves after the joyride is dismissed, or
 *          immediately when no joyride is present.
 */
export async function closeJoyride(page: Page): Promise<void> {
  const skip = page.locator('.introjs-skipbutton');

  try {
    await skip.first().waitFor({ state: 'visible', timeout: JOYRIDE_TIMEOUT });
  } catch {
    return; // joyride not shown — nothing to close
  }

  await skip.first().click();
  await page.waitForTimeout(JOYRIDE_SETTLE_MS);
}

/**
 * Convenience helper that dismisses the cookie banner and the joyride in one
 * call. Specs and fixtures use this right before assertions or screenshots so
 * that transient chrome never obscures the screen under test.
 *
 * @param page - The Playwright page driving the deployable client.
 * @returns A promise that resolves once both dismissers have completed.
 */
export async function dismissChrome(page: Page): Promise<void> {
  await closeCookies(page);
  await closeJoyride(page);
}

/**
 * Native pointer drag from `origin` to `dest`, reproducing the legacy
 * `common.drag` behavior for `@dnd-kit`'s `PointerSensor` (which listens to real
 * pointer events).
 *
 * The legacy helper injected synthetic `mousedown` / `mousemove` (x2) /
 * `mouseup` events and then waited for the dragula `.gu-mirror` count to reach
 * zero. The React screens use `@dnd-kit`, which has no `.gu-mirror` element, so
 * this port drives `page.mouse` to emit genuine pointer events —
 * press → a small activation move → a stepped move to the target → release —
 * and deliberately does NOT wait for `.gu-mirror`.
 *
 * Divergence from legacy (intentional): the legacy code targeted the
 * destination's top/left offset plus `extrax`/`extray`; here we target the
 * destination's center plus the same extra offsets, which lands more reliably
 * inside `@dnd-kit` droppables while preserving the caller contract (the
 * `extraX`/`extraY` arguments retain their original meaning, e.g. `drag(a, b, 0,
 * 10)` nudges the drop point 10px below the destination center).
 *
 * Accepts either a CSS selector string or a Playwright {@link Locator} for both
 * endpoints.
 *
 * @param page   - The Playwright page driving the deployable client.
 * @param origin - The element to pick up (CSS selector or Locator).
 * @param dest   - The element to drop onto (CSS selector or Locator).
 * @param extraX - Horizontal offset (px) added to the destination center.
 * @param extraY - Vertical offset (px) added to the destination center.
 * @returns A promise that resolves once the pointer has been released.
 * @throws If either endpoint has no bounding box (i.e. is not visible).
 */
export async function drag(
  page: Page,
  origin: string | Locator,
  dest: string | Locator,
  extraX = 0,
  extraY = 0,
): Promise<void> {
  const originLoc = typeof origin === 'string' ? page.locator(origin) : origin;
  const destLoc = typeof dest === 'string' ? page.locator(dest) : dest;

  await originLoc.scrollIntoViewIfNeeded();
  const originBox = await originLoc.boundingBox();
  if (!originBox) {
    throw new Error('drag(): origin element has no bounding box (not visible)');
  }

  const startX = originBox.x + originBox.width / 2;
  const startY = originBox.y + originBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Small initial move so @dnd-kit's PointerSensor activation constraint fires
  // BEFORE the large move to the destination. Without this activation nudge the
  // sensor may never start the drag.
  await page.mouse.move(startX + 6, startY + 6, { steps: 5 });

  await destLoc.scrollIntoViewIfNeeded();
  const destBox = await destLoc.boundingBox();
  if (!destBox) {
    throw new Error('drag(): destination element has no bounding box (not visible)');
  }

  const endX = destBox.x + destBox.width / 2 + extraX;
  const endY = destBox.y + destBox.height / 2 + extraY;

  // Stepped move so @dnd-kit collision detection registers the intermediate
  // points along the path to the droppable.
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.move(endX, endY, { steps: 3 }); // settle over the target
  await page.mouse.up();
}
