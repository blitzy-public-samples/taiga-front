/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Common navigation & stabilizer helpers for the isolated Playwright
 * end-to-end layer that exercises the migrated React Kanban and Backlog
 * screens.
 *
 * This module is the React-oriented, Playwright-native *behavioral* port of the
 * legacy Protractor utilities (`common.js`) and the login/bootstrap sequence of
 * the legacy Protractor configuration `onPrepare`. Those legacy sources are
 * consulted for behavior and DOM selectors ONLY — none of their code is
 * imported here (the two frameworks are kept strictly isolated). The sole
 * dependency of this file is a type-only reference to Playwright's `Page`, so
 * nothing couples this Playwright layer to the browserless unit-test layer or
 * to the React application sources.
 *
 * Every helper is intentionally best-effort/idempotent: a missing cookie
 * banner, an absent product tour, or a loader overlay that never toggles must
 * never abort an evidence capture (the before/after screenshots and videos).
 */

import type { Page } from '@playwright/test';

/* ------------------------------------------------------------------ *
 * Module constants
 * ------------------------------------------------------------------ */

/**
 * Project slug for the Kanban screen, seeded by `taiga-manage.sh sample_data`.
 * Confirmed from the legacy kanban suite, which navigated to
 * `project/project-0/kanban`.
 */
export const KANBAN_PROJECT_SLUG = 'project-0';

/**
 * Project slug for the Backlog / sprint-planning screen, seeded by
 * `taiga-manage.sh sample_data`. Confirmed from the legacy backlog suite, which
 * navigated to `project/project-3/backlog`.
 */
export const BACKLOG_PROJECT_SLUG = 'project-3';

/**
 * Maximum time (in milliseconds) to wait for the global `.loader` overlay to
 * settle. The legacy `common.waitLoader` used 5000ms, but the production-style
 * nginx-served build is slower to settle than the old build-tool dev server, so
 * a more generous budget is used here. This is best-effort: exceeding it does
 * not fail the caller.
 */
const LOADER_TIMEOUT = 15000;

/* ------------------------------------------------------------------ *
 * Stabilizer helpers (behavioral port of the legacy `common` utilities)
 * ------------------------------------------------------------------ */

/**
 * Dismiss the cookie-consent banner by setting the `cookieConsent` cookie,
 * mirroring `common.closeCookies` (common.js:153-157). The cookie write runs in
 * the page context and is wrapped in try/catch so a restricted document (or a
 * missing banner) can never throw.
 */
export async function closeCookies(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      document.cookie = 'cookieConsent=1';
    } catch (e) {
      /* ignore — cookie writes can be blocked in some contexts */
    }
  });
}

/**
 * Close the intro.js product tour ("joyride") when it is currently shown,
 * mirroring `common.closeJoyride` (common.js:494-503). The `.introjs-skipbutton`
 * is injected at runtime by the intro.js library (it is not present in the
 * source markup), so this is strictly best-effort and is a no-op when the tour
 * is absent.
 */
export async function closeJoyride(page: Page): Promise<void> {
  const skip = page.locator('.introjs-skipbutton');

  if ((await skip.count()) > 0 && (await skip.first().isVisible().catch(() => false))) {
    await skip.first().click().catch(() => {
      /* ignore — the tour may disappear between the visibility check and click */
    });
    await page.waitForTimeout(600);
  }
}

/**
 * Wait until the global `.loader` overlay is no longer active, mirroring
 * `common.waitLoader` (common.js:118-126). The overlay is rendered by
 * `loader.jade` as `.loader(tg-loader)`; the `tg-loader` directive toggles the
 * `active` class while data is loading. Best-effort: a loader that never toggles
 * (or is absent) resolves via the swallowed timeout so an evidence capture is
 * never aborted.
 */
export async function waitLoader(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.loader');
        return !el || !el.classList.contains('active');
      },
      undefined,
      { timeout: LOADER_TIMEOUT },
    )
    .catch(() => {
      /* proceed best-effort — never block a capture on a stuck loader */
    });
}

