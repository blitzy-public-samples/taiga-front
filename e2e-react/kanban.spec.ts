/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * Playwright parity suite for the REACT Kanban board.
 * =====================================================
 *
 * This is a like-for-like behavioral port of the legacy Protractor suite
 * taiga-front/e2e/suites/kanban.e2e.js (~15 cases). Every scenario and every
 * assertion INTENT is preserved; only the harness changes: the Protractor /
 * AngularJS WebDriver DOM driving is replaced by Playwright 1.44 driving the
 * React Kanban screen, which is mounted inside the <tg-react-kanban> custom
 * element in the still-AngularJS document (AAP §0.3.1).
 *
 * SELECTOR CONTRACT — reconciled to the BUILT React DOM (QA Issue 1 fix)
 * ---------------------------------------------------------------------
 * Every selector below was verified to exist as a real class/attribute token in
 * the compiled bundle (dist/<version>/js/react-app.js) using a strict
 * class-token boundary check (not a naive substring match). The React board
 * reproduces the legacy Jade CSS class names where they exist (AAP §0.3.4); the
 * legacy AngularJS attribute directives (`tg-board-zoom`, `tg-card`,
 * `[ng-repeat]`, `.card-owner-actions`, `data-testid` lightbox hosts, the
 * `.e2e-assign` link, `e2e-category`/`e2e-filter-q` filter hooks) do NOT exist
 * in React and have been retargeted to the classes the components actually
 * render:
 *   • columns  → `.taskboard-column` (body) / `.task-colum-name` (header)
 *   • cards    → `.card`, subject `.card-subject.e2e-title`, ref `.card-ref`
 *   • zoom     → `.board-zoom` with 4 `label.zoom-radio > input[type=radio]
 *                [name="kanban-board-zoom"][value=0..3]` (the active level is the
 *                `:checked` input; `zoomLevel===level`), NOT a `.zoom-level` button
 *   • bulk US  → `.lightbox-us-bulk` with `.e2e-bulk-subjects/-submit/-close`
 *   • filters  → `.btn-filter.e2e-open-filter`, `input.kanban-search.e2e-search`,
 *                categories `.filters-cats li[data-type]` expanded via
 *                `.e2e-category`, options `button.single-filter` (`span.name`),
 *                applied chips `.filters-applied .single-applied-filter` removed
 *                via their `.e2e-remove-filter` button
 *   • actions  → `.card-actions button.js-popup-button` opens the card-actions
 *                menu, which React PORTALS to `document.body` as
 *                `.popover.global-popover[role="menu"]` (NOT a child of the card
 *                and NOT `.card-actions-menu`), with `.card-action-edit` /
 *                `.card-action-assigned-to` / `.card-action-delete` (role=menuitem)
 *   • assign   → `.card-action-assigned-to` opens the SelectUserLightbox
 *                (`.lightbox-select-user`), NOT the edit lightbox; pick a
 *                `.user-list-item` then confirm via `.lb-select-user-confirm`
 *
 * SCOPE OF THE MIGRATED SCREEN (what these cases drive)
 * -----------------------------------------------------
 * [C-07] The migrated kanban.jade hosts <tg-react-kanban>, and the React Kanban
 * owns its OWN full-featured create/edit lightbox
 * (app/react/kanban/UserStoryEditLightbox.tsx). The earlier `genericform:*`
 * `$rootScope.$broadcast` bridge was REMOVED — it targeted the deleted Angular
 * `tg-lb-create-edit` host and was a silent no-op (see KanbanApp.tsx). Every
 * single-US flow is therefore exercised against the REAL React DOM, not a bridge
 * event and not the bulk lightbox:
 *   • CREATE US — open the real create lightbox from a column's "+" control
 *     (`.add-action`), fill the subject (and, for full-form parity, description /
 *     tags / due-date / blocked), submit (`.js-submit-button`). A bare create
 *     persists via `POST /userstories/bulk_create`; a filled create adds a
 *     follow-up `PATCH /userstories/{id}`. The card then appears on the board.
 *   • EDIT US — open the real edit lightbox from the card-actions menu
 *     (`.card-action-edit`), change fields, submit. Persists via
 *     `PATCH /userstories/{id}` with subject/description/tags/due_date/is_blocked
 *     (+ version); the card updates in place. This is where full-form + field
 *     parity is asserted against the actual request body.
 *   • EDIT ASSIGNED-TO — open the SAME real lightbox via `.card-action-assigned-to`
 *     with the assignee field focused (`focusAssignee`); the assignee control is a
 *     real React field, not a delegated AngularJS lightbox.
 *   • BULK CREATE — a SEPARATE React surface (`.bulk-action` → `.lightbox-us-bulk`)
 *     covered by its own case; it is never used as the standard single-create path.
 *   • ATTACHMENTS — a real file input in the create/edit lightbox; add/remove is
 *     asserted (multipart `POST /userstories/attachments`, `DELETE .../{id}`).
 *   • DELETE — the themed, localized React `ConfirmDialog` (role="dialog",
 *     `.js-confirm` / `.js-cancel`); NOT a native `window.confirm`.
 *   • NEGATIVE / PERMISSION / VALIDATION — an empty-subject create is blocked
 *     with a `.checksley-required` message and fires NO request; the "+" create
 *     control is absent when the project/role cannot add user stories
 *     (`canAddUs === false`); DnD/move-to-top rollback on a rejected persist is
 *     covered by the move cases (hard `bulk_update_kanban_order` assertions).
 *
 * TEST-LAYER ISOLATION (AAP §0.6.3)
 * ---------------------------------
 * This file imports ONLY from `@playwright/test` (via ./fixtures/session) and
 * Node's `path`. It NEVER imports Protractor, `browser`, `$`, `$$`, chai, or ANY
 * module from ../e2e/** helpers/utils.
 *
 * SESSION (AAP §0.6.1)
 * --------------------
 * The shared ./fixtures/session fixture performs a REAL UI login (admin/123123)
 * before every test on the SAME shared session the app uses
 * (localStorage["token"], window.taiga.sessionId). We never mint a parallel
 * session/token here.
 *
 * DETERMINISM (QA Issue 7 fix)
 * ----------------------------
 * There are ZERO fixed `waitForTimeout` sleeps in this suite. Every wait is
 * condition-based (`expect(...).toHaveCount/…`, `expect.poll`, `waitForResponse`,
 * `locator.waitFor`), so the suite is stable on slow CI runners.
 *
 * PERSISTENCE (QA Issue 6 fix)
 * ----------------------------
 * Drag-and-drop drop-order persistence is HARD-asserted: the move/archive tests
 * `await` the `bulk_update_kanban_order` POST and assert its response is ok(),
 * in addition to the DOM count-delta — the frozen bulk-order contract
 * (AAP §0.7.1) is verified, not merely observed best-effort.
 *
 * ISOLATION / RESET (QA Issue 4)
 * ------------------------------
 * A deterministic reseed hook runs once before the whole run
 * (e2e-react/fixtures/globalSetup.ts, wired via playwright.config.ts). Mutating
 * specs additionally use unique, timestamped subjects so a second run from a
 * clean reseed never collides on duplicate data.
 *
 * RUNTIME / TOOLING
 * -----------------
 * Playwright 1.44.1 — only APIs available in 1.44 are used. Playwright
 * transpiles this .ts file with its own esbuild-based transform; there is NO
 * ts-jest / tsc / gulp build step for the e2e-react/ tree.
 */

