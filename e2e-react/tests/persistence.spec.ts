/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Persisted-outcome end-to-end spec for the migrated React Backlog screen (M-04).
 *
 * WHY THIS SPEC EXISTS
 *   The committed evidence specs (`kanban.spec.ts`, `backlog.spec.ts`) are
 *   deliberately NON-MUTATING (F-AAP-06): they open every write lightbox for a
 *   screenshot and then CANCEL it, and they release every drag at its origin
 *   (`dragNetZero`). That is exactly right for keeping the seed-once database
 *   byte-for-byte identical across the baseline and react capture passes
 *   (AAP §0.6.3) — but, as QA finding M-04 (P5-AUTO-01) correctly observes, a
 *   suite that only ever cancels can NEVER prove that a write actually PERSISTS
 *   end-to-end through the React UI -> `/api/v1/` contract -> database.
 *
 *   This spec closes that gap the way the M-04 suggested fix prescribes:
 *     • DISPOSABLE DATA  — it creates a uniquely-named `BLITZY-E2E-PERSIST-*`
 *       user story, never touching any seeded `sample_data` row.
 *     • ASSERT PERSISTED OUTCOMES ROBUSTLY — it verifies the create landed
 *       SERVER-SIDE (independent `/api/v1/userstories` read, pagination
 *       disabled) AND survives a full page navigation/refetch, not merely a
 *       transient client-state count.
 *     • GUARANTEE NET-ZERO via snapshot/restore — the create is immediately
 *       reverted with a `DELETE /api/v1/userstories/{id}`, and an `afterEach`
 *       safety-net sweeps any stray probe row, so the round-trip leaves the
 *       database exactly as it found it (verified server-side: the project
 *       story count returns to its baseline and zero probe rows remain).
 *
 * PHASE GATING
 *   The write path exercised here (`.lightbox-generic-bulk`, the `.new-us`
 *   <button> triggers, the native React submit) is emitted ONLY by the migrated
 *   React screen. The AngularJS baseline DOM never rendered these, so this spec
 *   runs ONLY in the React capture phase (`CAPTURE_PHASE=react`); in the baseline
 *   phase the whole group is skipped. It produces NO committed artifacts — it is
 *   a correctness gate, not an evidence capture — so it never affects the
 *   comparability of the before/after screenshot sets.
 *
 * LAYER ISOLATION (AAP §0.6.4) & SECURITY (F-SEC-01)
 *   Only `../fixtures` (Playwright-native helpers) and `@playwright/test` types
 *   are imported — no React application source, no Jest layer, no Protractor
 *   harness. The bearer token minted for the server-side assertions/cleanup is
 *   held in memory only, never logged or rendered; tracing stays disabled so no
 *   token-bearing record is ever committed.
 */

import type { Locator, Page } from '@playwright/test';
import {
  test,
  expect,
  openBacklog,
  BACKLOG_PROJECT_SLUG,
  isReactPhase,
  apiToken,
  listProjectUserstories,
  deleteUserstory,
  cleanupBlitzyProbes,
  uniqueProbeSubject,
  BLITZY_PROBE_PREFIX,
} from '../fixtures';

/**
 * Numeric id of the seeded backlog project. `BACKLOG_PROJECT_SLUG` is
 * `project-3`, whose 1-indexed id is `3` (server-side reads are by numeric id,
 * the UI navigation is by slug — both point at the same project).
 */
const PROJECT_ID = 3;

/**
 * The backlog user-story rows, matched exactly as `backlog.spec.ts` does
 * (`.backlog-table-body > div`) so the row-count semantics are identical to the
 * committed evidence spec.
 */
const rows = (page: Page): Locator => page.locator('.backlog-table-body > div');