/**
 * Prime the AngularJS shell's end-to-end flag before the application boots.
 *
 * Ports the `window.localStorage.e2e = true` step of the legacy Protractor
 * bootstrap `onPrepare`. Two deliberate differences from the legacy code:
 *
 *   1. Uses `page.addInitScript` so the flag is set *before* the application
 *      boots on EVERY navigation of the context (not merely once).
 *   2. It ONLY sets the flag — it never clears storage. The legacy one-time
 *      `sessionStorage.clear()` / `localStorage.clear()` is unnecessary because
 *      Playwright contexts already start with clean storage, and clearing on
 *      every navigation would wipe the JWT the AngularJS shell persists in
 *      localStorage after login, breaking the authenticated session.
 *
 * This MUST be called before the first `page.goto` of the login flow.
 */
export async function primeE2eFlag(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('e2e', 'true');
    } catch (e) {
      /* ignore — storage may be unavailable in some contexts */
    }
  });
}

/**
 * Convenience combinator run immediately after a navigation to bring a screen
 * to a stable, capture-ready state. Each underlying step is cheap and a no-op
 * when the corresponding element is absent.
 */
export async function stabilize(page: Page): Promise<void> {
  await closeCookies(page);
  await closeJoyride(page);
  await waitLoader(page);
}

/* ------------------------------------------------------------------ *
 * Navigation helpers (routes verified in app/coffee/app.coffee)
 * ------------------------------------------------------------------ */

/**
 * Navigate to a project screen and stabilize it. Routes are HTML5-mode (no
 * hash): `/project/:pslug/kanban` (app.coffee:235-237) and
 * `/project/:pslug/backlog` (app.coffee:226-228). A RELATIVE URL is used so it
 * inherits the Playwright config `baseURL` (http://localhost:9000/) — the host
 * is never hardcoded here, and the legacy build-tool dev-server port is never
 * used.
 */
async function openProjectScreen(
  page: Page,
  slug: string,
  screen: 'kanban' | 'backlog',
): Promise<void> {
  await page.goto(`project/${slug}/${screen}`);
  await stabilize(page);
}

/**
 * Open the Kanban board for the given project slug (defaults to the seeded
 * Kanban project). Mirrors the legacy `before()` hooks that navigated to the
 * board and then waited for the loader.
 */
export async function openKanban(page: Page, slug: string = KANBAN_PROJECT_SLUG): Promise<void> {
  await openProjectScreen(page, slug, 'kanban');
}

/**
 * Open the Backlog / sprint-planning view for the given project slug (defaults
 * to the seeded Backlog project). Mirrors the legacy `before()` hooks that
 * navigated to the backlog and then waited for the loader.
 */
export async function openBacklog(page: Page, slug: string = BACKLOG_PROJECT_SLUG): Promise<void> {
  await openProjectScreen(page, slug, 'backlog');
}

/* ------------------------------------------------------------------ *
 * Drag-and-drop helper (Playwright-native; replaces the legacy synthetic drag)
 * ------------------------------------------------------------------ */

/**
 * Perform a real-pointer drag from `source` to `target`.
 *
 * This replaces the dragula-era synthetic `common.drag` (common.js:207-277),
 * which dispatched fabricated `mousedown` / `mousemove` / `mouseup` CustomEvents
 * and waited for the dragula mirror (`.gu-mirror`) to clear. The React screens
 * use @dnd-kit with a `PointerSensor`, which reacts to REAL pointer events and
 * enforces an activation distance, so a genuine pointer gesture is required
 * (AAP 0.6.5).
 *
 * The gesture: press over the source center, move a few pixels to cross the
 * @dnd-kit activation threshold, glide to the target center, settle over the
 * droppable, and release.
 *
 * @throws if either the source or the target has no bounding box (not laid out
 * / not visible), because a drag cannot be simulated without pointer
 * coordinates.
 */
export async function dragTo(page: Page, source: string, target: string): Promise<void> {
  const src = page.locator(source).first();
  const dst = page.locator(target).first();

  await src.scrollIntoViewIfNeeded();

  const s = await src.boundingBox();
  if (!s) {
    throw new Error(`dragTo: no bounding box for source "${source}"`);
  }

  const d = await dst.boundingBox();
  if (!d) {
    throw new Error(`dragTo: no bounding box for target "${target}"`);
  }

  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  const tx = d.x + d.width / 2;
  const ty = d.y + d.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 8, { steps: 5 }); // exceed the @dnd-kit activation distance
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.mouse.move(tx, ty, { steps: 3 }); // settle over the droppable
  await page.mouse.up();
}

