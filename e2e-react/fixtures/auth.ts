/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Authentication fixture — React end-to-end layer.
 * ===========================================================================
 *
 * TECHNOLOGY-SPECIFIC CHANGE (AngularJS 1.5.10 -> React 18 migration).
 *
 * This is the foundational file of `e2e-react/`: the SINGLE point at which the
 * admin credential is resolved, plus the shared login/settle glue that every
 * page object under `e2e-react/pages/` and every spec under `e2e-react/specs/`
 * builds on. `playwright.config.ts` names it as such.
 *
 * WHY A SINGLE RESOLUTION POINT IS A CORRECTNESS PROPERTY
 * ---------------------------------------------------------------------------
 * The migration is accepted on the strength of a two-phase visual capture: the
 * AngularJS baseline first, then the React rebuild, both photographed against
 * the same database volume. Every one of those captures starts by logging in.
 *
 * The admin account is created out-of-band, before any capture, with the
 * explicit environment-forwarding form of `createsuperuser`:
 *
 *     docker compose -f docker-compose.yml -f docker-compose-inits.yml run --rm \
 *       -e DJANGO_SUPERUSER_PASSWORD="${TAIGA_ADMIN_PASSWORD:-admin123}" \
 *       taiga-manage createsuperuser --noinput --username admin \
 *         --email admin@example.com
 *
 * The shorter `./taiga-manage.sh createsuperuser --noinput` form does NOT
 * forward the variable into the container and silently produces an unusable
 * account; an *unset* variable expanding to empty reproduces the identical
 * silent failure through an apparently correct command. Resolving the value
 * here — once, with one documented fallback, and never as an empty string —
 * is what makes the creation-time value and every login-time value identical
 * BY CONSTRUCTION rather than by convention.
 *
 * Nothing else in `e2e-react/` may read `TAIGA_ADMIN_PASSWORD`. Import
 * {@link adminCredentials} (or {@link adminPassword}) instead.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * It never mutates state. No user creation, no project creation, no seeding,
 * no reseeding, no logout, no role switching. The seeded dataset is generated
 * exactly once, out-of-band, and re-running it between the two capture phases
 * would make the artifacts incomparable — `e2e-react/fixtures/seed.ts` only
 * asserts that dataset's presence, and this file only authenticates against it.
 *
 * PROVENANCE
 * ---------------------------------------------------------------------------
 * Behaviour — not code — is ported from the retired Protractor helper
 * `e2e/utils/common.js`, which stays in the repository unchanged for the 17
 * surviving suites. The shapes differ completely (CommonJS on ambient
 * Protractor globals vs. ESM TypeScript on explicit imports), so each ported
 * step below cites its origin by file and line and records every deliberate
 * divergence:
 *
 *     e2e/utils/common.js L45-L49    hasClass       -> waitLoader (class match)
 *     e2e/utils/common.js L118-L126  waitLoader     -> waitLoader
 *     e2e/utils/common.js L153-L157  closeCookies   -> acceptCookieConsent
 *     e2e/utils/common.js L159-L174  login          -> login
 *     e2e/utils/common.js L494-L503  closeJoyride   -> closeJoyride
 *
 * Not ported, on purpose: `common.logout` (L176-L191, no logout capability is
 * required), `common.takeScreenshot` (L128-L151, it writes into the git-ignored
 * `e2e/screenshots/`, whereas capture is owned by `playwright.config.ts` and
 * the specs and must land under the tracked `e2e-react/artifacts/`),
 * `common.prepare` (L193-L197, subsumed by {@link login}), `common.drag` /
 * `common.dragEnd` (L199-L230, drag belongs to the page objects) and
 * `common.createProject` (L505+, it mutates the backend).
 *
 * @see e2e-react/fixtures/seed.ts - asserts the seeded dataset, never reseeds
 */

import { test as base, errors, expect, type Page } from "@playwright/test";

/* ===========================================================================
 * Credentials
 * ======================================================================== */

/**
 * The account every capture authenticates as.
 *
 * Matches `--username admin` in the out-of-band `createsuperuser` invocation
 * quoted in the module header. It is a superuser, so it can reach every seeded
 * project without membership juggling.
 */
export const ADMIN_USERNAME = "admin";

