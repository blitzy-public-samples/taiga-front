/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Playwright port of the legacy Protractor Backlog / Sprint-Planning suite
 * (`e2e/suites/backlog.e2e.js`, ~32 cases) for the AngularJS -> React 18.2
 * migration POC (AAP §0.2.1, §0.4.1, §0.6.2).
 *
 * PURPOSE (prospective — not a claim of completed work): this spec is the
 * behavioral + visual parity HARNESS for the Backlog screen. When executed
 * against a running stack under each Playwright project, it exercises the
 * Backlog flows and captures screenshots + per-test video into the project's
 * git-tracked artifacts directory, so a reviewer can compare the stock
 * AngularJS "before" against the migrated React "after". The spec by itself is
 * NOT the evidence and does NOT by itself establish parity: parity is
 * demonstrated only once the spec has actually been run against each build and
 * the resulting, human-reviewed artifacts are committed (AAP §0.6.2's
 * baseline-before-removal ordering governs when each capture is taken).
 *
 * DOM-preserving parity (migration contract)
 * ------------------------------------------
 * The migration's contract is that the React Backlog reproduces the same DOM
 * (class names, `data-*` attributes, tag names, and the legacy `[ng-repeat]` /
 * `tg-backlog-sprint="sprint"` hooks) that the AngularJS `BacklogController`
 * emits. Because that markup is intended to be identical, this ONE spec is
 * written to run UNCHANGED against BOTH Playwright projects defined in the root
 * `playwright.config.ts`:
 *   - `baseline` — the stock AngularJS build, and
 *   - `react`    — the migrated React build.
 * Both target the same single origin (`http://localhost:9000`, constraint C-3);
 * "baseline" vs "react" is purely temporal (which build is deployed when the
 * project runs). The spec never branches on the active project — every selector
 * and assertion is written to hold for both builds.
 *
 * Runtime contract: Node 16.19.1 + `@playwright/test` 1.44.1. ONLY
 * `@playwright/test` APIs and the `./fixtures` barrel are used — deliberately NO
 * Protractor/Angular globals (`browser`, `protractor`, `$`, `$$`, `element`,
 * `by`, `waitForAngular`).
 *
 * Determinism / state model: the tests mutate a SHARED, PERSISTENT backend (the
 * seeded Django DB), so story/sprint COUNT checks are asserted as DELTAS
 * relative to a baseline read at the start of each test — never against a
 * hardcoded seed size. The only exact counts asserted are STRUCTURAL results of
 * a test's own actions (e.g. the size of a deliberate 4-row range selection),
 * not seed-dependent totals. Cross-project determinism (the `baseline` run and
 * the `react` run observing equivalent data) additionally requires the backend
 * to be re-seeded / restored between project runs; that is a harness-level
 * concern owned by the run orchestration (globalSetup / CI), not by this spec.
 * The few `page.waitForTimeout(...)` calls reproduce intentional behavioral
 * debounce/settle points from the source (§5.4.5 timing constants), NOT
 * performance SLAs (assumption A-2).
 */

import {
  test,
  expect,
  lightbox,
  openPopover,
  dragAndDrop,
  fillTags,
  runSharedFilters,
} from "./fixtures";
import type { Page, Locator } from "@playwright/test";

/* ------------------------------------------------------------------------- *
 * Selectors — ported from `e2e/helpers/backlog-helper.js` and RECONCILED to the
 * DOM the served build actually renders.
 *
 * The legacy Protractor helpers addressed several affordances through dev-only
 * `.e2e-*` instrumentation hooks (`.e2e-edit`, `.e2e-delete`,
 * `.e2e-move-to-sprint`, `.e2e-velocity-forecasting`, `.e2e-sprint-name`, …).
 * Those hooks are compiled OUT of the prebuilt taiga-front dist that this
 * harness runs against (identical root cause to the Kanban card selectors), so
 * they match ZERO elements at runtime. Each such selector is reconciled here to
 * the stable STRUCTURAL class/attribute that the shipped markup exposes and that
 * the migrated React screen is contracted to reproduce (verified live against
 * the served build and cross-checked against the stock `.jade` source):
 *   .new-us a                      -> .new-us button          (addnewus.jade)
 *   div[tg-lb-create-edit-userstory] -> .lightbox-create-edit (backlog.jade)
 *   .icon-drag                     -> .draggable-us-row        (backlog-row.jade)
 *   .add-sprint                    -> .sprint-header .btn-link (sprints.jade)
 *   .e2e-move-to-sprint            -> .move-to-sprint          (backlog.jade)
 *   .e2e-velocity-forecasting      -> .velocity-forecasting-btn(backlog.jade)
 *   .e2e-velocity-forecasting-add  -> .forecasting-add-sprint  (backlog.jade)
 *   .e2e-sprint-name               -> .sprint-name             (lightbox-sprint-add-edit.jade)
 *   .e2e-edit / .e2e-delete (row)  -> the `.us-option-popup` kebab menu
 *                                     (`.us-option-popup-button` trigger +
 *                                      `.edit-story` / `li:nth-child(2) button`)
 * Selectors already expressed structurally (rows, sprints, status/points cells,
 * lightbox attribute hooks that survive the dist build) are unchanged.
 * ------------------------------------------------------------------------- */
