/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * Playwright parity suite for the React Backlog / sprint-planning screen.
 * =====================================================================
 *
 * This is a like-for-like behavioral port of the legacy Protractor suite
 * taiga-front/e2e/suites/backlog.e2e.js (585 lines, 32 cases). Every scenario
 * and every assertion INTENT is preserved; the mechanics are retargeted to the
 * React implementation that actually ships in dist/<version>/js/react-app.js.
 *
 * WHY THIS FILE WAS RE-TARGETED (QA finding SEL-DRIFT / Issue 1)
 * -------------------------------------------------------------
 * The previous revision of this spec was written against the AngularJS DOM and
 * a set of assumed hooks that DO NOT EXIST in the built React bundle — e.g.
 * `span[tg-bo-ref]`, `.icon-drag`, `.popover.active`, `.lightbox.open`,
 * `.lightbox-generic-ask` / `.button-green`, `div[tg-us-role-points-selector]`,
 * `.ticket-role-points`, `.e2e-filter-q` / `.e2e-remove-filter` / `.e2e-category`,
 * `.add-sprint`, and the attachment hooks. Every selector below was verified
 * against the compiled bundle with a strict class-token boundary check, so the
 * suite now targets the REAL reproduced React DOM (AAP §0.3.4 keeps the class
 * names identical to the old Jade so the compiled SCSS themes it unchanged).
 *
 * ARCHITECTURE THE RETARGETING RESPECTS (verified from app/react source)
 * ----------------------------------------------------------------------
 * [C-07] The earlier revision of this section was built on an OBSOLETE premise —
 * that single-US create/edit is DELEGATED back to AngularJS via a
 * `$rootScope.$broadcast("genericform:new" / "genericform:edit")` bridge, that
 * deletes use a native `window.confirm`, and that attachments emit no DOM. The
 * M-10 migration replaced all three: the React Backlog now owns a REAL single-US
 * create/edit lightbox and themed confirm/attachment surfaces. The corrected
 * architecture these tests drive is:
 *   - The migrated backlog shell (partials/backlog/backlog.jade) hosts the React
 *     root <tg-react-backlog>, which renders its OWN single-user-story create/edit
 *     lightbox (app/react/backlog/UserStoryEditLightbox.tsx, a mirror of the
 *     kanban lightbox: `.lightbox.lightbox-generic-form.lightbox-create-edit`).
 *     "standard create" (the `.new-us` "+" button → addNewUs("standard")) and
 *     "edit" (each row's options-popup Edit item) open that real form; submitting
 *     persists DIRECTLY (onCreateUserStory → POST /userstories/bulk_create + an
 *     optional follow-up PATCH; onSaveUserStoryEdit → PATCH /userstories/{id}).
 *     The `genericform:*` bridge no longer exists.
 *   - The BULK user-story lightbox (`.lightbox-generic-bulk`,
 *     BulkUserStoriesLightbox.tsx) is a SEPARATE affordance (`.new-us` icon
 *     button → addNewUs("bulk")); "bulk create US" and the XSS-safety assertion
 *     drive it end to end.
 *   - Single-US DELETE and sprint DELETE use the THEMED React ConfirmDialog
 *     (shared/dialog/ConfirmDialog.tsx, [N-03]: role="dialog" + aria-modal +
 *     `.js-confirm`/`.js-cancel`) — NOT a native `window.confirm`. Deletes are
 *     therefore confirmed by clicking the dialog's confirm control, and the
 *     matching persist (`DELETE /userstories/{id}` or `DELETE /milestones/{id}`)
 *     is hard-asserted.
 *   - Attachments ARE in scope: the real lightbox exposes a native
 *     `input[type="file"]` (ports lb-create-edit's `.add-attach`) whose selection
 *     uploads via `POST /userstories/attachments` after the story is created.
 *
 * DETERMINISM (QA Issue 7 fix)
 * ----------------------------
 * There are ZERO fixed `waitForTimeout` sleeps in this suite. Every wait is
 * condition-based (`expect(...).toHaveCount/toBeVisible/toBeHidden`,
 * `expect.poll`, `waitForResponse`, `locator.waitFor`), so the suite is stable
 * on slow CI runners.
 *
 * DRAG-AND-DROP (QA Issue 6 fix)
 * ------------------------------
 * The React Backlog uses @dnd-kit/core with a PointerSensor, so drags are real
 * pointer moves (down → nudge past the activation distance → stepped move → up).
 * The BACKLOG drag handle is `.draggable-us-row`; a SPRINT row is itself the
 * draggable node (`.milestone-us-item-row`, no inner handle). Reorder-within-
 * backlog persistence is HARD-asserted by awaiting the frozen
 * `POST /userstories/bulk_update_backlog_order` and checking `response.ok()`
 * (the old suite swallowed this with `.catch(() => null)`).
 *
 * TEST-LAYER ISOLATION (AAP §0.6.3)
 * ---------------------------------
 * This spec imports ONLY from `@playwright/test` (via `./fixtures/session`). It
 * imports NOTHING from the legacy `../e2e/**` helpers/utils tree.
 *
 * SESSION (AAP §0.6.1)
 * --------------------
 * `./fixtures/session` performs a real-UI login and reuses the SAME shared
 * session (localStorage["token"], window.taiga.sessionId) the AngularJS shell
 * establishes. This spec never mints a token of its own.
 *
 * RUNTIME / TOOLING
 * -----------------
 * Playwright 1.44.1, run through e2e-react/playwright.config.ts (workers: 1,
 * video/screenshot always on, outputDir → artifacts/<phase>). Playwright
 * transpiles this .ts file itself.
 */

import { test, expect } from './fixtures/session';
import type { Page, Locator } from '@playwright/test';
import * as path from 'path';

/* ------------------------------------------------------------------ *
 * Capture phase + named-screenshot helper
 * ------------------------------------------------------------------ *
 * Named captures preserve the legacy filenames so baseline (AngularJS) and
 * react captures can be compared frame-for-frame. They are written under
 * artifacts/<phase>/backlog/ — inside the per-phase outputDir, never
 * Playwright's default results dir.
 */
const PHASE = process.env.E2E_PHASE === 'baseline' ? 'baseline' : 'react';
const CAP_DIR = path.join(__dirname, 'artifacts', PHASE, 'backlog');

/** Take a named parity screenshot (page.screenshot auto-creates parent dirs). */
async function capture(page: Page, name: string): Promise<void> {
    await page.screenshot({ path: path.join(CAP_DIR, `${name}.png`) });
}

/* ================================================================== *
 * React Backlog root + reproduced-selector contract
 * ================================================================== *
 * Every selector below was verified present in the compiled react-app.js.
 * In-board queries are scoped to the React root custom element; overlays that
 * render inside the React tree (lightboxes, popovers) are matched by their
 * distinctive host class.
 */
const BOARD = 'tg-react-backlog';

/* --- backlog table rows ------------------------------------------- */
/** All backlog user-story rows (`.backlog-table-body .us-item-row`). The body
 *  also contains an infinite-scroll sentinel + spinner, so we target the row
 *  class explicitly rather than a positional `> div`. */
const TABLE_ROW = `${BOARD} .backlog-table-body .us-item-row`;
/** Backlog table drag handle inside a row. */
const TABLE_DRAG_HANDLE = '.draggable-us-row';
/** Backlog table row reference span (renders "#<ref>"). */
const TABLE_REF = '.user-story-number';

/* --- sprints ------------------------------------------------------ */
const SPRINT = `${BOARD} .sprint`;
const SPRINT_OPEN = `${BOARD} .sprint.sprint-open`;
const SPRINT_CLOSED = `${BOARD} .sprint.sprint-closed`;
/** A sprint's user-story rows (each row is itself the draggable node). */
const SPRINT_ROW = '.milestone-us-item-row';
/** Sprint drop target / empty markers. */
const SPRINT_TABLE = '.sprint-table';
const SPRINT_EMPTY = '.sprint-empty';
/** Sprint row reference span (renders "#<ref>"). */
const SPRINT_REF = '.us-ref-text';
/** Sprint compact/expand toggle. */
const COMPACT_SPRINT = '.compact-sprint';

/* --- inline status / points / options ----------------------------- */
const US_STATUS = '.us-status';
const POP_STATUS = '.popover.pop-status';
const POP_STATUS_OPT = 'a.popover-status';
const US_POINTS = '.us-points';
// The inline per-row points editor is a TWO-STAGE popover (BacklogTable.tsx
// L1096-1190): stage 1 is the compact role list `.pop-role` (each role is an
// `a.role[data-role-id]`); picking a role advances to stage 2, the point options
// `.pop-points-open` (each option is an `a.point[data-point-id]`, the current one
// carrying `.active`). There is NO bare `.pop-points` class in the product.
const POP_POINTS_ROLE = '.popover.pop-role';
const POP_POINTS_ROLE_ITEM = 'a.role';
const POP_POINTS_OPEN = '.popover.pop-points-open';
const POP_POINTS_OPT = 'a.point';
const US_OPTION_BTN = '.us-option button.js-popup-button';
const US_OPTION_POPUP = '.popover.us-option-popup';
const OPT_EDIT = 'button.e2e-edit.edit-story';
const OPT_DELETE = 'button.e2e-delete';

/* --- role/points column filter (table header) --------------------- */
const ROLE_FILTER_TRIGGER = `${BOARD} .backlog-table-header .points .inner`;
const POP_ROLE = '.popover.pop-role';
const POP_ROLE_ITEM = 'a.role';

/* --- new-us controls ---------------------------------------------- *
 * [C-07] `.new-us button.btn-small` (index 0 → addNewUs("standard")) opens the
 * REAL React single-US create lightbox (backlog/UserStoryEditLightbox.tsx).
 * `.btn-icon` (index 1 → addNewUs("bulk")) opens the React bulk lightbox. Both
 * are gated by the `add_us` permission (`{canAddUs && …}`). */
const NEW_US_STANDARD = `${BOARD} .new-us button.btn-small`;
const NEW_US_BULK = `${BOARD} .new-us button.btn-icon`;

/* --- bulk user-story lightbox (the ONLY React create surface) ----- *
 * `.lightbox-generic-bulk` is ALWAYS mounted and toggled via `display`, so it
 * carries NO `.open` class; visibility is asserted with toBeVisible/toBeHidden. */
const LB_BULK = '.lightbox-generic-bulk';
const LB_BULK_SUBMIT = 'button.js-submit-button';
const LB_BULK_CLOSE = 'button.close';

// [C-07] The REAL single-US create/edit lightbox (backlog/UserStoryEditLightbox.tsx,
// a mirror of the kanban lightbox). Reproduces the Jade
// `div.lightbox.lightbox-generic-form.lightbox-create-edit`; `.open` reveals it.
// Fields carry the same `name=` attributes as the legacy generic form so payload
// parity is directly observable. This REPLACES the removed genericform:* bridge.
const LB_EDIT = '.lightbox-create-edit'; // the create/edit lightbox root
const LB_EDIT_SUBJECT = 'input[name="subject"]'; // subject field
const LB_EDIT_DESCRIPTION = 'textarea[name="description"]'; // description field
const LB_EDIT_DUE_DATE = 'input[name="due_date"]'; // due-date field
const LB_EDIT_SUBMIT = '.js-submit-button'; // Create/Save submit button
const LB_EDIT_REQUIRED = '.checksley-required'; // inline required-field error

// [C-07] Themed React ConfirmDialog (shared/dialog/ConfirmDialog.tsx, [N-03]) —
// used for BOTH single-US delete (BacklogApp) and sprint delete
// (SprintEditLightbox); it REPLACES the native window.confirm the earlier suite
// accepted via page.on('dialog'). role="dialog" + aria-modal.
const CONFIRM_DIALOG = '[role="dialog"]';
const CONFIRM_OK = '.js-confirm';
const CONFIRM_CANCEL = '.js-cancel';

/* --- sprint add / edit / lightbox --------------------------------- *
 * Add-sprint trigger is `.sprint-header a.btn-link` (empty-state fallback is
 * `.empty-small a.btn-link`); edit is `a.edit-sprint`. The sprint lightbox
 * `.lightbox-sprint-add-edit` is conditionally rendered (returns null when
 * closed) so it carries NO `.open` class either. */
const ADD_SPRINT = `${BOARD} .sprint-header a.btn-link`;
const EDIT_SPRINT = `${BOARD} a.edit-sprint`;
const LB_SPRINT = '.lightbox-sprint-add-edit';
const SPRINT_NAME_INPUT = 'input.e2e-sprint-name';
const SPRINT_START_INPUT = 'input.date-start';
const SPRINT_FINISH_INPUT = 'input.date-end';
const SPRINT_SUBMIT = 'button.btn-big';
const SPRINT_DELETE = 'button.delete-sprint';

/* --- filters / tags / velocity / move-to-sprint ------------------- */
const OPEN_FILTER = `${BOARD} #show-filters-button.e2e-open-filter`;
// The in-board filter search is the themed `<tg-input-search>` custom element
// wrapping `<input class="backlog-search e2e-search" type="search">`
// (BacklogApp renders the e2e hook `.e2e-search`). The legacy `input.tg-input-search`
// selector matches NOTHING in the React port (0 hits, verified against live DOM).
const FILTER_SEARCH = `${BOARD} .e2e-search`;
// A collapsible filter category is a `<li data-type="...">` inside `.filters-cats`
// (BacklogApp L1138-1146); its toggle is `.filters-cat-single.e2e-category` and its
// options are `.single-filter`. The legacy `.filter-category[data-type]` /
// `.filter-name` classes do NOT exist in the React port (0 hits on the live DOM).
const FILTER_CATEGORY = `${BOARD} .filters-cats li[data-type]`;
// An applied-filter chip is `.single-applied-filter` with a remove button
// `.remove-filter.e2e-remove-filter` (BacklogApp L972-987); clicking the remove
// button drops one filter. The legacy `.filter-applied` class does not exist.
const FILTER_APPLIED = `${BOARD} .filters-applied .e2e-remove-filter`;
const SHOW_TAGS = `${BOARD} label[for="show-tags-input"]`;
const SHOW_TAGS_INPUT = `${BOARD} #show-tags-input`;
const ROW_TAG = `${BOARD} .backlog-table .tag`;
// The "move selected to sprint" button is a ternary: `.move-to-current-sprint`
// when the project HAS a current sprint, else `.move-to-latest-sprint`
// (BacklogApp.tsx). BOTH carry the stable `.e2e-move-to-sprint` hook, so target
// that to be agnostic to which branch a given project renders. The button is
// `display:none` until at least one story is selected (`moveToSprintVisible`).
const MOVE_TO_LATEST = `${BOARD} .e2e-move-to-sprint`;
const VELOCITY = `${BOARD} .e2e-velocity-forecasting`;
const VELOCITY_ADD = `${BOARD} .e2e-velocity-forecasting-add button`;
const CLOSED_SPRINTS_TOGGLE = `${BOARD} .filter-closed-sprints`;

/* ------------------------------------------------------------------ *
 * Row / ref / sprint accessors
 * ------------------------------------------------------------------ */

/** All backlog user-story rows. */
function userStories(page: Page): Locator {
    return page.locator(TABLE_ROW);
}

/** Currently checkbox-selected backlog rows. */
function selectedUserStories(page: Page): Locator {
    return page.locator(`${TABLE_ROW} input[type="checkbox"]:checked`);
}

/** All rendered sprint containers (open + revealed closed). */
function sprints(page: Page): Locator {
    return page.locator(SPRINT);
}

/** Only the open sprint containers. */
function sprintsOpen(page: Page): Locator {
    return page.locator(SPRINT_OPEN);
}

/** Revealed closed sprint containers. */
function closedSprints(page: Page): Locator {
    return page.locator(SPRINT_CLOSED);
}

/** The user-story rows nested inside a given sprint container. */
function sprintUserStories(sprint: Locator): Locator {
    return sprint.locator(SPRINT_ROW);
}

/** Read the reference text ("#<ref>") of a backlog table row. */
async function tableRowRef(row: Locator): Promise<string> {
    return (await row.locator(TABLE_REF).first().innerText()).trim();
}

/**
 * Collect every user-story reference currently rendered in the backlog table.
 * Read ATOMICALLY in a single DOM pass (`evaluateAll`) rather than a
 * count-then-loop: move-to-sprint / drag mutations re-render the table between a
 * `.count()` and a subsequent `.nth(i).innerText()`, detaching rows mid-read and
 * timing out. One synchronous snapshot is immune to that race.
 */
async function tableRefs(page: Page): Promise<string[]> {
    return userStories(page).evaluateAll(
        (rows, sel) =>
            rows.map((r) => (r.querySelector(sel as string)?.textContent ?? '').trim()),
        TABLE_REF,
    );
}

/** Read the reference text ("#<ref>") of a sprint row. */
async function sprintRowRef(row: Locator): Promise<string> {
    return (await row.locator(SPRINT_REF).first().innerText()).trim();
}

/**
 * Collect every user-story reference rendered inside a sprint. Read ATOMICALLY
 * in one DOM pass (`evaluateAll`) — see {@link tableRefs}; a count-then-loop
 * detaches rows mid-read when a drag/move re-renders the sprint.
 */
async function sprintRefs(sprint: Locator): Promise<string[]> {
    return sprint
        .locator(SPRINT_REF)
        .evaluateAll((spans) => spans.map((s) => (s.textContent ?? '').trim()));
}

/**
 * Collect every sprint title (`.sprint-name span`). Read ATOMICALLY in one DOM
 * pass (`evaluateAll`) rather than a `.count()`-then-`.nth(i).innerText()` loop:
 * a sprint DELETE re-renders the SprintList (the deleted row's `.sprint-name
 * span` detaches), and the old loop's per-element `innerText` waited 15s for the
 * now-gone index — surfacing as a `.poll(sprintTitles)` timeout. A single
 * synchronous snapshot is immune to that mid-read detachment race.
 */
async function sprintTitles(page: Page): Promise<string[]> {
    return page
        .locator(`${BOARD} .sprint-name span`)
        .evaluateAll((spans) => spans.map((s) => (s.textContent ?? '').trim()));
}

/* ------------------------------------------------------------------ *
 * Navigation + loader helpers
 * ------------------------------------------------------------------ */

/**
 * Wait for the backlog to finish loading. The global route `.loader` chrome
 * belongs to the SURVIVING AngularJS shell (not the React bundle); if it is
 * present we wait for it to lose `active`, otherwise we rely entirely on the
 * React board body becoming visible.
 */
async function waitLoader(page: Page): Promise<void> {
    const loader = page.locator('.loader');
    try {
        await expect(loader).not.toHaveClass(/active/, { timeout: 15_000 });
    } catch {
        // Loader not present in the React shell — ignore and rely on the board.
    }
    await page
        .locator(`${BOARD} .backlog-table-body`)
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * Navigate to a project's backlog and wait for it to load. Uses a relative URL
 * that Playwright resolves against the configured `baseURL`.
 */
async function openBacklog(page: Page, projectSlug: string): Promise<void> {
    await page.goto(`project/${projectSlug}/backlog`);
    await waitLoader(page);
}

/* ------------------------------------------------------------------ *
 * [C-07] Real single-US create/edit lightbox helpers
 * ------------------------------------------------------------------ *
 * The React Backlog renders ONE create/edit lightbox at the board root
 * (app/react/backlog/UserStoryEditLightbox.tsx — a mirror of the kanban
 * lightbox), opened by `addNewUs("standard")` (the `.new-us` "+" button) and by
 * each row's options-popup Edit item (`button.e2e-edit.edit-story`). These
 * helpers drive its real fields and REPLACE the removed
 * `$rootScope.$broadcast("genericform:*")` bridge the earlier suite spied on:
 * BacklogApp now persists directly (onCreateUserStory / onSaveUserStoryEdit)
 * against the frozen `/userstories` endpoints.
 */

/** The board-level create/edit lightbox, visible only when it carries `.open`. */
function editLightbox(page: Page): Locator {
    return page.locator(`${LB_EDIT}.open`).first();
}

/** Open a backlog row's options popup and return the visible menu. */
async function openRowOptions(page: Page, row: Locator): Promise<Locator> {
    await row.locator(US_OPTION_BTN).first().click();
    const popup = page.locator(US_OPTION_POPUP).first();
    await popup.waitFor({ state: 'visible', timeout: 10_000 });
    return popup;
}

/**
 * Open the REAL single-US create lightbox from the backlog header "+"
 * (`.new-us button.btn-small`) and wait for it to reveal.
 *
 * @param page The authenticated Playwright page.
 * @returns The visible create lightbox locator.
 */
async function openCreateLightbox(page: Page): Promise<Locator> {
    await page.locator(NEW_US_STANDARD).first().click();
    const lb = editLightbox(page);
    await expect(lb).toBeVisible({ timeout: 10_000 });
    return lb;
}

/**
 * Open the REAL edit lightbox for a backlog row through its options popup
 * (`button.e2e-edit.edit-story`), seeded with that story.
 *
 * @param page The authenticated Playwright page.
 * @param row  A single backlog-row locator.
 * @returns The visible edit lightbox locator.
 */
async function openEditLightbox(page: Page, row: Locator): Promise<Locator> {
    const popup = await openRowOptions(page, row);
    await popup.locator(OPT_EDIT).first().click();
    const lb = editLightbox(page);
    await expect(lb).toBeVisible({ timeout: 10_000 });
    return lb;
}

/**
 * Submit the create/edit lightbox and wait for it to close (lose `.open`), which
 * only happens once the persist request resolves successfully.
 *
 * @param page The authenticated Playwright page.
 * @param lb   The open lightbox locator.
 */
async function submitLightbox(page: Page, lb: Locator): Promise<void> {
    await lb.locator(LB_EDIT_SUBMIT).first().click();
    await expect(lb).toBeHidden({ timeout: 20_000 });
}

/**
 * Await the single-US create persist (`POST /userstories/bulk_create`, which the
 * generic-form CREATE branch uses for subject+status). Start BEFORE the submit,
 * `await` after.
 *
 * @param page The authenticated Playwright page.
 */
function waitCreatePersist(page: Page) {
    return page.waitForResponse(
        (r) => /\/userstories\/bulk_create/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 20_000 },
    );
}

/**
 * Await the single-US edit persist (`PATCH /userstories/{id}`). Start BEFORE the
 * submit, `await` after; returns the matched response so the method can be
 * asserted.
 *
 * @param page The authenticated Playwright page.
 */
function waitEditPersist(page: Page) {
    return page.waitForResponse(
        (r) => /\/userstories\/\d+(\?|$)/.test(r.url()) && r.request().method() === 'PATCH',
        { timeout: 20_000 },
    );
}

/* ------------------------------------------------------------------ *
 * Inline status / points / role popover pickers (NO `.active` class)
 * ------------------------------------------------------------------ *
 * The React popovers are conditionally rendered with distinctive host classes
 * (`.pop-status` / `.pop-points` / `.pop-role`) and carry NO `.active` class,
 * so each picker opens by clicking the trigger, waits for its specific host,
 * acts, then waits for the host to detach.
 */

/** Open a row's status popover and pick the option whose text matches `label`. */
async function pickStatus(row: Locator, label: string): Promise<void> {
    const page = row.page();
    await row.locator(US_STATUS).first().click();
    const pop = page.locator(POP_STATUS).first();
    await pop.waitFor({ state: 'visible', timeout: 10_000 });
    await pop.locator(POP_STATUS_OPT, { hasText: label }).first().click();
    await pop.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {
        /* popover closed / re-rendered */
    });
}

/** Open a row's points popover and pick role `roleIdx` → point `pointIdx`. */
async function pickPoints(row: Locator, roleIdx: number, pointIdx: number): Promise<void> {
    const page = row.page();
    await row.locator(US_POINTS).first().click();

    // The popover opens on STAGE 1 (`.pop-role`) when the project has >1
    // computable role, or jumps straight to STAGE 2 (`.pop-points-open`) when it
    // has exactly one. Wait for whichever stage appears, then advance if needed.
    const roleList = page.locator(POP_POINTS_ROLE).first();
    const pointList = page.locator(POP_POINTS_OPEN).first();
    await Promise.race([
        roleList.waitFor({ state: 'visible', timeout: 10_000 }),
        pointList.waitFor({ state: 'visible', timeout: 10_000 }),
    ]).catch(() => {
        /* neither surfaced within the window; the assertion below will report */
    });

    // STAGE 1 — pick the requested role to reveal its point options.
    if (await roleList.isVisible().catch(() => false)) {
        await roleList.locator(POP_POINTS_ROLE_ITEM).nth(roleIdx).click();
    }

    // STAGE 2 — pick the point; selecting it persists and closes the popover.
    await pointList.waitFor({ state: 'visible', timeout: 10_000 });
    await pointList.locator(POP_POINTS_OPT).nth(pointIdx).click();
    await pointList.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {
        /* popover closed / re-rendered */
    });
}

