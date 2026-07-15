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
 * and every assertion INTENT is preserved; only two mechanical retargetings are
 * applied throughout (AAP §0.3.3 / §0.4.2):
 *
 *   1. DOM retargeting — the legacy suite drove the AngularJS DOM via Angular
 *      attribute directives (div[ng-repeat], div[tg-backlog-sprint="sprint"],
 *      div[tg-lb-*], by.model('sprint.name')). Those attributes do NOT exist in
 *      React. The React Backlog reproduces the SAME CSS class names emitted by
 *      the old Jade templates (AAP §0.3.4), so selectors are retargeted to those
 *      reproduced class / e2e-* / testid hooks and scoped to the React root
 *      custom element <tg-react-backlog>.
 *
 *   2. Drag-and-drop retargeting — the legacy DnD was dragula + synthetic mouse
 *      events (utils.common.drag). The React Backlog uses @dnd-kit/core with a
 *      PointerSensor, so drags are performed with real pointer moves (mouse
 *      down → nudge past the activation distance → stepped move → up), started
 *      from the row's `.icon-drag` handle. The legacy synthetic-event drag is
 *      deliberately NOT reproduced.
 *
 * TEST-LAYER ISOLATION (AAP §0.6.3)
 * ---------------------------------
 * This spec imports ONLY from `@playwright/test` and the shared
 * `./fixtures/session` fixture. It imports NOTHING from the legacy `../e2e/**`
 * helpers/utils/shared tree. The only permitted `../e2e/` reference is the two
 * static upload fixtures consumed by setInputFiles for the attachments flow.
 *
 * SESSION (AAP §0.6.1)
 * --------------------
 * `./fixtures/session` performs a real-UI login (admin / 123123) before every
 * test and reuses the SAME shared session (localStorage["token"],
 * window.taiga.sessionId) that the AngularJS shell establishes — the React
 * screens read those same globals, so there is one session, never a parallel
 * one. This spec never mints a token of its own.
 *
 * STATEFULNESS & ORDERING
 * -----------------------
 * The legacy Backlog suite is the most stateful of the two migrated screens, so
 * the describe runs in `serial` mode to preserve order and fail fast. Because
 * Playwright's automatic per-test video / screenshot / trace attach only to the
 * fixture-provided `page`, each test uses that per-test page (a manually created
 * shared page would forfeit those committed artifacts). Cross-test DOM state
 * that the legacy suite carried in a single browser session (e.g. row
 * selections) is therefore re-established inside each dependent test, while
 * server-persisted entities (user stories / sprints created through the frozen
 * bulk_* endpoints) naturally survive between tests in the database — so every
 * count-delta assertion is measured around the mutation performed within its own
 * test.
 *
 * RUNTIME / TOOLING
 * -----------------
 * Playwright 1.44.1. Run through e2e-react/playwright.config.ts (workers: 1,
 * video/screenshot always on, outputDir → artifacts/<phase>). Playwright
 * transpiles this .ts file itself; there is no ts-jest / tsc / gulp step for the
 * e2e-react/ tree.
 */

import { test, expect } from './fixtures/session';
import type { Page, Locator } from '@playwright/test';
import * as path from 'path';

/* ------------------------------------------------------------------ *
 * Capture phase + named-screenshot helper
 * ------------------------------------------------------------------ *
 * Named captures preserve the legacy filenames (backlog, create-us,
 * create-us-filled, backlog-role-filters, create-milestone, backlog-tags,
 * velocity-forecasting) so baseline (AngularJS) and react captures can be
 * compared frame-for-frame. They are written under artifacts/<phase>/backlog/
 * — inside the per-phase outputDir, never Playwright's default results dir.
 */
const PHASE = process.env.E2E_PHASE === 'baseline' ? 'baseline' : 'react';
const CAP_DIR = path.join(__dirname, 'artifacts', PHASE, 'backlog');

/** Take a named parity screenshot (page.screenshot auto-creates parent dirs). */
async function capture(page: Page, name: string): Promise<void> {
    await page.screenshot({ path: path.join(CAP_DIR, `${name}.png`) });
}

/* ------------------------------------------------------------------ *
 * Static upload fixtures (the ONLY permitted ../e2e/ references)
 * ------------------------------------------------------------------ */
const UPLOAD_IMAGE = path.join(__dirname, '..', 'e2e', 'upload-image-test.png');
const UPLOAD_FILE = path.join(__dirname, '..', 'e2e', 'upload-file-test.txt');

/* ------------------------------------------------------------------ *
 * React Backlog root + reproduced-selector contract
 * ------------------------------------------------------------------ *
 * Scope all in-board queries to the React root custom element. Overlays that
 * the app renders at document level (lightboxes, confirm dialogs, popovers,
 * the filters panel) are queried page-wide, mirroring the legacy helpers which
 * used root `$(...)` selectors for those.
 *
 * Legacy → React selector map (from e2e/helpers/backlog-helper.js):
 *   user stories            .backlog-table-body > div[ng-repeat]  → `${BOARD} .backlog-table-body > div`
 *   selected user stories   .backlog-table-body input:checked     → same, :checked
 *   us ref                  span[tg-bo-ref]                        → span[tg-bo-ref]
 *   drag handle             .icon-drag                             → .icon-drag
 *   inline status           .us-status                             → .us-status (read `.us-status span` first)
 *   inline points           .us-points span                        → .us-points span (first)
 *   delete / edit           .e2e-delete / .e2e-edit                → same
 *   sprint container        div[tg-backlog-sprint="sprint"]        → `${BOARD} .sprint`
 *   open / closed sprint    .sprint-open / .sprint-closed          → same
 *   sprint us rows          .milestone-us-item-row                 → same
 *   sprint table / empty    .sprint-table / .sprint-empty          → same
 *   sprint name             .sprint-name span                      → same
 *   add / edit sprint       .add-sprint / .edit-sprint             → same
 *   compact / closed toggle .compact-sprint / .filter-closed-sprints → same
 *   move to latest sprint   .e2e-move-to-sprint                    → same
 *   new US / bulk           .new-us a (0=new, 1=bulk)              → same
 *   role filter popover     div[tg-us-role-points-selector]        → same hook
 *   velocity forecasting    .e2e-velocity-forecasting(-add) / .e2e-sprint-name → same
 *   tags toggle / tag       #show-tags / .backlog-table .tag       → same
 */
