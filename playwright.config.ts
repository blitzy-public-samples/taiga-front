/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Playwright configuration for the React-migration parity harness.
 *
 * This config drives the NEW end-to-end suite under `e2e-react/**` that captures
 * the before/after visual + behavioral parity evidence (screenshots + videos) for
 * the AngularJS -> React 18.2 migration of the Kanban (F-001) and Backlog /
 * Sprint-Planning (F-002) screens. The captured artifacts are git-committed under
 * `e2e-react/artifacts/{baseline,react}/**` for stakeholder review.
 *
 * Two projects are defined, and they MUST be named exactly:
 *   - `baseline` : runs against the stock AngularJS screens. Per the
 *                  baseline-before-removal safeguard, this project is executed and
 *                  its artifacts committed FIRST, before any legacy code is removed.
 *   - `react`    : runs against the migrated React screens after the migration.
 *
 * Both projects target the SAME single deployable client served by the nginx
 * gateway on host port 9000 (constraint C-3 — one origin, one bundle). The
 * baseline-vs-react distinction is TEMPORAL (which build is deployed when the
 * project runs), NOT a second origin, so `baseURL` is intentionally identical for
 * both projects and is never parameterized to a different URL.
 *
 * The pinned `@playwright/test` 1.44.x line is the last release that supports the
 * repository's Node 16.19.1 runtime (see `.nvmrc`); 1.45 drops Node 16.
 *
 * Notes:
 *   - There is deliberately NO `webServer` block: the full Taiga stack (Postgres,
 *     Django, AngularJS/React front-end, RabbitMQ, nginx) is brought up externally
 *     via Docker / `launch-taiga.sh` and served on port 9000. Playwright must not
 *     try to boot its own dev server.
 *   - Per-project `outputDir` routes Playwright's auto-captured videos, traces, and
 *     failure screenshots into the two git-tracked artifact folders. The spec files
 *     additionally save explicit, named screenshots into these same directories.
 *   - Browsers are kept minimal (Chromium device profile via `Desktop Chrome`)
 *     per the Minimal Change Clause, but every project pins `channel: "chrome"`
 *     so Playwright launches the TRUSTED pre-installed Google Chrome rather than
 *     downloading/using its bundled browser drivers. Combined with
 *     `playwright_skip_browser_download=1` in `.npmrc`, this is the accepted
 *     mitigation for advisory GHSA-7mvr-c777-76hp (finding M11): the Node
 *     16.19.1 pin (`.nvmrc`) blocks upgrading past the 1.44.x line (1.45 drops
 *     Node 16), so no browser download path is exercised and the parity suite
 *     runs on a trusted browser binary.
 *   - This config is loaded natively by Playwright's own TypeScript loader; no
 *     separate build step is required.
 *
 * Invoked via: `npm run e2e:react` (i.e. `playwright test`), optionally scoped with
 * `--project=baseline` or `--project=react`.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  // All parity specs live under `e2e-react/` (kept separate from the surviving
  // Protractor suite driven by `conf.e2e.js`).
  testDir: "./e2e-react",

  // Shared settings applied to every project.
  use: {
    // The single nginx gateway host port for the one deployable client (C-3).
    // Never point either project at a second origin.
    baseURL: "http://localhost:9000",

    // Always record video and capture screenshots so the committed artifacts
    // constitute complete before/after parity evidence.
    video: "on",
    screenshot: "on",

    // Keep a full trace only when a test fails, to aid debugging without bloating
    // the committed evidence on green runs.
    trace: "retain-on-failure",
  },

  // Human-readable console output plus a self-contained HTML report written into
  // the tracked artifacts tree. `open: "never"` keeps CI non-interactive.
  reporter: [
    ["list"],
    ["html", { outputFolder: "e2e-react/artifacts/report", open: "never" }],
  ],

  projects: [
    {
      // Stock AngularJS capture — run and committed FIRST (baseline-before-removal).
      name: "baseline",
      testMatch: /.*\.spec\.ts/,
      outputDir: "e2e-react/artifacts/baseline",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      // Migrated React capture — run after the migration on the same origin.
      name: "react",
      testMatch: /.*\.spec\.ts/,
      outputDir: "e2e-react/artifacts/react",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