/* ------------------------------------------------------------------ *
 * Lightbox open/close helpers (NO `.open` class)
 * ------------------------------------------------------------------ */

/** Open the bulk-user-story lightbox (`.new-us` index 1) and wait for it. */
async function openBulkLightbox(page: Page): Promise<Locator> {
    await page.locator(NEW_US_BULK).first().click();
    const lb = page.locator(LB_BULK).first();
    await lb.waitFor({ state: 'visible', timeout: 15_000 });
    return lb;
}

/**
 * Create `subjects.length` user stories through the bulk lightbox and wait
 * until it closes. Returns nothing; callers assert the resulting count delta.
 */
async function bulkCreate(page: Page, subjects: string[]): Promise<void> {
    const lb = await openBulkLightbox(page);
    const textarea = lb.locator('textarea').first();
    await textarea.click();
    for (let i = 0; i < subjects.length; i++) {
        await textarea.pressSequentially(subjects[i]);
        if (i < subjects.length - 1) {
            await textarea.press('Enter');
        }
    }
    await lb.locator(LB_BULK_SUBMIT).first().click();
    await lb.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {
        /* display-toggled host may remain attached but hidden */
    });
}

/** The currently open sprint add/edit lightbox. */
function sprintLightbox(page: Page): Locator {
    return page.locator(LB_SPRINT).first();
}

