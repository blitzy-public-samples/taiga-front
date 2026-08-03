/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Playwright page object for the React Backlog / Sprint-Planning screen.
 * ===========================================================================
 *
 * TECHNOLOGY-SPECIFIC CHANGE (AngularJS 1.5.10 -> React 18 migration).
 *
 * PROVENANCE. Every selector and every flow below is ported from the incumbent
 * Protractor layer, which is being retired: `e2e/helpers/backlog-helper.js`
 * (264 lines, the selector source) and `e2e/suites/backlog.e2e.js` (585 lines,
 * the flow source, now `describe.skip`ped and losing its `conf.e2e.js:51`
 * registration). Those two files are the ONLY record of how this screen was
 * driven, so each locator here carries its origin by file and line. Line numbers
 * refer to the ORIGINAL, pre-migration files — the same convention
 * `e2e-react/fixtures/seed.ts` established — because `backlog.e2e.js` has since
 * gained a four-line header comment that shifts every line in it by +4.
 *
 * Nothing is IMPORTED from `e2e/`: that tree is CommonJS Protractor JavaScript
 * on ambient globals, `tsconfig.json` sets no `allowJs`, and importing any of it
 * would fail `tsc --noEmit` outright. The port is behavioural, not textual, and
 * both incumbent helpers stay in the repository untouched for the suites that
 * survive (`e2e/helpers/index.js:11` eagerly requires the kanban helper into a
 * barrel dozens of retained suites load, and `e2e/suites/tasks/taskboard.e2e.js:10`
 * is a retained consumer of `backlog-helper.js` itself).
 *
 * THE SELECTOR RULE (T1) — locate by CLASS, never by AngularJS attribute.
 * "Preserve every CSS class name … React markup must emit the same classes in
 * the same nesting so the existing stylesheets apply verbatim." React emits
 * classes; it does not emit `[tg-*]`/`[ng-*]` attribute directives. Every
 * incumbent attribute selector is therefore substituted for the class the same
 * element already carries, verified against the Jade that produced it AND
 * against the React components that now render it.
 *
 * WHAT THE PORT HAD TO CORRECT — the seven findings, each commented at its own
 * point of change rather than only here:
 *
 *   SIX ATTRIBUTE -> CLASS SUBSTITUTIONS (T1)
 *     1. `.backlog-table-body > div[ng-repeat]`  -> `> div.us-item-row`
 *     2. `span[tg-bo-ref]`                       -> `span.user-story-number` in a
 *        backlog row, `span.us-ref-text` in a sprint row (CONTEXT-DEPENDENT)
 *     3. `div[tg-backlog-sprint="sprint"]`       -> `section.sprints div.sprint`
 *     4. `div[tg-us-role-points-selector]`       -> `.backlog-table-header .points .inner`
 *     5. `div[tg-lb-create-edit-sprint]`         -> `div.lightbox.lightbox-sprint-add-edit`
 *     6. `by.model('sprint.name')`               -> `input.sprint-name[name="name"]`
 *
 *   ONE PROTRACTOR-ONLY LOCATOR WITH NO PLAYWRIGHT EQUIVALENT
 *     `by.model('sprint.name')` (substitution 6 above) resolved an AngularJS
 *     `ng-model` EXPRESSION. Playwright has no such locator, and after the
 *     migration there is no `ng-model` to resolve either.
 *
 *   FIVE STALE INCUMBENT SELECTORS (each matched nothing, or the wrong thing,
 *   even BEFORE this migration — every one verified by reading the markup and, in
 *   two cases, the handler that binds it)
 *     7. `.icon-drag`                     -> `.draggable-us-row` (the glyph token
 *        `tgSvg` actually emits is `icon-draggable`)
 *     8. `.add-sprint`                    -> `header.sprint-header a.btn-link`,
 *        with the empty-state `div.empty-small a.btn-link` fallback
 *     9. `.new-us a`                      -> `.new-us button.btn-small` / `button.btn-icon`
 *    10. `div[tg-lb-create-edit-userstory]` -> `[tg-lb-create-edit]` (see below)
 *    11. `.button-green` / `.button-red`  -> `.js-confirm` / `.js-cancel` in the
 *        confirmation dialog
 *
 *   FOUR AMBIGUOUS SELECTORS, EACH DISAMBIGUATED
 *    12. `.e2e-edit`               -> `.edit-story` vs `.move-to-top`
 *    13. `.e2e-move-to-sprint`     -> `.move-to-current-sprint` vs `.move-to-latest-sprint`
 *    14. `.e2e-velocity-forecasting` -> `.active` (return) vs `:not(.active)` (enter)
 *    15. `span[tg-bo-ref]`         -> see substitution 2
 *
 * ⚠⚠ THE DEPLOY BUILD DELETES EVERY `e2e-*` CLASS FROM THE ANGULARJS TEMPLATES.
 * `gulpfile.js:273`, inside the `template-cache` task, pipes
 * `gulpif(isDeploy, replace(/e2e-([a-z\-]+)/g, ''))`, so `gulp deploy` — the build
 * nginx serves at the configured `baseURL` — ships those templates with the hooks
 * REMOVED. Verified against the running stack: the deployed `templates.js` contains
 * zero occurrences of `e2e-open-filter`, `e2e-move-to-sprint`,
 * `e2e-velocity-forecasting`, `e2e-edit`, `e2e-delete` or `e2e-sprint-name`, and the
 * filter button ships as `class="btn-filter  ng-animate-disabled"` with the tell-tale
 * double space where its hook used to be.
 *
 * The incumbent suite never noticed because Protractor drove a NON-deploy build,
 * where the hooks survive. Two consequences shape this file:
 *
 *   1. The strip touches the JADE pipeline ONLY. React class names live in
 *      TypeScript and reach the browser through the separate esbuild bundle, so the
 *      `e2e-*` classes `app/react/backlog/StoryRow.tsx` and `BacklogToolbar.tsx`
 *      emit ARE present in a deploy build. The two worlds therefore disagree, and a
 *      page object that has to drive the screen before, during and after the
 *      migration cannot depend on either alone.
 *   2. Every selector below that the incumbent expressed through an `e2e-*` hook is
 *      paired with a class or id that SURVIVES the strip — `#show-filters-button`,
 *      `.move-to-current-sprint`, `.velocity-forecasting-btn`, `.edit-story`,
 *      `.move-to-top`, `.forecasting-add-sprint`, `input.sprint-name` — with the hook
 *      kept as an alternative so the object also works against a dev build. Where
 *      the incumbent hook was an element's ONLY class (`button.e2e-delete`), the
 *      surviving anchor is its icon rather than its position.
 *
 * TWO AngularJS ATTRIBUTE SELECTORS ARE DELIBERATELY RETAINED, because the two
 * lightboxes they address stay AngularJS: `tgLbCreateEdit`
 * (`app/coffee/modules/common/lightboxes.coffee:900`) and
 * `tgLbCreateBulkUserstories` (`:409`) are shared directives this migration does
 * not touch. They are the ONLY `[tg-*]`/`[ng-*]` selectors in this file, and each
 * carries a why-comment at its declaration.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *   - It takes NO screenshots and writes NOTHING under `e2e-react/artifacts/**`.
 *     Capture is owned by `playwright.config.ts` (`screenshot: "on"`,
 *     `video: "on"`, `outputDir` under the committed artifacts root) and by the
 *     specs. `common.takeScreenshot` (`common.js:128`-`:151`) is not ported: it
 *     writes into the git-ignored `e2e/screenshots/`.
 *   - It reads NO credential, and it does not even NAME the environment variable
 *     that carries one. The admin password is resolved in exactly one place,
 *     `e2e-react/fixtures/auth.ts`, and nothing else in this layer may read it — so
 *     this file cannot leak it into a message, a comment or a captured artifact.
 *   - It hardcodes NO URL and NO PORT. Navigation is relative to
 *     `playwright.config.ts`'s `baseURL`; the incumbent's
 *     `browser.params.glob.host` — the separate Protractor origin declared at
 *     `conf.e2e.js:20`, which is NOT the origin this layer runs against — has no
 *     equivalent here and needs none.
 *   - It asserts NO colour and NO pixel geometry. Status, tag and epic colours
 *     are per-project DATA (`s.color`, `tag[1]`, `epic.color`); the Figma frames'
 *     values are `sample_data` artefacts, and the frames' measurements are a
 *     build-time reference for `app/react/**` and a QA gate for the comparison
 *     artifacts — never a behavioural assertion here.
 *   - It contains ONE loop, {@link BacklogPage.loadFullBacklog}, and that loop is
 *     capped. `playwright.config.ts` sets `retries: 0`, so an unbounded wait
 *     hangs the whole run rather than failing one test.
 *
 * @see e2e-react/pages/KanbanPage.ts - owns the shared `dndKitDrag` helper
 * @see e2e-react/fixtures/auth.ts - owns login and the loader wait
 * @see e2e-react/fixtures/seed.ts - owns the seeded project slugs
 */

import { expect, type Locator, type Page } from '@playwright/test';

/*
 * ⭐ THE SHARED DRAG HELPER IS IMPORTED, NOT REDECLARED.
 *
 * `KanbanPage.ts` owns the tuning; this folder holds exactly two files and the
 * gesture is centralised in one place so the tuning is done once. A local copy
 * would drift from it, and — since `tsconfig.json` sets `noUnusedLocals` — an
 * unreferenced one would not even compile.
 *
 * WHY THE INCUMBENT DRAG COULD NOT BE PORTED AT ALL. `common.drag`
 * (`common.js:207`-`:276`) is a SYNTHETIC drag injected with
 * `browser.executeScript`: it builds `new CustomEvent(type)`, re-initialises it
 * through the long-obsolete `initEvent(type, true, true)`, hand-sets
 * `pageX/clientX/pageY/clientY` from `$(dest).offset()` and `event.which = 1`,
 * then dispatches `mousedown` on the source and `mousemove` twice plus `mouseup`
 * on `document.documentElement`. That works for exactly one reason: `dragula`
 * listens for those fabricated events. `@dnd-kit/core` does not — its
 * `PointerSensor` reads real pointer input, so the fabricated sequence is
 * invisible to it and the card never leaves the ground.
 *
 * `dndKitDrag` therefore performs a REAL gesture: hover, `mouse.down`, a first
 * small nudge that clears the sensor's activation constraint, several
 * interpolated `mouse.move` steps so collision detection sees a gesture rather
 * than a teleport, a final move landing exactly on the drop point, then
 * `mouse.up`. `locator.dragTo()` on its own frequently fails against `@dnd-kit`
 * for the same reason the synthetic script does.
 *
 * AND WHY `.gu-mirror` IS GONE. `common.dragEnd` (`common.js:199`-`:205`) settled
 * by polling until `$$('.gu-mirror').count() === 0`. `.gu-mirror` is DRAGULA's
 * mirror element; `@dnd-kit/core` renders no such node, so that condition would
 * be satisfied instantly and forever — a settle that never waits for anything.
 * Every drag below settles on the OBSERVABLE OUTCOME instead: the moved story's
 * `[data-id]` appearing where it was dropped.
 */
import { dndKitDrag } from './KanbanPage';

/*
 * The loader wait, ported from `common.waitLoader` (`common.js:118`-`:126`) and
 * owned by the auth fixture: 5000 ms for `.loader` to drop its `active` class,
 * matched as a class TOKEN (`common.js:45`-`:49` splits on whitespace) so that
 * `active` cannot be satisfied by `inactive`. It replaces
 * `browser.waitForAngular()`, which has no meaning once the screen is React.
 */
import { waitLoader } from '../fixtures/auth';

/*
 * The seeded backlog project. `e2e/suites/backlog.e2e.js:24` navigated to
 * `project/project-3/backlog`, and the fixture records that slug with its
 * provenance so this file states an intent rather than a literal.
 */
import { BACKLOG_PROJECT_SLUG } from '../fixtures/seed';

/* ===========================================================================
 * Route
 * ======================================================================== */

/**
 * The screen's route, relative to `playwright.config.ts`'s `baseURL`.
 *
 * PORTED FROM `e2e/suites/backlog.e2e.js:24`:
 * `browser.get(browser.params.glob.host + 'project/project-3/backlog')`. The
 * host half is deliberately dropped: Playwright resolves a relative path against
 * `baseURL`, so the port cannot drift from the configured origin the way a
 * hardcoded one would — and it can never reach the incumbent Protractor port.
 */
const BACKLOG_PATH_TEMPLATE = (slug: string): string => `/project/${slug}/backlog`;

/* ===========================================================================
 * Selectors — main panel
 * ======================================================================== */

/**
 * The screen shell. `backlog.jade:17` emits `section.backlog`, and
 * `e2e-react/fixtures/seed.ts` already asserts the seeded dataset through the
 * same element.
 *
 * Note that `section.backlog-table` (`backlog.jade:142`) is a DIFFERENT class and
 * is not matched by this selector.
 */
const SCREEN_SELECTOR = 'section.backlog';

/**
 * The scrolling story list.
 *
 * `backlog-table.jade:19`-`:25` emits
 * `div.backlog-table-body(tg-backlog-sortable, infinite-scroll="ctrl.loadUserstories()", …)`
 * with `ng-class="{'show-tags': …, 'active-filters': …, 'forecasted-stories': …}"`.
 * The sortable and infinite-scroll attributes are AngularJS directives and are
 * not part of the class contract, so the element is addressed by its class.
 */
const TABLE_BODY_SELECTOR = 'div.backlog-table-body';

/** `backlog-table.jade:8`. Header band above the list. */
const TABLE_HEADER_SELECTOR = '.backlog-table-header';

