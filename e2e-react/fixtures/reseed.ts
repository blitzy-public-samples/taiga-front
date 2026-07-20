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
 * Frozen-baseline comparability (E2)
 * ----------------------------------
 * The `baseline` (AngularJS) evidence is captured ONCE, against a specific
 * randomized `sample_data` seed, BEFORE the `kanban.jade` / `backlog.jade`
 * template swap. After the swap those AngularJS routes cease to exist, so the
 * baseline is IRRECOVERABLE. Because `sample_data` is randomized and
 * non-idempotent, any reseed of the `react` capture yields DIFFERENT data than
 * the frozen baseline was captured against, permanently breaking before/after
 * comparability. The setup "persistence rule" therefore requires the SAME
 * Postgres volume to be preserved across both captures. The contract below
 * encodes that rule: the `react` variant preserves the volume by construction
 * (it refuses an explicit reseed and, absent any strategy, defaults to
 * preserve), while the `baseline` variant retains strict fail-fast because a
 * baseline capture legitimately needs a freshly-established known state.
 *
 * Contract (explicit, never a silent mask)
 * -----------------------------------------
 *   1. `TAIGA_VARIANT` is validated first (fail-fast for the whole run before any
 *      browser launches). This is the earliest point a real run can reject an
 *      ambiguous variant; `playwright test --list` does NOT invoke globalSetup,
 *      so discovery is unaffected.
 *   2. If `TAIGA_RESEED_CMD` is set: for the `baseline` variant it is executed
 *      synchronously to restore the known state (a non-zero exit aborts the run);
 *      for the `react` variant it is REJECTED (E2 comparability guard) because a
 *      reseed would break comparability with the frozen baseline.
 *   3. Else if `TAIGA_SKIP_RESEED` is set (any non-empty value), the reset is
 *      skipped with a logged notice. This is the documented escape hatch for
 *      environments that guarantee a known state by other means — a freshly
 *      seeded Docker volume, or an externally restored snapshot. It is the
 *      REQUIRED mode for the `react` capture (it preserves the exact volume the
 *      frozen baseline was captured against) and is also used for the one-shot
 *      baseline capture run.
 *   4. Otherwise (no strategy configured): the `react` variant DEFAULTS to
 *      preserving the existing seeded volume (the frozen-baseline persistence
 *      rule makes this the only comparability-preserving choice, and the baseline
 *      route no longer exists to reseed against), while the `baseline` variant
 *      ABORTS with guidance, because capturing the irreplaceable baseline against
 *      an unknown/mutated database would silently compromise F13 determinism.
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
  //
  // FROZEN-BASELINE COMPARABILITY GUARD (E2). The `baseline` (AngularJS) evidence
  // was captured ONCE, against a specific randomized `sample_data` seed, BEFORE
  // the `kanban.jade` / `backlog.jade` template swap. After the swap those two
  // AngularJS routes no longer exist, so the baseline is IRRECOVERABLE — it can
  // never be re-captured against a fresh seed. `sample_data` is non-idempotent
  // and randomized, so any reseed of the `react` variant produces DIFFERENT data
  // (different projects, user-story refs, sprint counts and point totals) than
  // the frozen baseline was captured against, which is exactly the E2 defect:
  // the before/after frames stop being comparable. The setup "persistence rule"
  // therefore mandates: PRESERVE the Postgres volume across the baseline and
  // React captures and NEVER reseed between them. This block enforces that rule
  // by construction so the comparability cannot be broken by a stray env var.
  if (process.env.TAIGA_RESEED_CMD) {
    if (variant === 'react') {
      // Reseeding the React variant would overwrite the seeded volume the frozen
      // AngularJS baseline was captured against, permanently breaking before/after
      // comparability (E2). Refuse rather than silently produce incomparable
      // evidence. Preserve the volume instead (TAIGA_SKIP_RESEED=1).
      throw new Error(
        `TAIGA_RESEED_CMD is set for the "react" evidence variant, but reseeding the ` +
          `React capture is FORBIDDEN (E2 comparability guard). The AngularJS "baseline" ` +
          `evidence was captured once against a specific randomized sample_data seed and ` +
          `is IRRECOVERABLE (its kanban.jade/backlog.jade routes no longer exist after the ` +
          `template swap). sample_data is randomized and non-idempotent, so any reseed here ` +
          `would render the React frames incomparable to the frozen baseline. Preserve the ` +
          `Postgres volume instead: unset TAIGA_RESEED_CMD and set TAIGA_SKIP_RESEED=1 for ` +
          `the React capture, per the documented persistence rule.`,
      );
    }
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
        `(e.g. a fresh Docker volume or an externally restored snapshot). For the "react" ` +
        `variant this is the REQUIRED mode: it preserves the exact Postgres volume the ` +
        `frozen AngularJS baseline was captured against, keeping before/after evidence ` +
        `comparable (E2 persistence rule).`,
    );
    return;
  }

  // 4) No strategy configured.
  //
  // For the `react` variant the frozen-baseline persistence rule (E2) makes
  // volume-preservation the ONLY comparability-preserving choice, and the
  // baseline route no longer exists to re-seed against — so preserving the
  // already-seeded volume is the correct DEFAULT rather than an error. This lets
  // the post-migration React capture run without ceremony while still keeping the
  // evidence comparable to the frozen baseline. (The `baseline` variant keeps the
  // strict fail-fast below, because a baseline capture legitimately needs a
  // freshly-established known state.)
  if (variant === 'react') {
    // eslint-disable-next-line no-console
    console.log(
      `[reseed] variant="react": no reset strategy configured — DEFAULTING to preserve the ` +
        `existing seeded Postgres volume (E2 frozen-baseline persistence rule). The AngularJS ` +
        `baseline is frozen and cannot be re-captured, so the React evidence is captured ` +
        `against the volume already in place; reseeding here is intentionally NOT performed. ` +
        `Set TAIGA_SKIP_RESEED=1 to make this explicit, or restore a matching snapshot out of ` +
        `band if a different known state is required.`,
    );
    return;
  }

  // `baseline` variant with no strategy — abort rather than silently risk
  // capturing the irreplaceable baseline against an unknown/mutated database.
  throw new Error(
    `Database reset strategy not configured for the "${variant}" evidence run (F13). ` +
      `Set TAIGA_RESEED_CMD to a command that restores a known sample_data state ` +
      `(flush + createsuperuser + sample_data, or a snapshot restore), OR set ` +
      `TAIGA_SKIP_RESEED=1 to explicitly opt out when the environment already ` +
      `guarantees a known state (e.g. a freshly-seeded Docker volume). Refusing to ` +
      `proceed on a possibly-mutated database so the irreplaceable baseline evidence ` +
      `is captured against a known state.`,
  );
}