/**
 * Documented development default for the admin password.
 *
 * This is the ONLY credential literal permitted anywhere in `e2e-react/`, and
 * it is deliberate rather than an oversight: the stack under test is a
 * self-contained localhost proof of concept, `TAIGA_ADMIN_PASSWORD` exists
 * nowhere else in the repository, and a missing injected value must never
 * block an automated run. It is intentionally NOT exported — callers go
 * through {@link adminPassword} so there is exactly one resolution path.
 *
 * Note what this is NOT: the retired Protractor suites hardcode a different,
 * upstream fixture password (`e2e/suites/auth/auth.e2e.js` L82). That value
 * does not exist in this deployment and is deliberately not carried over.
 */
const DEV_DEFAULT_ADMIN_PASSWORD = "admin123";

/** Resolved credential pair, as consumed by {@link login}. */
export interface AdminCredentials {
    readonly username: string;
    readonly password: string;
}

/* ===========================================================================
 * Selectors
 *
 * Every selector below was verified against the DEPLOYED bundle served by the
 * nginx gateway, not merely against the Jade sources, because the two can
 * diverge and one of them does (see LOGIN_SUBMIT_SELECTOR).
 * ======================================================================== */

/** Login form username field. Unchanged from `e2e/utils/common.js` L162. */
const USERNAME_INPUT_SELECTOR = 'input[name="username"]';

/** Login form password field. Unchanged from `e2e/utils/common.js` L163. */
const PASSWORD_INPUT_SELECTOR = 'input[name="password"]';

/**
 * Login form submit control — the one DELIBERATE DIVERGENCE from the incumbent.
 *
 * `e2e/utils/common.js` L165 clicks a bare `.submit-button`. That class is NOT
 * present on the login screen: `app/partials/includes/modules/login-form.jade`
 * renders the control as `button.btn-small.full(variant="primary"
 * type="submit")`, and the compiled `auth/login.html` inside the deployed
 * `templates.js` confirms it verbatim —
 *
 *     <button variant="primary" type="submit" title="..."
 *             translate="LOGIN_COMMON.ACTION_SIGN_IN" class="btn-small full">
 *
 * `.submit-button` is defined at `app/styles/components/buttons.scss:194` and
 * used by other forms (lightboxes, admin, user settings), so the incumbent
 * selector is simply stale here. Porting it literally would match zero
 * elements, stall for the configured action timeout and fail every login —
 * which would silently destroy the entire capture chain.
 *
 * The selector list therefore targets the submit control by its type, scoped to
 * the login form so it can never reach another form's button, while still
 * accepting the historical class should it ever be restored. Both branches
 * resolve to the same single element, so the locator stays strict.
 */
const LOGIN_SUBMIT_SELECTOR =
    'form.login-form button[type="submit"], form.login-form .submit-button';

/**
 * The application's single global loading overlay.
 *
 * `app/partials/includes/modules/loader.jade` renders `.loader(tg-loader)` and
 * `app/index.jade` L60 includes it exactly once, so this resolves to one
 * element for the lifetime of the page.
 */
const LOADER_SELECTOR = ".loader";

/** Class the loader carries while a route is still resolving. */
const LOADER_ACTIVE_CLASS = "active";

/**
 * Intro.js "skip" control, i.e. the guided-tour dismissal.
 *
 * Supplied by the `intro.js` dependency rather than by application markup, so
 * the class name cannot be derived from `app/` sources; it is taken from the
 * incumbent helper (`e2e/utils/common.js` L497) and was confirmed present in
 * the deployed `libs.js` bundle.
 */
const JOYRIDE_SKIP_SELECTOR = ".introjs-skipbutton";

/**
 * Login route, relative to the `baseURL` declared in `playwright.config.ts`.
 *
 * Relative on purpose: the origin is configured in exactly one place, so no
 * host or port literal appears in this file and the fixture cannot drift onto
 * a different origin than the one the config captures.
 */
const LOGIN_PATH = "/login";

/* ===========================================================================
 * Timeout budgets
 *
 * Reproduced from the incumbent rather than invented, so a wait that used to
 * pass does not start failing (or start hiding a regression) after the port.
 * ======================================================================== */

/** Post-submit navigation budget. From `e2e/utils/common.js` L171. */
const LOGIN_URL_TIMEOUT_MS = 10000;

/** Loader settle budget. From `e2e/utils/common.js` L125. */
const LOADER_TIMEOUT_MS = 5000;