/**
 * Perform a NET-ZERO drag for evidence capture (F-AAP-06).
 *
 * The seed-once database MUST NOT be mutated by a committed capture run: the
 * baseline (AngularJS) and post-migration (React) passes have to observe
 * byte-for-byte identical data so the before/after artifacts are comparable
 * (AAP 0.6.3). A normal `dragTo` that drops onto a DIFFERENT column/row/sprint
 * would emit a `bulk_update_*` request and permanently reorder the seeded data,
 * so it must never be used for a committed capture.
 *
 * This helper presses over the source, moves far enough to cross the @dnd-kit
 * `PointerSensor` activation distance so the drag actually STARTS (the drag
 * mirror/overlay appears — the visual evidence of the interaction), glides the
 * mirror over the target so the optional `onMirror` callback can screenshot the
 * drag-in-progress, then RETURNS the pointer to the ORIGIN and releases there.
 * Dropping at the same position short-circuits on BOTH engines — dragula treats
 * a same-index drop as a no-op and @dnd-kit reports `over === active` with no
 * reorder — so NO `bulk_update_*` request is emitted and the DB is untouched.
 * This is exactly the net-zero gesture proven byte-identical in the committed
 * baseline fingerprint methodology (artifacts/baseline recheck).
 *
 * @param onMirror optional async callback invoked while the drag is held over
 *   the target (typically a `screenshot(...)` capturing the drag mirror).
 * @throws if the source or target has no bounding box (not laid out / visible).
 */
export async function dragNetZero(
  page: Page,
  source: string,
  target: string,
  onMirror?: () => Promise<unknown>,
): Promise<void> {
  const src = page.locator(source).first();
  const dst = page.locator(target).first();

  await src.scrollIntoViewIfNeeded();

  const s = await src.boundingBox();
  if (!s) {
    throw new Error(`dragNetZero: no bounding box for source "${source}"`);
  }

  const d = await dst.boundingBox();
  if (!d) {
    throw new Error(`dragNetZero: no bounding box for target "${target}"`);
  }

  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  const tx = d.x + d.width / 2;
  const ty = d.y + d.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 8, { steps: 5 }); // exceed the @dnd-kit activation distance
  await page.mouse.move(tx, ty, { steps: 12 }); // glide the mirror over the target
  await page.mouse.move(tx, ty, { steps: 3 }); // settle so the mirror is visible for capture

  if (onMirror) {
    await onMirror(); // capture the drag-in-progress mirror over the target
  }

  // Return to the ORIGIN and release there: a same-position drop is a no-op on
  // both dragula and @dnd-kit, so no reorder request is emitted (net-zero).
  await page.mouse.move(sx, sy, { steps: 12 });
  await page.mouse.up();
}

/* ------------------------------------------------------------------ *
 * Capture-phase helpers (F-CQ-08 — phase-aware selectors)
 *
 * The React screens reproduce most existing SCSS class names for visual
 * fidelity (AAP 0.3.4), but a handful of AngularJS *directive* selectors are
 * not emitted by React (e.g. the board column wraps in
 * `.kanban-uses-box.taskboard-column` rather than `.task-column`, the sprint
 * lightbox is a `[role="dialog"]` rather than `div[tg-lb-create-edit-sprint]`,
 * and deletes use a native `window.confirm` rather than `.lightbox-generic-ask`).
 * `phaseSelector` lets a spec pick the DOM-accurate selector for the active
 * capture phase, so the baseline pass targets the AngularJS DOM and the React
 * pass targets the React DOM — instead of a single Angular-only selector that
 * silently matches nothing on the migrated screen.
 * ------------------------------------------------------------------ */

/**
 * Resolve the active capture phase from `process.env.CAPTURE_PHASE`. Anything
 * other than the exact string `'react'` resolves to `'baseline'`, so an unset
 * or malformed value defaults to the (safe, non-destructive) baseline pass.
 * The `'baseline' | 'react'` union is inlined here to avoid re-exporting a
 * `CapturePhase` type name that `capture.ts` already exports through the barrel.
 */
export function capturePhase(): 'baseline' | 'react' {
  return process.env.CAPTURE_PHASE === 'react' ? 'react' : 'baseline';
}

/** True when the post-migration React screen is under capture. */
export function isReactPhase(): boolean {
  return capturePhase() === 'react';
}

