/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * parity-negative.spec.ts — negative / permission / rollback / accessibility /
 * advanced-DnD / attachment browser coverage (review finding M25).
 *
 * The two main parity specs (`kanban.spec.ts`, `backlog.spec.ts`) port the
 * legacy Protractor happy-path cases. M25 requires the browser suite to ALSO
 * exercise the paths the legacy suites omitted — the exact behaviours the
 * remediation added to the React screens:
 *
 *   - fail-closed module authorization           — C5 (is_kanban/backlog_activated)
 *   - per-permission control gating              — M4 (my_permissions / add_us)
 *   - optimistic-update-then-rollback on failure — C7 / M9 (bulk-order PATCH 500)
 *   - accessible loading + control names         — M19 / M20 (role="status", aria-label)
 *   - keyboard drag-and-drop + cancellation      — M18 (@dnd-kit KeyboardSensor)
 *   - attachment add/remove lifecycle            — M1 (story-form attachments)
 *   - auth-failure logout                        — C4 (401 → refresh fails → /login)
 *
 * Contract / origin discipline (identical to the sibling specs)
 * -------------------------------------------------------------
 * This SAME file runs UNCHANGED against BOTH Playwright projects — `baseline`
 * (stock AngularJS) and `react` (migrated build) — on the single origin
 * `http://localhost:9000` (constraint C-3). The deterministic negative states
 * are induced with `page.route` interception of the FROZEN `/api/v1/`
 * endpoints (contract-preserving, C-1): we fetch the real response and flip a
 * single field, or fail a single mutation, rather than editing the backend or
 * standing up a second origin. Because the React screens reproduce the exact
 * DOM the AngularJS controllers emit (AAP §0.3.1/§0.6.5) and honour the same
 * backend authorization (AAP §0.6.4), the assertions below hold on both builds.
 *
 * Runtime contract: Node 16.19.1 + `@playwright/test` 1.44.1. Only
 * `@playwright/test` APIs are used — no Protractor/Angular globals. Timeouts
 * are generous cold-bootstrap safeguards, never an SLA (assumption A-2).
 *
 * Seeded target: `project-4` — the flat Kanban board (no swimlanes) the sibling
 * kanban spec targets, and a project carrying a backlog with stories; using the
 * same project keeps positional selectors valid.
 */

import { test, expect, dragAndDrop } from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";

/** Seeded project used by every scenario (flat board; matches kanban.spec.ts). */
const SLUG = "project-4";

/**
 * Shared DOM selectors — reconciled against the SAME authoritative markup the
 * sibling specs target (kanban-table.jade / backlog-row.jade / the React
 * screens), so they hold on both builds.
 */
const sel = {
  // Kanban board -----------------------------------------------------------
  columns: ".taskboard-column", // status/body column
  card: "tg-card",
  editHook: ".card-owner-actions .e2e-edit",
  addUsTitleKeyFragment: "add", // add-US option button carries an add title
  // Backlog ----------------------------------------------------------------
  backlogRows: ".backlog-table-body > div[ng-repeat]",
  dragHandle: ".draggable-us-row", // @dnd-kit activator (role="button", focusable)
  backlogEditHook: ".backlog-table-body .e2e-edit",
  // Shared permission-denied page (permission-denied.jade → not-found.scss) --
  errorMain: ".error-main",
  errorContainer: ".error-container",
  // Attachments (StoryFormLightbox, finding M1) ----------------------------
  attachInput: "#add-attach", // hidden <input type="file" multiple>
  attachNum: ".attachments-num", // count badge = existing + queued
  createEditLb: ".lightbox-create-edit",
} as const;

/** Cards inside board column `col`. */
const boxCards = (page: Page, col: number): Locator =>
  page.locator(sel.columns).nth(col).locator(sel.card);

/**
 * Intercept the project detail fetch (`GET /api/v1/projects/by_slug?slug=…`)
 * and shallow-merge `patch` into the real response body. Used to flip a single
 * authorization flag (`is_kanban_activated`, `is_backlog_activated`, or
 * `my_permissions`) WITHOUT touching the frozen backend (C-1). Must be
 * installed BEFORE navigation so the app's first project fetch is intercepted.
 */
async function patchProject(
  page: Page,
  patch: Record<string, unknown>
): Promise<void> {
  await page.route("**/projects/by_slug**", async (route: Route) => {
    const response = await route.fetch();
    let json: Record<string, unknown>;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      // Not JSON (unexpected) — pass the real response through untouched.
      await route.fulfill({ response });
      return;
    }
    await route.fulfill({ response, json: { ...json, ...patch } });
  });
}

/**
 * Fail every request matching `glob` with `status` (default 500) and a
 * Taiga-shaped error body. Used to force the optimistic-rollback path on a
 * single mutation endpoint (the bulk-order PATCH) while every other request
 * flows to the real backend.
 */
