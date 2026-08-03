/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Playwright page object for the React-migrated Kanban board.
 * ===========================================================================
 *
 * TECHNOLOGY-SPECIFIC CHANGE (AngularJS 1.5.10 -> React 18 migration).
 *
 * Two things live in this module, and only two:
 *
 *   1. {@link KanbanPage} — the board's selectors and flows, so the specs under
 *      `e2e-react/specs/` read as intent rather than as CSS.
 *   2. {@link dndKitDrag} — the SHARED `@dnd-kit/core` drag gesture, exported
 *      because `BacklogPage.ts` imports it from here. See "WHY THE DRAG HELPER
 *      LIVES IN A PAGE OBJECT" below; that placement is deliberate.
 *
 * PROVENANCE, AND WHY IT IS RECORDED HERE
 * ---------------------------------------------------------------------------
 * Every selector and every flow below is ported from the incumbent Protractor
 * layer, which is being retired by a different change in this same migration:
 *
 *     e2e/helpers/kanban-helper.js   (83 lines)  — the selector source
 *     e2e/suites/kanban.e2e.js      (289 lines)  — the flow source
 *     e2e/utils/common.js                        — waits, and the old drag
 *     e2e/utils/lightbox.js, popover.js          — wait budgets
 *     e2e/helpers/filters-helper.js, e2e/shared/filters.js — filter hooks
 *
 * Those files are NOT imported — they are CommonJS JavaScript on ambient
 * Protractor globals and `tsconfig.json` sets no `allowJs`, so importing one
 * would fail `tsc --noEmit` outright. Their knowledge is therefore carried
 * across as `file:line` citations at each point of use, so that the provenance
 * survives the suites' retirement rather than disappearing with them.
 *
 * THE INCUMBENT SELECTORS WERE AUDITED, NOT COPIED
 * ---------------------------------------------------------------------------
 * Seven of them no longer match the markup they were written against. A blind
 * port yields a page object that matches nothing — or, worse, clicks the WRONG
 * control and reports green. Each correction is stated again at its point of
 * use; the inventory is:
 *
 *   1. `.task-column`            -> `.kanban-uses-box.taskboard-column`
 *   2. `.options a`              -> `.options button.option`
 *   3. `.option` index 2         -> that is the FOLD button, not add-US;
 *                                   anchor on icon classes, never on an index
 *   4. `.card-owner-actions`     -> `.card-actions button.js-popup-button`
 *   5. `.card-owner-name`        -> `.card-assigned-to .card-user-avatar img`
 *                                   `[title]`, else `.card-not-assigned-title`
 *   6. `.e2e-assign`             -> `.card-assigned-to` / `.card-user-avatar`
 *   7. `.e2e-edit` (on a card)   -> the `.card-actions` popover
 *
 * And one selector that LOOKS stale and is not: `.e2e-title` is real. See
 * {@link CARD_TITLE_SELECTOR}.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *   - No screenshots and no writes into `e2e-react/artifacts/**`. Capture is
 *     owned by `playwright.config.ts` (`screenshot: "on"`, `video: "on"`) and
 *     by the specs. The incumbent's `common.takeScreenshot` (`common.js`
 *     L128-L151) wrote into the git-ignored `e2e/screenshots/` and is not
 *     ported.
 *   - No credentials, and not even the NAME of the variable one is read from.
 *     The admin password is resolved in exactly one place,
 *     `e2e-react/fixtures/auth.ts`, so the value used at `createsuperuser` time
 *     and the value used at every login are identical by construction.
 *   - No absolute URL. Navigation is relative to the `baseURL` configured in
 *     `playwright.config.ts`; the incumbent's own origin (`conf.e2e.js` L20,
 *     a different port) is not carried over.
 *   - No colour assertions and no pixel-geometry assertions. Status, tag and
 *     epic colours are per-project DATA bound to `s.color` / `tag[1]` /
 *     `epic.color`, and the values visible in the reference frames are seeded
 *     sample data; asserting them would fail against any real project. Layout
 *     measurements belong to the visual comparison, not to behaviour.
 *   - No `data-testid`. Nothing in `app/` is modified to make this file easier
 *     to write; every anchor below is markup that already exists.
 *   - No retry, no swallow, no unbounded wait. `playwright.config.ts` sets
 *     `retries: 0`, so every wait here carries an explicit budget and a
 *     failure surfaces instead of being papered over.
 *
 * @see e2e-react/fixtures/auth.ts - credential resolution and `waitLoader`
 * @see e2e-react/fixtures/seed.ts - the seeded project slugs
 */

import { expect, type Locator, type Page } from '@playwright/test';

import { waitLoader } from '../fixtures/auth';
import { KANBAN_PROJECT_SLUG } from '../fixtures/seed';

/* ===========================================================================
 * Element names that SURVIVE the migration
 *
 * These five are custom-element TAG names, not AngularJS attribute directives,
 * and they are deliberately NOT class-substituted. The in-scope stylesheets
 * target them BY ELEMENT NAME — `app/styles/modules/kanban/kanban-table.scss`
 * L65 and L76 both select `tg-card` — so React has to keep emitting the same
 * tags for the pass-through stylesheets to apply, and this file can keep
 * locating by them:
 *
 *   tg-card                 rendered by the React card
 *                           (`app/react/jsx-intrinsic-elements.d.ts` declares
 *                           it as an intrinsic element for exactly this reason)
 *   tg-svg                  the React icon wrapper; 11 element selectors across
 *                           the in-scope stylesheets target it
 *   tg-filter               stays AngularJS-rendered (`kanban.jade` L52)
 *   tg-input-search         stays AngularJS-rendered (`kanban.jade` L38)
 *   tg-kanban-board-zoom    stays AngularJS-rendered (`kanban.jade` L44) and
 *                           renders an inner `tg-board-zoom.board-zoom`
 *                           (`kanban-board-zoom.directive.coffee` L46-L50)
 * ======================================================================== */

/**
 * A user-story card.
 *
 * FROM `e2e/helpers/kanban-helper.js` L30 and L34 (`$$('tg-card')`), and it is
 * one of the few incumbent locators that needed NO correction: `kanban-table.jade`
 * L150 (swimlane mode) and L226 (flat mode) render
 * `tg-card.card.ng-animate-disabled[data-id]`, and the React card reproduces
 * that tag, those classes and that attribute.
 */
const CARD_SELECTOR = 'tg-card';

/* ===========================================================================
 * Board shell selectors — `app/partials/includes/modules/kanban-table.jade`
 * ======================================================================== */

/**
 * The board root.
 *
 * `kanban-table.jade` L8-L14. It also carries exactly one of `zoom-0` …
 * `zoom-3`, plus `kanban-table-swimlane` when the project has swimlanes, and it
 * is gated on `ng-if="ctrl.initialLoad"` — which is why {@link
 * KanbanPage.waitLoaded} waits for it rather than assuming it is present the
 * moment navigation resolves.
 */
const BOARD_SELECTOR = 'div.kanban-table';

/**
 * The scrollable body, and the `scrollLeft` container.
 *
 * `kanban-table.jade` L107 (one per swimlane) and L184 (the single flat-mode
 * body). Also the element that owns the enter/move/leave class contract the
 * stylesheet animates at `kanban-table.scss` L549-L575.
 */
const BOARD_BODY_SELECTOR = 'div.kanban-table-body';

/**
 * How far right the board body is scrolled to reveal the rightmost column.
 *
 * FROM `e2e/helpers/kanban-helper.js` L70:
 * `$(".kanban-table-body:last").scrollLeft(10000)`. The value is deliberately
 * far larger than any realistic board width — the browser clamps it to
 * `scrollWidth - clientWidth` — so it means "scroll to the end" without having
 * to measure anything.
 */
const SCROLL_RIGHT_OFFSET_PX = 10000;

/**
 * A status header cell.
 *
 * FROM `e2e/helpers/kanban-helper.js` L14. `kanban-table.jade` L18.
 *
 * The misspelling is REAL and must be preserved: the class is `task-colum-name`,
 * not `task-column-name`. `kanban-table.scss` L85, L101 and L132 all spell it
 * the same way, so "fixing" it here would match nothing.
 */
const HEADER_COLUMN_SELECTOR = 'h2.task-colum-name';

/**
 * The status colour swatch inside a header cell.
 *
 * `kanban-table.jade` L23-L25. Its background comes from `ng-style` on
 * `s.color`, which is per-project DATA — locate this element structurally and
 * never assert its colour.
 */
const STATUS_SWATCH_SELECTOR = 'div.deco-square';

/** The status name inside a header cell. `kanban-table.jade` L27-L28. */
const HEADER_COLUMN_NAME_SELECTOR = 'div.title div.name';

/**
 * ★ CORRECTION 2 — the incumbent `.options a` matched nothing.
 *
 * `e2e/helpers/kanban-helper.js` L60 (fold) and L66 (unfold) both did
 * `.$$('.options a')`. There is no `<a>` inside `div.options`: `kanban-table.jade`
 * L29 opens the container and every control in it is a
 * `button.btn-board.option` (L30, L39, L47, L55, L65). Those buttons carry a
 * stray `href=""` attribute, which is almost certainly what led the original
 * author to write `a`.
 */
const HEADER_OPTION_SELECTOR = '.options button.option';

/**
 * The unfold variant of a header control.
 *
 * `kanban-table.jade` L55 and L65 — both `button.btn-board.option.hunfold`. The
 * stylesheet keeps them visible in a folded column while hiding their siblings
 * (`kanban-table.scss` L93-L99).
 */
const HEADER_UNFOLD_OPTION_SELECTOR = '.options button.option.hunfold';

/**
 * ★ CORRECTION 1 — the incumbent `.task-column` matched nothing.
 *
 * `e2e/helpers/kanban-helper.js` L22 used `$$('.task-column')`, and
 * `e2e/suites/kanban.e2e.js` L215 and L223 asserted on `.vfold.task-column`.
 * The class `.task-column` appears in NO Jade template and in NO CoffeeScript
 * module; it survives only as a dead rule at `app/styles/layout/rtl.scss`
 * L449-L450.
 *
 * The real element is `div.kanban-uses-box.taskboard-column` —
 * `kanban-table.jade` L112 (swimlane mode) and L189 (flat mode) — and both
 * class tokens are live in the in-scope stylesheet (`kanban-table.scss` L226,
 * L301, L572). It additionally carries `id="column-{{s.id}}"`,
 * `data-status="{{s.id}}"`, `data-swimlane="{{swimlane.id}}"` in swimlane mode,
 * and `vfold` / `vunfold` from `ng-class` (L113, L190).
 */
const STATUS_COLUMN_SELECTOR = 'div.kanban-uses-box.taskboard-column';

/**
 * ★ CORRECTION 1b — the folded-column count MUST be scoped to the body column.
 *
 * `.vfold` lands on TWO different elements for one folded status: the header
 * cell `h2.task-colum-name` gets it at `kanban-table.jade` L20, and the body
 * column gets it at L113 and L190. `kanban-table.scss` proves both, styling
 * `.vfold.task-colum-name` at L85 and `.vfold.taskboard-column` at L102.
 *
 * A bare `.vfold` locator therefore DOUBLE-COUNTS every folded status, and the
 * incumbent's `.vfold.task-column` (`kanban.e2e.js` L215) counted zero. Scoping
 * to `.taskboard-column.vfold` is what makes the count mean "folded columns".
 */
const FOLDED_STATUS_COLUMN_SELECTOR = '.taskboard-column.vfold';

/**
 * The folded-state class, applied to both the header cell and the body column.
 *
 * `kanban-table.jade` L20 (header) and L113 / L190 (body column), all three from
 * `ng-class` on `folds[s.id]`.
 */
const FOLD_CLASS = 'vfold';

/**
 * The per-column card counter.
 *
 * `kanban-table.jade` L122-L128 (swimlane mode) and L198-L205 (flat mode),
 * gated on `ng-if='!folds[s.id]'`.
 *
 * Anchor on this class, never on the inner `tg-animated-counter` element: that
 * element is styled only by the out-of-scope shared
 * `app/modules/components/animated-counter/animated-counter.directive.scss`
 * L1, not by any of the six in-scope stylesheets, so whether the React count
 * keeps the wrapper is not something this file may depend on.
 */
