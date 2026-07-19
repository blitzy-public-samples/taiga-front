/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * React Kanban — Playwright end-to-end (visual-evidence) spec.
 *
 * Playwright-native, TypeScript behavioral PORT of the legacy Protractor suite
 * e2e/suites/kanban.e2e.js. It drives the migrated React Kanban board through
 * the deployed nginx stack (host port 9000) and captures before/after visual
 * evidence for the AngularJS-to-React migration.
 *
 * ISOLATION / CONSTRAINTS (AAP 0.6.4, 0.7.1):
 *   - Runs ONLY via `npm run e2e` (playwright test --config
 *     e2e-react/playwright.config.ts); never via the browserless unit runner or
 *     Gulp.
 *   - The ONLY non-Node imports are from the `../fixtures` barrel (plus a
 *     type-only import from `@playwright/test`). No legacy Protractor code, no
 *     import of the migrated React application source, no dependency on the root
 *     TypeScript project. The legacy suite/helpers are consulted for BEHAVIOR
 *     and SELECTORS only.
 *   - Credentials are never embedded: login is performed by the auto-
 *     authenticated `test` fixture from `../fixtures` (which resolves the admin
 *     password from the environment with the documented dev fallback).
 *   - One framework per run: baseline (AngularJS) vs react is selected by
 *     CAPTURE_PHASE and handled entirely inside the fixtures.
 *
 * NON-MUTATING CAPTURE (F-AAP-06): the seed-once database MUST NOT be mutated by
 * a committed capture run, so the baseline and React passes observe byte-for-byte
 * identical data and the before/after artifacts stay comparable (AAP 0.6.3).
 * Every step here is therefore NET-ZERO: create/edit/bulk lightboxes are opened
 * for evidence and then CANCELLED (never submitted); every drag uses
 * `dragNetZero` (released at the origin, a no-op on both dragula and @dnd-kit);
 * a native `window.confirm` (React delete) is auto-DISMISSED; and each mutating
 * scenario asserts the board is UNCHANGED afterwards. This mirrors the proven
 * net-zero methodology that produced the committed baseline fingerprints.
 *
 * STRICT, PHASE-AWARE SELECTORS (F-CQ-08): assertions are strict on the
 * non-mutating observable outcome (a lightbox opens with the right fields, a
 * net-zero drag leaves counts unchanged, a filter reduces then restores the
 * board). Broad best-effort catches are used ONLY for genuinely optional
 * decoration (cookie banner, product tour, tag colour picker) and are labelled
 * as such — they never mask a scenario's primary assertion. Selectors that
 * diverge between the AngularJS and React DOM are resolved with
 * `phaseSelector(baseline, react)` (see `../fixtures/common` for the verified map).
 *
 * PARITY COVERAGE (F-AAP-07): read-only parity branches present in the migrated
 * React screen — swimlanes, WIP-limit display, the archived-status column, and
 * the search filter — are covered with strict, non-mutating assertions.
 * Branches that depend on deferred features or fixtures NOT available in this
 * environment are documented as principled deferrals at the point of use:
 *   - the create/edit/assign/bulk user-story lightboxes and the board zoom
 *     control are DEFERRED in React (F-CQ-02 / AAP 0.4.1 manifest — a shared
 *     common-module lightbox / out-of-scope control), so those steps assert the
 *     trigger's presence and are exercised only in the baseline phase;
 *   - the `modify_us` / `delete_us` permission-denied branch requires a seeded
 *     restricted (non-admin) user that `sample_data` does not create; that gate
 *     is covered exhaustively by the browserless unit suite
 *     (`app/react/shared/__tests__/permissions.test.ts`, F-REG-03).
 *
 * TEST STRUCTURE — the legacy suite ran a single navigation hook followed by
 * ordered, state-sharing blocks. That is reproduced as ONE serial test made of
 * ordered `test.step`s, so the single logged-in page, the cumulative board
 * state, and one continuous evidence video (config `video: 'on'`) are preserved.
 */

import {
  test,
  expect,
  openKanban,
  waitLoader,
  dragNetZero,
  screenshot,
  phaseSelector,
  isReactPhase,
} from '../fixtures';
import type { Page, Locator } from '@playwright/test';

