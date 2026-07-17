/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * [C-08] Auth-fixture smoke test.
 * ==============================================================================
 * Every authenticated suite in this tree (kanban.spec.ts, backlog.spec.ts)
 * depends on the AUTO-USE `autoLogin` fixture in ./fixtures/session, which
 * performs a REAL UI login before each test. The previous revision of that
 * fixture submitted the login form with the selector `.submit-button`, which
 * DOES NOT EXIST in this version of the AngularJS login form
 * (app/partials/includes/modules/login-form.jade). Because the submit never
 * fired, the login never completed and EVERY case that relied on the fixture was
 * blocked at setup.
 *
 * This spec pins that contract directly: it asserts that after the fixture runs,
 * the app has reached the AUTHENTICATED shared session — i.e. the (still-
 * AngularJS) login screen established `localStorage["token"]` (the JWT bearer
 * the React screens reuse via app/react/shared/session/auth.ts, AAP §0.6.1) and
 * the client is at its root rather than parked on `/login`. If the login
 * selector regresses again, this test fails FAST and unambiguously — instead of
 * every downstream Kanban/Backlog case failing opaquely inside its own
 * navigation.
 *
 * LIVE-STACK REQUIREMENT (see [C-01] in playwright.config.ts): like all suites
 * here, this test drives the REAL client and backend and therefore requires the
 * full stack to be running at the configured baseURL (default the taiga-docker
 * gateway http://localhost:9000/, backed by the out-of-scope taiga-back API).
 * It is not a browserless unit test.
 */

import { test, expect } from './fixtures/session';

test.describe('auth fixture', () => {
    test('auto-login reaches the authenticated shared session', async ({ page }) => {
        // 1. The auto-use fixture logged in before this body ran. The login
        //    screen must have redirected the client back to its root (not left
        //    it parked on `/login`).
        await expect
            .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
            .not.toContain('login');

        // 2. The JWT bearer token the whole app (AngularJS + React) shares must
        //    now be present in localStorage under the "token" key. This is the
        //    single source of truth the React adapters read (AAP §0.6.1); its
        //    presence proves the real login completed via the fixture.
        const token = await page.evaluate(() => window.localStorage.getItem('token'));
        expect(token, 'expected localStorage["token"] to be set after auto-login').toBeTruthy();
    });
});