test.describe('react persisted-outcome (M-04)', () => {
  // The exercised UI exists only on the migrated React screen: skip the entire
  // group (and its hooks) outside the React capture phase.
  test.skip(
    !isReactPhase(),
    'persisted-outcome spec runs only in the React capture phase (CAPTURE_PHASE=react)',
  );

  // Net-zero SAFETY NET: even if an assertion aborts the test before its own
  // API delete runs, remove every disposable probe row so the seed-once DB is
  // never left polluted. A clean project yields 0 and is a no-op.
  test.afterEach(async ({ request }) => {
    const token = await apiToken(request);
    const removed = await cleanupBlitzyProbes(request, token, PROJECT_ID);
    if (removed > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[persistence.afterEach] swept ${removed} stray probe row(s) to restore net-zero`);
    }
  });

  test('bulk-create persists server-side and is fully reverted (net-zero)', async ({
    page,
    request,
  }) => {
    const subject = uniqueProbeSubject();
    const token = await apiToken(request);

    // --- SNAPSHOT: server-side baseline (pagination disabled -> full set) ---
    const baseline = await listProjectUserstories(request, token, PROJECT_ID);
    const baselineCount = baseline.length;
    expect(
      baseline.some((u) => (u.subject || '').includes(BLITZY_PROBE_PREFIX)),
      'project must start free of BLITZY probe rows',
    ).toBe(false);

    await openBacklog(page, BACKLOG_PROJECT_SLUG);
    const beforeRows = await rows(page).count();

    // --- CREATE through the REAL React bulk-create UI -----------------------
    // `.new-us button` nth(1) is the bulk-create trigger (create = first, bulk =
    // second — BacklogApp.tsx), identical to backlog.spec.ts's NEW_US_TRIGGER.
    await page.locator('.new-us button').nth(1).click();
    const lightbox = page.locator('.lightbox-generic-bulk').first();
    await lightbox.waitFor({ state: 'visible' });

    // One user story per line -> a single unique line creates exactly one story.
    const textarea = lightbox.locator('textarea').first();
    await textarea.click();
    await textarea.fill(subject);
    expect(await textarea.inputValue()).toBe(subject);

    // Submit via the preserved `.js-submit-button` (scoped to this lightbox).
    await lightbox.locator('.js-submit-button').click();
    // The lightbox closes on success; best-effort (the row assertion is the gate).
    await lightbox.waitFor({ state: 'hidden' }).catch(() => {
      /* proceed — the persisted-outcome assertions below are the real gate */
    });

    // --- ASSERT persisted in the live UI -----------------------------------
    await expect(
      page.locator('.backlog-table-body').getByText(subject, { exact: false }),
    ).toBeVisible();
    await expect.poll(() => rows(page).count()).toBe(beforeRows + 1);

    // --- ASSERT persisted SERVER-SIDE (independent of client state) ---------
    const afterCreate = await listProjectUserstories(request, token, PROJECT_ID);
    const created = afterCreate.find((u) => u.subject === subject);
    expect(created, 'created story must exist server-side after submit').toBeTruthy();
    expect(afterCreate.length).toBe(baselineCount + 1);
    const createdId = (created as NonNullable<typeof created>).id;

    // --- ASSERT persisted ACROSS A FRESH NAVIGATION (survives a full refetch)
    // A brand-new navigation re-mounts the React root and re-fetches from the
    // API, so a still-visible row proves durable persistence, not stale state.
    await openBacklog(page, BACKLOG_PROJECT_SLUG);
    await expect(
      page.locator('.backlog-table-body').getByText(subject, { exact: false }),
    ).toBeVisible();

    // --- RESTORE net-zero: delete the disposable probe via the API ----------
    await deleteUserstory(request, token, createdId);

    // --- ASSERT fully reverted (UI + server-side) ---------------------------
    await openBacklog(page, BACKLOG_PROJECT_SLUG);
    await expect(
      page.locator('.backlog-table-body').getByText(subject, { exact: false }),
    ).toHaveCount(0);
    await expect.poll(() => rows(page).count()).toBe(beforeRows);

    const afterDelete = await listProjectUserstories(request, token, PROJECT_ID);
    expect(afterDelete.length, 'server-side story count must return to baseline').toBe(
      baselineCount,
    );
    expect(
      afterDelete.some((u) => (u.subject || '').includes(BLITZY_PROBE_PREFIX)),
      'no BLITZY probe row may remain after the round-trip',
    ).toBe(false);
  });
});