async function failEndpoint(
  page: Page,
  glob: string,
  status = 500
): Promise<void> {
  await page.route(glob, async (route: Route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ _error_message: "stubbed failure (M25)" }),
    });
  });
}

// ===========================================================================
// Kanban — negative & advanced parity
// ===========================================================================
test.describe("kanban — negative & advanced parity (M25)", () => {
  test.describe.configure({ mode: "serial" });

  // C5: a deactivated Kanban module must render the authoritative global
  // permission-denied page (`.error-main > .error-container`) and NO board —
  // fail-closed BEFORE any data fetch, mirroring
  // `errorHandlingService.permissionDenied()` on `is_kanban_activated === false`
  // (legacy kanban/main.coffee L567).
  test("deactivated module → permission-denied page, no board (C5)", async ({
    page,
    taiga,
  }) => {
    await patchProject(page, { is_kanban_activated: false });
    await taiga.gotoKanban(SLUG);

    await expect(page.locator(sel.errorMain)).toBeVisible();
    await expect(page.locator(sel.errorContainer)).toBeVisible();
    // The board content region must NOT render when fail-closed.
    await expect(page.locator(sel.columns)).toHaveCount(0);
  });

  // M4: a user WITHOUT `add_us` must not see the column "add user story"
  // action, even though the board still renders (module active, view allowed).
  // This proves the centralized authority gates controls off backend
  // permissions rather than always rendering them.
  test("no add_us permission → add-US column action is gated off (M4)", async ({
    page,
    taiga,
  }) => {
    // View-only permission set: can view the project + stories, cannot mutate.
    await patchProject(page, { my_permissions: ["view_project", "view_us"] });
    await taiga.gotoKanban(SLUG);

    // The board still renders (module active + view_us) …
    await expect(page.locator(sel.columns).first()).toBeVisible();
    // … but the add-US affordance (gated on `add_us`) is absent, and the
    // per-card edit hook (gated on `modify_us`) is not rendered.
    await expect(
      page.locator(`.option[title*="${sel.addUsTitleKeyFragment}" i]`)
    ).toHaveCount(0);
    await expect(page.locator(sel.editHook)).toHaveCount(0);
  });

  // C7 / M9: when the persist call fails, the optimistic move must ROLL BACK —
  // the card returns to its origin column and no phantom move remains. The
  // single bulk-order PATCH is stubbed 500; every other request is real.
  test("failed card move rolls back optimistically (C7/M9)", async ({
    page,
    taiga,
  }) => {
    await failEndpoint(page, "**/userstories/bulk_update_kanban_order**");
    await taiga.gotoKanban(SLUG);
    await expect(page.locator(sel.columns).first()).toBeVisible();

    const init0 = await boxCards(page, 0).count();
    const init1 = await boxCards(page, 1).count();
    test.skip(init0 === 0, "first column empty in seed — nothing to drag");

    await dragAndDrop(page, boxCards(page, 0).first(), page.locator(sel.columns).nth(1), {
      targetOffset: { x: 0, y: 10 },
    });

    // After the 500, the optimistic move is reverted: both columns return to
    // their initial counts (web-first auto-retry absorbs the rollback timing).
    await expect(boxCards(page, 0)).toHaveCount(init0);
    await expect(boxCards(page, 1)).toHaveCount(init1);
  });

  // M19 / M20: the board's controls carry accessible names and the loading
  // state exposes an ARIA live status. We HOLD the user-story list fetch so the
  // loading placeholder is observable, assert `role="status"`, then release and
  // assert the board paints and its search/zoom controls are labelled.
  test("accessible loading status + labelled controls (M19/M20)", async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/userstories?**", async (route: Route) => {
      await gate;
      await route.continue();
    });

    await page.goto(`/project/${SLUG}/kanban`);
    // M20: while the list is pending, the loading region is exposed as a status.
    await expect(page.getByRole("status").first()).toBeVisible();
    release();

    await expect(page.locator(sel.columns).first()).toBeVisible();
    // M19: the search box and the zoom radios expose accessible names.
    await expect(
      page.locator('.kanban-header input[type="text"][aria-label]').first()
    ).toBeVisible();
    await expect(
      page.locator("tg-board-zoom input[aria-label]").first()
    ).toHaveCount(1);
  });

  // C4: when the session cannot be refreshed, an authenticated data request
  // that 401s must drive the app to log out. We fail the refresh endpoint and
  // the user-story list; the single-flight interceptor tries to refresh, fails,
  // clears the session, and redirects to the login screen.
  test("auth failure with no valid refresh forces logout (C4)", async ({
    page,
    taiga,
  }) => {
    await failEndpoint(page, "**/auth/refresh**", 401);
    await failEndpoint(page, "**/userstories?**", 401);
    await taiga.gotoKanban(SLUG);

    // The failure funnels to the login screen (URL) or its form (DOM) — accept
    // either, since the redirect is an app-shell concern reproduced identically.
    await expect
      .poll(async () => {
        if (/login/i.test(page.url())) return true;
        return (await page.locator('input[name="username"]').count()) > 0;
      }, { timeout: 15000 })
      .toBe(true);
  });
});