/** Post-dismissal settle. From `browser.sleep(600)`, `common.js` L501. */
const JOYRIDE_SETTLE_MS = 600;

/**
 * Upper bound on how long the guided tour is given to appear before concluding
 * that no tour is configured for this route.
 *
 * The incumbent needed no such value because `browser.waitForAngular()`
 * (`common.js` L495) implicitly waited for AngularJS's pending `$http` traffic
 * to drain, and the tour is gated on exactly such a request — see
 * {@link closeJoyride}. Playwright has no digest-aware equivalent, so the wait
 * has to be explicit. The incumbent's own loader budget is reused rather than a
 * new number invented; it is a ceiling only, since the wait resolves the
 * instant the control appears.
 */
const JOYRIDE_APPEAR_TIMEOUT_MS = LOADER_TIMEOUT_MS;

/**
 * Cookie written to suppress the cookie-consent banner.
 *
 * Name and value are reproduced exactly from `e2e/utils/common.js` L155
 * (`document.cookie='cookieConsent=1'`). The name cannot be inferred from the
 * application sources — it appears nowhere under `app/` — because the banner is
 * injected by a hosted-deployment plugin, so it must not be "improved".
 */
const COOKIE_CONSENT_STATEMENT = "cookieConsent=1";

/* ===========================================================================
 * Credential resolution — the single point
 * ======================================================================== */

/**
 * Resolves the admin password: the injected `TAIGA_ADMIN_PASSWORD` when it
 * carries a value, otherwise the documented development default.
 *
 * Treats an empty string exactly like an unset variable, because that is the
 * precise silent-failure mode this file exists to prevent — an unset shell
 * variable expands to empty, and an empty password would be submitted happily,
 * fail authentication, and leave a green-looking run with worthless artifacts.
 * This function therefore NEVER returns an empty string.
 *
 * The value is read on every call rather than captured at module load, so a
 * spec that adjusts the environment is not silently ignored. The raw value is
 * returned untrimmed: surrounding whitespace can be a legitimate part of a
 * password, and quietly rewriting a credential would be worse than passing it
 * through.
 *
 * @returns a non-empty password string
 */
export function adminPassword(): string {
    const injected = process.env.TAIGA_ADMIN_PASSWORD;

    if (injected !== undefined && injected.length > 0) {
        return injected;
    }

    return DEV_DEFAULT_ADMIN_PASSWORD;
}

/**
 * Resolves the full credential pair used by {@link login}.
 *
 * @returns the admin username paired with {@link adminPassword}'s result
 */
export function adminCredentials(): AdminCredentials {
    return {
        username: ADMIN_USERNAME,
        password: adminPassword(),
    };
}

/* ===========================================================================
 * Ported setup behaviour
 * ======================================================================== */

/**
 * Pre-accepts the cookie-consent banner so it can never reach a capture.
 *
 * PORTED FROM `e2e/utils/common.js` L153-L157, which executed
 * `document.cookie='cookieConsent=1'` in the page.
 *
 * WHY THIS IS ESSENTIAL AND NOT COSMETIC: `playwright.config.ts` sets both
 * `screenshot: "on"` and `video: "on"`, and those artifacts ARE the deliverable
 * evidence of the migration. A consent banner overlaying the board would not
 * fail a single assertion — it would quietly devalue every committed image and
 * every committed video, which is the most dangerous failure mode available
 * here because it looks like success. Do not remove this call as noise.
 *
 * Measured in this deployment, the banner is currently absent: `cookieConsent`
 * appears nowhere under `app/`, zero times in the deployed `app.js`, and the
 * served `index.html` contains no consent markup — the banner ships with a
 * hosted-deployment plugin. The cookie write is therefore a no-op guard TODAY
 * and is retained precisely so that enabling such a plugin cannot silently
 * contaminate the evidence.
 *
 * WHY AN INIT SCRIPT RATHER THAN `context.addCookies`: an init script runs
 * before any of the page's own scripts on every navigation, so the cookie is in
 * place before the AngularJS shell boots and before any banner could render —
 * which is the ordering requirement. It also needs no origin, so this file
 * carries no host or port literal at all. It is registered on the context, so
 * it survives navigations exactly as the incumbent's browser-wide write did.
 *
 * Registration is additive: calling this twice queues two identical writes,
 * which is harmless. {@link login} calls it, so specs normally need not.
 *
 * @param page - the page whose browser context the cookie is registered on
 */
