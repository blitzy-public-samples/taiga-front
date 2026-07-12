/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * kanban.spec.ts — Playwright port of the legacy Protractor Kanban e2e suite.
 *
 * This spec is a faithful, framework-agnostic port of
 * `e2e/suites/kanban.e2e.js` (the ~15-case Protractor/Mocha suite) to
 * `@playwright/test` 1.44.1 + TypeScript. It is part of the AngularJS → React
 * 18.2 migration POC (AAP §0.2.1, §0.4.1, §0.6.2) and proves BEHAVIORAL +
 * VISUAL parity between the stock-AngularJS Kanban board and its migrated React
 * replacement, capturing the git-committed before/after evidence
 * (screenshots + per-test video).
 *
 * Contract / DOM-preserving parity
 * --------------------------------
 * The React Kanban board reproduces the EXACT DOM — class names, `data-*`
 * attributes, element tags — that the AngularJS `KanbanController` emits today.
 * Therefore this SAME spec runs UNCHANGED against BOTH Playwright projects
 * defined by `playwright.config.ts`:
 *   - `baseline` — the stock AngularJS build, and
 *   - `react`    — the migrated React build,
 * both against the single origin `http://localhost:9000` (constraint C-3). The
 * baseline-vs-react distinction is purely TEMPORAL (which build is deployed when
 * the project runs); there is no build-conditional logic below and no second
 * origin, because the DOM the assertions target is identical on both.
 *
 * Runtime contract
 * ----------------
 * Node 16.19.1 + `@playwright/test` 1.44.1. Only `@playwright/test` APIs are
 * used (`test`, `expect`, `page`, `Locator`, `TestInfo`) plus the shared parity
 * helpers re-exported from the `./fixtures` barrel. There are deliberately NO
 * Protractor/Angular globals (`browser`, `protractor`, `$`, `$$`, `element`,
 * `by`, `browser.waitForAngular()`); every implicit Angular settle is replaced
 * by a web-first, auto-retrying assertion. Timeouts inside the helpers are
 * generous safeguards, never a performance SLA (assumption A-2).
 *
 * Structure note
 * --------------
 * The extended `test` (from `./fixtures`) hands every test body a fresh,
 * already-authenticated `page` and a `taiga` navigation/screenshot harness.
 * Because Playwright creates a new page per test and `beforeEach` re-navigates
 * to the board, each multi-step Mocha `describe`/`it` group from the source is
 * combined into a SINGLE Playwright `test` (a lightbox opened in one test would
 * not survive into a sibling test). Backend mutations persist, so the suite runs
 * in `serial` mode and every count assertion is RELATIVE (read a "before" count,
 * assert the delta), exactly as the source did — robust to the seeded data.
 */

