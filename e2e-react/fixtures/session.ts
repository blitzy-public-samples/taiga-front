/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * Shared Playwright auth/session fixture for the React Kanban + Backlog e2e
 * parity suites (e2e-react/kanban.spec.ts, e2e-react/backlog.spec.ts).
 *
 * The sibling suites import the extended `test` (and `expect`) from here:
 *
 *     import { test, expect } from './fixtures/session';
 *
 * WHAT THIS DOES
 * --------------
 * It extends the base @playwright/test `test` with an AUTO-USE, page-scoped
 * fixture that performs a REAL UI login (admin / 123123) before EVERY test, so
 * each spec starts authenticated. Crucially, the fixture DOES NOT mint or write
 * any credentials of its own: the (still-AngularJS) login screen is what
 * establishes the shared `localStorage["token"]` (JWT bearer) and the one-time
 * session identifier the app keeps on the `window` global. The React screens
 * read those SAME globals via app/react/shared/session/auth.ts +
 * app/react/shared/session/sessionId.ts, so both frameworks operate on ONE
 * session (AAP §0.6.1). A divergent React
 * session id would make the events backend echo the React screen's own
 * optimistic updates back to it — hence "never a parallel session".
 *
 * PROVENANCE (REFERENCE ONLY — nothing below is imported from the legacy tree)
 * ---------------------------------------------------------------------------
 * This is a faithful Playwright port of the login/warm-up performed by the
 * legacy WebDriver-based config's `onPrepare` in taiga-front/conf.e2e.js (plus
 * the `closeCookies` / `closeJoyride` helpers in taiga-front/e2e/utils/common.js).
 * Those legacy files are read as a reference only. To preserve test-layer
 * isolation (AAP §0.6.3) this module imports ONLY from `@playwright/test` — no
 * legacy e2e helper modules, no legacy WebDriver globals, and no legacy
 * assertion library.
 *
 * RUNTIME / TOOLING
 * -----------------
 * Playwright 1.44.1 on Node v16.19.1 — only APIs available in Playwright 1.44
 * are used. Playwright transpiles this .ts file itself; there is NO ts-jest /
 * tsc / gulp build step for the e2e-react/ tree, so this file is intentionally
 * outside app/react/**'s tsconfig.json.
 */

import { test as base, expect, Page } from '@playwright/test';

/**
 * Normalize the configured base URL so that `${base}login` always resolves to a
 * single, well-formed path segment.
 *
 * The base URL is supplied by e2e-react/playwright.config.ts via the built-in
 * Playwright `baseURL` fixture (which reads `process.env.E2E_BASE_URL` and
 * defaults to the taiga-docker gateway at http://localhost:9000/). We never
 * hard-code the URL here and never import the config; we only guarantee a
 * trailing slash and apply the same defensive http://localhost:9000/ fallback
 * in case `baseURL` is undefined. (The legacy WebDriver host/port is reference
 * only and is deliberately NOT used here.)
 *
 * @param url The `baseURL` fixture value (may be undefined).
 * @returns A base URL that ends in exactly one `/`.
 */
function normalizeBase(url: string | undefined): string {
    const raw = url && url.length ? url : 'http://localhost:9000/';
    return raw.endsWith('/') ? raw : `${raw}/`;
}

/**
 * Reproduce the legacy conf.e2e.js `onPrepare` login/warm-up (REFERENCE ONLY —
 * nothing is imported from the legacy e2e tree). Performs a REAL UI login as
 * admin/123123 so the AngularJS app establishes the shared
 * `localStorage["token"]` (JWT) and the one-time session identifier the app
 * keeps on `window`, which the React screens also read. This fixture MUST NOT
 * mint its own token or session id (AAP §0.6.1).
 *
 * The credentials authenticate against the seeded `sample_data` fixtures so the
 * ported scenarios can later reach the expected projects (project-1 kanban;
 * project-3 and project-2 backlog — the phantom `project-0` the legacy suite
 * used never existed in sample_data, QA F-03). This helper does not navigate to
 * any project — the specs do — its login is simply what makes them reachable.
 *
 * @param page    The page provided by the Playwright `page` fixture.
 * @param baseURL The value of the Playwright `baseURL` fixture (may be undefined).
 */