export async function acceptCookieConsent(page: Page): Promise<void> {
    await page.context().addInitScript((cookie: string) => {
        document.cookie = cookie;
    }, COOKIE_CONSENT_STATEMENT);
}

/**
 * Waits until the global loading overlay is no longer active.
 *
 * PORTED FROM `e2e/utils/common.js` L118-L126, which polled the incumbent
 * `hasClass` helper (L45-L49) for up to 5000 ms.
 *
 * WHY `page.waitForLoadState()` IS NOT A SUBSTITUTE: the AngularJS shell keeps
 * `.loader.active` on screen AFTER the HTTP response has landed, while it
 * compiles templates and resolves the route. Load-state completion therefore
 * does not imply the screen is rendered, and asserting at that moment races the
 * very content under test. Every navigation in the incumbent suites is followed
 * by this wait for exactly that reason, so it is exported for page objects and
 * specs to do the same.
 *
 * TWO DELIBERATE HARDENINGS over the incumbent:
 *
 * 1. An ABSENT overlay resolves immediately instead of throwing. The incumbent
 *    called `getAttribute('class')` on the match and would have failed outright
 *    had the element been missing; "no overlay" plainly means "not loading".
 * 2. The match is on the WHOLE class name via `classList.contains`, whose
 *    exact class-list membership test mirrors the incumbent's
 *    `split(' ').indexOf(cls)`. A substring test would wrongly treat a
 *    hypothetical `inactive` as active and hang until the budget expired.
 *
 * Faithful to the incumbent, exceeding the budget REJECTS rather than resolving
 * quietly: `retries: 0` is configured, so a stuck loader must surface as a
 * failure instead of being papered over.
 *
 * @param page - the page to observe
 * @throws if the overlay is still active after 5000 ms
 */
export async function waitLoader(page: Page): Promise<void> {
    await page.waitForFunction(
        (probe: { selector: string; activeClass: string }): boolean => {
            const loader = document.querySelector(probe.selector);

            if (loader === null) {
                return true;
            }

            return !loader.classList.contains(probe.activeClass);
        },
        { selector: LOADER_SELECTOR, activeClass: LOADER_ACTIVE_CLASS },
        { timeout: LOADER_TIMEOUT_MS },
    );
}

/**
 * Dismisses the Intro.js guided tour if it is showing, and does nothing if it
 * is not.
 *
 * PORTED FROM `e2e/utils/common.js` L494-L503.
 *
 * WHY THIS IS MANDATORY RATHER THAN DEFENSIVE: the tour is configured on
 * precisely the screens this migration rebuilds, plus the page login lands on.
 * In `app/coffee/app.coffee` the home route declares `joyride: "dashboard"`
 * (L81), the backlog route `joyride: "backlog"` (L231) and the kanban route
 * `joyride: "kanban"` (L240). Skipping this step leaves the Intro.js overlay
 * covering the board in every committed screenshot and video.
 *
 * WHY THE ORDER IS LOADER-THEN-TOUR, AND WHY THE WAIT IS BOUNDED:
 * `app/modules/components/joy-ride/joy-ride.directive.coffee` starts the tour
 * on `$routeChangeSuccess` only after the route's `loader:end` event, and then
 * only once `currentUserService.loadJoyRideConfig()` resolves — an asynchronous
 * user-storage request. So the tour cannot appear before the loader clears, and
 * it need not have appeared the instant it does. An immediate presence check
 * would race that request; hence {@link waitLoader} first (standing in for the
 * incumbent's `browser.waitForAngular()`, which has no Playwright equivalent)
 * and then a bounded wait for the control itself.
 *
 * ONLY the timeout is swallowed, and only to mean "no tour here". Every other
 * error propagates, so this cannot mask a real fault. Dismissal is also
 * one-shot per account by design: `intro.onexit` calls
 * `currentUserService.disableJoyRide()`, which persists `dashboard`, `backlog`
 * and `kanban` all false (`current-user.service.coffee` L67-L80). Later calls
 * are therefore expected to find nothing and must stay non-fatal.
 *
 * Visibility, not mere presence, is the trigger — a divergence from the
 * incumbent's `isPresent()`. Playwright's `click()` waits for an element to be
 * visible and actionable, so a present-but-hidden control would stall for the
 * full action timeout; visibility is the condition that actually implies a
 * dismissable tour.
 *
 * @param page - the page to inspect and, if a tour is up, act on
 */
