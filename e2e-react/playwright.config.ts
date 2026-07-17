/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * Playwright configuration for the React migration end-to-end parity suite.
 *
 * This is the SINGLE Playwright config in the repository and it lives HERE
 * (taiga-front/e2e-react/), NOT at the repo root. The root package.json
 * "test:e2e" script is already wired to it:
 *
 *     "test:e2e": "playwright test --config=e2e-react/playwright.config.ts"
 *
 * It drives the already-running Taiga client (AngularJS today, React after the
 * migration) and produces the committed video + screenshot parity artifacts
 * that prove the React Kanban/Backlog screens reproduce the AngularJS behavior.
 *
 * The suite is captured in two phases, selected by the E2E_PHASE env var. The
 * two phases MUST write to different output directories because Playwright
 * clears `outputDir` at the start of every run; a shared directory would
 * destroy the committed baseline (see AAP §0.6.2 — the baseline is a point of
 * no return, committed BEFORE the AngularJS code is reduced to stubs):
 *
 *   1) Baseline (AngularJS) — run BEFORE any app/ CoffeeScript removal:
 *        E2E_PHASE=baseline npx playwright test \
 *            --config=e2e-react/playwright.config.ts
 *      -> writes to e2e-react/artifacts/baseline/ (committed).
 *
 *   2) Post-migration (React) — run AFTER the React roots are built + wired:
 *        npx playwright test --config=e2e-react/playwright.config.ts
 *      (defaults to the "react" phase)
 *      -> writes to e2e-react/artifacts/react/.
 *
 * Both artifact directories are tracked in git (NOT gitignored): the
 * recordings and screenshots ARE the deliverable, not ephemeral test output.
 * Playwright's default results directory is deliberately never used.
 *
 * REFERENCE ONLY: taiga-front/conf.e2e.js (the legacy Protractor config) is the
 * source of the host/login/timeout CONVENTIONS reused below; it is not imported
 * or edited. Playwright transpiles this TypeScript config itself — there is no
 * ts-jest / tsc / gulp build step for this tree.
 *
 * ---------------------------------------------------------------------------
 * [C-01] LIVE FULL-STACK REQUIREMENT for producing the committed React evidence
 * ---------------------------------------------------------------------------
 * These suites drive the REAL client end-to-end: they log in through the actual
 * AngularJS login screen and exercise the React Kanban/Backlog against the live
 * REST API and WebSocket layer. They are therefore NOT runnable front-end-only —
 * a complete stack must be up at `baseURL` (default the taiga-docker gateway
 * http://localhost:9000/), which includes the Django `taiga-back` API + Postgres
 * + RabbitMQ. taiga-back is explicitly OUT OF SCOPE for this migration (AAP
 * §0.2.2: "The Django backend … is frozen"), so it is not provisioned inside
 * this submodule checkout.
 *
 * Consequence: `e2e-react/artifacts/react/` cannot be populated from a
 * front-end-only checkout — the post-migration screenshots/recordings can only
 * be captured by running this config against a running full stack. The
 * remediation this migration owns is to make the harness CORRECT so it WILL
 * generate that evidence when pointed at a real stack: the login selector is
 * fixed ([C-08]), the create/edit/delete/attachment flows target the real React
 * DOM ([C-07]), and the reseed is fail-closed ([M-16]). To produce the artifacts
 * once a stack is available:
 *
 *     # 1) baseline (BEFORE reducing the AngularJS code), committed to
 *     #    artifacts/baseline/ :
 *     E2E_PHASE=baseline E2E_RESEED_CMD="…sample_data…" \
 *         npx playwright test --config=e2e-react/playwright.config.ts
 *     # 2) post-migration React captures, committed to artifacts/react/ :
 *     E2E_RESEED_CMD="…sample_data…" \
 *         npx playwright test --config=e2e-react/playwright.config.ts
 *
 * Fabricating these artifacts by hand is forbidden — they must be real captures.
 */

import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

// Which capture phase this run belongs to. The baseline (AngularJS) and react
// (post-migration) runs MUST write to different subdirectories because Playwright
// clears outputDir at the start of every run (see AAP §0.6.2). Baseline captures
// are committed BEFORE the AngularJS code is reduced to stubs (point of no return).
const PHASE = process.env.E2E_PHASE === 'baseline' ? 'baseline' : 'react';

// The already-running client. Legacy Protractor used :9001; the taiga-docker gateway
// maps 9000:80. Override with E2E_BASE_URL for other environments.
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:9000/';

// [M-17] Browser provenance / CVE-2025-59288 (GHSA-7mvr-c777-76hp) mitigation.
//
// @playwright/test is pinned to 1.44.1 — the highest release that runs on the
// AAP-frozen Node 16.19.1 toolchain (AAP §0.5.1, §0.7.2; Playwright dropped
// Node 16 in 1.60/needs Node 18 from 1.55.1). CVE-2025-59288 is fixed only in
// Playwright 1.55.1+, which REQUIRES Node 18 and therefore conflicts with the
// frozen Node-16 target; per the AAP-precedence rule we do NOT bump the pin.
//
// The vulnerability is confined to the macOS-only browser *reinstall* scripts
// (packages/playwright-core/bin/reinstall_{chrome,msedge}_*_mac.sh), which call
// `curl -k` (TLS verification disabled) during a browser download. Those scripts
// are NEVER executed in this project's deliverable/CI path: the Docker build and
// GitHub Actions run on Linux (node:16.19.1 / ubuntu), where browser acquisition
// goes through `playwright install` over the Node HTTPS stack with normal TLS
// verification — not the macOS `curl -k` reinstall scripts. CVSS is 5.3 (adjacent
// network, high attack complexity); no known exploit; not in CISA KEV.
//
// Defense-in-depth (finding's approved option 2 — an integrity-verified,
// preprovisioned browser that avoids the vulnerable download path entirely):
// when PLAYWRIGHT_CHROMIUM_EXECUTABLE (or CHROME_BIN) points at a preinstalled,
// verified browser, Playwright launches THAT binary and no browser download is
// performed at all. CI/Docker should set this (and PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)
// to a checksum-verified system Chrome/Chromium. Left unset, local dev falls back
// to Playwright's bundled Chromium (Node HTTPS download, TLS verified on Linux).
const PREPROVISIONED_BROWSER =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROME_BIN || undefined;

export default defineConfig({
    testDir: __dirname,                 // e2e-react/ — discovers *.spec.ts here
    // fixtures/session.ts is not a *.spec.ts, so it is not run as a test.

    // Deterministic sample-data reset/reseed BEFORE the whole run, so the suite
    // can be executed twice-from-clean without duplicate-name/data/order drift.
    // The hook is env-configurable (E2E_RESEED_CMD / E2E_RESEED_URL) because the
    // taiga-back backend is out of scope for this submodule. [M-16] It is
    // FAIL-CLOSED: when NO reseed is configured it THROWS and aborts the run
    // (rather than silently proceeding against an unknown dataset); an explicit,
    // off-by-default E2E_ALLOW_NO_RESEED=1 opt-out exists for intentional
    // front-end-only / exploratory runs. Both reset paths also throw on failure.
    // See fixtures/globalSetup.ts for the full contract and examples.
    globalSetup: require.resolve('./fixtures/globalSetup'),

    fullyParallel: false,               // single shared session -> no parallelism
    workers: 1,                         // serialized (AAP: workers:1)
    retries: 0,                         // deterministic single-session run
    forbidOnly: !!process.env.CI,
    timeout: 60_000,                    // per-test (legacy Protractor mochaOpts.timeout was 55000)
    expect: { timeout: 15_000 },

    // Artifacts are the committed deliverable; NEVER use Playwright's default dir.
    // Baseline -> artifacts/baseline/, React -> artifacts/react/ (never shared).
    outputDir: path.join(__dirname, 'artifacts', PHASE),

    // Keep list output for CI logs. Do NOT emit anything into Playwright's
    // default results location. If an HTML report is desired, nest it under the
    // per-phase artifacts dir with open:'never' (optional).
    reporter: [['list']],

    use: {
        baseURL: BASE_URL,
        headless: true,
        video: 'on',                    // ALWAYS record video (deliverable) — not on-failure
        screenshot: 'on',               // ALWAYS screenshot (deliverable) — not on-failure
        trace: 'on',                    // full trace per test (extra parity evidence)
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
        launchOptions: {
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
            // [M-17] Launch the preprovisioned, integrity-verified browser when
            // one is configured (undefined => Playwright's bundled Chromium).
            executablePath: PREPROVISIONED_BROWSER,
        },
    },

    // -----------------------------------------------------------------------
    // [M-02] Single project (no theme matrix) — rationale.
    // -----------------------------------------------------------------------
    // AAP §0.3.4 lists the client theme set ["taiga","taiga-legacy",
    // "material-design","high-contrast"] and notes theming "applies to the React
    // DOM identically, because theming is class-driven at the document root and
    // the React output carries the same classes." That describes the theming
    // MECHANISM, not a per-theme visual matrix this migration must build. In this
    // repository only the default `taiga` theme is actually present and compiled
    // — and that is PRE-EXISTING, not a regression introduced here: the same
    // single theme exists at the pre-migration baseline (a17d8c9) and at HEAD
    // (the migration adds/removes no theme under app/themes/). Because React
    // theming is class-driven, the React screens would honor any additional theme
    // identically the moment it is built; authoring the three absent themes is
    // net-new work outside this like-for-like two-screen rewrite (AAP §0.2.2
    // "no other module … modified") and would require a formal AAP revision.
    // The parity matrix therefore runs the one built theme (Chromium/desktop),
    // matching the AngularJS baseline it is compared against.
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // Re-assert the sandbox flags in case the device preset overrides launchOptions.
                launchOptions: {
                    args: ['--no-sandbox', '--disable-dev-shm-usage'],
                    // [M-17] Preprovisioned/verified browser (see header note).
                    executablePath: PREPROVISIONED_BROWSER,
                },
            },
        },
    ],
});
