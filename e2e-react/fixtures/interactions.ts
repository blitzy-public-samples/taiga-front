/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * interactions.ts — shared user-story lightbox interaction helpers for the
 * React-parity Playwright harness.
 *
 * These helpers are a faithful, framework-agnostic port of the Protractor
 * helpers in `e2e/helpers/common-helper.js` — `tags()` (L75-90) and
 * `lightboxAttachment()` (L55-73). They drive the create/edit-userstory
 * lightbox and are consumed by `../kanban.spec.ts` and `../backlog.spec.ts`
 * through the `./fixtures` barrel (`./index.ts`).
 *
 * The migrated React screens reproduce the same shared-component DOM
 * (`tg-tag-line-common` tag widget + `tg-attachments-simple` attachments) that
 * the surviving AngularJS templates emit. `fillTags` therefore targets the
 * widget's stable structural classes (`.add-tag-text`, `.tag-input`,
 * `.tag-color`, `.color-selector-dropdown-list`, `tg-tag .icon-close`) rather
 * than the `.e2e-*` instrumentation hooks, which the prebuilt served dist
 * compiles out (the stable classes coexist with those hooks in the `.jade`
 * source, so they hold for the `react` build too). `uploadAttachment` targets
 * the `tg-attachments-simple` DOM directly. The result is that these helpers
 * exercise BOTH the `baseline` (stock AngularJS) and `react` builds, which is
 * exactly what the two-capture parity evidence requires.
 *
 * Runtime contract: Node 16.19.1 + @playwright/test 1.44.1. Only the
 * `@playwright/test` public API and Node's `path` module are used — there are
 * deliberately no Protractor/Angular globals, no second origin, and no timing
 * assertions.
 */

import * as path from "path";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Populate the tag input inside the user-story lightbox.
 *
 * Port of `common-helper.tags()`, reconciled to the shared `tg-tag-line-common`
 * widget's shipped-DOM classes (the legacy `.e2e-*` tag hooks are compiled out
 * of the served build, exactly as the card hooks are in Issue 8; the stable
 * structural classes below coexist with those hooks in the `.jade` source, so
 * they hold for both the `baseline` and `react` builds). Reproduces the
 * original click/type sequence:
 *   1. Reveal the tag input (`.tags-block .add-tag-text`, was `.e2e-show-tag-input`).
 *   2. Type the literal tag ("xxxyy"), open the color selector
 *      (`.tag-color`, was `.e2e-open-color-selector`) and pick the second swatch
 *      (`.color-selector-dropdown-list li` index 1, was `.e2e-color-dropdown li`
 *      — Protractor `get(1)`), then commit with Enter.
 *   3. Remove the added tag (`tg-tag .icon-close`, was `.e2e-delete-tag`) to
 *      leave the list in the original helper's post-condition.
 *   4. Type "a" one keystroke at a time so the tag autocomplete dropdown fires,
 *      then ArrowDown to highlight the first suggestion and Enter to accept it.
 *
 * The literal tag uses `fill("xxxyy")` (which sets the value and dispatches an
 * `input` event — sufficient for Enter to create the tag), whereas the
 * autocomplete-triggering "a" uses `pressSequentially` (the Playwright 1.44
 * replacement for the deprecated `type`) so the suggestion list reacts to real,
 * per-character key events just as the original `sendKeys('a')` did.
 *
 * @param page - The Playwright {@link Page} driving the lightbox.
 */