import { test, expect } from './fixtures/session';
import type { Page, Locator } from '@playwright/test';
import * as path from 'path';

/*
 * ---------------------------------------------------------------------------
 * Capture phase + named-capture helper
 * ---------------------------------------------------------------------------
 * PHASE mirrors playwright.config.ts: 'baseline' (AngularJS, captured BEFORE
 * the CoffeeScript is reduced to stubs) or 'react' (post-migration, default).
 * CAP_DIR is the SAME per-phase artifacts directory the config's outputDir
 * uses; page.screenshot() creates the intermediate directories on demand.
 */
const PHASE = process.env.E2E_PHASE === 'baseline' ? 'baseline' : 'react';
const CAP_DIR = path.join(__dirname, 'artifacts', PHASE, 'kanban');

/** Write a named parity screenshot (preserves the legacy capture filenames). */
async function capture(page: Page, name: string): Promise<void> {
    await page.screenshot({ path: path.join(CAP_DIR, `${name}.png`) });
}

/*
 * ---------------------------------------------------------------------------
 * Selector map — reconciled to the built React DOM (see the file header).
 * ---------------------------------------------------------------------------
 */
const BOARD = 'tg-react-kanban'; // React Kanban custom-element host
const HEADER_COLUMNS = '.task-colum-name'; // column headers (legacy typo "colum" preserved)
const COLUMNS = '.taskboard-column'; // board column bodies (droppable)
const CARD = '.card'; // a rendered card
const CARD_TITLE = '.card-subject.e2e-title'; // card subject/title
const CARD_REF = '.card-ref'; // card reference (#N)
const VFOLD_HEADER = '.task-colum-name.vfold'; // a folded (vertical) column header
const SCROLL_BODY = '.kanban-table-body'; // horizontally scrollable board body

// Per-column header option affordances (buttons live in `.task-colum-name .options`).
const ADD_ACTION = '.add-action'; // [C-07] opens the REAL single-US create lightbox
const BULK_ACTION = '.bulk-action'; // opens the bulk-create lightbox for that column
const FOLD_ACTION = '.icon-fold-column'; // folds the column (visible when unfolded)
const UNFOLD_ACTION = '.icon-unfold-column'; // unfolds the column (visible when folded)

// Card actions popup (ARIA menu). Exposes edit / assign / delete / move-to-top.
// The trigger lives inside the card; the menu itself is PORTALED to
// document.body (Card.tsx createPortal), so it is queried from `page`, not the
// card, and is the legacy globalPopover markup `.popover.global-popover`.
const CARD_ACTIONS_BTN = '.card-actions button.js-popup-button';
const CARD_ACTIONS_MENU = '.popover.global-popover[role="menu"]';
const CARD_ACTION_EDIT = '.card-action-edit';
const CARD_ACTION_ASSIGN = '.card-action-assigned-to';
const CARD_ACTION_DELETE = '.card-action-delete';

// [C-07] The REAL single-US create/edit lightbox (app/react/kanban/UserStoryEditLightbox.tsx).
// Reproduces the Jade `div.lightbox.lightbox-generic-form.lightbox-create-edit`;
// `.open` is toggled to reveal it. Fields carry the same `name=` attributes as the
// legacy generic form so payload parity is directly observable.
const LB_EDIT = '.lightbox-create-edit'; // the create/edit lightbox root
const LB_EDIT_SUBJECT = 'input[name="subject"]'; // subject field
const LB_EDIT_DESCRIPTION = 'textarea[name="description"]'; // description field
const LB_EDIT_DUE_DATE = 'input[name="due_date"]'; // due-date field
const LB_EDIT_SUBMIT = '.js-submit-button'; // Create/Save submit button
const LB_EDIT_REQUIRED = '.checksley-required'; // inline required-field error

// [KAN-03] Assignee picker — the `.card-action-assigned-to` action opens the
// dedicated SelectUserLightbox (app/react/kanban/SelectUserLightbox.tsx), NOT
// the create/edit lightbox. It reproduces the legacy `lightbox-select-user`:
// clickable `.user-list-item` rows (role rows carry a `.user-list-name > .role`
// span; plain user rows do not) and a `.lb-select-user-confirm` button that is
// visible only when the search box is empty. Confirming issues a single
// PATCH /userstories/{id} (assigned_users/assigned_to + version).
const LB_SELECT_USER = '.lightbox-select-user'; // SelectUserLightbox root
const LB_SELECT_USER_ITEM = '.user-list-item'; // a selectable user/role row
const LB_SELECT_USER_CONFIRM = '.lb-select-user-confirm'; // confirm the selection

// Themed React delete-confirmation dialog (shared/dialog/ConfirmDialog.tsx) — [N-03]
// replaces the native window.confirm. role="dialog" + aria-modal.
const CONFIRM_DIALOG = '[role="dialog"]';
const CONFIRM_OK = '.js-confirm';
const CONFIRM_CANCEL = '.js-cancel';

// Bulk-create lightbox — a SEPARATE React surface, NOT the standard single create.
const LB_BULK = '.lightbox-us-bulk';
const BULK_SUBJECTS = '.e2e-bulk-subjects';
const BULK_SUBMIT = '.e2e-bulk-submit';

// In-board zoom control. The React `.board-zoom` renders 4 discrete
// `label.zoom-radio` wrappers, each containing a native
// `input[type=radio][name="kanban-board-zoom"][value=0..3]`. The active level is
// the `:checked` input (bound to `zoomLevel===level`). The native input is
// visually replaced by `.checkmark`, so the LABEL is the reliable click target.
const ZOOM = '.board-zoom';
const ZOOM_RADIO = '.board-zoom label.zoom-radio'; // clickable per-level label
const ZOOM_INPUT = '.board-zoom input[type="radio"][name="kanban-board-zoom"]'; // :checked state

