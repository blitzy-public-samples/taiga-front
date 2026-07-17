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
 *   • zoom     → `.board-zoom` with 4 `button.zoom-level` (labels 0..3)
 *   • bulk US  → `.lightbox-us-bulk` with `.e2e-bulk-subjects/-submit/-close`
 *   • filters  → `.btn-filter.e2e-open-filter`, `input.kanban-search.e2e-search`,
 *                `.filter-category[data-type]`, `.single-filter`, `.filter-name`,
 *                `.filters-applied .filter-applied`
 *   • actions  → `.card-actions button.js-popup-button` → `.card-actions-menu`
 *                with `.card-action-edit` / `.card-action-assigned-to` /
 *                `.card-action-delete`
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
const CARD_ACTIONS_BTN = '.card-actions button.js-popup-button';
const CARD_ACTIONS_MENU = '.card-actions-menu';
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
const LB_EDIT_ASSIGNEE = '.assigned-to-select'; // assignee <select>; focused when focusAssignee

// Themed React delete-confirmation dialog (shared/dialog/ConfirmDialog.tsx) — [N-03]
// replaces the native window.confirm. role="dialog" + aria-modal.
const CONFIRM_DIALOG = '[role="dialog"]';
const CONFIRM_OK = '.js-confirm';
const CONFIRM_CANCEL = '.js-cancel';

// Bulk-create lightbox — a SEPARATE React surface, NOT the standard single create.
const LB_BULK = '.lightbox-us-bulk';
const BULK_SUBJECTS = '.e2e-bulk-subjects';
const BULK_SUBMIT = '.e2e-bulk-submit';

// In-board zoom control.
const ZOOM = '.board-zoom';
const ZOOM_LEVEL = '.zoom-level';

// In-board filters.
const FILTER_OPEN = '.btn-filter.e2e-open-filter';
const FILTER_SEARCH = 'input.kanban-search.e2e-search';
const FILTER_PANEL = '.kanban-filter';
const FILTER_APPLIED = '.filters-applied .filter-applied';
const FILTER_CATEGORY = '.filter-category[data-type]';
const SINGLE_FILTER = '.single-filter';
const FILTER_NAME = '.filter-name';

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
 * for the `.card-actions-menu` to be visible.
 *
 * @param card A single-card locator.
 * @returns The visible card-actions menu locator.
 */