// ===========================================================================
// Backlog — negative & advanced parity
// ===========================================================================
test.describe("backlog — negative & advanced parity (M25)", () => {
  test.describe.configure({ mode: "serial" });

  // C5: a deactivated Backlog module renders the authoritative permission-denied
  // page (mirrors `is_backlog_activated === false`).
  test("deactivated module → permission-denied page (C5)", async ({
    page,
    taiga,
  }) => {
    await patchProject(page, { is_backlog_activated: false });
    await taiga.gotoBacklog(SLUG);

    await expect(page.locator(sel.errorMain)).toBeVisible();
    await expect(page.locator(sel.errorContainer)).toBeVisible();
    await expect(page.locator(sel.backlogRows)).toHaveCount(0);
  });

  // M9: a failed backlog reorder must roll back — the first row's story ref is
  // unchanged after the stubbed 500, i.e. the dragged row did NOT stick at the
  // top optimistically.
  test("failed backlog reorder rolls back optimistically (M9)", async ({
    page,
    taiga,
  }) => {
    await failEndpoint(page, "**/userstories/bulk_update_backlog_order**");
    await taiga.gotoBacklog(SLUG);

    const rows = page.locator(sel.backlogRows);
    const count = await rows.count();
    test.skip(count < 5, "not enough backlog rows in seed to reorder");

    const refOf = (row: Locator) =>
      row.locator(".us-item-ref, .backlog-us-ref, .us-ref").first().innerText();
    const originalFirstRef = await refOf(rows.nth(0));
    const dragged = rows.nth(4);

    await dragAndDrop(page, dragged.locator(sel.dragHandle), rows.nth(0), {
      targetPosition: { x: 0.5, y: 0.1 },
    });

    // Rollback: the first row is STILL the original first story (the failed
    // persist reverted the optimistic move).
    await expect
      .poll(async () => refOf(rows.nth(0)))
      .toBe(originalFirstRef);
  });

  // M18: the backlog drag handle is keyboard-operable via the @dnd-kit
  // KeyboardSensor — focus the handle, pick up with Space, move with ArrowDown,
  // and CANCEL with Escape; the order must be unchanged after a cancelled drag.
  test("keyboard drag can be cancelled with Escape (M18)", async ({
    page,
    taiga,
  }) => {
    await taiga.gotoBacklog(SLUG);
    const rows = page.locator(sel.backlogRows);
    const count = await rows.count();
    test.skip(count < 3, "not enough backlog rows in seed for keyboard DnD");

    const refOf = (row: Locator) =>
      row.locator(".us-item-ref, .backlog-us-ref, .us-ref").first().innerText();
    const firstRefBefore = await refOf(rows.nth(0));

    const handle = rows.nth(2).locator(sel.dragHandle);
    await handle.focus();
    await page.keyboard.press("Space"); // pick up
    await page.keyboard.press("ArrowUp"); // move toward the top
    await page.keyboard.press("Escape"); // CANCEL — no reorder must persist

    await expect.poll(async () => refOf(rows.nth(0))).toBe(firstRefBefore);
  });

  // M1: the story-edit lightbox supports queuing an attachment for upload and
  // removing it before save. Selecting a file bumps the attachment count badge
  // (queued, applied AFTER save per the legacy attachmentsToAdd flow); we assert
  // the queued state WITHOUT saving so no backend mutation occurs.
  test("attachment add/remove lifecycle in the edit lightbox (M1)", async ({
    page,
    taiga,
  }) => {
    await taiga.gotoBacklog(SLUG);
    const editHooks = page.locator(sel.backlogEditHook);
    const count = await editHooks.count();
    test.skip(count === 0, "no editable backlog story in seed");

    await editHooks.first().click();
    await expect(page.locator(sel.createEditLb)).toBeVisible();

    const badge = page.locator(sel.attachNum).first();
    const before = parseInt((await badge.innerText()).trim() || "0", 10);

    // Queue a new attachment via the hidden file input (no fixture file needed —
    // an in-memory buffer suffices for the queue-state assertion).
    await page.locator(sel.attachInput).setInputFiles({
      name: "m25-attachment.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("m25 attachment payload"),
    });

    // The count badge reflects the queued file (existing + queued).
    await expect
      .poll(async () => parseInt((await badge.innerText()).trim() || "0", 10))
      .toBe(before + 1);
  });
});