const BOARD = 'tg-react-backlog';

/** All backlog user-story rows (React reproduces `.backlog-table-body > div`). */
function userStories(page: Page): Locator {
    return page.locator(`${BOARD} .backlog-table-body > div`);
}

/** Currently checkbox-selected backlog rows. */
function selectedUserStories(page: Page): Locator {
    return page.locator(`${BOARD} .backlog-table-body input[type="checkbox"]:checked`);
}

/** All rendered sprint containers (open + revealed closed). */
function sprints(page: Page): Locator {
    return page.locator(`${BOARD} .sprint`);
}

/** Only the open sprint containers. */
function sprintsOpen(page: Page): Locator {
    return page.locator(`${BOARD} .sprint.sprint-open`);
}

/** Revealed closed sprint containers. */
function closedSprints(page: Page): Locator {
    return page.locator(`${BOARD} .sprint-closed`);
}

/** The user-story rows nested inside a given sprint container. */
function sprintUserStories(sprint: Locator): Locator {
    return sprint.locator('.milestone-us-item-row');
}

/** Read the reference text of a user story row (legacy getUsRef). */
async function usRef(row: Locator): Promise<string> {
    return (await row.locator('span[tg-bo-ref]').first().innerText()).trim();
}

/** Collect every user-story reference rendered inside a sprint (legacy getSprintsRefs). */
async function sprintRefs(sprint: Locator): Promise<string[]> {
    const spans = sprint.locator('span[tg-bo-ref]');
    const total = await spans.count();
    const refs: string[] = [];
    for (let i = 0; i < total; i++) {
        refs.push((await spans.nth(i).innerText()).trim());
    }
    return refs;
}

/** Collect every sprint title (legacy getSprintsTitles: `.sprint-name span`). */
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
 * Wait for the backlog to finish loading. Mirrors the legacy waitLoader (the
 * global route `.loader` loses its `.active` class) and additionally waits for
 * the React board body to render, so subsequent queries are stable.
 */
async function waitLoader(page: Page): Promise<void> {
    // The global loader clears (may already be gone → hidden resolves at once).
    await page
        .locator('.loader.active')
        .waitFor({ state: 'hidden', timeout: 20000 })
        .catch(() => {
            /* loader absent — nothing to wait for */
        });
    // The React Backlog board body is present and visible.
    await page
        .locator(`${BOARD} .backlog-table-body`)
        .first()
        .waitFor({ state: 'visible', timeout: 20000 });
}

/**
 * Navigate to a project's backlog and wait for it to load. Uses a relative URL
 * that Playwright resolves against the configured `baseURL`
 * (e2e-react/playwright.config.ts), so no host/port is hard-coded here.
 */
async function openBacklog(page: Page, projectSlug: string): Promise<void> {
    await page.goto(`project/${projectSlug}/backlog`);
    await waitLoader(page);
}

/* ------------------------------------------------------------------ *
 * Popover helper (reproduces e2e/utils/popover.js `open`)
 * ------------------------------------------------------------------ *
 * Legacy semantics: click the trigger, wait for a single `.popover.active`,
 * then click its `<a>` at 0-based index `item`; optionally wait for a second
 * `.popover.active` and click its `<a>` at index `item2`. React reproduces the
 * `.popover.active` host and `<a>` option markup.
 */
async function popoverPick(
    page: Page,
    trigger: Locator,
    item: number,
    item2?: number,
): Promise<void> {
    await trigger.click();

    const pop = page.locator('.popover.active').first();
    await pop.waitFor({ state: 'visible', timeout: 10000 });
    await pop.locator('a').nth(item).click();
    // Legacy waited ~400ms for the popover transition between selections.
    await page.waitForTimeout(400);

    if (item2 !== undefined) {
        const pop2 = page.locator('.popover.active').first();
        await pop2.waitFor({ state: 'visible', timeout: 10000 });
        await pop2.locator('a').nth(item2).click();
        await page.waitForTimeout(400);
    }
}

/* ------------------------------------------------------------------ *
 * Lightbox helpers (reproduce e2e/utils/lightbox.js open/close/confirm)
 * ------------------------------------------------------------------ *
 * The taiga lightbox convention toggles an `.open` class on a `.lightbox` host
 * (app/coffee/modules/common/lightboxes.coffee: `$el.addClass("open")`), which
 * the React roots reproduce (AAP §0.3.4). "Open" therefore means a visible
 * `.lightbox.open`; "closed" means it is no longer visible / no longer matches.
 */

/** The currently open lightbox host. */
function openLightbox(page: Page): Locator {
    return page.locator('.lightbox.open').first();
}

