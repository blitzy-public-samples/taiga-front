/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { memo } from 'react';
import type { ReactElement, Ref } from 'react';

import type { TranslateFn } from '../bridge/useTranslate';
import { Svg } from '../shared/Svg';

/* ==========================================================================
 * KanbanToolbar.tsx -- the Kanban board's toolbar row and its filter panel
 * ==========================================================================
 *
 * The React replacement for two adjacent blocks of `app/partials/kanban/kanban.jade`:
 * the `.taskboard-actions` subtree at L20-L46, and the `.kanban-filter` subtree at
 * L49-L62. Nothing else. Both are reproduced class-for-class so the existing,
 * UNEDITED stylesheets keep applying (rule T1).
 *
 * 1. WHAT THIS FILE OWNS, AND WHAT IT DELIBERATELY DOES NOT (T9)
 * --------------------------------------------------------------
 * Ownership is split with `./KanbanBoard.tsx`, and the split is not negotiable
 * because the two halves interlock in one DOM tree:
 *
 *   THIS FILE  ->  `.taskboard-actions`, `.kanban-table-options-start`,
 *                  `.kanban-table-options-end`,
 *                  `button.btn-filter.e2e-open-filter` (+ `active`),
 *                  `span.text`, `span.selected-filters`, the `icon-filters` icon,
 *                  and `.kanban-filter`.
 *
 *   KanbanBoard ->  `.kanban-header`, `.kanban-manager` (+ `expanded`) and
 *                  `.kanban-table`.
 *
 *   THE JADE   ->  `section.main.kanban` and the out-of-scope `mainTitle` include
 *                  (27 consumers repository-wide).
 *
 * The invariant that matters is the DOM ANCESTOR CHAIN, whichever side of the
 * AngularJS/React seam each element happens to be authored on:
 *
 *   .kanban > .kanban-header  > .taskboard-actions > .kanban-table-options-start
 *   .kanban > .kanban-manager > (.kanban-filter , .kanban-table)
 *
 * Each of those elements must exist EXACTLY ONCE in the final DOM. That is why
 * this file renders neither `.kanban-header` nor `.kanban-manager`: emitting them
 * here would duplicate them, and `layout/kanban.scss` L36-L48 makes
 * `.kanban-manager` a two-column grid (`minmax(180px, 2fr) 10fr`, collapsing to a
 * single `10fr` under `.expanded`) whose first column is the filter panel and
 * whose second is the board -- a duplicate would silently produce a second,
 * empty grid.
 *
 * 2. STATE VERIFIED IN THE DESTINATION-BRANCH JADE (T9)
 * -----------------------------------------------------
 * At the time this file was written, `app/partials/kanban/kanban.jade` on the
 * destination branch was byte-identical to its source-branch form: 69 lines, with
 * all three AngularJS components still present -- `tg-input-search` at L38-L41,
 * `tg-kanban-board-zoom` at L44-L46 and `tg-filter` at L52-L62 -- and with no
 * React host element yet. The partial is separately scheduled for update.
 *
 * This file is written so that BOTH outcomes work, because it never renders those
 * three components and never assumes who does:
 *
 *   - if the Jade keeps them, they are rendered by AngularJS outside the React
 *     tree and the host containers below simply stay empty;
 *   - if the Jade drops them, the OWNER of this component fills the host
 *     containers through the forwarded refs -- for example by handing the node to
 *     `$compile` -- without this file changing at all.
 *
 * That is exactly why the three host refs are optional props rather than required
 * ones, and why the hosts are rendered unconditionally: the slot always exists,
 * and its occupant is somebody else's decision.
 *
 * 3. THE THREE HOSTED ANGULARJS COMPONENTS ARE NEVER REIMPLEMENTED (T9)
 * ---------------------------------------------------------------------
 * `tg-input-search`, `tg-kanban-board-zoom` and `tg-filter` are existing shared
 * AngularJS components (`app/modules/components/input-search/`,
 * `kanban-board-zoom/`, `filter/`). They are HOSTED, never rebuilt and never
 * modified. Three consequences are load-bearing:
 *
 *   a. Those three tag names must NEVER be emitted as JSX. They are deliberately
 *      absent from `app/react/jsx-intrinsic-elements.d.ts` -- which declares only
 *      `tg-svg` and `tg-card` -- so writing one would be a type error rather than
 *      a silent success. That file is must-not-modify.
 *   b. Nothing may be substituted for them either. There is no third-party UI
 *      library in this project and none may be introduced; the governing design
 *      system is the proprietary in-repo Taiga Sass system.
 *   c. The stylesheet rules that target them are DESCENDANT selectors, not
 *      child selectors:
 *          `layout/kanban.scss` L84  ->  `.kanban-table-options-start tg-input-search`
 *          `layout/kanban.scss` L50  ->  `.kanban-filter tg-filter`
 *      so an interposed host wrapper does not break either rule at any depth.
 *      Nobody needs to "fix" this by inlining the tags.
 *
 * 4. COORDINATION NOTE FOR THE `app/react` ROOT AGENT -- NOT THIS FILE'S CODE
 * ---------------------------------------------------------------------------
 * An interposed host box is layout-neutral for the CASCADE (point 3c) but not
 * automatically for the LAYOUT, and the failure mode is specific enough to be
 * worth naming precisely:
 *
 *   `.kanban-table-options-start` is `display: flex` (`layout/kanban.scss`
 *   L80-L83), so today `tg-input-search` is a FLEX ITEM and is therefore
 *   blockified -- which is the only reason `width: 185px` at L86 applies to it at
 *   all. Placed inside a host `<div>` it stops being a flex item, falls back to
 *   the `display: inline` default of an unknown element, and `width` no longer
 *   applies to a non-replaced inline box: the 185 px field collapses to its
 *   intrinsic width.
 *
 * The remedy is `display: contents` on the host, which drops the host's own box
 * and promotes its child back to flex item -- restoring the width while leaving
 * both descendant selectors, the refs and any `$compile` target intact. That rule
 * belongs to the `app/react` ROOT agent, the same agent that owns the
 * `display: contents` rule for `tg-react-loader`; T8 forbids this file from
 * authoring any `.scss`, so the need is published here instead of acted on.
 *
 * The host containers carry NO class and NO data attribute, because T1 permits
 * exactly the nine class names listed in point 1 and nothing added. The selectors
 * available to that agent are therefore purely structural, and need no new class:
 *
 *      .kanban-table-options-start > div { display: contents; }
 *      .kanban-table-options-end   > div { display: contents; }
 *      .kanban-filter              > div { display: contents; }
 *
 * 5. PRESERVED QUIRKS -- REPRODUCE, DO NOT REPAIR (T10)
 * -----------------------------------------------------
 * DRIFT D9 -- `layout/kanban.scss` L70 styles `.button-filter`, while the markup
 * has always emitted `button.btn-filter`. That rule is therefore DEAD, and it
 * stays dead: this file emits only `btn-filter`. Adding the second spelling would
 * switch on a rule that has never fired and change the rendering; editing the
 * stylesheet is forbidden outright by T1. The button's live styling comes from
 * `.btn-filter` in `app/styles/components/buttons-next.scss` L150-L176 -- which is
 * also where `.selected-filters` and the `& tg-svg { margin-right: .25rem }` gap
 * are defined, both as descendants of `.btn-filter`, so the markup below satisfies
 * them with zero edits.
 *
 * The dead spelling appears in this file ONLY inside these comments, because T9
 * requires D9 to be documented at the point of change and the drift cannot be
 * named without naming the class. It is never emitted. Verify with:
 *
 *     grep -n 'button-filter' KanbanToolbar.tsx | grep -v '^[0-9]*: *\*'
 *
 * which must return nothing -- i.e. every occurrence is a comment line.
 *
 * The `customFilters="ctl.customFilters"` attribute at `kanban.jade` L56 -- `ctl`,
 * not `ctrl` -- is a PRE-EXISTING typo. It lives in the Jade, out of this file's
 * reach, and must not be fixed: no `ctl` alias is introduced here, and nothing in
 * this file writes `tg-filter` attributes.
 *
 * `e2e-open-filter` is a Protractor hook. It is kept because the incumbent
 * end-to-end suite and the new Playwright specs both key off it.
 *
 * The translation keys really are `BACKLOG.FILTERS.TITLE` and
 * `BACKLOG.FILTERS.HIDE_TITLE` on the KANBAN screen -- shared with the backlog
 * toolbar, rendering "Filters" and "Hide filters". They are not corrected to a
 * `KANBAN.` prefix.
 *
 * The open/closed flag is named `openFilter` here because that is the Kanban
 * controller's own name for it (`ng-click="ctrl.openFilter = !ctrl.openFilter"`).
 * The Backlog screen calls its equivalent `activeFilters`. The two names are NOT
 * unified: each screen keeps the name its controller uses.
 *
 * 6. WHAT STAYS ON THE ANGULARJS SIDE (T5 / I7 / I9)
 * ---------------------------------------------------
 * Every callback the source binds onto the three hosted components remains theirs.
 * `tg-input-search` binds `q="ctrl.filterQ" change="ctrl.changeQ(q)"` -- and
 * `changeQ` takes exactly ONE argument. `tg-kanban-board-zoom` binds
 * `on-zoom-change="ctrl.setZoom(zoomLevel, zoom)"` -- and `setZoom` takes exactly
 * TWO, in that order. `tg-filter` binds nine attributes including the five
 * `FiltersMixin` callbacks. None of that is reproduced here, so none of it can
 * drift here.
 *
 * This component is consequently PURE: no hook other than `memo`, no state, no
 * effect, no ref of its own, no AngularJS service, no HTTP, no persistence, no
 * realtime, no digest. That is what lets it be asserted in jsdom with no browser
 * and no injector, and it is the presentational half of the split that requirement
 * I9's coverage gate depends on.
 *
 * 7. FIGMA (node `1:7`) -- WHY THIS FILE AUTHORS NO STYLE AT ALL
 * --------------------------------------------------------------
 * Every value measured in the frame's toolbar band is already produced by the
 * unedited class contract, so emitting the source class names is both necessary
 * and sufficient -- and authoring a rule that already applies would be a
 * compliance violation rather than an improvement:
 *
 *   measured 1688 x 34 band with NO surface of its own  ->  `.taskboard-actions`
 *       (`display: flex; justify-content: space-between; width: 100%`, L59-L64),
 *       whose height is simply its tallest child's;
 *   measured symmetric 16 px page gutters  ->  `.kanban { padding: 1rem 0 0 1rem }`
 *       L7 plus `.kanban-header { padding: 0 1rem 1rem 0 }` L68;
 *   measured 77 x 34 button, fill #F9F9FB, teal label, 8 px side padding  ->
 *       `.btn-filter` (`background-color: $color-gray100` = #F9F9FB,
 *        `color: $color-link-primary` = #008AA8, `padding: .5rem .5rem` = 8 px);
 *   measured icon-to-label gap of 5 px  ->  the `& tg-svg { margin-right: .25rem }`
 *       nested in the same `.btn-filter` block (4 px plus the glyph's own right
 *       side-bearing);
 *   measured 8 px button-to-search gap and 185 px field  ->
 *       `.kanban-table-options-start tg-input-search { margin-left: .5rem; width: 185px }`
 *       L84-L87.
 *
 * Hence: no inline style, no colour literal, no `.scss` anywhere. The frame also
 * records the RESTING state -- filter panel closed, no count badge, no hover or
 * focus treatment -- which is exactly what this component renders for
 * `openFilter: false` with a zero count. The frame contains exactly seven ink
 * regions in that band and nothing else, so no sort control, view switcher,
 * saved-filter chip, results count, clear-filters link, overflow menu or
 * disclosure caret may be added: their absence is measured, not merely
 * unmentioned.
 *
 * The frame is a single FLATTENED RASTER SCREENSHOT with no vector, text,
 * component, variant, Style or Variable nodes, so design tokens come from
 * `app/themes/taiga/variables.scss` and never from Figma structure. Its byte-
 * verified in-repo equivalent is `design-reference/kanban-screen.png` at the
 * PARENT repository root (1920 x 1900, 194,796 bytes, md5
 * e30bee0663b8d5aa26555478279659ae) -- read it, never re-download it, and never
 * overwrite it with the frame RENDER, which is a 1940 x 1920 size variant carrying
 * a 10 px canvas inset that is Figma framing rather than UI (drifts D1 and D2).
 *
 * 8. RUNTIME EQUIVALENCE, MEASURED -- WHY THE FRAME'S 2 px IS NOT A DEFECT
 * ------------------------------------------------------------------------
 * Comparing this component's render against the frame produced nine informational
 * geometry deltas from exactly two root causes: the button measured 32 px tall
 * where the frame reads 34, and the label advance measured 39.86 px where the
 * frame reads 41. Neither is a defect, and the question was settled by measurement
 * rather than argument.
 *
 * The LIVE, un-migrated AngularJS button was measured in the same browser at the
 * same 1920 x 1200 viewport and deviceScaleFactor 1. It is 75.859375 x 32. This
 * component renders 75.859375 x 32. They are the same size, and both budgets close
 * with nothing unexplained: height 0 + 8 + 16 + 8 + 0 = 32, and width
 * 8 + 16 + 4 + 39.859375 + 8 = 75.859375, where 39.859375 is Ubuntu-Regular's own
 * advance for the string "Filters" (Arial would give 38.125, so the web font
 * really is the one in use). `line-height: normal` on Ubuntu-Regular at 14 px
 * yields a 16 px line box, and no font in the declared fallback chain yields the
 * 18 px that a 34 px button would require.
 *
 * The frame's larger figures are therefore inflation from a resampled reference
 * raster -- unsurprising for a box whose edge contrast is only about 6/255,
 * #F9F9FB on #FFFFFF -- and NOT a difference in behaviour. No change is warranted:
 * altering this component to chase the frame would break the very equivalence with
 * the AngularJS original that goal G1 and rule T10 require, which is why the CSS
 * padding stays 8 px on all four sides.
 *
 * Two candidate explanations were tested and both are refuted, recorded here so
 * they are not re-proposed. First, a whitespace text node between the icon and the
 * label: the live DOM has only a comment node there (an `ng-if` anchor), and
 * inserting the hypothesised node into a clone of the live button changed its size
 * by nothing at all -- because `.btn-filter` computes to `display: flex`, and a
 * flex container does not render whitespace-only child text runs. Reducing that
 * clone to exactly the two children JSX emits also left it at 75.859375 x 32.
 * Second, the 33 px search sibling stretching the button: `align-items: center`
 * never changes a flex item's height, and the frame's own button is taller than
 * its own search input, so the causality runs the wrong way. Independent
 * corroboration of the raster inflation: the live `tg-input-search` is 31.59 px
 * tall where the frame reads about 33 -- the same ~1.4 px on an element this file
 * does not render at all.
 *
 * 9. TWO BUILD-TIME FACTS DISCOVERED WHILE VALIDATING (T9)
 * --------------------------------------------------------
 * `gulpfile.js` L273 pipes `replace(/e2e-([a-z\-]+)/g, '')` over `paths.htmlPartials`
 * inside the `template-cache` task, so a DEPLOY build strips every `e2e-*` token out
 * of the Jade-compiled partials: the live button's class attribute is literally
 * "btn-filter " with a trailing space, and `e2e-open-filter` is absent. That pipe
 * never sees this file, because TSX is bundled separately from the template cache,
 * so React keeps `e2e-open-filter` in every build. Keeping it is required by T1 and
 * by the hook's own purpose, and it makes the selector more dependable on the React
 * side than it currently is on the AngularJS side -- but whoever writes the
 * `e2e-react/` specs should know that a `.e2e-open-filter` selector matches only
 * migrated markup in a deploy build.
 *
 * The 4 px icon-to-label gap comes from `& tg-svg { margin-right: .25rem }` nested
 * inside `.btn-filter` at `app/styles/components/buttons-next.scss` L161-L163 -- a
 * DESCENDANT rule that requires a `tg-svg` element to exist -- while the wrapper's
 * own centring comes from the global `tg-svg` rule at `app/styles/core/base.scss`
 * L50-L54. `../shared/Svg` emits that wrapper and, when given no `className`, omits
 * the `class` attribute entirely, which is exactly what the live DOM does. An `Svg`
 * that ever dropped the wrapper would silently narrow this button by 4 px.
 */