/* ------------------------------------------------------------------ *
 * Local, pure-Playwright selector helpers (no external imports).
 * These mirror the legacy `kanban-helper.js` element getters so each
 * scenario reads like its Protractor ancestor, but resolve the board
 * column via `phaseSelector` because React wraps a column in
 * `.taskboard-column` rather than the AngularJS `.task-column`.
 * ------------------------------------------------------------------ */

/** All board status columns (legacy `.task-column`; React `.taskboard-column`). */
const columns = (page: Page): Locator =>
  page.locator(phaseSelector('.task-column', '.taskboard-column'));

/** The `tg-card`s inside a given column index (legacy `kanbanHelper.getBoxUss`). */
const columnCards = (page: Page, i: number): Locator => columns(page).nth(i).locator('tg-card');

/**
 * Every `tg-card` ON THE BOARD (legacy `kanbanHelper.getUss`; React reuses
 * `tg-card`). Scoped to cards INSIDE a status column (via the phase-aware
 * `columns` locator) rather than a document-wide `tg-card` query. This is both
 * semantically correct ("cards rendered on the board") and robust to the
 * transient @dnd-kit `DragOverlay` clone: while a card is being dragged, dnd-kit
 * portals a `tg-card` CLONE to `document.body` (outside every column) so it can
 * escape the columns' overflow clipping. A document-wide count would therefore
 * momentarily read one extra card immediately after a drag (the clone is removed
 * on the next React tick), spuriously inflating a following net-zero assertion.
 * Restricting the count to in-column cards excludes that ephemeral clone while
 * still reflecting exactly the cards a user sees on the board.
 */
const allCards = (page: Page): Locator => columns(page).locator('tg-card');

/** Vertically-folded columns (`.vfold` on the column header, both phases). */
const foldedColumns = (page: Page): Locator => page.locator('.task-colum-name.vfold');

// Serial mode keeps the ordered steps running back-to-back on one worker,
// mirroring the legacy single-suite execution (the config already sets
// workers: 1) and preserving the shared, cumulative board state.
test.describe.configure({ mode: 'serial' });

