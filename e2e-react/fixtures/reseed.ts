/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Playwright `globalSetup` establishing a KNOWN, deterministic database state
 * before each evidence variant runs (F13).
 *
 * Why this exists
 * ---------------
 * The before/after parity obligation requires the `baseline` (AngularJS) and
 * `react` runs to exercise IDENTICAL initial data, and the suite is serial and
 * stateful (real `/api/v1/` mutations accumulate across tests). Without a reset
 * between variants, baseline mutations would alter the data the React run sees,
 * making the two evidence sets incomparable. The seeded `sample_data` command is
 * NOT idempotent — it APPENDS a fresh batch of projects on every invocation and
 * assumes the superuser already exists — so "re-run sample_data" alone does not
 * restore a known state. A true reset therefore means either restoring a
 * database snapshot or running a full flush + createsuperuser + sample_data
 * sequence. Because that sequence is environment-specific (it runs through the
 * out-of-scope, frozen `taiga-docker` `taiga-manage.sh`), the exact command is
 * injected via `TAIGA_RESEED_CMD` rather than hard-coded here.
 *
 * Contract (explicit, never a silent mask)
 * -----------------------------------------
 *   1. `TAIGA_VARIANT` is validated first (fail-fast for the whole run before any
 *      browser launches). This is the earliest point a real run can reject an
 *      ambiguous variant; `playwright test --list` does NOT invoke globalSetup,
 *      so discovery is unaffected.
 *   2. If `TAIGA_RESEED_CMD` is set, it is executed synchronously to restore the
 *      known state; a non-zero exit aborts the run.
 *   3. Else if `TAIGA_SKIP_RESEED` is set (any non-empty value), the reset is
 *      skipped with a logged notice. This is the documented escape hatch for
 *      environments that guarantee a known state by other means — a freshly
 *      seeded Docker volume, or an externally restored snapshot — such as the
 *      one-shot baseline capture run. It is an EXPLICIT operator opt-out, not a
 *      silent default.
 *   4. Otherwise the run ABORTS with guidance, because continuing would silently
 *      compromise the determinism F13 requires.
 *
 * Playwright-only: imports the Node `child_process` builtin and the sibling
 * `./evidence` (Playwright/Node modules only). No Jest imports, no `app/react/**`
 * imports; the root `jest.config.js` excludes `e2e-react/`.
 *
 * @module e2e-react/fixtures/reseed
 */

import { execSync } from 'child_process';
import { resolveVariant } from './evidence';

/**
 * Execute the configured database reset/reseed command, restoring the known
 * `sample_data` state.
 *
 * The command is taken verbatim from `TAIGA_RESEED_CMD` and run through the
 * shell with inherited stdio so its output is visible in the run log. A typical
 * value for the Docker topology performs a full reset, for example:
 *
 * ```sh
 * TAIGA_RESEED_CMD='cd ../taiga-docker \
 *   && ./taiga-manage.sh flush --noinput \
 *   && DJANGO_SUPERUSER_PASSWORD=$TAIGA_ADMIN_PASSWORD ./taiga-manage.sh \
 *        createsuperuser --noinput --username admin --email admin@example.com \
 *   && ./taiga-manage.sh sample_data'
 * ```
 *
 * @throws If the command exits non-zero (the run must not proceed on a
 *         half-reset database).
 */
export function reseedSampleData(): void {
  const cmd = process.env.TAIGA_RESEED_CMD;
  if (!cmd) {
    throw new Error('reseedSampleData() called without TAIGA_RESEED_CMD set.');
  }
  // eslint-disable-next-line no-console
  console.log(`[reseed] restoring known sample_data state via TAIGA_RESEED_CMD`);
  execSync(cmd, { stdio: 'inherit' });
}

/**
 * Playwright `globalSetup` entry point. Runs once per `playwright test`
 * invocation (i.e. once per variant run), before any browser is launched.
 *
 * @throws If `TAIGA_VARIANT` is invalid, or if no reset strategy is configured
 *         and the reset was not explicitly opted out of.
 */
export default async function globalSetup(): Promise<void> {
  // 1) Whole-run fail-fast on an ambiguous evidence variant (F12). Done here so
  //    the run is rejected before any browser launch, while `--list` (which does
  //    not call globalSetup) still discovers tests without TAIGA_VARIANT.
  const variant = resolveVariant();

  // 2) Known-state reset (F13).
  if (process.env.TAIGA_RESEED_CMD) {
    // eslint-disable-next-line no-console
    console.log(`[reseed] variant="${variant}": resetting database to known sample_data state`);
    reseedSampleData();
    return;
  }

  // 3) Explicit, documented opt-out for externally-guaranteed known states.
  if (process.env.TAIGA_SKIP_RESEED) {
    // eslint-disable-next-line no-console
    console.log(
      `[reseed] variant="${variant}": TAIGA_SKIP_RESEED set — skipping in-harness reset. ` +
        `The database is assumed to already be in a known, freshly-seeded state ` +
        `(e.g. a fresh Docker volume or an externally restored snapshot).`,
    );
    return;
  }

  // 4) No strategy configured — abort rather than silently risk non-determinism.
  throw new Error(
    `Database reset strategy not configured for the "${variant}" evidence run (F13). ` +
      `Set TAIGA_RESEED_CMD to a command that restores a known sample_data state ` +
      `(flush + createsuperuser + sample_data, or a snapshot restore), OR set ` +
      `TAIGA_SKIP_RESEED=1 to explicitly opt out when the environment already ` +
      `guarantees a known state (e.g. a freshly-seeded Docker volume). Refusing to ` +
      `proceed on a possibly-mutated database so baseline and React evidence stay comparable.`,
  );
}