export async function closeJoyride(page: Page): Promise<void> {
    await waitLoader(page);

    const skip = page.locator(JOYRIDE_SKIP_SELECTOR).first();

    try {
        await skip.waitFor({
            state: "visible",
            timeout: JOYRIDE_APPEAR_TIMEOUT_MS,
        });
    } catch (error) {
        if (error instanceof errors.TimeoutError) {
            // No tour on this route, or it was already dismissed for this
            // account. Nothing to close — this is the expected steady state.
            return;
        }

        throw error;
    }

    await skip.click();

    // Fixed settle reproducing `browser.sleep(600)` (`common.js` L501). It
    // covers Intro.js tearing its overlay and helper layers back down; those
    // elements are removed by the library rather than by application state, so
    // there is no application-level condition to await instead.
    await page.waitForTimeout(JOYRIDE_SETTLE_MS);
}

/**
 * Authenticates and leaves the browser on the application root, ready for a
 * capture or a navigation.
 *
 * PORTED FROM `e2e/utils/common.js` L159-L174, with the loader wait positioned
 * as `e2e/suites/auth/auth.e2e.js` L37 places it — immediately after the submit
 * and before anything is asserted.
 *
 * Sequence, and why it is this sequence:
 *
 *   1. Register the consent cookie BEFORE the first navigation. The incumbent
 *      set it separately (`common.prepare`, L193-L197) and could therefore set
 *      it too late, after a banner had already rendered; folding it in here
 *      makes ordering impossible to get wrong.
 *   2. Navigate to the login route, relative to the configured `baseURL`.
 *   3. Fill the credential fields and submit.
 *   4. Wait for the application root. This is the incumbent's own success
 *      condition (`url === host`, L170) with its 10000 ms budget. It is
 *      expressed as a predicate on the parsed URL so that it is inherently
 *      tolerant of a trailing slash, which a string comparison against a host
 *      is not; failure keeps the browser on the login route and surfaces as a
 *      timeout rather than as a mysterious later assertion.
 *   5. Settle the loader, then dismiss the guided tour that the landing route
 *      configures.
 *
 * @param page - the page to authenticate
 * @param credentials - override pair; defaults to {@link adminCredentials},
 *   which is the only value any capture should ever use. The parameter exists
 *   solely to preserve the incumbent's `login(username, password)` capability
 *   and is deliberately not a user-management API.
 */
export async function login(
    page: Page,
    credentials: AdminCredentials = adminCredentials(),
): Promise<void> {
    await acceptCookieConsent(page);

    await page.goto(LOGIN_PATH);

    await page.locator(USERNAME_INPUT_SELECTOR).fill(credentials.username);
    await page.locator(PASSWORD_INPUT_SELECTOR).fill(credentials.password);

    await page.locator(LOGIN_SUBMIT_SELECTOR).click();

    await page.waitForURL((url: URL): boolean => url.pathname === "/", {
        timeout: LOGIN_URL_TIMEOUT_MS,
    });

    await waitLoader(page);
    await closeJoyride(page);
}

/* ===========================================================================
 * Playwright fixtures
 * ======================================================================== */

/**
 * The test object every spec in `e2e-react/specs/` should import, extended with
 * an already-authenticated page.
 *
 * Using `authedPage` instead of `page` moves login, consent and tour dismissal
 * out of the specs entirely, so no spec can forget a step and quietly produce a
 * contaminated capture. `expect` is re-exported alongside it so a spec needs a
 * single import line:
 *
 *     import { test, expect } from "../fixtures/auth";
 *
 *     test("board renders", async ({ authedPage }) => {
 *         await authedPage.goto("/project/project-3/kanban");
 *         await waitLoader(authedPage);
 *         await expect(authedPage.locator(".kanban-table")).toBeVisible();
 *     });
 *
 * The fixture only authenticates: it navigates nowhere in particular and
 * changes no data, leaving each spec in charge of its own route. Teardown is
 * intentionally empty — logging out would add a capability the migration does
 * not need, and Playwright discards the browser context after every test, so
 * no session can leak between them.
 */
export const test = base.extend<{ authedPage: Page }>({
    authedPage: async ({ page }, use) => {
        await login(page);

        await use(page);
    },
});

export { expect };