/**
 * SUBSTITUTION 4 (T1). Incumbent: `$('div[tg-us-role-points-selector]')`
 * (`backlog-helper.js:261`, `fiterRole`). `tgUsRolePointsSelector` is one of the
 * directives this migration retires (`backlog/main.coffee:1054`), so the
 * attribute disappears with it while the element and its classes stay.
 *
 * `backlog-table.jade:14`-`:17` proves the replacement:
 * `div.points > div.inner(tg-us-role-points-selector) > span.header-points + tg-svg(svg-icon="icon-filter")`.
 * Scoped to the header so it cannot collide with a row's `.points` cell.
 */
const ROLE_POINTS_FILTER_SELECTOR = `${TABLE_HEADER_SELECTOR} .points .inner`;

/**
 * SUBSTITUTION 1 (T1). Incumbent: `$$('.backlog-table-body > div[ng-repeat]')`
 * (`backlog-helper.js:119`, `userStories`). `ng-repeat` is the AngularJS
 * iteration directive; React renders a list and emits no such attribute.
 *
 * `backlog-row.jade:8`-`:14` proves the replacement — the repeated element is
 * `.row.us-item-row`, carrying `blocked`/`new` state classes, a `readonly`
 * permission class and, decisively, `data-id="{{ us.id }}"`. The React
 * `StoryRow.tsx` emits the identical set.
 *
 * The DIRECT-CHILD form is kept from the incumbent on purpose: the doom-line band
 * (`div.doom-line`) is a SIBLING of the rows inside this body, so a descendant
 * selector would still be correct but a direct-child one states the structure
 * the row order is read from.
 */
const STORY_ROW_SELECTOR = `${TABLE_BODY_SELECTOR} > div.us-item-row`;

/**
 * `backlog-row.jade:13`. The stable per-row anchor — preferred over indices.
 *
 * ⚠⚠ `data-id` IS THE USER STORY'S DATABASE ID, NOT ITS `#ref`, AND THE TWO DIFFER.
 * `backlog-row.jade:13` binds `data-id="{{ us.id }}"` while `:38` renders
 * `{{ us.ref }}`, and they are independent sequences. Measured on the live seeded
 * screen: the first row carries `data-id="65"` and displays `#71`; across all 13 rows
 * the ids run 65…77 against refs 71…83, which the `/api/v1/userstories` payload
 * confirms independently.
 *
 * So {@link BacklogPage.storyRowById} takes an ID and {@link BacklogPage.storyRefs}
 * returns REFS, and the two must never be passed to each other — a page object that
 * conflated them would silently address the wrong row and still find one. A third
 * identifier is in play in the same row for good measure: the checkbox is
 * `id="us-check-{{us.ref}}"` (`backlog-row.jade:24`), which is REF-keyed, so it is
 * reached through its wrapper rather than by composing an id here.
 */
const ROW_ID_ATTRIBUTE = 'data-id';

/**
 * STALE SELECTOR 7. Incumbent: `.icon-drag` (`backlog.e2e.js:210`, `:241`,
 * `:261`, `:276`, `:536`, `:571`).
 *
 * That token NEVER EXISTED. `backlog-row.jade:15`-`:17` emits
 * `.us-item-row-left > .draggable-us-row(tg-check-permission="modify_us") > tg-svg(svg-icon="icon-draggable")`,
 * and `tgSvg` renders `class="{{ 'icon ' + svgIcon }}"`
 * (`app/coffee/modules/common.coffee:342`-`:349`), so the emitted token is
 * `icon-draggable` — a different string from `icon-drag`, which therefore matched
 * nothing even under AngularJS. React's `Svg.tsx` emits the same
 * `class={`icon ${svgIcon}`}`, so the correction holds on both sides.
 *
 * The WRAPPER is used rather than the glyph: it is the element the permission
 * gate sits on, and it is what a user actually grabs.
 */
const DRAG_HANDLE_SELECTOR = '.us-item-row-left > .draggable-us-row';

/**
 * The row's selection control. `backlog-row.jade:19`-`:25` nests
 * `.input > .custom-checkbox > input[type="checkbox"] + label[for]`.
 *
 * The WRAPPER is clicked, not the input: the input is a styled custom checkbox
 * whose visible surface is the sibling `label`, so under Playwright's strict
 * actionability the input itself may not be clickable. The incumbent's
 * `dragElement.$('input[type="checkbox"]').click()` (`backlog.e2e.js:235`) worked
 * only because WebDriver was less strict about it.
 */
const ROW_CHECKBOX_WRAPPER_SELECTOR = '.input > .custom-checkbox';

/** The input itself — read for state, never clicked. */
const ROW_CHECKBOX_SELECTOR = `${ROW_CHECKBOX_WRAPPER_SELECTOR} input[type="checkbox"]`;

/**
 * ASSERTION-ONLY, exactly as the incumbent used it:
 * `$$('.backlog-table-body input[type="checkbox"]:checked')`
 * (`backlog-helper.js:123`, `selectedUserStories`).
 */
const CHECKED_ROW_CHECKBOX_SELECTOR = `${TABLE_BODY_SELECTOR} input[type="checkbox"]:checked`;

/**
 * SUBSTITUTION 2a (T1), the backlog-row half. Incumbent: `elm.$('span[tg-bo-ref]')`
 * (`backlog-helper.js:211`, `getUsRef`).
 *
 * `tgBoRef` is a one-time-binding AngularJS directive with no React counterpart.
 * `backlog-row.jade:38` proves the replacement: `span.user-story-number(tg-bo-ref="us.ref")`.
 *
 * ⚠ THE SAME INCUMBENT SELECTOR RESOLVES TO A DIFFERENT CLASS IN A SPRINT ROW —
 * see {@link SPRINT_STORY_REF_SELECTOR}. One class for both would silently read
 * the wrong element, so the two are kept apart.
 *
 * Both implementations render the reference with a TRAILING SPACE (it carries a
 * layout margin), so every read below trims.
 */
const ROW_REF_SELECTOR = 'span.user-story-number';

/** `backlog-row.jade:60`-`:66`. The inline status control. */
const ROW_STATUS_TRIGGER_SELECTOR = '.status a.us-status';

/** `backlog-row.jade:62`. Where the status name is bound. */
const ROW_STATUS_TEXT_SELECTOR = 'span.us-status-bind';

/**
 * The inline points control. `backlog-row.jade:68` is only the directive HOST
 * (`div.points(tg-backlog-us-points="us")`); the control itself comes from
 * `app/partials/common/estimation/us-estimation-total.jade:8`-`:9`, which emits
 * `button.us-points(class!="… not-clickable …") > span.points-value`. React's
 * `StoryRow.tsx` emits the identical pair.
 */
const ROW_POINTS_TRIGGER_SELECTOR = '.points .us-points';

/**
 * `us-estimation-total.jade:9`. The incumbent read
 * `.us-points … $$('span').get(0)` (`backlog-helper.js:197`, `:203`); that first
 * span IS `span.points-value`, so naming the class reads the same node while
 * saying which node it is.
 */
const ROW_POINTS_VALUE_SELECTOR = 'span.points-value';

/** `backlog-row.jade:70`-`:74`. The row's kebab trigger. */
const ROW_ACTIONS_BUTTON_SELECTOR = '.us-option > button.us-option-popup-button.js-popup-button';

/**
 * The kebab menu itself. `us-edit-popover.jade:8` emits `ul.popover.us-option-popup`.
 *
 * It exists only while open in BOTH implementations: AngularJS compiles and
 * appends the template on click and removes it on close
 * (`backlog/main.coffee:1009`-`:1015`, `UsEditSelector`), and React gates it on
 * its own popover state. Its presence is therefore a sound, immediate test of
 * whether the menu is already open.
 */
const ROW_ACTIONS_POPUP_SELECTOR = '.us-option ul.popover.us-option-popup';

/**
 * AMBIGUOUS SELECTOR 12, disambiguated. Incumbent:
 * `$$('.backlog-table-body .e2e-edit').get(item)` (`backlog-helper.js:159`,
 * `openUsBacklogEdit`).
 *
 * `us-edit-popover.jade` puts `e2e-edit` on TWO buttons per row — `:10`
 * `button.e2e-edit.edit-story` and `:24` `button.e2e-edit.move-to-top` — so the
 * hook alone is a coin toss between "edit this story" and "move it to the top of
 * the backlog", two very different outcomes. The second class disambiguates. The
 * defect is preserved in the markup (React emits both classes exactly as written)
 * and resolved here, in the page object.
 *
 * ⚠ The second class is ALSO what makes this survive the deploy-time `e2e-*` strip
 * (`gulpfile.js:273`): `edit-story` is not an `e2e-` name, so it is the anchor and
 * the hook is merely a bonus.
 */
const ROW_EDIT_SELECTOR = 'button.edit-story';

/** `us-edit-popover.jade:24`. The other `.e2e-edit` — see {@link ROW_EDIT_SELECTOR}. */
const ROW_MOVE_TO_TOP_SELECTOR = 'button.move-to-top';

/**
 * `us-edit-popover.jade:17`. Unambiguous among its siblings, but the ONLY ONE OF THE
 * THREE WITH NO SECOND CLASS: `button.e2e-delete` carries `e2e-delete` and nothing
 * else, so the deploy-time strip (`gulpfile.js:273`) leaves it with an EMPTY class
 * attribute and the incumbent selector cannot find it in a deployed build.
 *
 * The surviving anchor is its ICON. Both implementations render the trash glyph the
 * same way — `tg-svg(svg-icon="icon-trash")` at `us-edit-popover.jade:21` and
 * `<Svg svgIcon="icon-trash" />` in `StoryRow.tsx`, each emitting
 * `<svg class="icon icon-trash">` — so `:has(svg.icon-trash)` identifies the button
 * by what it MEANS rather than by its position among three list items, which is the
 * one property a reordered menu would not break. The hook is kept as an alternative
 * for dev builds and for the React bundle, where it is not stripped.
 */
const ROW_DELETE_SELECTOR = 'button.e2e-delete, ul.us-option-popup li button:has(svg.icon-trash)';

/**
 * Tag pills. Asserted by the incumbent as `$$('.backlog-table .tag').get(0)`
 * (`backlog.e2e.js:442`, `:452`).
 *
 * ⚠ THE PILL'S COLOUR IS DATA (`tag[1]`, `backlog-row.jade:46`-`:52`) and is
 * never asserted here: the Figma frame's colours are `sample_data` artefacts and
 * a colour assertion would fail against any real project.
 */
const TAG_SELECTOR = '.backlog-table .tag';

/* ===========================================================================
 * Selectors — main-panel chrome
 * ======================================================================== */

/** `summary.jade:8`. The dark statistics bar above the burndown. */
const SUMMARY_SELECTOR = 'div.summary';

/**
 * `summary.jade:9`: `div.summary-progress-bar(tg-backlog-progress-bar="stats")`.
 * `tgBacklogProgressBar` is retired (`backlog/main.coffee:1385`), so the element
 * is addressed by its class; React's `SummaryBar.tsx` emits it unchanged.
 *
 * ⚠ Only its PRESENCE and structure are exposed. Neither its fill colour nor its
 * width is asserted anywhere in this file.
 */
const SUMMARY_PROGRESS_BAR_SELECTOR = 'div.summary-progress-bar';

/** `summary.jade:14`-`:25`. Four stat blocks, each `span.number` + `span.description`. */
const SUMMARY_STAT_NUMBER_SELECTOR = 'div.summary-stats span.number';

/**
 * STALE SELECTOR 9a. Incumbent: `$$('.new-us a').get(0)`
 * (`backlog-helper.js:139`, `openNewUs`).
 *
 * The affordances are BUTTONS, not anchors: `addnewus.jade:8`-`:15` emits
 * `div.new-us > button.btn-small(variant="primary")` carrying `icon-add` and a
 * `span.text`. `.new-us a` therefore matched nothing. React's `AddNewUs.tsx`
 * emits the same button. The replacement is also SEMANTIC rather than positional
 * — `.get(0)` versus `.get(1)` encoded document order, which any markup change
 * would silently invert.
 */
const ADD_US_BUTTON_SELECTOR = '.new-us button.btn-small';

/**
 * STALE SELECTOR 9b. Incumbent: `$$('.new-us a').get(1)`
 * (`backlog-helper.js:135`, `openBulk`). `addnewus.jade:17`-`:23` emits
 * `button.btn-icon(variant="secondary")` carrying `icon-bulk`.
 */
const BULK_US_BUTTON_SELECTOR = '.new-us button.btn-icon';

/**
 * The filter toggle. Incumbent: `$('.e2e-open-filter')` (`filters-helper.js:18`-`:21`).
 *
 * ⚠ THE HOOK ALONE IS NOT ENOUGH IN A DEPLOYED BUILD. `gulpfile.js:273` strips it,
 * and the deployed markup confirms it: `class="btn-filter  ng-animate-disabled"`.
 * What survives is the id — `backlog.jade:55` sets `id="show-filters-button"`, and
 * `BacklogToolbar.tsx` reproduces both the id and the class list — so the id leads
 * and the hook follows as an alternative for dev builds.
 *
 * A comma selector is exact here rather than loose: on a build where both apply they
 * name the SAME element, and CSS matching yields a set, so the count is still one.
 */
const FILTER_TOGGLE_SELECTOR = 'button#show-filters-button, button.e2e-open-filter';

/**
 * The one class three unrelated controls on this screen use to mean "on": the
 * filter toggle (`backlog.jade:56`, `ng-class="{'active': ctrl.activeFilters}"`),
 * the tags check (`:76`, `ng-class="{'active': ctrl.showTags}"`) and the
 * forecasting return button (`:107`, where it is static).
 *
 * ⚠ Always matched as a whole TOKEN through {@link classTokenPattern}: this screen
 * also emits `active-filters` and `active-popover`, and
 * `e2e/utils/notifications.js` uses `inactive` as the opposite state — a substring
 * match would be satisfied by all three.
 */
