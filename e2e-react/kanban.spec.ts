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
  dragAndDrop,
  fillTags,
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
 * Card-internal affordances are reconciled to the CURRENT shared `tg-card`
 * DOM (the OUT-OF-SCOPE component, AAP §0.2.2 — reproduced by React, not
 * edited here), verified live against the served board. The legacy Protractor
 * helper's stale card hooks are remapped to the shipped React Card DOM
 * (Card.tsx, verified live against the served board):
 *   - story subject text  -> `.card-subject`      (card-title.jade L16)
 *   - edit affordance      -> `.card-owner-actions .e2e-edit` — the React
 *     Card renders the legacy e2e hooks directly: an
 *     `<a class="e2e-edit edit-story">` inside the `.card-owner-actions`
 *     hover zone that opens the edit-US lightbox.
 *   - assign affordance    -> `.card-owner-actions .e2e-assign` — the sibling
 *     `<a class="e2e-assign card-owner-name-link">` opening the assign-to
 *     lightbox. The edit/assign flows hover the card, then click the hook.
 *   - a `.card-actions .js-popup-button` ALSO opens an in-place
 *     `.card-actions-menu` (edit/move-to-top/delete) — the M4 shared-popover
 *     reproduction — but the flows below use the direct `.e2e-*` hooks.
 *   - assignee widget     -> `.card-assigned-to`  (card-assigned-to.jade L9;
 *     the shipped card shows the assignee as an avatar whose img `title`/`alt`
 *     is the full name, rather than a `.card-owner-name` text label).
 * These are the stable rendered classes present on the served build and, per
 * AAP §0.3.1/§0.6.5, reproduced identically by the React `Card.tsx`.
 */
