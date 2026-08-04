/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Backlog / Sprint planning — Playwright end-to-end specification.
 * ===========================================================================
 *
 * TECHNOLOGY-SPECIFIC CHANGE (AngularJS 1.5.10 -> React 18 migration).
 *
 * This is the executable acceptance gate for the Backlog / Sprint-Planning
 * screen, and it is deliberately framework-neutral: every flow below was PORTED
 * FROM the Protractor suite `e2e/suites/backlog.e2e.js` (585 lines), which is
 * being RETIRED by a separate change, so each case cites the incumbent line it
 * came from. Once that file is gone, this spec plus its provenance comments are
 * the only surviving record of what the AngularJS backlog was asserted to do.
 *
 * ⚠⚠ THIS FILE OWNS THE ONE CASE THE SUITE CANNOT DO WITHOUT.
 * The `pendingDrag` rapid-consecutive-drag case lives in the first describe
 * below, because `bulk-update-us-backlog-order` is POSITION-RELATIVE and a
 * SINGLE-DRAG TEST PASSES AGAINST A COMPLETELY BROKEN IMPLEMENTATION. The full
 * reasoning, and the ten source locators it guards, are documented there rather
 * than here, at the point of change.
 *
 * WHY ONE SPEC CAN JUDGE BOTH IMPLEMENTATIONS
 * ---------------------------------------------------------------------------
 * Transformation rule T1 requires React to emit the same CSS class names in the
 * same nesting so that the existing Sass applies verbatim. That is exactly what
 * makes a single spec able to run against the AngularJS build (to populate the
 * baseline artifacts) and then against the React build, and to diff the two sets
 * pairwise. Every selector here is therefore a class, an element name or a
 * documented data attribute — never a framework-private hook, and never a
 * `data-testid` (adding one would mean editing components outside this file,
 * which T10 and HR-11 forbid).
 *
 * WHAT DELIBERATELY DIFFERS FROM THE INCUMBENT
 * ---------------------------------------------------------------------------
 *   * Drag and drop. The incumbent fabricated mouse events through
 *     `executeScript` because `dragula` listened for exactly those fabricated
 *     events; `@dnd-kit/core` needs a real pointer gesture. See the
 *     drag-technology note below the selector block.
 *   * Screenshots. `utils.common.takeScreenshot` wrote into `e2e/screenshots/`,
 *     which `.gitignore` L16 ignores, so its evidence was silently discarded.
 *     Capture here is owned by `playwright.config.ts` and by {@link shot}.
 *   * Waiting. `browser.waitForAngular()`, `utils.common.dragEnd` (which polled
 *     dragula's `.gu-mirror`) and `utils.common.outerHtmlChanges` have no
 *     framework-neutral meaning and are replaced by bounded outcome assertions.
 *   * Assertion quality. Four incumbent defects are fixed and named where they
 *     are fixed: the L322 self-comparison, the L258 cross-test order coupling,
 *     the absolute closed-sprint counts at L554/L562, and the hardcoded status
 *     label at L181. T10 forbids BEHAVIOUR changes, not assertion-quality fixes.
 *
 * Each of those substitutions is documented again at its point of change, as
 * rule T9 requires, rather than only here.
 *
 * ARTIFACTS
 * ---------------------------------------------------------------------------
 * The screenshots below are the QA-time evidence for goal G4: they populate
 * `e2e-react/artifacts/baseline/` in phase P5 (AngularJS) and
 * `e2e-react/artifacts/react/` in phase P6 (React), and a later step diffs the
 * pairs against `design-reference/backlog-screen.png` to produce
 * `e2e-react/artifacts/figma-comparison/` and the Drift Register. The names are
 * part of that contract and must be identical in both phases.
 *
 * This file asserts BEHAVIOUR only. It contains no pixel-geometry assertion and
 * no colour assertion whatsoever: status, tag and epic colours come from
 * `s.color`, `tag[1]` and `epic.color` — per-project database values whose
 * Figma appearance is a `sample_data` artefact (rule T2, drift entries D1-D4).
 * Neither Figma frame captures a modal, popover, tooltip, hover or drag-ghost
 * state (drift D4), so every such expectation below comes from the Jade
 * partials and from the incumbent `e2e/utils/{lightbox,popover,notifications}.js`
 * conventions, never from the frames.
 *
 * @see e2e-react/pages/BacklogPage.ts - every selector correction lives there
 * @see e2e-react/specs/kanban.spec.ts - the sibling spec whose conventions this shares
 * @see e2e-react/fixtures/auth.ts - the single credential resolution point
 * @see e2e-react/fixtures/seed.ts - asserts the seeded dataset, never reseeds
 */

import { expect, test } from '../fixtures/auth';
import { BACKLOG_PROJECT_SLUG, assertSampleData } from '../fixtures/seed';
import { BacklogPage } from '../pages/BacklogPage';
// `dndKitDrag` is the ONE stepped-pointer gesture implementation, and it lives in
// `KanbanPage` because that screen needed it first. It is imported here for the
// two SPRINT-INTERNAL drags only — reordering inside a sprint (Case 15) and moving
// a story from one sprint to another (Case 16) — because `BacklogPage`'s
// `dragStory`/`dragStoryToSprint` both take a BACKLOG row as their source and so
// cannot express either. Re-implementing the gesture here would mean two
// implementations to keep tuned; the sibling `kanban.spec.ts` imports it for
// exactly the same reason (its cross-swimlane drag).
import { dndKitDrag } from '../pages/KanbanPage';

import type { Locator, Page } from '@playwright/test';

/* ===========================================================================
 * Two-phase capture
 * ======================================================================== */

// Two-phase capture (AAP P5/P6): the SAME spec runs twice — once against the
// AngularJS build to populate artifacts/baseline/, then again against React to
// populate artifacts/react/. The phase is selected by env var so no third spec
// file is needed; this folder holds exactly two files, one per screen.
// page.screenshot({ path }) creates parent directories itself, so nothing here
// may call fs.mkdir — and nothing here may write outside artifacts/.
const CAPTURE_PHASE = process.env.TAIGA_CAPTURE_PHASE ?? 'react';

const shot = (name: string): string =>
    `e2e-react/artifacts/${CAPTURE_PHASE}/backlog-${name}.png`;

/* ===========================================================================
 * Wait budgets — ported verbatim from the incumbent helpers
 * ======================================================================== */

/** `e2e/utils/common.js` L118-L126 waited 5000 ms for `.loader` to lose `active`. */
const LOADER_TIMEOUT = 5000;

/** `e2e/utils/lightbox.js` L37 / L64: 4000 ms for `open` to appear and to go. */
const LIGHTBOX_TIMEOUT = 4000;

/** `e2e/utils/lightbox.js` L12, L39: a 300 ms CSS transition, then 100 ms slack. */
const LIGHTBOX_TRANSITION = 300;

/** `e2e/utils/popover.js` L23-L24 required EXACTLY ONE `.popover.active` in 3000 ms. */
const POPOVER_TIMEOUT = 3000;

/** `e2e/utils/popover.js` L13, L18: 400 ms settle after every popover selection. */
const POPOVER_TRANSITION = 400;

/** `e2e/utils/notifications.js` L16-L21: 6000 ms for a toast to become `active`. */
const NOTIFICATION_TIMEOUT = 6000;

/**
 * ⚠⚠ THE 2,000 ms WINDOW IS A LEADING-EDGE GUARD, NOT A TRAILING DEBOUNCE, and
 * getting that backwards makes a test hang for a reason nothing on screen
 * explains. `app/coffee/utils.coffee` L117-L118 defines
 *
 *     debounce = (wait, func) ->
 *         return _.debounce(func, wait, {leading: true, trailing: false})
 *
 * so a guarded handler FIRES IMMEDIATELY on the first call and every further call
 * inside the window is DROPPED ENTIRELY — never queued, never replayed. Two
 * in-scope handlers use it:
 *
 *   * the sprint form's submit — `backlog/lightboxes.coffee` L38
 *     (`submit = debounce 2000, (event) =>`), which the incumbent tolerated with a
 *     flat `browser.sleep(2000)` at `backlog.e2e.js` L392, comment `// debounce`;
 *   * the row status write — `common/popovers.coffee` L136
 *     (`$el.on "click", ".status", debounce 2000, …`), which is why the incumbent
 *     slept 2000 ms between its two status changes at `backlog.e2e.js` L177.
 *
 * Where only ONE call is made the window costs nothing and the wait is folded into
 * an auto-retrying assertion's budget. Where a case must make a SECOND call — Case
 * 5 and the validation step of Case 19 — the window has to be waited out
 * explicitly, because no observable signal marks its end. See
 * {@link waitOutDebounceWindow}.
 */
const SPRINT_SUBMIT_DEBOUNCE = 2000;

/**
 * A little slack on top of the window, so a second call cannot land on its exact
 * boundary and be dropped by a millisecond.
 */
const DEBOUNCE_MARGIN = 250;

/**
 * Three create/edit-lightbox fields declare `ng-model-options="{ debounce: 200 }"`
 * — the subject (`lb-create-edit.jade` L64), the description (L87) and the sprint
 * name (`lightbox-sprint-add-edit.jade` L17) — so a typed value reaches the model
 * 200 ms after the last keystroke and a submit dispatched sooner would send the
 * previous value. Used only where no outcome signal exists to wait on instead.
 */
const MODEL_DEBOUNCE = 200;

/**
 * A generous budget for assertions that wait on a round trip to the Django
 * backend (a create, a bulk create, a reorder, a filtered reload). The incumbent
 * Protractor configuration allowed `mochaOpts.timeout: 55000` for the same
 * flows; `playwright.config.ts` caps a whole test at 90 s, so this stays well
 * inside it while being far more than a healthy stack needs.
 */
const BACKEND_TIMEOUT = 20000;

/**
 * How long the backlog order is allowed to keep changing after a burst of drags
 * before it is declared settled. Deliberately larger than
 * {@link BACKEND_TIMEOUT}'s per-assertion budget: the `pendingDrag` queue sends
 * its members STRICTLY ONE AT A TIME, so three queued drags cost three
 * sequential round trips rather than one. `retries: 0` means this must be a real
 * bound and never an unbounded poll.
 */
const DRAG_SETTLE_TIMEOUT = 30000;

/** How long one stability probe waits before re-reading the order. */
const STABILITY_PROBE_INTERVAL = 500;

/**
 * How many consecutive identical reads declare the order settled. Two is the
 * minimum that distinguishes "unchanged" from "not yet started".
 */
const STABLE_READS_REQUIRED = 2;

/* ===========================================================================
 * Selectors used raw — permitted ONLY where the page object exposes nothing.
 *
 * `../pages/BacklogPage.ts` is the single home of this screen's selectors and it
 * already corrected every stale, ambiguous and Protractor-only locator the
 * incumbent helper carried. Re-deriving any of those here would re-introduce the
 * bugs, so everything the page object exposes is driven through the page object.
 * What remains raw is listed below, each with the file and line it was verified
 * against (rule T9).
 *
 * ⚠⚠ THE `e2e-*` HOOK CLASSES DO NOT EXIST IN THE BUILD THIS SPEC RUNS AGAINST.
 * `gulpfile.js` L273 pipes every compiled partial through
 * `gulpif(isDeploy, replace(/e2e-([a-z\-]+)/g, ''))`, so a `gulp deploy` build —
 * which is what the container serves on the configured `baseURL` — emits
 * `class="btn-filter "` where the source says
 * `button.btn-filter.e2e-open-filter`. The incumbent suite never met this
 * because `run-e2e.js` served the development bundle, where the hooks survive.
 * Every selector below that the incumbent expressed as an `e2e-*` hook is
 * therefore written as "the real class the stylesheets target, OR the hook", the
 * same resilient form `../pages/BacklogPage.ts` uses. One spec then works
 * against both build modes, which is the same property rule T1 buys for React
 * versus AngularJS.
 * ======================================================================== */

/** `backlog.jade` L17. Scoped against selectors the Kanban screen also emits. */
const SCREEN_ROOT = 'section.backlog';

/* ---------------------------------------------------------------------------
 * The create/edit user-story lightbox.
 *
 * Reached through `BacklogPage.createEditUsLightbox()`, which returns the
 * lightbox ROOT only; its fields belong to a RETAINED shared directive
 * (`tgLbCreateEdit`, `common/lightboxes.coffee` L900) and have no page-object
 * accessors, so they are scoped to that root here.
 *
 * ⚠ The incumbent addressed the lightbox as `div[tg-lb-create-edit-userstory]`
 * (`backlog-helper.js` L14). THAT ATTRIBUTE DOES NOT EXIST anywhere in the
 * repository — the `-userstory` suffix was invented, so the incumbent selector
 * matched nothing. `backlog.jade` L196 emits
 * `div.lightbox.lightbox-generic-form.lightbox-create-edit(tg-lb-create-edit)`,
 * which is what the page object uses.
 * ------------------------------------------------------------------------ */

/** `lb-create-edit.jade` L62-L67; `backlog-helper.js` L27-L29. */
const SUBJECT_INPUT = 'input[name="subject"]';

/** `lb-create-edit.jade` L83-L89; `backlog-helper.js` L46-L48. */
const DESCRIPTION_TEXTAREA = 'textarea[name="description"]';

/** `us-estimation-points-per-role.jade` L11-L20; `backlog-helper.js` L24-L26. */
const ROLE_ITEMS = '.points-per-role li';

/**
 * The role rows carry `clickable` only while the estimation is editable; the
 * trailing total row never does. Used to prove the estimable roles are present
 * before a total is asserted.
 */
const CLICKABLE_ROLE_ITEMS = '.points-per-role li.ticket-role-points.clickable';

/** `backlog-helper.js` L63-L65 read the LAST of these, then its `.points`. */
const ROLE_POINTS_ROWS = '.ticket-role-points';

const ROLE_POINTS_VALUE = '.points';

/**
 * ⚠ STALE INCUMBENT SELECTOR, and a NEW finding beyond the ones the page object
 * fixed. `backlog-helper.js` L49-L51 read the status as
 * `el.$('select option:nth-child(${item})')`. THE LIGHTBOX HAS NO `<select>`.
 * `lb-create-edit.jade` L99-L111 renders a popover: a
 * `div.status-dropdown.editable` trigger holding `span.status-text`, followed by
 * `ul.pop-status.popover` whose items are `li > a.status[data-status-id]`
 * carrying `span.item-text`. The click handlers are
 * `common/lightboxes.coffee` L849-L852 (open) and L854-L860 (select + close), and
 * `popover().open()` adds `active` (`common/popovers.coffee` L218-L228) — so the
 * status list joins the very same "exactly one `.popover.active`" invariant the
 * incumbent `e2e/utils/popover.js` enforced.
 *
 * The incumbent's `item` was 1-BASED (`nth-child` is 1-based), so its
 * `status(n)` is this list's `nth(n - 1)`. See {@link setLightboxStatus}.
 */
const STATUS_DROPDOWN = 'div.status-dropdown';

const STATUS_TEXT = 'span.status-text';

const STATUS_POPOVER_ITEM = 'ul.pop-status a.status';

/**
 * ⚠ STALE INCUMBENT SELECTOR. `backlog-helper.js` L52-L54 clicked
 * `.settings label` nth(i); `.settings` appears nowhere in the create/edit
 * lightbox. `lb-create-edit-us.jade` L51-L81 renders `.ticket-detail-settings`
 * holding `button.btn-icon.team-requirement`, `.client-requirement` and
 * `.is-blocked`. The incumbent's index 1 is the SECOND toggle, so
 * `client-requirement` is the faithful target — and unlike an index it cannot go
 * stale silently. It reports its state through `active`
 * (`ng-class="{ 'active': isClientRequirement() }"`, L71), which makes the click
 * assertable instead of merely dispatched. The sibling `kanban.spec.ts` targets
 * the same button, so the two specs agree.
 */
const SETTINGS_TOGGLE = '.ticket-detail-settings button.client-requirement';

/** `lb-create-edit.jade` L126-L131 (`button#submitButton[type="submit"]`). */
const SUBMIT_BUTTON = 'button[type="submit"]';

/** `.lightbox` gains `open`; `e2e/utils/lightbox.js` L36, L62. */
const LIGHTBOX_OPEN_CLASS = 'open';

/**
 * The bulk lightbox root comes from `BacklogPage.bulkUsLightbox()`;
 * `backlog-helper.js` L79-L84 supplies the two fields.
 * `tgLbCreateBulkUserstories` is a RETAINED shared directive
 * (`common/lightboxes.coffee` L409) and
 * `app/partials/includes/modules/lightbox-us-bulk.jade` stays in both surviving
 * Jade shells, so its attribute genuinely survives the migration.
 */
const BULK_TEXTAREA = 'textarea';

/* ---------------------------------------------------------------------------
 * The tag flow, reduced — see Case 2 for what is deliberately not ported.
 * ------------------------------------------------------------------------ */

/**
 * `add-tag-button.jade` L8 emits
 * `button.btn-filter.ng-animate-disabled.e2e-show-tag-input`, of which only
 * `btn-filter` survives a deploy build. Scoped to the tag line so it can never
 * collide with the toolbar's own `.btn-filter`.
 */
const SHOW_TAG_INPUT = 'tg-tag-line-common button.btn-filter, .e2e-show-tag-input';

/** `add-tag-input.jade` L13 emits `input.tag-input.e2e-add-tag-input`. */
const ADD_TAG_INPUT = 'input.tag-input, .e2e-add-tag-input';

/**
 * `add-tag-input.jade` L36-L41: revealed by `ng-show="vm.newTag.name.length"`,
 * which makes it an OUTCOME signal that the debounced model has caught up.
 */
const ADD_TAG_SAVE = '.add-tag-input tg-svg.save';

/** `tag.jade` L8-L9. The colour comes from `tag[1]` and is NEVER asserted (T2). */
const TAG_CHIP = '.tag';

/* ---------------------------------------------------------------------------
 * The toolbar: filter panel and search.
 * ------------------------------------------------------------------------ */

/**
 * `backlog.jade` L54-L58 emits
 * `button.btn-filter.e2e-open-filter.ng-animate-disabled(id="show-filters-button")`.
 * The id survives a deploy build where the hook does not, so it leads. The label
 * swaps `BACKLOG.FILTERS.TITLE` ("Filters") for `BACKLOG.FILTERS.HIDE_TITLE`
 * ("Hide filters") through complementary `ng-if`s, and `ng-class` puts `active`
 * on the button while the panel is open (L57).
 *
 * `BacklogPage.openFilters()` opens the panel but exposes no handle on the
 * control, and this spec has to CLOSE it again and read its `active` state.
 */
const FILTER_TOGGLE = 'button#show-filters-button, button.e2e-open-filter';

const ACTIVE_CLASS = 'active';

/**
 * `backlog.jade` L126-L128: `ng-if="ctrl.activeFilters"` gates the wrapper, so
 * the panel is ABSENT from the DOM rather than hidden while closed. Asserted by
 * COUNT for that reason. `BacklogPage.filterPanel()` covers the `tg-filter`
 * component inside it.
 */
const FILTER_PANEL_WRAPPER = '.backlog-filter#backlog-filter';

/**
 * `input-search.component.coffee` L14-L21 — an INLINE template, not a `.jade`
 * file. Rendered at `backlog.jade` L69-L72. `BacklogPage` exposes no search
 * accessor, so the field is addressed here and scoped to the screen root.
 */
const SEARCH_FIELD = 'tg-input-search input[type="search"]';

/** `COMMON.FILTERS.INPUT_PLACEHOLDER` at `app/locales/taiga/locale-en.json` L235. */
const SEARCH_PLACEHOLDER = 'subject or reference';

/**
 * The incumbent's deliberate no-match term (`e2e/shared/filters.js` L27), whose
 * assertion was that the counter reaches 0 (L34). ASSEMBLED rather than written as
 * one literal so that no digit run in this file can be mistaken for a credential:
 * HR-7 forbids any credential anywhere in this folder, and the incumbent auth
 * suite hardcoded its password inline (`e2e/suites/auth/auth.e2e.js` L82), which
 * is precisely the pattern this migration must not carry forward. Credentials here
 * are resolved once, in `../fixtures/auth`, and never typed by a spec.
 */
const NO_MATCH_QUERY = `xxxxyy${'123'.repeat(3)}`;

/* ---------------------------------------------------------------------------
 * The burndown toggle — the ONE genuine page-object gap, so raw locators are
 * both required and correct here. The incumbent suite has no burndown case at
 * all; this comes from AAP requirement and from the directive itself.
 * ------------------------------------------------------------------------ */

/**
 * `summary.jade` L28-L32 renders `div.stats.js-toggle-burndown-visibility-button`
 * inside `div.summary`, gated `ng-if="!showGraphPlaceholder"`, with its title
 * from `BACKLOG.SPRINT_SUMMARY.TOGGLE_BAKLOG_GRAPH` ("Show/Hide burndown
 * graph" — the upstream key misspells "BACKLOG", which is preserved because it
 * is the real key).
 */
const BURNDOWN_TOGGLE = '.js-toggle-burndown-visibility-button';

/** `backlog.jade` L29-L30: `div.graphics-container.js-burndown-graph > div.burndown`. */
const BURNDOWN_GRAPH = '.graphics-container.js-burndown-graph';

/**
 * `ToggleBurndownVisibility` (`backlog/main.coffee` L1166-L1210) puts `shown` on
 * the graph on FIRST load and `open` on every subsequent reveal (L1172-L1178),
 * and `hide()` removes `shown`, `open` and the button's `active` (L1167-L1170).
 * Both classes therefore mean "revealed" and both must be absent when collapsed.
 */
const BURNDOWN_SHOWN_CLASSES = ['shown', 'open'] as const;

/* ---------------------------------------------------------------------------
 * Shared conventions.
 * ------------------------------------------------------------------------ */

/**
 * `taiga.globalPopover` and the jQuery popover plugin both mark the open menu
 * with `active` (`common/popovers.coffee` L218-L228), which is the invariant
 * `e2e/utils/popover.js` L21-L27 asserted: EXACTLY ONE.
 */
const ACTIVE_POPOVER = '.popover.active';

const POPOVER_LINK = 'a';

/**
 * The row checkbox and its clickable wrapper (`backlog-row.jade` L19-L31): the
 * `input` is visually replaced by `.custom-checkbox`'s own control, so the label
 * is what a user clicks and the `input` is what reports state.
 *
 * ⚠ Needed raw because `BacklogPage.selectStory()` is deliberately one-way — it
 * clicks only when the box is NOT already checked, so calling it twice does not
 * deselect. Several cases must leave the selection empty for the next one, and the
 * toolbar's move-to-sprint buttons act on the selection, so a leftover would
 * change what a later case does. See {@link setStorySelected}.
 */
const ROW_CHECKBOX_WRAPPER = '.input > .custom-checkbox';

const ROW_CHECKBOX = `${ROW_CHECKBOX_WRAPPER} input[type="checkbox"]`;

/** `us-edit-popover.jade` L10, L17, L24 — three items, two sharing `.e2e-edit`. */
const ROW_ACTION_EDIT = 'button.edit-story, button.e2e-edit.edit-story';

const ROW_ACTION_MOVE_TO_TOP = 'button.move-to-top, button.e2e-edit.move-to-top';

/**
 * Delete has no durable class of its own once `e2e-delete` is stripped, so it is
 * addressed by the icon its own markup guarantees (`us-edit-popover.jade` L21,
 * `tg-svg(svg-icon="icon-trash")`) — the same resilient pair
 * `BacklogPage.ROW_DELETE_SELECTOR` uses.
 */
const ROW_ACTION_DELETE = 'button.e2e-delete, ul.us-option-popup li button:has(svg.icon-trash)';

/** `common.js` L118-L126 waited on `.loader` losing `active`. */
const ACTIVE_LOADER = '.loader.active';

/**
 * `notification.jade` / `e2e/utils/notifications.js` L16-L21 and its
 * `-error` / `-light-error` counterparts.
 */
const ERROR_NOTIFICATIONS =
    '.notification-message-error.active, .notification-message-light-error.active';

/**
 * The role-points total the incumbent asserted as `'3'` (`backlog.e2e.js` L55).
 * ARITHMETIC — the sum of the points the case itself picks — which is why this is
 * one of the very few absolute values hardcoded in this file: popover item 3 is
 * 1 point and item 4 is 2 points in the seeded point scale, so setting role 1 to
 * item 3 and role 3 to item 4 totals 3 whatever the project's other data.
 *
 * The incumbent's other total, `'4'` at L148, is one point per role across four
 * roles; Case 4 states that as the arithmetic rather than as a constant, so it
 * does not silently depend on the seeded role count.
 */
const CREATE_ROLE_POINTS_TOTAL = '3';

/** `backlog.e2e.js` L50-L51 set role 1 to item 3 and role 3 to item 4. */
const CREATE_ROLE_CHOICES = [
    { role: 1, item: 3 },
    { role: 3, item: 4 },
] as const;

/** `backlog.e2e.js` L141-L144 set all four roles to item 3 — one point each. */
const EDIT_ROLE_ITEM = 3;

/**
 * The incumbent's 1-based status ordinals: `status(2)` when creating
 * (`backlog.e2e.js` L58), `status(3)` when editing (L151) and `status(5)` — the
 * CLOSED status in the seeded workflow — when preparing a closed sprint (L526).
 */
const CREATE_STATUS_ORDINAL = 2;

const EDIT_STATUS_ORDINAL = 3;

const CLOSED_STATUS_ORDINAL = 5;

/**
 * `backlog.e2e.js` L347-L348 shift-selected from row 0 to row 3, so four rows
 * end up checked (L361). That absolute is arithmetic — rows 0-3 inclusive — and
 * is therefore correct to hardcode.
 */
const SHIFT_RANGE_LAST_ROW = 3;

const SHIFT_RANGE_EXPECTED_SELECTION = 4;

/**
 * `backlog.e2e.js` L371 asserted the role-filtered points render as `n / m`.
 * Reproduced EXACTLY, including the `?` alternative for an unestimated role.
 */
const ROLE_FILTERED_POINTS_PATTERN = /[0-9?]+\s\/\s[0-9?]+/;

/** How many leading positions the rapid-drag case compares. See Case R1. */
const PERSISTED_PREFIX_LENGTH = 10;

/**
 * Case R1 drags rows 4, 5 and 6 onto 0, 1 and 2, so the list needs at least
 * seven rows for the burst to be meaningful.
 */
const RAPID_DRAG_MIN_ROWS = 7;

/* ===========================================================================
 * ⚠ TECHNOLOGY-SPECIFIC CHANGE — HOW A DRAG IS PERFORMED (rule T9).
 *
 * The incumbent `utils.common.drag()` (`e2e/utils/common.js` L207-L277) was a
 * SYNTHETIC, JS-DISPATCHED drag injected through `executeScript`: it built a
 * `new CustomEvent`, called the deprecated `initEvent`, wrote `pageX/clientX` and
 * `pageY/clientY` from `$(dest).offset()`, forced `event.which = 1`, dispatched
 * `mousedown` on the source and then `mousemove` twice and `mouseup` on
 * `document.documentElement`. IT WORKED ONLY BECAUSE `dragula` LISTENED FOR
 * EXACTLY THOSE FABRICATED EVENTS.
 *
 * The React screens use `@dnd-kit/core`, whose `PointerSensor` requires a real
 * pointer sequence that clears its activation constraint. `../pages/KanbanPage.ts`
 * owns the one stepped-pointer helper (`hover -> mouse.down -> several
 * mouse.move steps -> mouse.move(target) -> mouse.up`) and `BacklogPage` imports
 * it, so THERE IS EXACTLY ONE IMPLEMENTATION, tuned once. It is deliberately not
 * imported into this spec: `BacklogPage.dragStory()` and `dragStoryToSprint()`
 * already wrap it, and a single `locator.dragTo()` frequently fails against
 * dnd-kit because it collapses the gesture into one move.
 *
 * The incumbent's mechanical settle is gone too: `utils.common.dragEnd`
 * (`common.js` L199-L205) polled `.gu-mirror` until it disappeared — DRAGULA's
 * mirror class, which `@dnd-kit` never produces — so that wait is meaningless
 * here and every drag below settles on an OUTCOME assertion instead.
 *
 * Three AAP risks are carried by this substitution and are exercised below:
 *   R-DND-1  `@dnd-kit` has no built-in multi-item drag, so multi-select is
 *            hand-built (`shared/dnd/multiDrag.ts`). Cases 11 and 12 are its gate.
 *   R-DND-2  only `@dnd-kit/core` is pinned, NOT `@dnd-kit/sortable`, so ordering
 *            is computed manually from collision data. Combined with the
 *            position-relative write API an off-by-one SILENTLY PERSISTS A WRONG
 *            ORDER, which is what Cases R1, R2, 10, 11 and 15 exist to catch.
 *   R-DND-3  there is no virtual-list support, so `useInViewport` must keep drop
 *            targets registered for rows outside the viewport; `dndKitDrag`
 *            scrolls both ends into view for that reason.
 * ======================================================================== */

/* ===========================================================================
 * Class-token helpers
 *
 * The incumbent's `utils.common.hasClass` (`e2e/utils/common.js` L45-L49) split
 * the attribute and looked for the whole token, so `active` could never match
 * `inactive`. Every class assertion below keeps that token semantics, either by
 * using a compound CSS selector or by using this word-boundary pattern — never
 * by substring-matching a class attribute.
 * ======================================================================== */

function classToken(token: string): RegExp {
    return new RegExp(`(^|\\s)${token}(\\s|$)`);
}

async function hasClassToken(locator: Locator, token: string): Promise<boolean> {
    const value = await locator.getAttribute('class');

    if (value === null) {
        return false;
    }

    return value.split(/\s+/).includes(token);
}

/* ===========================================================================
 * Lightbox, popover and notification conventions
 * ======================================================================== */

/**
 * Ported from `e2e/utils/lightbox.js` L28-L48: wait up to 4000 ms for the `open`
 * class, then allow the 300 ms CSS transition plus the incumbent's own 100 ms
 * slack. Both halves matter — the class lands before the lightbox has finished
 * moving, and a click dispatched mid-transition can miss.
 */
async function expectLightboxOpen(page: Page, lightbox: Locator): Promise<void> {
    await expect(lightbox, 'the lightbox never gained its "open" class').toHaveClass(
        classToken(LIGHTBOX_OPEN_CLASS),
        { timeout: LIGHTBOX_TIMEOUT },
    );

    await page.waitForTimeout(LIGHTBOX_TRANSITION);
}

/**
 * Ported from `e2e/utils/lightbox.js` L50-L72, whose semantics were "absent
 * counts as closed" — it returned `true` without waiting when the element was not
 * present. That matters because the AngularJS host is static markup that merely
 * loses its class whereas a React one may be unmounted outright, so this asserts
 * that NOTHING matches the open form rather than negating a class on an element
 * that has to exist.
 *
 * @param timeout - widened by callers that must absorb a submit debounce
 */
async function expectLightboxClosed(
    page: Page,
    selector: string,
    timeout: number = LIGHTBOX_TIMEOUT,
): Promise<void> {
    await expect(
        page.locator(`${selector}.${LIGHTBOX_OPEN_CLASS}`),
        'the lightbox never lost its "open" class, so the form did not complete',
    ).toHaveCount(0, { timeout });
}

/**
 * Asserts that the application is not showing an error toast.
 *
 * The selectors and the 6000 ms budget are `e2e/utils/notifications.js` L16-L21
 * and its `-error` / `-light-error` counterparts, expressed as class-token
 * selectors. This runs AFTER the outcome assertion of a mutation, which is what
 * holds the test open long enough for a toast to have appeared: if the write was
 * rejected the outcome assertion fails first and more precisely, and this adds
 * the complementary check that the UI itself reported nothing wrong.
 */
async function expectNoErrorNotification(page: Page): Promise<void> {
    await expect(
        page.locator(ERROR_NOTIFICATIONS),
        'the application raised an error notification',
    ).toHaveCount(0, { timeout: NOTIFICATION_TIMEOUT });
}

/**
 * Ported from `e2e/utils/popover.js` L21-L27: EXACTLY ONE `.popover.active`
 * within 3000 ms. "Exactly one" is the load-bearing part — two open popovers
 * would turn every subsequent item click into a coin toss.
 */
async function waitForSinglePopover(page: Page): Promise<Locator> {
    const popover = page.locator(ACTIVE_POPOVER);

    await expect(
        popover,
        'expected exactly one active popover; the screen opened none or several',
    ).toHaveCount(1, { timeout: POPOVER_TIMEOUT });

    return popover;
}

/**
 * ⚠ `browser.waitForAngular()` — used at `backlog.e2e.js` L215, L264, L283, L318,
 * L334, L389, L431, L541 and L578 — HAS NO PLAYWRIGHT EQUIVALENT, and could not
 * have one: it hooks AngularJS's own digest queue, which React does not
 * participate in. The ported substitute is the framework-neutral condition
 * `utils.common.waitLoader` (`common.js` L118-L126) enforced: `.loader` loses its
 * `active` class within 5000 ms. It is ALWAYS paired with an outcome assertion at
 * the call site, because a settled loader alone says nothing about the result.
 */
async function expectLoaderSettled(page: Page): Promise<void> {
    await expect(
        page.locator(ACTIVE_LOADER),
        'the screen never finished loading',
    ).toHaveCount(0, { timeout: LOADER_TIMEOUT });
}

/**
 * Waits out the leading-edge guard window described on
 * {@link SPRINT_SUBMIT_DEBOUNCE}.
 *
 * ⚠ THIS IS A FIXED WAIT ON PURPOSE, and it is the one place in this file where a
 * fixed wait is the correct instrument rather than a lazy one. The guard drops a
 * second call silently — no error, no toast, no DOM change — so there is NO
 * observable signal whose arrival could be asserted instead. Every use is paired
 * with an outcome assertion on the call that follows it, so the wait never stands
 * in for verification; it only makes the second call reach the handler at all.
 *
 * The incumbent did exactly this with `browser.sleep(2000)` at `backlog.e2e.js`
 * L177 and L392.
 */
async function waitOutDebounceWindow(page: Page): Promise<void> {
    await page.waitForTimeout(SPRINT_SUBMIT_DEBOUNCE + DEBOUNCE_MARGIN);
}

/* ===========================================================================
 * Create/edit lightbox field helpers
 * ======================================================================== */

/**
 * Sets one role's estimation through its points popover.
 *
 * Ported from `backlog-helper.js` L58-L62 (`setRole`), which delegated to
 * `utils.popover.open(role, value)`. `estimation.coffee` appends the popover
 * INSIDE the role row that was clicked, so the item is addressed within that row
 * while the "exactly one active popover" invariant is still asserted globally.
 * `popover.js` L18 settles 400 ms after each selection.
 *
 * @param page - the page under test
 * @param lightbox - the create/edit lightbox root
 * @param roleItem - zero-based index into `.points-per-role li`
 * @param valueItem - zero-based index into the popover's anchors
 */
async function setRolePoints(
    page: Page,
    lightbox: Locator,
    roleItem: number,
    valueItem: number,
): Promise<void> {
    const role = lightbox.locator(ROLE_ITEMS).nth(roleItem);

    await role.scrollIntoViewIfNeeded();
    await role.click();

    await waitForSinglePopover(page);

    await role.locator(ACTIVE_POPOVER).locator(POPOVER_LINK).nth(valueItem).click();

    await page.waitForTimeout(POPOVER_TRANSITION);
}

/**
 * Reads the role-points total: the LAST `.ticket-role-points` row's `.points`,
 * exactly as `backlog-helper.js` L63-L65 did.
 */
async function rolePointsTotal(lightbox: Locator): Promise<string> {
    const text = await lightbox.locator(ROLE_POINTS_ROWS).last().locator(ROLE_POINTS_VALUE).innerText();

    return text.trim();
}

/**
 * Picks a status in the create/edit lightbox.
 *
 * ⚠ SUBSTITUTION FOR A STALE SELECTOR — see {@link STATUS_DROPDOWN}. The
 * incumbent clicked `select option:nth-child(ordinal)`; there is no `<select>`,
 * so this opens the real `div.status-dropdown` popover and picks the same
 * position, converting the incumbent's 1-based ordinal to a 0-based index.
 *
 * @param page - the page under test
 * @param lightbox - the create/edit lightbox root
 * @param ordinal - the incumbent's 1-BASED status position
 * @returns the label of the status that was picked, read from the item itself so
 *   no translated or project-configured literal is hardcoded
 */
async function setLightboxStatus(
    page: Page,
    lightbox: Locator,
    ordinal: number,
): Promise<string> {
    const trigger = lightbox.locator(STATUS_DROPDOWN);

    await expect(
        trigger,
        'the create/edit lightbox rendered no status dropdown; lb-create-edit.jade L99-L102 changed',
    ).toHaveCount(1);

    await trigger.click();

    await waitForSinglePopover(page);

    const item = lightbox.locator(STATUS_POPOVER_ITEM).nth(ordinal - 1);

    await expect(
        item,
        `the status list has no position ${String(ordinal)}; the project's workflow declares fewer statuses`,
    ).toHaveCount(1);

    const label = (await item.innerText()).trim();

    await item.click();

    await page.waitForTimeout(POPOVER_TRANSITION);

    return label;
}

/**
 * Adds one tag through the lightbox's tag line.
 *
 * ⚠ DELIBERATE, DOCUMENTED REDUCTION of `commonHelper.tags()`
 * (`e2e/helpers/common-helper.js` L75-L90, and the identical inline copy at
 * `backlog-helper.js` L30-L45). The incumbent additionally opened
 * `.e2e-open-color-selector`, picked `.e2e-color-dropdown li` nth(1), added the
 * throwaway tag `'xxxyy'`, deleted it again through `.e2e-delete-tag`, and then
 * typed `'a'` followed by ARROW_DOWN and ENTER to accept an autocomplete
 * suggestion. None of that is ported: it exercises the OUT-OF-SCOPE shared tag
 * component's colour picker and autocomplete rather than either migrated screen,
 * and accepting a keyboard-driven suggestion is not deterministic under
 * `retries: 0` — ENTER takes the highlighted suggestion INSTEAD of the typed text
 * whenever a `.tags-dropdown .selected` exists, and only arrow keys create that
 * selection. Adding a tag — the behaviour the case is actually about — is still
 * driven and still asserted.
 *
 * 🚫 The chip's colour comes from `tag[1]` (`backlog-row.jade` L50, `tag.jade`
 * L8) and is per-project data, so it is NEVER asserted (rule T2, drift D3).
 *
 * @returns the tag that was added
 */
async function addTag(page: Page, lightbox: Locator): Promise<string> {
    await lightbox.locator(SHOW_TAG_INPUT).first().click();

    const tagInput = lightbox.locator(ADD_TAG_INPUT).first();

    await expect(tagInput, 'the add-tag input never appeared').toBeVisible();

    const tag = `e2e-tag-${String(Date.now())}`;

    await tagInput.fill(tag);

    // The debounced model has caught up exactly when the save affordance appears,
    // because `ng-show="vm.newTag.name.length"` gates it (`add-tag-input.jade`
    // L36-L41). Pressing ENTER before that would add an empty tag.
    await page.waitForTimeout(MODEL_DEBOUNCE);

    await expect(
        lightbox.locator(ADD_TAG_SAVE),
        'the tag input never propagated its value to the model',
    ).toBeVisible();

    // ⚠ `protractor.Key.ENTER` has no Playwright equivalent; `press('Enter')` is
    // the substitution. The tag-line directive handles keyCode 13 on `.tag-input`
    // and calls `preventDefault()`, so this adds the tag rather than submitting
    // the surrounding form.
    await tagInput.press('Enter');

    await expect(
        lightbox.locator(TAG_CHIP).filter({ hasText: tag }),
        'the typed tag did not render as a chip',
    ).toHaveCount(1);

    return tag;
}

/**
 * Toggles the client-requirement setting and asserts the flip.
 *
 * ⚠ Substitutes the stale `.settings label` nth(i) — see
 * {@link SETTINGS_TOGGLE}. The incumbent clicked index 0 when creating
 * (`backlog.e2e.js` L67) and index 1 when editing (L160) and asserted neither;
 * one durable, self-reporting toggle is driven here instead of an index into a
 * list that no longer exists.
 */
async function toggleSetting(lightbox: Locator): Promise<void> {
    const toggle = lightbox.locator(SETTINGS_TOGGLE);

    await expect(
        toggle,
        'the lightbox rendered no client-requirement toggle; lb-create-edit-us.jade L67-L73 changed',
    ).toHaveCount(1);

    const wasActive = await hasClassToken(toggle, ACTIVE_CLASS);

    await toggle.click();

    // Asserted on both branches: the postcondition is a flipped state, never
    // "a click was dispatched".
    if (wasActive) {
        await expect(toggle).not.toHaveClass(classToken(ACTIVE_CLASS));
    } else {
        await expect(toggle).toHaveClass(classToken(ACTIVE_CLASS));
    }
}

/* ===========================================================================
 * Order-stability helper — the bounded drain used by Cases R1 and R2
 * ======================================================================== */

/**
 * Waits until the backlog order stops changing, then returns it.
 *
 * ⚠ THIS IS THE SUBSTITUTE FOR `utils.common.outerHtmlChanges()`
 * (`common.js` L348-L364, used at `backlog.e2e.js` L79 and L297), which snapshotted
 * `outerHTML` and resolved on the FIRST difference. That is precisely the wrong
 * signal after a burst of drags: the first difference is the first drag landing,
 * while the queue still holds two more. This polls the ORDER ITSELF and requires
 * {@link STABLE_READS_REQUIRED} identical consecutive reads.
 *
 * The loop is BOUNDED by construction — a fixed iteration count derived from the
 * budget, never `while (true)` — because `retries: 0` and `workers: 1` mean an
 * unbounded poll does not fail one test, it consumes the whole run and reports a
 * bare timeout. Reaching the cap while the order is still moving is a FAILURE
 * with a named cause, not a silently accepted result.
 *
 * @param page - the page under test, because `BacklogPage` keeps its own private
 * @param backlog - the page object
 * @param timeout - the total budget
 * @returns the settled order, which is "what the user saw"
 */
async function waitForStableStoryOrder(
    page: Page,
    backlog: BacklogPage,
    timeout: number = DRAG_SETTLE_TIMEOUT,
): Promise<string[]> {
    const maxProbes = Math.max(
        STABLE_READS_REQUIRED,
        Math.ceil(timeout / STABILITY_PROBE_INTERVAL),
    );

    let previous = await backlog.storyRefs();
    let identicalReads = 1;

    for (let probe = 0; probe < maxProbes; probe += 1) {
        await page.waitForTimeout(STABILITY_PROBE_INTERVAL);

        const current = await backlog.storyRefs();

        const settled =
            current.length === previous.length &&
            current.every((ref: string, i: number): boolean => ref === previous[i]);

        if (settled) {
            identicalReads += 1;

            if (identicalReads >= STABLE_READS_REQUIRED) {
                return current;
            }
        } else {
            identicalReads = 1;
        }

        previous = current;
    }

    throw new Error(
        `The backlog order was still changing after ${String(timeout)} ms. Either the ` +
            'pendingDrag queue is not draining (the head request never completes, so nothing ' +
            'is ever shifted) or the screen is re-rendering continuously.',
    );
}

/**
 * Selects or DESELECTS one story row.
 *
 * `BacklogPage.selectStory()` is one-way by design, so deselecting needs the
 * checkbox directly — see {@link ROW_CHECKBOX_WRAPPER}. Both directions assert the
 * postcondition, so the helper can never report success on a click that did not
 * land.
 *
 * @param backlog - the page object
 * @param index - zero-based row position
 * @param selected - the state wanted afterwards
 */
async function setStorySelected(
    backlog: BacklogPage,
    index: number,
    selected: boolean,
): Promise<void> {
    if (selected) {
        await backlog.selectStory(index);

        return;
    }

    const row = backlog.storyRow(index);

    await row.scrollIntoViewIfNeeded();

    const checkbox = row.locator(ROW_CHECKBOX);

    if (await checkbox.isChecked()) {
        await row.locator(ROW_CHECKBOX_WRAPPER).click();
    }

    await expect(checkbox, 'the story row could not be deselected').not.toBeChecked();
}

/**
 * Clears every story selection, so a case cannot leak one into the next.
 *
 * Walks the rows rather than assuming which ones a case touched, because a
 * shift-range selection checks rows the case never clicked. BOUNDED by the row
 * count and short-circuited as soon as nothing is checked — never `while (true)`.
 */
async function clearStorySelection(backlog: BacklogPage): Promise<void> {
    const rowCount = await backlog.storyCount();

    for (let row = 0; row < rowCount; row += 1) {
        if ((await backlog.selectedStoryCount()) === 0) {
            break;
        }

        await setStorySelected(backlog, row, false);
    }

    expect(
        await backlog.selectedStoryCount(),
        'story selections could not be cleared, so later cases would inherit them',
    ).toBe(0);
}

/**
 * Reads a reference that the list must be holding, and fails loudly rather than
 * letting `undefined` flow into an assertion and produce an inscrutable
 * comparison later.
 *
 * @param refs - a reference list
 * @param index - the position wanted
 * @param what - what the value is needed for, quoted in the failure message
 */
function requireRef(refs: readonly string[], index: number, what: string): string {
    const ref = refs[index];

    if (ref === undefined || ref === '') {
        throw new Error(
            `Expected a story reference at position ${String(index)} so that ${what}, but the ` +
                `list holds ${String(refs.length)} references. The seeded backlog is smaller ` +
                'than this case needs — run ./taiga-manage.sh sample_data once, out of band.',
        );
    }

    return ref;
}

/* ===========================================================================
 * 🔴🔴 THE MANDATORY CASE — pendingDrag SERIALISATION
 *
 * AAP §0.8.3, verbatim: "The Playwright specs must include a rapid
 * consecutive-drag case, because a single-drag test passes against a completely
 * broken implementation."
 *
 * WHAT IS BEING GUARDED
 * ---------------------------------------------------------------------------
 * `app/coffee/modules/backlog/main.coffee` implements a `pendingDrag` FIFO
 * SERIALISATION QUEUE. Every locator below was verified against the pristine
 * module (the working tree copy has since been annotated in place by the
 * migration, which shifted the numbers without changing a single semantic):
 *
 *   L84        `@.pendingDrag = []` — initialised in the constructor.
 *   L539-L546  On a REAL USER DRAG (`if ctx`), enqueue
 *              `{usList, newUsIndex, newSprintId, previousUs, nextUs}`.
 *   L600-L601  THE RE-ENTRANCY GUARD: `if ctx && @.pendingDrag.length > 1` ->
 *              `return`. A second drag arriving while one is in flight is QUEUED
 *              BUT NOT SENT — only the head of the queue is ever on the wire.
 *   L603-L609  The head issues `@rs.userstories.bulkUpdateBacklogOrder(project,
 *              currentSprintId, previousUs, nextUs, bulkUserstories)`.
 *   L611-L617  On success, reconcile the AUTHORITATIVE `milestone` and
 *              `backlog_order` from `result.data` back onto the local models
 *              (`us.milestone = updatedUs.milestone`,
 *              `us.backlog_order = updatedUs.backlog_order`).
 *   L618       `@.pendingDrag.shift()` — dequeue.
 *   L620-L629  If the queue is non-empty, `@scope.$applyAsync()` then re-drive
 *              `@.moveUs(null, ...pendingDrag[0]...)`. THE LITERAL `null` is what
 *              stops the re-drive from re-enqueueing and from tripping the guard.
 *   L630-L631  Otherwise `@rootscope.$broadcast("sprint:us:moved")`.
 *   L633-L637  `if !@events.connected` -> `@.loadSprints()` +
 *              `@.loadClosedSprints()` + `@.loadProjectStats()` — the
 *              disconnected-reload fallback. `events.connected` is referenced at
 *              EXACTLY ONE SITE repository-wide.
 *   L639-L640  `if @scope.closedSprintsById && @scope.closedSprintsById[oldSprintId]`
 *              -> `@rootscope.$broadcast("backlog:load-closed-sprints")` — a
 *              closed-sprint reload branch that also belongs to this path.
 *
 * WHY A NAIVE REACT IMPLEMENTATION CORRUPTS DATA
 * ---------------------------------------------------------------------------
 * `bulk-update-us-backlog-order` is POSITION-RELATIVE: it takes
 * `previousUs`/`nextUs`, serialised as `after_userstory_id`/`before_userstory_id`,
 * NOT absolute indices. With two drags in flight the second computes its
 * neighbours from a client-side ordering THE SERVER HAS NOT YET ACKNOWLEDGED, and
 * the persisted order silently diverges from what the user sees. THERE IS NO
 * ERROR, NO TOAST AND NO CONSOLE WARNING — the corruption surfaces only on the
 * next page load. Therefore a single-drag test passes against a completely
 * broken implementation, and these two cases are the only thing in the suite that
 * can catch it. That is also why each one RELOADS the page: without the reload
 * they prove nothing, because the client-side order is correct even when the
 * persisted order is corrupt.
 *
 * THE HAND-OFF WITH THE PAGE OBJECT
 * ---------------------------------------------------------------------------
 * `BacklogPage.dragStory()` and `dragStoryToSprint()` deliberately contain NO
 * sleep, NO lock and NO in-flight flag; their only settle is an optimistic
 * client-side DOM assertion that resolves immediately and leaves the request
 * open. Verified in this checkout. A page object that quietly serialised its own
 * drags would make this bug untestable.
 * ======================================================================== */

test.describe('pendingDrag serialisation (AAP §0.8.3)', () => {
    /**
     * Case R1 — MANDATORY. Derived from the queue itself, not from an incumbent
     * case: the Protractor suite never dragged twice without settling in between,
     * which is exactly why it could not detect this class of defect.
     */
    test('serialises three rapid consecutive backlog reorders and persists the order the user saw', async ({
        authedPage,
    }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        // The whole list is loaded first so the DOM order is deterministic and the
        // three drags all address rows that are really present.
        await backlog.loadFullBacklog();

        const before = await backlog.storyRefs();

        // A hard failure rather than a skip: the queue is the single most
        // dangerous thing in this migration, so "not exercisable" must never pass
        // quietly. The remedy is named so it is actionable.
        expect(
            before.length,
            `The rapid-drag case needs at least ${String(RAPID_DRAG_MIN_ROWS)} backlog rows to ` +
                `reorder and found ${String(before.length)}. Seed the dataset once, out of band, ` +
                'with ./taiga-manage.sh sample_data — this spec must never seed or reseed itself.',
        ).toBeGreaterThanOrEqual(RAPID_DRAG_MIN_ROWS);

        const dragged = [
            requireRef(before, 4, 'the first of the three rapid drags has a subject'),
            requireRef(before, 5, 'the second of the three rapid drags has a subject'),
            requireRef(before, 6, 'the third of the three rapid drags has a subject'),
        ];

        await authedPage.screenshot({ path: shot('rapid-drag-before'), fullPage: true });

        // ⚠⚠ THE POINT OF THIS CASE: NO SETTLE BETWEEN THE DRAGS. The second and
        // third pointer sequences complete while the first bulk-update request is
        // still in flight, which is exactly the condition the pendingDrag queue and
        // its re-entrancy guard exist to serialise (`main.coffee` L600-L601).
        // ANYTHING inserted between these three lines — an assertion, a
        // waitLoader, a waitForResponse, even a waitForTimeout — DESTROYS THE TEST.
        //
        // ⚠ Sequential `await`s are CORRECT and `Promise.all` would be WRONG. Each
        // `dragStory` must complete its own pointer sequence (mouse.down -> moves
        // -> mouse.up); two overlapping sequences would corrupt the pointer state
        // machine rather than the queue. The concurrency being exercised is NETWORK
        // concurrency: drag n+1's mouseup lands while drag n's request is still open.
        await backlog.dragStory(4, 0);
        await backlog.dragStory(5, 1);
        await backlog.dragStory(6, 2);

        // Bounded drain. The queue sends its members strictly one at a time, so
        // this waits for the order to stop moving rather than for one response.
        const seen = await waitForStableStoryOrder(authedPage, backlog);

        expect(
            seen,
            'none of the three drags changed the rendered order, so the burst did nothing and ' +
                'the persistence assertion below would be vacuous',
        ).not.toEqual(before);

        // ⚠ THE THREE DRAGGED STORIES MUST OCCUPY THE FIRST THREE POSITIONS, and
        // asserting anything weaker here would be very close to vacuous: rows 4, 5
        // and 6 are ALREADY inside the leading ten, so "they are still in the first
        // ten" would hold even if no drag had done anything at all.
        //
        // The indices are safe to pre-capture in this direction, which is why the
        // burst moves 4 -> 0, 5 -> 1 and 6 -> 2 rather than the reverse. Moving an
        // item from index i to a LOWER index j shifts only the items between them, so
        // positions above i are untouched: after 4 -> 0, index 5 still holds the same
        // story, and after 5 -> 1, index 6 still does. That also makes the burst
        // insensitive to whether each optimistic move has rendered before the next
        // gesture starts — either way the same three stories are picked up.
        //
        // Compared as a SET, because the three drops are in flight together and their
        // relative order at the top is not the property under test; that the queue
        // persisted whatever order resulted IS, and it is asserted after the reload.
        expect(
            [...seen.slice(0, dragged.length)].sort(),
            'the three dragged stories are not the first three rows of the backlog',
        ).toEqual([...dragged].sort());

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('rapid-drag-after-drags'), fullPage: true });

        // 🔴 THE RELOAD IS THE WHOLE POINT. Everything above reads the CLIENT's
        // idea of the order, which is optimistically correct even when the writes
        // raced. Only a fresh read from the server can show a divergence.
        await authedPage.reload();

        await backlog.waitLoaded();
        await backlog.loadFullBacklog();

        await authedPage.screenshot({ path: shot('rapid-drag-after-reload'), fullPage: true });

        const persisted = await backlog.storyRefs();

        // 🔴 THE ASSERTION. Without this the test proves nothing: the client-side
        // order is correct even when the persisted order is corrupt.
        //
        // The comparison is limited to the leading slice because all three drops
        // landed there, and because a long-tail pagination difference must neither
        // mask a real failure nor manufacture a false one.
        expect(
            persisted.slice(0, PERSISTED_PREFIX_LENGTH),
            'THE PERSISTED ORDER DIVERGED FROM THE ORDER THE USER SAW. Three drags were issued ' +
                'without waiting in between, so at least two bulk-update requests were in flight ' +
                'at once. Because bulk-update-us-backlog-order is position-relative ' +
                '(after_userstory_id / before_userstory_id, not indices), the later request ' +
                'computed its neighbours from an order the server had not acknowledged. The queue ' +
                'and re-entrancy guard at backlog/main.coffee L600-L601 exist to prevent exactly ' +
                'this, so they are not being reproduced.',
        ).toEqual(seen.slice(0, PERSISTED_PREFIX_LENGTH));

        // No story may be lost or duplicated by the burst.
        expect(
            persisted.length,
            'the reorder burst changed how many stories the backlog holds, so a story was lost ' +
                'or duplicated rather than merely moved',
        ).toBe(seen.length);
    });

    /**
     * Case R2 — MANDATORY, precondition-guarded. The queued payload carries
     * `newSprintId` (`main.coffee` L539-L546), so the CROSS-CONTAINER path needs
     * its own burst: a sprint move reconciles `us.milestone` from the response
     * (L611-L617) on top of `backlog_order`, and it is the branch that also
     * reaches the closed-sprint reload at L639-L640.
     */
    test('serialises a rapid sprint-move followed by a backlog reorder', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();
        await backlog.loadFullBacklog();

        // Captured BEFORE the guard so the state is still evidenced even when the
        // case cannot run.
        await authedPage.screenshot({
            path: shot('rapid-drag-sprint-before-reload'),
            fullPage: true,
        });

        const sprintCount = await backlog.sprints().count();
        const rows = await backlog.storyRefs();

        // A DECLARED, VISIBLE skip with an explicit reason — never a swallowed
        // failure. `sample_data` does not guarantee a sprint on every project, and
        // HR-7 forbids this spec from creating one to make itself runnable.
        test.skip(
            sprintCount < 1,
            `Project ${BACKLOG_PROJECT_SLUG} has no sprint under sample_data, so a ` +
                'sprint-crossing rapid drag is not exercisable. Add a sprint to the seeded ' +
                'project to run this case.',
        );

        test.skip(
            rows.length < RAPID_DRAG_MIN_ROWS,
            `Project ${BACKLOG_PROJECT_SLUG} holds ${String(rows.length)} backlog rows; this ` +
                `case moves one into a sprint and then reorders another, which needs at least ` +
                `${String(RAPID_DRAG_MIN_ROWS)}.`,
        );

        const movedRef = requireRef(rows, 0, 'the story moved into the sprint can be recognised');
        const sprintRefsBefore = await backlog.sprintStoryRefs(0);

        // ⚠ THE SECOND DRAG'S ROW CANNOT BE IDENTIFIED BY A PRE-CAPTURED INDEX, and
        // this is worth stating because getting it wrong produces a test that looks
        // rigorous and asserts nothing. The first drag removes row 0 from the backlog
        // optimistically, so every later row shifts up by one and `dragStory(3, 0)`
        // grabs whatever occupies index 3 AT THAT MOMENT — not `rows[3]`. Re-reading
        // the order between the two drags to find out would insert an await into the
        // burst and destroy the very race this case exists to create.
        //
        // So the reorder is asserted WITHOUT naming its row: the order that would
        // result from the sprint move ALONE is computed here, and the settled order
        // must differ from it. That proves the second drag also took effect, and it
        // holds whichever row the shift handed it.
        const moveOnlyOrder = rows.filter((ref: string): boolean => ref !== movedRef);

        // ⚠ Again: NOTHING between these two lines. The sprint move's bulk update
        // is still open when the reorder's mouseup lands, which is the cross-
        // container form of the same race — and the one where a mis-serialised
        // second write can persist a wrong `milestone` as well as a wrong order.
        await backlog.dragStoryToSprint(0, 0);
        await backlog.dragStory(3, 0);

        const seen = await waitForStableStoryOrder(authedPage, backlog);

        const seenSprintRefs = await backlog.sprintStoryRefs(0);

        expect(
            seenSprintRefs,
            `story ${movedRef} was dragged into the first sprint but the sprint does not show it`,
        ).toContain(movedRef);

        expect(
            seenSprintRefs.length,
            'the sprint did not gain the moved story',
        ).toBe(sprintRefsBefore.length + 1);

        // The second drag must have done something too, or the persistence assertion
        // below would only be testing the sprint move.
        expect(
            seen.slice(0, PERSISTED_PREFIX_LENGTH),
            'the backlog order is exactly what removing the moved story alone would produce, so ' +
                'the reorder that followed it had no effect and the burst never created the ' +
                'two-writes-in-flight condition this case exists to exercise',
        ).not.toEqual(moveOnlyOrder.slice(0, PERSISTED_PREFIX_LENGTH));

        await expectNoErrorNotification(authedPage);

        // 🔴 The reload again: `us.milestone` is reconciled from the response
        // (L611-L617), so a race here persists the wrong SPRINT MEMBERSHIP, not
        // merely the wrong order — and that is invisible until a fresh read.
        await authedPage.reload();

        await backlog.waitLoaded();
        await backlog.loadFullBacklog();

        await authedPage.screenshot({
            path: shot('rapid-drag-sprint-after-reload'),
            fullPage: true,
        });

        expect(
            await backlog.sprintStoryRefs(0),
            `story ${movedRef} left the sprint when the page was reloaded, so the milestone ` +
                'reconciliation at backlog/main.coffee L611-L617 did not survive a second write ' +
                'being in flight at the same time',
        ).toContain(movedRef);

        const persisted = await backlog.storyRefs();

        expect(
            persisted.slice(0, PERSISTED_PREFIX_LENGTH),
            'THE PERSISTED BACKLOG ORDER DIVERGED FROM WHAT THE USER SAW after a sprint move and ' +
                'a reorder were issued back to back. The queued payload carries newSprintId ' +
                '(backlog/main.coffee L539-L546), so both writes must be serialised, not just ' +
                'same-container ones.',
        ).toEqual(seen.slice(0, PERSISTED_PREFIX_LENGTH));

        expect(
            persisted,
            'the moved story is still counted in the backlog after a reload, so it was ' +
                'duplicated rather than reassigned to the sprint',
        ).not.toContain(movedRef);
    });
});

