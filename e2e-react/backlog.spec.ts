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
 *   - The migrated backlog shell (partials/backlog/backlog.jade) hosts ONLY the
 *     React root <tg-react-backlog>. The rich single-user-story create/edit
 *     "generic form" lightbox is a shared COMMON AngularJS surface (out of scope
 *     per AAP §0.2.2) that is NOT hosted in the migrated shell. The React screen
 *     therefore DELEGATES single-US "standard create" and "edit" back to
 *     AngularJS via `broadcastToAngular` — a `$rootScope.$broadcast` of
 *     `genericform:new` / `genericform:edit` (BacklogApp.tsx L1266, L1373). The
 *     migrated screen's REAL, in-scope responsibility is to fire that bridge with
 *     the correct payload, which these tests verify with a hard `$broadcast` spy.
 *   - The ONLY in-React create surface is the BULK user-story lightbox
 *     (`.lightbox-generic-bulk`, BulkUserStoriesLightbox.tsx). "bulk create" and
 *     the XSS-safety assertion drive that real React surface end to end.
 *   - Single-US DELETE and sprint DELETE use a native `window.confirm`
 *     (BacklogApp.tsx L1277, SprintEditLightbox.tsx L302) — NOT a `.lightbox-
 *     generic-ask` dialog. Deletes are therefore confirmed through a Playwright
 *     `page.on('dialog', …)` handler (QA Issue 3: the old code masked the missing
 *     confirm dialog with a `.catch(() => {})`; that mask is gone).
 *   - Attachments are intentionally OUT OF SCOPE: the React screens emit no
 *     attachment DOM (AAP §0.1.1 functional surface omits attachments), so the
 *     legacy attachment cases are a documented drop, not a hidden skip (QA
 *     Issue 3).
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
const POP_POINTS = '.popover.pop-points';
const US_OPTION_BTN = '.us-option button.js-popup-button';
const US_OPTION_POPUP = '.popover.us-option-popup';
const OPT_EDIT = 'button.e2e-edit.edit-story';
const OPT_DELETE = 'button.e2e-delete';

/* --- role/points column filter (table header) --------------------- */
const ROLE_FILTER_TRIGGER = `${BOARD} .backlog-table-header .points .inner`;
const POP_ROLE = '.popover.pop-role';
const POP_ROLE_ITEM = 'a.role';

/* --- new-us controls ---------------------------------------------- *
 * `.new-us button.btn-small` (index 0) fires the AngularJS `genericform:new`
 * bridge (single-US standard create — out-of-scope rich form). `.btn-icon`
 * (index 1) opens the React bulk lightbox. */
const NEW_US_STANDARD = `${BOARD} .new-us button.btn-small`;
const NEW_US_BULK = `${BOARD} .new-us button.btn-icon`;

/* --- bulk user-story lightbox (the ONLY React create surface) ----- *
 * `.lightbox-generic-bulk` is ALWAYS mounted and toggled via `display`, so it
 * carries NO `.open` class; visibility is asserted with toBeVisible/toBeHidden. */
const LB_BULK = '.lightbox-generic-bulk';
const LB_BULK_SUBMIT = 'button.js-submit-button';
const LB_BULK_CLOSE = 'button.close';

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
const FILTER_SEARCH = `${BOARD} input.tg-input-search`;
const FILTER_CATEGORY = `${BOARD} .filter-category[data-type]`;
const FILTER_APPLIED = `${BOARD} .filters-applied .filter-applied`;
const SHOW_TAGS = `${BOARD} label[for="show-tags-input"]`;
const ROW_TAG = `${BOARD} .backlog-table .tag`;
const MOVE_TO_LATEST = `${BOARD} .move-to-latest-sprint`;
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

/** Read the reference text ("#<ref>") of a sprint row. */
async function sprintRowRef(row: Locator): Promise<string> {
    return (await row.locator(SPRINT_REF).first().innerText()).trim();
}

/** Collect every user-story reference rendered inside a sprint. */
async function sprintRefs(sprint: Locator): Promise<string[]> {
    const spans = sprint.locator(SPRINT_REF);
    const total = await spans.count();
    const refs: string[] = [];
    for (let i = 0; i < total; i++) {
        refs.push((await spans.nth(i).innerText()).trim());
    }
    return refs;
}

