/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

/**
 * Shared Playwright filter cases for the React-parity harness.
 *
 * This module is a TypeScript port of the legacy Protractor shared suite
 * `e2e/shared/filters.js` together with the selectors/actions that previously
 * lived in `e2e/helpers/filters-helper.js`. The React Kanban and Backlog
 * screens intentionally reproduce the SAME `tg-filter` / `.e2e-*` filter DOM
 * that the AngularJS screens rendered, so this single implementation drives the
 * filter assertions UNCHANGED against both the `baseline` (stock AngularJS) and
 * `react` Playwright projects.
 *
 * All `.e2e-*` / `tg-filter` selectors below are reproduced byte-for-byte from
 * `filters-helper.js` and are inlined at each call site to keep this file an
 * easy-to-audit, faithful port of the legacy helper.
 *
 * Structural note: unlike the Protractor original — which registered Mocha
 * `before`/`it`/`after` hooks — this port is a SINGLE procedural async function.
 * The calling specs (`kanban.spec.ts`, `backlog.spec.ts`) invoke
 * `runSharedFilters(...)` as one statement inside a single Playwright test, so
 * no `test()`/hook registration happens in this module.
 */

/**
 * Remove every active filter and reset the filter panel to its pristine state.
 *
 * Port of `filters-helper.clearFilters`: it removed each active filter chip,
 * cleared the free-text query input, and de-selected any highlighted category.
 * Because removing a chip shrinks the live `.e2e-remove-filter` collection, we
 * repeatedly click the FIRST chip (with a hard guard against an unexpected
 * infinite loop) rather than iterating fixed indices — this sidesteps the stale
 * index problem the original index-based Protractor loop was subject to.
 *
 * Kept private (not exported) per the Minimal Change Clause: the only public
 * surface of this module is `runSharedFilters`.
 *
 * @param page - The Playwright page hosting the filter panel.
 */
async function clearFilters(page: Page): Promise<void> {
  // Remove every active filter chip. The list shrinks as chips are removed, so
  // click the first repeatedly (with a guard) rather than iterating fixed indices.
  const removeSel = ".e2e-remove-filter";
  let guard = 0;
  while ((await page.locator(removeSel).count()) > 0 && guard < 50) {
    await page.locator(removeSel).first().click();
    guard++;
  }

  // Clear the free-text query input (port of `clearByTextInput`).
  await page.locator(".e2e-filter-q").fill("");

  // De-select the highlighted category, if one remains selected.
  const selected = page.locator(".e2e-category.selected");
  if (await selected.count()) {
    await selected.first().click();
  }
}

/**
 * Run the shared filter parity cases against the currently loaded screen.
 *
 * Executes, in order, the four behaviours the Protractor `shared/filters.js`
 * suite verified (its `before`, four `it`s, and `after`):
 *   1. "filter by ref"        — a nonsense free-text query yields zero items.
 *   2. "filter by category"   — the first content-bearing category reduces the
 *                               visible count, and clearing restores it exactly.
 *   3. "save custom filters"  — applying + saving a filter adds one custom filter.
 *   4. "remove custom filters"— removing the last custom filter drops the custom
 *                               filter count by one.
 *
 * Every count assertion is RELATIVE to a value captured at runtime (never a
 * hardcoded absolute), preserving the source suite's robustness across differing
 * seeded data sets. Web-first auto-retrying assertions (`expect.poll` /
 * `toHaveCount`) replace the Protractor `browser.waitForAngular()` implicit
 * settling, since React filtering is debounced/asynchronous. (The source called
 * the counter twice as a settle workaround; `expect.poll` supersedes that.)
 *
 * @param page     - The Playwright page with the target screen already loaded.
 * @param testInfo - The active test's info; used to place the evidence
 *                   screenshot in the running project's artifacts directory
 *                   (`e2e-react/artifacts/baseline` or `.../react`).
 * @param counter  - Returns the current visible item count for the calling
 *                   screen (Kanban cards or Backlog user stories).
 */
export async function runSharedFilters(
  page: Page,
  testInfo: TestInfo,
  counter: () => Promise<number>
): Promise<void> {
  // --- Setup (port of the Mocha `before` hook) -------------------------------
  // Open the filter panel if a toggle is present, then allow the tg-filter open
  // transition to settle. The legacy `before` slept 4000ms; this settle time is
  // behavioural timing carried over verbatim, NOT a performance SLA.
  const openBtn = page.locator(".e2e-open-filter");
  if (await openBtn.count()) {
    await openBtn.first().click();
    await page.waitForTimeout(4000);
  }

  // Evidence screenshot, preserving the Protractor `takeScreenshot(name, 'filters')`
  // artifact. `testInfo.outputPath` routes it into the active project's dir.
  await page.screenshot({ path: testInfo.outputPath("filters.png") });

  // --- "filter by ref": a nonsense ref filters everything out (0 matches) ----
  await page.locator(".e2e-filter-q").fill("xxxxyy123123123");
  await expect.poll(() => counter()).toBe(0);
  await clearFilters(page);

  // --- "filter by category": the first content-bearing category reduces the
  //     count, and clearing restores it exactly -------------------------------
  const len = await counter();
  await page.locator(".e2e-category").first().click();
  // Port of `firterByCategoryWithContent`: click the PARENT of the first
  // `.e2e-filter-count` (the legacy `element(by.xpath('..'))`).
  await page.locator(".e2e-filter-count").first().locator("xpath=..").click();
  await expect.poll(() => counter()).toBeLessThan(len);
  await clearFilters(page);
  await expect.poll(() => counter()).toBe(len);

  // --- "save custom filters": applying + saving a filter adds one custom filter
  const customBefore = await page.locator(".e2e-custom-filter").count();
  await page.locator(".e2e-category").first().click();
  await page.locator(".e2e-filter-count").first().locator("xpath=..").click();
  await page.locator(".e2e-open-custom-filter-form").click();
  await page.locator(".e2e-filter-name-input").fill("custom-filter");
  await page.locator(".e2e-filter-name-input").press("Enter");
  await clearFilters(page);
  await expect(page.locator(".e2e-custom-filter")).toHaveCount(customBefore + 1);

  // --- "remove custom filters": removing the last custom filter drops count by 1
  await page.locator(".e2e-custom-filters").click();
  const removeBefore = await page.locator(".e2e-custom-filter").count();
  await page.locator(".e2e-remove-custom-filter").last().click();
  await expect(page.locator(".e2e-custom-filter")).toHaveCount(removeBefore - 1);

  // --- Teardown (port of the Mocha `after` hook) -----------------------------
  await clearFilters(page);
}
