/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the React Kanban/Backlog migration E2E + visual-evidence suite.
 *
 * Invoked ONLY via `npm run e2e` (`playwright test --config e2e-react/playwright.config.ts`).
 * NEVER invoked by `npm test` (Jest) or by any Gulp task (test-layer isolation is a hard requirement).
 *
 * Runner pinned to @playwright/test@1.44.1 — the last line supporting Node v16.19.1 (.nvmrc).
 *
 * BROWSER ENGINE: Firefox is MANDATORY. A prior parity run crashed with
 *   `OSError: [Errno 22] Invalid argument`
 * inside the execution harness's Chromium process-management path
 * (`restart_chrome` / `_kill_chrome` via `os.pidfd_open`). Running the suite on Firefox
 * avoids that Chromium teardown path entirely. Install with `npx playwright install firefox`.
 *
 * If Chromium were ever used instead (it is NOT — documented for completeness only),
 * container-safe launch would require:
 *   {
 *     name: 'chromium',
 *     use: {
 *       ...devices['Desktop Chrome'],
 *       launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
 *     },
 *   }
 *
 * COMMITTED VISUAL-EVIDENCE CONTRACT (obligation of the downstream `tests/` specs):
 * The migration captures before/after evidence in two SEPARATE runs and commits it under the
 * git-tracked `e2e-react/artifacts/` tree (this tree is intentionally NOT gitignored):
 *   - baseline run -> e2e-react/artifacts/baseline/**  (captured BEFORE the kanban.jade / backlog.jade template swap)
 *   - React run    -> e2e-react/artifacts/react/**     (captured AFTER the swap)
 * Because Playwright CLEANS `outputDir` at the start of EVERY run (see below), the committed
 * evidence MUST be written by the specs themselves via explicit calls such as
 *   await page.screenshot({ path: 'artifacts/baseline/<name>.png' });
 *   await page.video()?.saveAs('artifacts/baseline/<name>.webm');
 * Specs must never rely on the transient `outputDir` for anything that has to be committed.
 */

// The running deployable client is served by the existing Docker gateway (nginx 9000:80).
// Override with TAIGA_HOST for the legacy dev host (e.g. http://localhost:9001).
//
// TRANSPORT SAFETY (F50). Arbitrary TAIGA_HOST values must not be paired with a
// blanket `ignoreHTTPSErrors: true`, which would silently disable certificate
// validation and could leak the E2E test credentials to an unintended cleartext
// or untrusted host. `resolveTarget()` therefore:
//   - accepts LOCAL hosts (localhost / 127.0.0.1 / ::1 / 0.0.0.0 / *.local /
//     *.internal) over http or https, and only for these tolerates self-signed
//     certificates (ignoreHTTPSErrors: true) since the Docker gateway serves
//     plain HTTP and any local TLS is a dev cert; and
//   - requires REMOTE hosts to use https:// (throws otherwise) AND enforces
//     certificate validation (ignoreHTTPSErrors: false), so credentials are
//     never sent over an unencrypted or unverified transport.
// An unparseable TAIGA_HOST is rejected outright.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  return LOCAL_HOSTNAMES.has(h) || h.endsWith('.local') || h.endsWith('.internal');
}

function resolveTarget(): { baseURL: string; ignoreHTTPSErrors: boolean } {
  const raw = process.env.TAIGA_HOST || 'http://localhost:9000';

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `TAIGA_HOST is not a valid absolute URL: ${JSON.stringify(raw)}. ` +
        `Use e.g. http://localhost:9000 (local) or https://taiga.example.com (remote).`,
    );
  }

  if (isLocalHostname(url.hostname)) {
    // Local dev / Docker gateway: plain HTTP is expected; tolerate any local TLS cert.
    return { baseURL: raw.replace(/\/$/, ''), ignoreHTTPSErrors: true };
  }

  // Remote host: require HTTPS and enforce certificate validation.
  if (url.protocol !== 'https:') {
    throw new Error(
      `TAIGA_HOST points at a remote host (${url.hostname}) over ${url.protocol.replace(':', '')}. ` +
        `Remote hosts MUST use https:// so the E2E credentials are not sent in cleartext (F50). ` +
        `Refusing to run against an unencrypted remote host.`,
    );
  }
  return { baseURL: raw.replace(/\/$/, ''), ignoreHTTPSErrors: false };
}

const { baseURL: BASE_URL, ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS } = resolveTarget();

export default defineConfig({
  testDir: './tests',

  // Known-state database reset + whole-run TAIGA_VARIANT validation before any
  // browser launches (F12/F13). `playwright test --list` does NOT run
  // globalSetup, so test discovery is unaffected by these guards.
  globalSetup: require.resolve('./fixtures/reseed'),

  // Determinism & isolation: serialize everything on a single long-lived browser,
  // never retry (no flaky masking), match the legacy mocha 55s ceiling.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Transient Playwright output (traces/videos/screenshots auto-captured per test).
  // Playwright CLEANS outputDir at the start of EVERY run, so it must NOT point at the
  // committed evidence tree. It is redirected to the gitignored `tmp/` (taiga-front/.gitignore
  // lists `tmp/`) so nothing transient is committed and committed baseline evidence is never wiped.
  // The COMMITTED evidence (artifacts/baseline/**, artifacts/react/**) is written by the specs
  // themselves via explicit page.screenshot({ path }) / page.video().saveAs(path) calls.
  outputDir: '../tmp/playwright-output',

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '../tmp/playwright-report' }],
  ],

  use: {
    baseURL: BASE_URL,
    ...devices['Desktop Firefox'],
    headless: true,
    // Capture evidence unconditionally (not only on failure).
    video: 'on',
    screenshot: 'on',
    // TRACE DISABLED (F11). `trace: 'on'` recorded every authenticated
    // interaction — including the UI login and the JWT-bearing `/api/v1/`
    // request headers — into a trace zip that could persist the password and
    // bearer token. Evidence is captured via video + screenshots (which show
    // only masked password fields and rendered DOM, never request headers), so
    // traces are not needed for the evidence mission and are turned off entirely
    // to prove secrets cannot enter any artifact. (Even the transient outputDir
    // is redirected to the gitignored tmp/, but disabling trace removes the
    // secret-capture vector at the source.)
    trace: 'off',
    // Per-host certificate policy resolved above (F50): true only for local
    // hosts, false (enforced) for remote https hosts.
    ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS,
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