const TASK_COUNTER_SELECTOR = '.kanban-task-counter';

/**
 * The counter's VISIBLE value row.
 *
 * ★ READING THE COUNTER'S OWN TEXT DOES NOT WORK, and the reason is structural
 * rather than incidental. The counter is an animated roller that ALWAYS renders
 * THREE `.result` rows inside `.counter-translator` — the next value up, the
 * current value, and the next value down — with `.animated-counter-inner`'s
 * `overflow: hidden` and the translator's resting offset leaving only the MIDDLE
 * row on screen. Both implementations do this identically:
 * `animated-counter.directive.coffee` L18-L26, and
 * `app/react/kanban/TaskCounter.tsx`, which renders `nextUp`, `renderCount` and
 * `nextDown` in that order and comments that dropping any row would break the
 * geometry.
 *
 * So the container's text is all three values concatenated. Measured against the
 * deployed board, `.kanban-task-counter` reads `"0\n5\n0"` where the real count
 * is 5. Selecting the middle row is what yields the value a reader sees.
 */
const TASK_COUNTER_VALUE_SELECTOR = '.counter-translator .result';

/**
 * Index of the visible row within {@link TASK_COUNTER_VALUE_SELECTOR}.
 *
 * The middle of the three, per the render order cited above.
 */
const TASK_COUNTER_VISIBLE_ROW = 1;

/**
 * The WIP-limit marker.
 *
 * Produced by `KanbanWipLimitDirective`, `app/coffee/modules/kanban/main.coffee`
 * L815-L853, as `<div class='kanban-wip-limit {state}'><span>WIP Limit</span></div>`.
 * The state arithmetic is reproduced verbatim in
 * {@link KanbanPage.wipMarkerState}.
 */
const WIP_LIMIT_SELECTOR = '.kanban-wip-limit';

/** The three WIP-limit states, in the source's own comparison order. */
const WIP_LIMIT_STATES = ['one-left', 'reached', 'exceeded'] as const;

/**
 * The collapsed-column placeholder shown in place of a folded column's cards.
 *
 * `kanban-table.jade` L130-L142 / L206-L218, gated on `ng-if='folds[s.id]'`.
 * `div.archived` inside `div.text-holder` is itself gated on `s.is_archived`
 * (L138 / L214), which is what makes it the archived column's fingerprint.
 */
const ARCHIVED_PLACEHOLDER_SELECTOR =
    '.placeholder-collapsed .text-holder .archived';

/** A swimlane row. `kanban-table.jade` L73-L78. */
const SWIMLANE_SELECTOR = 'div.kanban-swimlane';

/**
 * The swimlane header button — also the collapse toggle.
 *
 * `kanban-table.jade` L79-L84. Gains `folded` while the swimlane is collapsed
 * and `unclassified-swimlane` for the synthetic `-1` swimlane.
 */
const SWIMLANE_TITLE_SELECTOR = 'button.kanban-swimlane-title';

/**
 * Class the swimlane header carries while its body is collapsed.
 *
 * `kanban-table.jade` L82:
 * `folded: ctrl.foldedSwimlane.get(swimlane.id.toString())`.
 */
const SWIMLANE_FOLDED_CLASS = 'folded';

/** The swimlane name. `kanban-table.jade` L93-L95. */
const SWIMLANE_NAME_SELECTOR = 'h2.title-name';

/**
 * The default-swimlane marker: a star icon plus an italic label.
 *
 * `kanban-table.jade` L102-L106, gated on
 * `swimlane.id == project.default_swimlane && project.swimlanes.length > 1`, so
 * its absence is a legitimate state rather than a defect.
 */
const DEFAULT_SWIMLANE_SELECTOR = '.default-swimlane';

/** The "create swimlane" link. `kanban-table.jade` L176-L182. */
const SWIMLANE_ADD_SELECTOR = 'a.kanban-swimlane-add';

/* ===========================================================================
 * Icon anchors
 *
 * ★ CORRECTION 3 — never address a header control by its index.
 *
 * `e2e/helpers/kanban-helper.js` L18 opened the new-US lightbox with
 * `.$$('.option').get(2)`. The verified DOM order inside `div.options`
 * (`kanban-table.jade` L29-L72) is:
 *
 *   [0] add US   L30  tg-svg.add-action  / icon-add
 *   [1] bulk add L39  tg-svg.bulk-action / icon-bulk
 *   [2] FOLD     L47  icon-fold-column
 *   [3] unfold   L55  .hunfold + icon-unfold-column, `ng-if="s.is_archived"`
 *   [4] unfold   L65  .hunfold + icon-unfold-column, `ng-hide="s.is_archived"`
 *
 * So index 2 is the FOLD control: the incumbent helper folded the column it
 * claimed to be adding a story to. Worse, the set is CONDITIONAL — L55 is an
 * `ng-if`, so it is absent from the DOM entirely for a non-archived status,
 * shifting every later index.
 *
 * Anchoring semantically removes the whole class of bug. The icon classes are
 * real: `tgSvg` renders `<svg class="{{'icon ' + svgIcon}}">`
 * (`app/coffee/modules/common.coffee` L342-L349), so `icon-add`, `icon-bulk`,
 * `icon-fold-column` and `icon-unfold-column` are genuine class tokens on the
 * inner `<svg>`, in both the AngularJS and the React renderings.
 * ======================================================================== */

/** Add-a-user-story icon. `kanban-table.jade` L37. */
const ICON_ADD_SELECTOR = '.icon-add';

/** Bulk-add icon. `kanban-table.jade` L46. */
const ICON_BULK_SELECTOR = '.icon-bulk';

/** Fold-column icon. `kanban-table.jade` L53. */
const ICON_FOLD_SELECTOR = '.icon-fold-column';

/** Unfold-column icon. `kanban-table.jade` L63 and L72. */
const ICON_UNFOLD_SELECTOR = '.icon-unfold-column';

/* ===========================================================================
 * Card selectors — `app/modules/components/card/**`
 *
 * The card is a SHARED component, also rendered by the out-of-scope taskboard
 * (`taskboard-table.jade` L135 and L186), so nothing under
 * `app/modules/components/card/**` may be modified. The React card reproduces
 * its class names exactly, which is precisely what lets this file address it by
 * class.
 * ======================================================================== */

/**
 * The card's subject.
 *
 * ✅ `.e2e-title` IS IN THE SOURCE — it is NOT one of the stale selectors, and it
 * is retained below so a later audit does not "correct" it away.
 * `e2e/helpers/kanban-helper.js` L26 used it, and
 * `app/modules/components/card/card-templates/card-title.jade` L16 still renders
 * `span.card-subject.e2e-title`. Of the card's `.e2e-*` hooks only `.e2e-assign`
 * and `.e2e-edit` went stale (corrections 6 and 7).
 *
 * ★ BUT IT CANNOT BE THE ONLY ANCHOR, and this is a BUILD-LEVEL fact that no
 * amount of reading the Jade sources reveals. `gulpfile.js` L273 pipes
 * `gulpif(isDeploy, replace(/e2e-([a-z\-]+)/g, ''))`, so a DEPLOY build STRIPS
 * every `e2e-`-prefixed class from the compiled templates. Verified against the
 * artifact rather than assumed: a `gulp deploy` of this repository produces a
 * `templates.js` containing ZERO occurrences of `e2e-`, while `card-subject`
 * survives — and a live DOM inspection of the deployed board confirmed no
 * element carries any `e2e-` class.
 *
 * That matters because `playwright.config.ts` points `baseURL` at the nginx
 * gateway, which serves exactly that deploy output. The incumbent suite did not
 * hit this: it ran against the non-deploy dev build on its own origin
 * (`conf.e2e.js` L20), where the hooks are still present. Anchoring only on
 * `.e2e-title` here would make {@link KanbanPage.cardTitlesInColumn} return an
 * empty array with no error — the exact silent failure this file exists to
 * prevent.
 *
 * `.card-subject` is the durable class and comes first; `.e2e-title` follows so
 * the incumbent hook is preserved for dev builds. A selector list is safe for
 * strictness because `querySelectorAll` returns each element once, so on a dev
 * build — where the element carries BOTH classes — this still resolves to one
 * element per card.
 *
 * VIRTUALISATION CAVEAT: the whole card body is `.card-inner(ng-if="vm.inViewPort")`
 * (`card.jade` L8-L9), reproduced in React by the `useInViewport` hook, so an
 * OFF-SCREEN card renders no title at all. A title list is therefore a list of
 * the currently realised cards, not of every card in the column.
 */
const CARD_TITLE_SELECTOR = '.card-subject, .e2e-title';

/**
 * The card body, and therefore the virtualisation gate itself.
 *
 * `card.jade` L8-L9: `.card-inner(ng-if="vm.inViewPort")`. React reproduces the
 * gate through the `useInViewport` hook. Waiting for this element is how an
 * accessor tells "this card has nothing to read" apart from "this card has not
 * been realised yet".
 */
const CARD_INNER_SELECTOR = '.card-inner';

/**
 * The user-story id carried by every card.
 *
 * `kanban-table.jade` L151 (swimlane mode) and L227 (flat mode):
 * `data-id="{{ usId }}"`. This is the only stable per-card identity available,
 * and it is what makes a drag's outcome assertable: after a drop the card with
 * this id must be a descendant of the destination column.
 */
const CARD_ID_ATTRIBUTE = 'data-id';

/**
 * ★ CORRECTION 4 — the incumbent `.card-owner-actions` matched nothing.
 *
 * `e2e/helpers/kanban-helper.js` L38 hovered `.card-owner-actions`. That class
 * appears in NO Jade template and NO CoffeeScript module; it survives only as
 * dead stylesheet rules (`app/modules/components/card/card.scss` L162,
 * `app/styles/modules/backlog/taskboard-table.scss` L50,
 * `app/styles/layout/rtl.scss` L678).
 *
 * The real control is `card-templates/card-actions.jade` L2-L3:
 * `.card-actions > button.js-popup-button`, carrying `icon-more-vertical`. Note
 * the gate at L1 — it renders only when `vm.zoomLevel > 0` AND the user holds
 * the modify or delete permission — so any accessor must wait for it with an
 * explicit budget rather than assume it exists.
 */
const CARD_ACTIONS_BUTTON_SELECTOR = '.card-actions button.js-popup-button';

/**
 * ★ CORRECTIONS 5 and 6 — `.card-owner-name` and `.e2e-assign` both matched
 * nothing.
 *
 * `e2e/suites/kanban.e2e.js` L281 read the assignee from `.card-owner-name`,
 * and `e2e/helpers/kanban-helper.js` L74 collected `$$('.e2e-assign')`.
 * `.card-owner-name` exists only in dead stylesheet rules (`card.scss` L153,
 * `taskboard-table.scss` L53). `.e2e-assign` matches NOTHING anywhere in the
 * repository — the nearest token is `.e2e-assigned-to` on the epics dashboard
 * (`app/modules/epics/dashboard/epic-row/epic-row.jade` L39), and CSS class
 * matching is exact-token, so the two never met.
 *
 * The real structure is `card-templates/card-assigned-to.jade`:
 *   L9   `.card-assigned-to`                 the container (see the gate below)
 *   L13  `.card-user-avatar.card-not-assigned`  the unassigned state
 *   L19  `span.card-not-assigned-title`      the unassigned label
 *   L26  `.card-user-avatar` + `img[title]`  one per assignee; the name is the
 *                                            image's `title` attribute
 *   L39  `span.extra-assigned`               the "N+" overflow badge
 *
 * The container is itself gated on
 * `vm.visible('assigned_to') && !vm.project.archived_code` (L8), so its absence
 * is a legitimate state — hence {@link KanbanPage.assignedName} returns `null`
 * rather than throwing.
 */
const CARD_ASSIGNED_TO_SELECTOR = '.card-assigned-to';

/** One assignee avatar. `card-assigned-to.jade` L26 and L45. */
const CARD_AVATAR_SELECTOR = '.card-user-avatar';

/** The unassigned avatar variant. `card-assigned-to.jade` L13. */
const CARD_NOT_ASSIGNED_SELECTOR = '.card-user-avatar.card-not-assigned';