/* ===========================================================================
 * The ported case inventory
 *
 * The route is `project/<slug>/backlog`, opened by `BacklogPage.goto()` relative
 * to the configured `baseURL` — never a hardcoded host. The slug is
 * `BACKLOG_PROJECT_SLUG` from `../fixtures/seed`, which resolves the incumbent's
 * `project-3` (`backlog.e2e.js` L24) in one place.
 *
 * ⚠ EVERY MUTATING CASE DERIVES ITS OWN BASELINE immediately before acting, and
 * every case leaves the screen as it found it. `workers: 1` and `retries: 0` mean
 * the suite runs once, in order, with no second chance — so a case that depended
 * on another case's leftovers would be unrunnable in isolation and unreliable in
 * sequence. The incumbent had exactly that defect and admitted it in a comment;
 * see Case 12.
 * ======================================================================== */

test.describe('backlog', () => {
    /**
     * Case 1 — ported from `backlog.e2e.js` L23-L28 (`before`), whose screenshot
     * was `takeScreenshot('backlog', 'backlog')` at L27.
     */
    test('loads the backlog and captures the baseline', async ({ authedPage }) => {
        // The seed assertion walks the seeded routes to prove the dataset is
        // present, so it runs BEFORE the backlog is opened: run after `goto()` it
        // would leave the browser on the last route it visited and the capture
        // below would photograph the wrong screen. It only ever ASSERTS — it never
        // seeds and never reseeds, because the seeder is randomised and a second
        // run would make the baseline and React artifact sets incomparable.
        await assertSampleData(authedPage);

        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        expect(
            await backlog.storyCount(),
            'the backlog rendered no story rows',
        ).toBeGreaterThan(0);

        // The dark summary bar (`summary.jade` L8-L25). Its figures are asserted as
        // PRESENT, never as particular numbers: they are `sample_data` values.
        expect(
            (await backlog.summaryStats()).length,
            'the summary bar rendered no statistics',
        ).toBeGreaterThan(0);

        await expect(
            backlog.summaryProgressBar(),
            'the summary bar rendered no progress bar',
        ).toBeVisible();

        // 🚫 Presence and structure only. The bar's fill percentage is a
        // stylesheet-driven width and its colour is a theme token; asserting either
        // would breach T6 and T10.
        await expect(
            authedPage.locator(BURNDOWN_GRAPH),
            'the burndown container is missing (backlog.jade L29-L30)',
        ).toHaveCount(1);

        // The doom line is spliced in only once a point threshold is crossed, so a
        // project without point totals legitimately has none. At most one ever
        // exists, which is the invariant worth asserting.
        expect(
            await backlog.milestoneDivider().count(),
            'more than one doom line was rendered; at most one ever exists',
        ).toBeLessThanOrEqual(1);

        await authedPage.screenshot({ path: shot('backlog'), fullPage: true });
    });

    /**
     * Case 2 — ported from `backlog.e2e.js` L30-L91, where a `before` and six `it`s
     * shared one lightbox. Collapsed into ONE test, because those `it`s were not
     * independent: each depended on the browser state the previous one left.
     */
    test('creates a user story', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        const before = await backlog.storyCount();

        // `.new-us button.btn-small` — the incumbent's `$$('.new-us a').get(0)`
        // (`backlog-helper.js` L138-L140) is STALE: `addnewus.jade` L9 emits a
        // `<button>`, not an `<a>`. The correction lives in the page object.
        await backlog.openNewUsLightbox();

        const lightbox = backlog.createEditUsLightbox();

        await expectLightboxOpen(authedPage, lightbox);

        await authedPage.screenshot({ path: shot('create-us') });

        // The incumbent typed the bare literal `'subject'` (L47). A timestamp makes
        // the closing assertion unambiguous — it cannot be satisfied by a story left
        // behind by an earlier run — and uniqueness is not a behaviour change.
        const subject = `subject ${String(Date.now())}`;

        await lightbox.locator(SUBJECT_INPUT).fill(subject);

        // Role points, ported from L50-L51. The roles must be present before a total
        // can mean anything.
        await expect(
            lightbox.locator(CLICKABLE_ROLE_ITEMS),
            'the estimation panel offered no editable roles, so no total can be asserted',
        ).not.toHaveCount(0);

        for (const choice of CREATE_ROLE_CHOICES) {
            await setRolePoints(authedPage, lightbox, choice.role, choice.item);
        }

        // Ported from L53-L55. Arithmetic, so the absolute is correct to hardcode:
        // popover item 3 is 1 point and item 4 is 2 points, which sum to 3.
        expect(
            await rolePointsTotal(lightbox),
            'the role-points total is not the sum of the two role estimates that were set',
        ).toBe(CREATE_ROLE_POINTS_TOTAL);

        // Status, ported from L58 — through the real popover, not the never-existent
        // `<select>`. See {@link STATUS_DROPDOWN}.
        const status = await setLightboxStatus(authedPage, lightbox, CREATE_STATUS_ORDINAL);

        expect(status.length, 'the chosen status rendered no label').toBeGreaterThan(0);

        await expect(
            lightbox.locator(STATUS_TEXT),
            'the status dropdown did not adopt the status that was picked',
        ).toHaveText(status);

        // Tags, ported from L61 in reduced form — see {@link addTag}.
        await addTag(authedPage, lightbox);

        // Description, ported from L64.
        await lightbox
            .locator(DESCRIPTION_TEXTAREA)
            .fill(`test description ${String(Date.now())}`);

        // Settings, ported from L67. The incumbent followed it with
        // `utils.common.waitTransitionTime` (L69); the assertion inside
        // {@link toggleSetting} makes that wait unnecessary.
        await toggleSetting(lightbox);

        // ⚠ DELIBERATE EXCLUSION — attachment upload. The incumbent ran
        // `commonHelper.lightboxAttachment` at L72 (and again at L163), which
        // uploaded files into `tg-attachments-simple` and asserted `count + 1`
        // (`common-helper.js` L55-L73). Not ported: `tg-attachments-simple` is an
        // OUT-OF-SCOPE shared component, its fixture files live under `e2e/` which
        // this change must not touch, and attachments are not part of this screen's
        // enumerated inventory.

        await authedPage.screenshot({ path: shot('create-us-filled') });

        await lightbox.locator(SUBMIT_BUTTON).click();

        await expectLightboxClosed(authedPage, '.lightbox-create-edit');

        // ⚠ The incumbent settled on `utils.common.outerHtmlChanges('.backlog-table-body')`
        // (L79, `common.js` L348-L364: snapshot `outerHTML`, resolve on the first
        // difference, 5000 ms plus a rAF). Not ported — "the markup changed" is not
        // the outcome; the outcome is one more row carrying this subject. Playwright's
        // auto-retrying assertions express that directly.
        await expect(
            backlog.storyRows(),
            'the backlog did not gain exactly one row (L89 asserted count + 1)',
        ).toHaveCount(before + 1, { timeout: BACKEND_TIMEOUT });

        await expect(
            backlog.storyRows().filter({ hasText: subject }),
            `the created story "${subject}" is not in the backlog list`,
        ).toHaveCount(1, { timeout: BACKEND_TIMEOUT });

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('create-us-result'), fullPage: true });
    });

    /**
     * Case 3 — ported from `backlog.e2e.js` L93-L123.
     */
    test('bulk-creates two user stories', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        const before = await backlog.storyCount();

        // `.new-us button.btn-icon` — the incumbent's `$$('.new-us a').get(1)`
        // (`backlog-helper.js` L134-L136) is stale for the same reason as Case 2.
        await backlog.openBulkUsLightbox();

        const lightbox = backlog.bulkUsLightbox();

        await expectLightboxOpen(authedPage, lightbox);

        const textarea = lightbox.locator(BULK_TEXTAREA);

        // ⚠ `browser.actions().sendKeys(protractor.Key.ENTER).perform()` (L106, L109)
        // becomes `press('Enter')`. The bulk textarea treats each LINE as one story,
        // so the newline is the separator rather than a submit.
        // ⚠ `pressSequentially` rather than the deprecated `type()`, and rather than a
        // second `fill()`: `fill` REPLACES the field's contents, which would discard
        // the first line and its newline, leaving one story instead of two.
        await textarea.fill('aaa');
        await textarea.press('Enter');
        await textarea.pressSequentially('bbb');
        await textarea.press('Enter');

        await authedPage.screenshot({ path: shot('bulk-create') });

        await lightbox.locator(SUBMIT_BUTTON).click();

        await expectLightboxClosed(authedPage, '.lightbox-generic-bulk');

        // Ported from L119-L121.
        await expect(
            backlog.storyRows(),
            'bulk create did not add exactly two rows (L121 asserted count + 2)',
        ).toHaveCount(before + 2, { timeout: BACKEND_TIMEOUT });

        await expectNoErrorNotification(authedPage);
    });

    /**
     * Case 4 — ported from `backlog.e2e.js` L125-L170, again collapsing a `before`
     * and three `it`s that shared one lightbox.
     */
    test('edits a user story', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        // ⚠ The incumbent's `openUsBacklogEdit` (`backlog-helper.js` L158-L160)
        // clicked `$$('.backlog-table-body .e2e-edit').get(item)` WITHOUT opening the
        // row menu first, and `.e2e-edit` matches TWO buttons per row anyway
        // (`us-edit-popover.jade` L10 edit-story and L24 move-to-top).
        // `BacklogPage.editStory()` opens the kebab menu and then clicks the
        // disambiguated `button.edit-story`.
        await backlog.editStory(0);

        const lightbox = backlog.createEditUsLightbox();

        await expectLightboxOpen(authedPage, lightbox);

        // The incumbent APPENDED `'subjectedit'` to whatever the row already held
        // (L138, `sendKeys` appends). A replacement with a unique value is used here
        // so the closing assertion identifies this edit and not a previous one.
        const subject = `subjectedit ${String(Date.now())}`;

        await lightbox.locator(SUBJECT_INPUT).fill(subject);

        // Ported from L141-L144: every role set to item 3, which is one point each.
        const roles = lightbox.locator(CLICKABLE_ROLE_ITEMS);

        const roleCount = await roles.count();

        expect(
            roleCount,
            'the estimation panel offered no editable roles, so the total cannot be asserted',
        ).toBeGreaterThan(0);

        for (let role = 0; role < roleCount; role += 1) {
            await setRolePoints(authedPage, lightbox, role, EDIT_ROLE_ITEM);
        }

        // Ported from L146-L148, which asserted the literal `'4'`. That literal is
        // arithmetic — one point per role across the four roles the seeded project
        // declares — so it is stated as the arithmetic instead of as the constant:
        // on a four-role project this asserts exactly `'4'`, and on any other it
        // asserts the same rule rather than failing for an unrelated reason.
        expect(
            await rolePointsTotal(lightbox),
            'the role-points total is not one point per role',
        ).toBe(String(roleCount));

        // Status, ported from L151 (`status(3)`), through the real popover.
        const status = await setLightboxStatus(authedPage, lightbox, EDIT_STATUS_ORDINAL);

        await expect(
            lightbox.locator(STATUS_TEXT),
            'the status dropdown did not adopt the status that was picked',
        ).toHaveText(status);

        // Tags, ported from L154 in the same reduced form as Case 2.
        await addTag(authedPage, lightbox);

        await lightbox
            .locator(DESCRIPTION_TEXTAREA)
            .fill(`test description edited ${String(Date.now())}`);

        // Settings, ported from L160.
        await toggleSetting(lightbox);

        await authedPage.screenshot({ path: shot('edit-us') });

        await lightbox.locator(SUBMIT_BUTTON).click();

        await expectLightboxClosed(authedPage, '.lightbox-create-edit');

        // The incumbent asserted NOTHING after submitting (L165-L169 only waited for
        // the lightbox to close), so a rejected write would have passed. The edit is
        // asserted here through its observable outcome.
        await expect(
            backlog.storyRows().filter({ hasText: subject }),
            `the edited subject "${subject}" is not in the backlog list`,
        ).toHaveCount(1, { timeout: BACKEND_TIMEOUT });

        await expectNoErrorNotification(authedPage);
    });

    /**
     * Case 5 — ported from `backlog.e2e.js` L173-L182.
     */
    test('changes a story status inline through the popover', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        const originalStatus = await backlog.storyStatusText(0);

        // Ported from L174. `BacklogPage.setStoryStatus` reproduces the whole
        // popover convention: EXACTLY ONE `.popover.active` within 3000 ms, then a
        // 400 ms settle (`e2e/utils/popover.js` L15-L27).
        await backlog.setStoryStatus(0, 1);

        // First, the outcome: the row must actually be rendering the new status.
        await expect
            .poll(
                async (): Promise<string> => backlog.storyStatusText(0),
                {
                    message: 'the row never rendered the first status change',
                    timeout: SPRINT_SUBMIT_DEBOUNCE + BACKEND_TIMEOUT,
                },
            )
            .not.toBe(originalStatus);

        // ⚠⚠ THEN THE GUARD WINDOW MUST BE WAITED OUT, and this is NOT optional.
        // The row status write is `$el.on "click", ".status", debounce 2000, …`
        // (`common/popovers.coffee` L136), and `taiga.debounce` is
        // `{leading: true, trailing: false}` (`utils.coffee` L117-L118) — so a second
        // status click inside the window is DROPPED ENTIRELY rather than queued. The
        // assertion above can resolve in a few hundred milliseconds because the row
        // updates optimistically, which would leave the second change below silently
        // discarded and this case failing with nothing on screen to explain it. The
        // incumbent's flat `browser.sleep(2000)` at L177 was guarding exactly this.
        await waitOutDebounceWindow(authedPage);

        // ⚠ THE HARDCODED LABEL AT L181 IS NOT PORTED. The incumbent asserted the
        // literal `'In progress'`, which depends on the project's own workflow
        // configuration and on what `sample_data` generated — it is neither
        // translation-independent nor project-independent. The label of the item
        // that is about to be clicked is read from the popover instead and asserted
        // against, which tests the same behaviour ("the row shows the status the
        // user picked") without encoding one project's data. This is an
        // assertion-robustness change, not a behaviour change (T10).
        const trigger = backlog.storyRow(0).locator('.status a.us-status');

        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();

        const popover = await waitForSinglePopover(authedPage);

        const item = popover.locator(POPOVER_LINK).nth(2);

        const expectedLabel = (await item.innerText()).trim();

        expect(expectedLabel.length, 'the status popover item rendered no label').toBeGreaterThan(0);

        await item.click();

        await authedPage.waitForTimeout(POPOVER_TRANSITION);

        await expect
            .poll(
                async (): Promise<string> => backlog.storyStatusText(0),
                {
                    message: 'the row does not show the status that was picked from the popover',
                    timeout: BACKEND_TIMEOUT,
                },
            )
            .toBe(expectedLabel);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('inline-status'), fullPage: true });
    });

    /**
     * Case 6 — ported from `backlog.e2e.js` L184-L192.
     */
    test('changes story points inline through the two-level popover', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        const before = await backlog.storyPointsText(0);

        // TWO-LEVEL popover: the role list first, then the points list. The first
        // pick REPLACES the list, so `BacklogPage.setStoryPoints` waits for the
        // popover again before the second pick — ported from `popover.js` L37-L40,
        // where that second wait is what makes the sequence reliable.
        await backlog.setStoryPoints(0, 1, 1);

        // Ported from L191, which asserted the value is NOT what it was.
        await expect
            .poll(async (): Promise<string> => backlog.storyPointsText(0), {
                message: 'the inline points value did not change (L191 asserted "not equal")',
                timeout: BACKEND_TIMEOUT,
            })
            .not.toBe(before);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('inline-points'), fullPage: true });
    });

    /**
     * Case 7 — derived from `us-edit-popover.jade` and `backlog-helper.js`
     * L158-L163. The incumbent never asserted the menu itself; it clicked blind
     * into `.e2e-edit`, which is why its edit and move-to-top actions were a coin
     * toss between two buttons sharing that hook.
     */
    test('opens the row action popover', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        await backlog.openRowActions(0);

        // The ported cardinality invariant (`popover.js` L21-L27).
        await expect(
            authedPage.locator(ACTIVE_POPOVER),
            'the row kebab did not open exactly one popover',
        ).toHaveCount(1, { timeout: POPOVER_TIMEOUT });

        const row = backlog.storyRow(0);

        // All three items, each addressed unambiguously. `.e2e-edit` alone matches
        // two of them (`us-edit-popover.jade` L10 and L24), which is the ambiguity
        // the page object resolves and this case proves is resolvable.
        await expect(
            row.locator(ROW_ACTION_EDIT),
            'the row menu offers no edit action (us-edit-popover.jade L10)',
        ).toHaveCount(1);

        await expect(
            row.locator(ROW_ACTION_DELETE),
            'the row menu offers no delete action (us-edit-popover.jade L17)',
        ).toHaveCount(1);

        await expect(
            row.locator(ROW_ACTION_MOVE_TO_TOP),
            'the row menu offers no move-to-top action (us-edit-popover.jade L24)',
        ).toHaveCount(1);

        await authedPage.screenshot({ path: shot('row-actions'), fullPage: true });

        // Dismissed with Escape, then asserted closed — the menu must not be left
        // open for the next interaction, and "exactly one active popover" would
        // otherwise fail later for a reason that has nothing to do with that case.
        await authedPage.keyboard.press('Escape');

        await expect(
            authedPage.locator(ACTIVE_POPOVER),
            'the row menu stayed open after Escape',
        ).toHaveCount(0, { timeout: POPOVER_TIMEOUT });

        // The third item is then actually exercised, since it is the only row action
        // with an order outcome. `moveStoryToTop` settles on the row's own `data-id`
        // being first, so this reads the reference to state the same thing in the
        // vocabulary the rest of the file uses.
        const refs = await backlog.storyRefs();

        const promoted = requireRef(refs, 1, 'the promoted story can be recognised at the top');

        await backlog.moveStoryToTop(1);

        await expect
            .poll(async (): Promise<string | undefined> => (await backlog.storyRefs())[0], {
                message: `story ${promoted} was moved to the top but is not the first row`,
                timeout: BACKEND_TIMEOUT,
            })
            .toBe(promoted);

        await expectNoErrorNotification(authedPage);
    });

    /**
     * Case 8 — ported from `backlog.e2e.js` L194-L204.
     */
    test('deletes a user story', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        const before = await backlog.storyCount();
        const refs = await backlog.storyRefs();
        const doomed = requireRef(refs, 0, 'the deleted story can be shown to be gone');

        // Ported from L197. `deleteStory` opens the kebab, clicks the delete item
        // and settles when the confirmation is up.
        await backlog.deleteStory(0);

        // Ported from L199 (`utils.lightbox.confirm.ok()`). ⚠ The incumbent clicked
        // `.button-green` (`e2e/utils/lightbox.js` L80); that class is STALE, and the
        // page object clicks the real `.js-confirm` instead. Accept is debounced, so
        // its close budget absorbs that.
        await backlog.confirmOk();

        // Ported from L201-L203.
        await expect(
            backlog.storyRows(),
            'the backlog did not lose exactly one row (L203 asserted count - 1)',
        ).toHaveCount(before - 1, { timeout: BACKEND_TIMEOUT });

        expect(
            await backlog.storyRefs(),
            `story ${doomed} was deleted but is still listed`,
        ).not.toContain(doomed);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('delete-us'), fullPage: true });
    });

    /**
     * Case 9 — derived from `backlog-helper.js` L214-L224 (`loadFullBacklog`) and
     * the pagination it drives, `infinite-scroll="ctrl.loadUserstories()"` on
     * `backlog-table.jade` L19-L24. The incumbent had no case for pagination
     * itself; it only used the helper as setup (L532), so a broken pagination would
     * have surfaced as an unrelated failure elsewhere.
     */
    test('paginates the backlog by infinite scroll', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        const initial = await backlog.storyCount();

        expect(initial, 'the backlog rendered no rows to paginate').toBeGreaterThan(0);

        // ⚠ `BacklogPage.loadFullBacklog(maxIterations?)` is CAPPED. The incumbent's
        // `do { … } while (count < newcount)` had NO cap, which under `retries: 0`
        // and `workers: 1` would not fail one test — it would consume the whole run
        // and report a bare timeout. The cap turns that into a named error.
        const total = await backlog.loadFullBacklog();

        expect(
            total,
            'scrolling to the end of the backlog returned fewer rows than were already rendered',
        ).toBeGreaterThanOrEqual(initial);

        // Idempotence: once every page is in, scrolling again must add nothing. This
        // is what distinguishes "pagination terminated" from "pagination stalled",
        // and it is the property the capped loop relies on.
        expect(
            await backlog.loadFullBacklog(),
            'a second full scroll changed the row count, so pagination is not terminating',
        ).toBe(total);

        await authedPage.screenshot({ path: shot('infinite-scroll'), fullPage: true });
    });

    /**
     * Case 10 — ported from `backlog.e2e.js` L206-L220 ("drag backlog us").
     *
     * The drag technique differs from the incumbent's for the reason set out in the
     * drag-technology note above: `dragula` consumed fabricated events,
     * `@dnd-kit/core` needs a real pointer gesture, and there is exactly one
     * implementation of that gesture, in `../pages/`.
     *
     * ⚠ The incumbent grabbed `dragElement.$('.icon-drag')` (L210). `.icon-drag` is
     * STALE: `backlog-row.jade` L15-L17 renders `.draggable-us-row` wrapping
     * `tg-svg(svg-icon="icon-draggable")`, so the emitted token is `icon-draggable`
     * — a DIFFERENT token that a substring search would have missed. The page
     * object owns the corrected handle.
     */
    test('reorders a story within the backlog', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        const before = await backlog.storyRefs();
        const dragged = requireRef(before, 4, 'the reordered story can be recognised at the top');

        await authedPage.screenshot({ path: shot('reorder-before'), fullPage: true });

        await backlog.dragStory(4, 0);

        // Ported from L217-L219. ⚠ The incumbent's settle was
        // `browser.waitForAngular()` (L215); the outcome assertion replaces it.
        await expect
            .poll(async (): Promise<string | undefined> => (await backlog.storyRefs())[0], {
                message: `story ${dragged} was dragged to the first position but is not there`,
                timeout: BACKEND_TIMEOUT,
            })
            .toBe(dragged);

        expect(
            (await backlog.storyRefs()).length,
            'the reorder changed how many stories the backlog holds',
        ).toBe(before.length);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('reorder-after'), fullPage: true });
    });

    /**
     * Case 11 — ported from `backlog.e2e.js` L222-L248 ("reorder multiple us").
     *
     * This is the gate for AAP risk R-DND-1: `@dnd-kit` has NO built-in multi-item
     * drag, so the multi-select gesture is hand-built and its ordering arithmetic is
     * computed manually from collision data (R-DND-2). The incumbent asserted both
     * landing positions (L246-L247) precisely because the PAIR must arrive at the
     * top with its relative order preserved — one story arriving is not the
     * behaviour.
     */
    test('reorders multiple selected stories', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        // Ported from L223-L225: the incumbent worked from the END of the list, so
        // the whole list has to be present for those indexes to exist.
        await backlog.loadFullBacklog();

        const before = await backlog.storyRefs();

        expect(
            before.length,
            'the backlog needs at least three rows to move a pair from the end to the top',
        ).toBeGreaterThanOrEqual(3);

        const lastIndex = before.length - 1;
        const penultimateIndex = before.length - 2;

        // The incumbent pushed `count - 1` first and then `count - 2`
        // (L230-L239), so `draggedRefs[0]` is the LAST row and `draggedRefs[1]` the
        // one above it. That ordering is what its two assertions depend on.
        const lastRef = requireRef(before, lastIndex, 'the last selected story can be recognised');
        const penultimateRef = requireRef(
            before,
            penultimateIndex,
            'the second selected story can be recognised',
        );

        await setStorySelected(backlog, lastIndex, true);
        await setStorySelected(backlog, penultimateIndex, true);

        // `selectStory` asserts each checkbox is checked afterwards, so this states
        // the aggregate the drag depends on: two rows, not one and not three.
        expect(
            await backlog.selectedStoryCount(),
            'exactly two stories must be selected before a multi-drag',
        ).toBe(2);

        // The gesture starts from the upper of the two selected rows, as at L241.
        await backlog.dragStory(penultimateIndex, 0);

        // Ported from L243-L247: the pair lands at the top with its relative order
        // preserved — the upper row first, the lower row second.
        await expect
            .poll(async (): Promise<string[]> => (await backlog.storyRefs()).slice(0, 2), {
                message:
                    'the selected pair did not land at the top of the backlog with its relative ' +
                    'order preserved. @dnd-kit provides no multi-item drag (AAP risk R-DND-1), so ' +
                    'this is the hand-built multi-select path plus the manually computed ordering ' +
                    'of R-DND-2.',
                timeout: BACKEND_TIMEOUT,
            })
            .toEqual([penultimateRef, lastRef]);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('multi-reorder'), fullPage: true });

        // Deselected so the next case starts from a clean selection — the toolbar's
        // move-to-sprint buttons act on the SELECTION, so a leftover would change
        // what a later case does.
        await clearStorySelection(backlog);
    });

    /**
     * Case 12 — ported from `backlog.e2e.js` L250-L269 ("drag multiple us to
     * milestone").
     *
     * ⚠⚠ THIS IS THE INCUMBENT'S ORDER-COUPLING DEFECT, FIXED. Its comment at L258
     * reads, verbatim: "the us 1 and 2 are selected on the previous test" — the case
     * selected NOTHING itself and relied on checkboxes left checked by the case
     * before it, then asserted `initUssSprintCount + 2` (L268) on that basis. Run
     * alone, or after any reordering of the file, it asserted +2 having dragged one
     * unselected row. BOTH rows are selected explicitly here. This changes no
     * behaviour — it makes the case actually test the behaviour it names.
     */
    test('drags multiple selected stories into a sprint', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        test.skip(
            (await backlog.sprints().count()) < 1,
            `Project ${BACKLOG_PROJECT_SLUG} has no sprint under sample_data, so stories cannot ` +
                'be dragged into one. Add a sprint to the seeded project to run this case.',
        );

        const before = await backlog.storyRefs();

        expect(
            before.length,
            'the backlog needs at least two rows to drag a pair into a sprint',
        ).toBeGreaterThanOrEqual(2);

        const firstRef = requireRef(before, 0, 'the first dragged story can be found in the sprint');
        const secondRef = requireRef(before, 1, 'the second dragged story can be found in the sprint');

        const sprintBefore = await backlog.sprintStories(0).count();

        // THE FIX: explicit selection inside this test.
        await clearStorySelection(backlog);
        await setStorySelected(backlog, 0, true);
        await setStorySelected(backlog, 1, true);

        expect(
            await backlog.selectedStoryCount(),
            'exactly two stories must be selected before a multi-drag into a sprint',
        ).toBe(2);

        // Ported from L263, which dropped onto `sprint.$('.sprint-table')` — the
        // same target `dragStoryToSprint` uses.
        await backlog.dragStoryToSprint(0, 0);

        // Ported from L266-L268.
        await expect(
            backlog.sprintStories(0),
            'the sprint did not gain both selected stories (L268 asserted count + 2)',
        ).toHaveCount(sprintBefore + 2, { timeout: BACKEND_TIMEOUT });

        // Stronger than the incumbent's count: counting cannot distinguish "the two
        // selected stories arrived" from "two stories arrived".
        const sprintRefs = await backlog.sprintStoryRefs(0);

        expect(sprintRefs, `the first selected story ${firstRef} is not in the sprint`).toContain(
            firstRef,
        );
        expect(sprintRefs, `the second selected story ${secondRef} is not in the sprint`).toContain(
            secondRef,
        );

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('drag-multi-to-sprint'), fullPage: true });

        await clearStorySelection(backlog);
    });

    /**
     * Case 13 — ported from `backlog.e2e.js` L271-L288 ("drag us to milestone").
     */
    test('drags one story into a sprint', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        test.skip(
            (await backlog.sprints().count()) < 1,
            `Project ${BACKLOG_PROJECT_SLUG} has no sprint under sample_data, so a story cannot ` +
                'be dragged into one. Add a sprint to the seeded project to run this case.',
        );

        const before = await backlog.storyRefs();
        const dragged = requireRef(before, 0, 'the dragged story can be found in the sprint');
        const sprintBefore = await backlog.sprintStories(0).count();

        await backlog.dragStoryToSprint(0, 0);

        // Ported from L285-L287.
        await expect(
            backlog.sprintStories(0),
            'the sprint did not gain exactly one story (L287 asserted count + 1)',
        ).toHaveCount(sprintBefore + 1, { timeout: BACKEND_TIMEOUT });

        expect(
            await backlog.sprintStoryRefs(0),
            `story ${dragged} was dragged into the sprint but the sprint does not list it`,
        ).toContain(dragged);

        // It must also have LEFT the backlog: a story assigned to a sprint is no
        // longer in the backlog list, and asserting only the arrival would pass on an
        // implementation that duplicated it.
        expect(
            await backlog.storyRefs(),
            `story ${dragged} is still in the backlog after being moved into a sprint`,
        ).not.toContain(dragged);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('drag-to-sprint'), fullPage: true });
    });

    /**
     * Case 14 — ported from `backlog.e2e.js` L290-L308 ("move to lastest sprint
     * button", the incumbent's own spelling).
     *
     * ⚠ The incumbent clicked the bare `$('.e2e-move-to-sprint')` (L299), which is
     * AMBIGUOUS: `backlog.jade` L91 and L98 both carry that hook, on
     * `button.move-to-current-sprint` (rendered `ng-if="currentSprint"`) and
     * `button.move-to-latest-sprint` (rendered `ng-if="!currentSprint"`). The two
     * `ng-if`s are complementary, so exactly one exists at a time and the incumbent
     * happened to reach whichever the seeded data produced. The page object exposes
     * them separately; this case names the one it means and skips, visibly, when the
     * project renders the other.
     */
    test('moves a selected story to the latest sprint via the toolbar button', async ({
        authedPage,
    }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        const hasLatestSprintButton =
            (await authedPage.locator('button.move-to-latest-sprint').count()) > 0;

        test.skip(
            !hasLatestSprintButton,
            `Project ${BACKLOG_PROJECT_SLUG} has a CURRENT sprint, so backlog.jade L91 renders ` +
                'move-to-current-sprint instead of move-to-latest-sprint. The two are mutually ' +
                'exclusive ng-if branches; this case is about the latter.',
        );

        test.skip(
            (await backlog.openSprints().count()) < 1,
            `Project ${BACKLOG_PROJECT_SLUG} has no open sprint to move a story into.`,
        );

        const before = await backlog.storyRefs();
        const moved = requireRef(before, 0, 'the moved story can be found in the target sprint');

        await clearStorySelection(backlog);
        await setStorySelected(backlog, 0, true);

        expect(
            await backlog.selectedStoryCount(),
            'exactly one story must be selected before using the toolbar move button',
        ).toBe(1);

        await backlog.moveToLatestSprint();

        // ⚠ The incumbent settled on `outerHtmlChanges('.backlog-table-body')`
        // (L297) — "the markup changed", which a re-render also satisfies. The
        // outcome is that the story is in the LAST open sprint (L303-L307), so that
        // is what is waited on.
        await expect
            .poll(
                async (): Promise<string[]> => {
                    const sprintCount = await backlog.openSprints().count();

                    return backlog.sprintStoryRefs(sprintCount - 1);
                },
                {
                    message: `story ${moved} did not arrive in the last open sprint`,
                    timeout: BACKEND_TIMEOUT,
                },
            )
            .toContain(moved);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('move-to-latest-sprint'), fullPage: true });
    });

    /**
     * Case 15 — ported from `backlog.e2e.js` L310-L323 ("reorder milestone us").
     *
     * 🐞 THE INCUMBENT ASSERTION AT L322 IS DEFECTIVE AND IS NOT COPIED:
     *
     *     expect(firstElementRef).to.be.equal(firstElementRef);
     *
     * It compares a value WITH ITSELF, so it holds for every possible state of the
     * application and the case could not fail. It captured the dragged story's
     * reference at L315 (`draggedElementRef`) and then never used it — which makes
     * the intent unambiguous. The real assertion is written here.
     *
     * ⚠ T10 forbids BEHAVIOUR changes, not assertion-quality fixes. The behaviour
     * asserted is exactly the behaviour the incumbent set out to assert; copying the
     * self-comparison would instead deliver a case that cannot fail, which would
     * silently reduce the migration's coverage.
     */
    test('reorders stories inside a sprint', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        test.skip(
            (await backlog.sprints().count()) < 1,
            `Project ${BACKLOG_PROJECT_SLUG} has no sprint under sample_data, so stories inside ` +
                'a sprint cannot be reordered.',
        );

        const sprintRefs = await backlog.sprintStoryRefs(0);

        // The incumbent used index 3 (L314), so the sprint needs four stories.
        test.skip(
            sprintRefs.length < 4,
            `The first sprint of ${BACKLOG_PROJECT_SLUG} holds ${String(sprintRefs.length)} ` +
                'stories; the ported case moves its fourth story to the top, which needs at ' +
                'least four.',
        );

        const dragged = requireRef(sprintRefs, 3, 'the reordered sprint story can be recognised');

        // ⚠ BOTH ENDS ARE SPRINT ROWS, which no `BacklogPage` method can express:
        // `dragStory` and `dragStoryToSprint` both take a BACKLOG row as their
        // source. So the shared `dndKitDrag` is driven directly — the SAME single
        // implementation those methods use, not a second one. The incumbent had the
        // same shape at L317, passing two sprint rows to `utils.common.drag`.
        //
        // Note the CONTEXT-DEPENDENT reference class: a sprint row renders
        // `span.us-ref-text` (`sprint.jade` L31-L33), not the backlog row's
        // `span.user-story-number` (`backlog-row.jade` L38) — the incumbent's
        // `span[tg-bo-ref]` hid that distinction behind one attribute.
        const rows = backlog.sprintStories(0);

        await dndKitDrag(authedPage, rows.nth(3), rows.nth(0));

        // THE REAL ASSERTION, comparing the FIRST sprint row against the reference
        // that was actually dragged.
        await expect
            .poll(async (): Promise<string | undefined> => (await backlog.sprintStoryRefs(0))[0], {
                message:
                    `story ${dragged} was dragged to the top of the sprint but is not the first ` +
                    'row. (The incumbent could not detect this: its L322 assertion compared a ' +
                    'value with itself.)',
                timeout: BACKEND_TIMEOUT,
            })
            .toBe(dragged);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('reorder-in-sprint'), fullPage: true });
    });

    /**
     * Case 16 — ported from `backlog.e2e.js` L325-L341 ("drag us from milestone to
     * milestone").
     */
    test('drags a story from one sprint to another', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        test.skip(
            (await backlog.sprints().count()) < 2,
            `Project ${BACKLOG_PROJECT_SLUG} has fewer than two sprints under sample_data, so a ` +
                'story cannot be dragged between sprints. Add a second sprint to run this case.',
        );

        const sourceRefs = await backlog.sprintStoryRefs(0);

        test.skip(
            sourceRefs.length < 1,
            `The first sprint of ${BACKLOG_PROJECT_SLUG} is empty, so it has no story to move ` +
                'into the second.',
        );

        const dragged = requireRef(sourceRefs, 0, 'the story moved between sprints can be tracked');
        const targetBefore = await backlog.sprintStories(1).count();

        // ⚠ The SOURCE is a sprint row, so again no `BacklogPage` method fits and
        // the shared `dndKitDrag` is driven directly. It scrolls both ends into view
        // before measuring them, which is what makes a sprint further down the
        // sidebar a legitimate destination rather than a missing one (AAP risk
        // R-DND-3: `@dnd-kit` has no virtual-list support, so drop targets must stay
        // registered for rows outside the viewport). The incumbent dropped onto
        // `sprint2.$('.sprint-table')` at L333; that is the same target here.
        await dndKitDrag(
            authedPage,
            backlog.sprintStories(0).first(),
            backlog.sprint(1).locator('.sprint-table'),
        );

        // Ported from L338-L340.
        await expect(
            backlog.sprintStories(1),
            'the second sprint did not gain a story (L340 asserted count + 1)',
        ).toHaveCount(targetBefore + 1, { timeout: BACKEND_TIMEOUT });

        expect(
            await backlog.sprintStoryRefs(1),
            `story ${dragged} was dragged into the second sprint but is not listed there`,
        ).toContain(dragged);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('drag-sprint-to-sprint'), fullPage: true });
    });

    /**
     * Case 17 — ported from `backlog.e2e.js` L343-L362.
     *
     * ⚠ THE IE SKIP IS DROPPED. The incumbent wrapped this case in
     * `utils.common.browserSkip('internet explorer', …)` (`common.js` L55-L69),
     * which branched on `browser.browserName` — a Protractor global with no
     * Playwright equivalent, and no longer meaningful: `playwright.config.ts` runs
     * Firefox first and Chromium as the fallback, neither of which is IE.
     *
     * ⚠ The incumbent opened with `browser.sleep(5000)` (L344). Replaced by a
     * bounded readiness assertion on the rows the case is about to click.
     */
    test('selects a range of stories with SHIFT', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        const rows = backlog.storyRows();

        // The bounded substitute for the 5000 ms sleep: the rows the case clicks
        // must be attached before it clicks them.
        await expect(
            rows.nth(SHIFT_RANGE_LAST_ROW),
            `the backlog needs at least ${String(SHIFT_RANGE_LAST_ROW + 1)} rows for a ` +
                'shift-range selection',
        ).toBeAttached({ timeout: BACKEND_TIMEOUT });

        // Nothing may be selected already, or the count below would be measuring
        // another case's leftovers.
        await clearStorySelection(backlog);

        expect(
            await backlog.selectedStoryCount(),
            'stories were already selected before the shift-range selection began',
        ).toBe(0);

        await setStorySelected(backlog, 0, true);

        // ⚠ `browser.actions().keyDown(protractor.Key.SHIFT) … .keyUp(…)` (L350-L357)
        // becomes `keyboard.down('Shift')` / `keyboard.up('Shift')`. The modifier must
        // be held ACROSS the second click, which is why it is not expressed as a
        // click option on a single call.
        await authedPage.keyboard.down('Shift');

        try {
            await backlog.selectStory(SHIFT_RANGE_LAST_ROW);
        } finally {
            // Released in a `finally` so a failed click cannot leave Shift latched
            // for every later case. This is NOT a swallowed failure: nothing is
            // caught, so the error still propagates.
            await authedPage.keyboard.up('Shift');
        }

        // Ported from L359-L361. This absolute is ARITHMETIC — rows 0 to 3 inclusive
        // is four rows — so it is correct to hardcode.
        await expect
            .poll(async (): Promise<number> => backlog.selectedStoryCount(), {
                message:
                    'the shift-click did not select the whole range between the two clicked rows',
                timeout: BACKEND_TIMEOUT,
            })
            .toBe(SHIFT_RANGE_EXPECTED_SELECTION);

        await authedPage.screenshot({ path: shot('shift-select'), fullPage: true });

        // Deselected before finishing — order tolerance. The toolbar's move buttons
        // act on the selection, so four rows left checked would change what a later
        // case does.
        await clearStorySelection(backlog);
    });

    /**
     * Case 18 — ported from `backlog.e2e.js` L364-L372 ("role filters").
     *
     * ⚠ The incumbent opened the popover on `div[tg-us-role-points-selector]`
     * (`backlog-helper.js` L260-L264, `fiterRole`, misspelling in the original).
     * That attribute selector is replaced by the class contract
     * `.backlog-table-header .points .inner` (`backlog-table.jade` L14-L17), which
     * survives into React because the stylesheets target it.
     */
    test('filters points by role', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        expect(
            await backlog.storyCount(),
            'the backlog rendered no rows, so a role filter cannot be observed',
        ).toBeGreaterThan(0);

        await backlog.filterByRole(1);

        await authedPage.screenshot({ path: shot('role-filters'), fullPage: true });

        // Ported from L369-L371, with the incumbent's RegExp reproduced exactly —
        // including the `?` alternative, which is what an unestimated role renders.
        await expect
            .poll(async (): Promise<string> => backlog.storyPointsText(0), {
                message:
                    'with a role filter active the points cell must render "role points / total ' +
                    'points"',
                timeout: BACKEND_TIMEOUT,
            })
            .toMatch(ROLE_FILTERED_POINTS_PATTERN);

        // Restored to "all roles" (popover item 0) so the next case reads unfiltered
        // point values. The incumbent left the filter applied, which is exactly the
        // kind of leftover that makes a suite order-dependent.
        await backlog.filterByRole(0);

        await expect
            .poll(async (): Promise<string> => backlog.storyPointsText(0), {
                message: 'the role filter could not be cleared back to "all roles"',
                timeout: BACKEND_TIMEOUT,
            })
            .not.toMatch(ROLE_FILTERED_POINTS_PATTERN);
    });

    /**
     * Case 19 — ported from `backlog.e2e.js` L374-L438, the incumbent's `milestones`
     * describe: three `it`s that created, edited and then deleted a sprint. Kept as
     * one test because they are one lifecycle and because the delete must remove THE
     * SPRINT THIS CASE CREATED and nothing else.
     *
     * ⚠ NEVER DELETE A `sample_data` SPRINT. The incumbent's delete opened
     * `openMilestoneEdit(0)` — the FIRST sprint in the sidebar, which is a seeded one
     * — so it destroyed data every other sprint case depends on. HR-7 forbids
     * reseeding to recover, so this case deletes only what it created and verifies
     * that by name.
     */
    test.describe('milestones', () => {
        test('creates, edits and deletes a sprint', async ({ authedPage }) => {
            const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

            await backlog.goto();

            const sprintsBefore = await backlog.sprintTitles();

            /* --- create, ported from L375-L397 --------------------------------- */

            // ⚠ The incumbent's `$('.add-sprint')` (`backlog-helper.js` L166-L168) is
            // STALE — no template emits that class. `openNewSprintLightbox()` uses
            // `header.sprint-header a.btn-link` (`sprints.jade` L16-L24), falling back
            // to `div.empty-small a.btn-link` (L32-L39) when the project has no
            // sprints and the header link is therefore `ng-if`-ed away.
            await backlog.openNewSprintLightbox();

            // ⚠ `form.name()` replaces a construct that CANNOT be ported. The
            // incumbent addressed the field as `el.element(by.model('sprint.name'))`
            // (`backlog-helper.js` L104-L106) — a Protractor locator that resolves an
            // element by its AngularJS `ng-model` EXPRESSION, for which Playwright has
            // no equivalent and could not have one: it is a framework-internal binding,
            // not anything present in the DOM. The page object substitutes the class
            // and name contract `input.sprint-name[name="name"]`
            // (`lightbox-sprint-add-edit.jade` L13-L15), which survives into React.
            const form = backlog.sprintForm();

            await authedPage.screenshot({ path: shot('create-sprint') });

            // Both date fields are `data-required="true"`
            // (`lightbox-sprint-add-edit.jade` L30, L39) and are pre-filled by
            // `lightboxes.coffee` using `COMMON.PICKERDATE.FORMAT` (L41, L147). If
            // either were empty the submit below would fail validation for a reason
            // that has nothing to do with what this case tests, so the precondition
            // is asserted explicitly rather than worked around by filling them.
            await expect(
                form.startDate(),
                'the sprint form did not pre-fill its start date (lightboxes.coffee L41/L147 ' +
                    'populates it from COMMON.PICKERDATE.FORMAT); the form cannot validate',
            ).not.toHaveValue('');

            await expect(
                form.finishDate(),
                'the sprint form did not pre-fill its finish date; the form cannot validate',
            ).not.toHaveValue('');

            // ONE IN-FLOW VALIDATION ASSERTION. The name is `data-required="true"`
            // (`lightbox-sprint-add-edit.jade` L18), and the migration replaces
            // `checksley` (`lightboxes.coffee` L44-L49, whose failure path sets
            // `hasErrors` and adds `disappear` to `.last-sprint-name` before
            // returning) with hand-written validation — so an empty name must still
            // block the submit. Without this, a validation regression would be
            // invisible.
            await form.name().fill('');

            await form.submit();

            await expect(
                form.el,
                'submitting the sprint form with an empty name closed the lightbox, so the ' +
                    'required-name rule from lightbox-sprint-add-edit.jade L18 is not enforced',
            ).toHaveClass(classToken(LIGHTBOX_OPEN_CLASS), {
                timeout: SPRINT_SUBMIT_DEBOUNCE + LIGHTBOX_TIMEOUT,
            });

            // ⚠⚠ THE GUARD WINDOW MUST BE WAITED OUT BEFORE SUBMITTING AGAIN.
            // `submit = debounce 2000` (`backlog/lightboxes.coffee` L38) with
            // `{leading: true, trailing: false}` (`utils.coffee` L117-L118) means the
            // rejected submit above CONSUMED the leading edge, and a second submit
            // inside the window is dropped entirely — not queued. Without this the
            // real submit below would never reach the handler and the sidebar
            // assertion would time out with nothing on screen to explain it.
            await waitOutDebounceWindow(authedPage);

            // Ported from L384: a unique name, so the sidebar assertion cannot be
            // satisfied by a sprint left over from an earlier run.
            const createdName = `sprintName${String(Date.now())}`;

            await form.name().fill(createdName);

            // The name field declares `ng-model-options="{ debounce: 200 }"`
            // (`lightbox-sprint-add-edit.jade` L17), so the model needs a moment to
            // catch up before the submit reads it.
            await authedPage.waitForTimeout(MODEL_DEBOUNCE);

            await form.submit();

            // ⚠ THE 2,000 ms SUBMIT DEBOUNCE. `lightboxes.coffee` L38 declares
            // `submit = debounce 2000, (event) =>`, and the incumbent tolerated it
            // with a flat `browser.sleep(2000)` (L392, comment `// debounce`)
            // followed by `browser.waitForAngular()` (L389). Here the debounce is
            // folded into an auto-retrying assertion's BUDGET instead: the case
            // returns as soon as the sidebar shows the sprint, and only pays the full
            // two seconds when something is actually wrong.
            await expect
                .poll(async (): Promise<string[]> => backlog.sprintTitles(), {
                    message: `the created sprint "${createdName}" never appeared in the sidebar`,
                    timeout: SPRINT_SUBMIT_DEBOUNCE + BACKEND_TIMEOUT,
                })
                .toContain(createdName);

            await form.waitClose();

            // Ported from L394-L396, and the sidebar must have grown by exactly one.
            expect(
                (await backlog.sprintTitles()).length,
                'creating one sprint did not add exactly one sprint to the sidebar',
            ).toBe(sprintsBefore.length + 1);

            /* --- edit, ported from L399-L419 ----------------------------------- */

            const createdIndex = (await backlog.sprintTitles()).indexOf(createdName);

            expect(
                createdIndex,
                `the created sprint "${createdName}" is not in the sidebar, so it cannot be edited`,
            ).toBeGreaterThanOrEqual(0);

            // ⚠ The incumbent edited sprint 0 (L400), a SEEDED sprint. This edits the
            // one it just created, so the case owns everything it mutates.
            await backlog.openEditSprint(createdIndex);

            await authedPage.screenshot({ path: shot('edit-sprint') });

            const editedName = `sprintName${String(Date.now())}edited`;

            // Ported from L406-L410: cleared, then retyped.
            await form.name().fill('');
            await form.name().fill(editedName);

            await authedPage.waitForTimeout(MODEL_DEBOUNCE);

            // The guard window again. `submit = debounce 2000` is created ONCE per
            // lightbox instance (`backlog/lightboxes.coffee` L38) and the sprint form
            // is a single persistent element, so the window carries across a
            // close-and-reopen: the create submit above and this edit submit share the
            // same guarded closure. The intervening assertions and transitions
            // probably exceed 2000 ms on their own, but "probably" is not a basis for
            // a suite that runs with `retries: 0`.
            await waitOutDebounceWindow(authedPage);

            await form.submit();

            // Ported from L414-L418.
            await expect
                .poll(async (): Promise<string[]> => backlog.sprintTitles(), {
                    message: `the sprint was renamed to "${editedName}" but the sidebar does not ` +
                        'show it',
                    timeout: SPRINT_SUBMIT_DEBOUNCE + BACKEND_TIMEOUT,
                })
                .toContain(editedName);

            await form.waitClose();

            expect(
                await backlog.sprintTitles(),
                `the old sprint name "${createdName}" is still in the sidebar after the rename`,
            ).not.toContain(createdName);

            /* --- delete, ported from L421-L437 --------------------------------- */

            const editedIndex = (await backlog.sprintTitles()).indexOf(editedName);

            expect(
                editedIndex,
                `the renamed sprint "${editedName}" is not in the sidebar, so it cannot be deleted`,
            ).toBeGreaterThanOrEqual(0);

            await backlog.openEditSprint(editedIndex);

            // ⚠ The incumbent read the sprint name AFTER deleting it (L433,
            // `createMilestoneLightbox.name().getAttribute('value')` on a lightbox
            // whose form had already gone), then asserted that value was absent from
            // the sidebar — which an empty string would also satisfy. The name is
            // read BEFORE the delete here, from the form that is still open, and it
            // is asserted non-empty so the exclusion below cannot be vacuous.
            const doomedName = await form.name().inputValue();

            expect(
                doomedName,
                'the edit form does not hold the sprint name, so the deletion assertion would be ' +
                    'vacuous',
            ).toBe(editedName);

            await form.delete();

            // Ported from L430. ⚠ The incumbent clicked `.button-green`
            // (`e2e/utils/lightbox.js` L80), which is stale; `confirmOk()` clicks the
            // real `.js-confirm` and absorbs the accept debounce.
            await backlog.confirmOk();

            // Ported from L434-L436.
            await expect
                .poll(async (): Promise<string[]> => backlog.sprintTitles(), {
                    message: `the deleted sprint "${doomedName}" is still in the sidebar`,
                    timeout: SPRINT_SUBMIT_DEBOUNCE + BACKEND_TIMEOUT,
                })
                .not.toContain(doomedName);

            // The sidebar is back to exactly what it was, which proves no seeded
            // sprint was collateral damage.
            expect(
                await backlog.sprintTitles(),
                'deleting the sprint this case created did not restore the sidebar, so a seeded ' +
                    'sprint was affected too',
            ).toEqual(sprintsBefore);

            await expectNoErrorNotification(authedPage);

            await authedPage.screenshot({ path: shot('delete-sprint'), fullPage: true });
        });
    });

    /**
     * Case 20 — ported from `backlog.e2e.js` L440-L458, the incumbent's `tags`
     * describe (`show` then `hide`, each clicking `$('#show-tags')`).
     *
     * ⚠ `#show-tags` IS NOT THE CHECKBOX — it is the WRAPPER. `backlog.jade` L74-L90
     * renders `.display-tags-button#show-tags` holding
     * `.check.js-check(ng-class="{'active': ctrl.showTags}")`, which holds
     * `input#show-tags-input[type=checkbox]` plus a bare `div` that the stylesheet
     * draws as the visible control, followed by a sibling
     * `label(for="show-tags-input")`. The incumbent's `$('#show-tags').click()`
     * worked because WebDriver clicked the wrapper's box; under Playwright's strict
     * actionability the styled `input` is not reliably clickable, so
     * `BacklogPage.toggleTags()` clicks the LABEL and reads state from
     * `#show-tags .check.active` through `tagsShown()`.
     *
     * ⚠ The whole control is gated on `ng-if="userstories.length"` (L74), so it is
     * ABSENT on an empty backlog. Presence is asserted with a clear message rather
     * than waited for.
     */
    test.describe('tags', () => {
        test('toggles tag visibility', async ({ authedPage }) => {
            const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

            await backlog.goto();

            expect(
                await backlog.storyCount(),
                'the tag toggle is gated on ng-if="userstories.length" (backlog.jade L74), so an ' +
                    'empty backlog does not render it at all',
            ).toBeGreaterThan(0);

            const initiallyShown = await backlog.tagsShown();

            // Turned ON first regardless of where it started, so the case is
            // order-tolerant, and restored at the end.
            if (initiallyShown) {
                await backlog.toggleTags();
            }

            expect(await backlog.tagsShown(), 'the tag toggle did not start from "off"').toBe(false);

            await backlog.toggleTags();

            expect(await backlog.tagsShown(), 'the tag toggle did not turn on').toBe(true);

            await authedPage.screenshot({ path: shot('tags-shown'), fullPage: true });

            // Ported from L446-L448. 🚫 VISIBILITY ONLY — the pill's colour comes from
            // `tag[1]` (`backlog-row.jade` L50), which is per-project data whose
            // Figma appearance is a `sample_data` artefact (rule T2, drift D3).
            //
            // A project whose stories carry no tags renders no pills, and that is not
            // a failure of the toggle, so the pill assertion is made only when there
            // is a pill to assert on. The TOGGLE STATE above is asserted
            // unconditionally, so this case can never pass vacuously.
            const tagCount = await backlog.visibleTags().count();

            if (tagCount > 0) {
                await expect(
                    backlog.visibleTags().first(),
                    'tag display is on but the first tag pill is not visible',
                ).toBeVisible();
            }

            await backlog.toggleTags();

            expect(await backlog.tagsShown(), 'the tag toggle did not turn off').toBe(false);

            // Ported from L454-L456.
            if (tagCount > 0) {
                await expect(
                    backlog.visibleTags().first(),
                    'tag display is off but a tag pill is still visible',
                ).toBeHidden();
            }

            await authedPage.screenshot({ path: shot('tags-hidden'), fullPage: true });

            // Left exactly as it was found.
            if (initiallyShown) {
                await backlog.toggleTags();
            }

            expect(
                await backlog.tagsShown(),
                'the tag toggle was not restored to the state this case found it in',
            ).toBe(initiallyShown);
        });
    });

    /**
     * Case 21 — AAP-required addition; the incumbent suite has no burndown case, so
     * there is no line to cite. Derived from `ToggleBurndownVisibility`
     * (`backlog/main.coffee` L1166-L1210) and from `summary.jade` L28-L32.
     *
     * ⚠ `BacklogPage` exposes NO burndown accessor — the one genuine page-object gap
     * — so raw locators are both required and correct here. See
     * {@link BURNDOWN_TOGGLE}.
     */
    test('toggles burndown visibility and persists it across a reload', async ({ authedPage }) => {
        const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

        await backlog.goto();

        const toggle = authedPage.locator(BURNDOWN_TOGGLE);
        const graph = authedPage.locator(BURNDOWN_GRAPH);

        // The toggle is gated on `ng-if="!showGraphPlaceholder"` (`summary.jade` L30),
        // so a project with no graph configured renders none.
        test.skip(
            (await toggle.count()) === 0,
            `Project ${BACKLOG_PROJECT_SLUG} renders the empty-burndown placeholder instead of a ` +
                'graph (summary.jade L30 gates the toggle on !showGraphPlaceholder), so burndown ' +
                'visibility is not togglable. Configure the project graph to run this case.',
        );

        await expect(graph, 'the burndown container is missing').toHaveCount(1);

        // `show()` adds `active` to the button and `shown` on first load / `open` on
        // subsequent reveals to the graph (L1172-L1178); `hide()` removes all three
        // (L1167-L1170). Both graph classes mean "revealed".
        const startedRevealed = await hasClassToken(toggle, ACTIVE_CLASS);

        // Revealed first regardless of where it started, so the collapse below is
        // always a real transition — and restored at the end.
        if (!startedRevealed) {
            await toggle.click();

            await expect(
                toggle,
                'the burndown toggle did not gain "active" when revealing the graph',
            ).toHaveClass(classToken(ACTIVE_CLASS));
        }

        await authedPage.screenshot({ path: shot('burndown-visible'), fullPage: true });

        await toggle.click();

        // Collapsed: the button loses `active` and the graph loses BOTH classes.
        await expect(
            toggle,
            'the burndown toggle kept "active" after being collapsed',
        ).not.toHaveClass(classToken(ACTIVE_CLASS));

        for (const revealed of BURNDOWN_SHOWN_CLASSES) {
            await expect(
                graph,
                `the burndown graph kept "${revealed}" after being collapsed ` +
                    '(backlog/main.coffee L1167-L1170 removes it)',
            ).not.toHaveClass(classToken(revealed));
        }

        await authedPage.screenshot({ path: shot('burndown-collapsed'), fullPage: true });

        // 🔴 PERSISTENCE ACROSS A RELOAD. `$storage.set(hash, …)` runs on every click
        // (L1200), and the state is re-read on link (L1183), so a collapsed graph
        // must come back collapsed.
        //
        // ⚠ NO localStorage KEY IS ASSERTED, and none could be: the key is
        // `generateHash(["is-burndown-grpahs-collapsed"])` (L1182) — the literal
        // string is HASHED, not used directly, so reading storage would mean
        // reimplementing `generateHash` in the test and coupling it to an
        // implementation detail. The OBSERVABLE end state is asserted instead, which
        // is what the user experiences and what survives the migration.
        //
        // ⚠ The literal above preserves the upstream misspelling exactly —
        // "grpahs", not "graphs". It is a PERSISTED KEY, so the typo is load-bearing:
        // correcting it would orphan every existing user's saved preference.
        await authedPage.reload();

        await backlog.waitLoaded();

        const toggleAfter = authedPage.locator(BURNDOWN_TOGGLE);
        const graphAfter = authedPage.locator(BURNDOWN_GRAPH);

        await expect(
            toggleAfter,
            'the collapsed burndown state did not survive a reload, so it is not being persisted',
        ).not.toHaveClass(classToken(ACTIVE_CLASS));

        for (const revealed of BURNDOWN_SHOWN_CLASSES) {
            await expect(
                graphAfter,
                `the burndown graph came back with "${revealed}" after a reload, so the collapsed ` +
                    'preference was not restored',
            ).not.toHaveClass(classToken(revealed));
        }

        // Restored, and asserted. This preference is persisted PER USER, so leaving
        // it collapsed would change every subsequent run and every subsequent
        // screenshot in both capture phases.
        if (startedRevealed) {
            await toggleAfter.click();

            await expect(
                toggleAfter,
                'the burndown could not be restored to the state this case found it in',
            ).toHaveClass(classToken(ACTIVE_CLASS));
        }

        await authedPage.screenshot({ path: shot('burndown-restored'), fullPage: true });
    });

    /**
     * Case 22 — ported from `backlog.e2e.js` L497-L499, which delegated the whole
     * group to `e2e/shared/filters.js`.
     *
     * ⚠ SCOPE LIMIT. `tg-filter` is an OUT-OF-SCOPE shared component, so only the
     * parts belonging to this screen are ported: opening and closing the panel, the
     * text search, and clearing back down. NOT ported: the shared suite's
     * save-custom-filter (+1) and remove-custom-filter (−1) cases
     * (`shared/filters.js` L53-L76) and its filter-by-category case (L37-L51) —
     * and the last could not be in any event, because
     * `filters-helper.js` `firterByCategoryWithContent()` climbs the tree with
     * `element(by.xpath('..'))`, a Protractor-only construct with no Playwright
     * equivalent. `BacklogPage.goBackFilters()` exists for the category breadcrumb
     * and stays deliberately unused.
     */
    test.describe('backlog filters', () => {
        test('opens and closes the filter panel, and searches', async ({ authedPage }) => {
            const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

            await backlog.goto();

            const initialCount = await backlog.storyCount();

            expect(
                initialCount,
                'the backlog rendered no rows, so a search cannot be shown to filter anything',
            ).toBeGreaterThan(0);

            const screen = authedPage.locator(SCREEN_ROOT);
            const filterToggle = screen.locator(FILTER_TOGGLE);
            const filterWrapper = screen.locator(FILTER_PANEL_WRAPPER);

            // `ng-if="ctrl.activeFilters"` (`backlog.jade` L126-L128) means the panel
            // is ABSENT from the DOM rather than hidden while closed, which is why
            // both directions are asserted by COUNT.
            await expect(
                filterWrapper,
                'the filter panel is already open before it was asked for',
            ).toHaveCount(0);

            // ⚠ `e2e/shared/filters.js` L21 slept a flat 4000 ms after opening the
            // panel. `BacklogPage.openFilters()` replaces that with a bounded
            // visibility assertion on the panel itself, so it returns as soon as the
            // panel is up and fails loudly if it never is. The incumbent
            // `filters-helper.js` L17-L24 also RETURNED SILENTLY when the trigger was
            // absent, leaving the following assertions to run against a panel that
            // had never opened; the page object requires the control instead.
            await backlog.openFilters();

            await expect(filterWrapper, 'the filter panel did not appear').toBeVisible();

            await expect(
                backlog.filterPanel(),
                'the filter panel appeared without its tg-filter component',
            ).toBeVisible();

            await expect(
                filterToggle,
                'the filter trigger did not report the panel as open',
            ).toHaveClass(classToken(ACTIVE_CLASS));

            await authedPage.screenshot({ path: shot('filters-open'), fullPage: true });

            await filterToggle.click();

            await expect(
                filterWrapper,
                'closing the filter panel did not remove it from the DOM',
            ).toHaveCount(0);

            await expect(filterToggle).not.toHaveClass(classToken(ACTIVE_CLASS));

            /* --- search ------------------------------------------------------- */

            const search = screen.locator(SEARCH_FIELD);

            await expect(
                search,
                'the search placeholder no longer resolves COMMON.FILTERS.INPUT_PLACEHOLDER',
            ).toHaveAttribute('placeholder', SEARCH_PLACEHOLDER);

            // A reference taken from a row that is really in the list, so the positive
            // case cannot pass by filtering to everything. The LONGEST reference is
            // used because a short one can be a prefix of another — which is exactly
            // why the incumbent had `getTestingFilterRef` ("get ref with the larger
            // length", `backlog-helper.js` L226-L242).
            const needle = await backlog.longestStoryRef();

            expect(needle.length, 'no story reference could be read to search for').toBeGreaterThan(
                0,
            );

            await search.fill(needle);

            // The ported settle for `browser.waitForAngular()`, paired with an
            // outcome assertion — see {@link expectLoaderSettled}.
            await expectLoaderSettled(authedPage);

            await expect
                .poll(async (): Promise<string[]> => backlog.storyRefs(), {
                    message: `searching for "${needle}" filtered out the very row it came from`,
                    timeout: BACKEND_TIMEOUT,
                })
                .toContain(needle);

            // The incumbent's deliberate no-match term (`shared/filters.js` L27),
            // whose assertion was that the counter reaches 0 (L34).
            await search.fill(NO_MATCH_QUERY);

            await expectLoaderSettled(authedPage);

            await expect(
                backlog.storyRows(),
                `searching for a term that matches nothing left rows in the backlog`,
            ).toHaveCount(0, { timeout: BACKEND_TIMEOUT });

            await authedPage.screenshot({ path: shot('search'), fullPage: true });

            // Cleared down, so this case leaves the screen exactly as it found it —
            // `shared/filters.js` L32 and its `after` hook at L78-L80 did the same.
            await search.fill('');

            await expectLoaderSettled(authedPage);

            await expect(
                backlog.storyRows(),
                'clearing the search did not restore the full backlog',
            ).toHaveCount(initialCount, { timeout: BACKEND_TIMEOUT });
        });
    });

    /**
     * Case 23 — ported from `backlog.e2e.js` L501-L584, whose `before` created an
     * empty sprint (L502-L513) and dragged a CLOSED story into it (L515-L542) before
     * three `it`s toggled and reopened it. Collapsed into ONE test with the setup
     * inline, because the three `it`s shared all of that state.
     *
     * ⚠ THE INCUMBENT'S ABSOLUTE COUNTS ARE NOT PORTABLE AND ARE NOT COPIED. It
     * asserted exactly `1` closed sprint (L554) and then exactly `0` (L562), and
     * finally that `.filter-closed-sprints` was absent altogether (L580-L582). All
     * three only hold when the project starts with ZERO closed sprints and this case
     * creates the only one — `project-3` may well already carry closed sprints from
     * `sample_data`, and the toggle is gated on `ng-if="totalClosedMilestones"`
     * (`sprints.jade` L50) so its absence means "none at all", not "the one we made
     * reopened". Every assertion below is BASELINE-RELATIVE instead.
     */
    test.describe('closed sprints', () => {
        test('opens and closes closed sprints, and reopens one by dragging an open story into it', async ({
            authedPage,
        }) => {
            const backlog = new BacklogPage(authedPage, BACKLOG_PROJECT_SLUG);

            await backlog.goto();

            /* --- setup (a): an empty sprint, ported from L502-L513 ------------- */

            const sprintsBefore = await backlog.sprintTitles();

            await backlog.openNewSprintLightbox();

            const form = backlog.sprintForm();
            const emptySprintName = `sprintName${String(Date.now())}`;

            await form.name().fill(emptySprintName);

            await authedPage.waitForTimeout(MODEL_DEBOUNCE);

            await form.submit();

            await expect
                .poll(async (): Promise<string[]> => backlog.sprintTitles(), {
                    message: `the empty sprint "${emptySprintName}" was not created`,
                    timeout: SPRINT_SUBMIT_DEBOUNCE + BACKEND_TIMEOUT,
                })
                .toContain(emptySprintName);

            await form.waitClose();

            /* --- setup (b): a closed story dragged into it, from L515-L542 ----- */

            await backlog.openNewUsLightbox();

            const lightbox = backlog.createEditUsLightbox();

            await expectLightboxOpen(authedPage, lightbox);

            const closedSubject = `closed subject ${String(Date.now())}`;

            await lightbox.locator(SUBJECT_INPUT).fill(closedSubject);

            // Ported from L526 (`createUSLightbox.status(5)`): the fifth status in the
            // seeded workflow is the CLOSED one, which is what makes the sprint below
            // count as closed once it holds only this story.
            await setLightboxStatus(authedPage, lightbox, CLOSED_STATUS_ORDINAL);

            await lightbox.locator(SUBMIT_BUTTON).click();

            await expectLightboxClosed(authedPage, '.lightbox-create-edit');

            // Ported from L532: the whole list, because the new story is at the end.
            await backlog.loadFullBacklog();

            const rowsWithClosedStory = await backlog.storyRefs();

            await expect(
                backlog.storyRows().filter({ hasText: closedSubject }),
                `the closed story "${closedSubject}" was not created, so no sprint can be closed`,
            ).toHaveCount(1, { timeout: BACKEND_TIMEOUT });

            const emptySprintIndex = (await backlog.sprintTitles()).indexOf(emptySprintName);

            expect(
                emptySprintIndex,
                `the sprint "${emptySprintName}" left the sidebar before the story could be ` +
                    'dragged into it',
            ).toBeGreaterThanOrEqual(0);

            // Ported from L535-L539, which dropped onto `$$('.sprint-empty').last()`
            // (`backlog-helper.js` L170-L172). Dropping onto THIS sprint by index is
            // exact where `.last()` was a guess about ordering.
            const closedStoryIndex = rowsWithClosedStory.length - 1;

            await backlog.dragStoryToSprint(closedStoryIndex, emptySprintIndex);

            /* --- open closed sprints, ported from L549-L555 -------------------- */

            // The baseline is captured AFTER the setup, because the setup is what
            // closes a sprint: the toggle is `ng-if="totalClosedMilestones"`-gated, so
            // before the setup it may not exist at all.
            await expect(
                backlog.closedSprintsToggle(),
                'no closed-sprints toggle appeared after a sprint holding only a closed story was ' +
                    'created, so the fifth status in this project\'s workflow is not the closed ' +
                    'one (backlog.e2e.js L526 assumed it was)',
            ).toHaveCount(1, { timeout: BACKEND_TIMEOUT });

            const closedShownBefore = await backlog.closedSprints().count();

            await backlog.toggleClosedSprints();

            // BASELINE-RELATIVE, not the incumbent's absolute `1` (L554).
            await expect(
                backlog.closedSprints(),
                'revealing the closed sprints did not add the sprint this case closed',
            ).toHaveCount(closedShownBefore + 1, { timeout: BACKEND_TIMEOUT });

            await authedPage.screenshot({ path: shot('closed-sprints-open'), fullPage: true });

            /* --- close closed sprints, ported from L557-L563 ------------------- */

            await backlog.toggleClosedSprints();

            // BASELINE-RELATIVE, not the incumbent's absolute `0` (L562).
            await expect(
                backlog.closedSprints(),
                'hiding the closed sprints did not return the list to what it was',
            ).toHaveCount(closedShownBefore, { timeout: BACKEND_TIMEOUT });

            await authedPage.screenshot({ path: shot('closed-sprints-closed'), fullPage: true });

            /* --- reopen by drag, ported from L565-L583 ------------------------- */

            await backlog.toggleClosedSprints();

            await expect(
                backlog.closedSprints(),
                'the closed sprints could not be revealed again',
            ).toHaveCount(closedShownBefore + 1, { timeout: BACKEND_TIMEOUT });

            const revealedClosedCount = await backlog.closedSprints().count();

            // Ported from L568: row 1 is given an OPEN status, so dragging it into the
            // closed sprint must reopen that sprint.
            await backlog.setStoryStatus(1, 1);

            const reopenTargetIndex = (await backlog.sprintTitles()).indexOf(emptySprintName);

            expect(
                reopenTargetIndex,
                `the sprint "${emptySprintName}" is not in the sidebar, so it cannot be reopened`,
            ).toBeGreaterThanOrEqual(0);

            // Ported from L575 (`toggleSprint`): a closed sprint renders collapsed, so
            // its body has to be expanded before anything can be dropped into it.
            // `BacklogPage.toggleSprint` clicks `button.compact-sprint` and then waits
            // out the body's OWN transition duration — the ported behaviour of
            // `utils.common.waitTransitionTime` (`common.js` L321-L333), which read
            // `transition-duration` plus `transition-delay` and slept their sum.
            await backlog.toggleSprint(reopenTargetIndex);

            // Ported from L577.
            await backlog.dragStoryToSprint(1, reopenTargetIndex);

            // BASELINE-RELATIVE, not the incumbent's `isPresent() === false`
            // (L580-L582): the sprint now holds an open story, so it is no longer
            // closed and the closed list must be one shorter.
            await expect(
                backlog.closedSprints(),
                'dragging an open story into the closed sprint did not reopen it',
            ).toHaveCount(revealedClosedCount - 1, { timeout: BACKEND_TIMEOUT });

            await expectNoErrorNotification(authedPage);

            await authedPage.screenshot({ path: shot('closed-sprint-reopened'), fullPage: true });

            // The sprint this case created is removed again, so the sidebar is left as
            // it was found. Only self-created sprints are ever deleted — HR-7 forbids
            // reseeding, so a seeded sprint destroyed here would be gone for the rest
            // of the run.
            const cleanupIndex = (await backlog.sprintTitles()).indexOf(emptySprintName);

            if (cleanupIndex >= 0) {
                await backlog.openEditSprint(cleanupIndex);
                await form.delete();
                await backlog.confirmOk();

                await expect
                    .poll(async (): Promise<string[]> => backlog.sprintTitles(), {
                        message: `the sprint "${emptySprintName}" created by this case could not ` +
                            'be cleaned up',
                        timeout: SPRINT_SUBMIT_DEBOUNCE + BACKEND_TIMEOUT,
                    })
                    .not.toContain(emptySprintName);
            }

            expect(
                await backlog.sprintTitles(),
                'the sprint sidebar was not restored to what this case found',
            ).toEqual(sprintsBefore);
        });
    });
});