import {
  test,
  expect,
  lightbox,
  openPopover,
  dragAndDrop,
  fillTags,
  uploadAttachment,
  runSharedFilters,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * DOM selectors targeting the shipped Kanban markup, kept build-agnostic so the
 * SAME assertions hold against both the stock-AngularJS board and its React
 * replacement (which reproduces the identical DOM — AAP §0.3.1, §0.6.5).
 *
 * These are reconciled against the AUTHORITATIVE source of truth — the
 * `KanbanController` template `app/partials/includes/modules/kanban-table.jade`,
 * the theme SCSS (`app/styles/modules/kanban/kanban-table.scss`), and AAP §0.3.1
 * — rather than copied verbatim from the legacy Protractor helper
 * `e2e/helpers/kanban-helper.js`, whose board selectors have rotted against the
 * shipped 6.10.3 DOM. Concretely:
 *   - The status/body column is `div.kanban-uses-box.taskboard-column`
 *     (AAP §0.3.1 names it explicitly; kanban-table.jade L112/L189;
 *     kanban-table.scss L36/L102). The helper's stale `.task-column` matches
 *     nothing on either build, so `.taskboard-column` is used here.
 *   - A folded column carries `.vfold` on that same element
 *     (`ng-class='{vfold:folds[s.id]}'`, kanban-table.jade L113/L190), hence
 *     `.vfold.taskboard-column`.
 *   - The header column `.options` contains `button.btn-board.option` (NOT
 *     `<a>`); for a user with `add_us` the DOM order is
 *     [0]=add-US, [1]=add-bulk, [2]=fold, [3]=unfold (kanban-table.jade L30-L72).
 *
 * The deliberate legacy typo `task-colum-name` (single "m") IS part of the
 * shipped DOM (kanban-table.jade L18) and is preserved verbatim.
 *
 * The card-internal edit/assign affordances (`.card-owner-actions`, `.e2e-edit`,
 * `.e2e-assign`, `.card-owner-name`) follow the file's authoring instructions.
 * The card is the shared, OUT-OF-SCOPE `tg-card` component (AAP §0.2.2) whose
 * action-popup trigger is not statically resolvable and cannot be validated in
 * isolation; the React `Card.tsx` mirrors these e2e hooks per the shared spec
 * contract. The card title hook `.e2e-title` (`span.card-subject.e2e-title`,
 * card-title.jade L16) is confirmed present on the shipped card.
 */
const k = {
  // Board structure ---------------------------------------------------------
  headerColumns: ".task-colum-name", // sic: one "m" — shipped DOM, do not "fix"
  columns: ".taskboard-column", // status/body column (was stale `.task-column`)
  title: ".e2e-title",
  card: "tg-card",
  ownerActions: ".card-owner-actions",
  edit: ".e2e-edit",
  bulk: ".icon-bulk",
  option: ".option",
  vfold: ".vfold.taskboard-column", // folded column modifier on the body column
  tableBody: ".kanban-table-body",
  assign: ".e2e-assign",
  ownerName: ".card-owner-name",
  zoom: "tg-board-zoom",
  // Lightboxes --------------------------------------------------------------
  createEditUsLb: "div[tg-lb-create-edit-userstory]",
  bulkCreateLb: "div[tg-lb-create-bulk-userstories]",
  assignedToLb: "div[tg-lb-assignedto]",
  userId: "div[data-user-id]",
  userListName: ".user-list-name",
  // Create/edit-userstory form fields ---------------------------------------
  subject: 'input[name="subject"]',
  description: 'textarea[name="description"]',
  pointsPerRoleLi: ".points-per-role li",
  ticketRolePoints: ".ticket-role-points",
  points: ".points",
  settingsLabel: ".settings label",
  submit: 'button[type="submit"]',
};

/**
 * Cards inside a given board column.
 *
 * Port of `kanbanHelper.getBoxUss(column)` — the Protractor original resolved
 * `getColumns().get(column).$$('tg-card')`.
 *
 * @param page - The active Playwright page.
 * @param col  - Zero-based column index.
 * @returns A {@link Locator} resolving to every `tg-card` in that column.
 */
const getBoxUss = (page: Page, col: number): Locator =>
  page.locator(k.columns).nth(col).locator(k.card);

/**
 * Every user-story card on the board.
 *
 * Port of `kanbanHelper.getUss()` — the Protractor original resolved `$$('tg-card')`.
 *
 * @param page - The active Playwright page.
 * @returns A {@link Locator} resolving to all `tg-card` elements.
 */
const getUss = (page: Page): Locator => page.locator(k.card);

test.describe("kanban", () => {
  // Serial mode mirrors the Mocha suite's sequential shared-state behaviour:
  // tests run in order and a failure short-circuits the rest of the file.
  test.describe.configure({ mode: "serial" });

  // Port of the source `before` navigation, promoted to a per-test hook. The
  // auto-login already ran via the `taiga` fixture; here we open the board and
  // wait for it to render. Waiting for the first column to be visible is a
  // web-first readiness gate replacing Protractor's implicit Angular settle.
  test.beforeEach(async ({ page, taiga }) => {
    await taiga.gotoKanban("project-0");
    await expect(page.locator(k.columns).first()).toBeVisible();
  });

  // 1) Baseline capture — mirrors the source `before` screenshot('kanban').
  test("kanban", async ({ page, taiga }) => {
    await expect(page.locator(k.card).first()).toBeVisible();
    await taiga.screenshot("kanban");
  });

  // 2) zoom — cycle the board zoom control through levels 1..4, keeping the
  //    intentional 1s animation-settle before each screenshot (zoom1..zoom4).
  test("zoom", async ({ page, taiga }) => {
    for (let level = 1; level <= 4; level++) {
      await page.locator(k.zoom).click({ position: { x: level * 49, y: 14 } });
      await page.waitForTimeout(1000);
      await taiga.screenshot("zoom" + level);
    }
  });

  // 3) create us — open the new-US lightbox for column 0, fill every field
  //    (subject, 4 role points → total "4", tags, description, a setting),
  //    upload attachments, submit, and assert the new subject appears on the
  //    board. Combines the source's 5 sequential `it`s into one flow.
  test.describe("create us", () => {
    test("create a user story with points, tags, description and attachment", async ({
      page,
      taiga,
    }) => {
      const lb = k.createEditUsLb;

      // Open the new-US lightbox from column 0's header. The add-US control is
      // the FIRST `.option` button (kanban-table.jade L30; the legacy helper's
      // index 2 is actually the fold control on the shipped DOM).
      await page.locator(k.headerColumns).nth(0).locator(k.option).nth(0).click();
      await lightbox(page).open(lb);

      await taiga.screenshot("create-us");

      const subject = "test subject" + Date.now();
      const description = "test description" + Date.now();

      // Subject.
      await page.locator(`${lb} ${k.subject}`).fill(subject);

      // Set all four roles to points index 3 via the per-role popover.
      for (let i = 0; i < 4; i++) {
        await openPopover(
          page,
          page.locator(`${lb} ${k.pointsPerRoleLi}`).nth(i),
          3
        );
      }

      // Total role points must read exactly "4" (preserved from the source).
      const total = page
        .locator(`${lb} ${k.ticketRolePoints}`)
        .last()
        .locator(k.points);
      await expect(total).toHaveText("4");

      // Tags, description, and the second settings toggle.
      await fillTags(page);
      await page.locator(`${lb} ${k.description}`).fill(description);
      await page.locator(`${lb} ${k.settingsLabel}`).nth(1).click();

      // Attachments (uploads two files, deletes one → net +1, asserted inside).
      await uploadAttachment(page);

      await taiga.screenshot("create-us-filled");

      // Submit and wait for the lightbox to close.
      await page.locator(`${lb} ${k.submit}`).click();
      await lightbox(page).close(lb);

      // The created story's subject appears among the board card titles. The
      // source read ALL columns' `.e2e-title` (its `column` arg was ignored);
      // trim mirrors Protractor's `getText()` normalization.
      const titles = (
        await page.locator(`${k.columns} ${k.title}`).allTextContents()
      ).map((t) => t.trim());
      expect(titles).toContain(subject);
    });
  });

  // 4) edit us — open the edit lightbox for column 0's first card via its
  //    hover-revealed edit affordance, rewrite the subject, re-set points,
  //    tags, description and a setting, upload attachments, submit, and assert
  //    the new subject appears on the board.
  test.describe("edit us", () => {
    test("edit the first user story of the first column", async ({ page, taiga }) => {
      const lb = k.createEditUsLb;

      // Hover the first card's owner-actions region to reveal the edit icon,
      // then click it (port of `kanbanHelper.editUs(0, 0)`).
      const actions = page.locator(k.columns).nth(0).locator(k.ownerActions).nth(0);
      await actions.hover();
      await actions.locator(k.edit).click();
      await lightbox(page).open(lb);

      await taiga.screenshot("edit-us");

      const subject = "test subject" + Date.now();
      const description = "test description" + Date.now();

      // Clear the existing subject, then type the new one.
      const subjectInput = page.locator(`${lb} ${k.subject}`);
      await subjectInput.fill("");
      await subjectInput.fill(subject);

      // Re-set all four roles to points index 3 → total "4".
      for (let i = 0; i < 4; i++) {
        await openPopover(
          page,
          page.locator(`${lb} ${k.pointsPerRoleLi}`).nth(i),
          3
        );
      }

      const total = page
        .locator(`${lb} ${k.ticketRolePoints}`)
        .last()
        .locator(k.points);
      await expect(total).toHaveText("4");

      await fillTags(page);
      await page.locator(`${lb} ${k.description}`).fill(description);
      await page.locator(`${lb} ${k.settingsLabel}`).nth(1).click();

      await uploadAttachment(page);

      await page.locator(`${lb} ${k.submit}`).click();
      await lightbox(page).close(lb);

      const titles = (
        await page.locator(`${k.columns} ${k.title}`).allTextContents()
      ).map((t) => t.trim());
      expect(titles).toContain(subject);
    });
  });

  // 5) bulk create — open the bulk-create lightbox for column 0, enter two
  //    story lines ("aaa"/"bbb"), submit, and assert column 0 gained exactly
  //    two cards (relative delta).
  test.describe("bulk create", () => {
    test("bulk create two user stories in the first column", async ({ page }) => {
      const lb = k.bulkCreateLb;

      await page.locator(k.bulk).nth(0).click();
      await lightbox(page).open(lb);

      // Type two story lines, each committed with Enter (port of the source's
      // `textarea.sendKeys('aaa')` + global ENTER, twice).
      const textarea = page.locator(`${lb} textarea`);
      await textarea.click();
      await textarea.pressSequentially("aaa");
      await page.keyboard.press("Enter");
      await textarea.pressSequentially("bbb");
      await page.keyboard.press("Enter");

      // Count before submit, then assert the +2 delta after the lightbox closes.
      const before = await getBoxUss(page, 0).count();

      await page.locator(`${lb} ${k.submit}`).click();
      await lightbox(page).close(lb);

      await expect(getBoxUss(page, 0)).toHaveCount(before + 2);
    });
  });

  // 6) folds — fold column 0 (exactly one folded column), then unfold it
  //    (zero folded columns).
  test.describe("folds", () => {
    test("fold and unfold the first column", async ({ page, taiga }) => {
      const header = page.locator(k.headerColumns).nth(0);

      // Fold: the fold control is `.option` index 2 (kanban-table.jade L47).
      // It is visible while the column is unfolded; clicking it collapses the
      // column, which adds `.vfold` to that status' body column.
      await header.locator(k.option).nth(2).click();
      await taiga.screenshot("fold-column");
      await expect(page.locator(k.vfold)).toHaveCount(1);

      // Unfold: the unfold control is `.option` index 3 (kanban-table.jade L65);
      // it becomes visible once the column is folded. Clicking it restores the
      // column, removing `.vfold`.
      await header.locator(k.option).nth(3).click();
      await expect(page.locator(k.vfold)).toHaveCount(0);
    });
  });

  // 7) move us between columns — drag the first card of column 0 onto column 1
  //    and assert column 0 lost one card and column 1 gained one (relative).
  test("move us between columns", async ({ page }) => {
    const init0 = await getBoxUss(page, 0).count();
    const init1 = await getBoxUss(page, 1).count();

    await dragAndDrop(
      page,
      getBoxUss(page, 0).first(),
      page.locator(k.columns).nth(1),
      { targetOffset: { x: 0, y: 10 } }
    );

    // Web-first assertions auto-wait, replacing the source `browser.waitForAngular()`.
    await expect(getBoxUss(page, 0)).toHaveCount(init0 - 1);
    await expect(getBoxUss(page, 1)).toHaveCount(init1 + 1);
  });

  // 8) archive — scroll the board fully right, then drag the first card of
  //    column 3 onto the last (archive) column; assert column 3 lost one card.
  test.describe("archive", () => {
    test("move a card to the archive column", async ({ page, taiga }) => {
      const init3 = await getBoxUss(page, 3).count();

      // Port of `kanbanHelper.scrollRight()`: scroll the last kanban table body
      // fully to the right so the archive column is reachable as a drop target.
      await page.evaluate((sel: string) => {
        const els = document.querySelectorAll(sel);
        if (els.length) {
          els[els.length - 1].scrollLeft = 10000;
        }
      }, k.tableBody);

      await dragAndDrop(
        page,
        getBoxUss(page, 3).first(),
        page.locator(k.columns).last(),
        { targetOffset: { x: 0, y: 10 } }
      );

      await taiga.screenshot("archive");

      await expect(getBoxUss(page, 3)).toHaveCount(init3 - 1);
    });
  });

  // 9) edit assigned to — open the assign-to lightbox from the first assign
  //    control, remember the first candidate's name, select that first user,
  //    and assert the first card of column 0 now shows that owner name.
  test("edit assigned to", async ({ page }) => {
    const lb = k.assignedToLb;

    await page.locator(k.assign).first().click();
    await lightbox(page).open(lb);

    // Name of the first candidate user (mirrors `assignToLightbox.getName(0)`).
    const name = (
      await page.locator(`${lb} ${k.userId} ${k.userListName}`).nth(0).innerText()
    ).trim();

    // Select that first user, then wait for the lightbox to close.
    await page.locator(`${lb} ${k.userId}`).first().click();
    await lightbox(page).close(lb);

    // The first card of column 0 reflects the selected owner. Web-first
    // `toHaveText` auto-waits for the optimistic-UI update to settle,
    // replacing the source's direct `getText()` read.
    await expect(getBoxUss(page, 0).nth(0).locator(k.ownerName)).toHaveText(name);
  });

  // 10) kanban filters — delegate to the shared filter parity cases, counting
  //     visible cards (`tg-card`). Mirrors the source
  //     `sharedFilters.bind(this, 'kanban', () => kanbanHelper.getUss().count())`.
  test.describe("kanban filters", () => {
    test("shared filter parity (ref, category, save + remove custom)", async ({
      page,
    }, testInfo) => {
      await runSharedFilters(page, testInfo, () => getUss(page).count());
    });
  });
});