/** Open the sprint add/edit lightbox (given its already-clicked trigger) and wait. */
async function waitSprintLightbox(page: Page): Promise<Locator> {
    const lb = sprintLightbox(page);
    await lb.waitFor({ state: 'visible', timeout: 15_000 });
    await lb.locator(SPRINT_NAME_INPUT).first().waitFor({ state: 'visible', timeout: 15_000 });
    return lb;
}

/** Wait for the sprint lightbox to close (returns null → detaches). */
async function waitSprintLightboxClose(page: Page): Promise<void> {
    await page
        .locator(LB_SPRINT)
        .first()
        .waitFor({ state: 'detached', timeout: 15_000 })
        .catch(() => {
            /* already closed */
        });
}

/**
 * Locate the inline validation error region inside the sprint lightbox. The
 * React form renders errors from app/react/shared/validation/sprintForm.ts as
 * `.checksley-required` text inside a `.checksley-error` fieldset (server-side
 * errors surface in `.error-message[role="alert"]`).
 */
function validationErrors(lightbox: Locator): Locator {
    return lightbox.locator('.checksley-required, .checksley-error, .error-message[role="alert"]');
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Set a sprint date field to "YYYY-MM-DD" by DRIVING THE PIKADAY CALENDAR.
 *
 * The DatePicker `<input>` is `readOnly` (app/react/shared/ui/DatePicker.tsx
 * L249) and never accepts typed input — a real user clicks the field to open
 * the calendar, steps months with `.pika-prev` / `.pika-next` (the two
 * `.pika-label` spans render the month name and the year, L288-289), then
 * clicks the day button (`.pika-button[data-day="N"]`, L331-332). Only
 * current-month days are rendered as buttons (padding cells are `.is-empty`),
 * so the day selector is unambiguous within the shown month. `.fill()` cannot
 * be used here — that was the original defect this helper fixes.
 */
async function setDate(input: Locator, value: string): Promise<void> {
    const [yStr, mStr, dStr] = value.split('-');
    const targetYear = Number(yStr);
    const targetMonthIdx = Number(mStr) - 1; // 0-based
    const targetDay = Number(dStr);

    // Open THIS field's calendar. The popover is a sibling of the input within
    // the DatePicker container, so scope to the input's parent (only one
    // calendar is open at a time — opening another field closes this one).
    await input.click();
    const calendar = input.locator('xpath=..').locator('.pika-single');
    await calendar.waitFor({ state: 'visible', timeout: 5_000 });

    // Navigate to the target month/year: read the current month+year from the
    // two `.pika-label` spans, compute a signed month delta, and step.
    for (let guard = 0; guard < 240; guard += 1) {
        const labels = calendar.locator('.pika-label');
        const monthName = (await labels.nth(0).innerText()).trim();
        const yearText = (await labels.nth(1).innerText()).trim();
        const delta =
            (targetYear - Number(yearText)) * 12 +
            (targetMonthIdx - MONTH_NAMES.indexOf(monthName));
        if (delta === 0) break;
        await calendar.locator(delta > 0 ? '.pika-next' : '.pika-prev').click();
    }

    // Click the target day; picking commits onChange(WIRE_FORMAT) and closes.
    await calendar.locator(`.pika-button[data-day="${targetDay}"]`).first().click();
    await calendar.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {
        /* already closed */
    });
}

/**
 * Build three "YYYY-MM-DD" dates inside a single, near-future month so the
 * calendar-driven `setDate` needs at most one month step. The validation rule
 * (app/react/shared/validation/sprintForm.ts) only compares start-vs-finish
 * ordering, so absolute values are irrelevant — anchoring to next month keeps
 * navigation minimal AND avoids end-of-month arithmetic edge cases.
 */