/* ==========================================================================
 * CONSTANTS
 *
 * Module scope so the strings appear exactly once, cannot drift between the two
 * `span.text` variants, and are greppable from a locale file.
 * ========================================================================== */

/**
 * The sprite symbol id, selected BY ID rather than by visual description (rule T3).
 *
 * `app/svg/sprite.svg` defines `icon-filters` as a three-vertical-bar "tune"
 * glyph, each bar carrying a horizontal knob at a different height. Two
 * near-neighbours exist in the same sprite and are NOT interchangeable with it:
 * `icon-filter` (singular, the backlog toolbar's glyph) and `icon-filters-empty`.
 */
const FILTERS_ICON = 'icon-filters';

/** Renders "Filters" -- the label shown while the filter panel is CLOSED. */
const FILTERS_TITLE_KEY = 'BACKLOG.FILTERS.TITLE';

/** Renders "Hide filters" -- the label shown while the filter panel is OPEN. */
const FILTERS_HIDE_TITLE_KEY = 'BACKLOG.FILTERS.HIDE_TITLE';

/**
 * Renders "filters applied" -- the SECOND half of the button's `title`, whose
 * first half is the selected-filter count. See {@link UnmemoizedKanbanToolbar}.
 */
const APPLIED_FILTERS_NUM_KEY = 'COMMON.FILTERS.APPLIED_FILTERS_NUM';