/** The unassigned label. `card-assigned-to.jade` L19. */
const CARD_NOT_ASSIGNED_TITLE_SELECTOR = 'span.card-not-assigned-title';

/**
 * The multi-selection marker on a card.
 *
 * `kanban-table.jade` L154 and L230 apply BOTH `kanban-task-selected` and
 * `ui-multisortable-multiple` from the same `ctrl.selectedUss[usId]` condition.
 * `kanban-task-selected` is the one the in-scope stylesheet styles
 * (`kanban-table.scss` L303-L308), so it is the one used here.
 */
const CARD_SELECTED_CLASS = 'kanban-task-selected';

/* ===========================================================================
 * Toolbar and lightbox selectors — `app/partials/kanban/kanban.jade`
 * ======================================================================== */

/** The screen root. `kanban.jade` L17. */
const SCREEN_SELECTOR = 'section.main.kanban';

/**
 * The filter toggle.
 *
 * `kanban.jade` L22 renders `button.btn-filter.e2e-open-filter`, and
 * `e2e/helpers/filters-helper.js` L18-L21 reached it as `.e2e-open-filter`. It
 * carries `ng-class="{active: ctrl.openFilter}"` (L25), which is how
 * {@link KanbanPage.openFilters} can tell an already-open panel from a closed
 * one instead of blindly toggling.
 *
 * ★ `.btn-filter` LEADS, for the build reason set out at
 * {@link CARD_TITLE_SELECTOR}: `gulpfile.js` L273 strips every `e2e-`-prefixed
 * class from a deploy build, and a live inspection of the deployed board found
 * this control rendered as `class="btn-filter "` with the hook gone. Had the
 * incumbent selector been ported alone, {@link KanbanPage.openFilters} would
 * have taken its "control not present" branch on every run and quietly opened
 * nothing. `.e2e-open-filter` is kept as the second alternative so dev builds
 * still match, and the list resolves to a single element in either build.
 */
const FILTER_TOGGLE_SELECTOR = 'button.btn-filter, button.e2e-open-filter';

/** Class the filter toggle carries while the panel is open. `kanban.jade` L25. */
const FILTER_TOGGLE_ACTIVE_CLASS = 'active';

/**
 * The filter panel.
 *
 * `kanban.jade` L49-L62 (`.kanban-filter > tg-filter`), and the element
 * `e2e/helpers/filters-helper.js` L14 and L28 addressed. `tg-filter` is a
 * surviving element name — the panel stays AngularJS-rendered.
 */
const FILTER_PANEL_SELECTOR = '.kanban-filter tg-filter';

/** The search box. `kanban.jade` L38. Another surviving element name. */
const SEARCH_SELECTOR = 'tg-input-search';

/**
 * The zoom control's inner element.
 *
 * FROM `e2e/helpers/kanban-helper.js` L80 (`$('tg-board-zoom')`) — still valid.
 * `kanban.jade` L44 renders `tg-kanban-board-zoom`, whose directive template
 * emits `<tg-board-zoom class="board-zoom">`
 * (`app/modules/components/kanban-board-zoom/kanban-board-zoom.directive.coffee`
 * L46-L50).
 */
const BOARD_ZOOM_SELECTOR = 'tg-board-zoom';

/**
 * Horizontal pitch, in CSS pixels, between the zoom control's steps.
 *
 * FROM `e2e/helpers/kanban-helper.js` L77-L83:
 * `mouseMove($('tg-board-zoom'), {y: 14, x: level * 49}).click()`.
 *
 * The zoom widget is a single element containing four steps rather than four
 * separate clickable elements, so it is addressed by an OFFSET CLICK into that
 * one element — which is exactly what `locator.click({ position })` does. The
 * arithmetic is reproduced rather than reinterpreted: the widget itself is
 * rendered by the prebuilt `elements.js` Web Components bundle, which this
 * migration does not touch, so its internal geometry is not something this file
 * can restate more precisely than the incumbent did.
 */
const ZOOM_STEP_WIDTH_PX = 49;

/** Vertical centre of the zoom control's track. `kanban-helper.js` L80 (`y: 14`). */
const ZOOM_STEP_CENTRE_Y_PX = 14;

/** Lowest zoom step ordinal the incumbent exercised. `kanban.e2e.js` L32. */
const MIN_ZOOM_STEP = 1;

/** Highest zoom step ordinal the incumbent exercised. `kanban.e2e.js` L44. */
const MAX_ZOOM_STEP = 4;

/**
 * Extracts the board's current zoom level from its class attribute.
 *
 * `kanban-table.jade` L14 puts exactly one of `zoom-0` … `zoom-3` on the board
 * root. The boundary groups are non-capturing so group 1 is the digit, and the
 * boundaries make this a whole-token match — mirroring the incumbent's
 * `class.split(' ').indexOf(cls)` semantics (`e2e/utils/common.js` L45-L49)
 * rather than a substring test.
 */
const ZOOM_CLASS_PATTERN = /(?:^|\s)zoom-([0-3])(?:\s|$)/;

/**
 * The create/edit user-story lightbox.
 *
 * ⚠ A DELIBERATELY RETAINED ANGULARJS ATTRIBUTE SELECTOR. Everywhere else in
 * this file a `[tg-*]` attribute is substituted with its class equivalent,
 * because React emits classes rather than AngularJS directives. Here the
 * attribute genuinely still exists: `tgLbCreateEdit` is a SHARED directive that
 * the migration retains untouched, and `kanban.jade` L66 —
 * `div.lightbox.lightbox-generic-form.lightbox-create-edit(tg-lb-create-edit)` —
 * is one of the lines the surviving Jade shell keeps verbatim. The attribute is
 * kept in the selector because it is what distinguishes this lightbox host from
 * any other `.lightbox` on the page.
 */
const CREATE_EDIT_LIGHTBOX_SELECTOR =
    'div.lightbox.lightbox-generic-form.lightbox-create-edit[tg-lb-create-edit]';

/**
 * The bulk-create user-stories lightbox.
 *
 * ⚠ RETAINED ANGULARJS ATTRIBUTE SELECTOR, for the same reason as
 * {@link CREATE_EDIT_LIGHTBOX_SELECTOR}: `tgLbCreateBulkUserstories` is a
 * retained shared directive and `kanban.jade` L68 —
 * `div.lightbox.lightbox-generic-bulk(tg-lb-create-bulk-userstories)` — is kept
 * verbatim by the surviving shell.
 */
const BULK_LIGHTBOX_SELECTOR =
    'div.lightbox.lightbox-generic-bulk[tg-lb-create-bulk-userstories]';

/** Class a lightbox carries while it is showing. `e2e/utils/lightbox.js` L36. */
const LIGHTBOX_OPEN_CLASS = 'open';

/** The popover a card's action button opens. `e2e/utils/popover.js` L23 and L26. */
const ACTIVE_POPOVER_SELECTOR = '.popover.active';

/* ===========================================================================
 * Wait budgets
 *
 * Every number below is the incumbent's own, reproduced rather than invented,
 * so a wait that used to pass does not start failing — or start hiding a
 * regression — after the port. Each carries its source.
 * ======================================================================== */

/**
 * How long the board root is given to appear after the loader clears.
 *
 * The incumbent followed `utils.common.waitLoader()` with
 * the ambient `waitForAngular()` (`kanban.e2e.js` L26, L238, L258), which has no
 * Playwright equivalent because it waits on AngularJS's digest and pending
 * `$http` traffic. The nearest documented incumbent budget is its
 * post-navigation one, 10000 ms (`e2e/utils/common.js` L171), so that is reused
 * instead of a new number being made up. It is a ceiling only: the wait
 * resolves the instant `div.kanban-table` renders.
 */
const BOARD_READY_TIMEOUT_MS = 10000;

/** Lightbox open/close budget. `e2e/utils/lightbox.js` L37 and L64. */
const LIGHTBOX_TIMEOUT_MS = 4000;

/**
 * Lightbox transition settle.
 *
 * `e2e/utils/lightbox.js` L12 declares `transition = 300` and L39 sleeps
 * `transition + 100` after the class flips. Reproduced as a fixed settle
 * IN ADDITION to the class assertion, never instead of it: the lightbox slide
 * is a CSS transition on an element whose state has already changed, so there
 * is no further application-level condition to await.
 */
const LIGHTBOX_TRANSITION_MS = 400;

/** Popover budget. `e2e/utils/popover.js` L24. */
const POPOVER_TIMEOUT_MS = 3000;

/** Popover transition settle. `e2e/utils/popover.js` L13 and L18. */
const POPOVER_TRANSITION_MS = 400;

/**
 * Filter-panel budget.
 *
 * REPLACES a fixed sleep. `e2e/shared/filters.js` L21 slept a flat
 * 4000 ms after opening the panel, because
 * `e2e/helpers/filters-helper.js` L28 returned a `transitionend` waiter that
 * the caller never awaited. The sleep's own duration is kept as the budget for
 * a real visibility assertion, so the wait now ends as soon as the panel is up
 * and still fails loudly if it never is.
 */
const FILTER_PANEL_TIMEOUT_MS = 4000;

/**
 * Zoom settle.
 *
 * `e2e/suites/kanban.e2e.js` L33, L37, L41 and L45 each slept
 * a flat 1000 ms after a zoom step. The zoom change re-lays-out every
 * card through a CSS transition, and the class assertion in
 * {@link KanbanPage.zoom} confirms the state change but not the end of the
 * animation — so this is kept as a small fixed settle IN ADDITION to that
 * assertion, exactly as the incumbent had it.
 */
const ZOOM_SETTLE_MS = 1000;

/* ===========================================================================
 * Drag and drop
 * ======================================================================== */

/**
 * Default number of intermediate pointer moves in a drag gesture.
 *
 * Ten rather than the bare minimum, because both reasons the moves exist scale
 * with their count — see {@link dndKitDrag} step 5.
 */
const DEFAULT_DRAG_STEPS = 10;

/**
 * Fewest intermediate moves that can reliably drive `@dnd-kit`.
 *
 * Below five, a short drag can complete without ever exceeding the
 * `PointerSensor` activation constraint, and `@dnd-kit`'s collision detection
 * can miss the destination container entirely. A smaller value is rejected
 * rather than silently raised, so a caller that asks for something that cannot
 * work is told so.
 */
const MIN_DRAG_STEPS = 5;

/**
 * Pointer displacement, in CSS pixels, of the nudge that follows `mouse.down()`.
 *
 * `@dnd-kit`'s `PointerSensor` activation constraint is expressed as a minimum
 * pointer distance, so the FIRST movement after the press has to clear it. When
 * source and destination are close together, an evenly interpolated first step
 * can fall under that threshold and the gesture never starts. Ten pixels clears
 * the library's default while staying far too small to reach a neighbouring
 * droppable, so it cannot change where the card lands.
 */
const DRAG_ACTIVATION_NUDGE_PX = 10;

/**
 * Budget for the post-drop DOM settle.
 *
 * Deliberately the same 5000 ms the incumbent gave its own post-drag wait
 * (`e2e/utils/common.js` L204), so the drag path is no more patient after the
 * port than before it — only correct about WHAT it waits for.
 */
const DROP_SETTLE_TIMEOUT_MS = 5000;

/** Gap between two consecutive drop-settle probes. */
const DROP_SETTLE_PROBE_MS = 100;

/**
 * Vertical offset applied when dropping a card into a column.
 *
 * FROM `e2e/suites/kanban.e2e.js` L236: `utils.common.drag(usOrigin, destination, 0, 10)`.
 *
 * The +10 is preserved; its ORIGIN is not. The incumbent measured from the
 * destination's top-left corner (`$(dest).offset().top + extray`,
 * `e2e/utils/common.js` L248), whereas {@link dndKitDrag} measures from the
 * destination's CENTRE. That is deliberate: `@dnd-kit`'s collision detection
 * resolves the pointer position against droppable rectangles, and a point on a
 * container's border sits ambiguously between that container and its neighbour,
 * whereas the centre never does.
 */
const CARD_DROP_OFFSET_Y = 10;

/** Tuning knobs for {@link dndKitDrag}. */
export interface DndKitDragOptions {
    /**
     * Number of intermediate pointer moves between the source and the
     * destination. Must be at least {@link MIN_DRAG_STEPS}; defaults to
     * {@link DEFAULT_DRAG_STEPS}.
     */
    steps?: number;