const SEL = {
  // Backlog user-story rows and selection.
  userStories: '.backlog-table-body > div[ng-repeat]',
  // `selectedUserStories` asserts on the CHECKED STATE of the native input,
  // which is the correct source of truth for "how many rows are selected".
  selectedUserStories: '.backlog-table-body input[type="checkbox"]:checked',
  // `checkbox` is the CLICK TARGET for selecting a row. Taiga hides the native
  // `<input type="checkbox">` (rendered `display:none`, 0x0) and paints a
  // visible 18x18 `.custom-checkbox` <div> over it; clicking that div toggles
  // the underlying input (verified: click flips `:checked` 0->1 and adds the
  // `is-checked` row class). Targeting the raw hidden input instead times out
  // because Playwright refuses to click a `display:none` element — hence the
  // click target is the custom-checkbox, while `selectedUserStories` above
  // still reads the real input's `:checked` state.
  checkbox: '.custom-checkbox',

  // Sprints (milestones) in the sidebar.
  sprints: 'div[tg-backlog-sprint="sprint"]',
  sprintsOpen: 'div[tg-backlog-sprint="sprint"].sprint-open',
  sprintStories: '.milestone-us-item-row',
  sprintTitles: 'div[tg-backlog-sprint="sprint"] .sprint-name span',
  sprintTable: '.sprint-table',
  compactSprint: '.compact-sprint',

  // Toolbar / row affordances.
  newUs: '.new-us a',
  addSprint: '.sprint-header .btn-link',
  milestoneEdit: 'div[tg-backlog-sprint="sprint"] .edit-sprint',
  usStatus: '.backlog-table-body > div .us-status',
  usPoints: '.backlog-table-body > div .us-points',
  usRef: 'span[tg-bo-ref]',
  iconDrag: '.draggable-us-row',
  moveToSprint: '.move-to-sprint',
  rolePointsSelector: '.backlog-table-header .points .inner',

  // Per-row options ("kebab") menu — replaces the stripped `.e2e-edit` /
  // `.e2e-delete`. Clicking `rowOptionsButton` inside a row opens
  // `ul.popover.us-option-popup` whose `<li>` buttons are Edit / Delete /
  // Move-to-top. Edit is uniquely `.edit-story`; Delete is the 2nd `<li>`.
  rowOptionsButton: '.us-option-popup-button',
  rowOptionsPopup: '.us-option-popup',
  rowOptionsEdit: '.edit-story',
  rowOptionsDelete: 'li:nth-child(2) button',

  // Tags toggle.
  // The tag-display toggle is a CUSTOM CHECKBOX: `#show-tags` wraps
  // `input#show-tags-input[ng-model="ctrl.showTags"][ng-change="toggleTags()"]`,
  // painted as a visible `.check` div. Clicking the OUTER `#show-tags` div is a
  // NO-OP (the handler lives on the checkbox); the visible `.check` wrapper is
  // the real click target (verified: clicking it flips the rendered tag rows
  // 67<->0). The legacy Protractor helper clicked `#show-tags` and only
  // "worked" because tags are SHOWN BY DEFAULT on this build, so its no-op click
  // left them visible — the hide path never actually toggled.
  showTags: '#show-tags .check',
  tag: '.backlog-table .tag',

  // Closed sprints.
  toggleClosedSprints: '.filter-closed-sprints',
  closedSprints: '.sprint-closed',
  closedSprintDrop: '.sprint-empty',

  // Velocity forecasting. `sprintNameForecast` targets the sprint-name INPUT
  // (the "add sprint" forecasting control opens the sprint lightbox, whose name
  // field is `input.sprint-name`); the bare `.sprint-name` also matches the
  // sidebar's `div.sprint-name` title wrappers, so the `input.` qualifier is
  // required to avoid selecting a non-input element.
  velocityForecasting: '.velocity-forecasting-btn',
  velocityForecastingAdd: '.forecasting-add-sprint',
  sprintNameForecast: 'input.sprint-name',

  // Lightboxes (modals).
  createEditUsLightbox: '.lightbox-create-edit',
  bulkCreateLightbox: 'div[tg-lb-create-bulk-userstories]',
  createEditSprintLightbox: 'div[tg-lb-create-edit-sprint]',
} as const;

/* ------------------------------------------------------------------------- *
 * Locator + action helpers — faithful ports of the `backlog-helper.js`
 * functions, expressed with `@playwright/test` `Locator`s. Each is a pure
 * function of `page` (or a scoped `Locator`) so there is no hidden per-test
 * state, mirroring the stateless CommonJS helper module.
 * ------------------------------------------------------------------------- */

/** Port of `backlogHelper.userStories()` — every backlog user-story row. */
function userStories(page: Page): Locator {
  return page.locator(SEL.userStories);
}

/** Port of `backlogHelper.sprints()` — every sprint (milestone) in the sidebar. */
function sprints(page: Page): Locator {
  return page.locator(SEL.sprints);
}

/** Port of `backlogHelper.sprintsOpen()` — only the open (unfolded) sprints. */
function sprintsOpen(page: Page): Locator {
  return page.locator(SEL.sprintsOpen);
}

/** The drag handle inside a backlog/sprint row (source used the first `.icon-drag`). */
function dragHandle(row: Locator): Locator {
  return row.locator(SEL.iconDrag).first();
}

/** The selection checkbox inside a backlog row (source used the first checkbox). */
function rowCheckbox(row: Locator): Locator {
  return row.locator(SEL.checkbox).first();
}

/**
 * Open the per-row options ("kebab") menu for the nth backlog row and return the
 * active popup locator.
 *
 * The legacy helpers clicked the row's `.e2e-edit` / `.e2e-delete` buttons
 * DIRECTLY (`$$('.backlog-table-body .e2e-edit').get(item).click()`) because
 * Protractor tolerated clicking not-yet-visible elements. Those hooks are
 * stripped from the served dist, and Playwright requires the target to be
 * visible. The shipped DOM gates Edit/Delete behind the `.us-option-popup-button`
 * kebab trigger, which opens `ul.popover.us-option-popup`. So we reproduce the
 * intent faithfully: open the popup for the target row, then let the caller click
 * the specific action. This is the same trigger→popup→item pattern the Kanban
 * card actions use. `openPopover` (which clicks `<a>` anchors in `.popover.active`)
 * is deliberately NOT used here — this menu's items are `<button>`s inside `<li>`.
 */
async function openRowOptions(page: Page, item: number): Promise<Locator> {
  const row = userStories(page).nth(item);
  await row.locator(SEL.rowOptionsButton).first().click();
  const pop = row.locator(SEL.rowOptionsPopup);
  // Wait for the menu to render its (visible) action buttons before returning.
  await pop.locator("li button").first().waitFor({ state: "visible", timeout: 5000 });
  return pop;
}

/**
 * Select a status in the create/edit-US lightbox.
 *
 * The served lightbox renders status as a CUSTOM dropdown — a `.status-dropdown`
 * trigger that opens `ul.pop-status.popover` (which gains `.active`, so it is a
 * standard active popover) containing `a.status` anchors — NOT the native
 * `<select>` the legacy Protractor helper clicked
 * (`select option:nth-child(N)`; native `<option>`s cannot be `.click()`ed in
 * Playwright, and the served dist has no `<select>` here at all). We therefore
 * drive it through the shared `openPopover` helper (trigger click -> wait for
 * the single `.popover.active` -> click the nth `<a>`). `optionNth` preserves
 * the source's 1-based `nth-child` semantics (1 -> "New", 2 -> "Ready",
 * 4 -> "Ready for test", 6 -> "Archived"/closed), converted to the 0-based
 * anchor index `openPopover` expects.
 */
async function setLightboxStatus(page: Page, el: Locator, optionNth: number): Promise<void> {
  await openPopover(page, el.locator(".status-dropdown").first(), optionNth - 1);
}

/** The inline status trigger for the nth backlog row. */
function usStatusTrigger(page: Page, item: number): Locator {
  return page.locator(SEL.usStatus).nth(item);
}

/**
 * The inline points trigger for the nth backlog row.
 *
 * Port of `getUsPoints`/`setUsPoints` — both address the FIRST `span` inside the
 * nth `.us-points` cell.
 */
function usPointsSpan(page: Page, item: number): Locator {
  return page.locator(SEL.usPoints).nth(item).locator("span").first();
}

/**
 * Port of `backlogHelper.getUsRef(row)` — the story reference text inside a row.
 * `.getText()` returned visible, trimmed text, so `innerText().trim()` matches.
 */
async function usRef(row: Locator): Promise<string> {
  return (await row.locator(SEL.usRef).first().innerText()).trim();
}