async function login(page: Page, baseURL: string | undefined): Promise<void> {
    const base = normalizeBase(baseURL);

    // 1. Land on the client root (same origin) so window storage is accessible.
    await page.goto(base);

    // 2-4. Clear session/local storage and flag the e2e run in a single script
    //      evaluation (mirrors the three legacy executeScript calls that did
    //      sessionStorage.clear, localStorage.clear, and localStorage.e2e = true).
    await page.evaluate(() => {
        window.sessionStorage.clear();
        window.localStorage.clear();
        window.localStorage.setItem('e2e', 'true');
    });

    // 5. Navigate to the (still-AngularJS, not-migrated) login screen.
    await page.goto(`${base}login`);

    // 6-7. Fill credentials for the seeded sample_data admin user. These
    //      selectors belong to the AngularJS login form, which is not migrated,
    //      so they remain valid post-migration.
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', '123123');

    // 8. Submit the login form.
    //    [C-08] The prior selector `.submit-button` DOES NOT EXIST in this
    //    version of the AngularJS login form and blocked every authenticated
    //    test. The authoritative markup is
    //    app/partials/includes/modules/login-form.jade:
    //        form.login-form > fieldset.end > button(type="submit"
    //            translate="LOGIN_COMMON.ACTION_SIGN_IN")
    //    so the login form's submit is `form.login-form button[type="submit"]`.
    //    (The login form is the still-AngularJS, not-migrated screen, so this
    //    selector is stable post-migration.)
    await page.click('form.login-form button[type="submit"]');

    // 9. Wait (<=10s) until the app redirects back to the client root. The
    //    robust equivalent of the legacy `url === host` check is a pathname of
    //    '/' (ignoring host/port/query differences between environments).
    await page.waitForURL((u) => u.pathname === '/', { timeout: 10000 });

    // 10. Close the cookie-consent banner (legacy closeCookies helper): the app
    //     reads this cookie to suppress the banner.
    await page.evaluate(() => {
        document.cookie = 'cookieConsent=1';
    });

    // 11. Close the intro.js joyride if it is showing (legacy closeJoyride
    //     helper). There is no waitForAngular() equivalent in Playwright, so we
    //     probe for the skip button gracefully and treat its absence as a no-op
    //     — the e2e flag usually suppresses the joyride, and a missing joyride
    //     must NEVER fail the test.
    const skip = page.locator('.introjs-skipbutton');
    try {
        await skip.waitFor({ state: 'visible', timeout: 2000 });
        await skip.click();
        // Condition-based wait (no fixed sleep): the joyride overlay tears down
        // after the skip click, so wait for the skip button to detach/hide.
        await skip.waitFor({ state: 'hidden', timeout: 5000 });
    } catch {
        // Joyride not shown — nothing to close. Intentionally swallowed.
    }

    // 12. Reload so the app re-initializes fully authenticated (the legacy flow
    //     ended with a final navigation to the host). The token + sessionId
    //     established above persist across the reload, keeping the single shared
    //     session intact.
    await page.reload();
}

/**
 * Fixture typing added on top of the base Playwright fixtures.
 */
type AuthFixtures = {
    /**
     * Auto-use, page-scoped fixture: logs in before every test so each spec
     * starts authenticated against the SAME shared session the app uses. It
     * exposes no value (void) — its only purpose is the side-effecting login.
     */
    autoLogin: void;
};

/**
 * The `test` object the parity suites import. It is the base @playwright/test
 * `test` extended with the auto-use `autoLogin` fixture, so every test in the
 * e2e-react suites is authenticated before its body runs — without the spec
 * having to reference the fixture by name.
 *
 * Note: there is no `storageState`, global-setup, or `webServer` here. The
 * client is assumed to be already running (matching the legacy model); login is
 * performed per-test through the real UI.
 */
export const test = base.extend<AuthFixtures>({
    autoLogin: [
        async ({ page, baseURL }, use) => {
            await login(page, baseURL);
            await use();
        },
        { auto: true },
    ],
});

// Re-export the base assertion library so suites can do a single import:
//     import { test, expect } from './fixtures/session';
export { expect };