const ACTIVE_CLASS = 'active';

/**
 * `backlog.jade:126`-`:140`: `.backlog-filter(id="backlog-filter", ng-if="ctrl.activeFilters") > tg-filter(…)`.
 *
 * `tg-filter` is an ELEMENT name the unedited stylesheets target, so React keeps
 * emitting it — it is NOT substituted, and it is the panel itself rather than the
 * wrapper that holds it.
 *
 * Addressed exactly as `filters-helper.js:14` did (`$('tg-filter')`) but SCOPED TO
 * THIS SCREEN by {@link BacklogPage.filterPanel} rather than to the
 * `.backlog-filter` wrapper. The wrapper is a container the React screen root owns;
 * the panel is the shared component whose element name the stylesheets pin. Anchoring
 * on the pinned name inside the screen root is therefore both more durable and no
 * less precise, since only one screen renders at a time.
 */
const FILTER_PANEL_SELECTOR = 'tg-filter';

/** `backlog-helper.js:257`, `goBackFilters`: the category breadcrumb. */
const FILTER_BREADCRUMB_SELECTOR = '.filters-step-cat .breadcrumb a';

/**
 * ⚠ `#show-tags` IS A VISUALLY-HIDDEN CUSTOM CHECKBOX — the LABEL is what gets
 * clicked. Incumbent: `$('#show-tags').click()` (`backlog.e2e.js:445`, `:455`).
 *
 * `backlog.jade:74`-`:89` nests
 * `.display-tags-button#show-tags(ng-if="userstories.length")` >
 * `.check.js-check(ng-class="{'active': ctrl.showTags}")` >
 * `input#show-tags-input(type="checkbox", …)` + a bare `div`, with a SIBLING
 * `label(for="show-tags-input", translate="BACKLOG.TAGS.SHOW")`. React's
 * `BacklogToolbar.tsx` emits the identical tree.
 *
 * The incumbent click worked because WebDriver clicked the outer WRAPPER and the
 * event reached the styled control by bubbling. Under Playwright's strict
 * actionability the styled `input` is very likely not actionable, so the click
 * targets the `label`, which is the surface a user actually presses and which
 * toggles the input through its `for` binding.
 *
 * ⚠ `ng-if="userstories.length"` means the whole control is ABSENT on an empty
 * backlog, so {@link BacklogPage.tagsShown} reads it with an IMMEDIATE count
 * rather than any kind of wait.
 */
const SHOW_TAGS_CONTAINER_SELECTOR = '#show-tags';

/** `backlog.jade:86`-`:89`. The clickable surface — see {@link SHOW_TAGS_CONTAINER_SELECTOR}. */
const SHOW_TAGS_LABEL_SELECTOR = 'label[for="show-tags-input"]';

/** `backlog.jade:75`-`:77`. Where the toggle's state actually lives. */
const SHOW_TAGS_CHECK_SELECTOR = `${SHOW_TAGS_CONTAINER_SELECTOR} .check`;

/**
 * AMBIGUOUS SELECTOR 13, disambiguated. Incumbent: `$('.e2e-move-to-sprint')`
 * (`backlog.e2e.js:299`).
 *
 * `backlog.jade:92` and `:99` emit TWO buttons carrying that hook —
 * `button.btn-filter.move-to-current-sprint.move-to-sprint.e2e-move-to-sprint` and
 * `…move-to-latest-sprint…` — mutually exclusive on `ng-if="currentSprint"`, and
 * `React`'s `BacklogToolbar.tsx` reproduces both the classes and the exclusivity.
 * They send the selected stories to DIFFERENT sprints, so the shared hook is
 * never used on its own here.
 *
 * ⚠ And it could not be used on its own even if it were unambiguous:
 * `gulpfile.js:273` strips it from a deployed build — verified, the deployed
 * `templates.js` ships `class="btn-filter move-to-current-sprint move-to-sprint "`.
 * The distinguishing class and `.move-to-sprint` both survive, so disambiguation and
 * durability come from the same pair.
 */
const MOVE_TO_CURRENT_SPRINT_SELECTOR = 'button.move-to-current-sprint.move-to-sprint';

/** `backlog.jade:99`. See {@link MOVE_TO_CURRENT_SPRINT_SELECTOR}. */
const MOVE_TO_LATEST_SPRINT_SELECTOR = 'button.move-to-latest-sprint.move-to-sprint';

/**
 * AMBIGUOUS SELECTOR 14. Incumbent: `$$('.e2e-velocity-forecasting')`
 * (`backlog-helper.js:143`, `:147`) — and `openVelocityForecasting` called
 * `.click()` on the COLLECTION, which Playwright rightly refuses to do.
 *
 * `backlog.jade:107` (the "back to backlog" button, which carries a STATIC
 * `active` class) and `:116` (the "enter forecasting" button, which does not) are
 * mutually exclusive on `ctrl.displayVelocity`. The collection is still exposed,
 * because `backlog.e2e.js:491`-`:498` asserts it is EMPTY on a project with no
 * velocity, and the two members are exposed individually for clicking.
 *
 * ⚠ The surviving anchor is `.velocity-forecasting-btn`, which both buttons also
 * carry: `gulpfile.js:273` strips the hook from a deployed build, and the deployed
 * `templates.js` confirms it ships
 * `class="btn-filter active velocity-forecasting-btn ng-animate-disabled "`. The
 * absence assertion this collection exists for would otherwise pass VACUOUSLY on
 * every project, velocity or not.
 */
const VELOCITY_FORECASTING_SELECTOR = 'button.velocity-forecasting-btn';

/** `backlog.jade:107`. Open -> offers the way back. See {@link VELOCITY_FORECASTING_SELECTOR}. */
const VELOCITY_FORECASTING_RETURN_SELECTOR = `${VELOCITY_FORECASTING_SELECTOR}.${ACTIVE_CLASS}`;

/** `backlog.jade:116`. Closed -> enters forecasting. Also gated on `stats.speed > 0`. */
const VELOCITY_FORECASTING_ENTER_SELECTOR = `${VELOCITY_FORECASTING_SELECTOR}:not(.${ACTIVE_CLASS})`;

/**
 * `backlog.jade:144`: `.forecasting-add-sprint.e2e-velocity-forecasting-add(ng-if="ctrl.displayVelocity")`.
 * Used by `backlog-helper.js:151`, `createSprintFromForecasting`.
 *
 * The CONTAINER is clicked, exactly as the incumbent clicked it: its handler is
 * delegated, so a click at its centre reaches it by bubbling from whichever child
 * happens to be there — which is more robust than betting on one inner button.
 *
 * ⚠ `.forecasting-add-sprint` leads because it survives the deploy-time strip
 * (`gulpfile.js:273`); the hook follows as a dev-build alternative.
 */
const VELOCITY_ADD_SPRINT_SELECTOR = '.forecasting-add-sprint, .e2e-velocity-forecasting-add';

/**
 * The doom line — the "project scope" band spliced into the story list where
 * cumulative estimation overruns the project's own point total.
 *
 * `backlog/main.coffee:759` is the incumbent's lodash template,
 * `<div class="doom-line"><span><%- text %></span></div>`, injected at `:755` and
 * torn down at `:786`; React's `MilestoneDivider.tsx` renders the same element
 * declaratively. Styled entirely by `app/styles/components/doomline.scss`.
 *
 * ⚠ Its fill and its 25 px height are stylesheet and layout outputs. Neither is
 * asserted here.
 */
const MILESTONE_DIVIDER_SELECTOR = 'div.doom-line';

/* ===========================================================================
 * Selectors — sprint sidebar
 * ======================================================================== */

/** `sprints.jade:8`. The sidebar section — the scope for every sprint selector. */
const SPRINTS_SECTION_SELECTOR = 'section.sprints';

/**
 * SUBSTITUTION 3 (T1). Incumbent: `$$('div[tg-backlog-sprint="sprint"]')`
 * (`backlog-helper.js:127`, `:131`, `:163`, `:253`). `tgBacklogSprint` is retired
 * (`backlog/sprints.coffee:60`), and its sibling `tgSprint` (`:180`) — the
 * ELEMENT that rendered each card — is retired too, so neither survives as a
 * hook.
 *
 * `sprints.jade:41`-`:43` and `:54`-`:56` prove the replacement:
 * `div.sprint.sprint-open` and `div.sprint.sprint-closed`.
 *
 * ⚠ SCOPING IS REQUIRED, NOT DEFENSIVE. The bare class `sprint` is also emitted
 * by `search-result-table-us.jade:12`/`:25` and by three epics-dashboard
 * partials, so an unscoped `div.sprint` is not this screen's sprint card. The
 * incumbent attribute selector was inherently scoped; the class substitution has
 * to say so.
 */
const SPRINT_SELECTOR = `${SPRINTS_SECTION_SELECTOR} div.sprint`;

/** `sprints.jade:41`. Used by `backlog-helper.js:131`, `sprintsOpen`. */
const SPRINT_OPEN_SELECTOR = `${SPRINT_SELECTOR}.sprint-open`;

/** `sprints.jade:54`. Used by `backlog-helper.js:185`, `closedSprints`. */
const SPRINT_CLOSED_SELECTOR = `${SPRINT_SELECTOR}.sprint-closed`;

/**
 * `sprint-header.jade:12`-`:20`, read by `backlog-helper.js:253`
 * (`getSprintsTitles`, whose `.sprint-name span` half needed no substitution).
 */
const SPRINT_NAME_TEXT_SELECTOR = '.sprint-name span';

/** `sprint-header.jade:13`. Collapses / expands one sprint card. */
const SPRINT_TOGGLE_SELECTOR = 'button.compact-sprint';

/** `sprint.jade:13`. The card body, and the drop zone for a story. */
const SPRINT_TABLE_SELECTOR = '.sprint-table';

/**
 * `sprint.jade:14`: `div.sprint-empty(ng-if="!sprint.user_stories.length")`.
 * `backlog-helper.js:171` took `.last()` of these as the closed sprint's table.
 */
const SPRINT_EMPTY_SELECTOR = '.sprint-empty';

/** `sprint.jade:17`-`:23`. One story inside a sprint; also carries `data-id`. */
const SPRINT_STORY_ROW_SELECTOR = 'div.row.milestone-us-item-row';

/**
 * SUBSTITUTION 2b (T1), the sprint-row half. Incumbent:
 * `sprint.$$('span[tg-bo-ref]')` (`backlog-helper.js:249`, `getSprintsRefs`).
 *
 * `sprint.jade:31`-`:33` proves the replacement: `span.us-ref-text(tg-bo-ref="us.ref")`
 * — a DIFFERENT class from the backlog row's `span.user-story-number`
 * ({@link ROW_REF_SELECTOR}), which is why the one incumbent selector had to
 * become two.
 */
const SPRINT_STORY_REF_SELECTOR = 'span.us-ref-text';

/** `sprint-header.jade:24`-`:29`: `a.edit-sprint(ng-if="::isEditable")`. */
const SPRINT_EDIT_SELECTOR = 'a.edit-sprint';

/** `sprint.jade:10`-`:11`. `tgProgressBar` is a retained shared directive; the class is the hook. */
const SPRINT_PROGRESS_BAR_SELECTOR = '.summary-progress-wrapper > .sprint-progress-bar';

/**
 * `sprint.jade:55`-`:62`. The only `a.btn-small` inside a sprint card.
 *
 * ⚠ Its destination — the taskboard — STAYS AngularJS and is OUT OF SCOPE, so
 * only the link itself is exposed. Its `tg-nav="project-taskboard:…"` target and
 * its `view_milestones` gate are assertions for the spec, never a navigation this
 * page object performs.
 */
const SPRINT_TASKBOARD_BUTTON_SELECTOR = 'a.btn-small';

/**
 * `sprints.jade:49`-`:52`: `a.filter-closed-sprints(tg-backlog-toggle-closed-sprints-visualization, ng-if="totalClosedMilestones")`.
 * Used by `backlog-helper.js:175`. The directive is retired
 * (`backlog/sprints.coffee:166`); the class is the surviving hook.
 */
const CLOSED_SPRINTS_TOGGLE_SELECTOR = `${SPRINTS_SECTION_SELECTOR} a.filter-closed-sprints`;

/**
 * STALE SELECTOR 8a. Incumbent: `$('.add-sprint')` (`backlog-helper.js:167`,
 * `openNewMilestone`).
 *
 * `.add-sprint` is STYLED (`app/styles/modules/backlog/sprints.scss:16`) but
 * EMITTED BY NO TEMPLATE, so the incumbent click resolved to nothing. The real
 * affordance is `sprints.jade:16`-`:24`:
 * `header.sprint-header > a.btn-link(ng-click="ctrl.addNewSprint()", ng-if="totalMilestones", tg-check-permission="add_milestone")`.
 */
const NEW_SPRINT_HEADER_LINK_SELECTOR = 'header.sprint-header a.btn-link';

/**
 * STALE SELECTOR 8b — the other half of the same correction.
 *
 * `sprints.jade:16`'s link is gated on `ng-if="totalMilestones"`, so with ZERO
 * sprints it does not exist and the only way to add one is the empty state's own
 * link, `sprints.jade:32`-`:39`: `div.empty-small > a.btn-link(ng-click="ctrl.addNewSprint()")`.
 * Both are handled, because the incumbent's single stale selector hid the fact
 * that there are two.
 */
const NEW_SPRINT_EMPTY_LINK_SELECTOR = 'div.empty-small a.btn-link';


/* ===========================================================================
 * Selectors — lightboxes
 * ======================================================================== */

/** `e2e/utils/lightbox.js:36`. The class every lightbox raises when it opens. */
const LIGHTBOX_OPEN_CLASS = 'open';