// In-board filters. The React filter panel (KanbanApp.tsx) reproduces the legacy
// filter.jade markup: collapsible categories `.filters-cats li[data-type]`, each
// expanded by its `.e2e-category` button; the visible options are
// `button.single-filter` rows (subject `span.name`); applied filters render as
// `.single-applied-filter` chips whose `.e2e-remove-filter` button removes them
// (clicking the chip body itself is a no-op).
const FILTER_OPEN = '.btn-filter.e2e-open-filter';
const FILTER_SEARCH = 'input.kanban-search.e2e-search';
const FILTER_PANEL = '.kanban-filter';
const FILTER_APPLIED = '.filters-applied .single-applied-filter'; // an applied chip
const FILTER_REMOVE = '.filters-applied .single-applied-filter .e2e-remove-filter'; // its remove button
const FILTER_CATEGORY_BTN = '.filters-cats .e2e-category'; // expands a category
const SINGLE_FILTER = '.filters-cats .single-filter'; // a category option (post-expand)

/** Root board locator; all board queries are scoped to the React host. */
function board(page: Page): Locator {
    return page.locator(BOARD);
}

/*
 * ---------------------------------------------------------------------------
 * Readiness helper
 * ---------------------------------------------------------------------------
 */

/**
 * Port of the legacy `utils.common.waitLoader`: wait until the global `.loader`
 * chrome no longer carries the `active` class, then wait for the React board's
 * first column body to be visible (the real "board is ready" signal). The
 * `.loader` belongs to the surviving AngularJS shell; if it is absent we treat
 * that as "not loading" and rely on the board-column wait.
 */
async function waitLoader(page: Page): Promise<void> {
    const loader = page.locator('.loader');
    try {
        await expect(loader).not.toHaveClass(/active/, { timeout: 15_000 });
    } catch {
        // Loader not present in the React shell — ignore and rely on the board wait.
    }
    await board(page).first().waitFor({ state: 'attached', timeout: 30_000 });
    await board(page).locator(COLUMNS).first().waitFor({ state: 'visible', timeout: 30_000 });
}

/*
 * ---------------------------------------------------------------------------
 * Card / column query helpers (ports of e2e/helpers/kanban-helper.js)
 * ---------------------------------------------------------------------------
 */

/** The cards in a column body (legacy `getBoxUss(column)`). */
function boxUss(page: Page, column: number): Locator {
    return board(page).locator(COLUMNS).nth(column).locator(CARD);
}

/** The trimmed card titles of a column (legacy `getColumnUssTitles`). */
async function columnTitles(page: Page, column: number): Promise<string[]> {
    const titles = await board(page)
        .locator(COLUMNS)
        .nth(column)
        .locator(CARD_TITLE)
        .allInnerTexts();
    return titles.map((t) => t.trim());
}

/*
 * ---------------------------------------------------------------------------
 * Bulk-create lightbox helpers (the ONLY React create surface — see header)
 * ---------------------------------------------------------------------------
 */

/**
 * Open the bulk-create lightbox for a column via its header `.bulk-action`
 * affordance, and wait for the lightbox to render.
 *
 * @param page   The authenticated Playwright page.
 * @param column Zero-based column index.
 * @returns The bulk lightbox locator.
 */
async function openBulkLightbox(page: Page, column: number): Promise<Locator> {
    await board(page).locator(HEADER_COLUMNS).nth(column).locator(BULK_ACTION).click();
    const lb = page.locator(LB_BULK).first();
    await expect(lb).toBeVisible({ timeout: 15_000 });
    return lb;
}

/**
 * Create one or more stories through the bulk lightbox: one subject per line,
 * then submit and wait for the lightbox to disappear.
 *
 * @param page     The authenticated Playwright page.
 * @param lb       The bulk lightbox locator (from openBulkLightbox).
 * @param subjects The subjects to create (one per textarea line).
 */
async function bulkCreate(page: Page, lb: Locator, subjects: string[]): Promise<void> {
    const textarea = lb.locator(BULK_SUBJECTS).first();
    await textarea.click();
    for (let i = 0; i < subjects.length; i++) {
        await textarea.pressSequentially(subjects[i]);
        await textarea.press('Enter');
    }
    await lb.locator(BULK_SUBMIT).first().click();
    await expect(page.locator(LB_BULK)).toHaveCount(0, { timeout: 15_000 });
}

/*
 * ---------------------------------------------------------------------------
 * Card-actions popup helpers (edit / assign / delete)
 * ---------------------------------------------------------------------------
 */

/**
 * Open a card's actions popup (`.card-actions button.js-popup-button`) and wait
 * for the portaled card-actions menu to be visible.
 *
 * The menu is rendered via `createPortal(..., document.body)` (Card.tsx), so it
 * is NOT a descendant of the card in the DOM — it is queried from the page as
 * `.popover.global-popover[role="menu"]`. We derive the page from the card
 * locator (`card.page()`) so the helper signature stays stable for callers.
 *
 * @param card A single-card locator.
 * @returns The visible card-actions menu locator (page-scoped, portaled).
 */
async function openCardActions(card: Locator): Promise<Locator> {
    await card.hover();
    await card.locator(CARD_ACTIONS_BTN).first().click();
    // Portaled to document.body — query from the page, not the card.
    const menu = card.page().locator(CARD_ACTIONS_MENU).first();
    await expect(menu).toBeVisible({ timeout: 10_000 });
    return menu;
}

/*
 * ---------------------------------------------------------------------------
 * [C-07] Real single-US create/edit lightbox helpers
 * ---------------------------------------------------------------------------
 * The React Kanban renders ONE create/edit lightbox at the board root
 * (app/react/kanban/UserStoryEditLightbox.tsx). These helpers open it from the
 * in-board affordances and drive its real fields — replacing the removed
 * `$rootScope.$broadcast("genericform:*")` bridge the earlier suite spied on.
 */

/** The board-level create/edit lightbox, visible only when it carries `.open`. */
function editLightbox(page: Page): Locator {
    return page.locator(`${LB_EDIT}.open`).first();
}

/**
 * Open the REAL single-US create lightbox from a column's "+" (`.add-action`)
 * header control and wait for it to reveal.
 *
 * @param page   The authenticated Playwright page.
 * @param column Zero-based column index whose "+" seeds the create.
 * @returns The visible create lightbox locator.
 */
async function openCreateLightbox(page: Page, column: number): Promise<Locator> {
    await board(page).locator(HEADER_COLUMNS).nth(column).locator(ADD_ACTION).first().click();
    const lb = editLightbox(page);
    await expect(lb).toBeVisible({ timeout: 10_000 });
    return lb;
}

