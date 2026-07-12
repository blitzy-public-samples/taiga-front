/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Playwright popover helper.
 *
 * Framework-only port of the legacy Protractor helper `e2e/utils/popover.js`
 * (`popover.open` + `popover.wait` + `selectPopoverItem`). It opens a Taiga
 * popover by clicking a trigger, waits for exactly one active popover to be
 * rendered, and optionally selects one or two anchor (`<a>`) items inside it
 * (e.g. status dropdowns, points-per-role selectors, role filters).
 *
 * The React migration reproduces the SAME `.popover.active` DOM — an active
 * popover container with anchor children — so this helper is build-agnostic:
 * it works UNCHANGED against both the `baseline` (AngularJS) and `react`
 * Playwright projects.
 *
 * Runtime contract:
 * - Node 16.19.1, `@playwright/test` 1.44.1.
 * - ONLY `@playwright/test` APIs are used; there are no Protractor/Angular
 *   globals (`browser`, `$`, `$$`) and no second origin.
 * - Timings mirror the source behavior (§5.4.5) and are NOT performance SLAs.
 */

import { expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";

/**
 * Post-selection settle, in milliseconds.
 *
 * Mirrors the legacy `transition = 400` constant: after clicking an anchor the
 * source slept for the popover's CSS transition to finish (`browser.sleep(400)`
 * inside `selectPopoverItem`) before the harness continued. Preserved verbatim
 * as behavioral timing, not as a measured latency budget.
 */
const TRANSITION = 400;

/**
 * Open a Taiga popover and optionally select up to two anchor items.
 *
 * Port of the source `popover.open(el, item, item2)`:
 *   el.click();
 *   var pop = await popover.wait();          // wait for exactly one .popover.active
 *   if (item)  { await selectPopoverItem(pop, item);
 *     if (item2) { pop = await popover.wait(); await selectPopoverItem(pop, item2); } }
 *   return pop;
 *
 * @param page    The Playwright {@link Page} the popover lives on.
 * @param trigger The {@link Locator} whose click opens the popover
 *                (equivalent to the source `el`).
 * @param item    Optional zero-based index of the first anchor to click,
 *                mirroring `popover.$$('a').get(item)`.
 * @param item2   Optional zero-based index of a second anchor to click after
 *                the popover re-renders (e.g. role → points two-step pickers).
 * @returns       A fresh {@link Locator} for the currently active popover
 *                (`.popover.active`). Locators are lazy, so callers that read
 *                from it resolve at use time — matching the source, which
 *                returned the last active-popover reference.
 */
export async function openPopover(
  page: Page,
  trigger: Locator,
  item?: number,
  item2?: number
): Promise<Locator> {
  // Source: `el.click()` — open the popover.
  await trigger.click();

  // Port of `popover.wait()`: the source polled
  // `$$('.popover.active').count() === 1` under `browser.wait(..., 3000)`.
  // Playwright's web-first `toHaveCount` assertion auto-retries until exactly
  // one active popover is present or the 3s timeout elapses.
  const pop = page.locator(".popover.active");
  await expect(pop).toHaveCount(1, { timeout: 3000 });

  // Use an explicit null-ish check (`item != null`) rather than a truthy
  // `if (item)` so that a legitimate index of `0` is honored — the correct,
  // future-proof port even though no current call site passes `0`.
  if (item != null) {
    // Port of `selectPopoverItem`: click the nth anchor
    // (`popover.$$('a').get(item).click()`), then settle the 400ms transition.
    await pop.locator("a").nth(item).click();
    await page.waitForTimeout(TRANSITION);

    if (item2 != null) {
      // The source re-invoked `popover.wait()` before the second selection
      // because the popover re-renders after the first choice; re-assert a
      // single active popover before clicking the second anchor.
      const pop2 = page.locator(".popover.active");
      await expect(pop2).toHaveCount(1, { timeout: 3000 });
      await pop2.locator("a").nth(item2).click();
      await page.waitForTimeout(TRANSITION);
    }
  }

  // Return a fresh, lazily-resolved locator for the active popover, matching
  // the source returning the last `$('.popover.active')` reference.
  return page.locator(".popover.active");
}