/**
 * The ordered story references inside a story list (a sprint's story table or
 * the backlog). Uses `allTextContents` (textContent, not innerText) so the read
 * is correct regardless of a sprint's fold/visibility state — the `.us-ref`
 * token is present in the DOM either way.
 *
 * Shared by the drag-to-milestone/within-milestone assertions, which assert by
 * story PRESENCE rather than by a count delta. A count-delta baseline is
 * fragile for sprint story lists because a sprint's `.milestone-us-item-row`
 * rows are painted by an async XHR that settles a few hundred ms after the
 * loader clears; a baseline `count()` sampled during that gap reads 0 and then
 * never matches once the true count paints. Polling for a specific dragged ref
 * to APPEAR auto-waits for that render and is additionally immune to cross-run
 * sprint accumulation on the shared, persistent seeded backend.
 */
async function storyRefs(list: Locator): Promise<string[]> {
  return (await list.locator(SEL.usRef).allTextContents()).map((t) => t.trim());
}

/**
 * Port of `backlogHelper.setUsStatus(item, value)` — open the nth row's status
 * popover, select the `value`-th option, and return the resulting status label
 * (the first `span`'s text), matching the source's return value exactly.
 */
async function setUsStatus(page: Page, item: number, value: number): Promise<string> {
  const status = usStatusTrigger(page, item);
  await openPopover(page, status, value);
  return (await status.locator("span").first().innerText()).trim();
}

/**
 * Port of `backlogHelper.getSprintsTitles()` — the visible titles of all
 * sprints. `$$(...).getText()` returned an array of trimmed strings, so we map
 * `allInnerTexts()` through `trim()`.
 */
async function sprintTitles(page: Page): Promise<string[]> {
  return (await page.locator(SEL.sprintTitles).allInnerTexts()).map((t) => t.trim());
}

/**
 * Resolve the sprint (milestone) name input inside the create/edit-sprint
 * lightbox.
 *
 * The Protractor original used `by.model('sprint.name')`, an AngularJS-only
 * binding that has no Playwright equivalent. We PREFER the stable
 * `input[name="name"]` (which the React DOM exposes) and FALL BACK to the first
 * text input when the AngularJS DOM lacks a `name` attribute — exactly the
 * resilience the agent prompt requires.
 */
async function sprintNameInput(page: Page): Promise<Locator> {
  const named = page.locator(`${SEL.createEditSprintLightbox} input[name="name"]`);
  if (await named.count()) {
    return named.first();
  }
  return page.locator(`${SEL.createEditSprintLightbox} input[type="text"]`).first();
}

/**
 * Port of `backlogHelper.toggleSprint(el)` — click a sprint's compact/fold
 * control and let the `.sprint-table` fold/unfold CSS transition settle
 * (`common.waitTransitionTime`). The settle time is behavioral timing, not an
 * SLA.
 */
async function toggleSprint(page: Page, sprint: Locator): Promise<void> {
  await sprint.locator(SEL.compactSprint).first().click();
  await page.waitForTimeout(400);
}

/**
 * Guarantee a project has a KNOWN velocity so the forecasting control appears
 * and the backlog collapses when it is toggled on.
 *
 * The backend derives `stats.speed` from CLOSED sprints (closed points averaged
 * over the closed milestones); the stock `sample_data` leaves whether any past
 * sprint is closed NON-deterministic between seeds. The committed BASELINE
 * evidence for this screen was captured with velocity present (its summary bar
 * reads "… points / sprint" and the backlog is shown collapsed), so this
 * precondition restores parity deterministically: if the project has no velocity
 * yet, it closes one of its points-bearing open sprints through the SAME frozen
 * `/api/v1/` contract the app itself uses (bearer token read live from the
 * logged-in client's `localStorage`). It is idempotent — a project that already
 * has velocity is left untouched — and it never runs for the "no velocity" case
 * (project-5), preserving that test's premise.
 */
async function ensureVelocity(page: Page, slug: string): Promise<void> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem("token");
    return raw ? (JSON.parse(raw) as string) : null;
  });
  if (!token) {
    throw new Error(
      "ensureVelocity: no bearer token in localStorage after login — the fixture " +
        "must sign in before establishing the velocity precondition.",
    );
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const projResp = await page.request.get(`/api/v1/projects/by_slug?slug=${slug}`, { headers });
  const projectId = (await projResp.json()).id as number;

  const statsResp = await page.request.get(`/api/v1/projects/${projectId}/stats`, { headers });
  const speed = Number((await statsResp.json()).speed ?? 0);
  if (speed > 0) {
    return; // Already has velocity — nothing to do (idempotent).
  }

  const msResp = await page.request.get(`/api/v1/milestones?project=${projectId}`, { headers });
  const milestones = (await msResp.json()) as Array<{
    id: number;
    closed: boolean;
    total_points: number | null;
  }>;
  // Prefer a points-bearing open sprint (so `speed` becomes strictly > 0); fall
  // back to any open sprint.
  const target =
    milestones.find((m) => !m.closed && (m.total_points ?? 0) > 0) ??
    milestones.find((m) => !m.closed);
  if (target) {
    await page.request.patch(`/api/v1/milestones/${target.id}`, {
      headers,
      data: { closed: true },
    });
  }
}

/**
 * Guarantee a project has at least ONE closed sprint so the closed-sprints
 * toggle renders and the reveal/hide/reopen flow can be exercised.
 *
 * The stock `sample_data` derives whether any milestone is closed from dates
 * relative to the seed day, so a fresh reseed can leave a project with ZERO
 * closed sprints (the served backlog gates the `.filter-closed-sprints` toggle
 * on `totalClosedMilestones`, exactly as the legacy `ng-if="totalClosedMilestones"`
 * did). The committed BASELINE evidence for this screen was captured WITH a
 * closed sprint present, so this precondition restores that parity
 * deterministically through the SAME frozen `/api/v1/` contract the app itself
 * uses (bearer token read live from the logged-in client's `localStorage`).
 *
 * It closes exactly ONE open sprint via a direct milestone PATCH. A direct PATCH
 * sets `closed` WITHOUT triggering the story-move recompute, so the flag sticks
 * until a story is dragged into the sprint — which is precisely what the
 * "open sprint by drag open US to closed sprint" test relies on to REOPEN it
 * (dragging an open story in makes the milestone hold a mix of open+closed
 * stories, so the backend recomputes `closed` to false). The helper is
 * idempotent: a project that already has a closed sprint is left untouched, so
 * exactly one closed sprint exists for the serial closed-sprints block.
 */
async function ensureClosedSprint(page: Page, slug: string): Promise<void> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem("token");
    return raw ? (JSON.parse(raw) as string) : null;
  });
  if (!token) {
    throw new Error(
      "ensureClosedSprint: no bearer token in localStorage after login — the fixture " +
        "must sign in before establishing the closed-sprint precondition.",
    );
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const projResp = await page.request.get(`/api/v1/projects/by_slug?slug=${slug}`, { headers });
  const projectId = (await projResp.json()).id as number;

  const msResp = await page.request.get(`/api/v1/milestones?project=${projectId}`, { headers });
  const milestones = (await msResp.json()) as Array<{
    id: number;
    closed: boolean;
    total_points: number | null;
  }>;
  if (milestones.some((m) => m.closed)) {
    return; // Already has a closed sprint — nothing to do (idempotent).
  }
  // Prefer a points-bearing open sprint (a realistic closed sprint); fall back to
  // any open sprint.
  const target =
    milestones.find((m) => !m.closed && (m.total_points ?? 0) > 0) ??
    milestones.find((m) => !m.closed);
  if (target) {
    await page.request.patch(`/api/v1/milestones/${target.id}`, {
      headers,
      data: { closed: true },
    });
  }
}

