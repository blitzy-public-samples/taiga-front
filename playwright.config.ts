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
 *     downloading/using its bundled browser drivers. Combined with the
 *     `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` control enforced in CI
 *     (`.github/workflows/main.yml` workflow env) and `npm ci --ignore-scripts`
 *     in the Docker build, this is the accepted mitigation for advisory
 *     GHSA-7mvr-c777-76hp (findings M13/C1): the Node 16.19.1 pin (`.nvmrc`)
 *     blocks upgrading past the 1.44.x line (1.45 drops Node 16), so no browser
 *     download path is exercised and the parity suite runs on a trusted browser
 *     binary. (The skip control lives in CI rather than a repo-root `.npmrc` to
 *     keep the frozen operation boundary — see C1.)
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

    // Finding M12 (credential leakage in committed artifacts): tracing is DISABLED.
    // Every project's `outputDir` below points inside the GIT-TRACKED
    // `e2e-react/artifacts/**` tree (the before/after evidence is committed on
    // purpose per AAP §0.6.2). A Playwright trace, however, serializes the full
    // authenticated session — the JWT bearer + `X-Session-Id` request headers,
    // response bodies, and `localStorage`/cookies captured after the fixture
    // logs in (admin/123123). Committing a trace would therefore publish live
    // credentials into version control. Screenshots + video (above) are the
    // artifacts the AAP actually requires for parity review and carry no
    // request headers or storage state, so tracing is turned OFF entirely rather
    // than `retain-on-failure`. Debugging a failure locally can re-enable it
    // transiently via `--trace on` on an ad-hoc, NON-committed run.
    trace: "off",
  },

  // ---------------------------------------------------------------------------
  // Deterministic strict VISUAL-PARITY gate (review finding M27).
  // ---------------------------------------------------------------------------
  // Previously this config captured raw evidence only (video/screenshot on) with
  // NO comparator, threshold, or gate. `toHaveScreenshot` (used by the specs via
  // `taiga.expectVisualParity(...)`) adds a real pixel comparison. The parity
  // workflow (AAP §0.6.2) is:
  //   1. `--project=baseline` runs FIRST against the stock AngularJS screens.
  //      With no reference present yet, Playwright WRITES the reference snapshot
  //      into the shared, project-independent `snapshotPathTemplate` below and
  //      passes; a human reviews + commits that reference (the required
  //      human-approval checkpoint the finding asks for).
  //   2. `--project=react` runs AFTER migration and COMPARES the React render
  //      against that committed baseline, FAILING on any drift beyond the
  //      AAP-grounded tolerance below.
  // `snapshotPathTemplate` intentionally omits `{projectName}` (and `{platform}`
  // — both projects run on the SAME CI platform / trusted Chrome), so the two
  // TEMPORAL projects resolve to the SAME reference file and the react run is
  // diffed against the baseline capture rather than against itself.
  snapshotPathTemplate: "e2e-react/artifacts/parity-snapshots/{testFilePath}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // The migration's contract is pixel parity (AAP §0.1.1, §0.7.1): React
      // emits the same DOM + class names so the UNCHANGED SCSS paints it
      // identically. The tolerance is therefore STRICT — a small per-pixel YIQ
      // `threshold` absorbs only sub-pixel font-hinting/anti-aliasing differences
      // between the two temporal builds (never a design change), and at most
      // 0.5%% of pixels may differ before the gate fails. There is NO performance
      // SLA (assumption A-2); this is a purely visual gate.
      threshold: 0.15,
      maxDiffPixelRatio: 0.005,
      // Determinism: freeze CSS animations/transitions, hide the text caret, and
      // compare in CSS pixels so device-pixel-ratio differences cannot mask or
      // inflate a diff.
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
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