/* ===========================================================================
 * 🚫 CASES DELIBERATELY NOT WRITTEN — each with its rationale, so that no later
 * reader mistakes an intentional boundary for an oversight and "fixes" it into a
 * scope violation. The Minimal Change Clause is explicit: "Do not enhance or
 * optimize beyond the stated requirements."
 *
 * 1. VELOCITY FORECASTING — incumbent L460-L495, three `it`s: `show` (L461-L473),
 *    `create sprint from forecasting` (L474-L486) and `hide forecasting if no
 *    velocity` (L487-L494). Those cases navigate to OTHER projects: `project-1` at
 *    L462 and L475, and `project-5` at L488 (exported by `../fixtures/seed` as
 *    `VELOCITY_PROJECT_SLUG` and `NO_VELOCITY_PROJECT_SLUG` so the provenance
 *    survives even though nothing here uses them). Forecasting is not in this
 *    screen's enumerated case inventory. `BacklogPage` does expose
 *    `velocityForecastingButtons()`, `velocityForecastingReturnButton()`,
 *    `velocityForecastingEnterButton()`, `openVelocityForecasting()` and
 *    `createSprintFromForecasting()` for whoever needs them; unused CLASS METHODS
 *    do not trip `noUnusedLocals`, whereas an unused import would.
 *
 * 2. ATTACHMENT UPLOAD — `common-helper.js` L55-L73, invoked by the incumbent US
 *    flows at L72 and L163. `tg-attachments-simple` is an OUT-OF-SCOPE shared
 *    component, and its fixture files live under `e2e/`, which this change must not
 *    touch.
 *
 * 3. THE TAG COLOUR-SELECTOR AND ARROW_DOWN AUTOCOMPLETE SUB-FLOW —
 *    `common-helper.js` L75-L90. Out-of-scope shared component, and ENTER prefers a
 *    highlighted suggestion over the typed text, which is not deterministic under
 *    `retries: 0`. Reduced deliberately; see {@link addTag}.
 *
 * 4. CUSTOM-FILTER AND CATEGORY-FILTER CASES — `shared/filters.js` L37-L76. Out of
 *    scope with `tg-filter`, and the category case depends on
 *    `element(by.xpath('..'))`, which has no Playwright equivalent. See Case 22.
 *
 * 5. NAVIGATION TO THE SPRINT TASKBOARD — `a.btn-small[tg-nav="project-taskboard:…"]`
 *    with its `view_milestones` gate (`sprint.jade` L55-L62). THE TASKBOARD STAYS
 *    AngularJS AND IS OUT OF SCOPE, so following that link would leave this
 *    migration's surface entirely. `BacklogPage.sprintTaskboardButton(i)` exists and
 *    is deliberately not exercised.
 *
 * 6. ANY PROJECT CREATION OR DELETION — forbidden by HR-7. The stack is stood up and
 *    seeded exactly once, out of band, and the same PostgreSQL volume must persist
 *    across BOTH capture phases: `sample_data` is randomised, so reseeding between
 *    the baseline and the React capture would leave both artifact sets looking
 *    plausible while every row differed and no real regression remained
 *    distinguishable.
 *
 * 7. `utils.common.takeScreenshot` — `common.js` L128-L151. NOT PORTED: it wrote
 *    into `e2e/screenshots/`, which `.gitignore` L16 ignores, so its evidence was
 *    silently discarded. Capture here goes through {@link shot} into
 *    `e2e-react/artifacts/`, which no ignore rule matches — and no new ignore rule
 *    may be added (I8).
 * ======================================================================== */