function sprintDateFixtures(): { startDate: string; finishBad: string; finishGood: string } {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + 1); // first day of NEXT month
    const y = base.getFullYear();
    const m = base.getMonth() + 1; // 1-based
    const fmt = (d: number) =>
        `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    // start (20) AFTER finishBad (10) ⇒ inverted range ⇒ error; finishGood (25)
    // restores start <= finish ⇒ error clears. All within the same month.
    return { startDate: fmt(20), finishBad: fmt(10), finishGood: fmt(25) };
}

/* ------------------------------------------------------------------ *
 * Deterministic backlog reorder via the KeyboardSensor.
 * ------------------------------------------------------------------ *
 * [F-07] Synthetic POINTER drags across the backlog's row-level droppables are
 * timing-fragile: the product's backlog DnD is verified working (a real browser
 * fires `bulk_update_backlog_order`), but Playwright's synthetic-pointer path
 * against dnd-kit's row sensors is flaky. The board is ALSO wired for accessible
 * keyboard DnD — BacklogApp passes a `KeyboardSensor` with
 * `singleStepKeyboardCoordinates` (one row per arrow press) and
 * `rowPreferringCollisionDetection` (DndProvider.tsx / keyboardCoordinates.ts).
 * The keyboard path is exact and race-free, so the reorder E2E drives it:
 *   focus the row's `.draggable-us-row` handle (it carries @dnd-kit's
 *   `role="button"` + `tabIndex=0`) → Space to pick up (KeyboardSensor start:
 *   Space/Enter) → Arrow{Up|Down} × steps to travel that many rows → Space to
 *   drop (end: Space/Enter/Tab). A drop that changes the order fires the frozen
 *   `POST /userstories/bulk_update_backlog_order` (AAP §0.7.1), which callers
 *   HARD-assert.
 *
 * @param handle The `.draggable-us-row` activator of the row to move.
 * @param key    'ArrowUp' (move toward the top) or 'ArrowDown'.
 * @param steps  Number of single-row hops in that direction.
 */
async function keyboardReorder(
    handle: Locator,
    key: 'ArrowUp' | 'ArrowDown',
    steps: number,
): Promise<void> {
    const page = handle.page();
    await handle.scrollIntoViewIfNeeded();
    await handle.focus();
    // Space activates the KeyboardSensor and picks the focused row up.
    await page.keyboard.press('Space');
    // dnd-kit resolves the `over` droppable asynchronously (a React render +
    // collision re-detection) after each move. `singleStepKeyboardCoordinates`
    // advances one row per press by stepping PAST the row currently `over`
    // (keyboardCoordinates.ts), so each arrow must wait for that `over` update
    // to commit — otherwise back-to-back synthetic presses outrun dnd-kit and
    // see a STALE `over`, collapsing several presses into a single hop. A small
    // settle delay (matching a realistic human key cadence) makes `steps`
    // presses travel exactly `steps` rows. This is a driver-cadence concern,
    // not a product delay: a real user's keypresses are naturally spaced.
    const SETTLE_MS = 150;
    await page.waitForTimeout(SETTLE_MS);
    for (let i = 0; i < steps; i += 1) {
        // Each arrow moves the drag reference to the adjacent row (top-left
        // convention, single-axis) and steps past the current `over`, so
        // `steps` arrows travel `steps` rows.
        await page.keyboard.press(key);
        await page.waitForTimeout(SETTLE_MS);
    }
    // Space again drops the row at its current (moved) position.
    await page.keyboard.press('Space');
}

/*
 * Drag-and-drop helper tuned to @dnd-kit/core PointerSensor
 * ------------------------------------------------------------------ *
 * mouse.move(source center) → down → nudge past the activation distance →
 * stepped move to the target center → settle → up. NO trailing sleep: callers
 * assert the resulting DOM/response condition. Retained for pointer-path cases
 * (e.g. dragging a story onto a SPRINT container); row-to-row REORDER uses the
 * deterministic {@link keyboardReorder} above.
 */
async function dndDrag(page: Page, source: Locator, target: Locator): Promise<void> {
    await source.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    if (!from) {
        throw new Error('dndDrag: source element is not visible (no bounding box)');
    }
    const sx = from.x + from.width / 2;
    const sy = from.y + from.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // Nudge past @dnd-kit PointerSensor activation distance.
    await page.mouse.move(sx + 8, sy + 8, { steps: 6 });

    await target.scrollIntoViewIfNeeded();
    const to = await target.boundingBox();
    if (!to) {
        await page.mouse.up();
        throw new Error('dndDrag: target element is not visible (no bounding box)');
    }

    // Stepped move so dnd-kit registers drag-over transitions.
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 25 });

    // dnd-kit `autoScroll` (enabled for legacy `dom-autoscroller` parity) can move
    // list content AFTER the target box was captured: a long bottom→top reorder
    // scrolls the backlog up, so the once-captured centre now points ABOVE the
    // intended row. `rowPreferringCollisionDetection` then finds no row under the
    // pointer (`pointerWithin` empty) and falls back to the CONTAINER, so the drop
    // resolves to "append at end" instead of the target row (observed on [14]
    // "reorder multiple us": the block stayed at the end and row 0 was unchanged).
    // Re-acquire the (possibly drifted) target box and settle onto its FRESH centre,
    // pausing a frame between corrections so dnd-kit processes each `over` update.
    // Harmless for large/stable targets (sprint tables, milestone rows) where the
    // re-read centre is identical. This is the pointer analog of the keyboard
    // reorder settle and touches no product code.
    for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(60);
        const fresh = await target.boundingBox();
        if (!fresh) {
            break;
        }
        await page.mouse.move(fresh.x + fresh.width / 2, fresh.y + fresh.height / 2, {
            steps: 4,
        });
    }
    // Final settle so dnd-kit's `over` is committed before the drop is released.
    await page.waitForTimeout(80);
    await page.mouse.up();
}

/**
 * Await the reorder-within-backlog persistence POST (QA Issue 6: HARD, not a
 * swallowed `.catch(() => null)`). The React screen persists a backlog reorder
 * through the frozen `POST /userstories/bulk_update_backlog_order` (AAP §0.7.1).
 */
function waitBacklogOrderPersist(page: Page) {
    return page.waitForResponse(
        (r) => /bulk_update_backlog_order/.test(r.url()) && r.request().method() !== 'GET',
        { timeout: 20_000 },
    );
}

/* ------------------------------------------------------------------ *
 * Filters helpers (condition-based; NO sleeps)
 * ------------------------------------------------------------------ */

/** Open the in-board filters panel. */
async function openFilters(page: Page): Promise<void> {
    const trigger = page.locator(OPEN_FILTER).first();
    if (await trigger.count()) {
        await trigger.click();
        await page.locator(FILTER_SEARCH).first().waitFor({ state: 'visible', timeout: 10_000 });
    }
}

/** Type into the filter ref/text search input. */
async function filterByText(page: Page, text: string): Promise<void> {
    await page.locator(FILTER_SEARCH).first().fill(text);
}

/** Clear the filter search input + any applied filter chips. */
async function clearFilters(page: Page): Promise<void> {
    const q = page.locator(FILTER_SEARCH).first();
    if (await q.count()) {
        await q.fill('');
    }
    // Applied-filter chips shrink as we click, so always click the first remaining.
    let guard = 0;
    while ((await page.locator(FILTER_APPLIED).count()) > 0 && guard < 20) {
        await page.locator(FILTER_APPLIED).first().click();
        guard += 1;
    }
}

/**
 * Drive the "show tags" toggle to a known state. The toggle
 * (`#show-tags-input`) PERSISTS in localStorage, so a fresh page may start with
 * it either ON or OFF — the tests must not assume a direction. This reads the
 * checkbox's checked state and clicks the label only when a change is needed.
 * Tags are CONDITIONALLY RENDERED (`{showTags && us.tags.map(...)}`,
 * BacklogTable.tsx L964), so OFF ⇒ zero `.tag` nodes, ON ⇒ the tagged rows show.
 */
async function setShowTags(page: Page, want: boolean): Promise<void> {
    const input = page.locator(SHOW_TAGS_INPUT).first();
    const isOn = await input.isChecked().catch(() => false);
    if (isOn !== want) {
        await page.locator(SHOW_TAGS).first().click();
    }
}

/**
 * Ensure a project has a computable velocity (`stats.speed > 0`) so the
 * velocity-forecasting control renders. `sample_data` never CLOSES a sprint, so
 * `speed` is 0 for every seeded project; velocity is computed from CLOSED
 * sprints. This idempotently closes the first open sprint that has points via
 * the FROZEN milestones API (AAP §0.7.1) — the exact contract the app uses — so
 * the forecast becomes computable. Safe to call repeatedly: it no-ops once
 * `speed > 0`. Uses the shared session token the UI login established
 * (localStorage["token"]) — never a parallel session (AAP §0.6.1).
 *
 * @returns true if the project ends up with `speed > 0`.
 */