/**
 * SUBSTITUTION 5 (T1). Incumbent: `$('div[tg-lb-create-edit-sprint]')`
 * (`backlog-helper.js:94`, `getCreateEditMilestone`).
 *
 * `tgLbCreateEditSprint` is one of the directives this migration RETIRES
 * (`app/coffee/modules/backlog/lightboxes.coffee:237`), which is exactly why the
 * attribute is gone — unlike the two lightboxes below, whose directives are
 * shared and retained. React's `SprintFormLightbox` keeps the class contract, so
 * the class is the hook.
 *
 * ⚠ THE CLASS IS `lightbox-sprint-add-edit`, NOT `lightbox-generic-form`.
 * `backlog.jade:201` emits `div.lightbox.lightbox-sprint-add-edit(tg-lb-create-edit-sprint)`;
 * `lightbox-generic-form` belongs to the *create-edit user-story* lightbox one
 * line earlier at `:196`. The sprint class is unique repo-wide (its only other
 * occurrence is the rule that styles it,
 * `app/styles/modules/common/lightbox.scss:251`), so it needs no further
 * qualification — but every field accessor below is nevertheless scoped INSIDE
 * it, which is what keeps `.e2e-sprint-name` and `input[name="name"]` unambiguous.
 */
const SPRINT_FORM_LIGHTBOX_SELECTOR = 'div.lightbox.lightbox-sprint-add-edit';

/**
 * SUBSTITUTION 6 — the PROTRACTOR-ONLY LOCATOR. Incumbent:
 * `el.element(by.model('sprint.name'))` (`backlog-helper.js:105`).
 *
 * ⚠ `by.model` HAS NO PLAYWRIGHT EQUIVALENT, and could not have one: it resolved
 * an element by the AngularJS `ng-model` EXPRESSION bound to it, which means
 * reaching into the framework's own binding registry. After the migration there
 * is no `ng-model` on this field to resolve, and Playwright has no framework-aware
 * locator to resolve it with.
 *
 * `lightbox-sprint-add-edit.jade:13`-`:21` supplies the replacement:
 * `input.sprint-name.e2e-sprint-name(type="text", name="name", data-required="true", data-maxlength="500")`.
 * The `name` attribute is used together with the class because `name` is the
 * field's identity in the payload while the class is its identity in the
 * stylesheet — agreeing on both is what makes the substitution verifiable.
 *
 * ⚠ Deliberately NOT `.e2e-sprint-name`, which the incumbent
 * `createSprintFromForecasting` used (`backlog-helper.js:153`): `gulpfile.js:273`
 * strips it from a deployed build. `sprint-name` is the field's OTHER class on the
 * same element (`lightbox-sprint-add-edit.jade:13`) and survives, so this reaches the
 * same input in every build.
 */
const SPRINT_FORM_NAME_SELECTOR = 'input.sprint-name[name="name"]';

/**
 * `lightbox-sprint-add-edit.jade:22`: `label.last-sprint-name`.
 *
 * Worth exposing because it is the OBSERVABLE side of the form's validation
 * failure path: `backlog/lightboxes.coffee:46`-`:49` adds `disappear` to exactly
 * this element when `form.validate()` fails.
 */
const SPRINT_FORM_LAST_NAME_SELECTOR = 'label.last-sprint-name';

/** `lightbox-sprint-add-edit.jade:26`-`:33`. Required. */
const SPRINT_FORM_START_DATE_SELECTOR = 'input.date-start[name="estimated_start"]';

/** `lightbox-sprint-add-edit.jade:35`-`:42`. Required. */
const SPRINT_FORM_FINISH_DATE_SELECTOR = 'input.date-end[name="estimated_finish"]';

/** `lightbox-sprint-add-edit.jade:45`-`:49`. */
const SPRINT_FORM_SUBMIT_SELECTOR = 'button.btn-big.button-large.button-block[type="submit"]';

/** `lightbox-sprint-add-edit.jade:51`-`:56`, clicked by `backlog-helper.js:111`. */
const SPRINT_FORM_DELETE_SELECTOR = 'button.btn-link.delete-sprint';

/**
 * ⚠ RETAINED AngularJS ATTRIBUTE SELECTOR 1 of 2 — and STALE SELECTOR 10,
 * corrected.
 *
 * WHY IT IS RETAINED. `tgLbCreateEdit` is a RETAINED SHARED directive
 * (`app/coffee/modules/common/lightboxes.coffee:900`). This migration replaces the
 * backlog and kanban screens only; the create-edit user-story lightbox stays
 * AngularJS and is reached from both, so its attribute genuinely still exists in
 * the rendered document and is the honest thing to address it by.
 *
 * ⚠ WHY THE NAME CHANGED. The incumbent wrote `$('div[tg-lb-create-edit-userstory]')`
 * (`backlog-helper.js:14`, `getCreateEditUsLightbox`) and that attribute DOES NOT
 * EXIST: repository-wide, the string `tg-lb-create-edit-userstory` occurs in that
 * one helper line and NOWHERE ELSE. The real markup is
 * `div.lightbox.lightbox-generic-form.lightbox-create-edit(tg-lb-create-edit)` —
 * `backlog.jade:196`, and identically at `kanban.jade:66`, `issues.jade:113` and
 * `taskboard.jade:82`. The `-userstory` suffix was invented, so the incumbent
 * selector matched nothing; `e2e-react/pages/KanbanPage.ts` already addresses the
 * same lightbox by the corrected attribute, and this file agrees with it.
 */
const CREATE_EDIT_US_LIGHTBOX_SELECTOR =
    'div.lightbox.lightbox-generic-form.lightbox-create-edit[tg-lb-create-edit]';

/**
 * ⚠ RETAINED AngularJS ATTRIBUTE SELECTOR 2 of 2.
 *
 * WHY IT IS RETAINED. `tgLbCreateBulkUserstories` is likewise a RETAINED SHARED
 * directive (`app/coffee/modules/common/lightboxes.coffee:409`), and
 * `app/partials/includes/modules/lightbox-us-bulk.jade` remains in BOTH surviving
 * Jade shells. Verified present at `backlog.jade:198`:
 * `div.lightbox.lightbox-generic-bulk(tg-lb-create-bulk-userstories)`. Ported
 * verbatim from `backlog-helper.js:72`, with the class contract added so the
 * selector agrees with the stylesheet as well as with the directive.
 *
 * These two are the ONLY `[tg-*]`/`[ng-*]` attribute selectors in this file.
 */
const BULK_US_LIGHTBOX_SELECTOR = 'div.lightbox.lightbox-generic-bulk[tg-lb-create-bulk-userstories]';

/**
 * The confirmation dialog, ported from `e2e/utils/lightbox.js:74`-`:93`
 * (`confirm.ok` / `confirm.cancel`), which the backlog suite drove after deleting
 * a story (`backlog.e2e.js:203`) and after deleting a sprint (`:434`).
 */
const CONFIRM_LIGHTBOX_SELECTOR = '.lightbox-generic-ask';

/**
 * STALE SELECTOR 11. Incumbent: `lb.$('.button-green')`
 * (`e2e/utils/lightbox.js:80`).
 *
 * `.button-green` is NOT in this dialog. `lightbox-generic-ask.jade:22` emits
 * `button.btn-small.js-confirm(variant="primary")`, and the handler agrees: the
 * service that drives the dialog binds `el.on "click.confirm-dialog", ".js-confirm", …`
 * (`app/coffee/modules/common/confirm.coffee:51`, in `ask`). `.button-green` does
 * exist elsewhere in the application — `buttons.scss:54` styles it and
 * `lightbox-generic-error.jade:13` emits it — which is exactly how the incumbent
 * selector came to look plausible while matching nothing here.
 *
 * ⚠ THIS BUTTON IS ALSO DEBOUNCED BY 2000 MS — see {@link CONFIRM_DEBOUNCE_MS}.
 */
const CONFIRM_OK_SELECTOR = '.js-confirm';

/**
 * STALE SELECTOR 11, the other half. Incumbent: `lb.$('.button-red')`
 * (`e2e/utils/lightbox.js:90`).
 *
 * `lightbox-generic-ask.jade:17` emits `button.btn-link.btn-cancel.js-cancel`, and
 * `confirm.coffee:67` binds `.js-cancel`. `.button-red` is styled at
 * `buttons.scss:82` but is not emitted in this dialog.
 */
const CONFIRM_CANCEL_SELECTOR = '.js-cancel';

/* ===========================================================================
 * Selectors — popovers
 * ======================================================================== */

/**
 * `e2e/utils/popover.js:23`-`:26`. The convention is exact and is preserved:
 * EXACTLY ONE `.popover.active` must exist document-wide before an item is
 * picked. Anything else means two menus are open at once, and the pick would be a
 * coin toss.
 */
const ACTIVE_POPOVER_SELECTOR = '.popover.active';

/**
 * `e2e/utils/popover.js:16`: `popover.$$('a').get(item)`. Every popover on this
 * screen — status (`ul.popover.pop-status`), role (`.pop-role`), points
 * (`.pop-points-open`) — lists its options as anchors, so the ported index is an
 * index into the anchors of the open popover, ZERO-BASED exactly as Protractor's
 * `.get()` was.
 */
const POPOVER_ITEM_SELECTOR = 'a';

/* ===========================================================================
 * Timing budgets — every number is ported, and cited where it came from
 * ======================================================================== */

/**
 * How long the screen shell may take to appear after navigation.
 *
 * NOT A PORTED NUMBER — there is nothing to port. The incumbent leaned on
 * `browser.waitForAngular()`, which has no meaning for a React screen, and the
 * ported loader wait cannot stand in for it either: {@link waitLoader} treats a
 * MISSING `.loader` as settled (`e2e-react/fixtures/auth.ts`), and immediately
 * after `page.goto()` there is no loader in the document yet, so it returns at
 * once and this budget is what actually covers bootstrap, template fetch and the
 * screen's first API round-trips.
 *
 * ⚠ MEASURED, NOT GUESSED. 10000 ms was tried first and REPRODUCIBLY FAILED
 * against the running stack with `section.backlog` "not found" — twice, in
 * separate runs, on a host shared with sibling clones. It is aligned with
 * `playwright.config.ts`'s own `actionTimeout` instead, which sits comfortably
 * inside its 60 s `navigationTimeout` and 90 s test timeout, so a genuinely
 * broken screen still fails as a screen-readiness error rather than as an opaque
 * test timeout.
 */
const SCREEN_READY_TIMEOUT_MS = 30000;

/** `e2e/utils/lightbox.js:37`, `:64`: `browser.wait(…, 4000)`. */
const LIGHTBOX_TIMEOUT_MS = 4000;

/**
 * `e2e/utils/lightbox.js:12` + `:39`: a 300 ms CSS transition plus the incumbent's
 * own 100 ms margin (`browser.sleep(transition + 100)`).
 */
const LIGHTBOX_TRANSITION_MS = 400;

/** `e2e/utils/popover.js:24`: `browser.wait(…, 3000)`. */
const POPOVER_TIMEOUT_MS = 3000;

/** `e2e/utils/popover.js:13` + `:18`: `var transition = 400` then `browser.sleep(transition)`. */
const POPOVER_TRANSITION_MS = 400;

/**
 * ⚠ THE SPRINT FORM DEBOUNCES ITS OWN SUBMIT BY TWO FULL SECONDS.
 *
 * `app/coffee/modules/backlog/lightboxes.coffee:38` declares
 * `submit = debounce 2000, (event) =>`, so the request does not leave the page
 * until 2000 ms after the click — and the incumbent suite compensated with bare
 * `browser.sleep(2000)` calls (`backlog.e2e.js:181`, `:396`).
 *
 * This file does NOT sleep. The debounce is folded into the budget of the
 * assertion that WAITS FOR THE OUTCOME instead
 * ({@link BacklogPage.sprintForm}'s `waitClose`), so a fast machine proceeds
 * immediately and a slow one is still tolerated. Two further behaviours of that
 * same form are worth knowing when writing waits against it: it calls
 * `form.reset()` on open (`:143`-`:144`), and it parses its dates through the
 * locale format `COMMON.PICKERDATE.FORMAT` (`:41`, `:147`).
 */
const SPRINT_SUBMIT_DEBOUNCE_MS = 2000;

/**
 * ⚠ THE CONFIRMATION DIALOG DEBOUNCES ITS ACCEPT BUTTON BY THE SAME TWO SECONDS.
 *
 * `app/coffee/modules/common/confirm.coffee:51` binds
 * `el.on "click.confirm-dialog", ".js-confirm", debounce 2000, …`, and the dialog is
 * only hidden later still, when the caller's own `finish()` runs after the delete
 * request resolves. So the close is two seconds plus a round-trip behind the click.
 *
 * Kept as its own constant rather than shared with
 * {@link SPRINT_SUBMIT_DEBOUNCE_MS}: the two are separate facts in separate files
 * that happen to agree on a number, and collapsing them would lose one of the two
 * citations.
 */
const CONFIRM_DEBOUNCE_MS = 2000;

/**
 * `e2e/shared/filters.js:21` slept a flat `browser.sleep(4000)` after opening the
 * filter panel. That sleep is REPLACED by a bounded visibility assertion on the
 * panel itself, reusing the same 4000 ms as the budget: the wait now ends as soon
 * as the panel is up, and fails loudly if it never is, instead of always costing
 * four seconds and never checking anything.
 */
const FILTER_PANEL_TIMEOUT_MS = 4000;

/**
 * One settle window per infinite-scroll pass in
 * {@link BacklogPage.loadFullBacklog}.
 *
 * The incumbent needed no equivalent because Protractor's control flow
 * synchronised on AngularJS between its two `count()` reads
 * (`backlog-helper.js:214`-`:224`). React fetches through a plain promise, so one
 * bounded window is needed for the next page to attach before the count is
 * re-read. It is a window, not a sleep floor: the loop exits as soon as the count
 * stops growing.
 */
