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
 * `fillTags` is adapted from the Protractor `tags()` helper
 * (`e2e/helpers/common-helper.js` L75-90). It drives the create/edit-userstory
 * lightbox and is consumed by `../kanban.spec.ts` and `../backlog.spec.ts`
 * through the `./fixtures` barrel (`./index.ts`).
 *
 * The migrated React story lightbox renders a SIMPLIFIED tag control — a plain
 * `.tags-block input.tag-input` that appends a `ul.tags-list > li.tag` chip on
 * Enter (each chip carrying a `.tag-remove` control). It does NOT reproduce the
 * legacy AngularJS `tg-tag-line` color-picker + autocomplete widget, nor does
 * the POC lightbox include the `tg-attachments-simple` attachment widget. This
 * helper therefore drives the REAL shipped React control, so its assertions
 * reflect true production behavior rather than an absent legacy widget.
 *
 * Runtime contract: Node 16.19.1 + @playwright/test 1.44.1. Only the
 * `@playwright/test` public API is used — there are deliberately no
 * Protractor/Angular globals, no second origin, and no timing assertions.
 */

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
  // The migrated React story lightbox renders a SIMPLIFIED tag control
  // (`.tags-block input.tag-input` + `ul.tags-list > li.tag`): type a tag name
  // and press Enter to append a chip; each chip carries a `.tag-remove` control.
  // The legacy AngularJS `tg-tag-line` color-picker + autocomplete widget is not
  // part of the migrated POC lightbox, so this fixture drives the REAL shipped
  // control — the assertions therefore reflect true production behavior.
  //
  // The chip count is read RELATIVE to the pre-existing count so the fixture is
  // correct for BOTH the create-US flow (starts empty) and the edit-US flow
  // (may start with tags).
  const chips = page.locator(".tags-block .tags-list li.tag");
  const initial = await chips.count();

  const input = page.locator(".tags-block .tag-input");
  await input.waitFor({ state: "visible" });

  // Add a UNIQUE tag, then REMOVE it (exercises add + remove), mirroring the
  // original helper's add-then-remove sequence. Taiga de-duplicates tags and the
  // backend is shared/persistent, so a timestamped name is guaranteed novel.
  const literalTag = `xxxyy${Date.now()}`;
  await input.fill(literalTag);
  await input.press("Enter");
  await expect(chips).toHaveCount(initial + 1);

  await page
    .locator(".tags-block .tags-list li.tag", { hasText: literalTag })
    .locator(".tag-remove")
    .click();
  await expect(chips).toHaveCount(initial);

  // Finally add a persistent tag so the saved story carries one tag (matching
  // the original helper's post-condition of leaving one accepted tag).
  const keepTag = `a${Date.now()}`;
  await input.fill(keepTag);
  await input.press("Enter");
  await expect(chips).toHaveCount(initial + 1);
}