async function ensureVelocity(page: Page, projectSlug: string): Promise<boolean> {
    // `$tgStorage` JSON-ENCODES every value it writes, so `localStorage["token"]`
    // is a quote-wrapped JSON string (`"eyJ…"`). Parse it back to the raw JWT —
    // using the wrapped value verbatim produces `Authorization: Bearer "eyJ…"`,
    // which the backend rejects (401), so every stats/milestone call below would
    // silently fail and velocity would never be established.
    const token = await page.evaluate(() => {
        const raw = window.localStorage.getItem('token');
        if (raw == null) {
            return '';
        }
        try {
            return JSON.parse(raw) as string;
        } catch {
            return raw;
        }
    });
    const headers = { Authorization: `Bearer ${token}` };

    // Resolve the numeric id from the slug (ids can renumber across reseeds).
    const prRes = await page.request.get(
        `/api/v1/projects/by_slug?slug=${projectSlug}`,
        { headers },
    );
    if (!prRes.ok()) {
        return false;
    }
    const projectId = ((await prRes.json()) as { id: number }).id;

    const readSpeed = async (): Promise<number> => {
        const res = await page.request.get(`/api/v1/projects/${projectId}/stats`, {
            headers,
        });
        if (!res.ok()) {
            return 0;
        }
        const body = (await res.json()) as { speed?: number };
        return body.speed ?? 0;
    };

    if ((await readSpeed()) > 0) {
        return true;
    }

    // Velocity = average COMPLETED points of the recent CLOSED sprints, so close
    // OPEN sprints that carry points (highest first — most likely to have
    // completed stories) until `speed` turns positive. Milestones have no OCC
    // `version`, so the PATCH is a plain `{ closed: true }`. Stats recompute
    // server-side, so re-poll briefly after each close before trying the next.
    const msRes = await page.request.get(`/api/v1/milestones?project=${projectId}`, {
        headers,
    });
    if (msRes.ok()) {
        const milestones = (await msRes.json()) as Array<{
            id: number;
            closed: boolean;
            total_points: number | null;
        }>;
        const candidates = milestones
            .filter((m) => !m.closed && (m.total_points ?? 0) > 0)
            .sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0));
        for (const target of candidates) {
            await page.request.patch(`/api/v1/milestones/${target.id}`, {
                headers,
                data: { closed: true },
            });
            for (let i = 0; i < 10; i++) {
                if ((await readSpeed()) > 0) {
                    return true;
                }
                await page.waitForTimeout(300);
            }
        }
    }

    return (await readSpeed()) > 0;
}

/* ================================================================== *
 * SUITE
 * ================================================================== */