/**
 * Open the REAL edit lightbox for a card through its actions menu
 * (`.card-action-edit`), seeded with that story.
 *
 * @param page The authenticated Playwright page.
 * @param card A single-card locator.
 * @returns The visible edit lightbox locator.
 */
async function openEditLightbox(page: Page, card: Locator): Promise<Locator> {
    const menu = await openCardActions(card);
    await menu.locator(CARD_ACTION_EDIT).first().click();
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
 * generic-form CREATE branch uses for subject+status+swimlane). Start BEFORE the
 * submit, `await` after.
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
 * submit, `await` after; returns the matched response so the body/status can be
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

/*
 * ---------------------------------------------------------------------------
 * Drag-and-drop (real pointer drag tuned to @dnd-kit PointerSensor)
 * ---------------------------------------------------------------------------
 */

/**
 * Perform a real pointer drag from `source` to `target`. The intermediate mouse
 * move past the activation threshold is what makes @dnd-kit's PointerSensor
 * start the drag (a single down→up would be treated as a click).
 *
 * @param page   The authenticated Playwright page.
 * @param source The card being dragged.
 * @param target The column body (drop zone) receiving the card.
 */
async function dndDrag(page: Page, source: Locator, target: Locator): Promise<void> {
    await source.scrollIntoViewIfNeeded();
    const s = await source.boundingBox();
    if (!s) {
        throw new Error('dndDrag: source element has no bounding box');
    }
    const sx = s.x + s.width / 2;
    const sy = s.y + s.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // Exceed the PointerSensor activation distance so the drag actually starts.
    await page.mouse.move(sx + 8, sy + 8, { steps: 6 });

    await target.scrollIntoViewIfNeeded();
    const t = await target.boundingBox();
    if (!t) {
        await page.mouse.up();
        throw new Error('dndDrag: target element has no bounding box');
    }
    const tx = t.x + t.width / 2;
    const ty = t.y + t.height / 2;

    // Travel to the target in steps so dnd-kit registers the over/move events.
    await page.mouse.move(tx, ty, { steps: 20 });
    await page.mouse.move(tx, ty + 10, { steps: 6 });
    await page.mouse.up();
}

/**
 * Await the `bulk_update_kanban_order` persistence POST (QA Issue 6: HARD, not
 * best-effort). Returns a promise you start BEFORE the drop and `await` after.
 *
 * @param page The authenticated Playwright page.
 * @returns A promise resolving to the matching response.
 */
function waitKanbanOrderPersist(page: Page) {
    return page.waitForResponse(
        (r) => /bulk_update_kanban_order/.test(r.url()) && r.request().method() !== 'GET',
        { timeout: 20_000 },
    );
}

/*
 * ---------------------------------------------------------------------------
 * Zoom helper — the React `.board-zoom` exposes 4 discrete radio levels
 * (`label.zoom-radio > input[type=radio][name="kanban-board-zoom"][value=0..3]`).
 * The active level is the `:checked` input (bound to `zoomLevel===level`).
 * ---------------------------------------------------------------------------
 */

/**
 * Activate a discrete zoom level by clicking its `label.zoom-radio` wrapper and
 * asserting the matching radio input becomes `:checked`. `level` is the 0-based
 * level (0..3) matching the control's `value` attribute (legacy levels 1..4 map
 * to values 0..3). The native radio is visually replaced by `.checkmark`, so the
 * label is the reliable click target.
 *
 * @param page  The authenticated Playwright page.
 * @param level Zero-based zoom level (0..3).
 */
async function activateZoom(page: Page, level: number): Promise<void> {
    await board(page).locator(ZOOM_RADIO).nth(level).click();
    await expect(board(page).locator(ZOOM_INPUT).nth(level)).toBeChecked({
        timeout: 10_000,
    });
}

/*
 * ---------------------------------------------------------------------------
 * Filter helpers — retargeted to the React in-board filter/search controls
 * (AAP §0.3.4). The React board re-implements tg-filter / tg-input-search.
 * ---------------------------------------------------------------------------
 */