/* ------------------------------------------------------------------------- *
 * Suite
 * ------------------------------------------------------------------------- */
test.describe("backlog", () => {
  // These tests create, edit, delete, move, and reorder stories & sprints
  // against a SHARED, PERSISTENT backend (the seeded Django DB). They run
  // serially so that this shared backend context is mutated in a deterministic
  // order and a failure aborts the remainder rather than leaving later tests to
  // observe an inconsistent database. This is an intentionally-managed serial
  // shared context — NOT reliance on shared UI state. Unlike the Protractor
  // original (which shared one global `browser`, so DOM/selection state carried
  // between `it`s), Playwright hands each test a FRESH page + context and the
  // `taiga` fixture re-authenticates before every test; therefore NO DOM or
  // selection state carries over. Every test below establishes its own UI
  // preconditions, and only backend state is shared.
  test.describe.configure({ mode: "serial" });

  // Port of the source's top-level `before`: every test starts on the seeded
  // `project-3` Backlog. The `taiga` fixture has already authenticated the
  // admin user before this hook runs, using the test-only credentials supplied
  // via the environment (never a password hard-coded in source).
  test.beforeEach(async ({ taiga }) => {
    await taiga.gotoBacklog("project-3");
  });

  // First evidence capture — the source took `takeScreenshot('backlog', 'backlog')`
  // in its top-level `before`.
  test("capture backlog screen", async ({ taiga }) => {
    await taiga.screenshot("backlog");
  });

  /* ----------------------------------------------------------------------- *
   * create US
   *
   * Collapses the source's `before` (open the create-US lightbox) + five
   * sequential `it`s (capture screen, fill form, upload attachments, capture
   * filled screen, send form) into ONE self-contained test. The Playwright
   * harness hands each test a fresh, isolated page, so the shared-lightbox
   * sequence the Protractor `before` set up is reproduced inline here, in the
   * SAME order and with the SAME assertions/screenshots.
   * ----------------------------------------------------------------------- */
  test.describe("create US", () => {
    test("create a user story through the lightbox", async ({ page, taiga }) => {
      const lb = lightbox(page);

      // Route to a project whose backlog holds well under the 30-story page-1
      // cap. The stock create flow fires `usform:new:success` ->
      // `loadUserstories(true)`, which RESETS pagination to page 1; on project-3
      // (34 backlog stories) page 1 stays capped at 30 and the newly-created
      // story (appended at the bottom `backlog_order`) lands on page 2, so the
      // row-count delta is never observable. project-2 (19 backlog stories,
      // identical points/status config) reproduces the <30-backlog data
      // condition the original Protractor suite ran under, making the source's
      // exact `+1` assertion valid against the stock build. Isolated: no other
      // backlog test touches project-2.
      await taiga.gotoBacklog("project-2");
      await expect.poll(() => userStories(page).count()).toBeGreaterThan(0);

      await page.locator(SEL.newUs).nth(0).click();
      await lb.open(SEL.createEditUsLightbox);

      // it('capture screen')
      await taiga.screenshot("create-us");

      const el = page.locator(SEL.createEditUsLightbox);

      // it('fill form') — subject
      await el.locator('input[name="subject"]').fill("subject");

      // Set each role's points via the per-role estimation <select>. The served
      // story lightbox renders `label.points-per-role > select.points-value`
      // (one per computable role) — the functional equivalent of the legacy
      // per-role points popover / `.ticket-role-points` total the POC form does
      // not render. Selecting the first real point option (index 1; index 0 is
      // the unestimated "?") exercises the estimation control for every role.
      {
        const roleSelects = el.locator(".points-per-role select");
        const roleCount = await roleSelects.count();
        expect(roleCount).toBeGreaterThan(0);
        for (let i = 0; i < roleCount; i++) {
          await roleSelects.nth(i).selectOption({ index: 1 });
        }
      }

      // status
      await setLightboxStatus(page, el, 2);

      // tags
      await fillTags(page);

      // description
      await el.locator('textarea[name="description"]').fill("test test");

      // settings + let the toggle transition settle (source: waitTransitionTime).
      // The served lightbox exposes settings as `.ticket-detail-settings`
      // icon buttons (team/client requirement, block), not the legacy
      // `.settings label` markup — reconciled identically to the Kanban spec.
      await el.locator(".ticket-detail-settings button.btn-icon").nth(0).click();
      await page.waitForTimeout(400);

      // it('screenshots')
      await taiga.screenshot("create-us-filled");

      // it('send form') — relative delta assertion
      const before = await userStories(page).count();
      await el.locator('button[type="submit"]').first().click();
      await lb.close(SEL.createEditUsLightbox);
      await expect(userStories(page)).toHaveCount(before + 1);
    });
  });

  /* ----------------------------------------------------------------------- *
   * bulk create US — collapses the source `before` + two `it`s.
   * ----------------------------------------------------------------------- */
  test.describe("bulk create US", () => {
    test("bulk create two user stories", async ({ page, taiga }) => {
      const lb = lightbox(page);

      // See "create US": route to a <30-backlog project so the paginated page-1
      // row count reflects the source's exact `+2` delta (project-3's 34-story
      // backlog caps page 1 at 30, hiding the delta after the stock re-fetch).
      await taiga.gotoBacklog("project-2");
      await expect.poll(() => userStories(page).count()).toBeGreaterThan(0);

      await page.locator(SEL.newUs).nth(1).click();
      await lb.open(SEL.bulkCreateLightbox);

      // Type two lines exactly as the source did (each committed with Enter).
      // `fill` sets the first line; `pressSequentially` appends the second so we
      // do NOT clobber the first (which `fill` would).
      const textarea = page.locator(SEL.bulkCreateLightbox).locator("textarea").first();
      await textarea.fill("aaa");
      await textarea.press("Enter");
      await textarea.pressSequentially("bbb");
      await textarea.press("Enter");

      const before = await userStories(page).count();
      await page.locator(`${SEL.bulkCreateLightbox} button[type="submit"]`).first().click();
      await lb.close(SEL.bulkCreateLightbox);
      await expect(userStories(page)).toHaveCount(before + 2);
    });
  });

  /* ----------------------------------------------------------------------- *
   * edit US — collapses the source `before` + three `it`s.
   * ----------------------------------------------------------------------- */
  test.describe("edit US", () => {
    test("edit a user story through the backlog lightbox", async ({ page }) => {
      const lb = lightbox(page);

      // Open the first row's kebab menu, then its "Edit" action.
      const options = await openRowOptions(page, 0);
      await options.locator(SEL.rowOptionsEdit).click();
      await lb.open(SEL.createEditUsLightbox);

      const el = page.locator(SEL.createEditUsLightbox);

      // subject
      await el.locator('input[name="subject"]').fill("subjectedit");

      // Re-set each role's points via the per-role estimation <select> (same
      // real control the create-US flow drives).
      {
        const roleSelects = el.locator(".points-per-role select");
        const roleCount = await roleSelects.count();
        expect(roleCount).toBeGreaterThan(0);
        for (let i = 0; i < roleCount; i++) {
          await roleSelects.nth(i).selectOption({ index: 1 });
        }
      }

      // status
      await setLightboxStatus(page, el, 4);

      // tags
      await fillTags(page);

      // description
      await el.locator('textarea[name="description"]').fill("test test test test");

      // settings (see create-US: `.ticket-detail-settings` icon buttons; the
      // served lightbox renders exactly one block/unblock icon, so `.first()`).
      await el.locator(".ticket-detail-settings button.btn-icon").first().click();

      await el.locator('button[type="submit"]').first().click();
      await lb.close(SEL.createEditUsLightbox);
    });
  });

  /* ----------------------------------------------------------------------- *
   * Inline editing, deletion, and drag/reorder — top-level `it`s in the source.
   * ----------------------------------------------------------------------- */

  test("edit status inline", async ({ page }) => {
    // First selection primes the popover; the source then slept 2000ms for the
    // status-change debounce before selecting the target status.
    await setUsStatus(page, 0, 1);
    await page.waitForTimeout(2000); // debounce (behavioral, not an SLA)

    const statusText = await setUsStatus(page, 0, 2);
    expect(statusText).toBe("In progress");
  });

  test("edit points inline", async ({ page }) => {
    // `getUsPoints(0, 1, 1)` in the source ignored the extra args -> it simply
    // read points[0]; the real mutation is `setUsPoints(0, 1, 1)`.
    const original = (await usPointsSpan(page, 0).innerText()).trim();

    await openPopover(page, usPointsSpan(page, 0), 1, 1);

    const updated = (await usPointsSpan(page, 0).innerText()).trim();
    expect(original).not.toBe(updated);
  });

  test("delete US", async ({ page, taiga }) => {
    // See "create US": route to a <30-backlog project so the paginated page-1
    // row count reflects the source's exact `-1` delta (project-3's 34-story
    // backlog caps page 1 at 30, hiding the delta after the stock re-fetch).
    await taiga.gotoBacklog("project-2");
    await expect.poll(() => userStories(page).count()).toBeGreaterThan(0);

    const before = await userStories(page).count();

    // Open the first row's kebab menu, then its "Delete" action (2nd <li>).
    const options = await openRowOptions(page, 0);
    // The served build confirms US deletion through a native `window.confirm`
    // (the documented POC substitute for the legacy `$confirm.askOnDelete`
    // lightbox — see `useBacklogStories.deleteUserStory`); accept the dialog
    // rather than driving a themed lightbox. Register the handler BEFORE the
    // click that triggers it.
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await options.locator(SEL.rowOptionsDelete).click();

    await expect(userStories(page)).toHaveCount(before - 1);
  });

  test("drag backlog us", async ({ page }) => {
    const row4 = userStories(page).nth(4);
    const draggedRef = await usRef(row4);

    // Drop into the TOP slice of row0 (fractional `y: 0.1`) rather than its
    // geometric center. This reorder must insert the dragged row BEFORE the
    // current first row (index 0), and the reliable "insert-before-first" zone
    // is the top of the destination row. A center-of-row drop is ambiguous when
    // backlog rows differ in height (a plain 56px row vs a 102px row carrying
    // tags/description): the center then resolves to "after row0" (index 1).
    // Expressing the drop as a fraction of the row's height lands in the
    // insert-before zone independent of that height. See
    // DragOptions.targetPosition.
    await dragAndDrop(page, dragHandle(row4), userStories(page).nth(0), {
      targetPosition: { x: 0.5, y: 0.1 },
    });

    // The dragged story should now be the first row (auto-retries via poll,
    // replacing the source's `browser.waitForAngular()`).
    await expect.poll(() => usRef(userStories(page).nth(0))).toBe(draggedRef);
  });

  test("reorder multiple us", async ({ page }) => {
    // The source selected the LAST two rows and dragged them to the top. That
    // exact geometry is incompatible with REAL Playwright pointer input (which
    // the shared helper must use so it also drives @dnd-kit on the `react`
    // build): a real drag requires BOTH the source row and the top drop target
    // to be on-screen simultaneously at their captured coordinates, but "last
    // row -> first row" on a long, paginated backlog spans far more rows than
    // fit one viewport, so the drop lands mid-list. The legacy Protractor drag
    // dispatched synthetic events and never needed visibility. We preserve the
    // test's INTENT verbatim — select TWO adjacent rows, drag one, and confirm
    // BOTH move together to the top in their original relative order — while
    // choosing two rows NEAR THE TOP (indices 2 and 3) so the whole gesture
    // fits the viewport. This works on the default seeded project-3 with no
    // data-size dependency (verified: dragging the upper of the two selected
    // rows leads, the lower follows). The `targetPosition` top-slice drop makes
    // the insert land BEFORE row0 (index 0) independent of row height.
    await expect.poll(() => userStories(page).count()).toBeGreaterThan(3);

    // Select two adjacent rows near the top, capturing their refs. `upper` is
    // the one that gets dragged (it leads on drop); `lower` follows it.
    const upper = userStories(page).nth(2);
    await rowCheckbox(upper).click();
    const refUpper = await usRef(upper);

    const lower = userStories(page).nth(3);
    await rowCheckbox(lower).click();
    const refLower = await usRef(lower);

    // Drag the upper selected row to the top; both selected rows move together.
    // Drop into the TOP slice of row0 (fractional `y: 0.1`) so the selected
    // rows insert BEFORE the current first row (index 0) regardless of row
    // height. See DragOptions.targetPosition.
    await dragAndDrop(page, dragHandle(upper), userStories(page).nth(0), {
      targetPosition: { x: 0.5, y: 0.1 },
    });

    // The dragged upper row leads (row0), the lower selected row follows (row1),
    // preserving the two selected rows' original relative order — the same
    // multi-card semantics the source asserted.
    await expect.poll(() => usRef(userStories(page).nth(0))).toBe(refUpper);
    await expect.poll(() => usRef(userStories(page).nth(1))).toBe(refLower);
  });

  test("drag multiple us to milestone", async ({ page }) => {
    const sprint = sprints(page).nth(0);

    // Establish this test's OWN precondition instead of relying on selection
    // state from a previous test: Playwright hands each test a fresh page (and
    // the `taiga` fixture re-authenticates), so nothing a prior test selected
    // survives. The source relied on "the us 1 and 2 are selected on the
    // previous test"; that precondition is reproduced INLINE here by selecting
    // two backlog rows. With multiple rows selected, dragging one of them
    // carries every selected row into the sprint (the multi-card move
    // behavior), so BOTH selected stories land in the sprint.
    const row0 = userStories(page).nth(0);
    const row1 = userStories(page).nth(1);
    await rowCheckbox(row0).click();
    await rowCheckbox(row1).click();
    const ref0 = await usRef(row0);
    const ref1 = await usRef(row1);

    await dragAndDrop(page, dragHandle(userStories(page).nth(0)), sprint.locator(SEL.sprintTable));

    // Assert by PRESENCE (both dragged refs now appear in the sprint) rather
    // than a count delta — see `storyRefs` for why a sprint-story count baseline
    // is fragile (async render race + cross-run accumulation).
    await expect
      .poll(() => storyRefs(sprint.locator(SEL.sprintStories)))
      .toEqual(expect.arrayContaining([ref0, ref1]));
  });

  test("drag us to milestone", async ({ page }) => {
    const sprintTable = sprints(page).nth(0).locator(SEL.sprintTable);

    // Capture the dragged story's ref (the source captured it too but asserted
    // only a count delta; asserting the ref's PRESENCE is both more faithful to
    // the intent — "this story moved into the sprint" — and robust to the
    // sprint-story render race that made a `count()` baseline read 0).
    const draggedRef = await usRef(userStories(page).nth(0));

    await dragAndDrop(page, dragHandle(userStories(page).nth(0)), sprintTable);

    await expect
      .poll(() => storyRefs(sprintTable.locator(SEL.sprintStories)))
      .toContain(draggedRef);
  });

  test("move to latest sprint button", async ({ page }) => {
    const row0 = userStories(page).nth(0);
    await rowCheckbox(row0).click();
    const draggedRef = await usRef(row0);

    await page.locator(SEL.moveToSprint).first().click();

    // The story should now appear in the LATEST sprint. The stock backlog
    // controller's `moveToLatestSprint` targets `$scope.sprints[0]` (verified
    // in app/coffee/modules/backlog/main.coffee), i.e. the FIRST sprint in the
    // sidebar's array. The served build orders sprints newest-first, so
    // `$scope.sprints[0]` is the most-recent sprint and renders as the FIRST
    // open sprint in the DOM (confirmed at runtime: the moved story lands in
    // the first open sprint, not the last). The legacy Protractor assertion
    // used `.last()`, which assumed an oldest-first ordering this build does
    // not use; `.first()` matches where the button actually deposits the story
    // while preserving the test's intent (the US moved into the latest sprint).
    // Poll the sprint's refs, replacing the source's `outerHtmlChanges` settle
    // + `waitForAngular`.
    const sprint = sprintsOpen(page).first();
    await expect
      .poll(async () => (await sprint.locator(SEL.usRef).allInnerTexts()).map((t) => t.trim()))
      .toContain(draggedRef);
  });

  test("reorder milestone us", async ({ page, taiga }) => {
    const sprint = sprints(page).nth(0);
    const sprintStories = sprint.locator(SEL.sprintStories);

    // Ordered story references inside a sprint's story list — the shared
    // module-level `storyRefs` helper (uses `allTextContents`, so the read is
    // robust regardless of a sprint's fold/visibility state).
    const refsOf = storyRefs;

    // Self-contained precondition: a within-milestone reorder is only meaningful
    // with at least two stories in the sprint. Prior serial tests move stories
    // here, but this test does NOT depend on that — it tops up from the backlog
    // until the sprint holds two stories, so the reorder and its assertion are
    // always meaningful.
    let inSprint = await sprintStories.count();
    let guard = 0;
    while (inSprint < 2 && guard < 5 && (await userStories(page).count()) > 0) {
      await dragAndDrop(page, dragHandle(userStories(page).nth(0)), sprint.locator(SEL.sprintTable));
      await expect.poll(() => sprintStories.count()).toBeGreaterThan(inSprint);
      inSprint = await sprintStories.count();
      guard += 1;
    }
    expect(inSprint).toBeGreaterThanOrEqual(2);

    // Capture the order BEFORE the reorder and remember the LAST story's ref.
    const before = await refsOf(sprintStories);
    const movedRef = before[before.length - 1];
    const originalIndex = before.length - 1;

    // Drag the last sprint story onto the first (the source dragged the ROW
    // itself, not its `.icon-drag` handle, so we do the same).
    await dragAndDrop(page, sprintStories.last(), sprintStories.first());

    // REAL assertion (replaces the source's `expect(ref).toBe(ref)` self-equality
    // no-op, which could never detect a failed reorder): the moved story must end
    // up AHEAD of where it started. `expect.poll` auto-retries while the
    // optimistic reorder settles, replacing the source's `browser.waitForAngular()`.
    await expect
      .poll(async () => (await refsOf(sprintStories)).indexOf(movedRef))
      .toBeLessThan(originalIndex);

    // Persistence: reload the Backlog and confirm the new order survived a
    // round-trip to the backend (not merely an in-memory optimistic move).
    await taiga.gotoBacklog("project-3");
    const reloadedIndex = (await refsOf(sprints(page).nth(0).locator(SEL.sprintStories))).indexOf(movedRef);
    expect(reloadedIndex).toBeGreaterThanOrEqual(0);
    expect(reloadedIndex).toBeLessThan(originalIndex);
  });

  test("drag us from milestone to milestone", async ({ page }) => {
    const sprint1 = sprints(page).nth(0);
    const sprint2 = sprints(page).nth(1);

    // Wait for sprint1's stories to render (async XHR paints them a few hundred
    // ms after the loader clears).
    await expect
      .poll(() => sprint1.locator(SEL.sprintStories).count())
      .toBeGreaterThan(0);

    // Drag sprint1's LAST story (not its first) onto sprint2. Why the last row:
    // the sidebar stacks the open sprints vertically (newest first), so sprint2
    // sits directly BELOW sprint1 and sprint1's LAST row is immediately ABOVE
    // sprint2's top. `dragAndDrop` centers the target (sprint2) in the viewport
    // and then scrolls the SOURCE into view; when the source is sprint1's last
    // row it is already just above the centered sprint2, so nothing gets pushed
    // toward a viewport edge and the drop lands mid-viewport — clear of
    // `@dnd-kit`'s top/bottom autoscroll zones. Grabbing sprint1's FIRST row
    // instead (top of a tall sidebar) forces the source scroll to shove sprint2
    // to ~88% down the viewport, into the bottom autoscroll band; the window
    // then autoscrolls a non-deterministic amount during the glide and the story
    // lands one sprint too low. Using the adjacent last row keeps source and
    // target co-visible in the safe band no matter how many stories prior serial
    // tests piled into sprint1, so the gesture is stable. Any story moving from
    // sprint1 to sprint2 satisfies the test's intent; the last one is simply the
    // geometrically robust choice for a real-pointer @dnd-kit drag.
    const sprint1Stories = sprint1.locator(SEL.sprintStories);
    const lastIdx = (await sprint1Stories.count()) - 1;
    const movedRef = (await storyRefs(sprint1Stories))[lastIdx];

    await dragAndDrop(
      page,
      sprint1Stories.nth(lastIdx),
      sprint2.locator(SEL.sprintTable)
    );

    // Presence assertion (see `storyRefs`): the moved story now appears in
    // sprint2. Robust to the render race and cross-run accumulation that make a
    // count-delta baseline unreliable for sprint story lists.
    await expect
      .poll(() => storyRefs(sprint2.locator(SEL.sprintStories)))
      .toContain(movedRef);
  });

  test("select us with SHIFT", async ({ page }) => {
    // The source wrapped this in `browserSkip('internet explorer', ...)`;
    // Playwright runs Chromium, so it is a normal test. The 5000ms sleep let the
    // preceding reorders settle before the range selection.
    await page.waitForTimeout(5000);

    // Range-select rows 0..3: click row0's checkbox, then Shift+click row3's.
    await rowCheckbox(userStories(page).nth(0)).click();
    await rowCheckbox(userStories(page).nth(3)).click({ modifiers: ["Shift"] });

    await expect(page.locator(SEL.selectedUserStories)).toHaveCount(4);
  });

  test("role filters", async ({ page, taiga }) => {
    // Port of `fiterRole(1)` — open the role/points selector popover and pick
    // the first role.
    await openPopover(page, page.locator(SEL.rolePointsSelector).first(), 1);

    await taiga.screenshot("backlog-role-filters");

    const points = (await usPointsSpan(page, 0).innerText()).trim();
    expect(points).toMatch(/[0-9?]+\s\/\s[0-9?]+/);
  });

  /* ----------------------------------------------------------------------- *
   * milestones — create / edit / delete.
   * ----------------------------------------------------------------------- */
  test.describe("milestones", () => {
    test("create", async ({ page, taiga }) => {
      const lb = lightbox(page);

      await page.locator(SEL.addSprint).first().click();
      await lb.open(SEL.createEditSprintLightbox);

      await taiga.screenshot("create-milestone");

      const sprintName = `sprintName${Date.now()}`;
      const nameInput = await sprintNameInput(page);
      await nameInput.fill(sprintName);

      await page.locator(`${SEL.createEditSprintLightbox} button[type="submit"]`).first().click();
      await page.waitForTimeout(2000); // debounce (behavioral, not an SLA)

      await expect.poll(() => sprintTitles(page)).toContain(sprintName);
    });

    test("edit", async ({ page }) => {
      const lb = lightbox(page);

      await page.locator(SEL.milestoneEdit).nth(0).click();
      await lb.open(SEL.createEditSprintLightbox);

      // `fill` clears the current value and types the new one (the source did an
      // explicit `.clear()` then `.sendKeys(...)`).
      const sprintName = `sprintName${Date.now()}`;
      const nameInput = await sprintNameInput(page);
      await nameInput.fill(sprintName);

      await page.locator(`${SEL.createEditSprintLightbox} button[type="submit"]`).first().click();
      await lb.close(SEL.createEditSprintLightbox);

      await expect.poll(() => sprintTitles(page)).toContain(sprintName);
    });

    test("delete", async ({ page }) => {
      const lb = lightbox(page);

      await page.locator(SEL.milestoneEdit).nth(0).click();
      await lb.open(SEL.createEditSprintLightbox);

      // Read the name BEFORE deleting (the source read it after, when the input
      // was already gone; reading it first is the faithful, correct order).
      const nameInput = await sprintNameInput(page);
      const deletedName = (await nameInput.inputValue()).trim();

      // Sprint deletion is an IN-DIALOG confirmation step inside the create/edit
      // sprint modal (M3: the legacy `$confirm.askOnDelete` reproduced with no
      // `window.confirm` and no separate lightbox). Click "Delete", then confirm
      // via the in-dialog accept control.
      await page.locator(`${SEL.createEditSprintLightbox} .delete-sprint`).first().click();
      await page
        .locator(`${SEL.createEditSprintLightbox} .delete-sprint-confirm-accept`)
        .click();

      await expect.poll(() => sprintTitles(page)).not.toContain(deletedName);
    });
  });

  /* ----------------------------------------------------------------------- *
   * tags — show / hide. In the Protractor original these formed a toggle pair
   * on ONE shared browser. On the served build tags are SHOWN BY DEFAULT
   * (`ctrl.showTags` starts true; the rows carry `ng-if="ctrl.showTags"`), and
   * the toggle is the custom checkbox behind `#show-tags` (see `SEL.showTags`).
   * Playwright also hands each test a FRESH page, so neither test can rely on
   * the other's toggle state. Each therefore establishes its OWN state
   * explicitly: "show" ensures tags are visible (toggling on only if needed)
   * and captures; "hide" ensures visible first, then toggles off to exercise
   * the hide path. `tagsShown` reads the real rendered state so both tests are
   * correct regardless of the toggle's starting position.
   * ----------------------------------------------------------------------- */
  test.describe("tags", () => {
    const tagsShown = async (page: Page): Promise<boolean> =>
      (await page.locator(SEL.tag).count()) > 0;

    test("show", async ({ page, taiga }) => {
      if (!(await tagsShown(page))) {
        await page.locator(SEL.showTags).click();
      }
      await expect(page.locator(SEL.tag).first()).toBeVisible();

      await taiga.screenshot("backlog-tags");
    });

    test("hide", async ({ page }) => {
      // Ensure tags are shown first (default on this build), then toggle OFF to
      // verify the hide path via the real `.check` control (not the inert
      // `#show-tags` wrapper the source clicked).
      if (!(await tagsShown(page))) {
        await page.locator(SEL.showTags).click();
      }
      await expect(page.locator(SEL.tag).first()).toBeVisible();

      await page.locator(SEL.showTags).click(); // hide
      await expect(page.locator(SEL.tag).first()).toBeHidden();
    });
  });

  /* ----------------------------------------------------------------------- *
   * velocity forecasting — navigates to its OWN projects inside each test
   * (project-1 has velocity data; project-5 has none), exactly as the source
   * did. The outer `beforeEach` still runs first, so each test re-navigates.
   * ----------------------------------------------------------------------- */
  test.describe("velocity forecasting", () => {
    test("show", async ({ page, taiga }) => {
      // Deterministic precondition: project-1 must have a known velocity for the
      // forecasting control to appear (mirrors the committed baseline state).
      await ensureVelocity(page, "project-1");
      await taiga.gotoBacklog("project-1");

      // gotoBacklog's `waitLoader` can return before the asynchronous story
      // fetch has painted the rows; sample the baseline count only AFTER the
      // backlog has rendered, so `before` reflects the real story total (not 0).
      await expect.poll(() => userStories(page).count()).toBeGreaterThan(0);
      const before = await userStories(page).count();

      await page.locator(SEL.velocityForecasting).first().click();
      await taiga.screenshot("velocity-forecasting");

      // Enabling forecasting filters the backlog down, so the visible story
      // count drops.
      await expect.poll(() => userStories(page).count()).toBeLessThan(before);
    });

    test("create sprint from forecasting", async ({ page, taiga }) => {
      // Same velocity precondition as the "show" test — the forecasting "add
      // sprint" affordance only renders while forecasting is active.
      await ensureVelocity(page, "project-1");
      await taiga.gotoBacklog("project-1");

      // Wait for the backlog to finish loading before sampling the baseline
      // sprint count (see the "show" test — gotoBacklog can return pre-paint).
      await expect.poll(() => userStories(page).count()).toBeGreaterThan(0);
      const before = await sprintsOpen(page).count();

      await page.locator(SEL.velocityForecasting).first().click();
      await page.locator(SEL.velocityForecastingAdd).first().click();
      await page.locator(SEL.sprintNameForecast).first().fill(`sprintName${Date.now()}`);
      await page.locator(SEL.sprintNameForecast).first().press("Enter");

      await expect.poll(() => sprintsOpen(page).count()).toBeGreaterThan(before);
    });

    test("hide forecasting if no velocity", async ({ page, taiga }) => {
      await taiga.gotoBacklog("project-5");

      // project-5 has no velocity, so the forecasting control is absent.
      await expect(page.locator(SEL.velocityForecasting)).toHaveCount(0);
    });
  });

  /* ----------------------------------------------------------------------- *
   * backlog filters — the shared filter parity cases (also emits the "filters"
   * screenshot). Navigation is handled ENTIRELY by the serial `beforeEach`,
   * which routes every test in this describe to project-3 on a fresh page.
   *
   * A redundant in-body `gotoBacklog("project-3")` was REMOVED: navigating to
   * the same route a second time reloads the SPA, and `gotoBacklog`'s
   * `waitLoader()` can return before the fresh AngularJS bootstrap has painted
   * the board (the top-level `.loader` is briefly absent from the DOM on the
   * reload, so the "not active" wait is a no-op). That left the filter panel
   * unrendered when `runSharedFilters` began — the `.filters-cat-single`
   * categories never appeared and the "filter by category" step timed out
   * (evidenced by a blank `filters.png`). The Kanban filter test never
   * re-navigates and passed for exactly this reason, so relying on the single
   * `beforeEach` navigation here restores parity between the two screens.
   * ----------------------------------------------------------------------- */
  test("backlog filters", async ({ page }, testInfo) => {
    await runSharedFilters(page, testInfo, () => userStories(page).count());
  });

  /* ----------------------------------------------------------------------- *
   * closed sprints — an intentionally-managed serial shared context. The first
   * test seeds PERSISTENT backend data (an empty milestone holding a single
   * closed story); the following tests observe that backend state. Because
   * Playwright's `beforeAll` cannot access the test-scoped `page`/`taiga`, the
   * "beforeAll-style" seeding is a dedicated first test that serial mode
   * guarantees runs first. The shared context is BACKEND state only — each test
   * still runs on a fresh page and establishes its own UI (toggle) state; none
   * of these tests assumes a previous test left the closed-sprints panel shown.
   * ----------------------------------------------------------------------- */
  test.describe("closed sprints", () => {
    test("setup: ensure at least one closed sprint", async ({ page, taiga }) => {
      // Deterministic precondition: guarantee project-3 has exactly one closed
      // sprint through the frozen /api/v1 contract (beforeEach already routes here
      // on a fresh page so a live bearer token is present). This replaces the
      // legacy UI seed (create empty milestone + synthetic-event drag of a closed
      // story into it): that drag used `dragViaEvents`, which drives dragula on the
      // baseline build but does NOT trip @dnd-kit's PointerSensor on the react
      // build, so it could not create the closed sprint the following tests observe.
      // The reopen BEHAVIOR is still exercised end-to-end by the react DnD in the
      // "open sprint by drag open US to closed sprint" test below.
      await taiga.gotoBacklog("project-3");
      await ensureClosedSprint(page, "project-3");
    });

    test("open closed sprints", async ({ page }) => {
      // Closed sprints are hidden by default; the setup test created (at least)
      // one, so revealing them must surface MORE than were visible before.
      // Asserting a positive delta rather than an absolute count keeps this
      // correct even if the shared backend already held other closed sprints.
      const closed = page.locator(SEL.closedSprints);
      const before = await closed.count();

      await page.locator(SEL.toggleClosedSprints).first().click();

      await expect.poll(() => closed.count()).toBeGreaterThan(before);
    });

    test("close closed sprints", async ({ page }) => {
      // Each test gets a fresh page where the closed-sprints panel starts
      // hidden, so this test establishes its OWN "shown" precondition (toggle
      // on) before exercising the hide path (toggle off). It does NOT assume a
      // previous test left the panel shown.
      const closed = page.locator(SEL.closedSprints);
      const toggle = page.locator(SEL.toggleClosedSprints).first();

      await toggle.click(); // show
      await expect.poll(() => closed.count()).toBeGreaterThan(0);

      await toggle.click(); // hide
      await expect(closed).toHaveCount(0);
    });

    test("open sprint by drag open US to closed sprint", async ({ page, taiga }) => {
      // Reveal the closed sprint seeded by the setup test (shared backend state).
      await page.locator(SEL.toggleClosedSprints).first().click();

      // Re-open (set to a non-closed status) the 2nd backlog story.
      await setUsStatus(page, 1, 1);

      // Unfold the last sprint (the seeded closed sprint), then drag the
      // now-open story into it, which un-closes that sprint. This uses the
      // real-pointer `dragAndDrop` (which trips @dnd-kit's PointerSensor on the
      // react build): unlike the setup, this test does NOT `loadFullBacklog`, so
      // the dragged backlog story sits near the TOP of the list and the unfolded
      // closed sprint's `.sprint-table` sits in the sidebar — both co-visible in
      // the viewport, so a real pointer can span them. The preceding `toggleSprint`
      // unfold is REQUIRED: a closed sprint renders folded (its `.sprint-table` is
      // `display:none` and its droppable is disabled) and only becomes a live drop
      // target once expanded — the faithful legacy behavior where an unfolded
      // closed sprint accepts a story and the backend reopens it.
      const sprint = sprints(page).last();
      await toggleSprint(page, sprint);
      await dragAndDrop(page, dragHandle(userStories(page).nth(1)), sprint.locator(SEL.sprintTable));

      // With no closed sprints left, the closed-sprints toggle disappears.
      //
      // The drag reopens the sprint on the SERVER (the milestone now holds a mix
      // of open + closed stories, so its `closed` flag is recomputed to false).
      // The toggle's visibility, however, is gated by `ng-if="totalClosedMilestones"`,
      // and the served backlog only refreshes `totalClosedMilestones` by calling
      // `loadSprints()` — which, when the WebSocket is CONNECTED, it does NOT do
      // inline after a drop (the drop handler runs `events.connected || loadSprints()`,
      // deferring instead to the async `changes.project.{id}.milestones` WS event).
      // That WS-driven refresh is inherently non-deterministic in timing (observed
      // to not arrive within 25s under a loaded board), so asserting the toggle
      // hides LIVE is flaky. Re-navigating performs a fresh `loadSprints()` that
      // re-reads `totalClosedMilestones` (now 0) from the server, deterministically
      // reflecting the PERSISTED reopen. This is the true behavioral parity — the
      // sprint is reopened and any fresh load shows no closed sprints — and is
      // build-agnostic (the React screen likewise re-fetches state on navigation).
      await taiga.gotoBacklog("project-3");
      await expect(page.locator(SEL.toggleClosedSprints)).toHaveCount(0);
    });
  });
});
