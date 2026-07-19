/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * Playwright configuration — React Kanban/Backlog e2e (visual-evidence) layer.
 *
 * WHAT THIS IS
 *   The additive, *isolated* end-to-end layer for the two migrated React screens
 *   (Kanban + Backlog). It is invoked ONLY via `npm run e2e`
 *   (`playwright test --config e2e-react/playwright.config.ts`). It is a
 *   REFERENCE-port of the legacy Protractor harness `../conf.e2e.js` into
 *   Playwright — the login flow from that harness lives in `fixtures/`, NOT here.
 *
 * LAYER ISOLATION (intentional)
 *   - This project is completely decoupled from the root `tsconfig.json` and from
 *     the Jest unit layer. Playwright transpiles its own TypeScript internally, so
 *     this file deliberately does NOT import, reference, or extend the root
 *     tsconfig (which excludes `e2e-react/**`). `npm test` (Jest) and
 *     `npm run e2e` (Playwright) are strictly separate layers and never share code.
 *   - Nothing here imports from Jest, `app/react/**`, or the root unit tooling.
 *
 * DEPLOYED-STACK TARGET
 *   Tests run against the REAL nginx-served build on host port 9000 (the Docker
 *   deployment topology), NOT a dev server — hence there is no `webServer` block.
 *   The legacy Protractor config pointed at the Gulp express dev-server port rather
 *   than the deployed nginx gateway; that legacy dev-server port is intentionally
 *   NOT reused here — the React captures target the real port-9000 build.
 *
 * BROWSERS — Firefox is the SOLE default engine; Chromium is an explicit fallback
 *   (F-AAP-05). A plain `playwright test` and the default `npm run e2e` run Firefox
 *   ONLY — the `chromium-fallback` project is NOT part of the default run. Chromium
 *   is an opt-in fallback, enabled only when `TAIGA_E2E_CHROMIUM=1` is set (by the
 *   dedicated `npm run e2e:chromium` command); it launches with
 *   `--no-sandbox --disable-dev-shm-usage` because a container's small `/dev/shm`
 *   crashes Chrome at startup. This keeps the primary evidence single-engine and
 *   deterministic instead of silently running both engines at once.
 *
 * TWO-PHASE CAPTURE (before/after visual evidence)
 *   The SAME config drives both capture passes, selected by `CAPTURE_PHASE`:
 *     - BASELINE (default): run against the AngularJS screens FIRST, before removal
 *       → artifacts land under `artifacts/baseline/**`.
 *     - REACT (`CAPTURE_PHASE=react`): run against the migrated React screens AFTER
 *       → artifacts land under `artifacts/react/**`.
 *   The database is seeded once and never reseeded/recreated between the two passes,
 *   so the committed baseline vs react artifacts stay directly comparable.
 *
 * TOOLCHAIN PIN
 *   Node v16.19.1 (repo `.nvmrc`); `@playwright/test` pinned to 1.44.1 — the last
 *   Playwright line that supports Node 16 (1.45 dropped it). Only APIs available in
 *   `@playwright/test@1.44` are used (`defineConfig`, `devices`).
 *
 * F-SEC-04 — dependency-advisory risk acceptance (Playwright 1.44.1,
 * GHSA-7mvr-c777-76hp / CVE-2025-59288, Improper Certificate Validation):
 *   The advisory is confined to Playwright's macOS-only browser reinstall scripts
 *   (`packages/playwright-core/bin/reinstall_*_mac.sh`), which fetch installers with
 *   `curl -k`, allowing a network MitM to substitute a payload. Its fixed release
 *   (>= 1.55.1) requires Node >= 18, which would violate this project's HARD Node 16.19.1
 *   pin — AAP sub-sections 0.5.1 and 0.7.1 fix `@playwright/test` at 1.44.1 as an explicit
 *   user directive. Per the frozen AAP the version is NOT upgraded; the risk is instead
 *   eliminated by PLATFORM + API RESTRICTION: this e2e layer runs ONLY in the ephemeral
 *   Linux CI/dev environment (never macOS), so the vulnerable macOS-only reinstall scripts
 *   are never invoked; browsers are provisioned with `npx playwright install` over HTTPS.
 *   Playwright is a dev/test dependency invoked exclusively via `npm run e2e`; it is NEVER
 *   part of the production runtime or the served bundle. Only the `defineConfig`/`devices`
 *   API surface is used, and no report web server is exposed (`open: 'never'` below).
 */

