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
 * BROWSERS — Firefox PRIMARY, Chromium FALLBACK
 *   Firefox is the primary engine and the first project, so a plain `npm run e2e`
 *   (or `--project=firefox`) targets it. The `chromium-fallback` project is only
 *   used explicitly when Firefox is unavailable; it launches with
 *   `--no-sandbox --disable-dev-shm-usage` because a container's small `/dev/shm`
 *   crashes Chrome at startup.
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
 */

import { defineConfig, devices } from '@playwright/test';

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

    // Keep traces for failing tests only — useful diagnostics without bloating every
    // committed run.
    trace: 'retain-on-failure',

    // Stable waits for the SPA to load and for interactions to settle.
    actionTimeout: 15000,
    navigationTimeout: 30000,

    // Fixed viewport for deterministic screenshots. The legacy harness maximized the
    // real window; a fixed size is reproducible across machines/headless runs.
    viewport: { width: 1280, height: 800 },

    // The local stack may serve self-signed certificates.
    ignoreHTTPSErrors: true,
  },

  // Firefox is the primary engine (listed first). Chromium is only a fallback and
  // must be launched with `--no-sandbox --disable-dev-shm-usage` for container
  // stability (small `/dev/shm` crashes Chrome at startup).
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'chromium-fallback',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
      },
    },
  ],
});
