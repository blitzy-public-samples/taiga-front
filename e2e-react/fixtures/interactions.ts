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
 * Because the migrated React screens reproduce the exact same `.e2e-*`
 * tag-input DOM and the `tg-attachments-simple` attachment DOM that the
 * surviving AngularJS templates emit, every selector below is kept
 * byte-identical to the original Protractor helper. The result is that these
 * helpers exercise BOTH the `baseline` (stock AngularJS) and `react` builds
 * unchanged, which is exactly what the two-capture parity evidence requires.
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
 * Port of `common-helper.tags()`. Reproduces the original click/type sequence
 * exactly:
 *   1. Reveal the tag input (`.e2e-show-tag-input`).
 *   2. Open the color selector (`.e2e-open-color-selector`) and pick the second
 *      swatch (`.e2e-color-dropdown li` index 1 — Protractor `get(1)`).
 *   3. Add a literal tag ("xxxyy") via the add-tag input, committed with Enter.
 *   4. Remove the last tag (`.e2e-delete-tag`) to leave the list in the
 *      original helper's post-condition.
 *   5. Type "a" one keystroke at a time so the tag autocomplete dropdown fires,
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
  await page.locator(".e2e-show-tag-input").click();
  await page.locator(".e2e-open-color-selector").click();
  await page.locator(".e2e-color-dropdown li").nth(1).click();

  const input = page.locator(".e2e-add-tag-input");
  await input.fill("xxxyy");
  await input.press("Enter");

  await page.locator(".e2e-delete-tag").last().click();

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