/* ==========================================================================
 * PROPS
 * ========================================================================== */

interface KanbanToolbarProps {
    /**
     * Whether the filter panel is open, mirroring `ctrl.openFilter`.
     *
     * Drives two things and only two: the button's `active` class, and which of
     * the two mutually exclusive `span.text` labels is mounted. It deliberately
     * does NOT gate the filter panel itself -- see {@link KanbanFilterPanel},
     * which the owner mounts conditionally exactly as `ng-if` does.
     */
    readonly openFilter: boolean;

    /**
     * `ctrl.selectedFilters.length`, already reduced to a number at the seam.
     *
     * The count rather than the array, because this component needs nothing else
     * from it and a number cannot be mutated underneath a memoised component.
     */
    readonly selectedFiltersCount: number;

    /**
     * Toggles {@link openFilter}. The parent owns the flag.
     *
     * The source is `ng-click="ctrl.openFilter = !ctrl.openFilter"` -- a direct
     * scope assignment, i.e. the state lives on the controller and the button only
     * asks for it to flip. Nothing is toggled locally here, so the AngularJS half
     * of the screen (which still styles `.kanban-manager` from the same flag) can
     * never disagree with the React half.
     */
    readonly onToggleFilter: () => void;

    /**
     * The OWNER'S translator, used for the two labels and the `title` attribute.
     *
     * INJECTED, NOT RESOLVED HERE -- and the reason is the same one documented at
     * length in `../shared/Svg` and `./ArchivedColumn`. `useTranslate` reaches the
     * AngularJS `$translate` service and a root-scope listener through the bridge
     * injector, and THROWS when no provider is mounted above it. Calling it here
     * would give a presentational component a latent AngularJS provider
     * requirement and stop it being renderable as a pure function of its props,
     * breaking exactly the presentational/container split requirement I9's
     * coverage gate depends on. The screen that mounts the board already holds a
     * translator; it passes it down.
     *
     * REQUIRED, unlike `Svg`'s optional one, because these strings are not
     * optional: an unresolved key would render the button as the literal text
     * "BACKLOG.FILTERS.TITLE" and its tooltip as "3 COMMON.FILTERS.APPLIED_FILTERS_NUM".
     * A required prop turns that into a compile error at the call site instead of a
     * silent visual regression.
     */
    readonly translate: TranslateFn;

