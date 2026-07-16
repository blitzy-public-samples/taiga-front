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

export default defineConfig({
    testDir: __dirname,                 // e2e-react/ — discovers *.spec.ts here
    // fixtures/session.ts is not a *.spec.ts, so it is not run as a test.

    // Deterministic sample-data reset/reseed BEFORE the whole run, so the suite
    // can be executed twice-from-clean without duplicate-name/data/order drift.
    // The hook is env-configurable (E2E_RESEED_CMD / E2E_RESEED_URL) because the
    // taiga-back backend is out of scope for this submodule; it is a safe,
    // non-failing no-op with an actionable warning when no reseed is configured.
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
        },
    },

    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // Re-assert the sandbox flags in case the device preset overrides launchOptions.
                launchOptions: {
                    args: ['--no-sandbox', '--disable-dev-shm-usage'],
                },
            },
        },
    ],
});