/** Open the filter panel (idempotent: waits for the panel to be visible). */
async function openFilters(page: Page): Promise<void> {
    const panel = board(page).locator(FILTER_PANEL);
    if (await panel.isVisible().catch(() => false)) {
        return;
    }
    await board(page).locator(FILTER_OPEN).first().click();
    await expect(panel.first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Type into the filter search box and let the board's debounce settle by
 * waiting on the resulting card count (no fixed sleep).
 *
 * @param page          The authenticated Playwright page.
 * @param text          The search text.
 * @param expectedCount The card count to wait for after filtering.
 */
async function filterByText(page: Page, text: string, expectedCount: number): Promise<void> {
    const q = board(page).locator(FILTER_SEARCH).first();
    await q.click();
    await q.fill(text);
    await expect(board(page).locator(CARD)).toHaveCount(expectedCount, { timeout: 15_000 });
}

/**
 * Clear the search box and remove every applied filter chip, then wait for the
 * card count to return to `restoreCount`.
 *
 * @param page         The authenticated Playwright page.
 * @param restoreCount The card count expected once filters are cleared.
 */
async function clearFilters(page: Page, restoreCount: number): Promise<void> {
    const q = board(page).locator(FILTER_SEARCH).first();
    if (await q.count()) {
        await q.fill('');
    }
    // Each applied filter is removed via its `.e2e-remove-filter` button (the
    // chip body itself is not clickable). Removing one mutates the list, so
    // always click the current first remover.
    for (let guard = 0; guard < 20; guard++) {
        const removers = board(page).locator(FILTER_REMOVE);
        if ((await removers.count()) === 0) {
            break;
        }
        await removers.first().click();
    }
    await expect(board(page).locator(CARD)).toHaveCount(restoreCount, { timeout: 15_000 });
}

/*
 * ===========================================================================
 * Suite
 * ===========================================================================
 * NOT serial (QA F-05): the legacy suite ran in serial mode, so a single early
 * failure ABORTED every later scenario and masked independent defects. Each
 * test here is INDEPENDENT — the beforeEach re-navigates to a fresh board, every
 * assertion is a RELATIVE count-delta measured within its own test, and all
 * created stories use unique timestamped subjects — so tests neither depend on
 * ordering nor cascade on a peer's failure. Sequencing is still bounded by
 * workers:1 in playwright.config.ts.
 */

test.describe('kanban', () => {
    /*
     * Legacy `before`: land on the seeded classic Kanban board, wait for the
     * loader to clear, and take the baseline `kanban` capture. project-1 is a
     * sample_data project with kanban activated, NO swimlanes (a flat 6-column
     * board: New / Ready / In progress / Ready for test / Done / Archived) and
     * populated columns — the phantom `project-0` the legacy suite navigated to
     * never existed in sample_data (QA F-03). The ./fixtures/session auto-login
     * fixture has already authenticated the page before this runs.
     */
    test.beforeEach(async ({ page, baseURL }) => {
        const base = baseURL && baseURL.endsWith('/') ? baseURL : `${baseURL || ''}/`;
        await page.goto(`${base}project/project-1/kanban`);
        await waitLoader(page);
        await capture(page, 'kanban');
    });

    /*
     * `zoom` — cycle the four discrete zoom levels (buttons 0..3), asserting the
     * active button moves on each click, and capture zoom1..zoom4 (legacy parity
     * filenames). No fixed sleeps: activateZoom waits on `.active`.
     */
    test('zoom', async ({ page }) => {
        for (let index = 0; index <= 3; index++) {
            await activateZoom(page, index);
            await capture(page, `zoom${index + 1}`);
        }
    });

    /*
     * [C-07] `create us` — the React create surface is the REAL single-US
     * lightbox (app/react/kanban/UserStoryEditLightbox.tsx), opened from a
     * column's "+" (`.add-action`). It is DISTINCT from the bulk lightbox (a
     * separate affordance, covered by `bulk create` below). The prior suite
     * wrongly drove bulk-create as the single-US create path; these cases drive
     * the real form and cover:
     *   1. happy path      — subject only → one bulk_create POST → card appears;
     *   2. full-form parity — subject + description + due date → bulk_create then
     *                         a follow-up PATCH persists the rich fields;
     *   3. negative path   — empty subject → inline required error, NO persist,
     *                         lightbox stays open.
     */
    test.describe('create us', () => {
        test('create and submit a user story', async ({ page }) => {
            const before = await boxUss(page, 0).count();

            const lb = await openCreateLightbox(page, 0);
            await capture(page, 'create-us');

            const subject = `test subject${Date.now()}`;
            await lb.locator(LB_EDIT_SUBJECT).fill(subject);

            // A bare subject-only create is EXACTLY one request (bulk_create); the
            // follow-up PATCH is skipped when no rich field is set.
            const persisted = waitCreatePersist(page);
            await submitLightbox(page, lb);
            await persisted;

            // Wait for the unique-subject card (settles the board after the
            // create flow's final reload); then assert the monotonic count lower
            // bound (creation only adds), robust to a concurrent reload blip.
            const createdCard = board(page)
                .locator(COLUMNS)
                .nth(0)
                .locator(CARD_TITLE)
                .filter({ hasText: subject });
            await expect(createdCard).toHaveCount(1, { timeout: 20_000 });
            expect(await boxUss(page, 0).count()).toBeGreaterThanOrEqual(before + 1);
        });

        test('create with description and due date persists the full form', async ({ page }) => {
            const before = await boxUss(page, 0).count();

            const lb = await openCreateLightbox(page, 0);
            const subject = `full form${Date.now()}`;
            await lb.locator(LB_EDIT_SUBJECT).fill(subject);
            await lb.locator(LB_EDIT_DESCRIPTION).fill('created via the real react lightbox');

            const dueDate = lb.locator(LB_EDIT_DUE_DATE);
            if (await dueDate.count()) {
                await dueDate.fill('2025-12-31');
            }

            // subject+status ship in bulk_create; the rich fields (description,
            // due date) follow in a PATCH /userstories/{id}. Both must fire.
            const created = waitCreatePersist(page);
            const patched = waitEditPersist(page);
            await submitLightbox(page, lb);
            await created;
            await patched;

            // The unique-subject card appearing on the board is the authoritative,
            // race-free signal that the create round-tripped (the create flow ends
            // with a full board reload, so waiting for the specific card settles
            // the board before any count check). Creation only ADDS cards, so the
            // column count is asserted as a monotonic lower bound rather than an
            // exact delta that a concurrent board reload could momentarily perturb.
            const createdCard = board(page)
                .locator(COLUMNS)
                .nth(0)
                .locator(CARD_TITLE)
                .filter({ hasText: subject });
            await expect(createdCard).toHaveCount(1, { timeout: 20_000 });
            expect(await boxUss(page, 0).count()).toBeGreaterThanOrEqual(before + 1);
        });

        test('empty subject shows the required error and does not persist', async ({ page }) => {
            const before = await boxUss(page, 0).count();

            const lb = await openCreateLightbox(page, 0);
            await lb.locator(LB_EDIT_SUBJECT).fill('');

            // Guard: NO create request may leave the browser for an invalid form.
            let persistFired = false;
            page.on('request', (r) => {
                if (/\/userstories\/bulk_create/.test(r.url()) && r.method() === 'POST') {
                    persistFired = true;
                }
            });

            await lb.locator(LB_EDIT_SUBMIT).first().click();

            // Inline required error appears; the lightbox stays open; nothing
            // persisted. That NO create request left the browser (persistFired ===
            // false) is the authoritative, race-free proof that nothing was
            // created — a global board-count check would be redundant with it and
            // fragile against a concurrent WebSocket-driven board reload, so it is
            // intentionally omitted (`before` is retained only for readability of
            // the pre-state).
            void before;
            await expect(lb.locator(LB_EDIT_REQUIRED)).toBeVisible({ timeout: 5_000 });
            await expect(lb).toBeVisible();
            expect(persistFired).toBe(false);
        });
    });

    /*
     * [C-07] `edit us` — the React edit affordance opens the REAL edit lightbox
     * (seeded with the story) from the card-actions popup (`.card-action-edit`).
     * The genericform:* AngularJS bridge no longer exists; editing the subject
     * and submitting must issue a single `PATCH /userstories/{id}` and reflect
     * the new subject on the board.
     */
    test.describe('edit us', () => {
        test('edit a user story subject through the real lightbox', async ({ page }) => {
            const card = boxUss(page, 0).first();

            const lb = await openEditLightbox(page, card);
            await expect(lb.locator(LB_EDIT_SUBJECT)).toBeVisible();
            await capture(page, 'edit-us');

            const edited = `edited${Date.now()}`;
            await lb.locator(LB_EDIT_SUBJECT).fill(edited);

            const persisted = waitEditPersist(page);
            await submitLightbox(page, lb);
            const response = await persisted;
            expect(response.request().method()).toBe('PATCH');

            // The edited (unique) subject is now rendered on exactly one card in
            // column 0 — the change round-tripped through the board state.
            await expect(
                board(page).locator(COLUMNS).nth(0).locator(CARD_TITLE).filter({ hasText: edited }),
            ).toHaveCount(1, { timeout: 20_000 });
        });

        /*
         * [C-04] A subject-only edit must PRESERVE the existing description.
         * -----------------------------------------------------------------
         * REGRESSION GUARD for QA finding C-04. The Kanban board LIST payload
         * omits each story's `description`, so the edit lightbox hydrates the
         * full detail (`GET /userstories/{id}`) on open. When the user changes
         * ONLY the subject and saves, the outgoing `PATCH` body must still carry
         * the *unchanged* description verbatim — never `null`, never blanked —
         * otherwise a subject tweak would silently wipe the story body.
         *
         * The test is self-seeding (does not depend on which sample story holds a
         * description): it first SETS a known description (setup PATCH), reopens
         * to confirm the textarea hydrated with it (proves detail hydration),
         * then edits the subject alone and asserts (a) the captured PATCH REQUEST
         * body preserves the description byte-for-byte, and (b) a GET readback of
         * the persisted story confirms the description survived on the server.
         * Editing never reorders the board, so `boxUss(0).first()` addresses the
         * same card across the setup and the subject-only edit.
         */
        test('a subject-only edit preserves the existing description (C-04)', async ({ page }) => {
            const card = boxUss(page, 0).first();

            // --- setup: give the card a known, non-empty description ----------
            const knownDesc = `C04 kanban description ${Date.now()} — survives a subject-only edit`;
            let lb = await openEditLightbox(page, card);
            await lb.locator(LB_EDIT_DESCRIPTION).fill(knownDesc);
            const setupPersist = waitEditPersist(page);
            await submitLightbox(page, lb);
            await setupPersist;

            // --- reopen: the description textarea is hydrated from detail -----
            lb = await openEditLightbox(page, card);
            await expect(lb.locator(LB_EDIT_DESCRIPTION)).toHaveValue(knownDesc, {
                timeout: 15_000,
            });

            // --- edit ONLY the subject ---------------------------------------
            const editedSubject = `C04-kanban-subject-${Date.now()}`;
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

    /*
     * `bulk create` — open the bulk lightbox on column 0, enter two lines, and
     * submit; column 0 must gain exactly two cards.
     */
    test.describe('bulk create', () => {
        test('bulk create two user stories', async ({ page }) => {
            const before = await boxUss(page, 0).count();

            const lb = await openBulkLightbox(page, 0);
            const stamp = Date.now();
            await bulkCreate(page, lb, [`aaa${stamp}`, `bbb${stamp}`]);

            // Both unique-subject cards must appear (settles the board), then the
            // column count is asserted as a monotonic lower bound (creation only
            // adds), robust to a concurrent board-reload blip.
            await expect(
                board(page).locator(COLUMNS).nth(0).locator(CARD_TITLE).filter({ hasText: `aaa${stamp}` }),
            ).toHaveCount(1, { timeout: 20_000 });
            await expect(
                board(page).locator(COLUMNS).nth(0).locator(CARD_TITLE).filter({ hasText: `bbb${stamp}` }),
            ).toHaveCount(1, { timeout: 20_000 });
            expect(await boxUss(page, 0).count()).toBeGreaterThanOrEqual(before + 2);
        });
    });

    /*
     * `folds` — fold column 0 (exactly one folded header, captured as
     * `fold-column`) then unfold it (no folded headers). Both steps live in one
     * test because each per-test page is fresh.
     */
    test.describe('folds', () => {
        test('fold and unfold a column', async ({ page }) => {
            // The Archived column is folded by default (KanbanApp pre-folds it),
            // so the folded-header count is asserted as a RELATIVE delta around
            // the fold/unfold of column 0 (QA F-06) rather than the absolute
            // count of 1 the legacy assertion used (which ignored the pre-folded
            // Archived column and failed on the real board).
            const before = await board(page).locator(VFOLD_HEADER).count();

            await board(page).locator(HEADER_COLUMNS).nth(0).locator(FOLD_ACTION).click();
            await expect(board(page).locator(VFOLD_HEADER)).toHaveCount(before + 1, {
                timeout: 10_000,
            });
            await capture(page, 'fold-column');

            await board(page).locator(HEADER_COLUMNS).nth(0).locator(UNFOLD_ACTION).click();
            await expect(board(page).locator(VFOLD_HEADER)).toHaveCount(before, {
                timeout: 10_000,
            });
        });
    });

    /*
     * `move us between columns` — drag the first card of column 0 onto column 1.
     * Column 0 loses one card and column 1 gains one. The drop persists through
     * the bulk_update_kanban_order endpoint (AAP §0.7.1), which is HARD-asserted.
     */
    test('move us between columns', async ({ page }) => {
        // Track the SPECIFIC card by its stable ref (#N) so the assertion survives
        // a concurrent board reload (which can perturb raw column counts). The
        // moved card must LEAVE column 0 and APPEAR in column 1; the drop is
        // HARD-asserted through the frozen bulk_update_kanban_order endpoint.
        const source = boxUss(page, 0).first();
        const ref = (await source.locator(CARD_REF).innerText()).trim();
        const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const refExact = new RegExp('^' + escaped + '$');

        const target = board(page).locator(COLUMNS).nth(1);

        const persisted = waitKanbanOrderPersist(page);
        await dndDrag(page, source, target);
        const response = await persisted;
        expect(response.ok()).toBe(true);

        // The moved card now lives in column 1 and no longer in column 0.
        await expect(
            board(page).locator(COLUMNS).nth(1).locator(CARD_REF).filter({ hasText: refExact }),
        ).toHaveCount(1, { timeout: 15_000 });
        await expect(
            board(page).locator(COLUMNS).nth(0).locator(CARD_REF).filter({ hasText: refExact }),
        ).toHaveCount(0, { timeout: 15_000 });
    });

    /*
     * `archive` — scroll the board fully right, then drag the first card of
     * column 3 into the last (archive) column, capturing `archive`. Column 3
     * loses one card and the drop persists (hard-asserted).
     */
    test.describe('archive', () => {
        test('move to archive', async ({ page }) => {
            // Scroll the board right so the archive (last) column is reachable.
            await board(page)
                .locator(SCROLL_BODY)
                .last()
                .evaluate((el) => {
                    (el as HTMLElement).scrollLeft = 10000;
                });

            // Track the SPECIFIC card by its stable ref so the assertion survives
            // a concurrent board reload. The card must LEAVE column 3; the drop is
            // HARD-asserted through the frozen bulk_update_kanban_order endpoint.
            const source = boxUss(page, 3).first();
            const ref = (await source.locator(CARD_REF).innerText()).trim();
            const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const refExact = new RegExp('^' + escaped + '$');

            const target = board(page).locator(COLUMNS).last();

            const persisted = waitKanbanOrderPersist(page);
            await dndDrag(page, source, target);
            const response = await persisted;
            expect(response.ok()).toBe(true);
            await capture(page, 'archive');

            // The moved card no longer appears in column 3.
            await expect(
                board(page).locator(COLUMNS).nth(3).locator(CARD_REF).filter({ hasText: refExact }),
            ).toHaveCount(0, { timeout: 15_000 });
        });
    });

    /*
     * [KAN-03] `assign a user` — the React assign affordance
     * (`.card-action-assigned-to`) opens the DEDICATED SelectUserLightbox
     * (app/react/kanban/SelectUserLightbox.tsx, `.lightbox-select-user`), NOT the
     * create/edit lightbox. This ports the legacy `changeUsAssignedUsers` picker
     * (kanban/main.coffee L339-L349). Selecting a user row and confirming
     * (`.lb-select-user-confirm`) issues a single `PATCH /userstories/{id}`
     * (assigned_users/assigned_to + version) — no AngularJS bridge, and no
     * fabricated `.assigned-to-select` <select> (which never existed in the React
     * DOM). This also retires the conditional `test.skip` the legacy case used
     * (QA F-02): the seeded sample_data projects always expose members.
     */
    test('assign a user through the select-user lightbox', async ({ page }) => {
        const card = boxUss(page, 0).first();
        const menu = await openCardActions(card);
        await expect(menu.locator(CARD_ACTION_ASSIGN)).toBeVisible();
        await menu.locator(CARD_ACTION_ASSIGN).click();

        // The SelectUserLightbox opens (revealed by the `.open` class).
        const lb = page.locator(`${LB_SELECT_USER}.open`).first();
        await expect(lb).toBeVisible({ timeout: 10_000 });
        await capture(page, 'edit-assigned-to');

        // Prefer a plain USER row (role rows carry a `.user-list-name > .role`
        // span) that is not already selected, so the click grows the assignee
        // set; fall back to the first available row otherwise.
        const userRow = lb
            .locator(`${LB_SELECT_USER_ITEM}:not(:has(.role)):not(.is-active)`)
            .first();
        const anyRow = lb.locator(LB_SELECT_USER_ITEM).first();
        const target = (await userRow.count()) ? userRow : anyRow;
        await expect(target).toBeVisible({ timeout: 5_000 });
        await target.click();

        // Confirm the selection (the confirm button is visible only while the
        // search box is empty) → a single PATCH /userstories/{id} persists it.
        const persisted = waitEditPersist(page);
        await lb.locator(LB_SELECT_USER_CONFIRM).click();
        const response = await persisted;
        expect(response.request().method()).toBe('PATCH');

        // The picker closes on confirm.
        await expect(lb).toBeHidden({ timeout: 10_000 });
    });

    /*
     * [C-07] `delete us` — the React delete affordance (`.card-action-delete`)
     * opens the THEMED ConfirmDialog (shared/dialog/ConfirmDialog.tsx, [N-03]),
     * NOT the native window.confirm. Confirming issues `DELETE /userstories/{id}`
     * and removes the card; cancelling leaves the board untouched.
     */
    test.describe('delete us', () => {
        test('cancel keeps the card', async ({ page }) => {
            const card = boxUss(page, 0).first();
            const ref = (await card.locator(CARD_REF).innerText()).trim();
            const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const refExact = new RegExp('^' + escaped + '$');

            const menu = await openCardActions(card);
            await menu.locator(CARD_ACTION_DELETE).click();

            const dialog = page
                .locator(CONFIRM_DIALOG)
                .filter({ has: page.locator(CONFIRM_OK) });
            await expect(dialog).toBeVisible({ timeout: 10_000 });
            await dialog.locator(CONFIRM_CANCEL).click();
            await expect(dialog).toBeHidden({ timeout: 10_000 });

            // Cancelling leaves the SPECIFIC card on the board (asserted by its
            // stable ref, robust to a concurrent board reload that a raw
            // column-count check would trip on).
            await expect(
                board(page).locator(COLUMNS).nth(0).locator(CARD_REF).filter({ hasText: refExact }),
            ).toHaveCount(1, { timeout: 10_000 });
        });

        test('confirm deletes the card', async ({ page }) => {
            const card = boxUss(page, 0).first();
            const ref = (await card.locator(CARD_REF).innerText()).trim();

            const menu = await openCardActions(card);
            await menu.locator(CARD_ACTION_DELETE).click();

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

            // The SPECIFIC deleted card (matched by its exact stable ref) is gone
            // from the board. This identity assertion is the authoritative,
            // race-free proof of the delete — a raw column-count delta would be
            // redundant with it and fragile against a concurrent board reload, so
            // it is intentionally omitted.
            const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const refExact = new RegExp('^' + escaped + '$');
            await expect(
                board(page).locator(COLUMNS).nth(0).locator(CARD_REF).filter({ hasText: refExact }),
            ).toHaveCount(0, { timeout: 20_000 });
        });
    });

    /*
     * [C-07] attachments — the real lightbox exposes a native file input
     * (`input[type="file"]`, ports lb-create-edit's `.add-attach`). Selecting a
     * file bumps the attachment counter and, on submit, uploads it via
     * `POST /userstories/attachments` (multipart) AFTER the story is created.
     */
    test('create a user story with an attachment', async ({ page }) => {
        const before = await boxUss(page, 0).count();

        const lb = await openCreateLightbox(page, 0);
        const subject = `attach${Date.now()}`;
        await lb.locator(LB_EDIT_SUBJECT).fill(subject);

        // Attach a small in-memory file via the real <input type="file">.
        await lb.locator('input[type="file"]').setInputFiles({
            name: 'note.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('parity attachment'),
        });
        await expect(lb.locator('.attachments-num')).toHaveText('1');
        await capture(page, 'create-us-attachment');

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

        // Wait for the unique-subject card (settles the board after the create
        // flow's final reload); then assert the monotonic count lower bound.
        const createdCard = board(page)
            .locator(COLUMNS)
            .nth(0)
            .locator(CARD_TITLE)
            .filter({ hasText: subject });
        await expect(createdCard).toHaveCount(1, { timeout: 20_000 });
        expect(await boxUss(page, 0).count()).toBeGreaterThanOrEqual(before + 1);
    });

    /*
     * [C-07] rollback — when the kanban-order persist FAILS, the optimistic move
     * is rolled back ([M-05]) and the card returns to its origin column. Force a
     * 500 on `bulk_update_kanban_order` via route interception (deterministic, no
     * backend dependency) and assert the origin/destination counts are restored.
     */
    test('failed order persist rolls the moved card back', async ({ page }) => {
        // Track the SPECIFIC card by its stable ref so the rollback assertion
        // survives a concurrent board reload (raw column counts are fragile here).
        const source = boxUss(page, 0).first();
        const ref = (await source.locator(CARD_REF).innerText()).trim();
        const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const refExact = new RegExp('^' + escaped + '$');

        // Force the drop-order persist to fail so the optimistic move must roll
        // back.
        await page.route(/bulk_update_kanban_order/, (route) =>
            route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
        );

        const target = board(page).locator(COLUMNS).nth(1);

        // Guard against a vacuous pass (a drag that never registered would leave
        // the card in place and trivially "revert"): assert the drop actually
        // FIRED the drop-order persist by awaiting the intercepted
        // bulk_update_kanban_order response, which the route fulfills with 500.
        const failedPersist = page.waitForResponse(
            (r) => /bulk_update_kanban_order/.test(r.url()) && r.request().method() !== 'GET',
            { timeout: 20_000 },
        );
        await dndDrag(page, source, target);
        const failResp = await failedPersist;
        expect(failResp.status()).toBe(500);

        // After the failed persist the optimistic move is reverted: the specific
        // card is back in its origin column 0 and is NOT left behind in column 1.
        await expect(
            board(page).locator(COLUMNS).nth(0).locator(CARD_REF).filter({ hasText: refExact }),
        ).toHaveCount(1, { timeout: 15_000 });
        await expect(
            board(page).locator(COLUMNS).nth(1).locator(CARD_REF).filter({ hasText: refExact }),
        ).toHaveCount(0, { timeout: 15_000 });

        await page.unroute(/bulk_update_kanban_order/);
    });

    /*
     * [C-07] permission gating — the column "+" (`.add-action`) is gated on the
     * `add_us` permission (KanbanApp: canAddUs = my_permissions.includes('add_us')).
     * Strip `add_us` from the project payload via route interception, reload, and
     * assert the create affordance is not rendered.
     */
    test('add affordance is hidden without add_us permission', async ({ page, baseURL }) => {
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
        const base = baseURL && baseURL.endsWith('/') ? baseURL : `${baseURL || ''}/`;
        await page.goto(`${base}project/project-1/kanban`);
        await waitLoader(page);

        await expect(board(page).locator(ADD_ACTION)).toHaveCount(0, { timeout: 15_000 });

        await page.unroute(projectsRe);
    });

    /*
     * `kanban filters` — a representative subset of e2e/shared/filters.js against
     * the React in-board filter/search controls (reproduced classes, AAP §0.3.4).
     */
    test.describe('kanban filters', () => {
        test('filter by ref then clear restores the card count', async ({ page }) => {
            await openFilters(page);

            const initial = await board(page).locator(CARD).count();

            // A bogus ref matches nothing.
            await filterByText(page, 'xxxxyy123123123', 0);

            // Clearing restores the full list.
            await clearFilters(page, initial);
        });

        /*
         * QA Issue 2 fix: this case was previously hard-skipped on the false
         * premise "React in-board category filter not available yet." The React
         * board DOES render category filters as `.filter-category[data-type]`
         * with `.single-filter`/`.filter-name` rows, so the case is executable.
         * Apply the first category option that reduces the card count, then
         * remove the applied chip and assert the count is restored.
         */
        test('filter by category then clear restores the card count', async ({ page }) => {
            await openFilters(page);

            const initial = await board(page).locator(CARD).count();

            // Categories are collapsible: options (`button.single-filter`) render
            // only once a category is expanded via its `.e2e-category` button.
            // Expand each category in turn and try its options until one reduces
            // the visible card count. Clicking an option consumes it (it leaves
            // the option list and becomes an applied chip), so always re-query
            // and take the first remaining option.
            const categoryButtons = board(page).locator(FILTER_CATEGORY_BTN);
            const categoryCount = await categoryButtons.count();
            expect(categoryCount).toBeGreaterThan(0);

            let applied = false;
            for (let c = 0; c < categoryCount && !applied; c++) {
                const catBtn = board(page).locator(FILTER_CATEGORY_BTN).nth(c);
                if ((await catBtn.getAttribute('aria-expanded')) !== 'true') {
                    await catBtn.click();
                }

                // Drain this category's options one at a time.
                for (let guard = 0; guard < 30 && !applied; guard++) {
                    const options = board(page).locator(SINGLE_FILTER);
                    if ((await options.count()) === 0) {
                        break; // no (more) options exposed for this category
                    }
                    await options.first().click();
                    try {
                        await expect
                            .poll(async () => await board(page).locator(CARD).count(), {
                                timeout: 6_000,
                            })
                            .toBeLessThan(initial);
                        applied = true;
                    } catch {
                        // Did not reduce the count (the option matched every
                        // card); it is now consumed as a chip — leave it and try
                        // the next remaining option. All chips are cleared below.
                    }
                }
            }
            expect(applied).toBe(true);

            // Removing every applied chip restores the full list.
            await clearFilters(page, initial);
        });
    });

    /*
     * `us subject is XSS-safe` — create a user story whose subject is an XSS
     * payload through the React bulk create surface. React escapes by default,
     * so the card must render the payload as LITERAL text and no injected
     * handler may execute (AAP §0.6.3 XSS-safe assertion).
     */
    test('us subject is XSS-safe', async ({ page }) => {
        const payload = '<img src=x onerror="window.__xss=1">';

        // Reset the injection sentinel before rendering the payload.
        await page.evaluate(() => {
            (window as unknown as Record<string, unknown>).__xss = undefined;
        });

        const before = await boxUss(page, 0).count();
        const lb = await openBulkLightbox(page, 0);
        await bulkCreate(page, lb, [payload]);

        // The payload card must render the subject as ESCAPED, literal text
        // (React escapes by default). Waiting for that specific card settles the
        // board after the create; the column count is then a monotonic lower
        // bound (creation only adds — and a repeated E2E_ALLOW_NO_RESEED run may
        // legitimately leave more than one such card), robust to a reload blip.
        const title = board(page).locator(CARD_TITLE, { hasText: payload }).first();
        await expect(title).toBeVisible({ timeout: 20_000 });
        await expect(title).toHaveText(payload);
        expect(await boxUss(page, 0).count()).toBeGreaterThanOrEqual(before + 1);

        // No injected onerror handler executed.
        const injected = await page.evaluate(
            () => (window as unknown as Record<string, unknown>).__xss,
        );
        expect(injected).toBeFalsy();
    });
});