    /** Horizontal pixels added to the destination's centre. Defaults to 0. */
    offsetX?: number;

    /**
     * Vertical pixels added to the destination's centre. Defaults to 0. Kanban
     * card drops pass {@link CARD_DROP_OFFSET_Y}.
     */
    offsetY?: number;
}

/**
 * Drags `source` onto `target` with a real pointer gesture that `@dnd-kit/core`
 * recognises.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: THE INCUMBENT DRAG CANNOT BE PORTED
 * ---------------------------------------------------------------------------
 * `e2e/utils/common.js` L207-L276 did not move a pointer at all. It injected a
 * script through the ambient `executeScript` that FABRICATED events: `new
 * CustomEvent(type)` followed by the legacy `initEvent(type, true, true)`, with
 * `pageX/clientX/pageY/clientY` and `event.which = 1` assigned as plain
 * properties, then dispatched `mousedown` on the source and two `mousemove`s
 * plus a `mouseup` on `document.documentElement`, with the destination
 * coordinates read as `$(dest).offset().left/top` plus the caller's extras.
 *
 * That worked for exactly one reason: `dragula` listened for precisely those
 * fabricated mouse events, so a synthetic `CustomEvent` was indistinguishable
 * from a real one as far as it was concerned.
 *
 * `@dnd-kit/core` does not work that way. Its `PointerSensor` subscribes to
 * POINTER events and will not begin a drag until its activation constraint —
 * a minimum pointer distance — has been exceeded by genuine pointer movement.
 * Hand-built `CustomEvent`s are not pointer events, carry no `pointerId`, and
 * are not trusted; they would be ignored.
 *
 * The settle condition is dead for the same kind of reason.
 * `e2e/utils/common.js` L199-L205 polled until nothing on the page carried
 * DRAGULA'S OWN FLOATING-MIRROR CLASS any more — the `gu-` prefixed class
 * dragula puts on the drag image it clones, referenced in this repository at
 * `app/coffee/modules/kanban/main.coffee` L1169 and
 * `app/js/dragula-drag-multiple.js` L159. `@dnd-kit` has no such element of
 * its own, so that poll would either resolve instantly — before anything had
 * happened — or never. It is not carried over in any form, and the class is
 * deliberately not even named as a literal below, so that no future edit can
 * reintroduce a dependency on it by copy-and-paste.
 *
 * One more thing worth stating, because it is the obvious shortcut and it does
 * not work: `locator.dragTo()` alone frequently fails against `@dnd-kit`. It
 * performs a press, a SINGLE move and a release, which neither clears the
 * activation constraint reliably nor gives collision detection the intermediate
 * positions it needs to register the destination droppable. Hence the explicit,
 * stepped sequence below.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DRAG HELPER LIVES IN A PAGE OBJECT, AND IS EXPORTED
 * ---------------------------------------------------------------------------
 * The gesture has to be tuned once and shared, because the board and the
 * backlog list drive the same `@dnd-kit` adapter — and this folder holds exactly
 * two files, `KanbanPage.ts` and `BacklogPage.ts`, with no base class and no
 * shared-utility module. Adding a third file would break that inventory;
 * duplicating the sequence would mean tuning it twice and having it drift.
 *
 * So it is declared here, at module scope, and EXPORTED:
 *
 *     import { dndKitDrag } from './KanbanPage';
 *
 * `BacklogPage.ts` imports it and must not redeclare it.
 *
 * @param page - the page owning the pointer
 * @param source - the element to pick up
 * @param target - the container to drop it into
 * @param options - see {@link DndKitDragOptions}
 * @throws if `options.steps` is below {@link MIN_DRAG_STEPS}, if either element
 *   has no layout box, or if the drop target has not settled within
 *   {@link DROP_SETTLE_TIMEOUT_MS}
 */
export async function dndKitDrag(
    page: Page,
    source: Locator,
    target: Locator,
    options?: DndKitDragOptions,
): Promise<void> {
    const steps = options?.steps ?? DEFAULT_DRAG_STEPS;
    const offsetX = options?.offsetX ?? 0;
    const offsetY = options?.offsetY ?? 0;

    // Rejected rather than clamped. Silently raising the value would let a
    // caller believe a two-step drag is what ran, and `retries: 0` means a
    // gesture that half-works is the hardest kind of failure to read.
    if (!Number.isInteger(steps) || steps < MIN_DRAG_STEPS) {
        throw new Error(
            `dndKitDrag: options.steps must be an integer >= ${MIN_DRAG_STEPS} ` +
                `to clear @dnd-kit's PointerSensor activation constraint, got ${String(steps)}.`,
        );
    }

    // STEP 1 — bring both elements into view.
    //
    // Mirrors the incumbent's two `scrollIntoView()` calls (`common.js` L240 and
    // L253). It matters more here, not less: a real pointer can only be placed
    // at coordinates inside the viewport, whereas the fabricated events did not
    // care. The board is virtualised — `.card-inner` is gated on
    // `vm.inViewPort` (`card.jade` L9), reproduced in React by `useInViewport` —
    // and the drop CONTAINER stays registered as a droppable even while its
    // cards are unrealised, which is why scrolling the target into view is
    // enough and no card needs to be forced to render first.
    //
    // ONE PRECONDITION THIS IMPLIES, stated because it is easy to trip over:
    // source and target must be able to be on screen AT THE SAME TIME. Two
    // sequential scrolls cannot satisfy a pair that is further apart than the
    // scroll container is wide — the second scroll simply undoes the first. That
    // is not a limitation of this helper but of a real pointer, which can only be
    // placed at coordinates inside the viewport, and it is why the incumbent's
    // fabricated events did not care. It is not a practical constraint on this
    // board: measured on the deployed screen, the scroll container's
    // `scrollWidth` exceeded its `clientWidth` by only 73 px, so every column
    // including the archived rail is reachable without losing sight of the
    // source. For a genuinely wider board, `@dnd-kit`'s own auto-scroll takes
    // over once the pointer reaches the container edge mid-drag — the same role
    // `dom-autoscroller` played for dragula.
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();

    // STEP 2 — resolve both layout boxes.
    //
    // `boundingBox()` is typed `DOMRect | null` and answers null for an element
    // with no layout box. An element that is outright hidden is normally caught
    // one step earlier, by `scrollIntoViewIfNeeded()`'s own bounded actionability
    // wait; this guard covers what that cannot — a box that resolves to null
    // because the element was detached by a re-render in between. Throwing is
    // deliberate either way: with `retries: 0`, a silent early return would turn
    // a no-op drag into an inscrutable assertion failure several lines later.
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();

    if (sourceBox === null) {
        throw new Error(
            'dndKitDrag: the drag source has no layout box — it is hidden or detached, so it cannot be picked up.',
        );
    }

    if (targetBox === null) {
        throw new Error(
            'dndKitDrag: the drop target has no layout box — it is hidden or detached, so nothing can be dropped onto it.',
        );
    }

    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2 + offsetX;
    const endY = targetBox.y + targetBox.height / 2 + offsetY;

    // STEP 3 — place the pointer on the source. `hover()` additionally waits for
    // the element to be visible, stable and hit-testable, so the press below
    // cannot land on something that is still animating into position.
    await source.hover();

    // STEP 4 — press.
    await page.mouse.down();

    // STEP 5a — the activation nudge. See DRAG_ACTIVATION_NUDGE_PX: the first
    // movement after the press must exceed the PointerSensor's distance
    // constraint, and an evenly interpolated first step need not for a short
    // drag.
    await page.mouse.move(startX + DRAG_ACTIVATION_NUDGE_PX, startY, { steps: 1 });

    // STEP 5b — walk to the destination in discrete moves. Two reasons, both of
    // which need MORE than one move:
    //   (a) the activation constraint has to be exceeded before `@dnd-kit`
    //       considers a drag to be in progress at all;
    //   (b) its collision detection samples the pointer position on each move,
    //       so the intermediate positions are what let it recognise the
    //       destination droppable — and any container the pointer crosses on the
    //       way — rather than teleporting past all of them.
    // `{ steps: 1 }` on each call keeps this loop the single place the
    // interpolation happens, so the count in `options.steps` is exactly the
    // number of pointer positions produced.
    for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;

        await page.mouse.move(
            startX + (endX - startX) * ratio,
            startY + (endY - startY) * ratio,
            { steps: 1 },
        );
    }

    // STEP 6 — settle exactly on the destination point. The loop's final
    // iteration already reaches it; repeating it explicitly guarantees the last
    // position `@dnd-kit` sees is the intended one even if `steps` arithmetic
    // ever leaves a sub-pixel remainder.
    await page.mouse.move(endX, endY);

    // STEP 7 — release.
    await page.mouse.up();

    // STEP 8 — bounded settle on an OBSERVABLE outcome.
    await waitForDropSettled(target);
}

/**
 * Waits until the drop target's subtree has stopped changing.
 *
 * This is the settle that replaces the incumbent's dragula-mirror poll
 * (`e2e/utils/common.js` L199-L205), and it is an assertion about the DOM
 * rather than a sleep: a `@dnd-kit` drop commits by re-rendering the containers
 * involved, so the drop has landed once the target's descendant count holds
 * still across two consecutive probes.
 *
 * It is deliberately GENERIC, because {@link dndKitDrag} is shared with the
 * backlog and cannot know what a successful drop looks like there. The specific
 * outcome — this card's `data-id` now living inside that column — is asserted by
 * the caller, {@link KanbanPage.dragCard} and
 * {@link KanbanPage.dragCardToArchived}.
 *
 * The loop is bounded by an explicit deadline and ends in a throw, so it is a
 * stability probe and not a retry: it never masks a drag that did nothing.
 *
 * @param target - the container that was dropped onto
 * @throws if the subtree is still changing after {@link DROP_SETTLE_TIMEOUT_MS}
 */
async function waitForDropSettled(target: Locator): Promise<void> {
    const deadline = Date.now() + DROP_SETTLE_TIMEOUT_MS;
    const descendants = target.locator('*');

    let previous = -1;

    while (Date.now() < deadline) {
        const current = await descendants.count();

        if (current === previous) {
            return;
        }

        previous = current;

        // A probe interval, not the settle itself: the settle is the equality
        // above. Without a gap between probes two counts taken in the same frame
        // would trivially agree and report a drop that had not yet applied.
        await target.page().waitForTimeout(DROP_SETTLE_PROBE_MS);
    }

    throw new Error(
        `dndKitDrag: the drop target was still changing after ${DROP_SETTLE_TIMEOUT_MS} ms; ` +
            'the drop did not settle.',
    );
}


/* ===========================================================================
 * Class-token helpers
 *
 * The incumbent tested class membership with
 * `classes.split(' ').indexOf(cls) !== -1` (`e2e/utils/common.js` L45-L49) —
 * a WHOLE-TOKEN test. Both helpers below reproduce that, and neither uses a
 * substring test, because a substring test would report `vfold` as present in
 * `vfold-remove-active` (a real class, `kanban-table.scss` L63) and `active` as
 * present in `inactive`.
 * ======================================================================== */

/**
 * Builds a whole-token class matcher for `expect(...).toHaveClass()`.
 *
 * `toHaveClass` given a plain string demands an exact match on the ENTIRE class
 * attribute, which is unusable on elements that carry several classes at once —
 * a card carries `card`, `ng-animate-disabled` and up to five state classes.
 * Given a RegExp it tests the attribute, so a boundary-anchored pattern gives
 * exactly the incumbent's token semantics.
 *
 * @param token - the single class name to look for
 */
function classTokenPattern(token: string): RegExp {
    return new RegExp(`(^|\\s)${token}(\\s|$)`);
}

/**
 * Reads whether an element currently carries a class token.
 *
 * Reproduces `common.hasClass` (`e2e/utils/common.js` L45-L49), including its
 * split-and-membership test. Diverges in one hardening: a missing `class`
 * attribute answers `false` rather than throwing on `null.split`, since "no
 * classes at all" plainly means "not carrying this one".
 *
 * This is a POINT-IN-TIME read with no waiting, so it is used only to decide
 * whether an action is still needed — never as an assertion. Assertions go
 * through `expect(...).toHaveClass(classTokenPattern(...))`, which retries
 * within the configured budget.
 *
 * @param locator - the element to inspect
 * @param token - the single class name to look for
 */
