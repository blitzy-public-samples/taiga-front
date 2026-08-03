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
 * WHY THE CREDENTIAL MUST NEVER BE ENTERED UNDER TRACING
 * ---------------------------------------------------------------------------
 * {@link login} types a real password and then leaves the browser holding a
 * bearer token and a session identifier. A Playwright TRACE records both halves
 * of that: an action's parameters — the value handed to a fill — and the request
 * and response headers of the traffic that follows. So a trace of any test in
 * this layer contains the admin credential AND a live session, and
 * `playwright.config.ts` writes its evidence into a directory that is COMMITTED.
 * One failing run would be enough to put all three into the repository's
 * history, where deleting the file afterwards does not remove them.
 *
 * `playwright.config.ts` therefore sets `trace: "off"`, and this file does not
 * merely rely on that: {@link login} REFUSES TO TYPE THE CREDENTIAL while
 * tracing is enabled, whether it was enabled by editing the config or by passing
 * `--trace` on the command line. The invariant is enforced at the point of
 * entry, so it cannot be lost to a well-meaning edit somewhere else.
 *
 * Nothing here persists a session either: no `storageState` is saved, no HAR is
 * recorded, and Playwright discards the browser context after every test.
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

import { test as base, errors, expect, type FullProject, type Page } from "@playwright/test";

export const ADMIN_USERNAME = "admin";

const DEV_DEFAULT_ADMIN_PASSWORD = "admin123";

export interface AdminCredentials {
    readonly username: string;
    readonly password: string;
}

const USERNAME_INPUT_SELECTOR = 'input[name="username"]';

const PASSWORD_INPUT_SELECTOR = 'input[name="password"]';

const LOGIN_SUBMIT_SELECTOR =
    'form.login-form button[type="submit"], form.login-form .submit-button';

const LOADER_SELECTOR = ".loader";

const LOADER_ACTIVE_CLASS = "active";

const JOYRIDE_SKIP_SELECTOR = ".introjs-skipbutton";

const LOGIN_PATH = "/login";

const LOGIN_URL_TIMEOUT_MS = 10000;

const LOADER_TIMEOUT_MS = 5000;

const JOYRIDE_SETTLE_MS = 600;

const JOYRIDE_APPEAR_TIMEOUT_MS = LOADER_TIMEOUT_MS;

const COOKIE_CONSENT_STATEMENT = "cookieConsent=1";

// Every login resolves its password through this ONE function, and the account is created with
// the same variable and the same fallback, so the two values are identical by construction
// rather than by convention. An empty string is treated as absent deliberately: an unset
// variable expands to empty at account-creation time and would otherwise silently create an
// account that no password can open.
export function adminPassword(): string {
    const injected = process.env.TAIGA_ADMIN_PASSWORD;

    if (injected !== undefined && injected.length > 0) {
        return injected;
    }

    return DEV_DEFAULT_ADMIN_PASSWORD;
}

export function adminCredentials(): AdminCredentials {
    return {
        username: ADMIN_USERNAME,
        password: adminPassword(),
    };
}

/* ===========================================================================
 * Tracing guard — the credential is never typed into a traced run
 * ======================================================================== */

/**
 * The `trace` option exactly as Playwright resolves it for the running project,
 * taken from Playwright's own type so this guard cannot drift from the shape it
 * inspects. It is a mode string, the deprecated `"retry-with-trace"` spelling, an
 * object carrying a `mode`, or absent.
 */
type ConfiguredTrace = FullProject["use"]["trace"];

/** The single value of the `trace` option under which authentication is allowed. */
const TRACING_DISABLED = "off";

/**
 * Flattens the three shapes of the `trace` option to the mode it selects.
 *
 * An absent option means Playwright records nothing, which is the same as
 * disabled. `"retry-with-trace"` is a deprecated spelling that still enables
 * recording, so it flattens to itself rather than to `"off"` — the guard below
 * only ever compares against `"off"`, so any spelling that is not literally
 * disabled is treated as enabled, which is the safe direction to fail in.
 *
 * @param configured - the resolved `trace` option, of whichever shape
 * @returns the selected mode, or `"off"` when nothing is configured
 */
function resolveTraceMode(configured: ConfiguredTrace): string {
    if (configured === undefined) {
        return TRACING_DISABLED;
    }

    if (typeof configured === "string") {
        return configured;
    }

    return configured.mode;
}