    /**
     * Ref to the EMPTY host container that stands in for `tg-input-search`.
     *
     * Optional because who fills it is the owner's decision, not this file's --
     * see section 2 of the file header. The container is rendered either way, as
     * the second child of `.kanban-table-options-start`, immediately after the
     * Filters button, which is precisely where the source puts the search field.
     */
    readonly searchHostRef?: Ref<HTMLDivElement>;

    /**
     * Ref to the EMPTY host container that stands in for `tg-kanban-board-zoom`.
     *
     * Rendered as the ONLY child of `.kanban-table-options-end`, matching the
     * source. Optional for the same reason as {@link searchHostRef}.
     */
    readonly zoomHostRef?: Ref<HTMLDivElement>;
}

interface KanbanFilterPanelProps {
    /**
     * Ref to the EMPTY host container that stands in for `tg-filter`.
     *
     * Rendered as the only child of `.kanban-filter`. Optional for the same
     * reason as {@link KanbanToolbarProps.searchHostRef}.
     */
    readonly filterHostRef?: Ref<HTMLDivElement>;
}

/* ==========================================================================
 * COMPONENTS
 * ========================================================================== */

/**
 * `.taskboard-actions` and its subtree -- `kanban.jade` L20-L46.
 *
 * Memoised at the bottom of the file; this is the unmemoised render function.
 * A pure function of its props with no hook of any kind, no state, no effect and
 * no service (section 6 of the file header).
 *
 * The rendered shape is exactly:
 *
 * ```html
 * <div class="taskboard-actions">
 *     <div class="kanban-table-options-start">
 *         <button class="btn-filter e2e-open-filter" title="3 filters applied">
 *             <tg-svg><svg class="icon icon-filters">…</svg></tg-svg>
 *             <span class="text">Filters</span>
 *             <span class="selected-filters">3</span>
 *         </button>
 *         <div><!-- tg-input-search host --></div>
 *     </div>
 *     <div class="kanban-table-options-end">
 *         <div><!-- tg-kanban-board-zoom host --></div>
 *     </div>
 * </div>
 * ```
 */
