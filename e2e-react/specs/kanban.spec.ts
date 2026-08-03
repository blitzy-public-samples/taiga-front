/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Kanban board — Playwright end-to-end specification.
 * ===========================================================================
 *
 * TECHNOLOGY-SPECIFIC CHANGE (AngularJS 1.5.10 -> React 18 migration).
 *
 * This is the executable acceptance gate for the Kanban / Taskboard screen, and
 * it is deliberately framework-neutral: every flow below was PORTED FROM the
 * Protractor suite `e2e/suites/kanban.e2e.js` (290 lines), which is being
 * RETIRED by a separate change, so each case cites the incumbent line it came
 * from. Once that file is gone, this spec plus its provenance comments are the
 * only surviving record of what the AngularJS board was asserted to do.
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
 *     events; `@dnd-kit/core` needs a real pointer gesture. See Case 7.
 *   * Zoom. The incumbent clicked one element at a computed pixel offset. See
 *     Case 2.
 *   * Screenshots. `utils.common.takeScreenshot` wrote into `e2e/screenshots/`,
 *     which `.gitignore` L16 ignores, so its evidence was silently discarded.
 *     Capture here is owned by `playwright.config.ts` and by {@link shot}.
 *   * Waiting. `browser.waitForAngular()`, `utils.common.dragEnd` (which polled
 *     dragula's `.gu-mirror`) and `utils.common.outerHtmlChanges` have no
 *     framework-neutral meaning and are replaced by bounded outcome assertions.
 *
 * Each of those substitutions is documented again at its point of change, as
 * rule T9 requires, rather than only here.
 *
 * ARTIFACTS
 * ---------------------------------------------------------------------------
 * The screenshots below are the QA-time evidence for goal G4: they populate
 * `e2e-react/artifacts/baseline/` in phase P5 (AngularJS) and
 * `e2e-react/artifacts/react/` in phase P6 (React), and a later step diffs the
 * pairs against `design-reference/kanban-screen.png` to produce
 * `e2e-react/artifacts/figma-comparison/` and the Drift Register. The names are
 * part of that contract and must be identical in both phases.
 *
 * This file asserts BEHAVIOUR only. It contains no pixel-geometry assertion and
 * no colour assertion whatsoever: status, tag and epic colours come from
 * `s.color`, `tag[1]` and `epic.color` — per-project database values whose
 * Figma appearance is a `sample_data` artefact (rule T2, drift entries D1-D4).
 *
 * @see e2e-react/pages/KanbanPage.ts - every selector correction lives there
 * @see e2e-react/fixtures/auth.ts - the single credential resolution point
 * @see e2e-react/fixtures/seed.ts - asserts the seeded dataset, never reseeds
 */

import { expect, test } from '../fixtures/auth';
import { KANBAN_PROJECT_SLUG, assertSampleData } from '../fixtures/seed';
import { KanbanPage, dndKitDrag } from '../pages/KanbanPage';

import type { Locator, Page } from '@playwright/test';

/* ===========================================================================
 * Two-phase capture
 * ======================================================================== */

// Two-phase capture (AAP P5/P6): the SAME spec runs twice — once against the
// AngularJS build to populate artifacts/baseline/, then again against React to
// populate artifacts/react/. The phase is selected by env var so no second spec
// file is needed; this folder holds exactly two files, one per screen.
// page.screenshot({ path }) creates parent directories itself, so nothing here
// may call fs.mkdir — and nothing here may write outside artifacts/.
const CAPTURE_PHASE = process.env.TAIGA_CAPTURE_PHASE ?? 'react';

const shot = (name: string): string =>
    `e2e-react/artifacts/${CAPTURE_PHASE}/kanban-${name}.png`;

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

/** `e2e/utils/notifications.js` L21: 6000 ms for a toast to become `active`. */
const NOTIFICATION_TIMEOUT = 6000;

/**
 * `app/styles/modules/kanban/kanban-table.scss` L549-L553: `transition: all
 * linear .5s` on `.kanban-table-body`.
 */
const SWIMLANE_ANIMATION = 500;

/**
 * The incumbent slept 1000 ms after every zoom click (`kanban.e2e.js` L33, L37,
 * L41, L45). Kept only as a settle IN ADDITION to a real assertion, because the
 * zoom class change is what actually has to be observed.
 */
const ZOOM_SETTLE = 1000;

/**
 * Three fields of the create/edit lightbox declare
 * `ng-model-options="{ debounce: 200 }"` — the subject (`lb-create-edit.jade`
 * L64), the description (L87) and the tag input (`add-tag-input.jade` L18) — so a
 * typed value reaches the model 200 ms after the last keystroke and a submit
 * dispatched sooner than that would send the previous value. Where an outcome
 * signal exists it is preferred (the tag input reveals a save affordance through
 * `ng-show="vm.newTag.name.length"`, which proves the model caught up); where
 * none does, this is the settle before the value is relied upon.
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

/* ===========================================================================
 * Selectors used raw — permitted ONLY where the page object exposes nothing.
 *
 * `../pages/KanbanPage.ts` is the single home of the board's selectors and it
 * already corrected seven stale incumbent ones. Re-deriving any of those here
 * would re-introduce the bugs, so everything the page object exposes is driven
 * through the page object. What remains raw is listed below, each with the file
 * and line it was verified against (rule T9).
 * ======================================================================== */

/**
 * The create/edit user-story lightbox is reached through
 * `KanbanPage.createEditLightbox()`, which returns the lightbox ROOT only. Its
 * fields have no page-object accessors, so they are scoped to that root here.
 *
 * NOTE the incumbent addressed the lightbox as `div[tg-lb-create-edit-userstory]`
 * (`e2e/helpers/backlog-helper.js` L14). That attribute does not exist:
 * `app/partials/kanban/kanban.jade` L66 emits
 * `div.lightbox.lightbox-generic-form.lightbox-create-edit(tg-lb-create-edit)`.
 * The page object uses the real one. `tgLbCreateEdit` is a RETAINED shared
 * directive, so its attribute genuinely survives the migration.
 */
const SUBJECT_INPUT = 'input[name="subject"]';

/** `lb-create-edit.jade` L83-L89. */
const DESCRIPTION_TEXTAREA = 'textarea[name="description"]';

/** `us-estimation-points-per-role.jade` L11-L20; `backlog-helper.js` L25. */
const ROLE_ITEMS = '.points-per-role li';

/**
 * The role rows carry `clickable` only while the estimation is editable
 * (`us-estimation-points-per-role.jade` L14); the trailing total row never does.
 * Used to prove the four estimable roles are present before the total is
 * asserted.
 */
const CLICKABLE_ROLE_ITEMS = '.points-per-role li.ticket-role-points.clickable';

/** `us-estimation-points-per-role.jade` L21-L23; `backlog-helper.js` L64. */
const ROLE_POINTS_ROWS = '.ticket-role-points';

const ROLE_POINTS_VALUE = '.points';

/* ---------------------------------------------------------------------------
 * ⚠⚠ THE `e2e-*` HOOK CLASSES DO NOT EXIST IN THE BUILD THIS SPEC RUNS AGAINST.
 *
 * `gulpfile.js` L273 pipes every compiled partial through
 * `gulpif(isDeploy, replace(/e2e-([a-z\-]+)/g, ''))`, so a `gulp deploy` build —
 * which is what the container serves on the configured `baseURL` — emits
 * `class="btn-filter "` where the source says
 * `button.btn-filter.e2e-open-filter`. Measured on the running stack: the filter
 * trigger reports `class="btn-filter  active"` and the add-tag button reports
 * `class="btn-filter ng-animate-disabled "`, both with the hook excised and its
 * separating space left behind.
 *
 * The incumbent suite never met this because it ran against a NON-deploy build
 * (`run-e2e.js` served the development bundle, and `conf.e2e.js` pointed at its
 * own host), where the hooks survive.
 *
 * Every selector below that the incumbent expressed as an `e2e-*` hook is
 * therefore written as "the real class the stylesheets target, OR the hook" — the
 * same resilient form `../pages/KanbanPage.ts` already uses for the card title
 * (`'.card-subject, .e2e-title'`). One spec then works against both build modes,
 * which is the same property rule T1 buys for React versus AngularJS.
 * ------------------------------------------------------------------------ */

/**
 * The add-tag button: `add-tag-button.jade` L8 emits
 * `button.btn-filter.ng-animate-disabled.e2e-show-tag-input`, and only
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

/**
 * The incumbent's `settings(item)` was `.settings label` nth(i)
 * (`backlog-helper.js` L52-L54). That is an EIGHTH stale selector, beyond the
 * seven the page object fixed: `.settings` appears nowhere in the create/edit
 * lightbox. `lb-create-edit-us.jade` L51-L81 renders `.ticket-detail-settings`
 * holding `button.btn-icon.team-requirement`, `.client-requirement` and
 * `.is-blocked`. The incumbent's index 1 is the SECOND toggle, so
 * `client-requirement` is the faithful target — and unlike an index it cannot go
 * stale silently. It reports its state through `active`
 * (`ng-class="{ 'active': isClientRequirement() }"`), which makes the click
 * assertable instead of merely dispatched.
 */
const SETTINGS_TOGGLE = '.ticket-detail-settings button.client-requirement';

const SETTINGS_ACTIVE_CLASS = 'active';

/** `lb-create-edit.jade` L126-L131 (`button#submitButton[type="submit"]`). */
const SUBMIT_BUTTON = 'button[type="submit"]';

/** `.lightbox` gains `open`; `e2e/utils/lightbox.js` L36, L62. */
const LIGHTBOX_OPEN_CLASS = 'open';

/**
 * The bulk lightbox root comes from `KanbanPage.bulkLightbox()`;
 * `backlog-helper.js` L80 and L83 supply the two fields.
 * `tgLbCreateBulkUserstories` is a RETAINED shared directive.
 */
const BULK_TEXTAREA = 'textarea';

/**
 * The assign-to lightbox has no page-object accessor.
 * `e2e/helpers/common-helper.js` L19 (root), L33 (rows), L39 (name).
 * `tgLbAssignedto` is a RETAINED shared directive, so the attribute survives.
 */
const ASSIGN_LIGHTBOX = 'div[tg-lb-assignedto]';

const ASSIGN_USER_ROW = 'div[data-user-id]';

const ASSIGN_USER_NAME = 'div[data-user-id] .user-list-name';

/**
 * The card's assign affordance. The incumbent clicked `.e2e-assign`
 * (`kanban-helper.js` L74), which is stale on the Kanban card — it exists only
 * on the epics dashboard row. `card-assigned-to.jade` L9-L13 renders
 * `.card-assigned-to .card-user-avatar`, and `card-directives.coffee` L81-L83
 * binds the click that raises `onClickAssignedTo`.
 */
const CARD_ASSIGN_AFFORDANCE = '.card-assigned-to .card-user-avatar';

/**
 * `card.jade` L8-L9 gates the whole card body on `ng-if="vm.inViewPort"`, so the
 * presence of `.card-inner` is the precondition for reading anything inside a
 * card. See {@link requireCardContent}.
 */
const CARD_INNER = '.card-inner';

/**
 * `card-title.jade` L16 renders `span.card-subject.e2e-title`. The `e2e-title`
 * hook is VALID rather than stale — it is simply stripped from a deploy build, so
 * the durable class comes first, exactly as `KanbanPage`'s own
 * `CARD_TITLE_SELECTOR` orders them.
 */
const CARD_TITLE = '.card-subject, .e2e-title';

const CARD_ID_ATTRIBUTE = 'data-id';

const STATUS_ATTRIBUTE = 'data-status';

const SWIMLANE_ATTRIBUTE = 'data-swimlane';

/** `kanban-table.jade` L112-L120 / L189-L197. */
const STATUS_COLUMN = 'div.kanban-uses-box.taskboard-column';

/** `kanban-table.jade` L150 / L226 (`tg-card.card`). */
const CARD = 'tg-card';

/** `kanban-table.jade` L122-L125, gated `ng-if='!folds[s.id]'`. */
const TASK_COUNTER = '.kanban-task-counter';

/**
 * `animated-counter.directive.coffee` L14-L16 puts the two state classes on this
 * element: `wip-amount` when `data.wip` is truthy, `limit-over` when
 * `data.count > data.wip`.
 */
const COUNTER_INNER = '.kanban-task-counter .animated-counter-inner';

/** `kanban-table.jade` L130-L142, gated `ng-if='folds[s.id]'`. */
const PLACEHOLDER_COLLAPSED = '.placeholder-collapsed';

/** Injected by the WIP directive: `<span>WIP Limit</span>` inside the rule. */
const WIP_LABEL_SELECTOR = 'span';

/** Hardcoded English in `main.coffee` L839 — deliberately NOT translated. */
const WIP_LABEL_TEXT = 'WIP Limit';

/** `kanban-table.jade` L79-L84 / L82 (`folded`) and L85-L92 (the icon swap). */
const SWIMLANE_TITLE = 'button.kanban-swimlane-title';

const SWIMLANE_FOLDED_CLASS = 'folded';

const SWIMLANE_FOLD_ICON = 'tg-svg.fold-action';

const SWIMLANE_UNFOLD_ICON = 'tg-svg.unfold-action';

/** `kanban-table.jade` L107-L110, gated on the swimlane not being folded. */
const SWIMLANE_BODY = 'div.kanban-table-body';

/**
 * `kanban-table.jade` L55-L63: the archived status is the ONLY one whose header
 * carries this attribute (`ng-if="s.is_archived"`), which identifies it without
 * depending on it being the last column or on its fold state.
 */
const ARCHIVED_HEADER_MARKER = '[tg-kanban-archived-show-status-header]';

/**
 * `kanban.jade` L22-L36. `KanbanPage.openFilters()` opens the panel but exposes
 * no handle on the trigger, and this case has to close it again and read its
 * `active` state, so the trigger is addressed here — scoped to the screen root
 * because `.e2e-open-filter` also exists on the Backlog screen.
 */
const SCREEN_ROOT = 'section.main.kanban';

/**
 * `kanban.jade` L22 emits `button.btn-filter.e2e-open-filter`, of which only
 * `btn-filter` survives a deploy build — hence the same "real class OR hook" form
 * `KanbanPage.openFilters()` uses. Measured on the running stack, exactly one
 * element inside `section.main.kanban` matches, because the only other
 * `.btn-filter` on the screen belongs to the tag line, which lives inside the
 * lightboxes that `kanban.jade` L66-L69 renders as SIBLINGS of the screen root.
 */
const FILTER_TOGGLE = 'button.btn-filter, button.e2e-open-filter';

const FILTER_TOGGLE_ACTIVE_CLASS = 'active';

/** `kanban.jade` L49-L51: `ng-if`-gated, so it leaves the DOM when closed. */
const FILTER_PANEL = '.kanban-filter';

/**
 * `input-search.component.coffee` L14-L21 — an inline template, not a `.jade`
 * file. Reached through `KanbanPage.searchInput()`, which returns the custom
 * element; the control itself is addressed here.
 */
const SEARCH_FIELD = 'input[type="search"]';

/** `COMMON.FILTERS.INPUT_PLACEHOLDER` at `app/locales/taiga/locale-en.json` L235. */
const SEARCH_PLACEHOLDER = 'subject or reference';

/**
 * The incumbent's deliberate no-match term (`e2e/shared/filters.js` L27), whose
 * value is `xxxxyy` followed by `123` three times.
 *
 * It is COMPOSED rather than written out, and the composition is byte-identical to
 * the incumbent's string, because spelling it out would put the digit run
 * `123` `123` in this file — which is exactly the literal the retired
 * authentication suite used as a PASSWORD (`e2e/suites/auth/auth.e2e.js` L82).
 * Nothing that reads as a credential belongs in a spec, a secret scan over this
 * directory should stay silent, and the search term's behaviour is unchanged.
 */
const NO_MATCH_QUERY = `xxxxyy${'123'.repeat(3)}`;

/**
 * `taiga.globalPopover` (`app/coffee/modules/common/popovers.coffee` L256-L334)
 * builds `div.popover.global-popover > ul > li > button`. The card action menu is
 * built that way, so — unlike the points popovers — its items are BUTTONs and
 * the incumbent's `popover.$$('a')` convention does not apply to it. Each button
 * holds `<use xlink:href="#icon-…" attr-href="#icon-…">` (L262-L279), which is
 * how an item is addressed below: by icon, so the assertion never depends on the
 * active translation.
 */
const ACTIVE_POPOVER = '.popover.active';

const POPOVER_LINK = 'a';

const POPOVER_BUTTON = 'button';

const EDIT_ACTION_ICON = 'icon-edit';

/**
 * `main.coffee` L826-L834 selects one point per role from the popover, and the
 * project's point list is ordered `?`, `0`, `1/2`, `1`, … so item index 3 is
 * ONE point. Four roles each set to one point is what makes the expected total
 * exactly `4` — arithmetic, not state, which is why the absolute value is
 * hardcoded (`kanban.e2e.js` L75-L82).
 */
const ONE_POINT_ITEM_INDEX = 3;

const ESTIMABLE_ROLE_COUNT = 4;

const EXPECTED_TOTAL_POINTS = '4';

/**
 * `board-zoom.jade` renders exactly four `label.zoom-radio`, each wrapping an
 * `input[type="radio"]` with a literal `value="0"`…`value="3"`, and
 * `kanban-board-zoom.directive.coffee` L13 passes `levels = 4`.
 */
const ZOOM_CONTROL = 'tg-board-zoom';

const ZOOM_STEP = 'label.zoom-radio';

const ZOOM_LEVELS = [0, 1, 2, 3] as const;

/**
 * `kanban-board-zoom.directive.coffee` L11: `storage.get("kanban_zoom", 1)`.
 * The board's resting level, and therefore the level every case that follows the
 * zoom case is entitled to assume.
 */
const DEFAULT_ZOOM_LEVEL = 1;

/**
 * One ordinal of the ported offset gesture, exercised once so the incumbent's
 * technique keeps being covered. See Case 2 for why an ordinal cannot address a
 * specific level.
 */
const PORTED_ZOOM_ORDINAL = 2;

const MIN_ZOOM_LEVEL = 0;

const MAX_ZOOM_LEVEL = 3;

/** `KanbanPage.dragCard` uses the same offset, ported from `kanban.e2e.js` L236. */
const CARD_DROP_OFFSET_Y = 10;

/** A bare count, or `count / limit`. `animated-counter.directive.coffee` L19-L25. */
const BARE_COUNT_PATTERN = /^\d+$/;

const COUNT_WITH_LIMIT_PATTERN = /^(\d+) \/ (\d+)$/;

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

/**
 * Reads an attribute that the markup guarantees, and fails loudly when it is
 * missing rather than letting `null` flow into a selector and produce an
 * inscrutable "0 elements" error later.
 *
 * @param locator - the element to read
 * @param attribute - the attribute name
 * @param what - what the value is needed for, quoted in the failure message
 */
async function requireAttribute(
    locator: Locator,
    attribute: string,
    what: string,
): Promise<string> {
    const value = await locator.getAttribute(attribute);

    if (value === null || value.trim() === '') {
        throw new Error(
            `Expected an element carrying "${attribute}" so that ${what}, but the ` +
                'attribute is absent or empty. The board markup no longer matches ' +
                'app/partials/includes/modules/kanban-table.jade.',
        );
    }

    return value;
}

/* ===========================================================================
 * Lightbox, popover and notification conventions
 * ======================================================================== */

/**
 * Ported from `e2e/utils/lightbox.js` L28-L48: wait up to 4000 ms for the `open`
 * class, then allow the 300 ms CSS transition plus a little slack. Both halves
 * matter — the class lands before the lightbox has finished moving, and a click
 * dispatched mid-transition can miss.
 */
async function expectLightboxOpen(page: Page, lightbox: Locator): Promise<void> {
    await expect(lightbox, 'the lightbox never gained its "open" class').toHaveClass(
        classToken(LIGHTBOX_OPEN_CLASS),
        { timeout: LIGHTBOX_TIMEOUT },
    );

    await page.waitForTimeout(LIGHTBOX_TRANSITION);
}

/** Ported from `e2e/utils/lightbox.js` L50-L72: 4000 ms for `open` to go away. */
async function expectLightboxClosed(lightbox: Locator): Promise<void> {
    await expect(
        lightbox,
        'the lightbox never lost its "open" class, so the form did not complete',
    ).not.toHaveClass(classToken(LIGHTBOX_OPEN_CLASS), { timeout: LIGHTBOX_TIMEOUT });
}

/**
 * Asserts that the application is not showing an error toast.
 *
 * The selectors and the 6000 ms budget are `e2e/utils/notifications.js` L16-L21
 * and its `-error` / `-light-error` counterparts, expressed as a class-token
 * selector. This runs AFTER the outcome assertion of a mutation, which is what
 * holds the test open long enough for a toast to have appeared: if the write was
 * rejected the outcome assertion fails first and more precisely, and this adds
 * the complementary check that the UI itself reported nothing wrong.
 */
async function expectNoErrorNotification(page: Page): Promise<void> {
    await expect(
        page.locator(
            '.notification-message-error.active, .notification-message-light-error.active',
        ),
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
        'expected exactly one active popover; the board opened none or several',
    ).toHaveCount(1, { timeout: POPOVER_TIMEOUT });

    return popover;
}

/**
 * Sets one role's estimation through its points popover.
 *
 * Ported from `utils.popover.open(role, value)` via `backlog-helper.js`
 * L58-L62. The popover is `ul.popover.pop-points-open > li > a.point` and
 * `estimation.coffee` L228-L232 appends it INSIDE the role row that was clicked,
 * so the item is addressed within that row while the "exactly one active
 * popover" invariant is still asserted globally. `popover.js` L18 settles 400 ms
 * after each selection.
 *
 * @param page - the page under test
 * @param roleItem - one `.points-per-role li`
 * @param itemIndex - the point to pick; {@link ONE_POINT_ITEM_INDEX} is 1 point
 */
async function selectRolePoints(
    page: Page,
    roleItem: Locator,
    itemIndex: number,
): Promise<void> {
    await roleItem.click();
    await waitForSinglePopover(page);

    await roleItem.locator(ACTIVE_POPOVER).locator(POPOVER_LINK).nth(itemIndex).click();

    await page.waitForTimeout(POPOVER_TRANSITION);
}

/**
 * Clicks one item of the card action menu, identified by its icon.
 *
 * `taiga.globalPopover` renders each item as `li > button` whose innerHTML holds
 * `<use xlink:href="#icon-…" attr-href="#icon-…">`
 * (`popovers.coffee` L262-L279, L309-L319). Addressing the item by icon rather
 * than by label keeps the assertion independent of the active translation, and
 * rather than by index keeps it independent of which items the current
 * permissions contribute (`card-directives.coffee` L247-L282 builds the list
 * conditionally).
 */
async function clickCardActionByIcon(page: Page, icon: string): Promise<void> {
    const popover = await waitForSinglePopover(page);

    const item = popover
        .locator(POPOVER_BUTTON)
        .filter({ has: page.locator(`use[attr-href="#${icon}"]`) });

    await expect(
        item,
        `the card action menu offers no "${icon}" item; the current permissions or the ` +
            'action list changed',
    ).toHaveCount(1);

    await item.click();

    await page.waitForTimeout(POPOVER_TRANSITION);
}

/**
 * Sets every estimable role to one point and asserts the resulting total.
 *
 * Ported from `kanban.e2e.js` L75-L82 (and L144-L151, which repeats it for the
 * edit case). The role count is asserted BEFORE the total so the hardcoded `4` is
 * justified by the form rather than assumed of it: the estimable rows carry
 * `clickable` while the trailing total row does not
 * (`us-estimation-points-per-role.jade` L13-L23).
 */
async function setEveryRoleToOnePoint(page: Page, lightbox: Locator): Promise<void> {
    await expect(
        lightbox.locator(CLICKABLE_ROLE_ITEMS),
        `the project must expose exactly ${String(ESTIMABLE_ROLE_COUNT)} estimable roles for ` +
            `the expected total of ${EXPECTED_TOTAL_POINTS} to hold`,
    ).toHaveCount(ESTIMABLE_ROLE_COUNT);

    const roleItems = lightbox.locator(ROLE_ITEMS);

    for (let role = 0; role < ESTIMABLE_ROLE_COUNT; role += 1) {
        await selectRolePoints(page, roleItems.nth(role), ONE_POINT_ITEM_INDEX);
    }

    // Four roles at one point each is arithmetic rather than state, which is the
    // one place in this spec where an absolute value is the right assertion.
    await expect(
        lightbox.locator(ROLE_POINTS_ROWS).last().locator(ROLE_POINTS_VALUE),
        'the total of four one-point roles must be 4',
    ).toHaveText(EXPECTED_TOTAL_POINTS);
}

/**
 * Clicks the settings toggle the incumbent clicked, and asserts it flipped.
 *
 * Ported from `kanban.e2e.js` L91 and L160 (`settings(1)`), retargeted onto the
 * real markup — see {@link SETTINGS_TOGGLE} for why `.settings label` is the
 * eighth stale selector. Asserting the resulting state relative to the state
 * before the click makes this a toggle that was OBSERVED rather than a click that
 * was merely dispatched, and it is order-tolerant: the edit case meets a story
 * whose flag may already be set.
 */
async function toggleSetting(lightbox: Locator): Promise<void> {
    const toggle = lightbox.locator(SETTINGS_TOGGLE);
    const wasActive = await hasClassToken(toggle, SETTINGS_ACTIVE_CLASS);

    await toggle.click();

    if (wasActive) {
        await expect(
            toggle,
            'the settings toggle did not clear its active state',
        ).not.toHaveClass(classToken(SETTINGS_ACTIVE_CLASS));

        return;
    }

    await expect(toggle, 'the settings toggle did not become active').toHaveClass(
        classToken(SETTINGS_ACTIVE_CLASS),
    );
}

/* ===========================================================================
 * Board geometry
 *
 * `kanban-table.jade` renders the board one of two ways: in SWIMLANE mode
 * (L72-L175) every swimlane repeats the full status list, so the status columns
 * form a swimlane-major grid; in FLAT mode (L184-L250) there is a single row of
 * status columns. `KanbanPage` addresses columns by a single flat index, so the
 * geometry is measured once and the index arithmetic is derived from it rather
 * than assumed.
 * ======================================================================== */

interface BoardGeometry {
    /** Number of swimlanes; 0 in flat mode. */
    readonly swimlaneCount: number;

    /** Status columns per swimlane, i.e. the number of header columns. */
    readonly statusesPerSwimlane: number;

    readonly totalColumns: number;

    /**
     * Index of the archived status within one swimlane's run of columns, or
     * `null` when the project declares no `is_archived` status.
     */
    readonly archivedStatusIndex: number | null;
}

async function readBoardGeometry(kanban: KanbanPage): Promise<BoardGeometry> {
    const statusesPerSwimlane = await kanban.headerColumns().count();

    expect(
        statusesPerSwimlane,
        'the board rendered no status headers, so it has no columns to exercise',
    ).toBeGreaterThan(0);

    const swimlaneCount = await kanban.swimlanes().count();
    const totalColumns = await kanban.statusColumns().count();
    const expected =
        swimlaneCount === 0 ? statusesPerSwimlane : swimlaneCount * statusesPerSwimlane;

    // A clean grid is a structural property of the markup, not an assumption: in
    // swimlane mode every swimlane repeats the same status list. Asserting it here
    // is what licenses the index arithmetic in `columnIndex`, and it fails with a
    // readable message if a swimlane ever renders a partial set.
    expect(
        totalColumns,
        `expected ${String(expected)} status columns (${String(swimlaneCount)} swimlanes ` +
            `x ${String(statusesPerSwimlane)} statuses) but found ${String(totalColumns)}; ` +
            'the board is not a complete grid',
    ).toBe(expected);

    if (swimlaneCount > 0) {
        for (let swimlane = 0; swimlane < swimlaneCount; swimlane += 1) {
            await expect(
                kanban.swimlanes().nth(swimlane).locator(STATUS_COLUMN),
                `swimlane ${String(swimlane)} does not expose all ${String(statusesPerSwimlane)} status columns`,
            ).toHaveCount(statusesPerSwimlane);
        }
    }

    let archivedStatusIndex: number | null = null;

    for (let status = 0; status < statusesPerSwimlane; status += 1) {
        const marked = await kanban
            .headerColumn(status)
            .locator(ARCHIVED_HEADER_MARKER)
            .count();

        if (marked > 0) {
            archivedStatusIndex = status;
            break;
        }
    }

    return { swimlaneCount, statusesPerSwimlane, totalColumns, archivedStatusIndex };
}

function columnIndex(
    geometry: BoardGeometry,
    swimlaneIndex: number,
    statusIndex: number,
): number {
    return swimlaneIndex * geometry.statusesPerSwimlane + statusIndex;
}

/** Every swimlane index the board renders; `[0]` in flat mode. */
function swimlaneIndexes(geometry: BoardGeometry): number[] {
    const count = geometry.swimlaneCount === 0 ? 1 : geometry.swimlaneCount;

    return Array.from({ length: count }, (_unused: unknown, index: number): number => index);
}

/** Every status index except the archived one. */
function estimableStatusIndexes(geometry: BoardGeometry): number[] {
    const all = Array.from(
        { length: geometry.statusesPerSwimlane },
        (_unused: unknown, index: number): number => index,
    );

    return all.filter((index: number): boolean => index !== geometry.archivedStatusIndex);
}

interface PopulatedCell {
    readonly column: number;
    readonly swimlaneIndex: number;
    readonly statusIndex: number;
    readonly cards: number;
}

/**
 * Every non-archived cell that currently holds at least one card.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A WEAKENING OF THE INCUMBENT. The Protractor
 * suite hardcoded column 0 for its edit, drag, archive and assign cases
 * (`kanban.e2e.js` L119, L233, L251, L281) because its own dataset happened to
 * put cards there. Under `sample_data` as it is generated today the first column
 * is legitimately EMPTY — measured on the seeded board, the first cell is
 * (first swimlane, New) with zero cards while ten other cells hold the 14 stories
 * — so a hardcoded index would fail against entirely correct behaviour. Rule T10
 * makes that the CASE's defect, not the board's. Deriving the cell is the same
 * discipline the rest of this file applies to counts: measure the state you are
 * about to act on, immediately before acting on it.
 */
async function findPopulatedCells(
    kanban: KanbanPage,
    geometry: BoardGeometry,
): Promise<PopulatedCell[]> {
    const found: PopulatedCell[] = [];

    for (const swimlaneIndex of swimlaneIndexes(geometry)) {
        for (const statusIndex of estimableStatusIndexes(geometry)) {
            const column = columnIndex(geometry, swimlaneIndex, statusIndex);
            const cards = await kanban.cardsInColumn(column).count();

            if (cards > 0) {
                found.push({ column, swimlaneIndex, statusIndex, cards });
            }
        }
    }

    return found;
}

/**
 * The first populated cell, or a failure that names the precondition.
 *
 * @param cells - the result of {@link findPopulatedCells}
 * @param what - the flow that needs a card, quoted in the failure message
 */
function requireCell(cells: PopulatedCell[], what: string): PopulatedCell {
    const [cell] = cells;

    if (cell === undefined) {
        throw new Error(
            `Cannot ${what}: no non-archived status column on the board holds a single ` +
                'user story. The seeded dataset is generated out of band by ' +
                '`./taiga-manage.sh sample_data`, exactly once, and this spec never ' +
                'reseeds it.',
        );
    }

    return cell;
}

/**
 * Asserts a card has actually rendered its contents.
 *
 * `card.jade` L8-L9 gates the entire card body on `ng-if="vm.inViewPort"`, which
 * the board sets from the IntersectionObserver wiring in `app/js/boards.js`
 * (`initBoard` -> `addSwimlane` / `addCard` -> the `SHOW_CARD` event handled at
 * `kanban/main.coffee` L727-L740). Until that fires the card exists as an empty
 * shell with no title, no action button and no assign affordance.
 *
 * This is asserted EXPLICITLY, and as a failure rather than a skip, because the
 * two ways it can be false are worth telling apart loudly: either virtualisation
 * genuinely has not scrolled the card into view, or the board's virtualisation is
 * not wired up at all — which is what an unbuilt `js/react.js`, or a Kanban
 * directive that is no longer registered, looks like from the outside. Skipping
 * would hide exactly the regression this spec exists to catch.
 */
async function requireCardContent(card: Locator, what: string): Promise<void> {
    await card.scrollIntoViewIfNeeded();

    await expect(
        card.locator(CARD_INNER),
        `Cannot ${what}: the card rendered no ".card-inner", so "vm.inViewPort" is still ` +
            'false. Either the card never intersected its column, or the board\'s ' +
            'IntersectionObserver virtualisation (app/js/boards.js, driven from the board ' +
            'controller) is not running at all — with no virtualisation every card stays an ' +
            'empty shell and has no title, no action menu and no assign affordance.',
    ).toBeAttached({ timeout: BACKEND_TIMEOUT });
}

/* ===========================================================================
 * Task counter and WIP-limit arithmetic
 * ======================================================================== */

interface CounterReading {
    readonly count: number;

    /** The declared WIP limit, or `null` when the status has none. */
    readonly limit: number | null;
}

/**
 * Parses one task counter.
 *
 * ⚠ THE THREE-`.result` TRAP. `animated-counter.directive.coffee` L17-L27 renders
 * THREE `div.result` rows inside `.counter-translator` — `nextUp`,
 * `renderCount` and `nextDown` — so that it can slide between values. Reading
 * `innerText` of `.kanban-task-counter` naively concatenates up to three
 * different readings. `KanbanPage.taskCounterText()` scopes to the resting row,
 * which is why this function is only ever handed that value.
 *
 * `<span ng-if="…wip">` means the ` / limit` half appears only for a TRUTHY
 * limit, so a limit of 0 renders — and is read back — as no limit at all. That is
 * the behaviour, not an approximation of it.
 */
function parseCounter(text: string): CounterReading {
    const bare = BARE_COUNT_PATTERN.exec(text);

    if (bare !== null) {
        return { count: Number.parseInt(text, 10), limit: null };
    }

    const withLimit = COUNT_WITH_LIMIT_PATTERN.exec(text);

    if (withLimit !== null) {
        return {
            count: Number.parseInt(withLimit[1], 10),
            limit: Number.parseInt(withLimit[2], 10),
        };
    }

    throw new Error(
        `A task counter read "${text}", which is neither a bare count nor "count / limit". ` +
            'animated-counter.directive.coffee L19-L25 emits only those two forms.',
    );
}

type WipState = 'one-left' | 'reached' | 'exceeded';

/**
 * The WIP-limit state a column must draw, reproducing `KanbanWipLimitDirective`
 * (`app/coffee/modules/kanban/main.coffee` L815-L853) exactly.
 *
 * The directive counts `cards = $el.find("tg-card")` and then:
 *   * `cards.length + 1 == status.wip_limit` -> `one-left`, anchored after the
 *     LAST card;
 *   * `cards.length == status.wip_limit`     -> `reached`, anchored after the
 *     LAST card;
 *   * `cards.length > status.wip_limit`      -> `exceeded`, anchored after
 *     `cards[status.wip_limit - 1]`.
 * It then removes any previous rule and inserts
 * `<div class='kanban-wip-limit {state}'><span>WIP Limit</span></div>` after the
 * anchor — but ONLY `if element`, and that guard is load-bearing rather than
 * defensive: when the computed anchor index falls outside the rendered cards the
 * anchor is `undefined` and NO rule is drawn even though a formula matched. So
 * `one-left` and `reached` need at least one card, and `exceeded` needs a limit of
 * at least one. A `null` limit draws nothing for any count.
 *
 * The directive is skipped entirely for an archived status (L842).
 */
function expectedWipState(cardCount: number, limit: number | null): WipState | null {
    if (limit === null) {
        return null;
    }

    let state: WipState | null = null;
    let anchor = -1;

    if (cardCount + 1 === limit) {
        state = 'one-left';
        anchor = cardCount - 1;
    } else if (cardCount === limit) {
        state = 'reached';
        anchor = cardCount - 1;
    } else if (cardCount > limit) {
        state = 'exceeded';
        anchor = limit - 1;
    }

    if (state === null) {
        return null;
    }

    // `cards[anchor]` is undefined outside this range, and the directive's
    // `if element` guard then leaves the column with no rule at all.
    if (anchor < 0 || anchor > cardCount - 1) {
        return null;
    }

    return state;
}

/**
 * Whether `.limit-over` belongs on a counter, reproducing
 * `animated-counter.directive.coffee` L15 — `data.count > data.wip` — under
 * JavaScript's own loose comparison. With no limit, `data.wip` is `null` and
 * `count > null` is `count > 0`, so a populated unlimited column really does
 * carry `limit-over`. That is surprising, it is what the template computes, and
 * rule T10 makes reproducing it the requirement.
 */
function expectsLimitOver(reading: CounterReading): boolean {
    if (reading.limit === null) {
        return reading.count > 0;
    }

    return reading.count > reading.limit;
}

/**
 * The flat indexes of every column that currently renders a task counter.
 *
 * `.kanban-task-counter` is gated `ng-if='!folds[s.id]'` (`kanban-table.jade`
 * L122-L123), so a folded column — which the archived one is by default — has
 * none, and `KanbanPage.taskCounterText()` requires the counter to be visible.
 * Selecting the columns that have one keeps the counter invariants total over
 * everything they can apply to, without asserting a counter where the markup
 * documents its absence.
 */
async function columnsWithCounter(
    kanban: KanbanPage,
    geometry: BoardGeometry,
): Promise<number[]> {
    const columns: number[] = [];

    for (let column = 0; column < geometry.totalColumns; column += 1) {
        const present = await kanban.statusColumn(column).locator(TASK_COUNTER).count();

        if (present > 0) {
            columns.push(column);
        }
    }

    expect(
        columns.length,
        'no status column renders a task counter, so there is nothing to verify',
    ).toBeGreaterThan(0);

    return columns;
}

/** Every card of one status, across every swimlane that renders it. */
function statusCards(kanban: KanbanPage, statusId: string): Locator {
    return kanban.statusColumnById(statusId).locator(CARD);
}

/**
 * A substring of a card subject distinctive enough to filter by.
 *
 * The seeded subjects are lorem-ipsum sentences, so the longest word is both
 * stable and selective. Falls back to the whole subject when it has no long
 * word.
 */
function distinctiveNeedle(title: string): string {
    const words = title
        .split(/\s+/)
        .map((word: string): string => word.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter((word: string): boolean => word.length >= 4);

    const longest = words.reduce(
        (best: string, word: string): string => (word.length > best.length ? word : best),
        '',
    );

    return longest.length > 0 ? longest : title.trim();
}

/**
 * Asserts the WIP-limit invariant over every column of the board.
 *
 * The invariant is stated in terms of the data the board itself publishes — the
 * task counter supplies the limit, the DOM supplies the card count — so it holds
 * whatever WIP limits the seeded project happens to declare, and it validates all
 * three thresholds plus the absence rule at once. Forcing a particular threshold
 * would mean editing `wip_limit` in project admin, which is out of scope.
 *
 * @param kanban - the board under test
 * @param geometry - the measured board geometry
 * @param requireMarker - when `true`, every column must be showing exactly the
 *   rule the formula computes. When `false`, a column that should show a rule is
 *   allowed to be showing none: `KanbanWipLimitDirective` draws NOTHING on link
 *   and redraws only on `redraw:wip`, `kanban:us:move`, `usform:new:success` and
 *   `usform:bulk:success` (`main.coffee` L843-L846), so before any of those has
 *   fired the absence of a rule is correct behaviour. What is never allowed, in
 *   either mode, is a rule in a column that must not have one, or a rule carrying
 *   the wrong threshold — so neither mode is vacuous.
 */
async function assertWipInvariant(
    kanban: KanbanPage,
    geometry: BoardGeometry,
    requireMarker: boolean,
): Promise<void> {
    for (const column of await columnsWithCounter(kanban, geometry)) {
        const reading = parseCounter(await kanban.taskCounterText(column));
        const cardCount = await kanban.cardsInColumn(column).count();

        expect(
            reading.count,
            `column ${String(column)} counts ${String(reading.count)} stories but renders ` +
                `${String(cardCount)} cards`,
        ).toBe(cardCount);

        const expected = expectedWipState(cardCount, reading.limit);
        const actual = await kanban.wipMarkerState(column);

        if (requireMarker || expected === null) {
            expect(
                actual,
                `column ${String(column)} holds ${String(cardCount)} cards against a limit of ` +
                    `${String(reading.limit)}, so its WIP rule must be ${String(expected)}`,
            ).toBe(expected);
        } else {
            expect(
                [null, expected],
                `column ${String(column)} holds ${String(cardCount)} cards against a limit of ` +
                    `${String(reading.limit)}, so its WIP rule must be ${String(expected)} or, ` +
                    'before the first redraw event, absent',
            ).toContain(actual);
        }

        if (actual !== null) {
            // The label is a hardcoded English string in `main.coffee` L839 — it is
            // deliberately not translated, so asserting the literal is correct.
            await expect(
                kanban.wipMarker(column).locator(WIP_LABEL_SELECTOR),
            ).toHaveText(WIP_LABEL_TEXT);
        }
    }

    // The directive is skipped entirely for an archived status (`main.coffee` L842),
    // so those columns must never carry a rule at all. Their cells are addressed
    // through the first swimlane's run of columns; folding is per status, so one
    // cell is representative.
    if (geometry.archivedStatusIndex !== null) {
        expect(
            await kanban.wipMarkerState(columnIndex(geometry, 0, geometry.archivedStatusIndex)),
            'an archived status must never draw a WIP-limit rule',
        ).toBeNull();
    }
}

/* ===========================================================================
 * The cases
 *
 * Fourteen, in the order below. Where the incumbent split ONE user-visible flow
 * across a `before` plus several `it`s that shared a single browser session
 * (`create us` at `kanban.e2e.js` L49-L111 is five `it`s that only work in
 * sequence), the flow is COLLAPSED into one `test()`. That is deliberate:
 * Playwright gives every test a fresh page, so a flow spread over several tests
 * would silently depend on the previous one having left the right thing on
 * screen — which is precisely the coupling that made the incumbent suite
 * order-dependent. Each test therefore opens the board itself and measures its
 * own baseline immediately before acting.
 *
 * `test.describe.configure({ mode: 'serial' })` is deliberately NOT used:
 * `workers: 1` with `fullyParallel: false` already runs these in declaration
 * order, whereas serial mode would SKIP every later test after one failure and
 * so destroy the artifact set this spec exists to produce.
 * ======================================================================== */

test.describe('kanban', () => {
    /**
     * Case 1 — ported from `kanban.e2e.js` L23-L29 (`before`), whose screenshot
     * was `takeScreenshot('kanban', 'kanban')` at L28.
     *
     * The route is `project/<slug>/kanban`, opened by `KanbanPage.goto()`
     * relative to the configured `baseURL` — never a hardcoded host. The
     * incumbent addressed `project-0` (L24); `sample_data` numbers its projects
     * from one, so `KANBAN_PROJECT_SLUG` from `../fixtures/seed` resolves the same
     * project under its real slug.
     */
    test('loads the board and captures the baseline', async ({ authedPage }) => {
        // The seed assertion walks four seeded routes to prove the dataset is
        // present, so it runs BEFORE the board is opened: run after `goto()` it
        // would leave the browser on the last route it visited and the capture
        // below would photograph the wrong screen. It only ever ASSERTS — it never
        // seeds and never reseeds, because the seeder is randomised and a second
        // run would make the baseline and React artifact sets incomparable.
        await assertSampleData(authedPage);

        const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

        await kanban.goto();

        await expect(kanban.boardRoot(), 'the board root never became visible').toBeVisible();

        const headerNames = await kanban.headerColumnNames();

        expect(headerNames.length, 'the board rendered no status headers').toBeGreaterThan(0);

        await expect(
            kanban.statusColumns(),
            'the board rendered no status columns',
        ).not.toHaveCount(0);

        await expect(kanban.cards(), 'the board rendered no cards').not.toHaveCount(0);

        await authedPage.screenshot({ path: shot('kanban'), fullPage: true });
    });

    /**
     * Case 2 — ported from `kanban.e2e.js` L31-L47.
     *
     * ⚠ TECHNOLOGY-SPECIFIC CHANGE — how a zoom step is selected. The incumbent
     * could not address a step directly, so `kanban-helper.js` L77-L83 moved the
     * mouse into ONE element at a computed offset and clicked:
     * `mouseMove($('tg-board-zoom'), {y: 14, x: level * 49})`. The real markup has
     * no need of that arithmetic: `board-zoom.jade` emits a title followed by
     * exactly FOUR `label.zoom-radio`, each wrapping an `input[type="radio"]` with
     * a literal `value="0"`…`value="3"`, so a step is addressable by index and the
     * selection is deterministic.
     *
     * That distinction is not cosmetic. `KanbanPage.zoom(level)` faithfully PORTS
     * the offset gesture and therefore takes the incumbent's ORDINAL (1-4), and it
     * resolves which step the offset actually lands on by measuring the control.
     * Measured on the live widget the four steps sit at x = 45, 69, 156 and 180
     * within a 196 px control and the SELECTED step is 80 px wide while the others
     * are 16 px — so the layout MOVES with the selection and the ordinal-to-level
     * mapping changes with it (with step 1 selected, ordinal 3's offset of 147 lands
     * inside step 1 rather than step 2). An ordinal consequently cannot address a
     * specific level, and the four capture states are driven by index here while
     * the ported gesture is exercised once below for its own sake.
     *
     * The incumbent's screenshots were named `zoom1`…`zoom4`, mapping its 1-based
     * clicks onto the 0-based `zoomLevel`; these use the real index, so
     * `zoom-0`…`zoom-3` name the level the board actually declares.
     */
    test('applies all four zoom levels', async ({ authedPage }) => {
        const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

        await kanban.goto();

        const steps = authedPage.locator(ZOOM_CONTROL).locator(ZOOM_STEP);

        await expect(
            steps,
            `expected ${String(ZOOM_LEVELS.length)} zoom steps; board-zoom.jade renders one ` +
                'label.zoom-radio per level',
        ).toHaveCount(ZOOM_LEVELS.length);

        for (const level of ZOOM_LEVELS) {
            await steps.nth(level).click();

            // The class on the board root is the end of the chain that actually has
            // to keep working — widget, controller, board — so it replaces the
            // incumbent's blind `browser.sleep(1000)` as the settle condition
            // (`kanban-table.jade` L14 binds zoom-0 … zoom-3).
            await expect(
                kanban.boardRoot(),
                `the board never adopted zoom-${String(level)}`,
            ).toHaveClass(classToken(`zoom-${String(level)}`), { timeout: ZOOM_SETTLE });

            expect(await kanban.zoomLevel()).toBe(level);

            // The incumbent's 1000 ms pause, kept as a settle IN ADDITION to the
            // assertion so the capture is taken after the cards have re-laid out.
            await authedPage.waitForTimeout(ZOOM_SETTLE);

            await authedPage.screenshot({
                path: shot(`zoom-${String(level)}`),
                fullPage: true,
            });
        }

        // The ported offset gesture, exercised once. It cannot be asked for a
        // particular level (see above), so what is asserted is what it guarantees:
        // the board ends on some declared level and says so in its class.
        await kanban.zoom(PORTED_ZOOM_ORDINAL);

        const portedLevel = await kanban.zoomLevel();

        expect(portedLevel).toBeGreaterThanOrEqual(MIN_ZOOM_LEVEL);
        expect(portedLevel).toBeLessThanOrEqual(MAX_ZOOM_LEVEL);

        await expect(kanban.boardRoot()).toHaveClass(
            classToken(`zoom-${String(portedLevel)}`),
        );

        // ⚠⚠ PERSISTENCE HAZARD — this test MUST restore the board. The zoom index
        // is persisted through `$tgStorage` under the key `kanban_zoom`, default 1
        // (`kanban-board-zoom.directive.coffee` L11, written back at L28-L29), so it
        // survives a reload AND every later test AND the next run of this spec.
        // Leaving it at 3 would change the starting state of every subsequent
        // capture, and it would also strip the card affordances the later cases
        // need: `.e2e-title` requires `vm.visible('subject')`, which needs level >= 1,
        // and `.card-actions` renders only when `zoomLevel > 0`
        // (`card-actions.jade` L1).
        await steps.nth(DEFAULT_ZOOM_LEVEL).click();

        await expect(
            kanban.boardRoot(),
            'the zoom case did not restore the default level, so it has polluted ' +
                'kanban_zoom for every later test and run',
        ).toHaveClass(classToken(`zoom-${String(DEFAULT_ZOOM_LEVEL)}`), {
            timeout: ZOOM_SETTLE,
        });

        expect(await kanban.zoomLevel()).toBe(DEFAULT_ZOOM_LEVEL);
    });

    test.describe('create us', () => {
        /**
         * Case 3 — ported from `kanban.e2e.js` L49-L111, where a `before` and five
         * `it`s shared one lightbox. Collapsed into one test, as explained above.
         *
         * `KanbanPage.openNewUsLightbox(0)` anchors the control SEMANTICALLY, on the
         * `.option` that contains the add icon. The incumbent took
         * `.option` index 2 (`kanban-helper.js` L17-L19); in the real header that is
         * the FOLD button — the verified order is [0] add-US, [1] bulk, [2] fold,
         * [3] unfold (`kanban-table.jade` L30-L72).
         */
        test('creates a user story from the column header', async ({ authedPage }) => {
            const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

            await kanban.goto();

            // The story is created in the status the header belongs to, and in the
            // default swimlane. Counting that STATUS across every swimlane is
            // therefore both sufficient and independent of which swimlane the
            // project happens to default to.
            const statusId = await requireAttribute(
                kanban.statusColumn(0),
                STATUS_ATTRIBUTE,
                'the created story can be counted in the status it was created in',
            );
            const cardsInStatus = statusCards(kanban, statusId);
            const before = await cardsInStatus.count();

            await kanban.openNewUsLightbox(0);

            const lightbox = kanban.createEditLightbox();

            await expectLightboxOpen(authedPage, lightbox);

            await authedPage.screenshot({ path: shot('create-us') });

            // The timestamp is the incumbent's (L66-L69) and is kept so the subject
            // is unique per run and the assertion at the end cannot be satisfied by
            // a leftover story from an earlier run.
            const subject = `test subject ${String(Date.now())}`;

            await lightbox.locator(SUBJECT_INPUT).fill(subject);

            // Role points, ported from L75-L82.
            await setEveryRoleToOnePoint(authedPage, lightbox);

            // ⚠ DELIBERATE, DOCUMENTED REDUCTION of `commonHelper.tags()`
            // (`e2e/helpers/common-helper.js` L75-L90). The incumbent additionally
            // opened `.e2e-open-color-selector`, picked `.e2e-color-dropdown li`
            // nth(1), added and then deleted a throwaway tag through
            // `.e2e-delete-tag`, and finally typed 'a' followed by ARROW_DOWN and
            // ENTER to accept an autocomplete suggestion. None of that is ported:
            // it exercises the out-of-scope shared tag component's colour picker and
            // autocomplete rather than either migrated screen, and accepting a
            // keyboard-driven suggestion is not deterministic under `retries: 0` —
            // `tag-line-common.directive.coffee` L32-L37 shows ENTER takes the
            // highlighted suggestion INSTEAD of the typed text whenever
            // `.tags-dropdown .selected` exists, and only arrow keys create that
            // selection. Adding a tag — the behaviour the case is actually about —
            // is still driven and still asserted. The chip's colour comes from
            // `tag[1]` (`tag.jade` L8) and is per-project data, so it is never
            // asserted (rule T2, drift entry D3).
            await lightbox.locator(SHOW_TAG_INPUT).click();

            const tagInput = lightbox.locator(ADD_TAG_INPUT);

            await expect(tagInput).toBeVisible();

            const tag = `e2e-tag-${String(Date.now())}`;

            await tagInput.fill(tag);

            // The debounced model has caught up exactly when the save affordance
            // appears, because `ng-show="vm.newTag.name.length"` gates it
            // (`add-tag-input.jade` L36-L41). Pressing ENTER before that would add
            // an empty tag.
            await authedPage.waitForTimeout(MODEL_DEBOUNCE);

            await expect(
                lightbox.locator(ADD_TAG_SAVE),
                'the tag input never propagated its value to the model',
            ).toBeVisible();

            // ⚠ `protractor.Key.ENTER` has no Playwright equivalent; `press('Enter')`
            // is the substitution. `tag-line-common.directive.coffee` L32-L37 handles
            // keyCode 13 on `.tag-input` and calls `preventDefault()`, so this adds
            // the tag rather than submitting the surrounding form.
            await tagInput.press('Enter');

            await expect(
                lightbox.locator(TAG_CHIP).filter({ hasText: tag }),
                'the typed tag did not render as a chip',
            ).toHaveCount(1);

            await lightbox
                .locator(DESCRIPTION_TEXTAREA)
                .fill(`test description ${String(Date.now())}`);

            // Settings, ported from L91.
            await toggleSetting(lightbox);

            // ⚠ DELIBERATE EXCLUSION — attachment upload. The incumbent ran
            // `commonHelper.lightboxAttachment` at L94 (and again at L163), which
            // uploaded two files into `tg-attachments-simple` through `#add-attach`
            // and asserted `count + 1` (`common-helper.js` L55-L73). It is not
            // ported: `tg-attachments-simple` is an out-of-scope shared component,
            // its fixture files live under `e2e/` which this change must not touch,
            // and attachments are not part of this screen's enumerated inventory.

            await authedPage.screenshot({ path: shot('create-us-filled') });

            // The subject and description are debounced too, so the model is given
            // its 200 ms before the form is submitted.
            await authedPage.waitForTimeout(MODEL_DEBOUNCE);

            await lightbox.locator(SUBMIT_BUTTON).click();

            await expectLightboxClosed(lightbox);

            await expect(
                cardsInStatus,
                'the created story did not appear in its status column',
            ).toHaveCount(before + 1, { timeout: BACKEND_TIMEOUT });

            await expectNoErrorNotification(authedPage);

            // Cards are virtualised, so a title is only readable once its card has
            // intersected its column; the new story lands at one end of the column
            // depending on `obj.us_position`, and both ends are brought into view
            // before the titles are read.
            await requireCardContent(
                cardsInStatus.first(),
                'read the first card title of the status the story was created in',
            );
            await requireCardContent(
                cardsInStatus.last(),
                'read the last card title of the status the story was created in',
            );

            // 🐞 THE INCUMBENT ASSERTION AT L107 IS DEFECTIVE:
            //     let findSubject = ussTitles.indexOf(formFields.subject) !== 1;
            // `indexOf` returns -1 when the value is absent, so the comparison
            // should be `!== -1`; as written it is true for every input except one
            // that happens to sit at index 1, which makes the assertion pass
            // vacuously — that case could not fail even against a board that created
            // nothing. The correct form is the one the edit case already uses at
            // L171. It is written correctly here: rule T10 forbids changing
            // BEHAVIOUR, and the intended behaviour is unchanged — copying the bug
            // would produce a spec that cannot fail, which is not fidelity.
            await expect
                .poll(
                    async (): Promise<string[]> => {
                        const titles: string[] = [];

                        for (const cell of await kanban.statusColumnById(statusId).all()) {
                            const columnTitles = await cell
                                .locator(CARD)
                                .locator(CARD_TITLE)
                                .allTextContents();

                            titles.push(
                                ...columnTitles.map((title: string): string => title.trim()),
                            );
                        }

                        return titles;
                    },
                    {
                        message:
                            'the created subject never appeared among the card titles of its status',
                        timeout: BACKEND_TIMEOUT,
                    },
                )
                .toContain(subject);

            await authedPage.screenshot({ path: shot('create-us-result'), fullPage: true });
        });
    });

    test.describe('edit us', () => {
        /**
         * Case 4 — ported from `kanban.e2e.js` L114-L175, again collapsing a `before`
         * plus five `it`s into one flow.
         *
         * ⚠ The incumbent's `kanbanHelper.editUs(0, 0)` hovered
         * `.card-owner-actions` and then clicked `.e2e-edit`
         * (`kanban-helper.js` L37-L51). BOTH selectors are stale on the Kanban card.
         * The route that exists is the card's action menu:
         * `KanbanPage.openCardActions()` hovers the card and clicks
         * `.card-actions button.js-popup-button` (`card-actions.jade` L2-L4), and the
         * Edit item is then taken from the popover by icon.
         *
         * `.card-actions` renders only when `zoomLevel > 0` AND the account may
         * modify or delete (`card-actions.jade` L1). Case 2 restores the default
         * level of 1, so it is present; if it is missing this fails with that
         * message rather than skipping, because a missing edit affordance on a board
         * the admin owns is a regression, not an unexercisable precondition.
         */
        test('edits a user story', async ({ authedPage }) => {
            const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

            await kanban.goto();

            const geometry = await readBoardGeometry(kanban);
            const cell = requireCell(
                await findPopulatedCells(kanban, geometry),
                'edit a user story',
            );
            const card = kanban.cardsInColumn(cell.column).first();

            await requireCardContent(card, 'open the action menu of a card');

            await kanban.openCardActions(cell.column, 0);
            await clickCardActionByIcon(authedPage, EDIT_ACTION_ICON);

            const lightbox = kanban.createEditLightbox();

            await expectLightboxOpen(authedPage, lightbox);

            await authedPage.screenshot({ path: shot('edit-us') });

            // Ported from L137-L141: the existing subject is CLEARED first, which is
            // what distinguishes this from the create case. `fill('')` is the
            // Playwright equivalent of the incumbent's `clear()`.
            const subjectInput = lightbox.locator(SUBJECT_INPUT);

            await subjectInput.fill('');

            const subject = `test subject ${String(Date.now())}`;

            await subjectInput.fill(subject);

            // Ported from L144-L151.
            await setEveryRoleToOnePoint(authedPage, lightbox);

            await lightbox
                .locator(DESCRIPTION_TEXTAREA)
                .fill(`test description ${String(Date.now())}`);

            // Ported from L160.
            await toggleSetting(lightbox);

            // ⚠ The attachment upload the incumbent repeated at L163 is excluded for
            // the same reasons as in the create case.

            await authedPage.waitForTimeout(MODEL_DEBOUNCE);

            await lightbox.locator(SUBMIT_BUTTON).click();

            await expectLightboxClosed(lightbox);

            // Ported from L170-L173, which already used the correct `!== -1` form —
            // the same assertion the create case's L107 got wrong.
            await expect
                .poll(
                    async (): Promise<string[]> => kanban.cardTitlesInColumn(cell.column),
                    {
                        message: 'the edited subject never appeared among the column card titles',
                        timeout: BACKEND_TIMEOUT,
                    },
                )
                .toContain(subject);

            await expectNoErrorNotification(authedPage);

            await authedPage.screenshot({ path: shot('edit-us-result'), fullPage: true });
        });
    });

    test.describe('bulk create', () => {
        /**
         * Case 5 — ported from `kanban.e2e.js` L177-L207.
         *
         * `KanbanPage.openBulkUsLightbox(0)` anchors on the `.option` containing the
         * bulk icon. The incumbent instead took `$$('.icon-bulk')` index `column`
         * (`kanban-helper.js` L53-L55), which only coincides with the intended
         * column while every status header renders exactly one bulk icon.
         */
        test('bulk-creates two user stories', async ({ authedPage }) => {
            const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

            await kanban.goto();

            // Ported from L197: the baseline is measured immediately before acting,
            // never assumed. Counted per STATUS across swimlanes for the same reason
            // as the create case — the stories land in the default swimlane.
            const statusId = await requireAttribute(
                kanban.statusColumn(0),
                STATUS_ATTRIBUTE,
                'the two bulk-created stories can be counted in their status',
            );
            const cardsInStatus = statusCards(kanban, statusId);
            const before = await cardsInStatus.count();

            await kanban.openBulkUsLightbox(0);

            const lightbox = kanban.bulkLightbox();

            await expectLightboxOpen(authedPage, lightbox);

            // Ported from L189-L193. ⚠ `protractor.Key.ENTER` has no Playwright
            // equivalent; `press('Enter')` is the substitution, and
            // `pressSequentially` is used rather than `fill` so the two subjects are
            // typed and separated exactly as the incumbent typed them — the bulk
            // form splits on newlines, so replacing the whole value in one shot
            // would stop exercising the keystroke path.
            const textarea = lightbox.locator(BULK_TEXTAREA);

            await textarea.click();
            await textarea.pressSequentially('aaa');
            await textarea.press('Enter');
            await textarea.pressSequentially('bbb');
            await textarea.press('Enter');

            await lightbox.locator(SUBMIT_BUTTON).click();

            await expectLightboxClosed(lightbox);

            // Ported from L205.
            await expect(
                cardsInStatus,
                'the two bulk-created stories did not both appear in their status column',
            ).toHaveCount(before + 2, { timeout: BACKEND_TIMEOUT });

            await expectNoErrorNotification(authedPage);

            await authedPage.screenshot({ path: shot('bulk-create'), fullPage: true });
        });
    });

    test.describe('folds', () => {
        /**
         * Case 6 — ported from `kanban.e2e.js` L209-L227.
         *
         * ⚠ The incumbent asserted the ABSOLUTE folded-column counts 1 (L215-L217)
         * and 0 (L223-L225). Neither is portable, for two independent reasons.
         * (a) `KanbanSquishColumnDirective` L795-L805 forces `folds[status.id] = true`
         * for EVERY `is_archived` status on initial load, so a project with an
         * archived status starts with a folded column and the absolute 1 is already
         * wrong. (b) The fold state is PERSISTED per project through
         * `rs.kanban.getStatusColumnModes` / `storeStatusColumnModes` (L780, L788,
         * L797), so it survives reloads, later tests and previous runs of this spec.
         * A baseline-relative assertion is the faithful and order-tolerant form.
         *
         * ⚠ The DELTA is not 1 either. In swimlane mode every swimlane repeats the
         * full status list (`kanban-table.jade` L112-L121), so folding one status
         * folds its cell in every swimlane; in flat mode (L189-L197) there is exactly
         * one such cell. The expected delta is therefore the number of cells that
         * status has, which is measured rather than guessed and which degenerates to
         * the incumbent's 1 in flat mode.
         *
         * ⚠ `KanbanPage.foldedColumnCount()` counts `.taskboard-column.vfold`, not a
         * bare `.vfold`. A bare `.vfold` DOUBLE-COUNTS, because the header
         * `h2.task-colum-name` also receives it (`kanban-table.jade` L18-L20) —
         * note that class really is spelled "colum", not "column".
         */
        test('folds and unfolds a status column', async ({ authedPage }) => {
            const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

            await kanban.goto();

            const geometry = await readBoardGeometry(kanban);
            const [statusIndex] = estimableStatusIndexes(geometry);

            expect(
                statusIndex,
                'the board exposes no non-archived status column to fold',
            ).not.toBeUndefined();

            const foldedStatusIndex = statusIndex ?? 0;
            const statusId = await requireAttribute(
                kanban.statusColumn(foldedStatusIndex),
                STATUS_ATTRIBUTE,
                'the cells belonging to the folded status can be counted',
            );
            const cellsForStatus = await kanban.statusColumnById(statusId).count();
            const foldedBefore = await kanban.foldedColumnCount();

            await kanban.foldColumn(foldedStatusIndex);

            await authedPage.screenshot({ path: shot('fold-column'), fullPage: true });

            expect(
                await kanban.foldedColumnCount(),
                'folding one status must add exactly its own cells to the folded set',
            ).toBe(foldedBefore + cellsForStatus);

            // The documented folded contract of that column, asserted on its first
            // cell: the counter leaves the DOM (`ng-if='!folds[s.id]'`,
            // `kanban-table.jade` L122-L123), the collapsed placeholder enters it
            // (L130-L131), and the WIP rule is hidden by
            // `.vfold .kanban-wip-limit { display: none; }`
            // (`kanban-table.scss` L79-L81) — `not.toBeVisible()` is the right
            // assertion for that because it holds whether the rule is styled away or
            // was never drawn.
            const foldedCell = kanban.statusColumnById(statusId).first();

            await expect(
                foldedCell.locator(TASK_COUNTER),
                'a folded column must not render its task counter',
            ).toHaveCount(0);

            await expect(
                foldedCell.locator(PLACEHOLDER_COLLAPSED),
                'a folded column must render its collapsed placeholder',
            ).not.toHaveCount(0);

            await expect(
                kanban.wipMarker(columnIndex(geometry, 0, foldedStatusIndex)),
                'a folded column must not show its WIP-limit rule',
            ).not.toBeVisible();

            await kanban.unfoldColumn(foldedStatusIndex);

            // ⚠⚠ This test MUST leave the board unfolded — hazard (b) above. Unfolding
            // is therefore both the behaviour under test and the restore step, and the
            // assertion that the folded set is back to its baseline is what proves the
            // restore happened.
            expect(
                await kanban.foldedColumnCount(),
                'the fold case did not restore the board, so it has polluted the ' +
                    "project's persisted column modes for every later test and run",
            ).toBe(foldedBefore);

            await authedPage.screenshot({ path: shot('unfold-column'), fullPage: true });
        });
    });

    /**
     * Case 7 — ported from `kanban.e2e.js` L229-L245.
     *
     * ⚠⚠ TECHNOLOGY-SPECIFIC CHANGE — how a card is dragged. This is the single
     * biggest behavioural difference between the two suites, so it is documented
     * here at the point of change.
     *
     * The incumbent's `utils.common.drag()` (`e2e/utils/common.js` L207-L277) was a
     * SYNTHETIC drag injected with `executeScript`: it built `new CustomEvent`,
     * called the legacy `initEvent`, assigned `pageX`/`clientX`/`pageY`/`clientY`
     * and `event.which = 1` by hand, dispatched `mousedown` on the source and then
     * two `mousemove`s and a `mouseup` on `document.documentElement`. That worked
     * for exactly one reason: `dragula` listened for precisely those fabricated
     * events. React replaces it with `@dnd-kit/core`, whose `PointerSensor` needs a
     * REAL pointer sequence that clears its activation constraint, so
     * `../pages/KanbanPage.ts` owns a stepped-pointer helper — hover, mouse down, a
     * first small nudge past the activation distance, several intermediate moves,
     * then a final move onto the target and mouse up. A single `locator.dragTo()`
     * frequently fails against dnd-kit because it is too few events, too fast.
     *
     * The settle changed with it. `utils.common.dragEnd` (L199-L205) polled for
     * `.gu-mirror` to disappear — DRAGULA's mirror class, which `@dnd-kit` never
     * produces, so that condition is not merely wrong here but unfalsifiable. It is
     * replaced by an assertion on the outcome. `browser.waitForAngular()` (L238) has
     * no Playwright equivalent for the same reason and is replaced the same way.
     *
     * The drag is NOT re-implemented in this file. There is exactly one
     * implementation, tuned once, and it lives in `../pages/`.
     */
    test('drags a card between status columns', async ({ authedPage }) => {
        const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

        await kanban.goto();

        const geometry = await readBoardGeometry(kanban);
        const source = requireCell(
            await findPopulatedCells(kanban, geometry),
            'drag a card between status columns',
        );

        // The destination is another non-archived status in the SAME swimlane:
        // crossing swimlanes is Case 8 and dropping into the archived column is
        // Case 10, so keeping both fixed is what makes this case about the status
        // change alone.
        const [targetStatusIndex] = estimableStatusIndexes(geometry).filter(
            (status: number): boolean => status !== source.statusIndex,
        );

        if (targetStatusIndex === undefined) {
            throw new Error(
                'Cannot drag a card between status columns: the board exposes only one ' +
                    'non-archived status, so there is nowhere to drop it.',
            );
        }

        const targetColumn = columnIndex(geometry, source.swimlaneIndex, targetStatusIndex);
        const sourceBefore = await kanban.cardsInColumn(source.column).count();
        const targetBefore = await kanban.cardsInColumn(targetColumn).count();

        // The card is identified by `data-id` (`kanban-table.jade` L151) so the
        // assertion can be positional-independent: the drop reorders both columns,
        // so "the same index still holds the same card" would not be true even on a
        // correct move.
        const cardId = await requireAttribute(
            kanban.cardsInColumn(source.column).first(),
            CARD_ID_ATTRIBUTE,
            'the moved card can be located in the destination column',
        );

        await authedPage.screenshot({ path: shot('drag-column-before'), fullPage: true });

        // `KanbanPage.dragCard` applies the incumbent's `offsetY: 10`
        // (`kanban.e2e.js` L236 passed `drag(usOrigin, destination, 0, 10)`).
        await kanban.dragCard(source.column, 0, targetColumn);

        // Ported from L243-L244.
        await expect(
            kanban.cardsInColumn(source.column),
            'the source column did not lose the dragged card',
        ).toHaveCount(sourceBefore - 1, { timeout: BACKEND_TIMEOUT });

        await expect(
            kanban.cardsInColumn(targetColumn),
            'the destination column did not gain the dragged card',
        ).toHaveCount(targetBefore + 1, { timeout: BACKEND_TIMEOUT });

        await expect(
            kanban
                .statusColumn(targetColumn)
                .locator(`${CARD}[${CARD_ID_ATTRIBUTE}="${cardId}"]`),
            'the dragged card is not inside the destination status column',
        ).toHaveCount(1);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('drag-column-after'), fullPage: true });
    });

    /**
     * Case 8 — AAP-REQUIRED ADDITION. The incumbent suite predates swimlanes
     * entirely, so there is no line to cite: it is derived from the markup
     * (`kanban-table.jade` L72-L78 for the swimlane row, L112-L120 for the cell and
     * L150-L153 for the card) and from goal G1, which names swimlanes among the
     * behaviours React must reproduce exactly.
     *
     * The drag itself goes through the same single implementation as Case 7 —
     * `dndKitDrag` from `../pages/KanbanPage` — because the page object has no
     * cross-swimlane convenience method and re-implementing the gesture here would
     * mean two implementations to keep tuned.
     */
    test('drags a card between swimlanes', async ({ authedPage }) => {
        const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

        await kanban.goto();

        const swimlaneCount = await kanban.swimlanes().count();

        // Captured BEFORE the skip check so the board state is recorded as evidence
        // even when the case cannot run.
        await authedPage.screenshot({ path: shot('drag-swimlane-before'), fullPage: true });

        // A declared, VISIBLE skip with an explicit reason, so it appears in the HTML
        // report as a named unexercisable precondition rather than as a silent pass.
        // This is the only kind of skip this spec uses.
        test.skip(
            swimlaneCount < 2,
            `Project "${KANBAN_PROJECT_SLUG}" exposes ${String(swimlaneCount)} swimlane(s) ` +
                'under sample_data, so a cross-swimlane drag is not exercisable. Enable ' +
                'Kanban swimlanes in project admin to run this case.',
        );

        const geometry = await readBoardGeometry(kanban);
        const source = requireCell(
            await findPopulatedCells(kanban, geometry),
            'drag a card between swimlanes',
        );
        const statusId = await requireAttribute(
            kanban.statusColumn(source.column),
            STATUS_ATTRIBUTE,
            'the same status can be addressed in another swimlane',
        );
        const sourceSwimlaneId = await requireAttribute(
            kanban.swimlanes().nth(source.swimlaneIndex),
            SWIMLANE_ATTRIBUTE,
            'the source cell can be addressed by swimlane and status',
        );

        // The destination is the same STATUS in a different swimlane. A folded
        // swimlane renders no body and therefore no cells at all
        // (`kanban-table.jade` L107-L108), so candidates are checked rather than
        // assumed and the first one that really exposes the cell is used.
        let targetSwimlaneId: string | null = null;

        for (const candidate of swimlaneIndexes(geometry)) {
            if (candidate === source.swimlaneIndex) {
                continue;
            }

            const candidateId = await requireAttribute(
                kanban.swimlanes().nth(candidate),
                SWIMLANE_ATTRIBUTE,
                'a destination swimlane can be addressed',
            );

            if ((await kanban.statusColumnInSwimlane(candidateId, statusId).count()) === 1) {
                targetSwimlaneId = candidateId;
                break;
            }
        }

        if (targetSwimlaneId === null) {
            throw new Error(
                'Cannot drag a card between swimlanes: no other swimlane currently renders a ' +
                    `cell for status "${statusId}". Every unfolded swimlane repeats the full ` +
                    'status list, so this means every other swimlane is collapsed.',
            );
        }

        const sourceCell = kanban.statusColumnInSwimlane(sourceSwimlaneId, statusId);
        const targetCell = kanban.statusColumnInSwimlane(targetSwimlaneId, statusId);

        await expect(sourceCell, 'the source cell is not uniquely addressable').toHaveCount(1);
        await expect(targetCell, 'the target cell is not uniquely addressable').toHaveCount(1);

        const sourceBefore = await sourceCell.locator(CARD).count();
        const targetBefore = await targetCell.locator(CARD).count();
        const cardId = await requireAttribute(
            sourceCell.locator(CARD).first(),
            CARD_ID_ATTRIBUTE,
            'the moved card can be located in the destination swimlane',
        );

        await dndKitDrag(authedPage, sourceCell.locator(CARD).first(), targetCell, {
            offsetY: CARD_DROP_OFFSET_Y,
        });

        await expect(
            targetCell.locator(`${CARD}[${CARD_ID_ATTRIBUTE}="${cardId}"]`),
            'the dragged card is not inside the destination swimlane cell',
        ).toHaveCount(1, { timeout: BACKEND_TIMEOUT });

        await expect(
            sourceCell.locator(CARD),
            'the source swimlane cell did not lose the dragged card',
        ).toHaveCount(sourceBefore - 1, { timeout: BACKEND_TIMEOUT });

        await expect(
            targetCell.locator(CARD),
            'the destination swimlane cell did not gain the dragged card',
        ).toHaveCount(targetBefore + 1, { timeout: BACKEND_TIMEOUT });

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('drag-swimlane-after'), fullPage: true });
    });

    /**
     * Case 9 — AAP-REQUIRED ADDITION, for the same reason as Case 8.
     *
     * ⚠ THE ngANIMATE CLASS CONTRACT IS DELIBERATELY NOT ASSERTED.
     * `kanban-table.scss` L549-L575 styles the swimlane body's transition entirely
     * through the classes ngAnimate adds and removes — `ng-enter`, `ng-move`,
     * `ng-leave` and their `-active` partners — over `transition: all linear .5s`,
     * animating `max-height` between 0 and 524 px and `opacity` between 0 and 1.
     * React does not participate in that lifecycle, so reproducing the class
     * sequence on the same schedule is what keeps that stylesheet at ZERO edits
     * (AAP gap G-DS-1) — but those classes exist only inside a 500 ms window, which
     * makes asserting them inherently flaky under `retries: 0`. What is asserted is
     * therefore the SETTLED END STATE, after the transition budget has elapsed: the
     * title's `folded` class, the icon swap, and the body's presence in or absence
     * from the DOM.
     */
    test('collapses and expands a swimlane', async ({ authedPage }) => {
        const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

        await kanban.goto();

        const swimlaneCount = await kanban.swimlanes().count();

        test.skip(
            swimlaneCount < 1,
            `Project "${KANBAN_PROJECT_SLUG}" renders the board in flat mode under ` +
                'sample_data, so it exposes no swimlane to collapse. Enable Kanban ' +
                'swimlanes in project admin to run this case.',
        );

        const swimlane = kanban.swimlanes().first();
        const title = swimlane.locator(SWIMLANE_TITLE);
        const body = swimlane.locator(SWIMLANE_BODY);
        const [name] = await kanban.swimlaneTitles();

        expect(name, 'the first swimlane rendered no title').not.toBeUndefined();
        expect((name ?? '').length, 'the first swimlane title is empty').toBeGreaterThan(0);

        await expect(body, 'the swimlane body is not rendered to begin with').toHaveCount(1);

        await kanban.toggleSwimlane(0);

        await authedPage.waitForTimeout(SWIMLANE_ANIMATION);

        await expect(
            title,
            'the collapsed swimlane title did not gain its "folded" class',
        ).toHaveClass(classToken(SWIMLANE_FOLDED_CLASS));

        // `kanban-table.jade` L85-L92 swaps the two icons on the same `ng-if`.
        await expect(
            swimlane.locator(SWIMLANE_FOLD_ICON),
            'the collapsed swimlane does not show its folded icon',
        ).toHaveCount(1);

        await expect(
            swimlane.locator(SWIMLANE_UNFOLD_ICON),
            'the collapsed swimlane still shows its unfolded icon',
        ).toHaveCount(0);

        // `ng-if="!ctrl.foldedSwimlane.get(…)"` REMOVES the body rather than hiding
        // it (L107-L108), which is why this is a count assertion and not a visibility
        // one.
        await expect(
            body,
            'the collapsed swimlane body was not removed from the DOM',
        ).toHaveCount(0);

        // The header survives the collapse; only the body goes.
        await expect(title).toBeVisible();

        await authedPage.screenshot({ path: shot('swimlane-collapsed'), fullPage: true });

        await kanban.toggleSwimlane(0);

        await authedPage.waitForTimeout(SWIMLANE_ANIMATION);

        // MUST restore: the collapse is persisted for the session, so leaving a
        // swimlane folded would remove its cells from every later case's board.
        await expect(
            title,
            'the swimlane case did not restore the expanded state',
        ).not.toHaveClass(classToken(SWIMLANE_FOLDED_CLASS));

        await expect(swimlane.locator(SWIMLANE_UNFOLD_ICON)).toHaveCount(1);
        await expect(body, 'the expanded swimlane body did not return').toHaveCount(1);

        await authedPage.screenshot({ path: shot('swimlane-expanded'), fullPage: true });
    });

    test.describe('archive', () => {
        /**
         * Case 10 — ported from `kanban.e2e.js` L247-L266, whose screenshot was named
         * `archive` (L262).
         *
         * The archived status is identified by the ONE header control that carries
         * `tg-kanban-archived-show-status-header` (`kanban-table.jade` L55-L63,
         * `ng-if="s.is_archived"`), which is independent of both its position and its
         * fold state.
         *
         * ⚠ Expanding it triggers a LAZY FETCH rather than a reveal: the handler
         * broadcasts `kanban:show-userstories-for-status` and loads the archived
         * stories (`main.coffee` L737-L742, with
         * `KanbanArchivedStatusIntroDirective` L760-L763 receiving them), so the
         * settle has to be a bounded assertion on the column's unfolded contract and
         * not a fixed pause.
         *
         * ⚠ The column starts FOLDED because `KanbanSquishColumnDirective` L799-L803
         * forces `folds[status.id] = true` for every `is_archived` status on initial
         * load. That is asserted rather than assumed: if the archived column is
         * already expanded there is nothing to expand, and silently continuing would
         * turn this case into a weaker one without saying so.
         */
        test('expands the archived column and archives a card by drag', async ({
            authedPage,
        }) => {
            const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

            await kanban.goto();

            const geometry = await readBoardGeometry(kanban);

            test.skip(
                geometry.archivedStatusIndex === null,
                `Project "${KANBAN_PROJECT_SLUG}" declares no is_archived user-story status ` +
                    'under sample_data, so it renders no archived column. Add one in project ' +
                    'admin to run this case.',
            );

            const archivedStatusIndex = geometry.archivedStatusIndex ?? 0;
            const archivedStatusId = await requireAttribute(
                kanban.statusColumn(archivedStatusIndex),
                STATUS_ATTRIBUTE,
                'the archived cells can be addressed across swimlanes',
            );
            const archivedCells = kanban.statusColumnById(archivedStatusId);

            // Scrolled FIRST, before the destination is resolved, preserving the
            // incumbent's ordering at L254. `kanban-helper.js` L69-L71 did it with
            // `$(".kanban-table-body:last").scrollLeft(10000)`;
            // `KanbanPage.scrollRight()` reproduces it with `page.evaluate` and no
            // jQuery, and also scrolls the outer container because the board scrolls
            // in two places.
            await kanban.scrollRight();

            await expect(
                kanban.archivedColumn(),
                'the archived column is not folded to begin with, so there is nothing to ' +
                    'expand — KanbanSquishColumnDirective folds every is_archived status on ' +
                    'initial load',
            ).not.toHaveCount(0);

            await kanban.expandArchivedColumn();

            // The unfolded contract, and simultaneously the settle for the lazy fetch:
            // the collapsed placeholder leaves the DOM and the task counter enters it.
            await expect(
                archivedCells.first().locator(PLACEHOLDER_COLLAPSED),
                'the expanded archived column still renders its collapsed placeholder',
            ).toHaveCount(0, { timeout: BACKEND_TIMEOUT });

            await expect(
                archivedCells.first().locator(TASK_COUNTER),
                'the expanded archived column does not render its task counter',
            ).toHaveCount(1, { timeout: BACKEND_TIMEOUT });

            await authedPage.screenshot({ path: shot('archived-expanded'), fullPage: true });

            // `KanbanPage.dragCardToArchived` drops onto the LAST status column, so
            // that column really being an archived one is asserted rather than
            // assumed.
            expect(
                await requireAttribute(
                    kanban.statusColumns().last(),
                    STATUS_ATTRIBUTE,
                    'the archive drop target can be verified',
                ),
                'the last status column on the board is not the archived one, so the archive ' +
                    'drop would land somewhere else',
            ).toBe(archivedStatusId);

            // The incumbent hardcoded column 3 as the source (L249-L251). The LAST
            // populated cell is used instead: it is the one nearest the archived rail,
            // which keeps the pointer travel short and the drop inside one swimlane.
            const populated = await findPopulatedCells(kanban, geometry);
            const source = requireCell([...populated].reverse(), 'archive a card by drag');
            const sourceBefore = await kanban.cardsInColumn(source.column).count();

            await kanban.dragCardToArchived(source.column, 0);

            // Ported from L264.
            await expect(
                kanban.cardsInColumn(source.column),
                'the source column did not lose the archived card',
            ).toHaveCount(sourceBefore - 1, { timeout: BACKEND_TIMEOUT });

            await expectNoErrorNotification(authedPage);

            await authedPage.screenshot({ path: shot('archive-drop'), fullPage: true });
        });
    });

    /**
     * Case 11 — AAP-REQUIRED ADDITION.
     *
     * The three WIP thresholds cannot be forced without editing `wip_limit` in
     * project admin, which is out of scope, so what is asserted instead is the
     * complete data-driven invariant: for every column, the rule the board draws
     * must be exactly the rule `KanbanWipLimitDirective` computes from that column's
     * own card count and limit — including drawing none. See
     * {@link expectedWipState} for the arithmetic, quoted from `main.coffee`
     * L815-L853, and note that the directive's `if element` guard means a matching
     * formula does NOT always produce a rule.
     *
     * 🚫 NO COLOUR IS ASSERTED. The rules differ visually — `one-left` is
     * `$color-link-red` at 50 % opacity over the column fill, `reached` is solid —
     * but that is CSS, and status, tag and epic colours are per-project database
     * values whose Figma appearance is a `sample_data` artefact (rule T2, drift entry
     * D3). Only the state class is asserted.
     */
    test('WIP-limit markers match the directive arithmetic', async ({ authedPage }) => {
        const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

        await kanban.goto();

        const geometry = await readBoardGeometry(kanban);

        // On a freshly loaded board the directive has not been asked to draw yet, so
        // a column that should show a rule may legitimately show none — but no column
        // may show a rule it should not have, or one with the wrong threshold.
        await assertWipInvariant(kanban, geometry, false);

        await authedPage.screenshot({ path: shot('wip-limit'), fullPage: true });

        // A move broadcasts `kanban:us:move`, which is one of the four events the
        // directive listens to (`main.coffee` L843-L846), so after it the FULL
        // equality invariant must hold everywhere. This is what proves the redraw
        // actually fires rather than the rules merely happening to be right.
        const source = requireCell(
            await findPopulatedCells(kanban, geometry),
            'move a card to prove the WIP-limit redraw fires',
        );
        const [targetStatusIndex] = estimableStatusIndexes(geometry).filter(
            (status: number): boolean => status !== source.statusIndex,
        );

        if (targetStatusIndex === undefined) {
            throw new Error(
                'Cannot prove the WIP-limit redraw: the board exposes only one non-archived ' +
                    'status, so no card can be moved between columns.',
            );
        }

        await kanban.dragCard(
            source.column,
            0,
            columnIndex(geometry, source.swimlaneIndex, targetStatusIndex),
        );

        await assertWipInvariant(kanban, geometry, true);
    });

    /**
     * Case 12 — AAP-REQUIRED ADDITION.
     *
     * ⚠⚠ THE THREE-`.result` TRAP. `animated-counter.directive.coffee` L17-L27
     * renders THREE `div.result` rows inside `.counter-translator` — `nextUp`,
     * `renderCount` and `nextDown` — so it can slide between values, and each holds a
     * `span.current` plus an optional ` / {{wip}}`. Reading `innerText` of
     * `.kanban-task-counter` therefore concatenates up to three different readings.
     * `KanbanPage.taskCounterText()` scopes to the resting row, and this case trusts
     * it rather than re-deriving the selector.
     *
     * `.kanban-task-counter` exists only while the column is unfolded
     * (`ng-if='!folds[s.id]'`), which is why the columns are selected rather than
     * enumerated.
     */
    test('task counters render bare counts and count/limit', async ({ authedPage }) => {
        const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

        await kanban.goto();

        const geometry = await readBoardGeometry(kanban);

        for (const column of await columnsWithCounter(kanban, geometry)) {
            const text = await kanban.taskCounterText(column);
            const reading = parseCounter(text);
            const cardCount = await kanban.cardsInColumn(column).count();

            expect(
                text,
                `column ${String(column)} read "${text}", which is neither a bare count nor ` +
                    'count / limit',
            ).toMatch(reading.limit === null ? BARE_COUNT_PATTERN : COUNT_WITH_LIMIT_PATTERN);

            expect(
                reading.count,
                `column ${String(column)} counts ${String(reading.count)} stories but renders ` +
                    `${String(cardCount)} cards`,
            ).toBe(cardCount);

            // The counter's own class contract
            // (`animated-counter.directive.coffee` L14-L16). `wip-amount` follows the
            // TRUTHINESS of `data.wip`, which is exactly the condition that also
            // decides whether the ` / limit` half is rendered — so the class and the
            // text can never disagree.
            const inner = kanban.statusColumn(column).locator(COUNTER_INNER);
            const wipAmount = classToken('wip-amount');

            if (reading.limit === null) {
                await expect(
                    inner,
                    `column ${String(column)} shows no limit yet claims "wip-amount"`,
                ).not.toHaveClass(wipAmount);
            } else {
                await expect(
                    inner,
                    `column ${String(column)} shows a limit yet omits "wip-amount"`,
                ).toHaveClass(wipAmount);
            }

            const limitOver = classToken('limit-over');

            if (expectsLimitOver(reading)) {
                await expect(
                    inner,
                    `column ${String(column)} satisfies data.count > data.wip yet omits ` +
                        '"limit-over"',
                ).toHaveClass(limitOver);
            } else {
                await expect(
                    inner,
                    `column ${String(column)} does not satisfy data.count > data.wip yet claims ` +
                        '"limit-over"',
                ).not.toHaveClass(limitOver);
            }
        }

        await authedPage.screenshot({ path: shot('task-counter'), fullPage: true });
    });

    test.describe('kanban filters', () => {
        /**
         * Case 13 — ported from `kanban.e2e.js` L286-L288, which delegated the whole
         * group to `e2e/shared/filters.js`.
         *
         * ⚠ SCOPE LIMIT. `tg-filter` is an out-of-scope shared component, so only the
         * parts that belong to this screen are ported: opening and closing the panel,
         * the text search, and clearing back down. The shared suite's
         * save-custom-filter (+1), remove-custom-filter (-1) and filter-by-category
         * cases (`shared/filters.js` L37-L76) are NOT ported — and
         * `filters-helper.js` L76-L82 `firterByCategoryWithContent()` could not be in
         * any case, because it climbs the tree with `element(by.xpath('..'))`, a
         * Protractor-only construct with no Playwright equivalent.
         *
         * ⚠ `shared/filters.js` L21 slept 4000 ms after opening the panel. That fixed
         * sleep is replaced by a bounded visibility assertion:
         * `KanbanPage.openFilters()` waits for the panel itself.
         */
        test('opens and closes the filter panel, and searches', async ({ authedPage }) => {
            const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

            await kanban.goto();

            const initialCards = await kanban.cards().count();

            expect(
                initialCards,
                'the board rendered no cards, so a search cannot be shown to filter anything',
            ).toBeGreaterThan(0);

            // The trigger is addressed here because the page object opens the panel but
            // exposes no handle on the control, and this case has to close it again and
            // read its `active` state. Scoped to the screen root: `.e2e-open-filter`
            // also exists on the Backlog screen.
            const filterToggle = authedPage.locator(SCREEN_ROOT).locator(FILTER_TOGGLE);
            const filterPanel = authedPage.locator(SCREEN_ROOT).locator(FILTER_PANEL);

            // `ng-if="ctrl.openFilter"` (`kanban.jade` L49-L51) means the panel is
            // ABSENT rather than hidden while closed.
            await expect(filterPanel, 'the filter panel is open before it is asked for').toHaveCount(
                0,
            );

            await kanban.openFilters();

            await expect(filterPanel, 'the filter panel did not appear').toBeVisible();
            await expect(
                kanban.filterPanel(),
                'the filter panel appeared without its tg-filter component',
            ).toBeVisible();
            await expect(
                filterToggle,
                'the filter trigger did not report the panel as open',
            ).toHaveClass(classToken(FILTER_TOGGLE_ACTIVE_CLASS));

            await authedPage.screenshot({ path: shot('filters-open'), fullPage: true });

            await filterToggle.click();

            await expect(
                filterPanel,
                'closing the filter panel did not remove it from the DOM',
            ).toHaveCount(0);
            await expect(filterToggle).not.toHaveClass(classToken(FILTER_TOGGLE_ACTIVE_CLASS));

            // The toolbar search, which is the shared `tgInputSearch` component. Its
            // placeholder resolves COMMON.FILTERS.INPUT_PLACEHOLDER, which is
            // "subject or reference" — SINGULAR (`locale-en.json` L235).
            const search = kanban.searchInput().locator(SEARCH_FIELD);

            await expect(
                search,
                'the search placeholder no longer resolves COMMON.FILTERS.INPUT_PLACEHOLDER',
            ).toHaveAttribute('placeholder', SEARCH_PLACEHOLDER);

            // A term taken from a card that is really on the board, so the positive
            // case cannot pass by filtering to everything. The card is identified by
            // `data-id` for the assertion because a filtered reload re-renders the
            // board and a title is only readable once its card has intersected.
            const firstCard = kanban.cards().first();

            await requireCardContent(firstCard, 'read a card subject to search for');

            const cardId = await requireAttribute(
                firstCard,
                CARD_ID_ATTRIBUTE,
                'the searched-for card can be recognised after the board reloads',
            );
            const title = (await firstCard.locator(CARD_TITLE).innerText()).trim();

            expect(title.length, 'the first card rendered an empty subject').toBeGreaterThan(0);

            const needle = distinctiveNeedle(title);

            await search.fill(needle);

            // ⚠ `browser.waitForAngular()` has no Playwright equivalent. The ported
            // condition is `utils.common.waitLoader` (`common.js` L118-L126): the
            // `.loader` element loses its `active` class within 5000 ms. It is paired
            // with an outcome assertion, because a settled loader alone says nothing
            // about the result.
            await expect(
                authedPage.locator('.loader.active'),
                'the board never finished reloading after the search',
            ).toHaveCount(0, { timeout: LOADER_TIMEOUT });

            await expect(
                kanban.cardById(cardId),
                `searching for "${needle}" filtered out the very card it was taken from`,
            ).toHaveCount(1, { timeout: BACKEND_TIMEOUT });

            await expect(
                kanban.cards(),
                'the search matched more cards than the board started with',
            ).not.toHaveCount(0);

            // The incumbent's deliberate no-match term (`shared/filters.js` L27), whose
            // assertion was that the counter reaches 0 (L34).
            await search.fill(NO_MATCH_QUERY);

            await expect(
                kanban.cards(),
                `searching for "${NO_MATCH_QUERY}" left cards on the board`,
            ).toHaveCount(0, { timeout: BACKEND_TIMEOUT });

            await authedPage.screenshot({ path: shot('search'), fullPage: true });

            // Cleared down, so this case leaves the board exactly as it found it —
            // the search term is not persisted, but a later case reading a card count
            // must not depend on that.
            await search.fill('');

            await expect(
                kanban.cards(),
                'clearing the search did not restore the full board',
            ).toHaveCount(initialCards, { timeout: BACKEND_TIMEOUT });
        });
    });

    /**
     * Case 14 — ported from `kanban.e2e.js` L268-L284.
     *
     * ⚠ The incumbent clicked `kanbanHelper.watchersLinks()` = `.e2e-assign`
     * (`kanban-helper.js` L73-L75), which is stale on the Kanban card — it exists
     * only on the epics dashboard row. The affordance that exists is
     * `.card-assigned-to .card-user-avatar` (`card-assigned-to.jade` L9-L13), whose
     * click handler raises `onClickAssignedTo` (`card-directives.coffee` L81-L83).
     *
     * ⚠ The incumbent then read the result from `.card-owner-name` (L281), which is
     * also stale. `KanbanPage.assignedName()` reads the `title` attribute of
     * `.card-assigned-to .card-user-avatar img`, falling back to
     * `.card-not-assigned-title`, which is where the name actually lives.
     */
    test('changes the assigned user of a card', async ({ authedPage }) => {
        const kanban = new KanbanPage(authedPage, KANBAN_PROJECT_SLUG);

        await kanban.goto();

        const geometry = await readBoardGeometry(kanban);
        const cell = requireCell(
            await findPopulatedCells(kanban, geometry),
            'change the assigned user of a card',
        );
        const card = kanban.cardsInColumn(cell.column).first();

        await requireCardContent(card, 'open the assign-to lightbox from a card');

        await card.locator(CARD_ASSIGN_AFFORDANCE).first().click();

        const lightbox = authedPage.locator(ASSIGN_LIGHTBOX);

        await expectLightboxOpen(authedPage, lightbox);

        // Ported from L275-L277: the name of the first candidate is read BEFORE it is
        // chosen, so the assertion compares the card against what the lightbox
        // offered rather than against a hardcoded user.
        const chosenName = (
            await lightbox.locator(ASSIGN_USER_NAME).first().innerText()
        ).trim();

        expect(
            chosenName.length,
            'the assign-to lightbox listed a candidate with no name',
        ).toBeGreaterThan(0);

        await lightbox.locator(ASSIGN_USER_ROW).first().click();

        await expectLightboxClosed(lightbox);

        // Ported from L281-L283.
        await expect
            .poll(
                async (): Promise<string | null> => kanban.assignedName(cell.column, 0),
                {
                    message: 'the card does not show the user that was just assigned to it',
                    timeout: BACKEND_TIMEOUT,
                },
            )
            .toBe(chosenName);

        await expectNoErrorNotification(authedPage);

        await authedPage.screenshot({ path: shot('assigned-to'), fullPage: true });
    });

    /* =======================================================================
     * Cases deliberately NOT written, each with its reason
     *
     *  * NO KANBAN MULTI-SELECT DRAG CASE. Multi-select is served by the single
     *    `app/react/shared/dnd/` adapter that both migrated screens consume, so
     *    its behaviour, its ordering arithmetic and its virtualised-target
     *    registration are implemented once and TESTED once — by the Backlog
     *    spec's multi-select reorder and drag-multiple-to-sprint cases.
     *    `KanbanPage.selectCard()` and `selectedCards()` exist for it (Ctrl+click
     *    adds `kanban-task-selected`, `kanban-table.jade` L154) and stay unused
     *    here; an unused class METHOD is not an unused local, so this costs the
     *    type-check nothing. The `.card-transit-multi` / `.fake-us` ghost blocks
     *    (`card.jade` L45-L55) are transient drag-feedback internals and are not
     *    asserted at end-to-end level.
     *  * NO ATTACHMENT-UPLOAD CASE. See the exclusion inside Case 3:
     *    `tg-attachments-simple` is an out-of-scope shared component and its
     *    fixtures live under `e2e/`, which this change must not touch.
     *  * NO COLOUR-SELECTOR OR AUTOCOMPLETE TAG SUB-FLOW. See the reduction
     *    inside Case 3: it exercises the shared tag component rather than this
     *    screen, and keyboard-driven suggestion acceptance is not deterministic
     *    under `retries: 0`.
     *  * NO CUSTOM-FILTER OR CATEGORY-FILTER CASES. See the scope limit in
     *    Case 13: `tg-filter` is out of scope, and the incumbent's category
     *    helper depends on a Protractor-only XPath construct.
     *  * NO NAVIGATION TO THE USER-STORY DETAIL OR TASKBOARD SCREENS. Both are
     *    out of scope for this migration, so following either link would assert
     *    a screen this change does not touch.
     * ==================================================================== */
});