async function hasClassToken(locator: Locator, token: string): Promise<boolean> {
    const value = await locator.getAttribute('class');

    if (value === null) {
        return false;
    }

    return value.split(/\s+/).includes(token);
}

/**
 * Builds the selector for one specific card.
 *
 * The id is emitted through `JSON.stringify`, which produces a double-quoted,
 * correctly escaped CSS attribute value. User-story ids are numeric in practice,
 * but quoting them is free and keeps the selector well-formed for any value.
 *
 * @param userStoryId - the value of the card's `data-id`
 */
function cardIdSelector(userStoryId: string): string {
    return `${CARD_SELECTOR}[${CARD_ID_ATTRIBUTE}=${JSON.stringify(userStoryId)}]`;
}

/** The three states {@link KanbanPage.wipMarkerState} can report. */
type WipLimitState = (typeof WIP_LIMIT_STATES)[number];

/* ===========================================================================
 * The page object
 * ======================================================================== */

/**
 * The React Kanban board, expressed as selectors and flows.
 *
 * Every public member is a faithful port of an incumbent helper function or of a
 * flow the retired suite drove; nothing new is added, in keeping with the
 * migration's no-functional-change rule. Locator getters are synchronous and
 * lazy — Playwright locators resolve at use — so they are safe to hold across a
 * re-render, which matters on a board that re-renders on every drop.
 *
 * Usage:
 *
 *     import { test, expect } from '../fixtures/auth';
 *     import { KanbanPage } from '../pages/KanbanPage';
 *
 *     test('board renders', async ({ authedPage }) => {
 *         const board = new KanbanPage(authedPage);
 *
 *         await board.goto();
 *
 *         expect(await board.headerColumnNames()).not.toHaveLength(0);
 *     });
 */
export class KanbanPage {
    /**
     * @param page - the page this object drives. Prefer the `authedPage`
     *   fixture from `e2e-react/fixtures/auth.ts`, so login and tour dismissal
     *   have already happened and this object never has to know a credential.
     * @param projectSlug - which project's board to open. Defaults to
     *   {@link KANBAN_PROJECT_SLUG} from `e2e-react/fixtures/seed.ts`; it is a
     *   PARAMETER rather than a literal so a spec can point at another seeded
     *   project without a second page object. Note that the incumbent's own
     *   slug — `project-0`, `e2e/suites/kanban.e2e.js` L24 — cannot exist,
     *   because `sample_data` numbers projects from one; the seed fixture
     *   documents that correction and owns the replacement value.
     */
    constructor(
        private readonly page: Page,
        private readonly projectSlug: string = KANBAN_PROJECT_SLUG,
    ) {}

    /* -------------------------------------------------------------------
     * Navigation and readiness
     * ---------------------------------------------------------------- */

    /**
     * Opens the board and waits for it to be usable.
     *
     * PORTED FROM `e2e/suites/kanban.e2e.js` L24-L26, which navigated and then
     * called `utils.common.waitLoader()`.
     *
     * The path is RELATIVE, so the origin comes from the single `baseURL` in
     * `playwright.config.ts` and no host or port literal appears here. The
     * incumbent's own origin — the absolute host-and-port literal at
     * `conf.e2e.js` L20 — is deliberately not carried over; it names a different
     * port from the one the stack under test publishes.
     *
     * Guided-tour dismissal is NOT repeated here even though the kanban route
     * declares `joyride: "kanban"` (`app/coffee/app.coffee` L240):
     * `login()` in the auth fixture already calls `closeJoyride`, and the
     * application's `disableJoyRide()` persists the dashboard, backlog and
     * kanban flags all false together, so one dismissal covers this route too.
     */
    async goto(): Promise<void> {
        await this.page.goto(`/project/${this.projectSlug}/kanban`);

        await this.waitLoaded();
    }

    /**
     * Waits for the board to finish rendering.
     *
     * Three steps, in this order and for these reasons:
     *
     *   1. {@link waitLoader}, IMPORTED from the auth fixture rather than
     *      redefined, so the 5000 ms budget and the whole-token `active` test
     *      (`e2e/utils/common.js` L45-L49 and L118-L126) exist in exactly one
     *      place.
     *   2. The screen shell. Taiga does NOT redirect when a project is missing
     *      or forbidden — it swaps in an error partial while the address bar
     *      still shows `/project/<slug>/kanban` — so asserting the kanban shell
     *      is what distinguishes "the board is still rendering" from "an error
     *      page is rendered at this URL".
     *   3. The board root, which is gated on `ng-if="ctrl.initialLoad"`
     *      (`kanban-table.jade` L9) and therefore does not exist at the moment
     *      navigation resolves.
     *
     * This replaces the incumbent's ambient `waitForAngular()` (`kanban.e2e.js`
     * L26, L238, L258), which has no Playwright equivalent because it waits on
     * AngularJS's digest and pending `$http` traffic; a wait for the rendered
     * outcome is both available and stricter.
     *
     * WHAT THIS DELIBERATELY DOES NOT WAIT FOR: the CARD INTERIORS. `.card-inner`
     * is gated on the virtualisation flag, so a `tg-card` host can be in the DOM
     * with nothing inside it, and that gate is driven by an IntersectionObserver
     * rather than by load completion — measured on the deployed board, all 37
     * card hosts were present with zero `.card-inner` among them. Folding a wait
     * for card interiors in here would be wrong twice over: it would hang forever
     * on a legitimately empty column, and it would couple "the board is ready" to
     * how much data the project happens to hold. The accessors that actually need
     * a realised card wait for it themselves — see {@link assignedName}.
     */
    async waitLoaded(): Promise<void> {
        await waitLoader(this.page);

        await this.screenRoot().waitFor({
            state: 'visible',
            timeout: BOARD_READY_TIMEOUT_MS,
        });

        await this.boardRoot().waitFor({
            state: 'visible',
            timeout: BOARD_READY_TIMEOUT_MS,
        });
    }

    /** The board root, `div.kanban-table`. See {@link BOARD_SELECTOR}. */
    boardRoot(): Locator {
        return this.page.locator(BOARD_SELECTOR);
    }

    /* -------------------------------------------------------------------
     * Status header band
     * ---------------------------------------------------------------- */

    /**
     * Every status header cell.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L13-L15
     * (`$$('.task-colum-name')`) — unchanged, misspelling included.
     */
    headerColumns(): Locator {
        return this.page.locator(HEADER_COLUMN_SELECTOR);
    }

    /**
     * One status header cell, by position in board order.
     *
     * @param column - zero-based index, as
     *   `kanban-helper.js`'s `getHeaderColumns().get(column)` used it
     */
    headerColumn(column: number): Locator {
        return this.headerColumns().nth(column);
    }

    /**
     * The visible status names, in board order.
     *
     * Reads `div.title div.name` (`kanban-table.jade` L27-L28) and trims each
     * value, because the template interpolates `{{ s.name }}` with surrounding
     * whitespace.
     */
    async headerColumnNames(): Promise<string[]> {
        const names = await this.headerColumns()
            .locator(HEADER_COLUMN_NAME_SELECTOR)
            .allTextContents();

        return names.map((name: string): string => name.trim());
    }

    /**
     * One status's colour swatch.
     *
     * Exposed so a spec can assert the swatch EXISTS and gains `hidden` when the
     * column folds. Its colour is per-project data bound to `s.color`
     * (`kanban-table.jade` L24) and must never be asserted: the values in the
     * reference frames come from seeded sample data and would not match any real
     * project.
     *
     * @param column - zero-based header index
     */
    statusSwatch(column: number): Locator {
        return this.headerColumn(column).locator(STATUS_SWATCH_SELECTOR);
    }

    /**
     * Folds one status column.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L57-L61, with BOTH of its
     * defects corrected: it looked for `.options a`, which matches nothing (see
     * {@link HEADER_OPTION_SELECTOR}), and it took the control at index 0, which
     * is the add-user-story button rather than the fold button (see the icon
     * anchors above). The control is identified here by the icon it contains, so
     * it stays correct however the conditional controls around it come and go.
     *
     * The bounded settle is the header cell gaining `vfold`.
     *
     * @param column - zero-based header index
     */
    async foldColumn(column: number): Promise<void> {
        const header = this.headerColumn(column);

        await header
            .locator(HEADER_OPTION_SELECTOR)
            .filter({ has: this.page.locator(ICON_FOLD_SELECTOR) })
            .click();

        await expect(header).toHaveClass(classTokenPattern(FOLD_CLASS));
    }

    /**
     * Unfolds one status column.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L63-L67, same two corrections
     * as {@link foldColumn}: not `.options a`, and not index 1.
     *
     * WHY `.first()` IS CORRECT HERE, and is not an arbitrary choice. There are
     * two unfold controls in the template and which of them is in the DOM
     * depends on the status:
     *
     *   - `kanban-table.jade` L55 is gated `ng-if="s.is_archived"`, so for a
     *     NON-archived status it is absent entirely and `.first()` resolves to
     *     the L65 control — the right one.
     *   - For an ARCHIVED status both exist, L55 comes first in document order,
     *     and L65 is the one hidden by `ng-hide="s.is_archived"`. So `.first()`
     *     again resolves to the actionable control — and specifically to the one
     *     that also restores the archived status header.
     *
     * Confirmed by measuring the deployed board, whose six statuses end with an
     * archived one: 25 `.options button.option` in total, 7 of them `.hunfold` —
     * four controls in each of the five ordinary headers plus five in the archived
     * one, i.e. (5 x 1) + 2 unfold controls, exactly as the two gates predict. The
     * archived header's five buttons appeared in the order add, bulk, fold,
     * `hunfold`, `hunfold`, with the SECOND `hunfold` carrying `ng-hide` — which
     * is precisely why `.first()` is the actionable one.
     *
     * The bounded settle is the header cell losing `vfold`.
     *
     * @param column - zero-based header index
     */
    async unfoldColumn(column: number): Promise<void> {
        const header = this.headerColumn(column);

        await header
            .locator(HEADER_UNFOLD_OPTION_SELECTOR)
            .filter({ has: this.page.locator(ICON_UNFOLD_SELECTOR) })
            .first()
            .click();

        await expect(header).not.toHaveClass(classTokenPattern(FOLD_CLASS));
    }

    /**
     * Opens the create-user-story lightbox from a status header.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L17-L19, correcting its index:
     * `.$$('.option').get(2)` is the FOLD control, so the incumbent helper
     * folded the column instead of opening the lightbox. The add button is
     * identified here by its `icon-add` icon (`kanban-table.jade` L37).
     *
     * The lookup is scoped to the header cell on purpose: the swimlane
     * "create swimlane" link also renders an `icon-add`
     * (`kanban-table.jade` L181), and an unscoped icon search would reach it.
     *
     * @param column - zero-based header index
     */
    async openNewUsLightbox(column: number): Promise<void> {
        await this.headerColumn(column)
            .locator(HEADER_OPTION_SELECTOR)
            .filter({ has: this.page.locator(ICON_ADD_SELECTOR) })
            .click();

        await this.waitLightboxOpen(this.createEditLightbox());
    }

    /**
     * Opens the bulk-create lightbox from a status header.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L53-L55, which used a
     * PAGE-WIDE `$$('.icon-bulk').get(column)` and so depended on every status
     * header rendering its bulk button — which `tg-check-permission="add_us"`
     * and `ng-hide="s.is_archived"` (`kanban-table.jade` L43-L44) do not
     * guarantee. Scoping to the header cell makes the index mean the column it
     * claims to mean.
     *
     * @param column - zero-based header index
     */
    async openBulkUsLightbox(column: number): Promise<void> {
        await this.headerColumn(column)
            .locator(HEADER_OPTION_SELECTOR)
            .filter({ has: this.page.locator(ICON_BULK_SELECTOR) })
            .click();

        await this.waitLightboxOpen(this.bulkLightbox());
    }

    /* -------------------------------------------------------------------
     * Status columns
     * ---------------------------------------------------------------- */