const PAGINATION_SETTLE_MS = 500;

/**
 * The iteration cap on the one loop in this file.
 *
 * ⚠ `playwright.config.ts` sets `retries: 0`, so an unbounded loop does not fail
 * a test — it hangs the entire run until the 90 s test timeout fires with no
 * diagnosis. 30 passes is far more than the seeded dataset needs (roughly 7
 * projects, the largest of which holds well under 30 pages of stories) and is
 * small enough that hitting it is unambiguously a defect rather than a big
 * backlog.
 */
const MAX_PAGINATION_ITERATIONS = 30;

/* ===========================================================================
 * Module-private helpers
 *
 * `KanbanPage.ts` keeps its own equivalents of the first two MODULE-PRIVATE (it
 * exports only `dndKitDrag`, `DndKitDragOptions` and the class itself), so these
 * are defined here rather than imported. Widening that file's public surface to
 * share four lines would mean editing a file this task does not own.
 * ======================================================================== */

/**
 * Matches a class as a WHOLE TOKEN.
 *
 * PORTED FROM `common.hasClass` (`common.js:45`-`:49`), which split the attribute
 * on whitespace and used `indexOf`. The distinction is load-bearing on this
 * screen: a substring match for `active` would also be satisfied by `inactive`
 * (which `e2e/utils/notifications.js` uses as the OPPOSITE state) and by
 * `active-filters` and `active-popover`, both of which this screen emits.
 *
 * @param token - the single class name to match
 * @returns a pattern suitable for Playwright's `toHaveClass`
 */
function classTokenPattern(token: string): RegExp {
    return new RegExp(`(^|\\s)${token}(\\s|$)`);
}

/**
 * Whether an element currently carries a class, as a whole token.
 *
 * @param locator - the element to inspect; must resolve to exactly one
 * @param token - the class name to look for
 * @returns `false` when the element has no `class` attribute at all
 */
async function hasClassToken(locator: Locator, token: string): Promise<boolean> {
    const value = await locator.getAttribute('class');

    if (value === null) {
        return false;
    }

    return value.split(/\s+/).includes(token);
}

/**
 * A story row addressed by its user-story id rather than by its position.
 *
 * `backlog-row.jade:13` emits `data-id="{{ us.id }}"` unconditionally, which makes
 * it the only stable handle on a row: an index changes the moment anything is
 * reordered, and reordering is precisely what this screen does.
 *
 * @param userStoryId - the value of the row's `data-id`
 * @returns a CSS selector for that one row
 */
function rowIdSelector(userStoryId: string): string {
    return `div.us-item-row[${ROW_ID_ATTRIBUTE}=${JSON.stringify(userStoryId)}]`;
}

/**
 * The same, for a story inside a sprint. `sprint.jade:20` emits the identical
 * attribute on `div.row.milestone-us-item-row`.
 *
 * @param userStoryId - the value of the row's `data-id`
 * @returns a CSS selector for that one sprint row
 */
function sprintRowIdSelector(userStoryId: string): string {
    return `div.milestone-us-item-row[${ROW_ID_ATTRIBUTE}=${JSON.stringify(userStoryId)}]`;
}

/**
 * Reads a row's user-story id, refusing to continue without one.
 *
 * Every drag below settles on this value, so a missing `data-id` must stop the
 * test at the point the contract broke rather than a few lines later inside an
 * assertion that cannot explain itself.
 *
 * @param row - the story row
 * @returns the row's `data-id`
 * @throws if the attribute is absent or blank, which would mean the row markup no
 *   longer matches `backlog-row.jade:13` / `sprint.jade:20`
 */
async function requireRowId(row: Locator): Promise<string> {
    const userStoryId = await row.getAttribute(ROW_ID_ATTRIBUTE);

    if (userStoryId === null || userStoryId.trim() === '') {
        throw new Error(
            `BacklogPage: the story row carries no "${ROW_ID_ATTRIBUTE}"; the row markup no ` +
                'longer matches backlog-row.jade:13 / sprint.jade:20, so nothing can be tracked ' +
                'across a reorder.',
        );
    }

    return userStoryId;
}

/**
 * Milliseconds from a CSS time value.
 *
 * PORTED FROM `common.waitTransitionTime` (`common.js:321`-`:333`), which did
 * `parseFloat(value.replace('s', '')) * 1000`. `Number.parseFloat` stops at the
 * first number, so a shorthand list such as `"0.5s, 0.3s"` yields the first
 * duration — identical to the incumbent's behaviour, deliberately, rather than
 * "improved" into a maximum.
 *
 * @param value - a computed `transition-duration` or `transition-delay`
 * @returns the duration in milliseconds, or 0 when the value is not a number
 */
