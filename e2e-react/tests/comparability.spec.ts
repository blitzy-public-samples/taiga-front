/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Comparability re-capture spec — refresh the top-level React before/after pairs
 * against the CURRENT deployed bundle (M-06, P5-EVIDENCE-01).
 *
 * WHAT M-06 REPORTS
 *   The committed React artifact set was STALE (captured against an older
 *   `react.js` bundle) and INCOMPLETE relative to the five before/after pairs the
 *   MANIFEST enumerates. (M-06 also flags that the baseline-before-deletion Git
 *   chronology is not provable from history — that half is addressed honestly in
 *   the artifacts documentation, since the AngularJS screens no longer exist and a
 *   true baseline can NOT be re-captured without reverting the migration.)
 *
 * WHAT THIS SPEC DOES
 *   Re-captures ONLY the five git-tracked TOP-LEVEL React pair PNGs
 *   (`artifacts/react/<name>.png`) against the live nginx-served React build, so
 *   the committed React evidence matches the current bundle. The five pairs, their
 *   routes and states are exactly those enumerated in `artifacts/MANIFEST.md`:
 *
 *     1. project-3 kanban  -> kanban_p3_swimlanes_1280  (5 swimlanes + WIP limits)
 *     2. project-4 kanban  -> kanban_p4_flat_1280       (flat board, no swimlanes)
 *     3. project-6 kanban  -> kanban_p6_empty_1280      (empty-state board)
 *     4. project-3 backlog -> backlog_p3_1280           (13 stories, 5 sprints)
 *     5. project-6 backlog -> backlog_p6_empty_1280     (empty-state backlog)
 *
 *   Each capture uses the config's fixed 1280x800 viewport (matching the baseline
 *   PNG dimensions) so the before/after pair is dimensionally comparable.
 *
 * NET-ZERO & SAFETY
 *   This spec is strictly READ-ONLY: it navigates and screenshots, performing NO
 *   create/edit/delete and NO drag, so it cannot mutate the seed-once database.
 *
 * HARD PHASE GATE (critical)
 *   The whole group is skipped unless `CAPTURE_PHASE=react`. This is a safety
 *   interlock: the destination path is phase-derived, and the genuine AngularJS
 *   `artifacts/baseline/*.png` captures are IRREPLACEABLE (the AngularJS screens
 *   have already been removed and can never be re-rendered). Gating to the react
 *   phase guarantees this spec can only ever (over)write the `artifacts/react/**`
 *   set and can NEVER clobber the baseline set.
 *
 * ISOLATION / TOOLCHAIN
 *   Imports only `../fixtures` (Playwright-native) and Node's `path`; nothing from
 *   the React app, Jest, or the Protractor harness. Node-16-safe.
 */

import * as path from 'path';
import {
  test,
  openKanban,
  openBacklog,
  isReactPhase,
  artifactsDir,
  capturePhase,
} from '../fixtures';

/** One committed top-level before/after pair (see `artifacts/MANIFEST.md`). */
interface ComparabilityPair {
  screen: 'kanban' | 'backlog';
  slug: string;
  /** Base filename (no extension) — matched to the baseline pair by name. */
  name: string;
}

/** The five MANIFEST pairs, in table order. */
const PAIRS: ComparabilityPair[] = [
  { screen: 'kanban', slug: 'project-3', name: 'kanban_p3_swimlanes_1280' },
  { screen: 'kanban', slug: 'project-4', name: 'kanban_p4_flat_1280' },
  { screen: 'kanban', slug: 'project-6', name: 'kanban_p6_empty_1280' },
  { screen: 'backlog', slug: 'project-3', name: 'backlog_p3_1280' },
  { screen: 'backlog', slug: 'project-6', name: 'backlog_p6_empty_1280' },
];

test.describe('react comparability captures (M-06)', () => {
  // Safety interlock — only ever write the react pair set, never the irreplaceable
  // AngularJS baseline set.
  test.skip(
    !isReactPhase(),
    'comparability re-capture writes artifacts/react top-level pairs; runs only with CAPTURE_PHASE=react',
  );

  for (const pair of PAIRS) {
    test(`recapture ${pair.name}`, async ({ page }) => {
      if (pair.screen === 'kanban') {
        await openKanban(page, pair.slug);
      } else {
        await openBacklog(page, pair.slug);
      }

      // Brief settle so async board paint + web fonts stabilize before the shot
      // (the openers already gate on the primary board content best-effort).
      await page.waitForTimeout(800);

      // Top-level phase path: artifacts/react/<name>.png (NOT a section subfolder),
      // matching the committed baseline pair filenames exactly. `page.screenshot`
      // creates the parent directory as needed.
      const dest = path.join(artifactsDir(), capturePhase(), `${pair.name}.png`);
      await page.screenshot({ path: dest, fullPage: false });
    });
  }
});
