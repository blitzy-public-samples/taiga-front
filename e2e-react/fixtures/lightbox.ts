/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Playwright port of the legacy Protractor `e2e/utils/lightbox.js` modal helper.
 *
 * Taiga lightboxes (modals) toggle visibility purely through the `open` CSS
 * class on their `.lightbox` container. The legacy AngularJS screens and the
 * migrated React screens emit the *same* DOM and class names
 * (`.lightbox.open`, `.lightbox-generic-ask`, `.button-green`, `.button-red`,
 * `.close`), so this helper drives both the `baseline` (stock AngularJS) and
 * `react` Playwright projects completely unchanged.
 *
 * The helper is written as a factory: it captures the {@link Page} once and
 * returns a set of nested async functions that can call one another
 * (`confirmOk`, `confirmCancel` and `exit` delegate to `open`/`close`). This
 * mirrors the object-literal surface of the original CommonJS module while
 * remaining strictly typed.
 *
 * Only `@playwright/test` APIs are used here — there are no Protractor or
 * AngularJS globals. `expect` is imported from `@playwright/test` directly
 * (never from the `./index` fixtures barrel) to avoid a circular import,
 * because that barrel re-exports `lightbox` from this very module.
 *
 * @param page - The Playwright {@link Page} the lightbox is rendered on.
 * @returns An object exposing `open`, `close`, `confirmOk`, `confirmCancel`
 *          and `exit`, matching the surface the Protractor helper provided.
 */
export function lightbox(page: Page) {
    // Matches the legacy timing exactly: a 300ms CSS transition plus a 100ms
    // settle buffer (the source performed `browser.sleep(transition + 100)`).
    // This is behavioral timing reproduced for parity, not a performance SLA.
    const TRANSITION = 400;

    /**
     * Wait until the lightbox identified by `selector` is fully open.
     *
     * Port of `lightbox.open`: the original polled
     * `common.hasClass(el, 'open')` for up to 4000ms and then slept for the
     * transition duration. Playwright's `toHaveClass(RegExp)` matches against
     * the element's full `class` attribute and auto-retries, so it replaces
     * the manual `browser.wait` poll. The `/\bopen\b/` word boundaries match
     * the standalone `open` token exactly — the same semantics as the legacy
     * `class.split(' ').indexOf('open') !== -1` check — and never a class that
     * merely contains the substring "open".
     *
     * @param selector - CSS selector for the `.lightbox` container.
     */
    async function open(selector: string): Promise<void> {
        const el = page.locator(selector);

        await expect(el).toHaveClass(/\bopen\b/, { timeout: 4000 });
        await page.waitForTimeout(TRANSITION);
    }

    /**
     * Wait until the lightbox identified by `selector` is closed.
     *
     * Port of `lightbox.close`: the original first checked `el.isPresent()`
     * and treated an absent element as already-closed (returning `true`
     * without waiting). That tolerance is reproduced here by returning early
     * when the locator resolves to zero elements; otherwise the assertion
     * waits (auto-retrying up to 4000ms) for the `open` token to disappear.
     *
     * @param selector - CSS selector for the `.lightbox` container.
     */
    async function close(selector: string): Promise<void> {
        const el = page.locator(selector);

        // The source tolerated a not-present element as "closed" (it returned
        // true). If nothing matches the selector, there is nothing to wait on.
        if ((await el.count()) === 0) {
            return;
        }

        await expect(el).not.toHaveClass(/\bopen\b/, { timeout: 4000 });
    }

    /**
     * Confirm the generic "ask" dialog by clicking its green (OK) button.
     *
     * Port of `lightbox.confirm.ok`: opens `.lightbox-generic-ask`, clicks the
     * `.button-green` control, then waits for the dialog to close.
     */
    async function confirmOk(): Promise<void> {
        const sel = '.lightbox-generic-ask';

        await open(sel);
        await page.locator(`${sel} .button-green`).click();
        await close(sel);
    }

    /**
     * Cancel the generic "ask" dialog by clicking its red (cancel) button.
     *
     * Port of `lightbox.confirm.cancel`: opens `.lightbox-generic-ask`, clicks
     * the `.button-red` control, then waits for the dialog to close.
     */
    async function confirmCancel(): Promise<void> {
        const sel = '.lightbox-generic-ask';

        await open(sel);
        await page.locator(`${sel} .button-red`).click();
        await close(sel);
    }

    /**
     * Dismiss a lightbox via its `.close` control.
     *
     * Port of `lightbox.exit`: clicks the first `.close` element inside the
     * given lightbox, then waits for the lightbox to close.
     *
     * @param selector - CSS selector for the `.lightbox` container to exit.
     */
    async function exit(selector: string): Promise<void> {
        await page.locator(selector).locator('.close').first().click();
        await close(selector);
    }

    return { open, close, confirmOk, confirmCancel, exit };
}