    /**
     * Every status column body on the board.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L21-L23 with correction 1: the
     * incumbent's `.task-column` matches nothing. See
     * {@link STATUS_COLUMN_SELECTOR}.
     *
     * In swimlane mode this is one element per status PER SWIMLANE, in swimlane
     * order — which is what makes the flat indexing the incumbent used still
     * work for the first swimlane, and why {@link statusColumnInSwimlane} exists
     * for anything beyond it.
     */
    statusColumns(): Locator {
        return this.page.locator(STATUS_COLUMN_SELECTOR);
    }

    /**
     * One status column body, by position.
     *
     * @param column - zero-based index over {@link statusColumns}
     */
    statusColumn(column: number): Locator {
        return this.statusColumns().nth(column);
    }

    /**
     * Every column body for one status, addressed by the status's own id.
     *
     * Uses `data-status` (`kanban-table.jade` L119 and L196), which is stable
     * across reorderings in a way a positional index is not. In swimlane mode it
     * resolves once per swimlane; combine with {@link statusColumnInSwimlane} to
     * reach exactly one.
     *
     * @param statusId - the user-story status id
     */
    statusColumnById(statusId: string): Locator {
        return this.page.locator(
            `${STATUS_COLUMN_SELECTOR}[data-status=${JSON.stringify(statusId)}]`,
        );
    }

    /**
     * Exactly one column body: one status within one swimlane.
     *
     * Both attributes are on the same element in swimlane mode —
     * `data-status` at `kanban-table.jade` L119 and `data-swimlane` at L120 — so
     * this is the only locator on the board that is unambiguous without an
     * index. The unclassified swimlane's id is `-1` (L82).
     *
     * @param swimlaneId - the swimlane id
     * @param statusId - the user-story status id
     */
    statusColumnInSwimlane(swimlaneId: string, statusId: string): Locator {
        return this.page.locator(
            `${STATUS_COLUMN_SELECTOR}[data-swimlane=${JSON.stringify(swimlaneId)}]` +
                `[data-status=${JSON.stringify(statusId)}]`,
        );
    }

    /**
     * How many status columns are currently folded.
     *
     * PORTED FROM the assertions at `e2e/suites/kanban.e2e.js` L215 and L223,
     * with correction 1b: they counted `.vfold.task-column`, which is zero, and
     * a bare `.vfold` would have counted double because the header cell carries
     * the class as well. See {@link FOLDED_STATUS_COLUMN_SELECTOR}.
     *
     * In swimlane mode a folded status contributes one per swimlane, because
     * folding is per status and applies across the whole board.
     */
    async foldedColumnCount(): Promise<number> {
        return this.page.locator(FOLDED_STATUS_COLUMN_SELECTOR).count();
    }

    /**
     * The per-column card counter's visible text: `"3"` with no WIP limit,
     * `"2 / 3"` with one.
     *
     * Anchored on `.kanban-task-counter`, deliberately not on its inner
     * `tg-animated-counter` element — see {@link TASK_COUNTER_SELECTOR} — and
     * then narrowed to the MIDDLE of the roller's three value rows, without
     * which the answer would be all three values at once. See
     * {@link TASK_COUNTER_VALUE_SELECTOR}, which records the measurement that
     * established this. Interior whitespace is collapsed because the count and
     * the limit are separate elements and the markup indents them.
     *
     * @param column - zero-based index over {@link statusColumns}
     */
    async taskCounterText(column: number): Promise<string> {
        const counter = this.statusColumn(column).locator(TASK_COUNTER_SELECTOR);

        await expect(counter).toBeVisible();

        const value = counter
            .locator(TASK_COUNTER_VALUE_SELECTOR)
            .nth(TASK_COUNTER_VISIBLE_ROW);

        const text = await value.innerText();

        return text.replace(/\s+/g, ' ').trim();
    }

    /**
     * The WIP-limit marker inside a column, if the column has one.
     *
     * @param column - zero-based index over {@link statusColumns}
     */
    wipMarker(column: number): Locator {
        return this.statusColumn(column).locator(WIP_LIMIT_SELECTOR);
    }

    /**
     * Which WIP-limit state a column is showing, or `null` for none.
     *
     * The state arithmetic is `KanbanWipLimitDirective`'s, verbatim from
     * `app/coffee/modules/kanban/main.coffee` L815-L853, where `cards` is the
     * column's `tg-card` count:
     *
     *     cards.length + 1 === status.wip_limit  ->  'one-left'
     *     cards.length     === status.wip_limit  ->  'reached'
     *     cards.length      >  status.wip_limit  ->  'exceeded'
     *
     * The insertion POINT differs between them and is worth knowing when
     * reading the DOM: `one-left` and `reached` place the marker after the last
     * card, while `exceeded` places it after `cards[status.wip_limit - 1]`, i.e.
     * amid the cards rather than below them (L828, L831, L834).
     *
     * `null` is a legitimate, common answer, not a failure: the marker is absent
     * when the status has no limit, when the count is more than one below it,
     * when the status is archived — the directive skips those entirely (L842) —
     * and it is present but hidden by CSS while the column is folded
     * (`kanban-table.scss` L79-L83).
     *
     * The STATE CLASS is what this reports. Never assert the marker's colour:
     * the tint is `$color-link-red` at reduced strength for `one-left` and at
     * full strength for `reached`, both computed by the stylesheet, and pinning a
     * hex value here would couple the suite to the theme.
     *
     * @param column - zero-based index over {@link statusColumns}
     */
    async wipMarkerState(column: number): Promise<WipLimitState | null> {
        const marker = this.wipMarker(column);

        if ((await marker.count()) === 0) {
            return null;
        }

        const value = await marker.first().getAttribute('class');

        if (value === null) {
            return null;
        }

        const tokens = value.split(/\s+/);

        return (
            WIP_LIMIT_STATES.find((state: WipLimitState): boolean =>
                tokens.includes(state),
            ) ?? null
        );
    }

    /* -------------------------------------------------------------------
     * Cards
     * ---------------------------------------------------------------- */

    /**
     * Every card on the board.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L33-L35 (`$$('tg-card')`),
     * unchanged — and it is also the counter the retired suite handed to the
     * shared filter cases (`kanban.e2e.js` L286-L288), so a filter spec can
     * assert against `cards().count()` exactly as before.
     */
    cards(): Locator {
        return this.page.locator(CARD_SELECTOR);
    }

    /**
     * The cards inside one status column.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L29-L31, unchanged apart from
     * correction 1 to the container selector.
     *
     * @param column - zero-based index over {@link statusColumns}
     */
    cardsInColumn(column: number): Locator {
        return this.statusColumn(column).locator(CARD_SELECTOR);
    }

    /**
     * The card with a given user-story id, wherever it currently sits.
     *
     * This is the locator that makes a drag's outcome checkable, since the id
     * survives the re-parenting that a drop performs.
     *
     * @param userStoryId - the value of the card's `data-id`
     */
    cardById(userStoryId: string): Locator {
        return this.page.locator(cardIdSelector(userStoryId));
    }

    /**
     * The subjects of the cards currently realised in one column.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L25-L27, fixing a real bug:
     * that helper accepted a `column` argument and then never used it —
     * `helper.getColumns().$$('.e2e-title')` searched EVERY column — so
     * `getColumnUssTitles(0)` returned the whole board's subjects. Here the
     * search is scoped to the column named.
     *
     * `.e2e-title` is deliberately kept: it is one of the incumbent selectors
     * that is still correct (see {@link CARD_TITLE_SELECTOR}).
     *
     * VIRTUALISATION: this lists the subjects of the cards that are currently
     * REALISED. An off-screen card renders no `.card-inner`, and therefore no
     * subject, so a column taller than the viewport reports fewer titles than
     * {@link cardsInColumn} counts. That is the application's behaviour, faithfully
     * preserved, not a defect in this accessor — scroll the column first if a
     * spec needs everything.
     *
     * @param column - zero-based index over {@link statusColumns}
     */
    async cardTitlesInColumn(column: number): Promise<string[]> {
        const titles = await this.cardsInColumn(column)
            .locator(CARD_TITLE_SELECTOR)
            .allTextContents();

        return titles.map((title: string): string => title.trim());
    }

    /**
     * Adds a card to the multi-selection with a Control+click.
     *
     * FROM `kanban-table.jade` L169 and L244:
     * `ng-click="($event.ctrlKey || $event.metaKey) && ctrl.toggleSelectedUs(usId)"`.
     * The handler is on `tg-card` itself, so any point inside the card toggles
     * selection — and a selected card then receives both `kanban-task-selected`
     * and `ui-multisortable-multiple` (L154, L230).
     *
     * The incumbent suite never exercised multi-selection, so there is no helper
     * to port; this exists because `@dnd-kit/core` has NO built-in multi-item
     * drag, the migration hand-builds that behaviour, and the resulting
     * selection state has to be observable from a spec. The multi-drag ghost it
     * feeds is the always-present `.card-transit-multi > div.fake-us` pair
     * (`card.jade` L45-L55).
     *
     * WHY THE CLICK IS POSITIONED AT THE CARD'S TOP-LEFT CORNER, and why that
     * point specifically. The card's ref and subject sit inside an `<a>` carrying
     * `tg-nav` (`card-templates/card-title.jade` L9-L16). A Control+click landing
     * on that anchor does NOT select: the browser claims the gesture to open the
     * link in a background tab, and the event never reaches the card's own
     * handler — confirmed by running exactly that against Firefox, where the
     * selection silently failed to toggle.
     *
     * The point chosen is provably clear of it. `.card-inner` is declared
     * `padding: 1rem 0 .75rem 0` (`app/modules/components/card/card.scss`
     * L37-L40), so the card's top 16 px is `.card-inner`'s own padding with no
     * child in it, and the padding is vertical only — meaning the top-left pixel
     * belongs to `.card-inner` itself whether or not the story has tags. It is
     * also nowhere near `.card-actions`, which the stylesheet positions at the
     * top RIGHT. The click therefore lands on a descendant of `tg-card` that is
     * not a link and carries no handler of its own, which is exactly what the
     * selection handler needs.
     *
     * The repository sets the precedent for this hazard itself:
     * `card-templates/card-unfold.jade` L9 guards its own handler with
     * `!$event.ctrlKey && !$event.metaKey`, and
     * `app/coffee/modules/kanban/card-directives.coffee` L119 does the same,
     * precisely so that a Control+click reaches the card rather than the control.
     *
     * IDEMPOTENT BY DESIGN, and this is a deliberate hardening: the underlying
     * handler TOGGLES, so a second Control+click would DEselect. The click is
     * therefore skipped when the card is already selected, which makes the
     * method mean what its name says. The incumbent had no equivalent to
     * diverge from.
     *
     * @param column - zero-based index over {@link statusColumns}
     * @param card - zero-based index within that column
     */
    async selectCard(column: number, card: number): Promise<void> {
        const target = this.cardsInColumn(column).nth(card);

        await target.scrollIntoViewIfNeeded();

        if (!(await hasClassToken(target, CARD_SELECTED_CLASS))) {
            await target.click({
                modifiers: ['Control'],
                position: { x: 1, y: 1 },
            });
        }

        await expect(target).toHaveClass(classTokenPattern(CARD_SELECTED_CLASS));
    }

    /**
     * Every currently selected card.
     *
     * See {@link CARD_SELECTED_CLASS} for why `kanban-task-selected` is used
     * rather than the `ui-multisortable-multiple` that is applied alongside it.
     */
    selectedCards(): Locator {
        return this.page.locator(`${CARD_SELECTOR}.${CARD_SELECTED_CLASS}`);
    }