function UnmemoizedKanbanToolbar({
    openFilter,
    selectedFiltersCount,
    onToggleFilter,
    translate,
    searchHostRef,
    zoomHostRef,
}: KanbanToolbarProps): ReactElement {
    /*
     * The source's `title` is an interpolated CONCATENATION, not a single key:
     *
     * title="{{ctrl.selectedFilters.length}} {{'COMMON.FILTERS.APPLIED_FILTERS_NUM' | translate}}"
     *
     * so both halves and the single literal space between them are reproduced
     * here, giving "0 filters applied" / "3 filters applied". The count is
     * deliberately NOT folded into the translation as an interpolation parameter:
     * that would change the shipped locale contract, and the key's value really is
     * the bare phrase "filters applied" with no placeholder in it.
     *
     * `selectedFiltersCount` is a required `number`, so the template literal can
     * never stringify to "undefined" the way the AngularJS interpolation would for
     * an unset scope value.
     */
    const appliedFiltersTitle = `${selectedFiltersCount} ${translate(APPLIED_FILTERS_NUM_KEY)}`;

    /*
     * `ng-class="{active: ctrl.openFilter}"` appends its result AFTER the static
     * classes, so the open button's attribute reads exactly
     * "btn-filter e2e-open-filter active" and the closed one omits the third token
     * entirely rather than carrying an empty slot.
     *
     * Built by hand because HR-2 closes the dependency set at fifteen packages:
     * no class-name helper library may be added for a two-branch string.
     *
     * `btn-filter`, never the dead spelling -- see DRIFT D9 in section 5 of the
     * file header.
     */
    const buttonClassName = openFilter
        ? 'btn-filter e2e-open-filter active'
        : 'btn-filter e2e-open-filter';

    return (
        <div className="taskboard-actions">
            <div className="kanban-table-options-start">
                {/*
                 * No `type="button"` and no ARIA: the source markup has neither,
                 * and T10 licenses layout fidelity only -- not an accessibility
                 * addition the incumbent lacks. `aria-pressed` / `aria-expanded`
                 * would be exactly such an addition, and the button is already
                 * keyboard-operable because it is a real `<button>`.
                 */}
                <button
                    className={buttonClassName}
                    title={appliedFiltersTitle}
                    /*
                     * Wrapped rather than passed straight through, and the wrapper
                     * is load-bearing: react-dom hands every `onClick` handler a
                     * synthetic mouse event as its first argument, so
                     * `onClick={onToggleFilter}` would invoke a callback whose
                     * declared type is `() => void` WITH an argument. TypeScript
                     * permits that silently -- a shorter parameter list is
                     * assignable to a longer one -- and the source passes nothing at
                     * all (`ng-click="ctrl.openFilter = !ctrl.openFilter"`), so the
                     * event has to be dropped here to honour both the contract and
                     * the incumbent behaviour. It also removes a real hazard: a
                     * parent that passes a state setter directly would otherwise
                     * store the event object instead of toggling.
                     *
                     * An inline arrow rather than `useCallback`, to keep this
                     * component free of every hook (section 6 of the file header).
                     * Its changing identity costs nothing: the consumer is a plain
                     * DOM element, not a memoised child.
                     */
                    onClick={(): void => {
                        onToggleFilter();
                    }}
                >
                    {/*
                     * `tg-svg(svg-icon="icon-filters")` carries NO class in the
                     * source, so `className` is left off entirely -- `../shared/Svg`
                     * then emits `<tg-svg>` with no `class` attribute at all,
                     * rather than an empty one. `.btn-filter & tg-svg` supplies the
                     * icon-to-label gap, which is why the element name has to
                     * survive into the React markup (rule T1).
                     *
                     * No `svgTitle` / `svgTitleTranslate` either: the source passes
                     * neither, so no `<title>` child is emitted and this call needs
                     * no translator of its own.
                     */}
                    <Svg svgIcon={FILTERS_ICON} />
                    {/*
                     * Two SEPARATE conditionals rather than one ternary, mirroring
                     * the source's two independent `ng-if` elements element-for-
                     * element. The pair is mutually exclusive by construction, so
                     * exactly one `span.text` is mounted for either value of
                     * `openFilter` -- never both, never zero.
                     */}
                    {openFilter ? null : (
                        <span className="text">{translate(FILTERS_TITLE_KEY)}</span>
                    )}
                    {openFilter ? (
                        <span className="text">{translate(FILTERS_HIDE_TITLE_KEY)}</span>
                    ) : null}
                    {/*
                     * `ng-if="ctrl.selectedFilters.length"` gates on the count's
                     * TRUTHINESS, so a zero count mounts nothing at all and the
                     * badge only ever appears with at least one filter applied --
                     * which is why the resting frame shows no badge.
                     *
                     * An explicit ternary with a `null` alternative, NOT
                     * `selectedFiltersCount && <span/>`: the `&&` form would return
                     * the number `0` on the falsy branch and React would render the
                     * character "0" inside the button, which is both a visual
                     * regression and the exact opposite of hiding the badge.
                     *
                     * The element's text content IS the count, as in the source.
                     */}
                    {selectedFiltersCount ? (
                        <span className="selected-filters">{selectedFiltersCount}</span>
                    ) : null}
                </button>
                {/*
                 * HOST for `tg-input-search` -- a sibling of the button, second
                 * child of `.kanban-table-options-start`, exactly as at
                 * `kanban.jade` L38-L41. Left EMPTY on purpose (sections 2-4 of the
                 * file header): this file never renders that component, never emits
                 * its tag name, and never binds its `q` / `change` attributes.
                 *
                 * No class and no data attribute -- T1 permits nothing added, and a
                 * bare `<div>` cannot pick up a rule meant for something else.
                 */}
                <div ref={searchHostRef} />
            </div>
            <div className="kanban-table-options-end">
                {/*
                 * HOST for `tg-kanban-board-zoom` -- the ONLY child, as at
                 * `kanban.jade` L44-L46. Its `on-zoom-change="ctrl.setZoom(zoomLevel, zoom)"`
                 * binding stays on the AngularJS side, TWO arguments and their order
                 * intact (section 6 of the file header).
                 *
                 * `.kanban-table-options-end` has no stylesheet rule of its own
                 * anywhere; it is positioned solely by `.taskboard-actions`'
                 * `justify-content: space-between`, which is what right-anchors the
                 * zoom control in the frame.
                 */}
                <div ref={zoomHostRef} />
            </div>
        </div>
    );
}