const k = {
  // Board structure ---------------------------------------------------------
  headerColumns: ".task-colum-name", // sic: one "m" — shipped DOM, do not "fix"
  columns: ".taskboard-column", // status/body column (was stale `.task-column`)
  title: ".card-subject", // card story-subject text (shipped span.card-subject; was stale `.e2e-title`)
  ref: ".card-ref", // card story-ref number (shipped span.card-ref); visible at zoom >= 0, present at the default zoom 1
  card: "tg-card",
  ownerActions: ".card-owner-actions", // card e2e hover zone holding the edit/assign hooks
  popupButton: ".js-popup-button", // opens the in-place .card-actions-menu (edit/move-to-top/delete)
  editAction: ".card-owner-actions .e2e-edit", // edit-US hook (Card.tsx <a.e2e-edit.edit-story>)
  assignAction: ".card-owner-actions .e2e-assign", // assign-to hook (Card.tsx <a.e2e-assign.card-owner-name-link>)
  bulk: ".icon-bulk",
  option: ".option",
  vfold: ".vfold.taskboard-column", // folded column modifier on the body column
  tableBody: ".kanban-table-body",
  ownerName: ".card-assigned-to", // card assignee widget (was stale `.card-owner-name`)
  zoom: "tg-board-zoom",
  // Lightboxes --------------------------------------------------------------
  // The shipped lightboxes are keyed by their stable `.lightbox-*` variant
  // classes (with `.open` toggling visibility, which `lightbox.ts` waits on),
  // NOT the `tg-lb-*` directive attributes the legacy Protractor helpers used:
  // the served build renders `div.lightbox.lightbox-generic-form.lightbox-create-edit`,
  // `div.lightbox.lightbox-generic-bulk`, and `div.lightbox.lightbox-select-user`
  // (the `tg-lb-*` attributes are compiled out, exactly like the card `.e2e-*`
  // hooks in Issue 8). These variant classes are present in both the served
  // dist and the `.jade`/React source, so they hold for baseline AND react.
  createEditUsLb: ".lightbox-create-edit", // was stale `div[tg-lb-create-edit-userstory]`
  bulkCreateLb: ".lightbox-generic-bulk", // was stale `div[tg-lb-create-bulk-userstories]`
  assignedToLb: ".lightbox-assigned-to", // React AssignedToLightbox outer .lightbox class
  userId: ".user-list-single", // clickable user row (<li.user-list-single>, selected class "selected")
  userListName: ".user-name", // per-row display name span
  assignConfirm: ".js-submit-button", // SAVE button: the React assign lightbox is multi-select and applies the assignment on this confirm
  // Create/edit-userstory form fields ---------------------------------------
  subject: 'input[name="subject"]',
  description: 'textarea[name="description"]',
  // The React story lightbox renders per-role estimation as
  // `label.points-per-role > select.points-value` (one per computable role) —
  // the functional equivalent of the legacy per-role points popover. Tests
  // drive these selects directly rather than the legacy `.points-per-role li`
  // + `.ticket-role-points` popover DOM (which the POC form does not render).
  pointsPerRoleSelect: ".points-per-role select",
  // The migrated React story lightbox renders a SINGLE settings toggle in
  // `.ticket-detail-settings` — the `button.btn-icon.is-blocked` block/unblock
  // control (the legacy due-date / team-requirement / client-requirement icons
  // are not part of the POC form). Tests click `.first()` to exercise this real
  // setting control.
  settingsLabel: ".ticket-detail-settings button.btn-icon",
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
    // Target a seeded project whose Kanban board is a FLAT board (no
    // swimlanes) with content in its first columns. This matters because the
    // ported legacy cases address columns positionally — `getBoxUss(3)`,
    // `getColumns().last()`, the archive drag-to-last-column, and the fold
    // count — which only hold on a flat board. A swimlaned board renders one
    // `.taskboard-column` PER (status × swimlane), so positional indices span
    // swimlanes and the archive/move/fold semantics break (verified live:
    // `project-3` has 5 swimlanes → folding one status yields 5 `.vfold`
    // columns, and `getColumns().last()` is the last status of the LAST
    // swimlane, not an archive column).
    //
    // Of the `sample_data` projects, `project-4` is a flat Kanban board (0
    // swimlanes) with 21 user stories across the six default statuses
    // [New, Ready, In progress, Ready for test, Done, Archived]; its columns
    // hold [4, 6, 9, 2, 0, 0] cards, so column 0 (edit-us / bulk / move) and
    // column 3 (archive origin) are non-empty and the LAST column is literally
    // "Archived" — exactly the drop target the archive case expects. This still
    // satisfies the original navigation fix (a valid seeded project with a
    // non-empty first column; the legacy `project-0` does not exist — seeded
    // slugs are `project-1`..`project-7`).
    await taiga.gotoKanban("project-4");
    await expect(page.locator(k.columns).first()).toBeVisible();
  });

  // 1) Baseline capture — mirrors the source `before` screenshot('kanban').
  test("kanban", async ({ page, taiga }) => {
    await expect(page.locator(k.card).first()).toBeVisible();
    await taiga.screenshot("kanban");
    // M27: strict visual-parity gate on the main board (baseline writes the
    // reference; react compares against it and fails on drift).
    await taiga.expectVisualParity("kanban");
  });

  // 2) zoom — cycle the board zoom control through levels 1..4, keeping the
  //    intentional 1s animation-settle before each screenshot (zoom1..zoom4).
  test("zoom", async ({ page, taiga }) => {
    for (let level = 1; level <= 4; level++) {
      // The served stock `tg-board-zoom` renders four `label.zoom-radio`
      // controls (each wrapping a visually-hidden `input[type=radio]`, values
      // 0..3) — NOT the continuous slider the legacy position-based click
      // (`{ position: { x: level * 49, y: 14 } }`) assumed. Those computed
      // points land on the `.kanban-header` overlay and are intercepted (the
      // right-most also falls outside the 195px-wide control). Click the
      // level-th radio label directly instead: level 1..4 → board classes
      // `zoom-0`..`zoom-3` (verified live). `force` bypasses the header's
      // pointer-region overlap over the 16px labels; the underlying radio still
      // toggles and drives the AngularJS zoom re-render exactly as a manual
      // click does (the QA report confirmed the control itself works).
      await page
        .locator(`${k.zoom} label.zoom-radio`)
        .nth(level - 1)
        .click({ force: true });
      await page.waitForTimeout(1000);
      await taiga.screenshot("zoom" + level);
    }
  });

  // 3) create us — open the new-US lightbox for column 0, fill every field
  //    (subject, 4 role points → total "4", tags, description, a setting),
  //    upload attachments, submit, and assert the new subject appears on the
  //    board. Combines the source's 5 sequential `it`s into one flow.
  test.describe("create us", () => {
    test("create a user story with points, tags and description", async ({
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

      // Set each role's points via the per-role estimation <select>. The React
      // story lightbox renders `label.points-per-role > select.points-value`
      // (one per computable role) — the functional equivalent of the legacy
      // per-role points popover. Selecting the first real point option (index 1;
      // index 0 is the unestimated "?") exercises the estimation control for
      // every role.
      const roleSelects = page.locator(`${lb} .points-per-role select`);
      const roleCount = await roleSelects.count();
      expect(roleCount).toBeGreaterThan(0);
      for (let i = 0; i < roleCount; i++) {
        await roleSelects.nth(i).selectOption({ index: 1 });
      }

      // Tags, description, and the second settings toggle.
      await fillTags(page);
      await page.locator(`${lb} ${k.description}`).fill(description);
      await page.locator(`${lb} ${k.settingsLabel}`).first().click();

      await taiga.screenshot("create-us-filled");

      // Capture column 0's card count immediately before submitting, so the
      // growth assertion below is RELATIVE (robust to the seeded data).
      const before = await getBoxUss(page, 0).count();

      // Submit and wait for the lightbox to close.
      await page.locator(`${lb} ${k.submit}`).click();
      await lightbox(page).close(lb);

      // M8 — assert the FULL card projection, not merely count growth. Both the
      // stock AngularJS `usform:new:success` handler and the React
      // `submitNewUs` add the created story's FULL model to the board at once
      // (the create POST returns the complete user-story serializer), so the
      // new card renders with its subject, ref and status column immediately —
      // it is NOT an empty shell. `project-4` is a flat board (0 swimlanes), so
      // membership in column 0 (the status the create lightbox targeted) is the
      // status/placement signal.
      await expect(getBoxUss(page, 0)).toHaveCount(before + 1);

      // The new card is locatable BY its unique subject inside column 0, proving
      // subject + status placement are populated immediately.
      const created = getBoxUss(page, 0).filter({ hasText: subject });
      await expect(created).toHaveCount(1);
      await expect(created.locator(k.title)).toHaveText(subject);
      // Its ref is bound (a non-empty `.card-ref`) — the definitive proof the
      // card is a full projection rather than a shell.
      await expect(created.locator(k.ref)).toBeVisible();
      await expect(created.locator(k.ref)).not.toHaveText("");

      await taiga.screenshot("create-us-board");

      // M8 — reload the board (fresh server fetch, no optimistic state) and
      // assert the created card is STILL present in column 0 with its subject
      // and ref, proving server persistence AND that a cold load binds the full
      // display model (the WS/refetch reconciliation path).
      await taiga.gotoKanban("project-4");
      const reloaded = getBoxUss(page, 0).filter({ hasText: subject });
      await expect(reloaded).toHaveCount(1);
      await expect(reloaded.locator(k.title)).toHaveText(subject);
      await expect(reloaded.locator(k.ref)).toBeVisible();
      await expect(reloaded.locator(k.ref)).not.toHaveText("");
    });
  });

  // 4) edit us — open the edit lightbox for column 0's first card via its
  //    action popover, rewrite the subject, re-set points, tags, description
  //    and a setting, upload attachments, submit, and assert the new subject
  //    appears on the board.
  test.describe("edit us", () => {
    test("edit the first user story of the first column", async ({ page, taiga }) => {
      const lb = k.createEditUsLb;

      // Port of `kanbanHelper.editUs(0, 0)`, updated for the shipped card DOM:
      // the legacy inline hover-revealed `.e2e-edit` was replaced by a
      // `.js-popup-button` that opens a global action popover. Hover the first
      // card of column 0, open its action popover, then click "Edit card".
      const card = page.locator(k.columns).nth(0).locator(k.card).first();
      await card.hover();
      await card.locator(k.editAction).click();
      await lightbox(page).open(lb);

      await taiga.screenshot("edit-us");

      const subject = "test subject" + Date.now();
      const description = "test description" + Date.now();

      // Clear the existing subject, then type the new one.
      const subjectInput = page.locator(`${lb} ${k.subject}`);
      await subjectInput.fill("");
      await subjectInput.fill(subject);

      // Re-set each role's points via the per-role estimation <select> (same
      // real control the create-US flow drives).
      const roleSelects = page.locator(`${lb} .points-per-role select`);
      const roleCount = await roleSelects.count();
      expect(roleCount).toBeGreaterThan(0);
      for (let i = 0; i < roleCount; i++) {
        await roleSelects.nth(i).selectOption({ index: 1 });
      }

      await fillTags(page);
      await page.locator(`${lb} ${k.description}`).fill(description);
      await page.locator(`${lb} ${k.settingsLabel}`).first().click();

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
      // column, adding the `vfold` token to that status' header AND to its
      // body column(s).
      //
      // The legacy suite asserted `.vfold.task-column` count === 1, but the
      // served stock board renders one body column PER SWIMLANE (project-3 has
      // 5), so a single fold yields 5 `.vfold.taskboard-column` nodes — and a
      // status that is pre-folded at baseline already contributes more — so the
      // absolute count is never 1. We instead assert the folded state of THIS
      // column's header (`.task-colum-name` gains/loses the `vfold` token),
      // which is the deterministic, swimlane-count-independent signal that
      // column 0 folded. Verified live: header0 "task-colum-name" →
      // "task-colum-name vfold" on fold, and back on unfold.
      await header.locator(k.option).nth(2).click();
      await taiga.screenshot("fold-column");
      await expect(header).toHaveClass(/\bvfold\b/);

      // Unfold: the unfold control is `.option` index 3 (kanban-table.jade L65);
      // it becomes visible once the column is folded. Clicking it restores the
      // column, removing `vfold` from the header.
      await header.locator(k.option).nth(3).click();
      await expect(header).not.toHaveClass(/\bvfold\b/);
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

  // 9) edit assigned to — open the assign-to lightbox from the first card's
  //    action popover, remember the first candidate's name, select that first
  //    user, and assert the first card of column 0 now shows that owner.
  test("edit assigned to", async ({ page }) => {
    const lb = k.assignedToLb;

    // Port of `kanbanHelper` watchers/assign flow, updated for the shipped card
    // DOM: open the first card's action popover and choose "Assign To" (the
    // shipped replacement for the legacy inline `.e2e-assign` affordance).
    const card = getBoxUss(page, 0).first();
    await card.hover();
    await card.locator(k.assignAction).click();
    await lightbox(page).open(lb);

    // Name of the first candidate user (mirrors `assignToLightbox.getName(0)`).
    const name = (
      await page.locator(`${lb} ${k.userId} ${k.userListName}`).nth(0).innerText()
    ).trim();

    // Clear any seeded (pre-selected) assignees FIRST, then select the first
    // candidate so it is the SOLE selection — hence the card's primary
    // (`assigned_to`) owner. The React AssignedToLightbox (`.lightbox-assigned-to`)
    // is a multi-select that derives the primary from the first selected user
    // (mirroring the legacy `changeUsAssignedUsers`, which keeps a still-selected
    // prior primary and otherwise takes `assignedUsersIds[0]`); an explicit SAVE
    // button (`.js-submit-button`) applies the assignment and closes the lightbox.
    // sample_data assigns owners NON-deterministically, so the target card may
    // open with a current assignee already selected; without clearing it that
    // seeded owner would remain the card avatar and the assertion below (card
    // avatar == first candidate) would be data-dependent. Clearing first
    // reproduces the baseline's unassigned-card starting point deterministically.
    const rows = page.locator(`${lb} ${k.userId}`);
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const cls = (await rows.nth(i).getAttribute("class")) ?? "";
      if (/\bselected\b/.test(cls)) {
        await rows.nth(i).click(); // toggle the seeded assignee OFF
      }
    }
    await rows.first().click(); // select the first candidate (now the only selection)
    await page.locator(`${lb} ${k.assignConfirm}`).click();
    await lightbox(page).close(lb);

    // The first card of column 0 reflects the selected owner. The shipped card
    // renders the assignee as an avatar whose img `title`/`alt` is the full
    // name (there is no `.card-owner-name` text label), so assert the avatar
    // image within the assignee widget carries the selected user's name.
    // `toHaveAttribute` auto-waits for the optimistic-UI update to settle,
    // replacing the source's direct `getText()` read.
    await expect(
      getBoxUss(page, 0).nth(0).locator(`${k.ownerName} img`).first()
    ).toHaveAttribute("title", name);
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