test.describe('backlog', () => {
    // [F-05] Serial mode is intentionally NOT used. The former `mode: 'serial'`
    // let one flaky test SKIP every test after it (a single failure cascaded into
    // a wall of false negatives). Each test re-navigates in `beforeEach` (a fresh
    // `page.goto(project/.../backlog)`), so the tests are independent; where a
    // test mutates shared board state, it asserts on stable per-story identities
    // (a captured ref) rather than fragile global row counts, which keeps them
    // order-independent against the live, WebSocket-driven board.

    // Capture the parity `backlog` screenshot exactly once (first project-3 load).
    let capturedBacklog = false;

    test.beforeEach(async ({ page }) => {
        await openBacklog(page, 'project-3');
        if (!capturedBacklog) {
            await capture(page, 'backlog');
            capturedBacklog = true;
        }
    });

    /* -------------------------------------------------------------- *
     * create US (the REAL single-US lightbox)
     * -------------------------------------------------------------- *
     * [C-07] "standard create" opens the REAL React create/edit lightbox
     * (backlog/UserStoryEditLightbox.tsx) from the `.new-us` "+" button — NOT the
     * removed genericform:new bridge, and NOT the bulk lightbox (a separate
     * affordance covered by "bulk create US"). Cases:
     *   1. happy path       — subject only → one bulk_create POST → US appears;
     *   2. full-form parity — subject + description + due date → bulk_create then
     *                         a follow-up PATCH persists the rich fields;
     *   3. negative path    — empty subject → inline required error, NO persist,
     *                         lightbox stays open;
     *   4. attachment       — a file selected in the real `input[type="file"]`
     *                         uploads via POST /userstories/attachments on submit.
     */
    test.describe('create US', () => {
        test('standard create through the real lightbox', async ({ page }) => {
            const before = await userStories(page).count();

            const lb = await openCreateLightbox(page);
            await capture(page, 'create-us');

            const subject = `standard create${Date.now()}`;
            await lb.locator(LB_EDIT_SUBJECT).fill(subject);

            const persisted = waitCreatePersist(page);
            await submitLightbox(page, lb);
            await persisted;

            await expect(userStories(page)).toHaveCount(before + 1, { timeout: 20_000 });
        });

        test('create with description and due date persists the full form', async ({ page }) => {
            const before = await userStories(page).count();

            const lb = await openCreateLightbox(page);
            await lb.locator(LB_EDIT_SUBJECT).fill(`full form${Date.now()}`);
            await lb.locator(LB_EDIT_DESCRIPTION).fill('created via the real react lightbox');

            const dueDate = lb.locator(LB_EDIT_DUE_DATE);
            if (await dueDate.count()) {
                await dueDate.fill('2025-12-31');
            }

            // subject+status ship in bulk_create; the rich fields follow in a PATCH.
            const created = waitCreatePersist(page);
            const patched = waitEditPersist(page);
            await submitLightbox(page, lb);
            await created;
            await patched;

            await expect(userStories(page)).toHaveCount(before + 1, { timeout: 20_000 });
        });

        test('empty subject shows the required error and does not persist', async ({ page }) => {
            const before = await userStories(page).count();

            const lb = await openCreateLightbox(page);
            await lb.locator(LB_EDIT_SUBJECT).fill('');

            // Guard: NO create request may leave the browser for an invalid form.
            let persistFired = false;
            page.on('request', (r) => {
                if (/\/userstories\/bulk_create/.test(r.url()) && r.method() === 'POST') {
                    persistFired = true;
                }
            });

            await lb.locator(LB_EDIT_SUBMIT).first().click();

            await expect(lb.locator(LB_EDIT_REQUIRED)).toBeVisible({ timeout: 5_000 });
            await expect(lb).toBeVisible();
            expect(persistFired).toBe(false);
            await expect(userStories(page)).toHaveCount(before);
        });

        test('create a user story with an attachment', async ({ page }) => {
            const before = await userStories(page).count();

            const lb = await openCreateLightbox(page);
            await lb.locator(LB_EDIT_SUBJECT).fill(`attach${Date.now()}`);

            // Attach a small in-memory file via the real <input type="file">.
            await lb.locator('input[type="file"]').setInputFiles({
                name: 'note.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('parity attachment'),
            });
            await expect(lb.locator('.attachments-num')).toHaveText('1');

            const created = waitCreatePersist(page);
            const uploaded = page.waitForResponse(
                (r) =>
                    /\/userstories\/attachments/.test(r.url()) &&
                    r.request().method() === 'POST',
                { timeout: 20_000 },
            );
            await submitLightbox(page, lb);
            await created;
            await uploaded;

            await expect(userStories(page)).toHaveCount(before + 1, { timeout: 20_000 });
        });
    });

    /* -------------------------------------------------------------- *
     * bulk create US (the real in-React create surface)
     * -------------------------------------------------------------- */
    test.describe('bulk create US', () => {
        test('creates two user stories from the bulk lightbox', async ({ page }) => {
            const before = await userStories(page).count();

            await bulkCreate(page, ['aaa', 'bbb']);

            await expect(userStories(page)).toHaveCount(before + 2, { timeout: 20_000 });
        });
    });

    /* -------------------------------------------------------------- *
     * edit US (the REAL single-US lightbox)
     * -------------------------------------------------------------- *
     * [C-07] The row options-popup Edit item (`button.e2e-edit.edit-story`)
     * opens the REAL edit lightbox seeded with the story — NOT the removed
     * genericform:edit bridge. Editing the subject and submitting must issue a
     * single `PATCH /userstories/{id}` and reflect the new subject in the table.
     */
    test.describe('edit US', () => {
        test('edit a user story subject through the real lightbox', async ({ page }) => {
            const row = userStories(page).first();

            const lb = await openEditLightbox(page, row);
            await expect(lb.locator(LB_EDIT_SUBJECT)).toBeVisible();
            await capture(page, 'edit-us');

            const edited = `edited${Date.now()}`;
            await lb.locator(LB_EDIT_SUBJECT).fill(edited);

            const persisted = waitEditPersist(page);
            await submitLightbox(page, lb);
            const response = await persisted;
            expect(response.request().method()).toBe('PATCH');

            // The edited (unique) subject is now rendered on exactly one row.
            await expect(
                userStories(page).locator('.user-story-name', { hasText: edited }),
            ).toHaveCount(1, { timeout: 20_000 });
        });

        /*
         * [C-04] A subject-only edit must PRESERVE the existing description.
         * -----------------------------------------------------------------
         * REGRESSION GUARD for QA finding C-04, Backlog board. The backlog LIST
         * payload omits each story's `description`, so the edit lightbox hydrates
         * the full detail (`GET /userstories/{id}`) on open. When the user
         * changes ONLY the subject and saves, the outgoing `PATCH` body must
         * still carry the *unchanged* description verbatim — never `null`, never
         * blanked — otherwise a subject tweak would silently wipe the story body.
         *
         * The test is self-seeding: it first SETS a known description (setup
         * PATCH), reopens to confirm the textarea hydrated with it (proves detail
         * hydration), then edits the subject alone and asserts (a) the captured
         * PATCH REQUEST body preserves the description byte-for-byte, and (b) a
         * GET readback of the persisted story confirms the description survived
         * on the server. Editing never reorders the backlog, so
         * `userStories(0).first()` addresses the same row across both edits.
         */
        test('a subject-only edit preserves the existing description (C-04)', async ({ page }) => {
            const row = userStories(page).first();

            // --- setup: give the row a known, non-empty description -----------
            const knownDesc = `C04 backlog description ${Date.now()} — survives a subject-only edit`;
            let lb = await openEditLightbox(page, row);
            await lb.locator(LB_EDIT_DESCRIPTION).fill(knownDesc);
            const setupPersist = waitEditPersist(page);
            await submitLightbox(page, lb);
            await setupPersist;

            // --- reopen: the description textarea is hydrated from detail -----
            lb = await openEditLightbox(page, row);
            await expect(lb.locator(LB_EDIT_DESCRIPTION)).toHaveValue(knownDesc, {
                timeout: 15_000,
            });

            // --- edit ONLY the subject ---------------------------------------
            const editedSubject = `C04-backlog-subject-${Date.now()}`;
            await lb.locator(LB_EDIT_SUBJECT).fill(editedSubject);

            // Capture the PATCH *request* body (not just the response) so the
            // exact serialized payload can be asserted.
            const patchReqP = page.waitForRequest(
                (r) => /\/userstories\/\d+(\?|$)/.test(r.url()) && r.method() === 'PATCH',
                { timeout: 20_000 },
            );
            await submitLightbox(page, lb);
            const patchReq = await patchReqP;
            const body = (patchReq.postDataJSON() ?? {}) as Record<string, unknown>;

            // The crux of C-04: subject changed; description sent UNCHANGED and is
            // neither dropped, null, nor blanked.
            expect(body.subject).toBe(editedSubject);
            expect(body.description).toBe(knownDesc);
            expect(body.description).not.toBeNull();
            expect(String(body.description ?? '')).not.toBe('');

            // --- GET/DB readback: the persisted story keeps the description ---
            const idMatch = /\/userstories\/(\d+)(?:\?|$)/.exec(patchReq.url());
            expect(idMatch).not.toBeNull();
            const storyId = Number(idMatch![1]);
            const persistedDesc = await page.evaluate(async (id) => {
                const raw = window.localStorage.getItem('token');
                const token = raw ? JSON.parse(raw) : '';
                const res = await fetch(`/api/v1/userstories/${id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const json = await res.json();
                return json.description as string;
            }, storyId);
            expect(persistedDesc).toBe(knownDesc);
        });
    });

    /* -------------------------------------------------------------- *
     * inline status / points, delete
     * -------------------------------------------------------------- */

    test('edit status inline', async ({ page }) => {
        const row = userStories(page).first();

        // The status popover lists every project status by name; pick "In progress".
        await pickStatus(row, 'In progress');

        // The trigger reflects the chosen status (optimistic React state update).
        await expect(row.locator(`${US_STATUS} .us-status-bind`).first()).toHaveText(
            'In progress',
            { timeout: 15_000 },
        );
    });

    test('edit points inline', async ({ page }) => {
        const row = userStories(page).first();
        const pointsTrigger = row.locator(US_POINTS).first();

        const original = (await pointsTrigger.innerText()).trim();

        // Open the points popover and pick role 0 → point index 1.
        await pickPoints(row, 0, 1);

        await expect
            .poll(async () => (await pointsTrigger.innerText()).trim(), { timeout: 15_000 })
            .not.toBe(original);
    });

    /*
     * [C-07] `delete US` — the row options-popup Delete item (`button.e2e-delete`)
     * opens the THEMED ConfirmDialog ([N-03]), NOT a native window.confirm.
     * Cancelling leaves the row; confirming issues `DELETE /userstories/{id}` and
     * removes it.
     */
    test.describe('delete US', () => {
        test('cancel keeps the story', async ({ page }) => {
            const before = await userStories(page).count();

            const popup = await openRowOptions(page, userStories(page).first());
            await popup.locator(OPT_DELETE).first().click();

            const dialog = page
                .locator(CONFIRM_DIALOG)
                .filter({ has: page.locator(CONFIRM_OK) });
            await expect(dialog).toBeVisible({ timeout: 10_000 });
            await dialog.locator(CONFIRM_CANCEL).click();
            await expect(dialog).toBeHidden({ timeout: 10_000 });

            await expect(userStories(page)).toHaveCount(before);
        });

        test('confirm deletes the story', async ({ page }) => {
            const before = await userStories(page).count();

            const popup = await openRowOptions(page, userStories(page).first());
            await popup.locator(OPT_DELETE).first().click();

            const dialog = page
                .locator(CONFIRM_DIALOG)
                .filter({ has: page.locator(CONFIRM_OK) });
            await expect(dialog).toBeVisible({ timeout: 10_000 });
            await capture(page, 'delete-us');

            const deleted = page.waitForResponse(
                (r) =>
                    /\/userstories\/\d+(\?|$)/.test(r.url()) &&
                    r.request().method() === 'DELETE',
                { timeout: 20_000 },
            );
            await dialog.locator(CONFIRM_OK).click();
            await deleted;

            await expect(userStories(page)).toHaveCount(before - 1, { timeout: 20_000 });
        });
    });

    /* -------------------------------------------------------------- *
     * drag & drop — backlog + milestones
     * -------------------------------------------------------------- */

    test('drag backlog us', async ({ page }) => {
        const rows = userStories(page);

        // Take the row at index 4, remember its ref, move it to the top (row 0)
        // via the deterministic KeyboardSensor path (see `keyboardReorder`).
        const dragRow = rows.nth(4);
        const draggedRef = await tableRowRef(dragRow);

        // HARD-assert the reorder persists through bulk_update_backlog_order.
        const persisted = waitBacklogOrderPersist(page);
        await keyboardReorder(dragRow.locator(TABLE_DRAG_HANDLE), 'ArrowUp', 4);
        const response = await persisted;
        expect(response.ok()).toBe(true);

        // The moved story is now the first backlog row (identity assertion —
        // survives a concurrent WebSocket-driven reload of the board).
        await expect
            .poll(async () => await tableRowRef(rows.nth(0)), { timeout: 20_000 })
            .toBe(draggedRef);
    });

    /*
     * [C-07] rollback — when the backlog-order persist FAILS, the optimistic
     * reorder is rolled back (BacklogApp L1985: `applyMovedUserstories(prev)`)
     * and the rows return to their original order. Force a 500 on
     * `bulk_update_backlog_order` via route interception (deterministic, no
     * backend dependency).
     */
    test('failed order persist rolls the reorder back', async ({ page }) => {
        const rows = userStories(page);
        const originalFirstRef = await tableRowRef(rows.nth(0));
        const dragRow = rows.nth(4);
        const draggedRef = await tableRowRef(dragRow);
        // Sanity: the row we move is genuinely NOT already the first row, so the
        // rollback assertion below is meaningful (not trivially satisfied).
        expect(draggedRef).not.toBe(originalFirstRef);

        // Force the reorder persist to fail so the optimistic move must roll back.
        await page.route(/bulk_update_backlog_order/, (route) =>
            route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
        );

        // [F-08] The former test was VACUOUS: a no-op drag trivially satisfied
        // "row 0 == original && != dragged", and it never proved the optimistic
        // move happened before the 500. Guard against that here by awaiting the
        // intercepted `bulk_update_backlog_order` — the persist ONLY fires when a
        // drop actually CHANGED the order, so this response arriving proves the
        // optimistic reorder occurred; the route then fulfils it with 500.
        const failedPersist = page.waitForResponse(
            (r) => /bulk_update_backlog_order/.test(r.url()) && r.request().method() !== 'GET',
            { timeout: 20_000 },
        );
        await keyboardReorder(dragRow.locator(TABLE_DRAG_HANDLE), 'ArrowUp', 4);
        const failResp = await failedPersist;
        expect(failResp.status()).toBe(500);

        // After the failed persist the optimistic reorder is rolled back: row 0 is
        // the ORIGINAL first row again, and the dragged story is NOT left at row 0.
        await expect
            .poll(async () => await tableRowRef(rows.nth(0)), { timeout: 15_000 })
            .toBe(originalFirstRef);
        expect(await tableRowRef(rows.nth(0))).not.toBe(draggedRef);

        await page.unroute(/bulk_update_backlog_order/);
    });

    /*
     * [C-07] permission gating — the "+" create controls (`.new-us` buttons) are
     * gated on the `add_us` permission (`{canAddUs && …}`). Strip `add_us` from
     * the project payload via route interception, reload, and assert both the
     * standard and bulk create affordances are absent.
     */
    test('create affordances are hidden without add_us permission', async ({ page }) => {
        const projectsRe = /\/api\/v1\/projects(\/|\?|$)/;
        const stripAddUs = (p: Record<string, unknown>): Record<string, unknown> => {
            if (Array.isArray(p.my_permissions)) {
                p.my_permissions = (p.my_permissions as string[]).filter((x) => x !== 'add_us');
            }
            return p;
        };

        await page.route(projectsRe, async (route) => {
            const response = await route.fetch();
            let json: unknown;
            try {
                json = await response.json();
            } catch {
                return route.fulfill({ response });
            }
            const body = Array.isArray(json)
                ? (json as Record<string, unknown>[]).map(stripAddUs)
                : stripAddUs(json as Record<string, unknown>);
            return route.fulfill({ response, json: body });
        });

        // Reload so the board re-reads the permission-stripped project payload.
        await openBacklog(page, 'project-3');

        await expect(page.locator(NEW_US_STANDARD)).toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator(NEW_US_BULK)).toHaveCount(0, { timeout: 15_000 });

        await page.unroute(projectsRe);
    });

    test('reorder multiple us', async ({ page }) => {
        const rows = userStories(page);
        const count = await rows.count();

        // Select the last two rows and record their refs (order per source).
        // The row checkbox is VISUALLY HIDDEN (clipped 1px, kept focusable) so a
        // normal click fails Playwright's visibility gate → force:true.
        const last = rows.nth(count - 1);
        await last.locator('input[type="checkbox"]').click({ force: true });
        const ref1 = await tableRowRef(last);

        const secondLast = rows.nth(count - 2);
        await secondLast.locator('input[type="checkbox"]').click({ force: true });
        const ref2 = await tableRowRef(secondLast);

        // Drag the last-selected row's handle onto row 0; HARD-assert persistence.
        const persisted = waitBacklogOrderPersist(page);
        await dndDrag(page, secondLast.locator(TABLE_DRAG_HANDLE), rows.nth(0));
        const response = await persisted;
        expect(response.ok()).toBe(true);

        // Rows 0 and 1 now hold the two dragged refs (source ordering).
        await expect
            .poll(async () => await tableRowRef(rows.nth(1)), { timeout: 20_000 })
            .toBe(ref1);
        expect(await tableRowRef(rows.nth(0))).toBe(ref2);
    });

    test('drag multiple us to milestone', async ({ page }) => {
        const sprint = sprints(page).nth(0);
        const initialSprintCount = await sprintUserStories(sprint).count();

        // Re-establish the two-row selection (per-test fixture pages start fresh).
        // Checkbox is visually-hidden → force:true.
        const rows = userStories(page);
        const count = await rows.count();
        await rows.nth(count - 1).locator('input[type="checkbox"]').click({ force: true });
        await rows.nth(count - 2).locator('input[type="checkbox"]').click({ force: true });

        // Drag one of the SELECTED rows' handles onto sprint 0's table ⇒ the whole
        // checked block moves (legacy `window.dragMultiple` moves the multi-select
        // only when the DRAGGED row is itself checked; the legacy Protractor case
        // dragged a row that a prior test had left selected — here we select-then-
        // drag the same row explicitly so the port is self-contained).
        await dndDrag(
            page,
            rows.nth(count - 2).locator(TABLE_DRAG_HANDLE),
            sprint.locator(SPRINT_TABLE),
        );

        await expect(sprintUserStories(sprint)).toHaveCount(initialSprintCount + 2, {
            timeout: 20_000,
        });
    });

    test('drag us to milestone', async ({ page }) => {
        const sprint = sprints(page).nth(0);
        const sprintTable = sprint.locator(SPRINT_TABLE);
        const initialSprintCount = await sprintUserStories(sprint).count();

        const rows = userStories(page);
        await dndDrag(page, rows.nth(0).locator(TABLE_DRAG_HANDLE), sprintTable);

        await expect(sprintUserStories(sprint)).toHaveCount(initialSprintCount + 1, {
            timeout: 20_000,
        });
    });

    test('move to latest sprint button', async ({ page }) => {
        const firstRow = userStories(page).first();
        const draggedRef = await tableRowRef(firstRow);

        // Selecting a story reveals the (display:none) move-to-sprint button
        // (`moveToSprintVisible`). The checkbox is visually-hidden → force:true.
        await firstRow.locator('input[type="checkbox"]').click({ force: true });

        const moveBtn = page.locator(MOVE_TO_LATEST).first();
        await moveBtn.waitFor({ state: 'visible', timeout: 10_000 });
        await moveBtn.click();

        // The story leaves the backlog (it was moved into a sprint) — assert by
        // IDENTITY, agnostic to whether the project rendered "move to current" or
        // "move to latest" (both share `.e2e-move-to-sprint`).
        await expect
            .poll(async () => await tableRefs(page), { timeout: 20_000 })
            .not.toContain(draggedRef);

        // ...and it now appears inside one of the open sprints.
        await expect
            .poll(
                async () => {
                    const open = sprintsOpen(page);
                    const n = await open.count();
                    for (let i = 0; i < n; i++) {
                        if ((await sprintRefs(open.nth(i))).includes(draggedRef)) {
                            return true;
                        }
                    }
                    return false;
                },
                { timeout: 20_000 },
            )
            .toBe(true);
    });

    test('reorder milestone us', async ({ page }) => {
        const sprint = sprints(page).nth(0);
        const rows = sprintUserStories(sprint);

        // A SPRINT row is itself the draggable node (no inner handle): drag row 3
        // onto row 0; the row-0 ref becomes the dragged row's ref.
        const dragRow = rows.nth(3);
        const draggedRef = await sprintRowRef(dragRow);

        await dndDrag(page, dragRow, rows.nth(0));

        await expect
            .poll(async () => await sprintRowRef(rows.nth(0)), { timeout: 20_000 })
            .toBe(draggedRef);
    });

    test('drag us from milestone to milestone', async ({ page }) => {
        const sprint1 = sprints(page).nth(0);
        const sprint2 = sprints(page).nth(1);
        const initialSprint2Count = await sprintUserStories(sprint2).count();

        // The sprint row is the drag source itself.
        const dragRow = sprintUserStories(sprint1).nth(0);
        await dndDrag(page, dragRow, sprint2.locator(SPRINT_TABLE));

        await expect(sprintUserStories(sprint2)).toHaveCount(initialSprint2Count + 1, {
            timeout: 20_000,
        });
    });

    test('select us with SHIFT', async ({ page }) => {
        const rows = userStories(page);
        const firstCheckbox = rows.nth(0).locator('input[type="checkbox"]');
        const fourthCheckbox = rows.nth(3).locator('input[type="checkbox"]');

        // The checkbox is VISUALLY HIDDEN (BacklogTable.tsx `VISUALLY_HIDDEN_CHECKBOX`
        // — clipped 1px, kept focusable), so a normal click fails Playwright's
        // visibility gate → `force: true`. The range-select reads
        // `nativeEvent.shiftKey` on the CLICK (onChange, L917), so the Shift state
        // must be carried BY the click via `modifiers` — a separately-held
        // `keyboard.down('Shift')` is not guaranteed to be on the click event.
        await firstCheckbox.click({ force: true });
        await fourthCheckbox.click({ force: true, modifiers: ['Shift'] });

        // First + shift-fourth selects the contiguous range rows 0..3 (4 stories).
        await expect(selectedUserStories(page)).toHaveCount(4, { timeout: 15_000 });
    });

    test('role filters', async ({ page }) => {
        // Open the per-role points-column filter in the TABLE HEADER and pick the
        // first computable role. The header `.pop-role` (BacklogTable.tsx L618) is
        // distinct from the per-row inline `.pop-role`, so scope to the header.
        const headerPop = page.locator(`${BOARD} .backlog-table-header ${POP_ROLE}`).first();
        await page.locator(ROLE_FILTER_TRIGGER).first().click();
        await headerPop.waitFor({ state: 'visible', timeout: 10_000 });
        await headerPop.locator(POP_ROLE_ITEM).first().click();
        await headerPop.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {
            /* popover closed */
        });

        await capture(page, 'backlog-role-filters');

        // With a single role selected the points column shows THAT role's figure.
        // `formatPoints` (BacklogTable.tsx L486: `value == null ? "?" : String(value)`)
        // renders a plain number or "?" — the legacy "x / y" format never existed
        // in the React port, so assert the real single-figure format.
        const points = (await userStories(page).nth(0).locator(US_POINTS).first().innerText()).trim();
        expect(points).toMatch(/^(\d+(\.\d+)?|\?)$/);
    });

    /* -------------------------------------------------------------- *
     * milestones (create / edit / delete + the reimplemented sprint
     * validation that replaces checksley — AAP §0.3.3, §0.7.2)
     * -------------------------------------------------------------- */
    test.describe('milestones', () => {
        test('create', async ({ page }) => {
            await page.locator(ADD_SPRINT).first().click();
            const lb = await waitSprintLightbox(page);
            await capture(page, 'create-milestone');

            const name = `sprintName${Date.now()}`;
            await lb.locator(SPRINT_NAME_INPUT).first().fill(name);
            await lb.locator(SPRINT_SUBMIT).first().click();
            await waitSprintLightboxClose(page);

            await expect
                .poll(async () => await sprintTitles(page), { timeout: 15_000 })
                .toContain(name);
        });

        test('edit', async ({ page }) => {
            await page.locator(EDIT_SPRINT).nth(0).click();
            const lb = await waitSprintLightbox(page);

            const nameInput = lb.locator(SPRINT_NAME_INPUT).first();
            await nameInput.fill('');
            const name = `sprintName${Date.now()}`;
            await nameInput.fill(name);
            await lb.locator(SPRINT_SUBMIT).first().click();
            await waitSprintLightboxClose(page);

            await expect
                .poll(async () => await sprintTitles(page), { timeout: 15_000 })
                .toContain(name);
        });

        // [C-07] Sprint delete uses the THEMED ConfirmDialog nested over the
        // sprint lightbox (SprintEditLightbox → ConfirmDialog, [N-03]), NOT a
        // native window.confirm. Both are role="dialog", so target the confirm
        // control (`.js-confirm`) directly — it is unique to the ConfirmDialog —
        // and hard-assert the `DELETE /milestones/{id}` persist.
        test('delete', async ({ page }) => {
            await page.locator(EDIT_SPRINT).nth(0).click();
            const lb = await waitSprintLightbox(page);

            // Record the name BEFORE deleting.
            const name = (await lb.locator(SPRINT_NAME_INPUT).first().inputValue()).trim();

            await lb.locator(SPRINT_DELETE).first().click();

            // Scope the confirm to the VISIBLE ConfirmDialog. The sprint lightbox
            // (`.lightbox-sprint-add-edit`) is itself `[role="dialog"]` and stays
            // open beneath the delete confirm, so a bare `.js-confirm` (or a bare
            // `[role="dialog"]`) is ambiguous; filter to the dialog that actually
            // CONTAINS a `.js-confirm` (only the ConfirmDialog does).
            const confirmDialog = page
                .locator(CONFIRM_DIALOG)
                .filter({ has: page.locator(CONFIRM_OK) });
            await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
            const confirmBtn = confirmDialog.locator(CONFIRM_OK);

            const deleted = page.waitForResponse(
                (r) =>
                    /\/milestones\/\d+(\?|$)/.test(r.url()) &&
                    r.request().method() === 'DELETE',
                { timeout: 20_000 },
            );
            await confirmBtn.click();
            await deleted;
            await waitSprintLightboxClose(page);

            await expect
                .poll(async () => await sprintTitles(page), { timeout: 15_000 })
                .not.toContain(name);
        });

        // NEW parity test: the required-name rule reimplemented in
        // app/react/shared/validation/sprintForm.ts (replaces checksley).
        test('validation: name required', async ({ page }) => {
            const before = await sprintTitles(page);

            await page.locator(ADD_SPRINT).first().click();
            const lb = await waitSprintLightbox(page);

            // Ensure the name is empty, then attempt to submit.
            await lb.locator(SPRINT_NAME_INPUT).first().fill('');
            await lb.locator(SPRINT_SUBMIT).first().click();

            // The lightbox stays open (submission blocked) ...
            await expect(lb).toBeVisible();
            // ... the required-name validation error is shown ...
            const requiredText = lb.getByText('This value is required.', { exact: false });
            await expect(validationErrors(lb).or(requiredText).first()).toBeVisible();
            // ... and no new sprint was created.
            expect(await sprintTitles(page)).toEqual(before);

            // Correcting the name clears the required error.
            await lb.locator(SPRINT_NAME_INPUT).first().fill(`sprintName${Date.now()}`);
            await expect(lb.getByText('This value is required.', { exact: false })).toHaveCount(0);

            await page.keyboard.press('Escape').catch(() => {
                /* best-effort cleanup */
            });
        });

        // NEW parity test: the valid-date-range rule reimplemented in
        // app/react/shared/validation/sprintForm.ts (replaces checksley).
        test('validation: date range', async ({ page }) => {
            const before = await sprintTitles(page);
            const rangeMessage = 'The start date must be on or before the finish date.';
            const { startDate, finishBad, finishGood } = sprintDateFixtures();

            await page.locator(ADD_SPRINT).first().click();
            const lb = await waitSprintLightbox(page);

            await lb.locator(SPRINT_NAME_INPUT).first().fill(`sprintName${Date.now()}`);

            // Inverted range: start AFTER finish (driven via the Pikaday calendar).
            await setDate(lb.locator(SPRINT_START_INPUT).first(), startDate);
            await setDate(lb.locator(SPRINT_FINISH_INPUT).first(), finishBad);

            await lb.locator(SPRINT_SUBMIT).first().click();

            // Submission is blocked and a date-range validation error is shown.
            await expect(lb).toBeVisible();
            const rangeText = lb.getByText(rangeMessage, { exact: false });
            await expect(rangeText.or(validationErrors(lb)).first()).toBeVisible();
            expect(await sprintTitles(page)).toEqual(before);

            // Correct the range (start <= finish) ⇒ the range error clears.
            await setDate(lb.locator(SPRINT_FINISH_INPUT).first(), finishGood);
            await expect(lb.getByText(rangeMessage, { exact: false })).toHaveCount(0);

            await page.keyboard.press('Escape').catch(() => {
                /* best-effort cleanup */
            });
        });
    });

    /* -------------------------------------------------------------- *
     * tags
     * -------------------------------------------------------------- */
    test.describe('tags', () => {
        test('show', async ({ page }) => {
            // The toggle persists in localStorage, so drive it explicitly ON
            // (never assume it starts OFF).
            await setShowTags(page, true);
            await capture(page, 'backlog-tags');
            await expect(page.locator(ROW_TAG).first()).toBeVisible();
        });

        test('hide', async ({ page }) => {
            // Reveal tags, confirm they render, then hide them and confirm the
            // tag nodes are gone (they are conditionally rendered, not CSS-hidden).
            await setShowTags(page, true);
            await expect(page.locator(ROW_TAG).first()).toBeVisible();
            await setShowTags(page, false);
            await expect(page.locator(ROW_TAG)).toHaveCount(0);
        });
    });

    /* -------------------------------------------------------------- *
     * velocity forecasting
     * -------------------------------------------------------------- */
    test.describe('velocity forecasting', () => {
        test('show', async ({ page }) => {
            // Velocity forecasting only renders when `stats.speed > 0`. sample_data
            // never closes a sprint, so ensure a computable velocity on a dedicated
            // project via the frozen API first, then load its backlog.
            await ensureVelocity(page, 'project-2');
            await openBacklog(page, 'project-2');

            const before = await userStories(page).count();

            await page.locator(VELOCITY).first().click();
            await capture(page, 'velocity-forecasting');

            await expect
                .poll(async () => await userStories(page).count(), { timeout: 15_000 })
                .toBeLessThan(before);
        });

        test('create sprint from forecasting', async ({ page }) => {
            await ensureVelocity(page, 'project-2');
            await openBacklog(page, 'project-2');

            const before = await sprintsOpen(page).count();

            await page.locator(VELOCITY).first().click();
            await page.locator(VELOCITY_ADD).first().click();

            // The forecasting "add" opens the same SprintEditLightbox.
            const lb = await waitSprintLightbox(page);
            const name = `sprintName${Date.now()}`;
            await lb.locator(SPRINT_NAME_INPUT).first().fill(name);
            await lb.locator(SPRINT_SUBMIT).first().click();
            await waitSprintLightboxClose(page);

            await expect
                .poll(async () => await sprintsOpen(page).count(), { timeout: 15_000 })
                .toBeGreaterThan(before);
        });

        test('hide forecasting if no velocity', async ({ page }) => {
            // Use a project that HAS stories (so the board renders) but has no
            // velocity — sample_data never closes a sprint, and no other test
            // closes a project-3 sprint, so its `stats.speed` stays 0. This
            // isolates the `speed > 0` gate (an EMPTY project would hide the panel
            // for the unrelated `hasStories === false` reason AND its empty
            // `.backlog-table-body` never becomes visible, hanging `waitLoader`).
            await openBacklog(page, 'project-3');
            await expect(page.locator(VELOCITY)).toHaveCount(0);
        });
    });

    /* -------------------------------------------------------------- *
     * backlog filters (representative subset of e2e/shared/filters.js)
     * -------------------------------------------------------------- */
    test.describe('backlog filters', () => {
        test('filter by ref', async ({ page }) => {
            await openFilters(page);

            // A bogus ref matches nothing.
            await filterByText(page, 'xxxxyy123123123');
            await expect
                .poll(async () => await userStories(page).count(), { timeout: 15_000 })
                .toBe(0);

            // Clearing restores the full list.
            await clearFilters(page);
            await expect
                .poll(async () => await userStories(page).count(), { timeout: 15_000 })
                .toBeGreaterThan(0);
        });

        test('filter by category', async ({ page }) => {
            await openFilters(page);

            const before = await userStories(page).count();

            // Open the first filter category and apply its first option, asserting
            // the visible story count drops, then clear to restore it.
            const category = page.locator(FILTER_CATEGORY).first();
            await category.waitFor({ state: 'visible', timeout: 10_000 });
            // Expand the (first = "status") category via its toggle button. The
            // backlog spans multiple statuses, so applying any single status option
            // deterministically shrinks the visible list below `before`.
            await category.locator('.e2e-category').first().click();

            const option = category.locator('.single-filter').first();
            await option.waitFor({ state: 'visible', timeout: 10_000 });
            await option.click();

            await expect
                .poll(async () => await userStories(page).count(), { timeout: 15_000 })
                .toBeLessThan(before);

            await clearFilters(page);
            await expect
                .poll(async () => await userStories(page).count(), { timeout: 15_000 })
                .toBe(before);
        });
    });

    /* -------------------------------------------------------------- *
     * closed sprints (stateful fixtures built once via a guarded setup)
     * -------------------------------------------------------------- */
    test.describe('closed sprints', () => {
        let closedSetupDone = false;

        async function createEmptyMilestone(page: Page): Promise<void> {
            await page.locator(ADD_SPRINT).first().click();
            const lb = await waitSprintLightbox(page);
            await lb.locator(SPRINT_NAME_INPUT).first().fill(`sprintName${Date.now()}`);
            await lb.locator(SPRINT_SUBMIT).first().click();
            await waitSprintLightboxClose(page);
        }

        async function dragClosedUsToMilestone(page: Page): Promise<void> {
            // Create a user story via the bulk lightbox, set it CLOSED inline, then
            // drag it into the empty sprint's table.
            await bulkCreate(page, ['closed story']);

            const rows = userStories(page);
            const lastRow = rows.nth((await rows.count()) - 1);
            await pickStatus(lastRow, 'Done');

            const emptySprintTable = page.locator(`${BOARD} ${SPRINT_EMPTY}`).last();
            await dndDrag(page, lastRow.locator(TABLE_DRAG_HANDLE), emptySprintTable);
        }

        test.beforeEach(async ({ page }) => {
            if (!closedSetupDone) {
                await createEmptyMilestone(page);
                await dragClosedUsToMilestone(page);
                closedSetupDone = true;
            }
        });

        test('open closed sprints', async ({ page }) => {
            await page.locator(CLOSED_SPRINTS_TOGGLE).first().click();
            await expect(closedSprints(page)).toHaveCount(1, { timeout: 15_000 });
        });

        test('close closed sprints', async ({ page }) => {
            const toggle = page.locator(CLOSED_SPRINTS_TOGGLE).first();
            // Fresh page: reveal (toggle on) first, then hide (toggle off).
            await toggle.click();
            await expect(closedSprints(page)).toHaveCount(1, { timeout: 15_000 });
            await toggle.click();
            await expect(closedSprints(page)).toHaveCount(0, { timeout: 15_000 });
        });

        test('open sprint by drag open US to closed sprint', async ({ page }) => {
            await page.locator(CLOSED_SPRINTS_TOGGLE).first().click();

            // Move backlog row 1 to an OPEN status.
            const row1 = userStories(page).nth(1);
            await pickStatus(row1, 'In progress');

            // Expand the last sprint, then drag row 1 into its table.
            const lastSprint = sprints(page).last();
            await lastSprint.locator(COMPACT_SPRINT).first().click();

            await dndDrag(page, row1.locator(TABLE_DRAG_HANDLE), lastSprint.locator(SPRINT_TABLE));

            // No closed milestones remain ⇒ the closed-sprints toggle disappears.
            await expect(page.locator(CLOSED_SPRINTS_TOGGLE)).toHaveCount(0, {
                timeout: 15_000,
            });
        });
    });

    /* -------------------------------------------------------------- *
     * XSS-safe output (AAP §0.6.3 — new React tests include XSS-safe
     * output assertions)
     * -------------------------------------------------------------- */
    test('sprint/US content is XSS-safe', async ({ page }) => {
        const payload = '<img src=x onerror="window.__xss=1">';

        // Reset the XSS canary before creating the malicious content.
        await page.evaluate(() => {
            (window as unknown as { __xss?: unknown }).__xss = undefined;
        });

        // Create a user story whose subject is the payload via the bulk lightbox.
        const before = await userStories(page).count();
        await bulkCreate(page, [payload]);
        await expect(userStories(page)).toHaveCount(before + 1, { timeout: 20_000 });

        // The payload renders as escaped LITERAL text (never as an <img> node).
        await expect(
            page.locator(BOARD).getByText(payload, { exact: false }).first(),
        ).toBeVisible();

        // The injected onerror handler never executed.
        const xss = await page.evaluate(
            () => (window as unknown as { __xss?: unknown }).__xss,
        );
        expect(xss).toBeFalsy();
    });
});