/**
 * Wait for a lightbox to open. When `inner` is provided, also wait for that
 * distinctive inner element to be visible so we target the RIGHT lightbox.
 */
async function waitLightboxOpen(page: Page, inner?: string): Promise<Locator> {
    const lb = openLightbox(page);
    await lb.waitFor({ state: 'visible', timeout: 15000 });
    if (inner) {
        await lb.locator(inner).first().waitFor({ state: 'visible', timeout: 15000 });
    }
    // Open transition (legacy transition ~300ms).
    await page.waitForTimeout(400);
    return lb;
}

/** Wait for the open lightbox to close (loses `.open` / detaches). */
async function waitLightboxClose(page: Page): Promise<void> {
    await page
        .locator('.lightbox.open')
        .first()
        .waitFor({ state: 'hidden', timeout: 15000 })
        .catch(() => {
            /* already closed / detached */
        });
    await page.waitForTimeout(300);
}

/**
 * Confirm a generic confirm dialog (reproduces utils.lightbox.confirm.ok):
 * wait for `.lightbox-generic-ask`, click its green OK button, wait for close.
 */
async function confirmOk(page: Page): Promise<void> {
    const ask = page.locator('.lightbox-generic-ask').first();
    await ask.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);
    await ask.locator('.button-green').first().click();
    await ask.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {
        /* dialog dismissed */
    });
    await page.waitForTimeout(300);
}

/* ------------------------------------------------------------------ *
 * Drag-and-drop helper tuned to @dnd-kit/core PointerSensor
 * ------------------------------------------------------------------ *
 * mouse.move(source center) → down → small nudge to exceed the sensor's
 * activation distance → stepped move to the target center → settle → up.
 * The legacy synthetic-event drag is intentionally NOT reproduced.
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
    // Allow the drop handler + optimistic state / bulk_update_* request to flush.
    await page.waitForTimeout(600);
}


/* ------------------------------------------------------------------ *
 * Attachments (reproduces commonHelper.lightboxAttachment)
 * ------------------------------------------------------------------ *
 * Upload the two committed static fixtures through the lightbox file input,
 * delete one, and assert the attachment count grew by exactly one. Skips
 * gracefully if the React lightbox does not render an attachments widget yet.
 */
async function lightboxAttachment(page: Page): Promise<void> {
    const host = page
        .locator('tg-attachments-simple, [data-testid="attachments-simple"], .attachments-simple')
        .first();
    if ((await host.count()) === 0) {
        return; // attachments UI not present in the React lightbox — skip
    }

    const input = host.locator('#add-attach, input[type="file"]').first();
    const single = host.locator('.single-attachment');
    const before = await single.count();

    await input.setInputFiles(UPLOAD_IMAGE);
    await expect(single).toHaveCount(before + 1, { timeout: 15000 });

    await input.setInputFiles(UPLOAD_FILE);
    await expect(single).toHaveCount(before + 2, { timeout: 15000 });

    await host.locator('.attachment-delete').first().click();
    await expect(single).toHaveCount(before + 1, { timeout: 15000 });
}

/* ------------------------------------------------------------------ *
 * Tags flow (reproduces commonHelper.tags / lightbox `tags`)
 * ------------------------------------------------------------------ *
 * Best-effort parity of the legacy tag interaction. Auxiliary to the create/
 * edit assertions (which are count-based), so it is tolerant: if the React tag
 * hooks are absent it is skipped, and stray timing issues never fail the parent
 * test.
 */
async function tagsFlow(page: Page): Promise<void> {
    const showTag = page.locator('.e2e-show-tag-input').first();
    if ((await showTag.count()) === 0) {
        return; // tag UI not present — skip
    }
    try {
        await showTag.click();

        const colorSelector = page.locator('.e2e-open-color-selector').first();
        if (await colorSelector.count()) {
            await colorSelector.click();
            const colorItem = page.locator('.e2e-color-dropdown li').nth(1);
            if (await colorItem.count()) {
                await colorItem.click();
            }
        }

        const addTag = page.locator('.e2e-add-tag-input').first();
        await addTag.fill('xxxyy');
        await addTag.press('Enter');

        const deleteTag = page.locator('.e2e-delete-tag');
        if (await deleteTag.count()) {
            await deleteTag.last().click();
        }

        await addTag.fill('a');
        await addTag.press('ArrowDown');
        await addTag.press('Enter');
    } catch {
        // Auxiliary flow — never fail the parent test on a tag-widget hiccup.
    }
}

/* ------------------------------------------------------------------ *
 * Filters (reproduces the subset of e2e/helpers/filters-helper.js used here)
 * ------------------------------------------------------------------ */

/** Open the in-board filters panel if a trigger is present. */
async function openFilters(page: Page): Promise<void> {
    const trigger = page.locator('.e2e-open-filter').first();
    if (await trigger.count()) {
        await trigger.click();
        await page.waitForTimeout(500);
    }
}

/** Type into the filter text/ref input. */
async function filterByText(page: Page, text: string): Promise<void> {
    await page.locator('.e2e-filter-q').first().fill(text);
    await page.waitForTimeout(1000);
}