    /**
     * Opens a card's action popover.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L37-L51 with corrections 4 and
     * 7. That helper hovered `.card-owner-actions` and then clicked
     * `.e2e-edit`; neither class exists on a kanban card. The real path is
     * `.card-actions button.js-popup-button`
     * (`card-templates/card-actions.jade` L2-L3), and what it opens is a
     * popover whose items the caller then chooses from — so this method opens
     * the menu and stops there, rather than assuming which item is wanted.
     *
     * The hover is kept from the incumbent because the button is revealed on
     * hover; the click that follows is bounded by the `actionTimeout` configured
     * in `playwright.config.ts`, and it will fail loudly if the button is not
     * rendered — which is a real possibility, since
     * `card-templates/card-actions.jade` L1 gates it on `vm.zoomLevel > 0` AND
     * the modify-or-delete permission.
     *
     * The settle is the incumbent's own popover condition
     * (`e2e/utils/popover.js` L21-L27): EXACTLY ONE `.popover.active` within
     * 3000 ms, then the 400 ms transition it also waited out.
     *
     * @param column - zero-based index over {@link statusColumns}
     * @param card - zero-based index within that column
     */
    async openCardActions(column: number, card: number): Promise<void> {
        const target = this.cardsInColumn(column).nth(card);

        await target.scrollIntoViewIfNeeded();
        await target.hover();

        await target.locator(CARD_ACTIONS_BUTTON_SELECTOR).click();

        await expect(this.page.locator(ACTIVE_POPOVER_SELECTOR)).toHaveCount(1, {
            timeout: POPOVER_TIMEOUT_MS,
        });

        await this.page.waitForTimeout(POPOVER_TRANSITION_MS);
    }

    /**
     * The name shown in a card's assigned-to area, or `null` when the card does
     * not show one at all.
     *
     * PORTED FROM `e2e/suites/kanban.e2e.js` L281 with correction 5, and
     * covering correction 6 as well. The incumbent read `.card-owner-name` and
     * collected `.e2e-assign`; neither class exists. The real structure is
     * documented at {@link CARD_ASSIGNED_TO_SELECTOR}, and the assignee's name
     * lives in the avatar image's `title` attribute rather than in any text
     * node.
     *
     * Three answers, all legitimate:
     *   - a person's full name, when the story has assignees — the FIRST
     *     avatar's, since up to two are rendered plus an "N+" badge;
     *   - the translated "not assigned" label, when it has none;
     *   - `null`, when the card does not render the area at all — it is gated on
     *     `vm.visible('assigned_to') && !vm.project.archived_code`
     *     (`card-assigned-to.jade` L8), so at the smallest zoom or on an
     *     archived project there is nothing to read.
     *
     * The card is scrolled into view and its body awaited first, because an
     * unrealised card renders no `.card-inner` and would otherwise answer
     * `null` for a reason that has nothing to do with its assignees. That wait
     * uses the `expect` budget configured in `playwright.config.ts`, so no new
     * number is introduced.
     *
     * @param column - zero-based index over {@link statusColumns}
     * @param card - zero-based index within that column
     */
    async assignedName(column: number, card: number): Promise<string | null> {
        const target = this.cardsInColumn(column).nth(card);

        await target.scrollIntoViewIfNeeded();
        await expect(target.locator(CARD_INNER_SELECTOR)).toBeAttached();

        const container = target.locator(CARD_ASSIGNED_TO_SELECTOR);

        if ((await container.count()) === 0) {
            return null;
        }

        const unassigned = container.locator(CARD_NOT_ASSIGNED_SELECTOR);

        if ((await unassigned.count()) > 0) {
            const label = container.locator(CARD_NOT_ASSIGNED_TITLE_SELECTOR);

            // `span.card-not-assigned-title` is itself gated on
            // `vm.visible('assigned_to_extended')` (`card-assigned-to.jade`
            // L18), so at tighter zoom levels the label is absent and the
            // translated text survives only as the placeholder image's `title`
            // (L15). Both carry the same string.
            if ((await label.count()) > 0) {
                return normaliseText(await label.first().textContent());
            }

            return normaliseText(
                await unassigned.locator('img').first().getAttribute('title'),
            );
        }

        return normaliseText(
            await container
                .locator(CARD_AVATAR_SELECTOR)
                .locator('img')
                .first()
                .getAttribute('title'),
        );
    }

    /* -------------------------------------------------------------------
     * Swimlanes
     * ---------------------------------------------------------------- */

    /**
     * Every swimlane row, in board order.
     *
     * Empty on a project without swimlanes: the whole block is gated on
     * `ng-if="swimlanesList.size"` (`kanban-table.jade` L74) and the board falls
     * back to the flat body at L184.
     */
    swimlanes(): Locator {
        return this.page.locator(SWIMLANE_SELECTOR);
    }

    /** The swimlane names, in board order. */
    async swimlaneTitles(): Promise<string[]> {
        const titles = await this.swimlanes()
            .locator(SWIMLANE_TITLE_SELECTOR)
            .locator(SWIMLANE_NAME_SELECTOR)
            .allTextContents();

        return titles.map((title: string): string => title.trim());
    }

    /**
     * Collapses or expands one swimlane, and waits for the state to flip.
     *
     * The whole header button is the toggle (`ng-click="ctrl.toggleSwimlane(...)"`,
     * `kanban-table.jade` L83). Because it toggles, the current state is read
     * first and the assertion is chosen to match — so this method is honest
     * about being a toggle instead of pretending to be a one-way collapse.
     *
     * The settle is the `folded` class flipping, which is also the trigger for
     * the body's enter/leave animation the stylesheet drives at
     * `kanban-table.scss` L549-L575. `expect`'s configured budget covers the
     * 0.5 s that animation takes.
     *
     * @param swimlane - zero-based index over {@link swimlanes}
     */
    async toggleSwimlane(swimlane: number): Promise<void> {
        const title = this.swimlanes()
            .nth(swimlane)
            .locator(SWIMLANE_TITLE_SELECTOR);

        const wasFolded = await hasClassToken(title, SWIMLANE_FOLDED_CLASS);

        await title.click();

        const folded = classTokenPattern(SWIMLANE_FOLDED_CLASS);

        if (wasFolded) {
            await expect(title).not.toHaveClass(folded);
        } else {
            await expect(title).toHaveClass(folded);
        }
    }

    /**
     * The default-swimlane marker — a star plus an italic label.
     *
     * Gated on `swimlane.id == project.default_swimlane && project.swimlanes.length > 1`
     * (`kanban-table.jade` L102), so a project with a single swimlane shows none
     * and a zero count is a legitimate assertion rather than a failure.
     */
    defaultSwimlaneMarker(): Locator {
        return this.page.locator(DEFAULT_SWIMLANE_SELECTOR);
    }

    /**
     * The "create swimlane" link.
     *
     * Gated on `swimlanesList.size && project.i_am_admin && swimlanesList.size <= 1`
     * (`kanban-table.jade` L177), so it appears only for an admin on a project
     * that has exactly one swimlane.
     */
    swimlaneAddLink(): Locator {
        return this.page.locator(SWIMLANE_ADD_SELECTOR);
    }

    /* -------------------------------------------------------------------
     * Archived column
     * ---------------------------------------------------------------- */

    /**
     * The archived status's column body, identified by its collapsed
     * placeholder.
     *
     * The fingerprint is `div.archived` inside the collapsed placeholder
     * (`kanban-table.jade` L138 and L214), which is gated on `s.is_archived` —
     * so this is a SEMANTIC identification, not a positional guess. It follows
     * that this locator only resolves while the archived column is folded, which
     * is its state on first load: `tgKanbanSquishColumn`
     * (`app/coffee/modules/kanban/main.coffee` L809) squishes archived statuses
     * when the board initialises.
     *
     * In swimlane mode it resolves once per swimlane, because folding is per
     * status and applies board-wide; scope with `.first()` or `.nth()`, or use
     * {@link statusColumnInSwimlane}, when exactly one element is needed.
     *
     * IT RESOLVES TO NOTHING WHEN THE ARCHIVED COLUMN IS EXPANDED, and that is a
     * real state rather than a theoretical one: measured on the deployed board,
     * nothing was folded at all — zero `.vfold`, zero `.placeholder-collapsed` —
     * and the archived status rendered as an ordinary expanded
     * `.kanban-uses-box.taskboard-column[data-status]`, one per swimlane. A spec
     * that needs the collapsed rail must therefore either observe the board in
     * its squished initial state or fold the column itself with
     * {@link foldColumn}; and {@link expandArchivedColumn} is only meaningful
     * while the column IS folded, since the unfold control is hidden otherwise.
     */
    archivedColumn(): Locator {
        return this.statusColumns().filter({
            has: this.page.locator(ARCHIVED_PLACEHOLDER_SELECTOR),
        });
    }

    /**
     * Expands the squished archived column.
     *
     * The control is the header's `.option.hunfold` — for an archived status
     * that is the variant at `kanban-table.jade` L55, which additionally carries
     * the archived-status-header behaviour, and `.first()` resolves to it for
     * the reason set out in {@link unfoldColumn}.
     *
     * The archived status is addressed as the LAST header cell. That is the
     * incumbent's own basis — `e2e/suites/kanban.e2e.js` L252 reached the
     * archived column as `getColumns().last()` — and it matches the board, where
     * the archived rail renders rightmost. A spec working against a project that
     * orders its statuses differently should call {@link unfoldColumn} with the
     * explicit index instead.
     *
     * The bounded settle is the observable outcome: no collapsed archived
     * placeholder remains anywhere on the board.
     */
    async expandArchivedColumn(): Promise<void> {
        await this.headerColumns()
            .last()
            .locator(HEADER_UNFOLD_OPTION_SELECTOR)
            .filter({ has: this.page.locator(ICON_UNFOLD_SELECTOR) })
            .first()
            .click();

        await expect(
            this.page.locator(ARCHIVED_PLACEHOLDER_SELECTOR),
        ).toHaveCount(0);
    }

    /* -------------------------------------------------------------------
     * Toolbar, scrolling and zoom
     * ---------------------------------------------------------------- */

    /**
     * Scrolls the board body fully to the right.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L69-L71:
     * `executeScript('$(".kanban-table-body:last").scrollLeft(10000);')`.
     *
     * Three translations were required.
     *
     * 1. jQuery is not used. The incumbent could rely on the page's own `$`
     *    because it injected script into an AngularJS application that ships
     *    jQuery, but nothing in this layer should depend on that, so the DOM API
     *    is used directly.
     * 2. jQuery's `:last` is not standard CSS, so the "last body" selection
     *    happens in the script rather than in the selector; in swimlane mode
     *    there is one body per swimlane (`kanban-table.jade` L107) and in flat
     *    mode exactly one (L184).
     * 3. ★ THE INCUMBENT SCROLLED THE WRONG ELEMENT, and this one is only
     *    findable by measuring the running page. Every `div.kanban-table-body`
     *    does overflow horizontally — measured `scrollWidth` 1777 against
     *    `clientWidth` 1704 on all five — but its computed `overflow-x` is
     *    `visible`, so it is NOT a scroll container and assigning `scrollLeft`
     *    to it does nothing at all. The element that actually scrolls is the
     *    ancestor `div.kanban-table`, whose computed `overflow-x` is `auto`.
     *    Porting `$(".kanban-table-body:last").scrollLeft(10000)` literally
     *    would therefore have produced a silent no-op, and
     *    {@link dragCardToArchived} — which depends on this to bring the
     *    rightmost column into the viewport — would have failed for a reason
     *    with no visible connection to scrolling.
     *
     * Both are assigned rather than just the board root: the board root is the
     * measured scroll owner today, and the last body is the incumbent's own
     * target, kept so this keeps working if the React board moves the overflow
     * back onto the body. Assigning to a non-scrolling element is inert, so
     * covering both costs nothing.
     *
     * @throws if the board root is not present, rather than scrolling nothing
     *   and reporting success
     */
    async scrollRight(): Promise<void> {
        await this.page.evaluate(
            (probe: {
                boardSelector: string;
                bodySelector: string;
                offset: number;
            }): void => {
                const board = document.querySelector(probe.boardSelector);

                if (board === null) {
                    throw new Error(
                        `KanbanPage.scrollRight: no element matched "${probe.boardSelector}"; the board is not rendered.`,
                    );
                }

                board.scrollLeft = probe.offset;

                const bodies = document.querySelectorAll(probe.bodySelector);

                if (bodies.length > 0) {
                    bodies[bodies.length - 1].scrollLeft = probe.offset;
                }
            },
            {
                boardSelector: BOARD_SELECTOR,
                bodySelector: BOARD_BODY_SELECTOR,
                offset: SCROLL_RIGHT_OFFSET_PX,
            },
        );
    }