export async function fillTags(page: Page): Promise<void> {
  // Reveal the tag input. The shared `tg-tag-line-common` widget renders the
  // reveal control as `button.btn-filter > span.add-tag-text` (the legacy
  // `.e2e-show-tag-input` hook is compiled out of the served dist, exactly like
  // the card `.e2e-*` hooks in Issue 8); clicking the `.add-tag-text` label
  // triggers the button's `displayTagInput()`.
  // Track existing tag chips so the add/remove assertions below are RELATIVE.
  // `fillTags` is shared by the create-US flow (starts with zero tags) and the
  // edit-US flow (may start with tags), so hard-coding an absolute chip count
  // would be wrong; deltas from `initial` are correct in both cases.
  const chips = page.locator(".tags-container tg-tag");
  const initial = await chips.count();

  await page.locator(".tags-block .add-tag-text").click();

  // The revealed input is `input.tag-input` inside `.add-tag-input`
  // (was stale `.e2e-add-tag-input`). It stays open across commits, so the same
  // locator drives both the literal tag and the autocomplete tag below.
  const input = page.locator(".tags-block .tag-input");
  await input.waitFor({ state: "visible" });
  // Use a UNIQUE literal tag name per invocation. Taiga DE-DUPLICATES tags, so a
  // fixed name ("xxxyy") silently fails to add a new chip whenever the edited
  // story already carries that exact tag — e.g. a leftover from an earlier run
  // on the shared, persistent seeded backend — which would make the `initial +
  // 1` assertion below time out (observed: an edited story already tagged
  // `xxxyy` stays at its current chip count). A timestamped name is guaranteed
  // novel, so the add always registers a new chip regardless of the story's
  // pre-existing tags. (The create-US flow starts with zero tags, so this is
  // equally correct there.)
  const literalTag = `xxxyy${Date.now()}`;
  await input.fill(literalTag);

  // Open the color selector (`.tag-color`, was `.e2e-open-color-selector`),
  // wait for its dropdown to fully open, then pick the second swatch
  // (`.color-selector-dropdown-list li`, was `.e2e-color-dropdown li` —
  // Protractor `get(1)`). COMMIT-RACE GUARD: committing with Enter immediately
  // after the swatch click races the dropdown's close/color-apply transition
  // and intermittently fails to register the tag at all (leaving no chip, which
  // then times out the remove step below). Let that transition settle before
  // pressing Enter, then WAIT for the committed chip to actually render.
  await page.locator(".tags-block .tag-color").click();
  const swatches = page.locator(".tags-block .color-selector-dropdown-list li");
  await swatches.first().waitFor({ state: "visible" });
  await swatches.nth(1).click();
  await page.waitForTimeout(400);
  await input.press("Enter");
  await expect(chips).toHaveCount(initial + 1);

  // Remove the SPECIFIC chip just added, matched by its unique text — NOT merely
  // the "last" chip. Tag chips do not always render in insertion order, so a
  // positional (`.last()`) remove could delete a pre-existing tag and leave the
  // newly-added one, corrupting the `initial` count assertion. Each `tg-tag`
  // chip carries the delete control as `tg-svg.icon-close` (was `.e2e-delete-tag`).
  // Confirm the chip is gone before proceeding so the autocomplete add below
  // starts from a known state.
  await page
    .locator(".tags-container tg-tag", { hasText: literalTag })
    .locator("tg-svg.icon-close")
    .click();
  await expect(chips).toHaveCount(initial);

  // Type "a" character-by-character to trigger the autocomplete dropdown,
  // then ArrowDown to highlight the first suggestion and Enter to accept it.
  await input.pressSequentially("a");
  await input.press("ArrowDown");
  await input.press("Enter");
}

/**
 * Exercise the attachment widget inside the user-story lightbox.
 *
 * Port of `common-helper.lightboxAttachment()`. Uploads the two committed
 * fixture files, deletes the first of the pair, and asserts the net attachment
 * count increased by exactly one relative to the pre-existing count.
 *
 * The original helper uploaded the IMAGE first (`uploadImagePath()`) and the
 * TEXT file second (`uploadFilePath()`); that order is preserved here. Each
 * upload is a separate `setInputFiles` call so the widget receives two distinct
 * `change` events and appends two attachments — mirroring the source's two
 * sequential `common.uploadFile` calls. Playwright's `setInputFiles` drives the
 * hidden `<input>` directly, so the AngularJS toggle-visibility hack the
 * original helper needed is intentionally omitted.
 *
 * The assertion is RELATIVE (`toHaveCount(before + 1)`) and uses the web-first
 * `toHaveCount` matcher so it auto-waits for the DOM to settle after the async
 * upload/delete, replacing the original manual `count()` read plus Chai
 * equality. No absolute count is hardcoded.
 *
 * @param page - The Playwright {@link Page} driving the lightbox.
 */
export async function uploadAttachment(page: Page): Promise<void> {
  const el = page.locator("tg-attachments-simple");
  const input = el.locator("#add-attach");

  const before = await el.locator(".single-attachment").count();

  // Both fixture files live in the sibling Protractor e2e/ folder (unchanged,
  // out of scope). From this file at e2e-react/fixtures/, the relative path to
  // e2e/ is ../../e2e/.
  const imagePath = path.resolve(__dirname, "../../e2e/upload-image-test.png");
  const filePath = path.resolve(__dirname, "../../e2e/upload-file-test.txt");

  // Upload the two files as two separate selections (mirrors the source's two
  // sequential common.uploadFile calls). Playwright's setInputFiles works on the
  // hidden <input>, so the AngularJS toggle-visibility hack is unnecessary.
  await input.setInputFiles(imagePath);
  await input.setInputFiles(filePath);

  // Delete the first of the two newly-added attachments.
  await el.locator(".attachment-delete").nth(0).click();

  // Net effect: 2 added - 1 deleted = +1 vs. the original count.
  await expect(el.locator(".single-attachment")).toHaveCount(before + 1);
}