function cssSecondsToMs(value: string): number {
    const seconds = Number.parseFloat(value);

    return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

/**
 * Waits out an element's own declared CSS transition.
 *
 * PORTED FROM `common.waitTransitionTime` (`common.js:321`-`:333`), used by
 * `backlog-helper.js:178`-`:182` (`toggleSprint`) against `.sprint-table`. The
 * element is ASKED how long it takes rather than being given a guessed number, so
 * a stylesheet change cannot make this stale.
 *
 * @param target - the transitioning element
 */
async function waitTransitionTime(target: Locator): Promise<void> {
    const timings = await target.evaluate(
        (element: HTMLElement | SVGElement): { duration: string; delay: string } => {
            const style = window.getComputedStyle(element);

            return { duration: style.transitionDuration, delay: style.transitionDelay };
        },
    );

    await target
        .page()
        .waitForTimeout(cssSecondsToMs(timings.duration) + cssSecondsToMs(timings.delay));
}

/**
 * The sprint-form accessor.
 *
 * Mirrors the shape of the incumbent `getCreateEditMilestone()`
 * (`backlog-helper.js:93`-`:116`) — `el`, `waitOpen`, `waitClose`, `name`,
 * `submit`, `delete` — with the substituted selectors, plus the two date fields
 * and the last-sprint hint the incumbent never reached. Not exported: the class
 * is this module's only export, and structural typing lets a spec use the object
 * without naming its type.
 */
interface SprintFormAccessor {
    /** The lightbox itself. */
    readonly el: Locator;

    /** Required. See {@link SPRINT_FORM_NAME_SELECTOR} for the `by.model` substitution. */
    name(): Locator;

    /** Required. `data-required="true"` at `lightbox-sprint-add-edit.jade:30`. */
    startDate(): Locator;

    /** Required. `data-required="true"` at `lightbox-sprint-add-edit.jade:39`. */
    finishDate(): Locator;

    /** The element the validation-failure path marks with `disappear`. */
    lastSprintHint(): Locator;

    /** Clicks submit. Does NOT wait — see {@link SPRINT_SUBMIT_DEBOUNCE_MS}. */
    submit(): Promise<void>;

    /** Clicks delete, which raises the confirmation dialog. */
    delete(): Promise<void>;

    /** Waits for the lightbox to be open and its transition to finish. */
    waitOpen(): Promise<void>;

    /** Waits for it to be closed, with the submit debounce folded into the budget. */
    waitClose(): Promise<void>;
}


/* ===========================================================================
 * The page object
 * ======================================================================== */

export class BacklogPage {
    /**
     * @param page - the Playwright page, already authenticated by
     *   `e2e-react/fixtures/auth.ts`
     * @param projectSlug - which seeded project's backlog to drive
     *
     * ⚠ THE SLUG IS A PARAMETER BECAUSE THE INCUMBENT SUITE USED THREE PROJECTS,
     * and hardcoding one would make two of its flows untestable:
     *
     *   - `project-3` — the main backlog, `backlog.e2e.js:24`. The default, taken
     *     from `e2e-react/fixtures/seed.ts`'s `BACKLOG_PROJECT_SLUG` so the
     *     provenance lives in one place.
     *   - `project-1` — velocity forecasting, `backlog.e2e.js:462` and `:475`
     *     (exported by the fixture as `VELOCITY_PROJECT_SLUG`). Forecasting only
     *     renders where `stats.speed > 0`.
     *   - `project-5` — "hide forecasting if no velocity", `backlog.e2e.js:488`
     *     (exported as `NO_VELOCITY_PROJECT_SLUG`). That test asserts the
     *     forecasting buttons are ABSENT, which is only meaningful on a project
     *     that has no velocity.
     */
    constructor(
        private readonly page: Page,
        private readonly projectSlug: string = BACKLOG_PROJECT_SLUG,
    ) {}

    /* -----------------------------------------------------------------------
     * Navigation
     * -------------------------------------------------------------------- */

    /**
     * Navigates to this project's backlog and waits for it to be ready.
     *
     * PORTED FROM `backlog.e2e.js:24`-`:29`: `browser.get(host + 'project/project-3/backlog')`
     * followed by `utils.common.waitLoader()`.
     */
    async goto(): Promise<void> {
        await this.page.goto(BACKLOG_PATH_TEMPLATE(this.projectSlug));

        await this.waitLoaded();
    }

    /**
     * Waits until the screen is usable.
     *
     * Three gates, in order: the ported loader wait, the screen shell, then the
     * story list.
     *
     * ⚠ THE LIST IS AWAITED AS *ATTACHED*, NOT VISIBLE, AND THAT IS DELIBERATE.
     * `backlog.jade:142` wraps it in `section.backlog-table(ng-class="{'hidden': !userstories.length}")`,
     * so on an EMPTY backlog the list is present but hidden and a visibility gate
     * would time out on a perfectly healthy screen — `project-5`, one of the three
     * projects this page object must drive, is exactly the kind of project that
     * can present that way. Attachment is the readiness signal that holds for
     * every project.
     */
    async waitLoaded(): Promise<void> {
        await waitLoader(this.page);

        await expect(this.screenRoot()).toBeVisible({ timeout: SCREEN_READY_TIMEOUT_MS });

        await expect(this.tableBody()).toBeAttached({ timeout: SCREEN_READY_TIMEOUT_MS });
    }

    /* -----------------------------------------------------------------------
     * The story list
     * -------------------------------------------------------------------- */

    /** Every backlog story row. Ports `backlog-helper.js:118`-`:120`, `userStories`. */
    storyRows(): Locator {
        return this.page.locator(STORY_ROW_SELECTOR);
    }

    /**
     * One row by position.
     *
     * @param index - zero-based, matching Protractor's `.get(i)`
     */
    storyRow(index: number): Locator {
        return this.storyRows().nth(index);
    }

    /**
     * One row by user-story id — the stable handle across a reorder.
     *
     * ⚠ This is the DATABASE ID from `data-id`, NOT the `#ref` shown on screen; the
     * two are different sequences (see {@link ROW_ID_ATTRIBUTE} for the measured
     * evidence). Pass a value read from `data-id`, never one from
     * {@link storyRefs}.
     *
     * @param userStoryId - the value of the row's `data-id`
     */
    storyRowById(userStoryId: string): Locator {
        return this.page.locator(rowIdSelector(userStoryId));
    }

    /**
     * Every visible story reference, in rendered order.
     *
     * Ports `backlog-helper.js:210`-`:212` (`getUsRef`) across the whole list. Both
     * implementations render the reference with a trailing space, so each value is
     * trimmed.
     */
    async storyRefs(): Promise<string[]> {
        const refs = await this.storyRows().locator(ROW_REF_SELECTOR).allTextContents();

        return refs.map((ref: string): string => ref.trim());
    }

    /** How many stories the list currently holds. */
    async storyCount(): Promise<number> {
        return this.storyRows().count();
    }

    /**
     * Scrolls until infinite-scroll pagination stops adding rows.
     *
     * PORTED FROM `backlog-helper.js:214`-`:224`, which was an UNBOUNDED
     * `do { count; scrollIntoView(last); newcount } while (count < newcount)`.
     * Several backlog flows depend on the whole list being present — the incumbent
     * called it before dragging the last row into a closed sprint
     * (`backlog.e2e.js:536`) — and the pagination it drives is
     * `infinite-scroll="ctrl.loadUserstories()"` on `backlog-table.jade:19`.
     *
     * ⚠ THE CAP IS THE ONE THING THAT COULD NOT BE PORTED VERBATIM.
     * `playwright.config.ts` sets `retries: 0` and `workers: 1`, so an unbounded
     * loop against a screen that keeps re-rendering does not fail one test — it
     * consumes the whole run and reports a bare timeout. The cap converts that into
     * a named error at the point of failure.
     *
     * @param maxIterations - how many scroll passes to allow
     * @returns the final row count
     * @throws if `maxIterations` is not a positive integer, or if the list was
     *   still growing when the cap was reached
     */
    async loadFullBacklog(maxIterations: number = MAX_PAGINATION_ITERATIONS): Promise<number> {
        if (!Number.isInteger(maxIterations) || maxIterations < 1) {
            throw new Error(
                'BacklogPage.loadFullBacklog: maxIterations must be a positive integer, got ' +
                    `${String(maxIterations)}.`,
            );
        }

        const rows = this.storyRows();
        let count = await rows.count();

        for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
            // Nothing to scroll to, so nothing more can load. This is the empty
            // backlog, which is a valid state rather than a failure.
            if (count === 0) {
                return count;
            }

            await rows.last().scrollIntoViewIfNeeded();

            await this.page.waitForTimeout(PAGINATION_SETTLE_MS);

            const grown = await rows.count();

            if (grown === count) {
                return count;
            }

            count = grown;
        }

        throw new Error(
            `BacklogPage.loadFullBacklog: the story list was still growing after ` +
                `${String(maxIterations)} scroll passes (${String(count)} rows so far). Either the ` +
                'backlog is larger than this cap allows or pagination is not terminating.',
        );
    }

    /**
     * The longest story reference on screen.
     *
     * PORTED FROM `backlog-helper.js:227`-`:242` (`getTestingFilterRef`), whose
     * comment reads "get ref with the larger length": the filter specs needed a
     * reference that could not be a prefix of another one. The incumbent read each
     * row in a loop; reading them in one pass is the same computation with one
     * round-trip instead of N.
     *
     * @returns the longest reference, or an empty string on an empty backlog —
     *   which is what the incumbent's `let ref = ''` also returned
     */
    async longestStoryRef(): Promise<string> {
        const refs = await this.storyRefs();

        return refs.reduce(
            (longest: string, ref: string): string => (ref.length > longest.length ? ref : longest),
            '',
        );
    }

    /* -----------------------------------------------------------------------
     * Selection
     * -------------------------------------------------------------------- */

    /**
     * Selects one story, leaving it selected if it already was.
     *
     * PORTED FROM `backlog.e2e.js:235`, `:241`, `:297`, which clicked the row's
     * `input[type="checkbox"]` directly. The click here targets the
     * `.custom-checkbox` WRAPPER instead — see
     * {@link ROW_CHECKBOX_WRAPPER_SELECTOR} for why the styled input is not the
     * right target — and the outcome is then asserted on the input, which is the
     * only element that actually holds the state.
     *
     * Idempotent on purpose. The incumbent clicks were raw TOGGLES, and the suite
     * carried a comment admitting it relied on selections made by an earlier test
     * ("the us 1 and 2 are selected on the previous test", `backlog.e2e.js:262`).
     * A method named `selectStory` must mean "is selected afterwards".
     *
     * @param index - zero-based row position
     */
    async selectStory(index: number): Promise<void> {
        const row = this.storyRow(index);

        await row.scrollIntoViewIfNeeded();

        const checkbox = row.locator(ROW_CHECKBOX_SELECTOR);

        if (!(await checkbox.isChecked())) {
            await row.locator(ROW_CHECKBOX_WRAPPER_SELECTOR).click();
        }

        await expect(checkbox).toBeChecked();
    }

    /**
     * How many stories are selected.
     *
     * Ports `backlog-helper.js:122`-`:124` (`selectedUserStories`), including its
     * `:checked` pseudo-class, which stays ASSERTION-ONLY exactly as the incumbent
     * used it.
     */
    async selectedStoryCount(): Promise<number> {
        return this.page.locator(CHECKED_ROW_CHECKBOX_SELECTOR).count();
    }

    /* -----------------------------------------------------------------------
     * Row actions
     * -------------------------------------------------------------------- */

    /**
     * Opens one row's kebab menu, and does nothing if it is already open.
     *
     * ⚠ THE INCUMBENT SKIPPED THIS STEP AND WAS BROKEN BY CONSTRUCTION.
     * `openUsBacklogEdit` (`backlog-helper.js:158`-`:160`) clicked
     * `$$('.backlog-table-body .e2e-edit').get(item)` WITHOUT opening anything
     * first — but the menu that holds `.e2e-edit` does not exist until the kebab is
     * clicked: `UsEditSelector` compiles and APPENDS `backlog/us-edit-popover.html`
     * on click and removes it again on close
     * (`backlog/main.coffee:1009`-`:1015`). React gates the same markup on its own
     * popover state, so the requirement is identical and now explicit.
     *
     * Idempotence matters because {@link editStory}, {@link moveStoryToTop} and
     * {@link deleteStory} each call this first; a spec that opens the menu to
     * inspect it and then acts on it must not have the second call toggle it shut.
     * The presence test is an immediate `count()`, never a wait.
     *
     * @param index - zero-based row position
     */
    async openRowActions(index: number): Promise<void> {
        const row = this.storyRow(index);

        await row.scrollIntoViewIfNeeded();

        if ((await row.locator(ROW_ACTIONS_POPUP_SELECTOR).count()) === 0) {
            // The trigger only reveals itself on hover in the compact row layout.
            await row.hover();

            await row.locator(ROW_ACTIONS_BUTTON_SELECTOR).click();
        }

        await this.waitPopover();
    }

    /**
     * Opens the create-edit lightbox for one story.
     *
     * PORTED FROM `backlog-helper.js:158`-`:160` plus the `waitOpen()` its callers
     * always paired with it (`backlog.e2e.js:133`-`:137`). Uses the disambiguated
     * `.e2e-edit.edit-story`, never the shared hook.
     *
     * @param index - zero-based row position
     */
    async editStory(index: number): Promise<void> {
        await this.openRowActions(index);

        await this.storyRow(index).locator(ROW_EDIT_SELECTOR).click();

        await this.waitLightboxOpen(this.createEditUsLightbox());
    }

    /**
     * Moves one story to the top of the backlog.
     *
     * Uses the OTHER `.e2e-edit` (`us-edit-popover.jade:24`), and settles on the
     * outcome that gives the action its name: the story's own `data-id` is now the
     * first row. Asserting the row rather than the menu closing is what makes this
     * independent of how the popover is dismissed.
     *
     * @param index - zero-based row position
     */
    async moveStoryToTop(index: number): Promise<void> {
        const userStoryId = await requireRowId(this.storyRow(index));

        await this.openRowActions(index);

        await this.storyRow(index).locator(ROW_MOVE_TO_TOP_SELECTOR).click();

        await expect(this.storyRows().first()).toHaveAttribute(ROW_ID_ATTRIBUTE, userStoryId);
    }

    /**
     * Asks to delete one story, and settles when the confirmation is up.
     *
     * PORTED FROM `backlog-helper.js:206`-`:208` (`deleteUs`), which the suite
     * always followed with `utils.lightbox.confirm.ok()` (`backlog.e2e.js:203`).
     * The confirmation is left to the caller — see {@link confirmOk} — because
     * cancelling is a case worth testing too.
     *
     * @param index - zero-based row position
     */
    async deleteStory(index: number): Promise<void> {
        await this.openRowActions(index);

        await this.storyRow(index).locator(ROW_DELETE_SELECTOR).click();

        await this.waitLightboxOpen(this.confirmLightbox());
    }

    /* -----------------------------------------------------------------------
     * Inline status and points — both go through popovers
     * -------------------------------------------------------------------- */

    /**
     * Sets one story's status inline.
     *
     * PORTED FROM `backlog-helper.js:188`-`:194` (`setUsStatus`), which routed
     * through `utils.popover.open(status, value)`. The whole ported convention is
     * reproduced in {@link waitPopover} and {@link pickPopoverItem}.
     *
     * @param index - zero-based row position
     * @param item - zero-based index into the open popover's anchors, exactly as
     *   `popover.$$('a').get(item)` meant (`e2e/utils/popover.js:16`)
     */
    async setStoryStatus(index: number, item: number): Promise<void> {
        const trigger = this.storyRow(index).locator(ROW_STATUS_TRIGGER_SELECTOR);

        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();

        await this.pickPopoverItem(item);
    }

    /**
     * One story's status, as rendered.
     *
     * Ports the read half of `backlog-helper.js:193`
     * (`status.$$('span').first().getText()`); that first span is
     * `span.us-status-bind` (`backlog-row.jade:62`), so naming the class reads the
     * same node while saying which node it is.
     *
     * @param index - zero-based row position
     */
    async storyStatusText(index: number): Promise<string> {
        const text = await this.storyRow(index)
            .locator(`${ROW_STATUS_TRIGGER_SELECTOR} ${ROW_STATUS_TEXT_SELECTOR}`)
            .innerText();

        return text.trim();
    }

    /**
     * Sets one story's points for one role inline — a TWO-LEVEL popover selection.
     *
     * PORTED FROM `backlog-helper.js:196`-`:200` (`setUsPoints`), which passed two
     * items to `utils.popover.open(points, value1, value2)`; that helper picks the
     * first item, settles, then WAITS FOR THE POPOVER AGAIN before picking the
     * second (`e2e/utils/popover.js:37`-`:40`). The second wait is essential rather
     * than cosmetic: the first pick swaps the role list for the points list, and
     * picking straight away would click into the list that is being replaced.
     *
     * @param index - zero-based row position
     * @param roleItem - zero-based index into the role popover's anchors
     * @param valueItem - zero-based index into the points popover's anchors
     */
    async setStoryPoints(index: number, roleItem: number, valueItem: number): Promise<void> {
        const trigger = this.storyRow(index).locator(ROW_POINTS_TRIGGER_SELECTOR);

        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();

        await this.pickPopoverItem(roleItem);

        await this.pickPopoverItem(valueItem);
    }

    /**
     * One story's points, as rendered.
     *
     * Ports `backlog-helper.js:202`-`:204` (`getUsPoints`). With a role filter
     * active the value takes the `n / m` form the incumbent asserted against
     * (`backlog.e2e.js:375`).
     *
     * @param index - zero-based row position
     */
    async storyPointsText(index: number): Promise<string> {
        const text = await this.storyRow(index)
            .locator(`${ROW_POINTS_TRIGGER_SELECTOR} ${ROW_POINTS_VALUE_SELECTOR}`)
            .innerText();

        return text.replace(/\s+/g, ' ').trim();
    }


    /* -----------------------------------------------------------------------
     * User-story lightboxes — both stay AngularJS
     * -------------------------------------------------------------------- */

    /**
     * Opens the create-user-story lightbox from the backlog header.
     *
     * PORTED FROM `backlog-helper.js:138`-`:140` (`openNewUs`), whose `.new-us a`
     * selector was stale — see {@link ADD_US_BUTTON_SELECTOR}.
     */
    async openNewUsLightbox(): Promise<void> {
        await this.page.locator(ADD_US_BUTTON_SELECTOR).click();

        await this.waitLightboxOpen(this.createEditUsLightbox());
    }

    /**
     * Opens the bulk-create lightbox.
     *
     * PORTED FROM `backlog-helper.js:134`-`:136` (`openBulk`) — see
     * {@link BULK_US_BUTTON_SELECTOR} for the stale `.new-us a` correction.
     */
    async openBulkUsLightbox(): Promise<void> {
        await this.page.locator(BULK_US_BUTTON_SELECTOR).click();

        await this.waitLightboxOpen(this.bulkUsLightbox());
    }

    /**
     * The create-edit user-story lightbox, which REMAINS AngularJS
     * (`tgLbCreateEdit`, `common/lightboxes.coffee:900`). Its fields are the shared
     * directive's, so they are left to the spec rather than wrapped here.
     */
    createEditUsLightbox(): Locator {
        return this.page.locator(CREATE_EDIT_US_LIGHTBOX_SELECTOR);
    }

    /**
     * The bulk-create lightbox, which likewise REMAINS AngularJS
     * (`tgLbCreateBulkUserstories`, `common/lightboxes.coffee:409`).
     */
    bulkUsLightbox(): Locator {
        return this.page.locator(BULK_US_LIGHTBOX_SELECTOR);
    }

    /* -----------------------------------------------------------------------
     * Confirmation dialog
     * -------------------------------------------------------------------- */

    /** The generic confirmation dialog. Ports `e2e/utils/lightbox.js:77`. */
    confirmLightbox(): Locator {
        return this.page.locator(CONFIRM_LIGHTBOX_SELECTOR);
    }

    /**
     * Accepts the confirmation dialog.
     *
     * PORTED FROM `lightbox.confirm.ok` (`e2e/utils/lightbox.js:76`-`:83`): wait
     * open, click accept, wait closed. Driven by the suite after deleting a story
     * (`backlog.e2e.js:203`) and a sprint (`:434`).
     *
     * The incumbent's `.button-green` was stale — see {@link CONFIRM_OK_SELECTOR} —
     * and the accept it addresses is debounced, so the close budget absorbs
     * {@link CONFIRM_DEBOUNCE_MS} rather than assuming immediacy.
     */
    async confirmOk(): Promise<void> {
        const dialog = this.confirmLightbox();

        await this.waitLightboxOpen(dialog);

        await dialog.locator(CONFIRM_OK_SELECTOR).click();

        await this.waitLightboxClosed(
            CONFIRM_LIGHTBOX_SELECTOR,
            LIGHTBOX_TIMEOUT_MS + CONFIRM_DEBOUNCE_MS,
        );
    }

    /**
     * Dismisses the confirmation dialog.
     *
     * PORTED FROM `lightbox.confirm.cancel` (`e2e/utils/lightbox.js:86`-`:93`), whose
     * `.button-red` was stale — see {@link CONFIRM_CANCEL_SELECTOR}. Cancel is NOT
     * debounced (`confirm.coffee:67`), so the standard close budget applies.
     */
    async confirmCancel(): Promise<void> {
        const dialog = this.confirmLightbox();

        await this.waitLightboxOpen(dialog);

        await dialog.locator(CONFIRM_CANCEL_SELECTOR).click();

        await this.waitLightboxClosed(CONFIRM_LIGHTBOX_SELECTOR);
    }

    /* -----------------------------------------------------------------------
     * Sprint sidebar
     * -------------------------------------------------------------------- */

    /** Every sprint card, open or closed. Ports `backlog-helper.js:126`-`:128`. */
    sprints(): Locator {
        return this.page.locator(SPRINT_SELECTOR);
    }

    /**
     * One sprint card by position.
     *
     * @param index - zero-based, matching `backlog-helper.js`'s `.get(i)`
     */
    sprint(index: number): Locator {
        return this.sprints().nth(index);
    }

    /** The open sprints. Ports `backlog-helper.js:130`-`:132` (`sprintsOpen`). */
    openSprints(): Locator {
        return this.page.locator(SPRINT_OPEN_SELECTOR);
    }

    /** The closed sprints. Ports `backlog-helper.js:184`-`:186` (`closedSprints`). */
    closedSprints(): Locator {
        return this.page.locator(SPRINT_CLOSED_SELECTOR);
    }

    /**
     * Every sprint's name, in sidebar order.
     *
     * Ports `backlog-helper.js:252`-`:254` (`getSprintsTitles`), which the suite used
     * to prove a created sprint appeared and a deleted one did not
     * (`backlog.e2e.js:398`-`:400`, `:438`-`:440`).
     */
    async sprintTitles(): Promise<string[]> {
        const titles = await this.sprints().locator(SPRINT_NAME_TEXT_SELECTOR).allTextContents();

        return titles.map((title: string): string => title.trim());
    }

    /**
     * Collapses or expands one sprint card.
     *
     * PORTED FROM `backlog-helper.js:178`-`:182` (`toggleSprint`): click
     * `.compact-sprint`, then wait out the body's own transition through
     * {@link waitTransitionTime}. The card's collapsed state is a CSS transition
     * rather than a class flip, which is why the settle asks the element how long it
     * takes instead of asserting a class.
     *
     * @param index - zero-based sprint position
     */
    async toggleSprint(index: number): Promise<void> {
        const sprint = this.sprint(index);

        await sprint.scrollIntoViewIfNeeded();

        await sprint.locator(SPRINT_TOGGLE_SELECTOR).click();

        await waitTransitionTime(sprint.locator(SPRINT_TABLE_SELECTOR));
    }

    /**
     * Shows or hides the closed sprints.
     *
     * PORTED FROM `backlog-helper.js:174`-`:176` (`toggleClosedSprints`). The control
     * is gated on `ng-if="totalClosedMilestones"` (`sprints.jade:50`) — the suite's
     * last assertion is in fact that it DISAPPEARS once the only closed sprint
     * reopens (`backlog.e2e.js:584`-`:586`) — so its presence is asserted rather
     * than assumed, and a spec that expects absence should read
     * {@link closedSprintsToggle} instead of calling this.
     */
    async toggleClosedSprints(): Promise<void> {
        const toggle = this.closedSprintsToggle();

        await expect(toggle).toHaveCount(1);

        await toggle.click();
    }

    /**
     * The closed-sprints toggle itself, exposed so a spec can assert its ABSENCE —
     * which is what `backlog.e2e.js:584` did with `isPresent()`.
     */
    closedSprintsToggle(): Locator {
        return this.page.locator(CLOSED_SPRINTS_TOGGLE_SELECTOR);
    }

    /**
     * The stories assigned to one sprint.
     *
     * Ports `backlog-helper.js:244`-`:246` (`getSprintUsertories`).
     *
     * @param index - zero-based sprint position
     */
    sprintStories(index: number): Locator {
        return this.sprint(index).locator(SPRINT_STORY_ROW_SELECTOR);
    }

    /**
     * One sprint's story references, in order.
     *
     * Ports `backlog-helper.js:248`-`:250` (`getSprintsRefs`), used to prove a story
     * had actually landed in the sprint (`backlog.e2e.js:309`-`:311`). Note the
     * CONTEXT-DEPENDENT class: a sprint row's reference is `span.us-ref-text`, not
     * the backlog row's `span.user-story-number`.
     *
     * @param index - zero-based sprint position
     */
    async sprintStoryRefs(index: number): Promise<string[]> {
        const refs = await this.sprintStories(index)
            .locator(SPRINT_STORY_REF_SELECTOR)
            .allTextContents();

        return refs.map((ref: string): string => ref.trim());
    }

    /**
     * The empty-sprint placeholders.
     *
     * Ports `backlog-helper.js:170`-`:172` (`getClosedSprintTable`), which took
     * `.last()` of these as the closed sprint's drop zone. The collection is
     * returned so the caller keeps that choice explicit.
     */
    sprintEmptyTable(): Locator {
        return this.page.locator(SPRINTS_SECTION_SELECTOR).locator(SPRINT_EMPTY_SELECTOR);
    }

    /**
     * One sprint's progress bar.
     *
     * ⚠ Presence and structure only. Its fill percentage is a stylesheet-driven
     * width and its colour is a theme token; neither is asserted here.
     *
     * @param index - zero-based sprint position
     */
    sprintProgressBar(index: number): Locator {
        return this.sprint(index).locator(SPRINT_PROGRESS_BAR_SELECTOR);
    }

    /**
     * One sprint's "sprint taskboard" link.
     *
     * ⚠ The taskboard itself STAYS AngularJS and is OUT OF SCOPE for this
     * migration, so this exposes the link for a navigation assertion and nothing
     * more (`sprint.jade:55`-`:62`, gated on `view_milestones`).
     *
     * @param index - zero-based sprint position
     */
    sprintTaskboardButton(index: number): Locator {
        return this.sprint(index).locator(SPRINT_TASKBOARD_BUTTON_SELECTOR);
    }

    /* -----------------------------------------------------------------------
     * Sprint form
     * -------------------------------------------------------------------- */

    /**
     * Opens the create-sprint lightbox.
     *
     * PORTED FROM `backlog-helper.js:166`-`:168` (`openNewMilestone`), whose
     * `.add-sprint` selector was emitted by no template at all — see
     * {@link NEW_SPRINT_HEADER_LINK_SELECTOR}.
     *
     * ⚠ BOTH AFFORDANCES ARE HANDLED because the header link is gated on
     * `ng-if="totalMilestones"` (`sprints.jade:20`): with zero sprints it does not
     * exist and the empty state's own link (`sprints.jade:32`-`:39`) is the only way
     * in. The choice is made with an IMMEDIATE `count()`, never a wait, and neither
     * branch swallows a failure — if both are missing this throws and says so.
     *
     * @throws if neither affordance is present, which means the sidebar did not
     *   render or the current user lacks `add_milestone`
     */
    async openNewSprintLightbox(): Promise<void> {
        const headerLink = this.page.locator(NEW_SPRINT_HEADER_LINK_SELECTOR);
        const emptyStateLink = this.page.locator(NEW_SPRINT_EMPTY_LINK_SELECTOR);

        if ((await headerLink.count()) > 0) {
            await headerLink.first().click();
        } else if ((await emptyStateLink.count()) > 0) {
            await emptyStateLink.first().click();
        } else {
            throw new Error(
                'BacklogPage.openNewSprintLightbox: neither the sidebar header link ' +
                    `("${NEW_SPRINT_HEADER_LINK_SELECTOR}", present only when the project already ` +
                    `has sprints) nor the empty-state link ("${NEW_SPRINT_EMPTY_LINK_SELECTOR}") is ` +
                    'rendered, so there is no way to add a sprint. The sidebar is missing, or the ' +
                    'signed-in user lacks the add_milestone permission.',
            );
        }

        await this.sprintForm().waitOpen();
    }

    /**
     * Opens the edit-sprint lightbox for one sprint.
     *
     * PORTED FROM `backlog-helper.js:162`-`:164` (`openMilestoneEdit`), whose
     * `div[tg-backlog-sprint="sprint"] .edit-sprint` becomes a scoped
     * `a.edit-sprint` — see {@link SPRINT_SELECTOR} and {@link SPRINT_EDIT_SELECTOR}.
     * The link is gated on `ng-if="::isEditable"` (`sprint-header.jade:25`), so its
     * presence is asserted rather than assumed.
     *
     * @param index - zero-based sprint position
     */
    async openEditSprint(index: number): Promise<void> {
        const link = this.sprint(index).locator(SPRINT_EDIT_SELECTOR);

        await expect(link).toHaveCount(1);

        await link.click();

        await this.sprintForm().waitOpen();
    }

    /**
     * The sprint create/edit form.
     *
     * Mirrors the incumbent `getCreateEditMilestone()`
     * (`backlog-helper.js:93`-`:116`) with the substituted selectors, and adds the
     * two required date fields plus the last-sprint hint that the Protractor helper
     * never reached.
     *
     * ⚠ `submit()` DOES NOT WAIT, on purpose. The form debounces its own submit by
     * 2000 ms (`backlog/lightboxes.coffee:38`), so what a caller has to wait for is
     * the OUTCOME, not a fixed pause — `waitClose()` therefore carries the debounce
     * inside an explicit budget, and a spec asserting on the sidebar should assert
     * on {@link sprintTitles} rather than on elapsed time. The incumbent instead
     * slept a flat `browser.sleep(2000)` (`backlog.e2e.js:396`), which is both
     * slower and less reliable.
     */
    sprintForm(): SprintFormAccessor {
        const el = this.sprintFormLightbox();

        return {
            el,
            name: (): Locator => el.locator(SPRINT_FORM_NAME_SELECTOR),
            startDate: (): Locator => el.locator(SPRINT_FORM_START_DATE_SELECTOR),
            finishDate: (): Locator => el.locator(SPRINT_FORM_FINISH_DATE_SELECTOR),
            lastSprintHint: (): Locator => el.locator(SPRINT_FORM_LAST_NAME_SELECTOR),
            submit: async (): Promise<void> => {
                await el.locator(SPRINT_FORM_SUBMIT_SELECTOR).click();
            },
            delete: async (): Promise<void> => {
                await el.locator(SPRINT_FORM_DELETE_SELECTOR).click();
            },
            waitOpen: async (): Promise<void> => {
                await this.waitLightboxOpen(el);
            },
            waitClose: async (): Promise<void> => {
                await this.waitLightboxClosed(
                    SPRINT_FORM_LIGHTBOX_SELECTOR,
                    LIGHTBOX_TIMEOUT_MS + SPRINT_SUBMIT_DEBOUNCE_MS,
                );
            },
        };
    }

    /* -----------------------------------------------------------------------
     * Toolbar
     * -------------------------------------------------------------------- */

    /**
     * Toggles the tag pills on the story rows.
     *
     * PORTED FROM `backlog.e2e.js:445` and `:455`, both `$('#show-tags').click()`.
     * The click targets the LABEL instead — see
     * {@link SHOW_TAGS_CONTAINER_SELECTOR} for the visually-hidden-input finding —
     * and the outcome is asserted on `.check`, which is where the state lives.
     */
    async toggleTags(): Promise<void> {
        const label = this.page.locator(SHOW_TAGS_LABEL_SELECTOR);

        await expect(label).toHaveCount(1);

        const check = this.page.locator(SHOW_TAGS_CHECK_SELECTOR);
        const wasShown = await hasClassToken(check, ACTIVE_CLASS);

        await label.click();

        const active = classTokenPattern(ACTIVE_CLASS);

        // Asserted on both branches: the postcondition is a flipped state, never
        // "a click was dispatched".
        if (wasShown) {
            await expect(check).not.toHaveClass(active);
        } else {
            await expect(check).toHaveClass(active);
        }
    }

    /**
     * Whether the tag pills are currently shown.
     *
     * ⚠ READ WITH AN IMMEDIATE COUNT, NEVER A WAIT. The whole control is gated on
     * `ng-if="userstories.length"` (`backlog.jade:74`), so on an empty backlog it is
     * ABSENT — and "absent" means "tags are not shown", which is a legitimate answer
     * rather than something to wait for.
     */
    async tagsShown(): Promise<boolean> {
        const check = this.page.locator(SHOW_TAGS_CHECK_SELECTOR);

        if ((await check.count()) === 0) {
            return false;
        }

        return hasClassToken(check, ACTIVE_CLASS);
    }

    /**
     * The tag pills on the story rows.
     *
     * Ports `$$('.backlog-table .tag')` (`backlog.e2e.js:442`, `:452`), which the
     * suite asserted was displayed after showing tags and not displayed after
     * hiding them.
     *
     * ⚠ THE PILL'S COLOUR IS DATA (`tag[1]`) and must never be asserted.
     */
    visibleTags(): Locator {
        return this.page.locator(TAG_SELECTOR);
    }

    /**
     * Sends the selected stories to the current sprint.
     *
     * Disambiguated from its twin — see {@link MOVE_TO_CURRENT_SPRINT_SELECTOR}. The
     * outcome (which sprint the stories landed in) is left to the spec, exactly as
     * `backlog.e2e.js:294`-`:312` asserted it through the sprint's own refs.
     */
    async moveToCurrentSprint(): Promise<void> {
        const button = this.page.locator(MOVE_TO_CURRENT_SPRINT_SELECTOR);

        await expect(button).toHaveCount(1);

        await button.click();
    }

    /**
     * Sends the selected stories to the latest sprint.
     *
     * The button the incumbent actually reached at `backlog.e2e.js:299`, since the
     * seeded project has no current sprint — which is precisely why the shared
     * `.e2e-move-to-sprint` hook had to be disambiguated rather than trusted.
     */
    async moveToLatestSprint(): Promise<void> {
        const button = this.page.locator(MOVE_TO_LATEST_SPRINT_SELECTOR);

        await expect(button).toHaveCount(1);

        await button.click();
    }

    /**
     * Both velocity-forecasting buttons as one collection.
     *
     * Ports `backlog-helper.js:142`-`:144` (`velocityForecasting`), which
     * `backlog.e2e.js:491`-`:498` asserted was EMPTY on a project with no velocity.
     * That assertion is the reason the collection is exposed at all.
     */
    velocityForecastingButtons(): Locator {
        return this.page.locator(VELOCITY_FORECASTING_SELECTOR);
    }

    /** The button shown WHILE forecasting is open — `backlog.jade:107`, which carries `active`. */
    velocityForecastingReturnButton(): Locator {
        return this.page.locator(VELOCITY_FORECASTING_RETURN_SELECTOR);
    }

    /** The button shown while it is CLOSED — `backlog.jade:116`, which does not. */
    velocityForecastingEnterButton(): Locator {
        return this.page.locator(VELOCITY_FORECASTING_ENTER_SELECTOR);
    }

    /**
     * Enters the velocity-forecasting view.
     *
     * PORTED FROM `backlog-helper.js:146`-`:148` (`openVelocityForecasting`), which
     * called `.click()` on the whole `$$('.e2e-velocity-forecasting')` COLLECTION —
     * something Playwright rightly refuses, and which would have been a coin toss
     * between entering and leaving had both buttons ever rendered together. The
     * single explicit button is clicked, and the toggle having flipped is then
     * asserted through its twin.
     */
    async openVelocityForecasting(): Promise<void> {
        const enter = this.velocityForecastingEnterButton();

        await expect(enter).toHaveCount(1);

        await enter.click();

        await expect(this.velocityForecastingReturnButton()).toHaveCount(1);
    }

    /**
     * Creates a sprint from the forecasting view.
     *
     * PORTED FROM `backlog-helper.js:150`-`:156` (`createSprintFromForecasting`),
     * with three deliberate differences. The incumbent generated its own name from
     * `new Date().getTime()`; the name is a PARAMETER here so the spec can assert on
     * a value it chose. `sendKeys` APPENDS, so it left whatever `form.reset()` had
     * put in the field; `fill` replaces, which is what the flow means. And
     * `protractor.Key.ENTER` becomes `press('Enter')` — there is no Protractor key
     * table to reach for.
     *
     * `.e2e-sprint-name` and `input.sprint-name[name="name"]` are the SAME element
     * (`lightbox-sprint-add-edit.jade:13`), so the form accessor is reused rather
     * than the raw hook, which keeps the field scoped inside its own lightbox.
     *
     * @param name - the sprint name to type
     * @throws if `name` is blank, which the required-field rule would reject anyway
     *   — better to say so here than to watch a form silently refuse to submit
     */
    async createSprintFromForecasting(name: string): Promise<void> {
        if (name.trim() === '') {
            throw new Error(
                'BacklogPage.createSprintFromForecasting: name must not be blank; ' +
                    'lightbox-sprint-add-edit.jade:18 marks the field data-required="true", so a ' +
                    'blank name fails validation instead of creating a sprint.',
            );
        }

        const addSprint = this.page.locator(VELOCITY_ADD_SPRINT_SELECTOR);

        await expect(addSprint).toHaveCount(1);

        await addSprint.click();

        const form = this.sprintForm();

        await form.waitOpen();

        await form.name().fill(name);
        await form.name().press('Enter');

        await form.waitClose();
    }

    /* -----------------------------------------------------------------------
     * Filters
     * -------------------------------------------------------------------- */

    /**
     * Filters the points column by role.
     *
     * PORTED FROM `backlog-helper.js:260`-`:264` (`fiterRole`, misspelling in the
     * original), which opened a popover on `div[tg-us-role-points-selector]` — see
     * {@link ROLE_POINTS_FILTER_SELECTOR} for the substitution.
     *
     * @param item - zero-based index into the popover's anchors
     */
    async filterByRole(item: number): Promise<void> {
        const trigger = this.page.locator(ROLE_POINTS_FILTER_SELECTOR);

        await expect(trigger).toHaveCount(1);

        await trigger.click();

        await this.pickPopoverItem(item);
    }

    /**
     * Opens the filter panel, and leaves it open if it already was.
     *
     * PORTED FROM `filters-helper.js:17`-`:29` plus `e2e/shared/filters.js:20`-`:21`.
     * Two changes, both deliberate. The incumbent RETURNED SILENTLY when
     * `.e2e-open-filter` was absent (`filters-helper.js:22`-`:24`), which meant the
     * filter specs then asserted against a panel that had never opened; here the
     * control is required, so a missing toolbar fails at the point it is missing.
     * And the flat `browser.sleep(4000)` becomes a BOUNDED VISIBILITY ASSERTION on
     * the panel with the same 4000 ms as its budget — it returns as soon as the
     * panel is up, and fails loudly if it never is.
     */
    async openFilters(): Promise<void> {
        const toggle = this.page.locator(FILTER_TOGGLE_SELECTOR);

        await expect(toggle).toHaveCount(1);

        if (!(await hasClassToken(toggle, ACTIVE_CLASS))) {
            await toggle.click();
        }

        await expect(this.filterPanel()).toBeVisible({ timeout: FILTER_PANEL_TIMEOUT_MS });
    }

    /**
     * The filter panel. `tg-filter` is an ELEMENT the unedited stylesheets target,
     * so React keeps emitting it and it is NOT substituted — see
     * {@link FILTER_PANEL_SELECTOR} for why it is scoped to the screen root rather
     * than to the `.backlog-filter` wrapper.
     */
    filterPanel(): Locator {
        return this.screenRoot().locator(FILTER_PANEL_SELECTOR);
    }

    /**
     * Steps back to the filter category list.
     *
     * PORTED FROM `backlog-helper.js:256`-`:258` (`goBackFilters`), including its
     * `.first()`: the breadcrumb renders one link per level, and the first is the
     * way back to the categories.
     */
    async goBackFilters(): Promise<void> {
        await this.page.locator(FILTER_BREADCRUMB_SELECTOR).first().click();
    }

    /* -----------------------------------------------------------------------
     * Summary bar and doom line
     * -------------------------------------------------------------------- */

    /**
     * The four summary figures, in rendered order: project points, defined points,
     * closed points, points per sprint (`summary.jade:14`-`:25`).
     *
     * ⚠ The first block is gated on `ng-if="stats.total_points"`, so a project with
     * no estimation renders three rather than four. The array is returned as found
     * instead of being padded, because the count is itself part of what a spec may
     * want to assert.
     */
    async summaryStats(): Promise<string[]> {
        const numbers = await this.page
            .locator(SUMMARY_SELECTOR)
            .locator(SUMMARY_STAT_NUMBER_SELECTOR)
            .allTextContents();

        return numbers.map((value: string): string => value.trim());
    }

    /** The summary bar's progress bar (`summary.jade:9`). Presence and structure only. */
    summaryProgressBar(): Locator {
        return this.page.locator(SUMMARY_SELECTOR).locator(SUMMARY_PROGRESS_BAR_SELECTOR);
    }

    /**
     * The doom line spliced into the story list.
     *
     * At most one ever exists — the incumbent's own loop `break`s at the first row
     * that crosses the threshold (`backlog/main.coffee:748`) — so a spec can assert
     * a count of exactly one, or zero on a project with no point total.
     */
    milestoneDivider(): Locator {
        return this.page.locator(MILESTONE_DIVIDER_SELECTOR);
    }

    /* -----------------------------------------------------------------------
     * Drag and drop
     * -------------------------------------------------------------------- */

    /**
     * Reorders the backlog by dragging one story onto another.
     *
     * PORTED FROM `backlog.e2e.js:210`-`:224` ("drag backlog us"), which dragged the
     * fifth row's handle onto the first and then compared references. The handle is
     * the corrected `.draggable-us-row` rather than the never-existent `.icon-drag`.
     *
     * ⚠ THIS METHOD MUST NOT SERIALISE CONSECUTIVE DRAGS, AND IT DOES NOT.
     * There is no internal sleep, no lock and no in-flight flag here. That is a
     * requirement rather than an omission: the screen keeps a `pendingDrag` FIFO
     * queue with a re-entrancy guard, because `bulk-update-us-backlog-order` is
     * POSITION-RELATIVE (`previousUs`/`nextUs` serialise as
     * `after_userstory_id`/`before_userstory_id`). If two drags are ever in flight
     * at once, the second computes its neighbours from an order the server has not
     * acknowledged and the persisted order silently diverges from what the user
     * sees — no error, no toast, no console warning, visible only on the next page
     * load. A page object that quietly serialised its own drags would make that bug
     * UNTESTABLE, so the rapid-consecutive-drag case stays available to the spec
     * that owns it.
     *
     * The settle is the dragged story being re-attached to the list, which holds
     * whichever direction the drag went. The resulting ORDER is asserted by the
     * spec through {@link storyRefs} or {@link storyRowById} — the same division of
     * labour the incumbent had, where `common.drag` settled mechanically and the
     * spec compared the references.
     *
     * @param fromIndex - zero-based position of the story to move
     * @param toIndex - zero-based position of the row to drop it on
     */
    async dragStory(fromIndex: number, toIndex: number): Promise<void> {
        const source = this.storyRow(fromIndex);
        const userStoryId = await requireRowId(source);

        await dndKitDrag(
            this.page,
            source.locator(DRAG_HANDLE_SELECTOR),
            this.storyRow(toIndex),
        );

        await expect(this.tableBody().locator(rowIdSelector(userStoryId))).toHaveCount(1);
    }

    /**
     * Drags one backlog story into a sprint.
     *
     * PORTED FROM `backlog.e2e.js:275`-`:292` ("drag us to milestone"), which
     * dropped onto `sprint.$('.sprint-table')` and counted the sprint's stories.
     *
     * The settle is exact and always correct: the moved story's own `data-id`
     * appears inside THAT sprint's body. Counting rows the way the incumbent did
     * cannot distinguish "the right story arrived" from "some story arrived", and
     * `.gu-mirror` — the incumbent's mechanical settle — does not exist under
     * `@dnd-kit/core` at all.
     *
     * ⚠ NO INTERNAL SERIALISATION, for the reason given on {@link dragStory}.
     *
     * ⚠ Off-screen targets are handled by `dndKitDrag`, which scrolls both ends into
     * view before it measures them. Story rows are virtualised, and drop targets
     * stay registered for rows outside the viewport, so a sprint further down the
     * sidebar is a legitimate destination rather than a missing one.
     *
     * @param rowIndex - zero-based position of the backlog story to move
     * @param sprintIndex - zero-based position of the destination sprint
     */
    async dragStoryToSprint(rowIndex: number, sprintIndex: number): Promise<void> {
        const source = this.storyRow(rowIndex);
        const userStoryId = await requireRowId(source);
        const target = this.sprint(sprintIndex).locator(SPRINT_TABLE_SELECTOR);

        await dndKitDrag(this.page, source.locator(DRAG_HANDLE_SELECTOR), target);

        await expect(target.locator(sprintRowIdSelector(userStoryId))).toHaveCount(1);
    }

    /* -----------------------------------------------------------------------
     * Internals
     * -------------------------------------------------------------------- */

    /** `backlog.jade:17`. */
    private screenRoot(): Locator {
        return this.page.locator(SCREEN_SELECTOR);
    }

    /** `backlog-table.jade:19`. */
    private tableBody(): Locator {
        return this.page.locator(TABLE_BODY_SELECTOR);
    }

    /** `backlog.jade:201`, addressed by its class — see {@link SPRINT_FORM_LIGHTBOX_SELECTOR}. */
    private sprintFormLightbox(): Locator {
        return this.page.locator(SPRINT_FORM_LIGHTBOX_SELECTOR);
    }

    /**
     * Waits for exactly one open popover.
     *
     * PORTED FROM `popover.wait` (`e2e/utils/popover.js:21`-`:27`), including the
     * cardinality: `$$('.popover.active').count() === 1` within 3000 ms. EXACTLY one
     * is the point — two open menus would make the next pick a coin toss between
     * them, so this fails rather than guessing.
     *
     * @returns the open popover
     */
    private async waitPopover(): Promise<Locator> {
        const popover = this.page.locator(ACTIVE_POPOVER_SELECTOR);

        await expect(popover).toHaveCount(1, { timeout: POPOVER_TIMEOUT_MS });

        return popover;
    }

    /**
     * Waits for the open popover and picks one of its items.
     *
     * PORTED FROM `selectPopoverItem` (`e2e/utils/popover.js:15`-`:19`): click the
     * nth anchor, then let the 400 ms transition finish. Every status, role and
     * points list on this screen is a list of anchors, which is what makes the one
     * ported index meaningful across all three.
     *
     * @param item - zero-based index into the open popover's anchors
     */
    private async pickPopoverItem(item: number): Promise<void> {
        const popover = await this.waitPopover();

        await popover.locator(POPOVER_ITEM_SELECTOR).nth(item).click();

        await this.page.waitForTimeout(POPOVER_TRANSITION_MS);
    }

    /**
     * Waits for a lightbox to be open.
     *
     * PORTED FROM `lightbox.open` (`e2e/utils/lightbox.js:28`-`:48`): wait up to
     * 4000 ms for the `open` class, then let the 300 ms transition finish plus the
     * incumbent's own 100 ms margin.
     *
     * @param lightbox - the lightbox element
     */
    private async waitLightboxOpen(lightbox: Locator): Promise<void> {
        await expect(lightbox).toHaveClass(classTokenPattern(LIGHTBOX_OPEN_CLASS), {
            timeout: LIGHTBOX_TIMEOUT_MS,
        });

        await this.page.waitForTimeout(LIGHTBOX_TRANSITION_MS);
    }

    /**
     * Waits for a lightbox to be closed — or gone.
     *
     * PORTED FROM `lightbox.close` (`e2e/utils/lightbox.js:50`-`:72`), whose
     * semantics were "absent counts as closed" (`present = await el.isPresent()`,
     * and it returned `true` without waiting when the element was not there). That
     * matters here because the AngularJS lightbox host is static markup that merely
     * loses its class, whereas a React one may be unmounted outright.
     *
     * Asserting that NOTHING matches `<selector>.open` expresses both states in one
     * bounded assertion, with no branch that could swallow a genuine failure — and
     * unlike a negated class assertion it does not require the element to exist.
     *
     * @param selector - the lightbox's own selector
     * @param timeout - the budget, widened by callers that must absorb the sprint
     *   form's 2000 ms submit debounce
     */
    private async waitLightboxClosed(
        selector: string,
        timeout: number = LIGHTBOX_TIMEOUT_MS,
    ): Promise<void> {
        await expect(this.page.locator(`${selector}.${LIGHTBOX_OPEN_CLASS}`)).toHaveCount(0, {
            timeout,
        });

        await this.page.waitForTimeout(LIGHTBOX_TRANSITION_MS);
    }
}

