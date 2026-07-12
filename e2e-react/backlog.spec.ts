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
  uploadAttachment,
  runSharedFilters,
} from "./fixtures";
import type { Page, Locator } from "@playwright/test";

/* ------------------------------------------------------------------------- *
 * Selectors — reproduced BYTE-IDENTICALLY from `e2e/helpers/backlog-helper.js`
 * (plus the common/filters helpers). The React port emits the same markup, so
 * these selectors are build-agnostic and MUST NOT be changed.
 * ------------------------------------------------------------------------- */
const SEL = {
  // Backlog user-story rows and selection.
  userStories: '.backlog-table-body > div[ng-repeat]',
  selectedUserStories: '.backlog-table-body input[type="checkbox"]:checked',
  checkbox: 'input[type="checkbox"]',

  // Sprints (milestones) in the sidebar.
  sprints: 'div[tg-backlog-sprint="sprint"]',
  sprintsOpen: 'div[tg-backlog-sprint="sprint"].sprint-open',
  sprintStories: '.milestone-us-item-row',
  sprintTitles: 'div[tg-backlog-sprint="sprint"] .sprint-name span',
  sprintTable: '.sprint-table',
  compactSprint: '.compact-sprint',

  // Toolbar / row affordances.
  newUs: '.new-us a',
  addSprint: '.add-sprint',
  usBacklogEdit: '.backlog-table-body .e2e-edit',
  milestoneEdit: 'div[tg-backlog-sprint="sprint"] .edit-sprint',
  usStatus: '.backlog-table-body > div .us-status',
  usPoints: '.backlog-table-body > div .us-points',
  deleteUs: '.backlog-table-body > div .e2e-delete',
  usRef: 'span[tg-bo-ref]',
  iconDrag: '.icon-drag',
  moveToSprint: '.e2e-move-to-sprint',
  rolePointsSelector: 'div[tg-us-role-points-selector]',

  // Tags toggle.
  showTags: '#show-tags',
  tag: '.backlog-table .tag',

  // Closed sprints.
  toggleClosedSprints: '.filter-closed-sprints',
  closedSprints: '.sprint-closed',
  closedSprintDrop: '.sprint-empty',

  // Velocity forecasting.
  velocityForecasting: '.e2e-velocity-forecasting',
  velocityForecastingAdd: '.e2e-velocity-forecasting-add',
  sprintNameForecast: '.e2e-sprint-name',

  // Lightboxes (modals).
  createEditUsLightbox: 'div[tg-lb-create-edit-userstory]',
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
 * Port of `backlogHelper.loadFullBacklog()` — repeatedly scroll the last story
 * into view until the infinite-scroll pagination stops adding rows. The loop is
 * naturally bounded by pagination and additionally guarded against a runaway
 * loop. The short wait after each scroll gives the async page fetch time to
 * append the next page of rows.
 */
async function loadFullBacklog(page: Page): Promise<void> {
  let count: number;
  let newCount = await userStories(page).count();
  let guard = 0;

  do {
    count = newCount;
    if (count > 0) {
      await userStories(page).last().scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(500);
    newCount = await userStories(page).count();
    guard += 1;
  } while (newCount > count && guard < 50);
}

/**
 * Setup helper for the "closed sprints" block — create a brand-new (empty)
 * milestone with a unique timestamped name. Port of the source's
 * `createEmptyMilestone`.
 */
async function createEmptyMilestone(page: Page): Promise<void> {
  const lb = lightbox(page);

  await page.locator(SEL.addSprint).first().click();
  await lb.open(SEL.createEditSprintLightbox);

  const nameInput = await sprintNameInput(page);
  await nameInput.fill(`sprintName${Date.now()}`);

  await page.locator(`${SEL.createEditSprintLightbox} button[type="submit"]`).first().click();
  await lb.close(SEL.createEditSprintLightbox);
}

/**
 * Setup helper for the "closed sprints" block — create a user story in the
 * CLOSED status (`select option:nth-child(6)`), load the full paginated
 * backlog, and drag that last (closed) story onto the empty sprint's drop
 * table. Port of the source's `dragClosedUsToMilestone`.
 */
async function createClosedUsAndDragToClosedSprint(page: Page): Promise<void> {
  const lb = lightbox(page);

  await page.locator(SEL.newUs).nth(0).click();
  await lb.open(SEL.createEditUsLightbox);

  const el = page.locator(SEL.createEditUsLightbox);
  await el.locator('input[name="subject"]').fill("subject");
  // Closed status is the 6th <option> (source: `status(5)` clicked option 6).
  await el.locator("select option:nth-child(6)").first().click();
  await el.locator('button[type="submit"]').first().click();
  await lb.close(SEL.createEditUsLightbox);

  await loadFullBacklog(page);

  await dragAndDrop(
    page,
    dragHandle(userStories(page).last()),
    page.locator(SEL.closedSprintDrop).last(),
  );
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

      await page.locator(SEL.newUs).nth(0).click();
      await lb.open(SEL.createEditUsLightbox);

      // it('capture screen')
      await taiga.screenshot("create-us");

      const el = page.locator(SEL.createEditUsLightbox);

      // it('fill form') — subject
      await el.locator('input[name="subject"]').fill("subject");

      // roles: role idx1 -> points idx3, role idx3 -> points idx4
      await openPopover(page, el.locator(".points-per-role li").nth(1), 3);
      await openPopover(page, el.locator(".points-per-role li").nth(3), 4);

      // total role points (source asserted exactly '3')
      await expect(el.locator(".ticket-role-points").last().locator(".points").first()).toHaveText("3");

      // status
      await el.locator("select option:nth-child(2)").first().click();

      // tags
      await fillTags(page);

      // description
      await el.locator('textarea[name="description"]').fill("test test");

      // settings + let the toggle transition settle (source: waitTransitionTime)
      await el.locator(".settings label").nth(0).click();
      await page.waitForTimeout(400);

      // it('upload attachments')
      await uploadAttachment(page);

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
    test("bulk create two user stories", async ({ page }) => {
      const lb = lightbox(page);

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

      await page.locator(SEL.usBacklogEdit).nth(0).click();
      await lb.open(SEL.createEditUsLightbox);

      const el = page.locator(SEL.createEditUsLightbox);

      // subject
      await el.locator('input[name="subject"]').fill("subjectedit");

      // four roles -> points idx3
      await openPopover(page, el.locator(".points-per-role li").nth(0), 3);
      await openPopover(page, el.locator(".points-per-role li").nth(1), 3);
      await openPopover(page, el.locator(".points-per-role li").nth(2), 3);
      await openPopover(page, el.locator(".points-per-role li").nth(3), 3);

      // total role points (source asserted exactly '4')
      await expect(el.locator(".ticket-role-points").last().locator(".points").first()).toHaveText("4");

      // status
      await el.locator("select option:nth-child(4)").first().click();

      // tags
      await fillTags(page);

      // description
      await el.locator('textarea[name="description"]').fill("test test test test");

      // settings
      await el.locator(".settings label").nth(1).click();

      // attachments
      await uploadAttachment(page);

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

  test("delete US", async ({ page }) => {
    const before = await userStories(page).count();

    await page.locator(SEL.deleteUs).nth(0).click();
    await lightbox(page).confirmOk();

    await expect(userStories(page)).toHaveCount(before - 1);
  });

  test("drag backlog us", async ({ page }) => {
    const row4 = userStories(page).nth(4);
    const draggedRef = await usRef(row4);

    await dragAndDrop(page, dragHandle(row4), userStories(page).nth(0));

    // The dragged story should now be the first row (auto-retries via poll,
    // replacing the source's `browser.waitForAngular()`).
    await expect.poll(() => usRef(userStories(page).nth(0))).toBe(draggedRef);
  });

  test("reorder multiple us", async ({ page }) => {
    const count = await userStories(page).count();

    // Select the last and second-to-last rows, capturing their refs.
    const last = userStories(page).nth(count - 1);
    await rowCheckbox(last).click();
    const ref1 = await usRef(last);

    const secondToLast = userStories(page).nth(count - 2);
    await rowCheckbox(secondToLast).click();
    const ref2 = await usRef(secondToLast);

    // Drag the second-to-last to the top; both selected rows move together.
    await dragAndDrop(page, dragHandle(secondToLast), userStories(page).nth(0));

    // Match the source's exact index assertions: row1 === first captured ref,
    // row0 === second captured ref.
    await expect.poll(() => usRef(userStories(page).nth(1))).toBe(ref1);
    await expect.poll(() => usRef(userStories(page).nth(0))).toBe(ref2);
  });

  test("drag multiple us to milestone", async ({ page }) => {
    const sprint = sprints(page).nth(0);
    const init = await sprint.locator(SEL.sprintStories).count();

    // Establish this test's OWN precondition instead of relying on selection
    // state from a previous test: Playwright hands each test a fresh page (and
    // the `taiga` fixture re-authenticates), so nothing a prior test selected
    // survives. The source relied on "the us 1 and 2 are selected on the
    // previous test"; that precondition is reproduced INLINE here by selecting
    // two backlog rows. With multiple rows selected, dragging one of them
    // carries every selected row into the sprint (the multi-card move
    // behavior), so the sprint gains exactly two stories.
    await rowCheckbox(userStories(page).nth(0)).click();
    await rowCheckbox(userStories(page).nth(1)).click();

    await dragAndDrop(page, dragHandle(userStories(page).nth(0)), sprint.locator(SEL.sprintTable));

    await expect(sprint.locator(SEL.sprintStories)).toHaveCount(init + 2);
  });

  test("drag us to milestone", async ({ page }) => {
    const sprintTable = sprints(page).nth(0).locator(SEL.sprintTable);
    const init = await sprintTable.locator(SEL.sprintStories).count();

    // (The source captured the dragged story's ref here but never asserted on
    // it; the assertion is purely the sprint-story count delta.)
    await dragAndDrop(page, dragHandle(userStories(page).nth(0)), sprintTable);

    await expect(sprintTable.locator(SEL.sprintStories)).toHaveCount(init + 1);
  });

  test("move to latest sprint button", async ({ page }) => {
    const row0 = userStories(page).nth(0);
    await rowCheckbox(row0).click();
    const draggedRef = await usRef(row0);

    await page.locator(SEL.moveToSprint).first().click();

    // The story should now appear in the last open sprint (poll the sprint's
    // refs, replacing the source's `outerHtmlChanges` settle + waitForAngular).
    const sprint = sprintsOpen(page).last();
    await expect
      .poll(async () => (await sprint.locator(SEL.usRef).allInnerTexts()).map((t) => t.trim()))
      .toContain(draggedRef);
  });

  test("reorder milestone us", async ({ page, taiga }) => {
    const sprint = sprints(page).nth(0);
    const sprintStories = sprint.locator(SEL.sprintStories);

    // Read the ordered story references inside a sprint's story list. Uses
    // `allTextContents` (textContent) rather than `allInnerTexts` so the read is
    // robust regardless of a sprint's fold/visibility state — the ref token is
    // the same either way.
    const refsOf = async (list: Locator): Promise<string[]> =>
      (await list.locator(SEL.usRef).allTextContents()).map((t) => t.trim());

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

    const init = await sprint2.locator(SEL.sprintStories).count();

    // Drag the first story of sprint1 (the ROW itself) onto sprint2's table.
    await dragAndDrop(page, sprint1.locator(SEL.sprintStories).nth(0), sprint2.locator(SEL.sprintTable));

    await expect(sprint2.locator(SEL.sprintStories)).toHaveCount(init + 1);
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

      await page.locator(`${SEL.createEditSprintLightbox} .delete-sprint`).first().click();
      await lightbox(page).confirmOk();

      await expect.poll(() => sprintTitles(page)).not.toContain(deletedName);
    });
  });

  /* ----------------------------------------------------------------------- *
   * tags — show / hide. These form a toggle pair: "show" reveals the tags and
   * "hide" toggles them back off (source semantics preserved verbatim).
   * ----------------------------------------------------------------------- */
  test.describe("tags", () => {
    test("show", async ({ page, taiga }) => {
      await page.locator(SEL.showTags).click();

      await taiga.screenshot("backlog-tags");

      await expect(page.locator(SEL.tag).first()).toBeVisible();
    });

    test("hide", async ({ page }) => {
      await page.locator(SEL.showTags).click();

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
      await taiga.gotoBacklog("project-1");

      const before = await userStories(page).count();

      await page.locator(SEL.velocityForecasting).first().click();
      await taiga.screenshot("velocity-forecasting");

      // Enabling forecasting filters the backlog down, so the visible story
      // count drops.
      await expect.poll(() => userStories(page).count()).toBeLessThan(before);
    });

    test("create sprint from forecasting", async ({ page, taiga }) => {
      await taiga.gotoBacklog("project-1");

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
   * screenshot). This test navigates to project-3 as its own explicit
   * precondition. The `beforeEach` already routes every test to project-3 on a
   * fresh page, so this call is a self-documenting, self-contained guard: the
   * preceding forecasting tests target project-1/5, but their navigation does
   * NOT leak into this test (each Playwright test starts on a fresh page).
   * ----------------------------------------------------------------------- */
  test("backlog filters", async ({ page, taiga }, testInfo) => {
    await taiga.gotoBacklog("project-3");
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
    test("setup: empty milestone with a closed story", async ({ page, taiga }) => {
      // Explicit precondition: seed against project-3 (beforeEach already routes
      // here on a fresh page; this makes the seeding target unambiguous).
      await taiga.gotoBacklog("project-3");
      await createEmptyMilestone(page);
      await createClosedUsAndDragToClosedSprint(page);
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

    test("open sprint by drag open US to closed sprint", async ({ page }) => {
      // Reveal the closed sprint seeded by the setup test (shared backend state).
      await page.locator(SEL.toggleClosedSprints).first().click();

      // Re-open (set to a non-closed status) the 2nd backlog story.
      await setUsStatus(page, 1, 1);

      // Unfold the last sprint (the seeded closed sprint), then drag the
      // now-open story into it, which un-closes that sprint.
      const sprint = sprints(page).last();
      await toggleSprint(page, sprint);
      await dragAndDrop(page, dragHandle(userStories(page).nth(1)), sprint.locator(SEL.sprintTable));

      // With no closed sprints left, the closed-sprints toggle disappears.
      await expect(page.locator(SEL.toggleClosedSprints)).toHaveCount(0);
    });
  });
});