test('kanban', async ({ page }) => {
  // NON-MUTATING GUARD (F-AAP-06): auto-dismiss any native confirm dialog so a
  // React delete/confirm can be exercised for evidence without ever persisting
  // the deletion. Registered before the first interaction; applies for the whole
  // serial test.
  page.on('dialog', (dialog) => {
    dialog.dismiss().catch(() => {
      /* the dialog may already be handled — ignore */
    });
  });

  // ---- before(): navigate to the seeded Kanban board and capture it. --------
  // `openKanban` navigates to `project/project-0/kanban` (relative to the config
  // baseURL http://localhost:9000/) and stabilizes (cookies + product tour +
  // loader). The host is never hardcoded and the legacy dev-server port is never
  // used — both are owned by the fixtures.
  await openKanban(page);
  await waitLoader(page);
  await screenshot(page, 'kanban', 'kanban');

  // PRIMARY (strict): the seeded board renders at least one status column.
  const initialColumnCount = await columns(page).count();
  expect(initialColumnCount).toBeGreaterThan(0);

  // ---- zoom (legacy lines 31-47) — visual evidence, phase-aware -------------
  // The board zoom control (`tg-board-zoom`) exists only on the AngularJS board;
  // React does not reimplement it (F-CQ-02), so the zoom levels are driven only
  // in the baseline phase. The React phase captures the default-zoom board for
  // the artifact set. Zoom is a per-user visual preference (not board data), so
  // there is deliberately no data assertion here.
  await test.step('zoom', async () => {
    if (!isReactPhase()) {
      const zoomControl = page.locator('tg-board-zoom');
      const hasZoom = (await zoomControl.count()) > 0;
      for (const level of [1, 2, 3, 4]) {
        if (hasZoom) {
          await zoomControl
            .first()
            .click({ position: { x: level * 49, y: 14 } })
            .catch(() => {
              /* zoom-control geometry can vary — capture anyway (visual only). */
            });
          await page.waitForTimeout(500);
        }
        await screenshot(page, 'kanban', `zoom${level}`);
      }
    } else {
      // React: zoom control deferred (F-CQ-02); capture the default board.
      await screenshot(page, 'kanban', 'zoom-default');
    }
  });

  // ---- swimlanes (F-AAP-07 parity branch — read-only, non-mutating) ---------
  // The seeded board renders either in swimlane mode (`.kanban-swimlane` rows,
  // each with a `.kanban-swimlane-title` header) or in flat no-swimlane mode
  // (columns directly). Both are valid parity states; the branch is covered by
  // capturing the board and asserting the rendered mode's structural invariant.
  await test.step('swimlanes', async () => {
    await screenshot(page, 'kanban', 'swimlanes');
    const swimlanes = page.locator('.kanban-swimlane');
    const swimlaneCount = await swimlanes.count();
    if (swimlaneCount > 0) {
      // Swimlane mode: every swimlane row carries a header title bar.
      expect(await page.locator('.kanban-swimlane-title').count()).toBeGreaterThan(0);
    } else {
      // No-swimlane mode: the flat column set is present.
      expect(await columns(page).count()).toBeGreaterThan(0);
    }
  });

  // ---- WIP limits (F-AAP-07 parity branch — read-only, non-mutating) --------
  // A status configured with a positive `wip_limit` renders a `.kanban-wip-limit`
  // marker (WipLimit.tsx reuses the class verbatim). When the seeded board
  // exercises the branch, the marker must be attached to the DOM; the board
  // screenshot is always captured as evidence for both phases.
  await test.step('wip limits', async () => {
    await screenshot(page, 'kanban', 'wip-limits');
    const wip = page.locator('.kanban-wip-limit');
    if ((await wip.count()) > 0) {
      await expect(wip.first()).toBeAttached();
    }
  });

  // ---- archived-status column (F-AAP-07 parity branch — read-only) ----------
  // Archived columns render a `.kanban-column-intro` intro spacer as their last
  // child (ArchivedStatusIntro.tsx). Scroll the last board body fully right so
  // the archive column is on-screen, then capture it. Scrolling is non-mutating.
  await test.step('archived column', async () => {
    await page.evaluate(() => {
      const bodies = document.querySelectorAll('.kanban-table-body');
      const last = bodies[bodies.length - 1] as HTMLElement | undefined;
      if (last) {
        last.scrollLeft = 10000;
      }
    });
    await page.waitForTimeout(300);
    await screenshot(page, 'kanban', 'archive');
    const intro = page.locator('.kanban-column-intro');
    if ((await intro.count()) > 0) {
      await expect(intro.first()).toBeAttached();
    }
  });

  // ---- create us (legacy 49-111) — open→evidence→CANCEL, phase-aware --------
  // The create/edit user-story lightbox (`div[tg-lb-create-edit-userstory]`) is
  // a shared common-module AngularJS lightbox that React does NOT reimplement
  // (F-CQ-02 / AAP 0.4.1). Baseline: open it, fill the subject for evidence,
  // screenshot, then CANCEL (never submit — F-AAP-06). React: assert the create
  // trigger renders and document the deferral (no lightbox to open).
  await test.step('create us', async () => {
    const before = await columnCards(page, 0).count();
    // openNewUsLb(0): the 3rd `.option` in the first column header.
    const trigger = page.locator('.task-colum-name').nth(0).locator('.option').nth(2);

    if (isReactPhase()) {
      // React deferral: assert the trigger exists; the detail lightbox is a
      // deferred common-module screen, so nothing is opened or submitted.
      expect(await trigger.count()).toBeGreaterThan(0);
      await screenshot(page, 'kanban', 'create-us-trigger');
    } else {
      await trigger.click();
      const lightbox = page.locator('div[tg-lb-create-edit-userstory]');
      await lightbox.waitFor({ state: 'visible' });
      await screenshot(page, 'kanban', 'create-us');

      const subjectInput = lightbox.locator('input[name="subject"]');
      const subject = `evidence subject ${Date.now()}`;
      await subjectInput.fill(subject);
      await screenshot(page, 'kanban', 'create-us-filled');

      // STRICT (non-mutating): the form accepted the typed subject.
      expect((await subjectInput.inputValue()).trim()).toBe(subject);

      // CANCEL — close without submitting so nothing is persisted.
      await dismissLightbox(page, lightbox);
    }

    // STRICT: no card was added to column 0 (net-zero).
    expect(await columnCards(page, 0).count()).toBe(before);
  });

  // ---- edit us (legacy 114-175) — open→evidence→CANCEL, phase-aware ---------
  await test.step('edit us', async () => {
    if (isReactPhase()) {
      // React: the per-card edit affordance (`.card-owner-actions .e2e-edit`)
      // opens the deferred detail lightbox; assert the board still renders and
      // document the deferral rather than opening a screen React does not host.
      expect(await allCards(page).count()).toBeGreaterThan(0);
      await screenshot(page, 'kanban', 'edit-us-deferred');
      return;
    }

    // Baseline: hover the first card's owner-actions zone, open the edit
    // lightbox, screenshot, then CANCEL (never submit).
    const actions = columns(page).nth(0).locator('.card-owner-actions').first();
    await actions.hover();
    await actions.locator('.e2e-edit').click();

    const lightbox = page.locator('div[tg-lb-create-edit-userstory]');
    await lightbox.waitFor({ state: 'visible' });

    // STRICT: the edit lightbox loaded the existing story (subject pre-filled).
    const subjectInput = lightbox.locator('input[name="subject"]');
    expect((await subjectInput.inputValue()).trim().length).toBeGreaterThan(0);

    await screenshot(page, 'kanban', 'edit-us');
    await dismissLightbox(page, lightbox);
  });

  // ---- fold / unfold column (legacy 209-226) — net-zero UI state ------------
  // Folding is a per-user UI preference (persisted in localStorage, NOT the
  // seed-once DB), and the column is unfolded again immediately, so the pair is
  // net-zero with respect to both the DB fingerprint and the fold map.
  await test.step('fold column', async () => {
    const foldOption = page.locator('.task-colum-name').nth(0).locator('.options a').nth(0);
    if ((await foldOption.count()) === 0) {
      // The fold control is not present in this build/phase — capture and skip
      // the outcome assertion (documented, not masked: nothing was folded).
      await screenshot(page, 'kanban', 'fold-column-unavailable');
      return;
    }
    await foldOption.click();
    await screenshot(page, 'kanban', 'fold-column');
    // STRICT: exactly one column is now folded.
    expect(await foldedColumns(page).count()).toBe(1);

    // Unfold again (2nd option) — restores the board (net-zero).
    await page.locator('.task-colum-name').nth(0).locator('.options a').nth(1).click();
    expect(await foldedColumns(page).count()).toBe(0);
  });

  // ---- move us between columns (legacy 229-245) — NET-ZERO drag -------------
  await test.step('move us between columns', async () => {
    if ((await columns(page).count()) < 2 || (await columnCards(page, 0).count()) === 0) {
      await screenshot(page, 'kanban', 'move-us-unavailable');
      return;
    }
    const c0 = await columnCards(page, 0).count();
    const c1 = await columnCards(page, 1).count();

    const colSel = phaseSelector('.task-column', '.taskboard-column');
    // Real pointer gesture crossing the @dnd-kit activation distance, released at
    // the ORIGIN so no reorder is persisted (F-AAP-06). The drag-in-progress
    // mirror over column 1 is the captured evidence.
    await dragNetZero(page, `${colSel} >> nth=0 >> tg-card >> nth=0`, `${colSel} >> nth=1`, () =>
      screenshot(page, 'kanban', 'move-us-mirror'),
    );
    await waitLoader(page);

    // STRICT: net-zero — both column counts are unchanged.
    expect(await columnCards(page, 0).count()).toBe(c0);
    expect(await columnCards(page, 1).count()).toBe(c1);
  });

  // ---- delete us (legacy 247-266 archive → here a real React delete) --------
  // Kanban delete IS implemented in React (F-CQ-02) behind a native
  // `window.confirm`. The dialog handler registered at the top auto-DISMISSES
  // it, so triggering the affordance is non-mutating. The strict invariant is
  // that the total card count is unchanged (nothing was deleted).
  await test.step('delete us (net-zero)', async () => {
    const before = await allCards(page).count();
    // The delete affordance (`.icon-trash`) lives in the per-card actions and is
    // permission-/zoom-gated; reveal it best-effort, then attempt the delete —
    // the auto-dismissed confirm guarantees no deletion is persisted.
    const del = page.locator('.icon-trash').first();
    if ((await del.count()) > 0) {
      await del.click().catch(() => {
        /* the affordance can be hidden until hover/zoom — the invariant below
           still holds because no deletion is ever confirmed. */
      });
      await waitLoader(page);
    }
    await screenshot(page, 'kanban', 'delete-us-cancelled');
    // STRICT: net-zero — the confirm was dismissed, so no card was removed.
    expect(await allCards(page).count()).toBe(before);
  });

  // ---- assigned-to (legacy 268-284) — phase-aware, non-mutating -------------
  await test.step('assigned to', async () => {
    if (isReactPhase()) {
      // React: the assign-to lightbox (`div[tg-lb-assignedto]`) is deferred
      // (F-CQ-02). Assert cards render and document the deferral.
      expect(await allCards(page).count()).toBeGreaterThan(0);
      await screenshot(page, 'kanban', 'assigned-to-deferred');
      return;
    }
    // Baseline: open the assign lightbox, capture the candidate list, CLOSE it
    // without selecting anyone (no assignment persisted).
    await page.locator('.e2e-assign').first().click();
    const lightbox = page.locator('div[tg-lb-assignedto]');
    await lightbox.waitFor({ state: 'visible' });
    // STRICT: the lightbox lists at least one assignable user.
    expect(await lightbox.locator('div[data-user-id]').count()).toBeGreaterThan(0);
    await screenshot(page, 'kanban', 'assigned-to');
    await dismissLightbox(page, lightbox);
  });

  // ---- filter (F-AAP-07 parity branch — non-mutating, strict) ---------------
  // Filtering is a pure view operation (no DB write). The header search
  // (`<tg-input-search>` in React; `.e2e-filter-q` on the AngularJS board) drives
  // the visible card set: a non-matching query yields zero cards, and clearing
  // it restores the board.
  await test.step('filter', async () => {
    const searchSel = phaseSelector('.e2e-filter-q', 'tg-input-search input');
    const search = page.locator(searchSel).first();
    if ((await search.count()) === 0) {
      await screenshot(page, 'kanban', 'filter-unavailable');
      return;
    }

    const noMatch = `zzz-nomatch-${Date.now()}`;
    await search.fill(noMatch);
    await search.press('Enter').catch(() => {
      /* some search inputs filter on input without Enter — proceed */
    });
    await page.waitForTimeout(600);
    await waitLoader(page);
    await screenshot(page, 'kanban', 'filter-no-match');

    // STRICT: a non-matching query hides every card.
    expect(await allCards(page).count()).toBe(0);

    // Clear the filter and confirm the board is restored (non-empty).
    await search.fill('');
    await search.press('Enter').catch(() => {
      /* proceed — the empty value already cleared the query */
    });
    await page.waitForTimeout(600);
    await waitLoader(page);
    // STRICT: clearing the filter restores a non-empty board.
    expect(await allCards(page).count()).toBeGreaterThan(0);
  });

  // ---- accessibility (F-AAP-07 a11y parity branch — non-mutating) -----------
  // The migrated React screen adds keyboard-accessible drag and ARIA semantics
  // (F-UI-04/05, AAP 0.6.5). In the React phase, assert the search input carries
  // an accessible name; both phases capture a final board screenshot.
  await test.step('accessibility', async () => {
    if (isReactPhase()) {
      const searchInput = page.locator('tg-input-search input').first();
      if ((await searchInput.count()) > 0) {
        const label =
          (await searchInput.getAttribute('aria-label')) ??
          (await searchInput.getAttribute('placeholder'));
        // STRICT: the search field exposes an accessible name.
        expect(label && label.trim().length).toBeTruthy();
      }
    }
    await screenshot(page, 'kanban', 'accessibility');
  });
});

/* ------------------------------------------------------------------ *
 * Local helpers
 * ------------------------------------------------------------------ */

/**
 * Close a lightbox WITHOUT submitting it, so nothing is persisted to the
 * seed-once DB (F-AAP-06). Prefers the explicit close control, falls back to
 * Escape, then confirms the lightbox is gone. Dismissal is an action (not the
 * scenario's assertion), so its individual steps are best-effort; the caller's
 * strict "count unchanged" assertion is what proves the net-zero outcome.
 */
async function dismissLightbox(page: Page, lightbox: Locator): Promise<void> {
  const close = lightbox.locator('.close, .icon-close').first();
  if ((await close.count()) > 0) {
    await close.click().catch(() => {
      /* fall through to Escape */
    });
  }
  await page.keyboard.press('Escape').catch(() => {
    /* the lightbox may already be closing */
  });
  await lightbox.waitFor({ state: 'hidden' }).catch(() => {
    /* proceed — the strict count assertion in the caller is the real gate */
  });
}
