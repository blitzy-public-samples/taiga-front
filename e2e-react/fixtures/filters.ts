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
 * Reconciled filter selectors — the single source of truth for this module.
 *
 * Left column = the legacy `.e2e-*` instrumentation hook the Protractor helper
 * used; right column = the STRUCTURAL class it is co-located with in
 * `app/modules/components/filter/filter.jade`, which the served stock
 * `taiga-front-dist` 6.10.3 bundle actually emits. All mappings were verified
 * live against the served `tg-filter` DOM (see Issue 9).
 */
const F = {
  // `.e2e-open-filter`  -> the "Filters" toggle button in the board/backlog header.
  openFilter: "button.btn-filter",
  // `.e2e-filter-q`     -> the free-text search box (tg-input-search wraps a native input).
  query: "tg-input-search input",
  // `.e2e-category`     -> a filter category header button (Tags / Assigned to / Role / …).
  category: ".filters-cat-single",
  // `.e2e-filter-count` -> the count badge rendered inside a selectable filter option
  //                        (`<span class="number">` inside `button.single-filter`).
  filterCount: ".single-filter .number",
  // `.e2e-remove-filter`-> the ✕ button on an APPLIED filter chip.
  removeApplied: ".filters-applied .remove-filter",
  // `.e2e-open-custom-filter-form` -> the "Add" button that reveals the save-custom-filter
  //   form. In the served dist the form itself is `ng-if`-gated behind this button, so the
  //   opener (not the submit button) is the correct target before filling the name input.
  openCustomForm: ".add-custom-filter",
  // `.e2e-filter-name-input` -> the custom-filter name input inside the reveal form.
  customNameInput: ".add-filter-input",
  // `.e2e-custom-filter`     -> a SAVED custom-filter row in the custom-filter list.
  customFilter: ".custom-filter-list .single-filter-type-custom",
  // `.e2e-remove-custom-filter` -> the trash button on a saved custom-filter row.
  removeCustom: ".custom-filter-list .remove-filter",
} as const;