    /**
     * Clicks one step of the zoom control.
     *
     * PORTED FROM `e2e/helpers/kanban-helper.js` L77-L83. The widget is a single
     * element holding four steps, so it is driven by an offset click rather than
     * by addressing a step element: Protractor's
     * `mouseMove($('tg-board-zoom'), {y: 14, x: level * 49})` becomes
     * `click({ position: { x: level * 49, y: 14 } })`, which is the same
     * arithmetic against the same element.
     *
     * `level` is the incumbent's own 1-based STEP ORDINAL — the retired suite
     * called it with 1, 2, 3 and 4 (`kanban.e2e.js` L32, L36, L40, L44) — and it
     * is deliberately NOT presented as the resulting `zoom-N` level. The mapping
     * between the two is a property of the prebuilt `tg-board-zoom` widget's
     * internal geometry, which lives in `elements.js` and which this migration
     * does not touch, so hardcoding it here would invent a coupling nothing
     * verifies. Read the outcome with {@link zoomLevel} and assert it in the
     * spec.
     *
     * A read-only inspection of the deployed widget reinforces that choice: it
     * renders four `label.zoom-radio > input[type="radio"]` controls rather than a
     * continuous track, so an offset click resolves to whichever of those four the
     * point falls in — a relationship set by the widget's own layout, not by
     * anything in this repository. The offset was deliberately NOT probed live,
     * because the zoom level is persisted per user and project through
     * `$tgStorage`, and changing it would alter the board's default appearance for
     * the committed before/after captures this migration is judged on.
     *
     * The bounded settle asserts the board root still declares a zoom level,
     * i.e. the board survived the re-layout. The incumbent's flat
     * 1000 ms settle is kept IN ADDITION, not instead: the zoom change
     * re-lays-out every card through a CSS transition that no class change marks
     * the end of.
     *
     * @param level - step ordinal, {@link MIN_ZOOM_STEP} to {@link MAX_ZOOM_STEP}
     * @throws if `level` is outside the range the control offers
     */
    async zoom(level: number): Promise<void> {
        if (
            !Number.isInteger(level) ||
            level < MIN_ZOOM_STEP ||
            level > MAX_ZOOM_STEP
        ) {
            throw new Error(
                `KanbanPage.zoom: level must be an integer between ${MIN_ZOOM_STEP} and ` +
                    `${MAX_ZOOM_STEP}, got ${String(level)}.`,
            );
        }

        await this.page.locator(BOARD_ZOOM_SELECTOR).click({
            position: {
                x: level * ZOOM_STEP_WIDTH_PX,
                y: ZOOM_STEP_CENTRE_Y_PX,
            },
        });

        await expect(this.boardRoot()).toHaveClass(ZOOM_CLASS_PATTERN);

        await this.page.waitForTimeout(ZOOM_SETTLE_MS);
    }

    /**
     * The board's current zoom level, 0 to 3.
     *
     * Read from the board root's own class, which carries exactly one of
     * `zoom-0` … `zoom-3` (`kanban-table.jade` L14). This is the reader
     * {@link zoom} deliberately does not fold into itself.
     *
     * @throws if the board declares no zoom level, which would mean the board
     *   root is not rendered
     */
    async zoomLevel(): Promise<number> {
        const value = await this.boardRoot().getAttribute('class');
        const match = value === null ? null : ZOOM_CLASS_PATTERN.exec(value);

        if (match === null) {
            throw new Error(
                'KanbanPage.zoomLevel: the board root carries no zoom-0..zoom-3 class; the board is not rendered.',
            );
        }

        return Number.parseInt(match[1], 10);
    }

    /**
     * Opens the filter panel, and does nothing if it is already open.
     *
     * PORTED FROM `e2e/helpers/filters-helper.js` L17-L29, keeping its
     * presence guard: that helper returned early when `.e2e-open-filter` was
     * absent (L18-L24), because not every screen and not every permission set
     * renders the toggle. The same guard is kept here, and it is a guard rather
     * than a swallowed failure — with nothing to click there is nothing to wait
     * for either.
     *
     * TWO DIVERGENCES, both deliberate:
     *
     *   1. The fixed sleep is gone. `e2e/shared/filters.js` L21 slept a flat
     *      4000 ms after opening, because the `transitionend`
     *      waiter `filters-helper.js` L28 returned was never awaited by its
     *      caller. Its duration is reused as the BUDGET for a real visibility
     *      assertion on the panel, so the wait ends as soon as the panel is up
     *      and still fails loudly if it never appears.
     *   2. The toggle is only clicked when the panel is closed. The control is a
     *      toggle — `ng-click="ctrl.openFilter = !ctrl.openFilter"`,
     *      `kanban.jade` L23 — so clicking it while the panel is open would
     *      CLOSE it and then time out waiting for it. The incumbent ran this
     *      once per suite, from a `before`, and so never met that case.
     */
    async openFilters(): Promise<void> {
        const toggle = this.screenRoot().locator(FILTER_TOGGLE_SELECTOR);

        if ((await toggle.count()) === 0) {
            return;
        }

        if (!(await hasClassToken(toggle, FILTER_TOGGLE_ACTIVE_CLASS))) {
            await toggle.click();
        }

        await expect(this.filterPanel()).toBeVisible({
            timeout: FILTER_PANEL_TIMEOUT_MS,
        });
    }

    /**
     * The filter panel. `tg-filter` is a surviving element name — the panel
     * stays AngularJS-rendered.
     */
    filterPanel(): Locator {
        return this.page.locator(FILTER_PANEL_SELECTOR);
    }

    /**
     * The toolbar search box. `tg-input-search` is a surviving element name; its
     * default placeholder resolves to the singular "subject or reference".
     */
    searchInput(): Locator {
        return this.screenRoot().locator(SEARCH_SELECTOR);
    }

    /**
     * The create/edit user-story lightbox host.
     *
     * See {@link CREATE_EDIT_LIGHTBOX_SELECTOR} for why this one keeps an
     * AngularJS attribute selector while everything else in this file is
     * class-based.
     */
    createEditLightbox(): Locator {
        return this.page.locator(CREATE_EDIT_LIGHTBOX_SELECTOR);
    }

    /**
     * The bulk-create user-stories lightbox host.
     *
     * See {@link BULK_LIGHTBOX_SELECTOR}; same retained-AngularJS rationale.
     */
    bulkLightbox(): Locator {
        return this.page.locator(BULK_LIGHTBOX_SELECTOR);
    }

    /* -------------------------------------------------------------------
     * Drag and drop
     * ---------------------------------------------------------------- */

    /**
     * Moves a card from one status column to another.
     *
     * PORTED FROM `e2e/suites/kanban.e2e.js` L229-L245, which resolved the first
     * card of one column and the container of another and then called
     * `utils.common.drag(usOrigin, destination, 0, 10)`. The gesture underneath
     * is completely different — see {@link dndKitDrag} for why the incumbent's
     * synthetic-event drag cannot be ported — but the coordinates' `+10`
     * survives as {@link CARD_DROP_OFFSET_Y}.
     *
     * The outcome is asserted rather than assumed: the moved card's `data-id`
     * must be a descendant of the destination column afterwards. That is
     * stronger than the incumbent's before/after count comparison (L243-L244),
     * which two simultaneous moves in opposite directions would satisfy without
     * either card having gone where it was sent.
     *
     * @param fromColumn - zero-based source index over {@link statusColumns}
     * @param cardIndex - zero-based card index within the source column
     * @param toColumn - zero-based destination index over {@link statusColumns}
     * @throws if the source card carries no `data-id`, or if it is not in the
     *   destination column once the drop has settled
     */
    async dragCard(
        fromColumn: number,
        cardIndex: number,
        toColumn: number,
    ): Promise<void> {
        const source = this.cardsInColumn(fromColumn).nth(cardIndex);
        const userStoryId = await requireCardId(source);
        const target = this.statusColumn(toColumn);

        await dndKitDrag(this.page, source, target, {
            offsetY: CARD_DROP_OFFSET_Y,
        });

        await expect(target.locator(cardIdSelector(userStoryId))).toHaveCount(1);
    }

    /**
     * Moves a card into the archived column.
     *
     * PORTED FROM `e2e/suites/kanban.e2e.js` L247-L265. The ORDER is
     * load-bearing and is preserved: the board is scrolled fully right FIRST
     * (L254) and only then is the drag performed (L256). The archived rail is
     * the rightmost column and is off-screen at the default scroll position, and
     * a real pointer — unlike the incumbent's fabricated events — can only be
     * placed at coordinates inside the viewport.
     *
     * The destination is the last status column, on the same basis as
     * {@link expandArchivedColumn}: `getColumns().last()` is how the retired
     * suite reached it (L252).
     *
     * Note that the archived column is normally FOLDED, which hides its cards
     * (`kanban-table.scss` L75-L78). The outcome assertion counts DOM
     * membership rather than visibility, so it holds either way.
     *
     * @param fromColumn - zero-based source index over {@link statusColumns}
     * @param cardIndex - zero-based card index within the source column
     * @throws if the source card carries no `data-id`, or if it is not in the
     *   archived column once the drop has settled
     */
    async dragCardToArchived(
        fromColumn: number,
        cardIndex: number,
    ): Promise<void> {
        await this.scrollRight();

        const source = this.cardsInColumn(fromColumn).nth(cardIndex);
        const userStoryId = await requireCardId(source);
        const target = this.statusColumns().last();

        await dndKitDrag(this.page, source, target, {
            offsetY: CARD_DROP_OFFSET_Y,
        });

        await expect(target.locator(cardIdSelector(userStoryId))).toHaveCount(1);
    }

    /* -------------------------------------------------------------------
     * Internals
     * ---------------------------------------------------------------- */

    /**
     * The kanban screen shell, `section.main.kanban` (`kanban.jade` L17).
     *
     * Used to scope the toolbar lookups, because `.e2e-open-filter` and
     * `tg-input-search` are shared markup that four screens render
     * (`issues.jade` L25, `kanban.jade` L22, `taskboard.jade` L38,
     * `backlog.jade` L54) — scoping keeps the selector honest even though only
     * one screen is mounted at a time.
     */
    private screenRoot(): Locator {
        return this.page.locator(SCREEN_SELECTOR);
    }

    /**
     * Waits for a lightbox to be open.
     *
     * Reproduces `e2e/utils/lightbox.js` L28-L48: the whole-token `open` class
     * within 4000 ms, then the transition settle the helper also performed
     * (L12, L39). The fixed part is kept because the lightbox slide is a CSS
     * transition on an element whose state has already changed, so there is no
     * further application-level condition to wait for.
     *
     * @param lightbox - the lightbox host to observe
     */
    private async waitLightboxOpen(lightbox: Locator): Promise<void> {
        await expect(lightbox).toHaveClass(
            classTokenPattern(LIGHTBOX_OPEN_CLASS),
            { timeout: LIGHTBOX_TIMEOUT_MS },
        );

        await this.page.waitForTimeout(LIGHTBOX_TRANSITION_MS);
    }
}

/**
 * Reads a card's user-story id, insisting that it has one.
 *
 * `kanban-table.jade` L151 and L227 put `data-id` on every card, so a card
 * without one means the markup contract this whole file depends on has changed.
 * Failing here says so, instead of letting a drag "succeed" with nothing
 * checkable about where the card went.
 *
 * @param card - a `tg-card` locator
 * @throws if the attribute is missing or blank
 */
async function requireCardId(card: Locator): Promise<string> {
    const userStoryId = await card.getAttribute(CARD_ID_ATTRIBUTE);

    if (userStoryId === null || userStoryId.trim() === '') {
        throw new Error(
            `KanbanPage: the card carries no "${CARD_ID_ATTRIBUTE}"; ` +
                'the board markup no longer matches kanban-table.jade L151/L227.',
        );
    }

    return userStoryId;
}

/**
 * Trims a possibly-absent DOM string, preserving the distinction between
 * "absent" and "present but empty" as `null` versus `''`.
 *
 * Both `textContent()` and `getAttribute()` are typed `string | null`, and the
 * markup indents its interpolations, so every read of either needs the same two
 * lines. Collecting them here keeps {@link KanbanPage.assignedName} readable.
 *
 * @param value - the raw DOM value
 */
function normaliseText(value: string | null): string | null {
    return value === null ? null : value.trim();
}