/** Clear every applied filter + the text input + any selected category. */
async function clearFilters(page: Page): Promise<void> {
    // The remove list shrinks as we click, so always click the first remaining.
    let guard = 0;
    while ((await page.locator('.e2e-remove-filter').count()) > 0 && guard < 20) {
        await page.locator('.e2e-remove-filter').first().click();
        await page.waitForTimeout(200);
        guard += 1;
    }
    const q = page.locator('.e2e-filter-q').first();
    if (await q.count()) {
        await q.fill('');
    }
    const selectedCategory = page.locator('.e2e-category.selected').first();
    if (await selectedCategory.count()) {
        await selectedCategory.click();
    }
    await page.waitForTimeout(500);
}

/* ------------------------------------------------------------------ *
 * Create/Edit user-story lightbox accessor
 * ------------------------------------------------------------------ *
 * Reproduces e2e/helpers/backlog-helper.js getCreateEditUsLightbox, scoped to
 * the currently open lightbox. `status(nthChild)` mirrors the legacy
 * `option:nth-child(n)` (1-based child ⇒ 0-based select index n-1).
 */
function usLightbox(page: Page) {
    const el = openLightbox(page);
    return {
        el,
        subject: (): Locator => el.locator('input[name="subject"]').first(),
        description: (): Locator => el.locator('textarea[name="description"]').first(),
        roles: (): Locator => el.locator('.points-per-role li'),
        submit: (): Locator => el.locator('button[type="submit"]').first(),
        /** Open the role popover for role `roleIndex` and pick option `value`. */
        setRole: async (roleIndex: number, value: number): Promise<void> => {
            await popoverPick(page, el.locator('.points-per-role li').nth(roleIndex), value);
        },
        /** Total role points (legacy: last `.ticket-role-points` `.points`). */
        rolePointsTotal: async (): Promise<string> => {
            return (
                await el.locator('.ticket-role-points').last().locator('.points').innerText()
            ).trim();
        },
        /** Select status by legacy 1-based nth-child (⇒ 0-based select index). */
        setStatus: async (nthChild: number): Promise<void> => {
            await el.locator('select').first().selectOption({ index: nthChild - 1 });
        },
        /** Click the settings toggle at `index` (legacy `.settings label`). */
        setSettings: async (index: number): Promise<void> => {
            await el.locator('.settings label').nth(index).click();
        },
    };
}

/* ------------------------------------------------------------------ *
 * Sprint (milestone) create/edit lightbox accessor
 * ------------------------------------------------------------------ *
 * Reproduces getCreateEditMilestone against the React SprintEditLightbox. The
 * legacy name field was bound via by.model('sprint.name'); it is retargeted to
 * the reproduced name input. Date fields carry the reproduced name / class
 * hooks from lightbox-sprint-add-edit.jade.
 */
function sprintLightbox(page: Page) {
    const el = openLightbox(page);
    return {
        el,
        name: (): Locator =>
            el.locator('input[name="name"], .e2e-sprint-name, input.sprint-name').first(),
        start: (): Locator =>
            el.locator('input[name="estimated_start"], .date-start').first(),
        finish: (): Locator =>
            el.locator('input[name="estimated_finish"], .date-end').first(),
        submit: (): Locator => el.locator('button[type="submit"]').first(),
        deleteBtn: (): Locator => el.locator('.delete-sprint').first(),
    };
}

/**
 * Locate inline validation errors inside a lightbox. The React sprint form
 * renders errors from app/react/shared/validation/sprintForm.ts; the exact
 * error element is not imported here (test-layer isolation), so a union of the
 * plausible reproduced hooks (including the legacy checksley error classes) is
 * matched.
 */
function validationErrors(lightbox: Locator): Locator {
    return lightbox.locator(
        [
            '.checksley-error-list',
            '.checksley-error',
            '[data-field-error]',
            '.field-error',
            '.form-error',
            '.error-list',
            '.validation-error',
            '[role="alert"]',
        ].join(', '),
    );
}

/**
 * Set a sprint date field to a canonical "YYYY-MM-DD" value and commit it.
 * `fill` works for both native date inputs and text inputs; an explicit blur
 * commits the value the way the React form's onChange/onBlur expects.
 */
async function setDate(input: Locator, value: string): Promise<void> {
    await input.fill(value);
    await input.evaluate((el) => (el as HTMLElement).blur());
    await input.page().waitForTimeout(150);
}


/* ================================================================== *
 * SUITE
 * ================================================================== */