/**
 * Shared Playwright filter cases for the React-parity harness.
 *
 * This module is a TypeScript port of the legacy Protractor shared suite
 * `e2e/shared/filters.js` together with the selectors/actions that previously
 * lived in `e2e/helpers/filters-helper.js`. The React Kanban and Backlog
 * screens intentionally reproduce the SAME `tg-filter` filter DOM that the
 * AngularJS screens rendered, so this single implementation drives the filter
 * assertions UNCHANGED against both the `baseline` (stock AngularJS) and
 * `react` Playwright projects.
 *
 * SELECTOR RECONCILIATION (QA finding — Issue 9): the legacy helper targeted
 * `.e2e-*` instrumentation classes (e.g. `.e2e-filter-q`, `.e2e-custom-filter`).
 * Those hooks live in `app/modules/components/filter/filter.jade` but are NOT
 * emitted by the served prebuilt `taiga-front-dist` 6.10.3 bundle, so every
 * `.e2e-*` filter selector matched zero elements at runtime. Each `.e2e-*`
 * selector has therefore been reconciled to the STRUCTURAL class it is
 * co-located with in `filter.jade` (verified live against the served stock DOM
 * on `tg-filter`). The single source of truth for these selectors is the
 * `F` map below; the reconciliation of each hook is documented inline there.
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
  // A short settle after each click lets the async filter re-render drop the chip
  // before the loop re-reads the (now shorter) collection.
  let guard = 0;
  while ((await page.locator(F.removeApplied).count()) > 0 && guard < 50) {
    await page.locator(F.removeApplied).first().click();
    await page.waitForTimeout(300);
    guard++;
  }

  // Clear the free-text query input (port of `clearByTextInput`).
  await page.locator(F.query).fill("");

  // De-select the highlighted category, if one remains selected.
  const selected = page.locator(`${F.category}.selected`);
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
  // Open the filter panel and wait for it to actually render.
  //
  // ROBUSTNESS (QA finding — blank `filters.png` / category timeout): the
  // callers' `gotoKanban`/`gotoBacklog` finish with a `waitLoader()` that can
  // return BEFORE the AngularJS header has painted (the top-level `.loader` is
  // briefly absent from the DOM on a fresh bootstrap, so the "not active" wait
  // is a no-op). A one-shot `if (await openBtn.count())` therefore raced the
  // render: on the slower Backlog the toggle was not yet present, the open was
  // silently skipped, and the `.filters-cat-single` categories never appeared —
  // the "filter by category" step then timed out. Waiting for the toggle to be
  // VISIBLE (rather than a one-shot presence check) closes that race on both
  // screens; `.first()` targets the "Filters" toggle (the Backlog also renders
  // a second `.btn-filter` "Move to current sprint" button later in the DOM).
  const openBtn = page.locator(F.openFilter).first();
  await openBtn.waitFor({ state: "visible", timeout: 20000 });
  await openBtn.click();
  // Confirm the panel actually opened by waiting for the category list to
  // appear, instead of a fixed sleep. This both proves the correct toggle was
  // clicked and settles the open transition before any interaction.
  await page.locator(F.category).first().waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(500);

  // Evidence screenshot, preserving the Protractor `takeScreenshot(name, 'filters')`
  // artifact. `testInfo.outputPath` routes it into the active project's dir.
  await page.screenshot({ path: testInfo.outputPath("filters.png") });

  // Capture the pristine, unfiltered item count ONCE from the clean initial
  // state. This `len` is the reference every case compares against; crucially,
  // each `clearFilters(...)` below is followed by an auto-retrying
  // `poll(...).toBe(len)` so the procedural flow WAITS for the board's async
  // (debounced) re-render to fully restore before the next case reads a count —
  // eliminating the race where a count is read mid-re-render (e.g. still 0 right
  // after the query is cleared).
  const len = await counter();

  // --- "filter by ref": a nonsense ref filters everything out (0 matches) ----
  await page.locator(F.query).fill("xxxxyy123123123");
  await expect.poll(() => counter()).toBe(0);
  await clearFilters(page);
  await expect.poll(() => counter()).toBe(len);

  // --- "filter by category": the first content-bearing category reduces the
  //     count, and clearing restores it exactly -------------------------------
  await page.locator(F.category).first().click();
  // Port of `firterByCategoryWithContent`: click the PARENT of the first
  // count badge (the legacy `element(by.xpath('..'))`). The badge is rendered
  // inside the selectable `button.single-filter`, so its parent IS that button.
  await page.locator(F.filterCount).first().locator("xpath=..").click();
  await expect.poll(() => counter()).toBeLessThan(len);
  await clearFilters(page);
  await expect.poll(() => counter()).toBe(len);

  // --- "save custom filters": applying + saving a filter adds one custom filter
  const customBefore = await page.locator(F.customFilter).count();
  await page.locator(F.category).first().click();
  await page.locator(F.filterCount).first().locator("xpath=..").click();
  // Open the reveal form (the served dist `ng-if`-gates the form behind this
  // button), type the name, and submit with Enter (the form `ng-submit`s).
  await page.locator(F.openCustomForm).click();
  await page.locator(F.customNameInput).fill("custom-filter");
  await page.locator(F.customNameInput).press("Enter");
  await clearFilters(page);
  await expect(page.locator(F.customFilter)).toHaveCount(customBefore + 1);

  // --- "remove custom filters": removing the last custom filter drops count by 1
  // The legacy helper first clicked `.e2e-custom-filters` to reveal the custom
  // filter list; the served `.custom-filter-list` is always visible whenever any
  // custom filter exists (`ng-if="vm.customFilters.length"`), so no reveal click
  // is needed — the list is already on screen from the save step above.
  const removeBefore = await page.locator(F.customFilter).count();
  await page.locator(F.removeCustom).last().click();
  await expect(page.locator(F.customFilter)).toHaveCount(removeBefore - 1);

  // --- Teardown (port of the Mocha `after` hook) -----------------------------
  await clearFilters(page);
}