/**
 * Pick the selector appropriate to the active capture phase. Use ONLY for the
 * genuinely-divergent selectors documented above; selectors that React
 * reproduces verbatim (e.g. `tg-card`, `.milestone-us-item-row`, `.us-status`)
 * need no phase split and should be used directly.
 */
export function phaseSelector(baseline: string, react: string): string {
  return isReactPhase() ? react : baseline;
}

/* ------------------------------------------------------------------ *
 * Selector reference (do NOT invent new selectors)
 *
 * The React Kanban/Backlog screens reproduce the existing DOM structure and
 * reuse the existing SCSS class names for visual fidelity (AAP 0.3.4). Spec
 * authors and future maintainers should reuse the verified selectors below,
 * ported from the legacy Protractor helpers, rather than introducing new ones.
 *
 * Kanban (from kanban-helper.js):
 *   .task-column          — a board status column
 *   .task-colum-name      — the column header (legacy [sic] spelling preserved)
 *   .e2e-title            — a card title
 *   tg-card               — a Kanban card
 *   .card-owner-actions   — the per-card hover action zone
 *   .e2e-edit             — the edit affordance on a card / row
 *   .icon-bulk            — open the bulk-create lightbox for a column
 *   .options a            — the fold / unfold column options
 *   .kanban-table-body    — the scrollable board body
 *   tg-board-zoom         — the board zoom control
 *
 * Backlog (from backlog-helper.js):
 *   div[tg-backlog-sprint="sprint"]     — a sprint / milestone block
 *   .sprint-open                        — an expanded sprint block
 *   .backlog-table-body                 — the backlog user-story list body
 *   .new-us a                           — new user-story / bulk-create triggers
 *   .add-sprint                         — open the create-sprint lightbox
 *   .edit-sprint                        — open the edit-sprint lightbox
 *   .filter-closed-sprints              — toggle closed sprints
 *   .compact-sprint                     — collapse / expand a sprint table
 *   .sprint-table                       — a sprint's user-story table
 *   .us-status                          — a user-story status control
 *   .us-points                          — a user-story points control
 *   .e2e-delete                         — delete affordance on a row
 *   span[tg-bo-ref]                     — a user-story reference (e.g. #123)
 *   .milestone-us-item-row              — a user-story row inside a sprint
 *   div[tg-lb-create-edit-sprint]       — create / edit sprint lightbox
 *   div[tg-lb-create-edit-userstory]    — create / edit user-story lightbox
 *   div[tg-lb-create-bulk-userstories]  — bulk-create user-stories lightbox
 *
 * Drag handle: .icon-drag is the grab handle used on rows / cards.
 *
 * PHASE-DIVERGENT selectors (use `phaseSelector(baseline, react)`), verified
 * against the migrated React source (app/react/**):
 *   board column      baseline `.task-column`
 *                     react    `.taskboard-column`  (`.kanban-uses-box.taskboard-column`,
 *                              `id="column-<statusId>"`, TaskboardColumn.tsx)
 *   sprint lightbox   baseline `div[tg-lb-create-edit-sprint]`
 *                     react    `[role="dialog"]`     (CreateEditSprintLightbox.tsx)
 *   bulk-US lightbox  baseline `div[tg-lb-create-bulk-userstories]`
 *                     react    `.lightbox-generic-bulk` (BulkCreateUsLightbox.tsx)
 *   delete confirm    baseline `.lightbox-generic-ask .button-green`
 *                     react    native `window.confirm` (dialog handler; useBacklog.ts,
 *                              KanbanApp.tsx — dismiss to stay non-mutating)
 *   swimlane row      react    `.kanban-swimlane` / `button.kanban-swimlane-title` (Swimlane.tsx)
 *
 * REACT-DEFERRED interactions (present in the AngularJS baseline, intentionally
 * NOT reimplemented in React per F-CQ-02 / the AAP 0.4.1 manifest — a shared
 * common-module lightbox or an out-of-scope control): the create/edit user-story
 * detail lightbox (`div[tg-lb-create-edit-userstory]`), the kanban bulk-create
 * lightbox trigger, the assign-to lightbox (`div[tg-lb-assignedto]`,
 * `.e2e-assign`, `.card-owner-actions`), and the board zoom control
 * (`tg-board-zoom`). Specs gate these to the baseline phase and document the
 * React deferral rather than targeting a selector React never emits.
 * ------------------------------------------------------------------ */