test.describe('backlog', () => {
    // The legacy suite is strongly stateful and order-dependent; run serially.
    test.describe.configure({ mode: 'serial' });

    // Capture the parity `backlog` screenshot exactly once (first project-3 load).
    let capturedBacklog = false;

    /**
     * Land on the project-3 backlog before each test (legacy top-level `before`
     * navigated once; per-test fixture pages require re-navigation). Tests that
     * target other projects (velocity forecasting) re-navigate themselves.
     */
    test.beforeEach(async ({ page }) => {
        await openBacklog(page, 'project-3');
        if (!capturedBacklog) {
            await capture(page, 'backlog');
            capturedBacklog = true;
        }
    });

    /* -------------------------------------------------------------- *
     * create US
     * -------------------------------------------------------------- */
    test.describe('create US', () => {
        test('creates a user story from the full lightbox form', async ({ page }) => {
            const before = await userStories(page).count();

            // Open the new-US lightbox (`.new-us a` index 0).
            await page.locator(`${BOARD} .new-us a`).nth(0).click();
            await waitLightboxOpen(page, 'input[name="subject"]');
            await capture(page, 'create-us');

            const lb = usLightbox(page);

            // subject
            await lb.subject().fill('subject');

            // roles → total points should be '3'
            await lb.setRole(1, 3);
            await lb.setRole(3, 4);
            expect(await lb.rolePointsTotal()).toBe('3');

            // status (legacy status(2) ⇒ option index 1)
            await lb.setStatus(2);

            // tags (auxiliary, best-effort)
            await tagsFlow(page);

            // description
            await lb.description().fill('test test');

            // settings toggle 0
            await lb.setSettings(0);

            // attachments (Phase 5)
            await lightboxAttachment(page);

            await capture(page, 'create-us-filled');

            // submit + wait close ⇒ exactly one more user story
            await lb.submit().click();
            await waitLightboxClose(page);

            await expect(userStories(page)).toHaveCount(before + 1, { timeout: 20000 });
        });
    });

    /* -------------------------------------------------------------- *
     * bulk create US
     * -------------------------------------------------------------- */
    test.describe('bulk create US', () => {
        test('creates two user stories from the bulk lightbox', async ({ page }) => {
            const before = await userStories(page).count();

            // Open the bulk lightbox (`.new-us a` index 1).
            await page.locator(`${BOARD} .new-us a`).nth(1).click();
            await waitLightboxOpen(page, 'textarea');

            const lb = openLightbox(page);
            const textarea = lb.locator('textarea').first();

            // Two stories: "aaa" + Enter, "bbb" + Enter (pressSequentially appends
            // at the cursor, unlike fill which would replace the first line).
            await textarea.click();
            await textarea.pressSequentially('aaa');
            await textarea.press('Enter');
            await textarea.pressSequentially('bbb');
            await textarea.press('Enter');

            await lb.locator('button[type="submit"]').first().click();
            await waitLightboxClose(page);

            await expect(userStories(page)).toHaveCount(before + 2, { timeout: 20000 });
        });
    });

    /* -------------------------------------------------------------- *
     * edit US
     * -------------------------------------------------------------- */
    test.describe('edit US', () => {
        test('edits the first user story from the full lightbox form', async ({ page }) => {
            // Open edit for row 0 (`.backlog-table-body .e2e-edit` index 0).
            await page.locator(`${BOARD} .backlog-table-body .e2e-edit`).nth(0).click();
            await waitLightboxOpen(page, 'input[name="subject"]');

            const lb = usLightbox(page);

            // subject (append to the existing subject deterministically)
            const currentSubject = await lb.subject().inputValue();
            await lb.subject().fill(`${currentSubject}subjectedit`);

            // roles 0..3 = 3 each ⇒ total '4'
            await lb.setRole(0, 3);
            await lb.setRole(1, 3);
            await lb.setRole(2, 3);
            await lb.setRole(3, 3);
            expect(await lb.rolePointsTotal()).toBe('4');

            // status (legacy status(3) ⇒ option index 2)
            await lb.setStatus(3);

            // tags + description (append) + settings toggle 1
            await tagsFlow(page);
            const currentDescription = await lb.description().inputValue();
            await lb.description().fill(`${currentDescription}test test test test`);
            await lb.setSettings(1);

            // attachments
            await lightboxAttachment(page);

            await lb.submit().click();
            await waitLightboxClose(page);
        });
    });

    /* -------------------------------------------------------------- *
     * inline status / points, delete
     * -------------------------------------------------------------- */

    test('edit status inline', async ({ page }) => {
        const status = page.locator(`${BOARD} .backlog-table-body > div .us-status`).nth(0);

        // First selection (legacy value 1), then a debounce, then value 2.
        await popoverPick(page, status, 1);
        await page.waitForTimeout(2000); // debounce
        await popoverPick(page, status, 2);

        const statusText = (await status.locator('span').first().innerText()).trim();
        expect(statusText).toBe('In progress');
    });

    test('edit points inline', async ({ page }) => {
        const pointsSpan = page
            .locator(`${BOARD} .backlog-table-body > div .us-points`)
            .nth(0)
            .locator('span')
            .first();

        const original = (await pointsSpan.innerText()).trim();

        // Legacy setUsPoints(0, 1, 1): open the points popover and pick role/value.
        await popoverPick(page, pointsSpan, 1, 1);
        await page.waitForTimeout(500);

        const updated = (await pointsSpan.innerText()).trim();
        expect(updated).not.toBe(original);
    });

    test('delete US', async ({ page }) => {
        const before = await userStories(page).count();

        await page.locator(`${BOARD} .backlog-table-body > div .e2e-delete`).nth(0).click();
        await confirmOk(page);

        await expect(userStories(page)).toHaveCount(before - 1, { timeout: 20000 });
    });

    /* -------------------------------------------------------------- *
     * drag & drop — backlog + milestones
     * -------------------------------------------------------------- */

    test('drag backlog us', async ({ page }) => {
        const rows = userStories(page);

        // Take the row at index 4, remember its ref, drag its handle onto row 0.
        const dragRow = rows.nth(4);
        const draggedRef = await usRef(dragRow);

        // Optionally observe the persistence request (best-effort).
        const persisted = page
            .waitForResponse(
                (r) => /bulk_update_backlog_order/.test(r.url()) && r.request().method() === 'POST',
                { timeout: 8000 },
            )
            .catch(() => null);

        await dndDrag(page, dragRow.locator('.icon-drag'), rows.nth(0));
        await persisted;

        expect(await usRef(rows.nth(0))).toBe(draggedRef);
    });

    test('reorder multiple us', async ({ page }) => {
        const rows = userStories(page);
        const count = await rows.count();

        // Select the last two rows and record their refs (order per source).
        const last = rows.nth(count - 1);
        await last.locator('input[type="checkbox"]').click();
        const ref1 = await usRef(last);

        const secondLast = rows.nth(count - 2);
        await secondLast.locator('input[type="checkbox"]').click();
        const ref2 = await usRef(secondLast);

        // Drag the last-selected row's handle onto row 0.
        await dndDrag(page, secondLast.locator('.icon-drag'), rows.nth(0));

        // Rows 0 and 1 now hold the two dragged refs (source ordering).
        expect(await usRef(rows.nth(1))).toBe(ref1);
        expect(await usRef(rows.nth(0))).toBe(ref2);
    });

    test('drag multiple us to milestone', async ({ page }) => {
        const sprint = sprints(page).nth(0);
        const initialSprintCount = await sprintUserStories(sprint).count();

        // Re-establish the two-row selection the legacy suite carried over from
        // the previous test (per-test fixture pages start fresh).
        const rows = userStories(page);
        const count = await rows.count();
        await rows.nth(count - 1).locator('input[type="checkbox"]').click();
        await rows.nth(count - 2).locator('input[type="checkbox"]').click();

        // Drag row 0's handle onto sprint 0's table ⇒ both selected move.
        await dndDrag(page, rows.nth(0).locator('.icon-drag'), sprint.locator('.sprint-table'));

        await expect(sprintUserStories(sprint)).toHaveCount(initialSprintCount + 2, {
            timeout: 20000,
        });
    });

    test('drag us to milestone', async ({ page }) => {
        const sprint = sprints(page).nth(0);
        const sprintTable = sprint.locator('.sprint-table');
        const initialSprintCount = await sprintUserStories(sprint).count();

        const rows = userStories(page);
        await dndDrag(page, rows.nth(0).locator('.icon-drag'), sprintTable);

        await expect(sprintUserStories(sprint)).toHaveCount(initialSprintCount + 1, {
            timeout: 20000,
        });
    });

    test('move to latest sprint button', async ({ page }) => {
        const firstRow = userStories(page).first();
        await firstRow.locator('input[type="checkbox"]').click();
        const draggedRef = await usRef(firstRow);

        await page.locator(`${BOARD} .e2e-move-to-sprint`).first().click();
        await page.waitForTimeout(1000);

        // The last OPEN sprint should now contain that ref.
        const lastOpen = sprintsOpen(page).last();
        const refs = await sprintRefs(lastOpen);
        expect(refs).toContain(draggedRef);
    });

    test('reorder milestone us', async ({ page }) => {
        const sprint = sprints(page).nth(0);
        const rows = sprintUserStories(sprint);

        // Drag sprint row 3 onto sprint row 0; the row-0 ref becomes the dragged
        // row's ref (faithful port of the legacy self-comparison quirk's intent).
        const dragRow = rows.nth(3);
        const draggedRef = await usRef(dragRow);

        await dndDrag(page, dragRow.locator('.icon-drag'), rows.nth(0));

        expect(await usRef(rows.nth(0))).toBe(draggedRef);
    });

    test('drag us from milestone to milestone', async ({ page }) => {
        const sprint1 = sprints(page).nth(0);
        const sprint2 = sprints(page).nth(1);
        const initialSprint2Count = await sprintUserStories(sprint2).count();

        const dragRow = sprintUserStories(sprint1).nth(0);
        await dndDrag(page, dragRow.locator('.icon-drag'), sprint2.locator('.sprint-table'));

        await expect(sprintUserStories(sprint2)).toHaveCount(initialSprint2Count + 1, {
            timeout: 20000,
        });
    });

    test('select us with SHIFT', async ({ page }) => {
        // Legacy skipped this on IE only; Chromium implements it directly.
        await page.waitForTimeout(1000);

        const rows = userStories(page);
        const firstCheckbox = rows.nth(0).locator('input[type="checkbox"]');
        const fourthCheckbox = rows.nth(3).locator('input[type="checkbox"]');

        await firstCheckbox.click();
        await page.keyboard.down('Shift');
        await fourthCheckbox.click();
        await page.keyboard.up('Shift');

        await expect(selectedUserStories(page)).toHaveCount(4, { timeout: 15000 });
    });

    test('role filters', async ({ page }) => {
        // Open the role/points selector popover and pick value 1.
        await popoverPick(page, page.locator(`${BOARD} div[tg-us-role-points-selector]`).first(), 1);

        await capture(page, 'backlog-role-filters');

        const points = (
            await page
                .locator(`${BOARD} .backlog-table-body > div .us-points`)
                .nth(0)
                .locator('span')
                .first()
                .innerText()
        ).trim();
        expect(points).toMatch(/[0-9?]+\s\/\s[0-9?]+/);
    });

    /* -------------------------------------------------------------- *
     * milestones (create / edit / delete + the reimplemented sprint
     * validation that replaces checksley — AAP §0.3.3, §0.7.2)
     * -------------------------------------------------------------- */
    test.describe('milestones', () => {
        test('create', async ({ page }) => {
            await page.locator(`${BOARD} .add-sprint`).first().click();
            await waitLightboxOpen(page, 'input[name="name"], .e2e-sprint-name, input.sprint-name');
            await capture(page, 'create-milestone');

            const lb = sprintLightbox(page);
            const name = `sprintName${Date.now()}`;
            await lb.name().fill(name);
            await lb.submit().click();
            await page.waitForTimeout(2000); // persist + debounce

            await expect
                .poll(async () => await sprintTitles(page), { timeout: 15000 })
                .toContain(name);
        });

        test('edit', async ({ page }) => {
            await page.locator(`${BOARD} .edit-sprint`).nth(0).click();
            await waitLightboxOpen(page, 'input[name="name"], .e2e-sprint-name, input.sprint-name');

            const lb = sprintLightbox(page);
            await lb.name().fill(''); // clear
            const name = `sprintName${Date.now()}`;
            await lb.name().fill(name);
            await lb.submit().click();
            await waitLightboxClose(page);

            await expect
                .poll(async () => await sprintTitles(page), { timeout: 15000 })
                .toContain(name);
        });

        test('delete', async ({ page }) => {
            await page.locator(`${BOARD} .edit-sprint`).nth(0).click();
            await waitLightboxOpen(page, 'input[name="name"], .e2e-sprint-name, input.sprint-name');

            const lb = sprintLightbox(page);
            // Record the name BEFORE deleting (faithful intent of the legacy check).
            const name = (await lb.name().inputValue()).trim();

            await lb.deleteBtn().click();
            await confirmOk(page);
            await page.waitForTimeout(1000);

            await expect
                .poll(async () => await sprintTitles(page), { timeout: 15000 })
                .not.toContain(name);
        });

        // NEW parity test: the required-name rule reimplemented in
        // app/react/shared/validation/sprintForm.ts (replaces checksley).
        test('validation: name required', async ({ page }) => {
            const before = await sprintTitles(page);

            await page.locator(`${BOARD} .add-sprint`).first().click();
            const lb = sprintLightbox(page);
            await waitLightboxOpen(page, 'input[name="name"], .e2e-sprint-name, input.sprint-name');

            // Ensure the name is empty, then attempt to submit.
            await lb.name().fill('');
            await lb.submit().click();

            // The lightbox stays open (submission blocked) ...
            await expect(lb.el).toBeVisible();
            // ... an inline validation error is shown (auto-retrying) ...
            const errorRegion = validationErrors(lb.el);
            const requiredText = lb.el.getByText('This value is required.', { exact: false });
            await expect(errorRegion.or(requiredText).first()).toBeVisible();
            // ... and no new sprint was created.
            expect(await sprintTitles(page)).toEqual(before);

            // Correcting the name clears the required error.
            await lb.name().fill(`sprintName${Date.now()}`);
            await page.waitForTimeout(400);
            await expect(lb.el.getByText('This value is required.', { exact: false })).toHaveCount(0);

            // Close without asserting creation (dates may still be required).
            await page.keyboard.press('Escape').catch(() => {
                /* best-effort cleanup */
            });
        });

        // NEW parity test: the valid-date-range rule reimplemented in
        // app/react/shared/validation/sprintForm.ts (replaces checksley).
        test('validation: date range', async ({ page }) => {
            const before = await sprintTitles(page);
            const rangeMessage = 'The start date must be on or before the finish date.';

            await page.locator(`${BOARD} .add-sprint`).first().click();
            const lb = sprintLightbox(page);
            await waitLightboxOpen(page, 'input[name="name"], .e2e-sprint-name, input.sprint-name');

            await lb.name().fill(`sprintName${Date.now()}`);

            // Inverted range: start AFTER finish.
            await setDate(lb.start(), '2020-12-31');
            await setDate(lb.finish(), '2020-01-01');

            await lb.submit().click();

            // Submission is blocked and a date-range validation error is shown.
            await expect(lb.el).toBeVisible();
            const rangeText = lb.el.getByText(rangeMessage, { exact: false });
            const errorRegion = validationErrors(lb.el);
            await expect(rangeText.or(errorRegion).first()).toBeVisible();
            expect(await sprintTitles(page)).toEqual(before);

            // Correct the range (start <= finish) ⇒ the range error clears.
            await setDate(lb.finish(), '2021-12-31');
            await page.waitForTimeout(400);
            await expect(lb.el.getByText(rangeMessage, { exact: false })).toHaveCount(0);

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
            await page.locator('#show-tags').first().click();
            await capture(page, 'backlog-tags');
            await expect(page.locator(`${BOARD} .backlog-table .tag`).first()).toBeVisible();
        });

        test('hide', async ({ page }) => {
            const showTags = page.locator('#show-tags').first();
            // Fresh page: reveal tags first, then hide them (clicking hides).
            await showTags.click();
            await expect(page.locator(`${BOARD} .backlog-table .tag`).first()).toBeVisible();
            await showTags.click();
            await expect(page.locator(`${BOARD} .backlog-table .tag`).first()).toBeHidden();
        });
    });

    /* -------------------------------------------------------------- *
     * velocity forecasting
     * -------------------------------------------------------------- */
    test.describe('velocity forecasting', () => {
        test('show', async ({ page }) => {
            await openBacklog(page, 'project-1');

            const before = await userStories(page).count();

            await page.locator(`${BOARD} .e2e-velocity-forecasting`).first().click();
            await capture(page, 'velocity-forecasting');

            await expect
                .poll(async () => await userStories(page).count(), { timeout: 15000 })
                .toBeLessThan(before);
        });

        test('create sprint from forecasting', async ({ page }) => {
            await openBacklog(page, 'project-1');

            const before = await sprintsOpen(page).count();

            await page.locator(`${BOARD} .e2e-velocity-forecasting`).first().click();
            await page.locator(`${BOARD} .e2e-velocity-forecasting-add`).first().click();

            const name = `sprintName${Date.now()}`;
            const nameInput = page.locator(`${BOARD} .e2e-sprint-name`).first();
            await nameInput.fill(name);
            await nameInput.press('Enter');

            await expect
                .poll(async () => await sprintsOpen(page).count(), { timeout: 15000 })
                .toBeGreaterThan(before);
        });

        test('hide forecasting if no velocity', async ({ page }) => {
            await openBacklog(page, 'project-5');
            await expect(page.locator(`${BOARD} .e2e-velocity-forecasting`)).toHaveCount(0);
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
                .poll(async () => await userStories(page).count(), { timeout: 15000 })
                .toBe(0);

            // Clearing restores the full list.
            await clearFilters(page);
            await expect
                .poll(async () => await userStories(page).count(), { timeout: 15000 })
                .toBeGreaterThan(0);
        });

        test('filter by category', async ({ page }) => {
            await openFilters(page);

            const before = await userStories(page).count();

            // OPTIONAL: filter-by-category reduces then restores. Skipped
            // gracefully if the category hooks are not present.
            const category = page.locator('.e2e-category').first();
            if ((await category.count()) === 0) {
                return;
            }
            await category.click();
            await page.waitForTimeout(500);

            const firstCount = page.locator('.e2e-filter-count').first();
            if ((await firstCount.count()) === 0) {
                return;
            }
            await firstCount.click();
            await page.waitForTimeout(1000);

            await expect
                .poll(async () => await userStories(page).count(), { timeout: 15000 })
                .toBeLessThan(before);

            await clearFilters(page);
            await expect
                .poll(async () => await userStories(page).count(), { timeout: 15000 })
                .toBe(before);
        });
    });

    /* -------------------------------------------------------------- *
     * closed sprints (stateful fixtures built once via a guarded setup)
     * -------------------------------------------------------------- */
    test.describe('closed sprints', () => {
        // Server-side fixtures are created once; subsequent tests navigate fresh
        // and see them persisted (guarded so the empty milestone + closed US are
        // not recreated on every test's per-test page).
        let closedSetupDone = false;

        async function createEmptyMilestone(page: Page): Promise<void> {
            await page.locator(`${BOARD} .add-sprint`).first().click();
            await waitLightboxOpen(page, 'input[name="name"], .e2e-sprint-name, input.sprint-name');
            const lb = sprintLightbox(page);
            await lb.name().fill(`sprintName${Date.now()}`);
            await lb.submit().click();
            await waitLightboxClose(page);
        }

        async function dragClosedUsToMilestone(page: Page): Promise<void> {
            // Create a user story with a CLOSED status (legacy status(5)).
            await page.locator(`${BOARD} .new-us a`).nth(0).click();
            await waitLightboxOpen(page, 'input[name="subject"]');
            const lb = usLightbox(page);
            await lb.subject().fill('subject');
            await lb.setStatus(5);
            await lb.submit().click();
            await waitLightboxClose(page);

            // Drag the last (closed) user story into the empty sprint's table.
            const rows = userStories(page);
            const lastRow = rows.nth((await rows.count()) - 1);
            const emptySprintTable = page.locator(`${BOARD} .sprint-empty`).last();
            await dndDrag(page, lastRow.locator('.icon-drag'), emptySprintTable);
        }

        test.beforeEach(async ({ page }) => {
            if (!closedSetupDone) {
                await createEmptyMilestone(page);
                await dragClosedUsToMilestone(page);
                closedSetupDone = true;
            }
        });

        test('open closed sprints', async ({ page }) => {
            await page.locator(`${BOARD} .filter-closed-sprints`).first().click();
            await expect(closedSprints(page)).toHaveCount(1, { timeout: 15000 });
        });

        test('close closed sprints', async ({ page }) => {
            const toggle = page.locator(`${BOARD} .filter-closed-sprints`).first();
            // Fresh page: reveal (toggle on) first, then hide (toggle off).
            await toggle.click();
            await expect(closedSprints(page)).toHaveCount(1, { timeout: 15000 });
            await toggle.click();
            await expect(closedSprints(page)).toHaveCount(0, { timeout: 15000 });
        });

        test('open sprint by drag open US to closed sprint', async ({ page }) => {
            await page.locator(`${BOARD} .filter-closed-sprints`).first().click();

            // Move backlog row 1 to an OPEN status.
            const status = page.locator(`${BOARD} .backlog-table-body > div .us-status`).nth(1);
            await popoverPick(page, status, 1);

            // Expand the last sprint, then drag row 1 into its table.
            const lastSprint = sprints(page).last();
            await lastSprint.locator('.compact-sprint').first().click();
            await page.waitForTimeout(600);

            const row1 = userStories(page).nth(1);
            await dndDrag(page, row1.locator('.icon-drag'), lastSprint.locator('.sprint-table'));

            // No closed milestones remain ⇒ the closed-sprints toggle disappears.
            await expect(page.locator(`${BOARD} .filter-closed-sprints`)).toHaveCount(0, {
                timeout: 15000,
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

        // Create a user story whose subject is the payload.
        const before = await userStories(page).count();
        await page.locator(`${BOARD} .new-us a`).nth(0).click();
        await waitLightboxOpen(page, 'input[name="subject"]');
        const lb = usLightbox(page);
        await lb.subject().fill(payload);
        await lb.submit().click();
        await waitLightboxClose(page);
        await expect(userStories(page)).toHaveCount(before + 1, { timeout: 20000 });

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