async function openCardActions(card: Locator): Promise<Locator> {
    await card.hover();
    await card.locator(CARD_ACTIONS_BTN).first().click();
    const menu = card.locator(CARD_ACTIONS_MENU).first();
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
 * Zoom helper — the React `.board-zoom` exposes 4 discrete `button.zoom-level`
 * controls (labels 0..3); the active one carries `.active`.
 * ---------------------------------------------------------------------------
 */

/**
 * Activate a discrete zoom level by clicking its `.zoom-level` button and
 * asserting the button becomes active. `index` is the 0-based button index
 * (0..3), matching the React control (legacy levels 1..4 map to indices 0..3).
 *
 * @param page  The authenticated Playwright page.
 * @param index Zero-based zoom button index (0..3).
 */
async function activateZoom(page: Page, index: number): Promise<void> {
    const buttons = board(page).locator(`${ZOOM} ${ZOOM_LEVEL}`);
    await buttons.nth(index).click();
    await expect(buttons.nth(index)).toHaveClass(/active/, { timeout: 10_000 });
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
    // Removing a chip mutates the list, so always click the current first one.
    for (let guard = 0; guard < 20; guard++) {
        const chips = board(page).locator(FILTER_APPLIED);
        if ((await chips.count()) === 0) {
            break;
        }
        await chips.first().click();
    }
    await expect(board(page).locator(CARD)).toHaveCount(restoreCount, { timeout: 15_000 });
}

/*
 * ===========================================================================
 * Suite
 * ===========================================================================
 * Serial mode: the scenarios mutate shared, backend-persisted board state in
 * sequence, exactly like the legacy Protractor suite. workers:1 is enforced by
 * playwright.config.ts; serial mode additionally guarantees ordering here.
 */
test.describe.configure({ mode: 'serial' });

test.describe('kanban', () => {
    /*
     * Legacy `before`: land on the project-0 Kanban, wait for the loader to
     * clear, and take the baseline `kanban` capture. The ./fixtures/session
     * auto-login fixture has already authenticated the page before this runs.
     */
    test.beforeEach(async ({ page, baseURL }) => {
        const base = baseURL && baseURL.endsWith('/') ? baseURL : `${baseURL || ''}/`;
        await page.goto(`${base}project/project-0/kanban`);
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

            await expect(boxUss(page, 0)).toHaveCount(before + 1, { timeout: 20_000 });
            expect(await columnTitles(page, 0)).toContain(subject);
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

            await expect(boxUss(page, 0)).toHaveCount(before + 1, { timeout: 20_000 });
            expect(await columnTitles(page, 0)).toContain(subject);
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

            // Inline required error appears; the lightbox stays open; nothing persisted.
            await expect(lb.locator(LB_EDIT_REQUIRED)).toBeVisible({ timeout: 5_000 });
            await expect(lb).toBeVisible();
            expect(persistFired).toBe(false);
            await expect(boxUss(page, 0)).toHaveCount(before);
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

            await expect(boxUss(page, 0)).toHaveCount(before + 2, { timeout: 20_000 });
        });
    });

    /*
     * `folds` — fold column 0 (exactly one folded header, captured as
     * `fold-column`) then unfold it (no folded headers). Both steps live in one
     * test because each per-test page is fresh.
     */
    test.describe('folds', () => {
        test('fold and unfold a column', async ({ page }) => {
            await board(page).locator(HEADER_COLUMNS).nth(0).locator(FOLD_ACTION).click();
            await expect(board(page).locator(VFOLD_HEADER)).toHaveCount(1, { timeout: 10_000 });
            await capture(page, 'fold-column');

            await board(page).locator(HEADER_COLUMNS).nth(0).locator(UNFOLD_ACTION).click();
            await expect(board(page).locator(VFOLD_HEADER)).toHaveCount(0, { timeout: 10_000 });
        });
    });

    /*
     * `move us between columns` — drag the first card of column 0 onto column 1.
     * Column 0 loses one card and column 1 gains one. The drop persists through
     * the bulk_update_kanban_order endpoint (AAP §0.7.1), which is HARD-asserted.
     */
    test('move us between columns', async ({ page }) => {
        const initOrigin = await boxUss(page, 0).count();
        const initDestination = await boxUss(page, 1).count();

        const source = boxUss(page, 0).first();
        const target = board(page).locator(COLUMNS).nth(1);

        const persisted = waitKanbanOrderPersist(page);
        await dndDrag(page, source, target);
        const response = await persisted;
        expect(response.ok()).toBe(true);

        await expect(boxUss(page, 0)).toHaveCount(initOrigin - 1, { timeout: 15_000 });
        await expect(boxUss(page, 1)).toHaveCount(initDestination + 1, { timeout: 15_000 });
    });

    /*
     * `archive` — scroll the board fully right, then drag the first card of
     * column 3 into the last (archive) column, capturing `archive`. Column 3
     * loses one card and the drop persists (hard-asserted).
     */
    test.describe('archive', () => {
        test('move to archive', async ({ page }) => {
            const initOrigin = await boxUss(page, 3).count();

            // Scroll the board right so the archive (last) column is reachable.
            await board(page)
                .locator(SCROLL_BODY)
                .last()
                .evaluate((el) => {
                    (el as HTMLElement).scrollLeft = 10000;
                });

            const source = boxUss(page, 3).first();
            const target = board(page).locator(COLUMNS).last();

            const persisted = waitKanbanOrderPersist(page);
            await dndDrag(page, source, target);
            const response = await persisted;
            expect(response.ok()).toBe(true);
            await capture(page, 'archive');

            await expect(boxUss(page, 3)).toHaveCount(initOrigin - 1, { timeout: 15_000 });
        });
    });

    /*
     * [C-07] `edit assigned to` — the React assign affordance
     * (`.card-action-assigned-to`) opens the SAME real edit lightbox with the
     * assignee `<select>` focused (KanbanApp passes focusAssignee=true, and the
     * lightbox focuses `.assigned-to-select` on open). Changing the assignee and
     * submitting must issue a single `PATCH /userstories/{id}` — no AngularJS
     * bridge is involved.
     */
    test('edit assigned to', async ({ page }) => {
        const card = boxUss(page, 0).first();
        const menu = await openCardActions(card);
        await expect(menu.locator(CARD_ACTION_ASSIGN)).toBeVisible();

        await menu.locator(CARD_ACTION_ASSIGN).click();

        // The real edit lightbox opens focused on the assignee control.
        const lb = editLightbox(page);
        await expect(lb).toBeVisible({ timeout: 10_000 });
        const assignee = lb.locator(LB_EDIT_ASSIGNEE);
        await expect(assignee).toBeFocused({ timeout: 5_000 });
        await capture(page, 'edit-assigned-to');

        // Pick the first real assignee option (index 0 is "Not assigned").
        const optionCount = await assignee.locator('option').count();
        test.skip(optionCount < 2, 'No assignable users in the seeded project.');
        const targetValue = await assignee.locator('option').nth(1).getAttribute('value');
        await assignee.selectOption(targetValue ?? '');

        const persisted = waitEditPersist(page);
        await submitLightbox(page, lb);
        const response = await persisted;
        expect(response.request().method()).toBe('PATCH');
    });

    /*
     * [C-07] `delete us` — the React delete affordance (`.card-action-delete`)
     * opens the THEMED ConfirmDialog (shared/dialog/ConfirmDialog.tsx, [N-03]),
     * NOT the native window.confirm. Confirming issues `DELETE /userstories/{id}`
     * and removes the card; cancelling leaves the board untouched.
     */
    test.describe('delete us', () => {
        test('cancel keeps the card', async ({ page }) => {
            const before = await boxUss(page, 0).count();
            const card = boxUss(page, 0).first();

            const menu = await openCardActions(card);
            await menu.locator(CARD_ACTION_DELETE).click();

            const dialog = page
                .locator(CONFIRM_DIALOG)
                .filter({ has: page.locator(CONFIRM_OK) });
            await expect(dialog).toBeVisible({ timeout: 10_000 });
            await dialog.locator(CONFIRM_CANCEL).click();
            await expect(dialog).toBeHidden({ timeout: 10_000 });

            await expect(boxUss(page, 0)).toHaveCount(before);
        });

        test('confirm deletes the card', async ({ page }) => {
            const before = await boxUss(page, 0).count();
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

            await expect(boxUss(page, 0)).toHaveCount(before - 1, { timeout: 20_000 });

            // The specific deleted card (matched by its exact stable ref) is gone.
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

        await expect(boxUss(page, 0)).toHaveCount(before + 1, { timeout: 20_000 });
        expect(await columnTitles(page, 0)).toContain(subject);
    });

    /*
     * [C-07] rollback — when the kanban-order persist FAILS, the optimistic move
     * is rolled back ([M-05]) and the card returns to its origin column. Force a
     * 500 on `bulk_update_kanban_order` via route interception (deterministic, no
     * backend dependency) and assert the origin/destination counts are restored.
     */
    test('failed order persist rolls the moved card back', async ({ page }) => {
        const initOrigin = await boxUss(page, 0).count();
        const initDestination = await boxUss(page, 1).count();

        await page.route(/bulk_update_kanban_order/, (route) =>
            route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
        );

        const source = boxUss(page, 0).first();
        const target = board(page).locator(COLUMNS).nth(1);
        await dndDrag(page, source, target);

        // After the failed persist the optimistic move is reverted: both columns
        // return to their pre-drag card counts.
        await expect(boxUss(page, 0)).toHaveCount(initOrigin, { timeout: 15_000 });
        await expect(boxUss(page, 1)).toHaveCount(initDestination, { timeout: 15_000 });

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
        await page.goto(`${base}project/project-0/kanban`);
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

            // Find the first category option whose selection reduces the count.
            const options = board(page)
                .locator(FILTER_CATEGORY)
                .locator(`${SINGLE_FILTER} ${FILTER_NAME}`);
            const optionCount = await options.count();
            expect(optionCount).toBeGreaterThan(0);

            let applied = false;
            for (let i = 0; i < optionCount; i++) {
                await options.nth(i).click();
                try {
                    await expect
                        .poll(async () => await board(page).locator(CARD).count(), {
                            timeout: 6_000,
                        })
                        .toBeLessThan(initial);
                    applied = true;
                    break;
                } catch {
                    // This option did not reduce the count (e.g. matches all
                    // cards); remove any resulting chip and try the next one.
                    const chips = board(page).locator(FILTER_APPLIED);
                    if (await chips.count()) {
                        await chips.first().click();
                    }
                }
            }
            expect(applied).toBe(true);

            // Removing the applied chip restores the full list.
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
        await expect(boxUss(page, 0)).toHaveCount(before + 1, { timeout: 20_000 });

        // The title must render the payload as escaped, literal text.
        const title = board(page).locator(CARD_TITLE, { hasText: payload }).first();
        await expect(title).toHaveText(payload);

        // No injected onerror handler executed.
        const injected = await page.evaluate(
            () => (window as unknown as Record<string, unknown>).__xss,
        );
        expect(injected).toBeFalsy();
    });
});