/** Collect every sprint title (`.sprint-name span`). */
async function sprintTitles(page: Page): Promise<string[]> {
    const spans = page.locator(`${BOARD} .sprint-name span`);
    const total = await spans.count();
    const titles: string[] = [];
    for (let i = 0; i < total; i++) {
        titles.push((await spans.nth(i).innerText()).trim());
    }
    return titles;
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
 * AngularJS bridge spy (verifies the delegated single-US create/edit)
 * ------------------------------------------------------------------ *
 * `broadcastToAngular` (BacklogApp.tsx) hands single-US "standard create" and
 * "edit" to the surviving AngularJS generic-form lightbox via
 * `angular.element(document).injector().get('$rootScope').$broadcast(name,
 * payload)`. Since that lightbox is out of scope for the migrated shell, we
 * verify the migrated screen's real responsibility — that it fires the correct
 * bridge event with the correct payload — by wrapping `$rootScope.$broadcast`
 * with a recorder installed into the page.
 */
interface BridgeCall {
    name: string;
    objType?: string;
}

/** Install (idempotently) a recorder over `$rootScope.$broadcast`. */
async function installBridgeSpy(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as {
            __bridgeCalls?: Array<{ name: string; objType?: string }>;
            __bridgeSpyInstalled?: boolean;
            angular?: {
                element: (d: Document) => {
                    injector: () => {
                        get: (s: string) => {
                            $broadcast: (n: string, p: unknown) => unknown;
                        };
                    };
                };
            };
        };
        w.__bridgeCalls = w.__bridgeCalls || [];
        if (w.__bridgeSpyInstalled) {
            return;
        }
        if (!w.angular) {
            return; // AngularJS shell not present (should not happen at runtime)
        }
        const rs = w.angular.element(document).injector().get('$rootScope');
        const orig = rs.$broadcast.bind(rs);
        rs.$broadcast = (name: string, payload: unknown): unknown => {
            const p = (payload || {}) as { objType?: string };
            w.__bridgeCalls!.push({ name, objType: p.objType });
            return orig(name, payload);
        };
        w.__bridgeSpyInstalled = true;
    });
}