/**
 * `.kanban-filter` and its subtree -- `kanban.jade` L49-L62.
 *
 * A SECOND export rather than part of the toolbar, because the source puts the two
 * in different parents: the toolbar lives in `.kanban-header`, while the panel is
 * the first grid column of `.kanban-manager`, alongside the board. Merging them
 * would move the panel out of the grid and break the
 * `minmax(180px, 2fr) 10fr` -> `10fr` collapse that `.expanded` performs.
 *
 * MOUNTING IS THE OWNER'S JOB, reproducing `ng-if="ctrl.openFilter"` at L50: this
 * component renders its subtree unconditionally and takes no `openFilter` prop, so
 * the owner mounts it only while the panel is open and the closed state leaves
 * `.kanban-filter` absent from the DOM entirely -- which is what the resting frame
 * shows, and what lets `.kanban-manager.expanded` collapse to a single column.
 *
 * The rendered shape is exactly:
 *
 * ```html
 * <div class="kanban-filter">
 *     <div><!-- tg-filter host --></div>
 * </div>
 * ```
 */
function UnmemoizedKanbanFilterPanel({ filterHostRef }: KanbanFilterPanelProps): ReactElement {
    return (
        <div className="kanban-filter">
            {/*
             * HOST for `tg-filter`. Left EMPTY: this file renders none of the nine
             * attributes the source binds -- including the pre-existing
             * `customFilters="ctl.customFilters"` typo at L56, which stays exactly
             * as it is in the Jade and is never "corrected" here (section 5 of the
             * file header).
             *
             * `.kanban-filter tg-filter` (L50) is a DESCENDANT selector, so this
             * wrapper does not stop the panel's border and padding from applying to
             * whatever AngularJS puts inside.
             */}
            <div ref={filterHostRef} />
        </div>
    );
}

/* ==========================================================================
 * EXPORTS
 *
 * Two named exports and no default, matching the folder's convention and the
 * registry-style imports used across `app/react`. `export type` for the prop
 * interfaces because `isolatedModules` is on and a value-position re-export of a
 * type would not survive transpilation.
 *
 * Both are memoised: every prop is a primitive, a stable callback or a ref, so
 * reference equality on the props object is a genuine render skip rather than a
 * wasted comparison -- and the toolbar re-renders today on every board state
 * change that reaches its parent.
 * ========================================================================== */

const KanbanToolbar = memo(UnmemoizedKanbanToolbar);
KanbanToolbar.displayName = 'KanbanToolbar';

const KanbanFilterPanel = memo(UnmemoizedKanbanFilterPanel);
KanbanFilterPanel.displayName = 'KanbanFilterPanel';

export { KanbanToolbar, KanbanFilterPanel };
export type { KanbanToolbarProps, KanbanFilterPanelProps };