import { defineConfig, devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

/**
 * Resolves the current capture phase from the environment.
 *
 * It is `'react'` ONLY when `process.env.CAPTURE_PHASE` is exactly the string
 * `'react'`; every other value (including unset) resolves to `'baseline'`. This
 * exact rule is mirrored by the screenshot helper in `fixtures/` so that manual
 * `page.screenshot({ path: 'artifacts/<phase>/<section>/<name>.png' })` targets and
 * Playwright's own per-test `outputDir` always land in the SAME phase subfolder.
 *
 * Exported so the specs/fixtures can import it and keep phase resolution consistent
 * instead of re-deriving it independently.
 */
export const CAPTURE_PHASE: 'baseline' | 'react' =
  process.env.CAPTURE_PHASE === 'react' ? 'react' : 'baseline';

/**
 * F-AAP-05 — Firefox is the SOLE default engine; Chromium is an explicit, opt-in
 * fallback. The `chromium-fallback` project is appended ONLY when
 * `TAIGA_E2E_CHROMIUM=1` (set by the dedicated `npm run e2e:chromium` command), so a
 * bare `playwright test` and the default `npm run e2e` run Firefox ONLY — never both
 * engines. This makes the primary before/after evidence single-engine and
 * deterministic, with Chromium reserved as a deliberate, separately-invoked fallback
 * for when Firefox is unavailable.
 */
const projects: NonNullable<PlaywrightTestConfig['projects']> = [
  {
    name: 'firefox',
    use: { ...devices['Desktop Firefox'] },
  },
];

if (process.env.TAIGA_E2E_CHROMIUM === '1') {
  projects.push({
    name: 'chromium-fallback',
    use: {
      ...devices['Desktop Chrome'],
      // A container's small /dev/shm crashes Chrome at startup; these flags avoid it.
      launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    },
  });
}

export default defineConfig({
  // Spec folder — sibling `tests/` holds `kanban.spec.ts` and `backlog.spec.ts`.
  testDir: './tests',

  // Per-test artifacts (videos, traces, failure screenshots) are routed into the
  // committed evidence tree, partitioned by capture phase so the baseline and react
  // passes never overwrite each other.
  outputDir: `artifacts/${CAPTURE_PHASE}/output`,

  // Deterministic, serial execution: a single worker with a single browser instance
  // and no retries keeps the before/after captures stable and comparable.
  workers: 1,
  retries: 0,
  fullyParallel: false,

  // Generous timeouts: many flows wait on Angular/React rendering plus drag-and-drop
  // settling. The legacy Protractor harness used a 55s mocha timeout; these are the
  // Node-16-safe equivalents.
  timeout: 60000,
  expect: {
    timeout: 15000,
  },

  // Console output plus a static HTML report written INSIDE `e2e-react/artifacts/`
  // so it is git-trackable alongside the evidence. `open: 'never'` prevents CI /
  // headless runs from trying to launch a browser to show the report.
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/report', open: 'never' }],
  ],

  use: {
    // React/baseline captures both hit the REAL nginx build on host port 9000.
    // Overridable via TAIGA_FRONT_URL if the stack is exposed elsewhere.
    baseURL: process.env.TAIGA_FRONT_URL || 'http://localhost:9000/',

    // Always-on video + screenshots: the before/after recordings and stills are
    // mandatory evidence, not on-failure-only.
    video: 'on',
    screenshot: 'on',

    // F-SEC-01: tracing is DISABLED. A retained failure trace bundles the full
    // request/response record of the authenticated session — the login form fill,
    // the `Authorization: Bearer` JWT, the `X-Session-Id` header, cookies, and API
    // response bodies — which must never be committed as evidence (CWE-532/CWE-200).
    // With trace off no such artifact is ever produced. Screenshots (the password
    // field renders masked) and video remain enabled per AAP 0.6.4; only curated,
    // secret-free stills/fingerprints under `artifacts/<phase>/` are committed.
    trace: 'off',

    // Stable waits for the SPA to load and for interactions to settle.
    actionTimeout: 15000,
    navigationTimeout: 30000,

    // Fixed viewport for deterministic screenshots. The legacy harness maximized the
    // real window; a fixed size is reproducible across machines/headless runs.
    viewport: { width: 1280, height: 800 },

    // The local stack may serve self-signed certificates.
    ignoreHTTPSErrors: true,
  },

  // F-AAP-05: Firefox-only by default. The optional `chromium-fallback` project is
  // appended to `projects` (declared above) only when `TAIGA_E2E_CHROMIUM=1`, so the
  // default run never launches Chromium. Run the fallback via `npm run e2e:chromium`.
  projects,
});