/**
 * Refuses to continue when the running project would record a trace.
 *
 * WHY THIS IS A RUNTIME CHECK AND NOT A COMMENT. A trace stores an action's
 * parameters together with the request and response headers of the traffic it
 * caused, so a trace taken across {@link login} holds the admin password, the
 * `Authorization: Bearer` token and the `X-Session-Id` — and
 * `playwright.config.ts` writes its evidence into a COMMITTED directory. The
 * config sets `trace: "off"` for exactly that reason, but a config value is one
 * edit or one `--trace` flag away from being reversed, and the artifact it would
 * then produce looks entirely innocuous. Failing here converts that silent
 * disclosure into a loud, immediate stop, before a single character of the
 * credential has been typed.
 *
 * The option is read from the RESOLVED project configuration rather than from the
 * config file, so a command-line override is caught as surely as an edit.
 *
 * The way to debug with a trace is the way the message says: authenticate outside
 * the traced portion of the run, and keep the archive out of every tracked path.
 *
 * @throws when the running project's `trace` option is anything but `"off"`
 */
function assertCredentialEntryIsNotTraced(): void {
    const project = base.info().project;
    const mode = resolveTraceMode(project.use.trace);

    if (mode === TRACING_DISABLED) {
        return;
    }

    // A project declared without a name reports an empty string, so the subject
    // of the sentence is chosen rather than interpolated blindly.
    const subject = project.name.length > 0 ? `the "${project.name}" project` : "this run";

    throw new Error(
        `Refusing to authenticate: ${subject} has trace: "${mode}". A trace records ` +
            "fill() parameters and request headers, so it would capture the admin " +
            "password, the Authorization bearer token and the X-Session-Id — and " +
            "playwright.config.ts writes its artifacts under the committed " +
            'e2e-react/artifacts/ root. Restore trace: "off" (and drop any --trace ' +
            "flag). To capture a trace for debugging, authenticate outside the traced " +
            "part of the run and keep the archive out of any tracked directory.",
    );
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

// The application signals "busy" by adding a class to a loader element that is never removed
// from the document, so waiting for the element to disappear would wait forever. A missing
// loader counts as settled, which is what lets this run against a page that has none.
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

export async function closeJoyride(page: Page): Promise<void> {
    await waitLoader(page);

    const skip = page.locator(JOYRIDE_SKIP_SELECTOR).first();

    try {
        await skip.waitFor({
            state: "visible",
            timeout: JOYRIDE_APPEAR_TIMEOUT_MS,
        });
    } catch (error) {
        // The guided tour only appears for an account that has not dismissed it, so its absence
        // is the normal case on every run after the first and must not fail the fixture. Only a
        // timeout is swallowed; anything else is a real failure.
        if (error instanceof errors.TimeoutError) {
            return;
        }

        throw error;
    }

    await skip.click();

    // The tour fades out, and its overlay keeps intercepting pointer events until it does, so a
    // fixed settle beats asserting on a node that is mid-animation.
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
 * IT TAKES NO CREDENTIAL ARGUMENT, AND THAT IS THE POINT (constraint HR-7).
 * The pair is resolved INSIDE, through {@link adminCredentials}, so the value
 * used at every login is the value {@link adminPassword} resolves from
 * `TAIGA_ADMIN_PASSWORD` — the same variable, read the same way, with the same
 * documented fallback the out-of-band `createsuperuser` invocation uses. An
 * override parameter, even one defaulted to `adminCredentials()`, would make
 * that agreement a CONVENTION every caller has to keep; with no parameter to
 * pass it is a property of the code, which is what "identical by construction"
 * means. A capture that authenticated as somebody else, or with a stale
 * password, would not fail loudly — it would produce plausible-looking
 * artifacts of the wrong session, and this signature makes that unreachable.
 *
 * Nothing in `e2e-react/` needs a different account: the seeded dataset is
 * reached entirely through the superuser, and negative-authentication cases are
 * not part of this migration (rule T10 — no functional or feature change). If
 * one is ever required, it belongs in a separate, explicitly non-capture helper
 * rather than as a parameter on the path every artifact is produced through.
 *
 * @param page - the page to authenticate
 */
export async function login(page: Page): Promise<void> {
    // STEP 0, BEFORE ANY CREDENTIAL IS TYPED: refuse to run at all while Playwright
    // tracing is on, because a trace records `fill()` parameters and full request
    // headers and would commit the password and the bearer token alongside the
    // evidence. See `assertCredentialEntryIsNotTraced` for what a trace captures.
    assertCredentialEntryIsNotTraced();

    const credentials: AdminCredentials = adminCredentials();


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

export const test = base.extend<{ authedPage: Page }>({
    authedPage: async ({ page }, use) => {
        await login(page);

        await use(page);
    },
});

export { expect };