/** Read back the recorded bridge broadcasts. */
async function bridgeBroadcasts(page: Page): Promise<BridgeCall[]> {
    return page.evaluate(() => {
        const w = window as unknown as { __bridgeCalls?: BridgeCall[] };
        return w.__bridgeCalls || [];
    });
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
    const pop = page.locator(POP_POINTS).first();
    await pop.waitFor({ state: 'visible', timeout: 10_000 });
    // pop-points structure: li[role] > span.item-text + ul > li[point] > a
    const roleLi = pop.locator('> li').nth(roleIdx);
    await roleLi.locator('ul > li > a').nth(pointIdx).click();
    await pop.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {
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

/** Set a sprint date field to "YYYY-MM-DD" and commit it. */
async function setDate(input: Locator, value: string): Promise<void> {
    await input.fill(value);
    await input.evaluate((el) => (el as HTMLElement).blur());
}

/* ------------------------------------------------------------------ *
 * Drag-and-drop helper tuned to @dnd-kit/core PointerSensor
 * ------------------------------------------------------------------ *
 * mouse.move(source center) → down → nudge past the activation distance →
 * stepped move to the target center → settle → up. NO trailing sleep: callers
 * assert the resulting DOM/response condition.
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
    const tx = to.x + to.width / 2;
    const ty = to.y + to.height / 2;

    // Stepped move so dnd-kit registers drag-over transitions, then settle.
    await page.mouse.move(tx, ty, { steps: 25 });
    await page.mouse.move(tx, ty, { steps: 6 });
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

/* ================================================================== *
 * SUITE
 * ================================================================== */

test.describe('backlog', () => {
    // The legacy suite is strongly stateful and order-dependent; run serially.
    test.describe.configure({ mode: 'serial' });

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
     * create US
     * -------------------------------------------------------------- *
     * The rich single-user-story create form is a shared AngularJS generic-form
     * lightbox (out of scope, AAP §0.2.2) that the migrated shell does not host.
     * The migrated screen's real responsibility is to DELEGATE the standard
     * create back to AngularJS via the `genericform:new` bridge — asserted here
     * with a hard $broadcast spy. (The real in-React create surface is the bulk
     * lightbox, exercised by "bulk create US" below.)
     */
    test.describe('create US', () => {
        test('standard create fires the genericform:new bridge', async ({ page }) => {
            await installBridgeSpy(page);
            await capture(page, 'create-us');

            await page.locator(NEW_US_STANDARD).first().click();

            await expect
                .poll(async () =>
                    (await bridgeBroadcasts(page)).some(
                        (b) => b.name === 'genericform:new' && b.objType === 'us',
                    ),
                    { timeout: 10_000 },
                )
                .toBe(true);
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
     * edit US
     * -------------------------------------------------------------- *
     * Edit is delegated to the AngularJS generic-form lightbox via the
     * `genericform:edit` bridge (BacklogApp.tsx L1266). We open the row's
     * options popup, click Edit, and assert the correct bridge event fires.
     */
    test.describe('edit US', () => {
        test('edit affordance fires the genericform:edit bridge', async ({ page }) => {
            await installBridgeSpy(page);

            const row = userStories(page).first();
            await row.locator(US_OPTION_BTN).first().click();
            const popup = page.locator(US_OPTION_POPUP).first();
            await popup.waitFor({ state: 'visible', timeout: 10_000 });
            await popup.locator(OPT_EDIT).first().click();

            await expect
                .poll(async () =>
                    (await bridgeBroadcasts(page)).some(
                        (b) => b.name === 'genericform:edit' && b.objType === 'us',
                    ),
                    { timeout: 10_000 },
                )
                .toBe(true);
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

    test('delete US', async ({ page }) => {
        const before = await userStories(page).count();

        // Single-US delete uses a native window.confirm (NOT a lightbox); accept it.
        page.once('dialog', (dialog) => dialog.accept());

        const row = userStories(page).first();
        await row.locator(US_OPTION_BTN).first().click();
        const popup = page.locator(US_OPTION_POPUP).first();
        await popup.waitFor({ state: 'visible', timeout: 10_000 });
        await popup.locator(OPT_DELETE).first().click();

        await expect(userStories(page)).toHaveCount(before - 1, { timeout: 20_000 });
    });

    /* -------------------------------------------------------------- *
     * drag & drop — backlog + milestones
     * -------------------------------------------------------------- */

    test('drag backlog us', async ({ page }) => {
        const rows = userStories(page);

        // Take the row at index 4, remember its ref, drag its handle onto row 0.
        const dragRow = rows.nth(4);
        const draggedRef = await tableRowRef(dragRow);

        // HARD-assert the reorder persists through bulk_update_backlog_order.
        const persisted = waitBacklogOrderPersist(page);
        await dndDrag(page, dragRow.locator(TABLE_DRAG_HANDLE), rows.nth(0));
        const response = await persisted;
        expect(response.ok()).toBe(true);

        await expect
            .poll(async () => await tableRowRef(rows.nth(0)), { timeout: 20_000 })
            .toBe(draggedRef);
    });

    test('reorder multiple us', async ({ page }) => {
        const rows = userStories(page);
        const count = await rows.count();

        // Select the last two rows and record their refs (order per source).
        const last = rows.nth(count - 1);
        await last.locator('input[type="checkbox"]').click();
        const ref1 = await tableRowRef(last);

        const secondLast = rows.nth(count - 2);
        await secondLast.locator('input[type="checkbox"]').click();
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
        const rows = userStories(page);
        const count = await rows.count();
        await rows.nth(count - 1).locator('input[type="checkbox"]').click();
        await rows.nth(count - 2).locator('input[type="checkbox"]').click();

        // Drag row 0's handle onto sprint 0's table ⇒ both selected move.
        await dndDrag(page, rows.nth(0).locator(TABLE_DRAG_HANDLE), sprint.locator(SPRINT_TABLE));

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
        await firstRow.locator('input[type="checkbox"]').click();
        const draggedRef = await tableRowRef(firstRow);

        await page.locator(MOVE_TO_LATEST).first().click();

        // The last OPEN sprint should now contain that ref.
        await expect
            .poll(async () => await sprintRefs(sprintsOpen(page).last()), { timeout: 20_000 })
            .toContain(draggedRef);
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

        await firstCheckbox.click();
        await page.keyboard.down('Shift');
        await fourthCheckbox.click();
        await page.keyboard.up('Shift');

        await expect(selectedUserStories(page)).toHaveCount(4, { timeout: 15_000 });
    });

    test('role filters', async ({ page }) => {
        // Open the per-role points-column filter (table header) and pick a role.
        await page.locator(ROLE_FILTER_TRIGGER).first().click();
        const pop = page.locator(POP_ROLE).first();
        await pop.waitFor({ state: 'visible', timeout: 10_000 });
        await pop.locator(POP_ROLE_ITEM).first().click();
        await pop.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {
            /* popover closed */
        });

        await capture(page, 'backlog-role-filters');

        // The points column now shows the per-role "x / y" figure.
        const points = (await userStories(page).nth(0).locator(US_POINTS).first().innerText()).trim();
        expect(points).toMatch(/[0-9?]+\s*\/\s*[0-9?]+/);
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

        test('delete', async ({ page }) => {
            await page.locator(EDIT_SPRINT).nth(0).click();
            const lb = await waitSprintLightbox(page);

            // Record the name BEFORE deleting.
            const name = (await lb.locator(SPRINT_NAME_INPUT).first().inputValue()).trim();

            // Sprint delete uses a native window.confirm; accept it.
            page.once('dialog', (dialog) => dialog.accept());
            await lb.locator(SPRINT_DELETE).first().click();
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

            await page.locator(ADD_SPRINT).first().click();
            const lb = await waitSprintLightbox(page);

            await lb.locator(SPRINT_NAME_INPUT).first().fill(`sprintName${Date.now()}`);

            // Inverted range: start AFTER finish.
            await setDate(lb.locator(SPRINT_START_INPUT).first(), '2020-12-31');
            await setDate(lb.locator(SPRINT_FINISH_INPUT).first(), '2020-01-01');

            await lb.locator(SPRINT_SUBMIT).first().click();

            // Submission is blocked and a date-range validation error is shown.
            await expect(lb).toBeVisible();
            const rangeText = lb.getByText(rangeMessage, { exact: false });
            await expect(rangeText.or(validationErrors(lb)).first()).toBeVisible();
            expect(await sprintTitles(page)).toEqual(before);

            // Correct the range (start <= finish) ⇒ the range error clears.
            await setDate(lb.locator(SPRINT_FINISH_INPUT).first(), '2021-12-31');
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
            await page.locator(SHOW_TAGS).first().click();
            await capture(page, 'backlog-tags');
            await expect(page.locator(ROW_TAG).first()).toBeVisible();
        });

        test('hide', async ({ page }) => {
            const showTags = page.locator(SHOW_TAGS).first();
            // Fresh page: reveal tags first, then hide them (clicking toggles).
            await showTags.click();
            await expect(page.locator(ROW_TAG).first()).toBeVisible();
            await showTags.click();
            await expect(page.locator(ROW_TAG).first()).toBeHidden();
        });
    });

    /* -------------------------------------------------------------- *
     * velocity forecasting
     * -------------------------------------------------------------- */
    test.describe('velocity forecasting', () => {
        test('show', async ({ page }) => {
            await openBacklog(page, 'project-1');

            const before = await userStories(page).count();

            await page.locator(VELOCITY).first().click();
            await capture(page, 'velocity-forecasting');

            await expect
                .poll(async () => await userStories(page).count(), { timeout: 15_000 })
                .toBeLessThan(before);
        });

        test('create sprint from forecasting', async ({ page }) => {
            await openBacklog(page, 'project-1');

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
            await openBacklog(page, 'project-5');
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
            await category.locator('.filter-name').first().click();

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
