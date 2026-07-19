/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * Playwright GLOBAL SETUP — deterministic sample-data reset / reseed.
 * ==================================================================
 *
 * WHY THIS EXISTS (QA finding: "No in-harness deterministic reset/reseed;
 * twice-from-clean not satisfiable")
 * ------------------------------------------------------------------------
 * The checkpoint mandate is: "Establish a deterministic reset/reseed mechanism
 * before the run … Run the complete Playwright suite twice from a clean reset.
 * The second run must pass without duplicate-name/data/order failures."
 *
 * The React screens talk to the FROZEN Django `/api/v1/` backend (taiga-back),
 * whose `sample_data` fixtures own the projects/user-stories/sprints the parity
 * suites drive. Deterministic isolation therefore requires resetting that
 * backend state to a known baseline BEFORE each suite invocation. This module
 * is the single, documented in-harness hook that performs that reset; it is
 * wired into e2e-react/playwright.config.ts via `globalSetup` and runs exactly
 * once, before any spec, on every `playwright test` invocation.
 *
 * HOW TO ENABLE IT (env-configurable — no backend command is hard-coded here
 * because taiga-back is out of scope for this front-end submodule)
 * ------------------------------------------------------------------------
 * Provide ONE of the following environment variables when running the suite:
 *
 *   • E2E_RESEED_CMD — a shell command that reseeds the backend to its known
 *     baseline. This is the canonical taiga-back reset. Example:
 *
 *         E2E_RESEED_CMD="python manage.py sample_data" \
 *         E2E_RESEED_CWD="../taiga-back" \
 *         npx playwright test --config=e2e-react/playwright.config.ts
 *
 *     (taiga-back's documented reseed is `python manage.py sample_data`, which
 *     drops and regenerates the fixtures the suites expect. Point E2E_RESEED_CWD
 *     at your taiga-back checkout. E2E_RESEED_CMD may be any equivalent, e.g. a
 *     `make reset-db`, a docker-compose exec, or a fixtures reload.)
 *
 *   • E2E_RESEED_URL — an HTTP endpoint that performs the reseed when called.
 *     Optional companions: E2E_RESEED_METHOD (default "POST") and
 *     E2E_RESEED_TOKEN (sent as `Authorization: Bearer <token>`). Example:
 *
 *         E2E_RESEED_URL="http://localhost:8000/api/v1/e2e/reset" \
 *         npx playwright test --config=e2e-react/playwright.config.ts
 *
 * BEHAVIOR WHEN NO RESEED IS CONFIGURED
 * -------------------------------------
 * When neither variable is set, this hook is FAIL-CLOSED (see the [M-16] note on
 * the default export below): by default it THROWS and ABORTS the run rather than
 * silently proceeding against an unknown/dirty dataset — which is exactly the
 * twice-from-clean hazard the finding describes. A run is only allowed to
 * proceed WITHOUT a reset when the operator EXPLICITLY opts in via the
 * off-by-default `E2E_ALLOW_NO_RESEED=1`, which downgrades the abort to a loud,
 * non-failing warning; that escape hatch exists solely for intentional
 * front-end-only / exploratory runs. (This throw applies to actual test runs;
 * `playwright test --list` does NOT invoke globalSetup, so listing tests works
 * regardless.) When a reseed IS configured but FAILS, this hook likewise throws
 * so the run aborts rather than proceeding against a half-reset dataset.
 *
 * COMPLEMENTARY SPEC-LEVEL DETERMINISM
 * ------------------------------------
 * Independently of the backend reseed, the mutating specs are written to be
 * re-run tolerant: sprints are created with unique timestamped names
 * (`sprintName${Date.now()}`), and every create/delete assertion is a RELATIVE
 * count-delta measured around the mutation within its own test (before → after)
 * rather than an absolute expected total. So even between two reseeds the
 * suite's assertions do not collide on duplicate names or drifted counts.
 *
 * RUNTIME / TOOLING
 * -----------------
 * Playwright transpiles this .ts file itself (same as the specs/config); it is
 * intentionally outside app/react/**'s tsconfig.json. It uses only Node
 * built-ins (`node:child_process`) and the Playwright `request` API, so it runs
 * on both the project's pinned Node 16 toolchain and newer Node.
 */

import { request, type FullConfig } from '@playwright/test';
import { execSync } from 'node:child_process';

/** Env var holding a shell command that reseeds the backend. */
const RESEED_CMD = process.env.E2E_RESEED_CMD;
/** Optional working directory for E2E_RESEED_CMD (e.g. the taiga-back checkout). */
const RESEED_CWD = process.env.E2E_RESEED_CWD;
/** Env var holding an HTTP endpoint that reseeds the backend when called. */
const RESEED_URL = process.env.E2E_RESEED_URL;
/** HTTP method for E2E_RESEED_URL (default POST). */
const RESEED_METHOD = (process.env.E2E_RESEED_METHOD || 'POST').toUpperCase();
/** Optional bearer token for the reseed endpoint. */
const RESEED_TOKEN = process.env.E2E_RESEED_TOKEN;

/**
 * Reseed via a shell command. Throws (aborting the run) if the command fails,
 * because proceeding against a half-reset dataset defeats the purpose.
 */
function reseedViaCommand(command: string): void {
    // eslint-disable-next-line no-console
    console.log(
        `[e2e-react globalSetup] Reseeding backend via E2E_RESEED_CMD: ${command}` +
            (RESEED_CWD ? ` (cwd: ${RESEED_CWD})` : ''),
    );
    try {
        execSync(command, {
            cwd: RESEED_CWD || process.cwd(),
            stdio: 'inherit',
            env: process.env,
        });
    } catch (error) {
        throw new Error(
            `[e2e-react globalSetup] Reseed command failed — aborting the run to ` +
                `avoid a non-deterministic dataset. Command: "${command}". ` +
                `Underlying error: ${(error as Error).message}`,
        );
    }
}

/**
 * Reseed by calling an HTTP endpoint. Uses the Playwright `request` API so no
 * global `fetch` (absent on Node 16) is required. Throws on a non-OK response.
 */
async function reseedViaHttp(url: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
        `[e2e-react globalSetup] Reseeding backend via E2E_RESEED_URL: ` +
            `${RESEED_METHOD} ${url}`,
    );
    const context = await request.newContext();
    try {
        const headers: Record<string, string> = {};
        if (RESEED_TOKEN) {
            headers['Authorization'] = `Bearer ${RESEED_TOKEN}`;
        }
        const response = await context.fetch(url, { method: RESEED_METHOD, headers });
        if (!response.ok()) {
            throw new Error(
                `reseed endpoint returned HTTP ${response.status()} ${response.statusText()}`,
            );
        }
    } catch (error) {
        throw new Error(
            `[e2e-react globalSetup] Reseed request failed — aborting the run to ` +
                `avoid a non-deterministic dataset. URL: "${url}". ` +
                `Underlying error: ${(error as Error).message}`,
        );
    } finally {
        await context.dispose();
    }
}

/**
 * Playwright global setup entry point. Runs ONCE before the whole suite.
 *
 * @param _config The resolved Playwright config (unused; the reset is driven
 *                entirely by the E2E_RESEED_* environment variables).
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
    if (RESEED_CMD) {
        reseedViaCommand(RESEED_CMD);
        return;
    }
    if (RESEED_URL) {
        await reseedViaHttp(RESEED_URL);
        return;
    }

    // [M-16] No reseed configured. Determinism requires a known-clean dataset
    // before the run, so this is FAIL-CLOSED: by default we THROW and abort the
    // run rather than silently proceeding against an unknown/mutated backend
    // (the previous behavior — a non-failing `console.warn` no-op — masked a
    // missing reset and let a dirty dataset produce flaky, non-reproducible
    // results). A run is only allowed to proceed without a reset when the
    // operator EXPLICITLY opts in via E2E_ALLOW_NO_RESEED, which is off by
    // default; that escape hatch exists solely for intentional front-end-only /
    // exploratory runs and is announced loudly.
    const guidance =
        '  Configure ONE of:\n' +
        '    • E2E_RESEED_CMD (e.g. "python manage.py sample_data" with ' +
        'E2E_RESEED_CWD pointing at your taiga-back checkout), or\n' +
        '    • E2E_RESEED_URL (an HTTP endpoint that reseeds sample_data).\n' +
        '  Both reset paths already fail-closed (they throw if the reset fails).';

    const allowNoReseed = /^(1|true|yes)$/i.test(process.env.E2E_ALLOW_NO_RESEED || '');
    if (!allowNoReseed) {
        throw new Error(
            '[e2e-react globalSetup] No deterministic reseed configured — aborting the ' +
                'run to avoid a non-reproducible dataset (fail-closed).\n' +
                guidance +
                '\n  To intentionally run WITHOUT a reset (front-end-only / exploratory ' +
                'runs only), set E2E_ALLOW_NO_RESEED=1.',
        );
    }

    // Explicit opt-out taken: proceed WITHOUT a reset, but say so loudly.
    // eslint-disable-next-line no-console
    console.warn(
        '[e2e-react globalSetup] E2E_ALLOW_NO_RESEED is set — proceeding WITHOUT a ' +
            'deterministic reseed. The dataset is NOT guaranteed clean; results may ' +
            'not be reproducible.\n' +
            guidance,
    );
}
