/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * BacklogToolbar.tsx -- the filter / options row of the Backlog screen.
 * ==========================================================================
 *
 * 1. WHAT THIS REPLACES (technology-specific change, migration seam)
 * -----------------------------------------------------------------
 * This component renders the `.backlog-table-options` region of
 * `app/partials/backlog/backlog.jade:52`-`:122` -- the Filters button, the
 * search box, the tags switch, the two move-to-sprint buttons and the two
 * velocity-forecasting buttons. In the incumbent screen that markup was static
 * Jade wired up imperatively by `linkToolbar` in
 * `app/coffee/modules/backlog/main.coffee:803`-`:928`, which attached delegated
 * jQuery handlers to it, plus `showHideTags` (`:930`-`:942`), `showHideFilter`
 * (`:951`-`:959`) and `linkFilters` (`:963`-`:968`).
 *
 * It is PURELY PRESENTATIONAL, which requirement I9's coverage gate depends on:
 * it fetches nothing, mutates nothing, subscribes to nothing, reads no
 * permission of its own, and touches no AngularJS service other than the
 * translator. Every decision it renders arrives as a prop and every action it
 * offers leaves as a callback, so the container -- `BacklogScreen.tsx` -- owns
 * all state and all service access. The one exception is documented in section 4
 * and is component-local view state in the AngularJS original too.
 *
 * `BacklogController` itself is RETAINED (`main.coffee:745`); only the rendering
 * layer moves. The retired directive this region belonged to is `tgBacklog`
 * (`main.coffee:756`).
 *
 * 2. WHY IT AUTHORS NO STYLESHEET (rules T1 and G-DS-4)
 * ----------------------------------------------------
 * Every visual property of this row already exists in stylesheets that must not
 * be edited, so the whole job here is to emit the same class names in the same
 * nesting and let those rules apply verbatim. Authoring a flex or grid rule that
 * an existing rule already provides would be a compliance violation, not an
 * improvement -- so this file ships with NO `.scss` whatsoever. Worked through,
 * against the design reference for this screen (Figma node `1:6`, whose measured
 * geometry is reproduced here by CSS alone):
 *
 *   - `app/styles/components/buttons-next.scss:150`-`:176` gives `.btn-filter`
 *     its `$color-gray100` fill, its `$color-link-primary` text, its padding,
 *     `text-transform: none` (so the labels stay mixed-case exactly as the
 *     locale stores them), the `.selected-filters` badge and the icon margin.
 *   - `app/styles/core/forms.scss:14`-`:28` gives `input[type='search']` its
 *     white fill, its 2 px `$color-gray400` border, its 3 px radius, its
 *     `.95rem` left inset and its half-opacity placeholder colour; `:46`-`:49`
 *     adds the right padding that keeps the placeholder clear of the icon.
 *   - `app/modules/components/input-search/input-search.component.scss` places
 *     the magnifier absolutely inside the field and fills it teal.
 *   - `app/styles/components/check.scss:1`-`:45` draws the whole switch: the
 *     32x18 pill, the 2 px ring, and -- only under `.active` -- the teal track
 *     with the white knob slid to the right.
 *   - `app/styles/layout/backlog.scss:92`-`:151` lays the row out and produces
 *     every gap in it: `1rem` after the Filters button (that rule out-specifies
 *     the `> *` rule below it), `.5rem` between the remaining children of
 *     `.backlog-table-options-start`, `.5rem` between the switch and its label,
 *     the 185 px search field, `display: none` on `.move-to-sprint`, and the
 *     `::first-letter` upper-casing that renders the locale's lower-case `tags`
 *     as `Tags`.
 *
 * Two consequences worth stating because they are easy to undo by accident.
 * First, T1 extends to ELEMENT NAMES here, not just class names: both
 * `input-search.component.scss` and `app/styles/layout/backlog.scss:127` select
 * on the `tg-input-search` tag, and the former also selects a nested `tg-svg`
 * tag, so those tags have to survive into the React markup. Second, the label
 * text must stay lower-case in the markup -- the capital `T` in the design
 * reference comes from the stylesheet, and hardcoding `Tags` would both be a
 * functional change and break locales that capitalise differently.
 *
 * 3. LIGHT DOM ONLY (requirement I6)
 * ----------------------------------
 * Nothing here attaches a shadow root. A shadow boundary would sever the global
 * cascade that section 2 depends on and would break `<use href="#icon-...">`
 * against the sprite inlined at `app/index.jade:96`, so the icons would vanish
 * and the row would render unstyled.
 *
 * 4. PRESERVED PRE-EXISTING BEHAVIOUR (rule T10)
 * ----------------------------------------------
 * Six details of the incumbent row are surprising enough to look like defects,
 * and every one of them is reproduced rather than corrected, because this
 * migration changes technology and not behaviour. Each is documented at its
 * point of change below: the imperatively-revealed move-to-sprint button, the
 * dead `#show-tags > input` handler, what `onToggleTags` therefore has to mean,
 * the swapped tooltip/label keys on the second velocity button, the `active`
 * class that is set twice on the Filters button, and `preventDefault` being
 * called on the Filters button alone.
 *
 * 5. TRANSLATION -- WHY THIS COMPONENT RESOLVES ITS OWN TRANSLATOR
 * ---------------------------------------------------------------
 * `useTranslate()` is called here, whereas the leaf components in this tree
 * (`../shared/Svg`, `../kanban/ArchivedColumn`, `./BurndownChart`) take a
 * `TranslateFn` as a prop. That difference is deliberate. `Svg.tsx`'s header
 * argues against a LEAF reaching into the bridge, for two reasons that do not
 * apply to a region: its translator is needed only when a caller happens to pass
 * a title key, so the provider requirement would be latent and would surface as
 * a crash in an unrelated spec; and satisfying the Rules of Hooks around that
 * conditional need cost it an extra component. This component resolves eight
 * keys unconditionally on every render, so there is nothing latent about its
 * requirement, and the hook is called once at the top with no conditionality to
 * work around. It is also mounted well inside the bridge provider that
 * `ReactHostElement` establishes for the screen root, so the injector is always
 * present. Keeping the eight keys internal keeps them out of the container's
 * prop surface, where they would be pure pass-through.
 * ========================================================================== */

import { createElement, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent, ReactElement } from 'react';

import { useTranslate } from '../bridge/useTranslate';
import { Svg } from '../shared/Svg';

/**
 * Everything the toolbar row needs in order to render, and every action it can
 * raise.
 *
 * Each field names the AngularJS expression it replaces, so the container has an
 * unambiguous mapping to build from. All of them are required: an absent
 * decision is not a meaningful state for this row, and a default would hide a
 * container bug instead of surfacing it. The single nullable is
 * {@link BacklogToolbarProps.velocitySpeed}, which is genuinely absent until the
 * project statistics have loaded.
 */
export interface BacklogToolbarProps {
    /**
     * `ctrl.activeFilters` -- whether the filter panel is open. Drives both the
     * `active` class on the Filters button and the swap between its two labels
     * (`app/partials/backlog/backlog.jade:56`, `:59`-`:66`).
     */
    readonly activeFilters: boolean;

    /**
     * `ctrl.selectedFilters.length`. Rendered inside `.selected-filters` only
     * when greater than zero (`backlog.jade:67`).
     */
    readonly selectedFilterCount: number;

    /**
     * `ctrl.filterQ` -- the current search term, reproducing the one-way
     * `q: '<'` binding of the `tgInputSearch` component
     * (`app/modules/components/input-search/input-search.component.coffee`).
     */
    readonly filterQ: string;

    /**
     * `ctrl.changeQ(q)` -- the `change: '&'` output of `tgInputSearch`. Raised on
     * every keystroke, exactly as `ng-change` did.
     */
    readonly onChangeQ: (q: string) => void;

    /**
     * `userstories.length`. Gates the tags switch (`backlog.jade:74`) and both
     * velocity-forecasting buttons (`:108`, `:117`).
     */
    readonly userStoryCount: number;

    /** `ctrl.showTags` -- whether story tags are shown in the table. */
    readonly showTags: boolean;

    /**
     * Raised when the user operates the tags switch. The container must FLIP
     * `showTags` and THEN persist the new value; see the note at the switch for
     * why that is one callback here and two steps in the incumbent.
     */
    readonly onToggleTags: () => void;

    /**
     * Truthiness of `currentSprint`, which selects WHICH move button renders --
     * "move to current sprint" when there is a current sprint
     * (`backlog.jade:93`), "move to latest sprint" when there is not (`:100`).
     */
    readonly hasCurrentSprint: boolean;

    /**
     * Whether the move button is revealed. Reproduces the condition in
     * `checkSelected` at `app/coffee/modules/backlog/main.coffee:863`:
     * `selectedUsDom.length > 0 and $scope.sprints.length > 0`. The container
     * computes it from its selection state and its count of OPEN sprints.
     */
    readonly moveToSprintVisible: boolean;

    /** `ctrl.displayVelocity` -- whether the forecasting view is showing. */
    readonly displayVelocity: boolean;

    /**
     * `stats.speed`. The second velocity button is gated on `stats.speed > 0`
     * (`backlog.jade:117`), and the statistics are not loaded on first render,
     * hence the nullability.
     */
    readonly velocitySpeed: number | null | undefined;

    /**
     * Whether `my_permissions` contains `add_milestone`, which the
     * `tg-check-permission` attribute evaluates on both velocity buttons
     * (`backlog.jade:111`, `:121`). Evaluated by the container, never here.
     */
    readonly canAddMilestone: boolean;

    /** `ctrl.toggleActiveFilters()` (`main.coffee:249`), reached through the click handler. */
    readonly onToggleFilters: () => void;

    /** Raised by `#move-to-current-sprint` (`main.coffee:901`-`:904`). */
    readonly onMoveToCurrentSprint: () => void;

    /** Raised by `#move-to-latest-sprint` (`main.coffee:896`-`:899`). */
    readonly onMoveToLatestSprint: () => void;

    /** `ctrl.toggleVelocityForecasting()` (`main.coffee:252`). */
    readonly onToggleVelocityForecasting: () => void;
}

/**
 * Renders the `.backlog-table-options` row of the Backlog / Sprint-Planning
 * screen.
 *
 * The emitted shape, which the unedited stylesheets of section 2 depend on, is:
 *
 * ```html
 * <div class="backlog-table-options">
 *     <div class="backlog-table-options-start">
 *         <button class="btn-filter e2e-open-filter ng-animate-disabled"
 *                 id="show-filters-button">…</button>
 *         <tg-input-search><input type="search"><tg-svg>…</tg-svg></tg-input-search>
 *         <div class="display-tags-button" id="show-tags">
 *             <div class="check js-check active">
 *                 <input type="checkbox" id="show-tags-input"><div></div>
 *             </div>
 *             <label for="show-tags-input">tags</label>
 *         </div>
 *     </div>
 *     <div class="backlog-table-options-end">…</div>
 * </div>
 * ```
 */
export function BacklogToolbar({
    activeFilters,
    selectedFilterCount,
    filterQ,
    onChangeQ,
    userStoryCount,
    showTags,
    onToggleTags,
    hasCurrentSprint,
    moveToSprintVisible,
    displayVelocity,
    velocitySpeed,
    canAddMilestone,
    onToggleFilters,
    onMoveToCurrentSprint,
    onMoveToLatestSprint,
    onToggleVelocityForecasting,
}: BacklogToolbarProps): ReactElement {
    const t = useTranslate();

    /*
     * The ONLY state in this file, and the only place it could honestly live.
     *
     * In the incumbent screen the search box is its own AngularJS component,
     * `tgInputSearch`, and `searchText` / `dirty` are members of ITS controller
     * rather than of `BacklogController`
     * (`app/modules/components/input-search/input-search.component.coffee`). So
     * this is component-local VIEW state on both sides of the migration, not
     * screen state that leaked downwards: the filter term itself stays owned by
     * the container and arrives as `filterQ`.
     */
    const [searchText, setSearchText] = useState<string>(filterQ);

    /*
     * ⭐ THE `dirty` LATCH -- a faithful translation of `$onChanges` + `@.dirty`.
     *
     * The incumbent controller starts `searchText` empty, copies the `q` binding
     * into it from `$onChanges` ONLY WHILE `dirty` is false, and sets `dirty` in
     * `onChange` before raising the output. The effect is that the field accepts
     * a value pushed in from outside until the user types once, and is the user's
     * own from then on -- so a re-broadcast of the same filter can never
     * overwrite what is being typed.
     *
     * Implemented as a render-phase state adjustment guarded by the PREVIOUS prop
     * value, which is React's documented pattern for reacting to a changed prop.
     * Deliberately NOT a `useEffect`: an effect would commit one render carrying
     * the stale text and then correct it, which is a visible flicker the
     * AngularJS version does not have. Refs rather than state because neither
     * value may schedule a render of its own -- `previousQRef` is updated before
     * the conditional `setSearchText`, so the immediate re-render sees the guard
     * already closed and the adjustment cannot repeat.
     */
    const dirtyRef = useRef<boolean>(false);
    const previousQRef = useRef<string>(filterQ);

    if (previousQRef.current !== filterQ) {
        previousQRef.current = filterQ;

        if (!dirtyRef.current) {
            setSearchText(filterQ);
        }
    }

    /*
     * ⭐ `preventDefault` HERE AND NOWHERE ELSE IN THIS ROW.
     *
     * The incumbent delegated handler for `#show-filters-button` calls it
     * (`app/coffee/modules/backlog/main.coffee:965`-`:968`), while the handlers
     * for the two move buttons (`:896`, `:901`) and the `ng-click` bindings on
     * the two velocity buttons do not. That asymmetry is preserved verbatim: it
     * is behaviour, and rule T10 admits no behaviour change, however incidental
     * it may look.
     */
    const handleFiltersClick = (event: MouseEvent<HTMLButtonElement>): void => {
        event.preventDefault();
        onToggleFilters();
    };

    const handleSearchChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const { value } = event.target;

        dirtyRef.current = true;
        setSearchText(value);
        onChangeQ(value);
    };

    /*
     * Class strings are composed by concatenation, in the incumbent's own order:
     * the static Jade classes first, then whatever `ng-class` would have
     * appended, then the permission gate's class last -- which is the order
     * AngularJS produces at run time, and therefore the order a reviewer
     * diffing the rendered DOM against the live screen will see. No class-name
     * helper library is used; requirement HR-2 closes the dependency set.
     */
    const filtersClassName = `btn-filter e2e-open-filter ng-animate-disabled${
        activeFilters ? ' active' : ''
    }`;

    /*
     * Both move buttons carry `.move-to-sprint` on top of the class that tells
     * them apart (`app/partials/backlog/backlog.jade:92` and `:99`), and that
     * shared class is load-bearing rather than decorative: it is what let the
     * single lookup `$el.find('.move-to-sprint')` in `checkSelected`
     * (`app/coffee/modules/backlog/main.coffee:860`) reach whichever of the two
     * happened to be rendered, and it is also what the `display: none` default
     * in `app/styles/layout/backlog.scss:104` selects. Hoisted so the pair
     * cannot drift apart.
     */
    const moveToSprintClasses = 'move-to-sprint e2e-move-to-sprint';
    const moveToCurrentClassName = `btn-filter move-to-current-sprint ${moveToSprintClasses}`;
    const moveToLatestClassName = `btn-filter move-to-latest-sprint ${moveToSprintClasses}`;

    /*
     * ⭐ `tg-check-permission` DOES NOT UNMOUNT -- IT TOGGLES A CLASS.
     *
     * The directive at `app/coffee/modules/common.coffee:87`-`:119` adds
     * `hidden` to the element on link and removes it again only when
     * `projectService.canEdit(permission)` passes
     * (`app/modules/services/project.service.coffee`), where `canEdit` is the
     * conjunction of "the project is not archived" and "the permission is
     * granted". So the element is always in the DOM and only its class changes,
     * and `app/styles/core/base.scss:142` supplies the `hidden` rule. React does
     * exactly the same rather than conditionally unmounting, so the rendered DOM
     * keeps the same shape and `:last-child` in
     * `app/styles/layout/backlog.scss:98`-`:100` keeps resolving to the same
     * button.
     */
    const permissionGate = canAddMilestone ? '' : ' hidden';

    /*
     * The two forecasting buttons share three classes and differ only in the
     * static `active` that the first one carries (`backlog.jade:107` versus
     * `:116`), so the shared run is hoisted the same way.
     */
    const velocityClasses = 'velocity-forecasting-btn ng-animate-disabled e2e-velocity-forecasting';
    const velocityReturnClassName = `btn-filter active ${velocityClasses}${permissionGate}`;
    const velocityEnterClassName = `btn-filter ${velocityClasses}${permissionGate}`;

    /*
     * ⭐ REVEALING THE MOVE BUTTON WITH AN INLINE `display`, NOT WITH A CLASS.
     *
     * `app/styles/layout/backlog.scss:104`-`:113` sets
     * `.btn-filter.move-to-sprint { display: none }`, and its `(0,2,0)`
     * specificity beats the `inline-flex` that `%button` contributes through
     * `.btn-filter`, so the button starts hidden. `checkSelected`
     * (`app/coffee/modules/backlog/main.coffee:857`-`:866`) then reveals it
     * imperatively with `.css('display', 'flex')` and hides it again with
     * `.hide()` -- both of which write the element's inline style.
     *
     * An inline style is therefore the faithful translation, not a modernisation
     * gap: `{ display: 'flex' }` is what `.css()` wrote, and `undefined` leaves
     * no inline style at all so the stylesheet's `none` applies, which is what
     * `.hide()` produced. Introducing a class instead would change which
     * declaration wins, and unmounting the button would break both the
     * `$el.find('.move-to-sprint')` lookup that found it while hidden and the
     * `e2e-move-to-sprint` hook the end-to-end page objects rely on. This is the
     * one place in the file where a literal CSS value appears, and it is
     * mandated by the behaviour being reproduced.
     */
    const moveToSprintStyle = moveToSprintVisible ? { display: 'flex' } : undefined;

    return (
        <div className="backlog-table-options">
            <div className="backlog-table-options-start">
                {/*
                  * ⭐ THE `active` CLASS IS SET TWICE IN THE INCUMBENT, AND ONLY
                  * THE DECLARATIVE HALF IS REPRODUCED.
                  *
                  * `showHideFilter` toggles it imperatively on this element
                  * (`main.coffee:957`) while the template also binds
                  * `ng-class="{'active': ctrl.activeFilters}"`
                  * (`backlog.jade:56`). The jQuery toggle runs first, inside
                  * `$apply`, and the digest that follows re-evaluates `ng-class`
                  * and overwrites it. The net observable behaviour is therefore
                  * "`active` if and only if `ctrl.activeFilters`", which is
                  * exactly what the expression below produces -- so dropping the
                  * imperative half changes nothing that can be observed.
                  */}
                <button
                    className={filtersClassName}
                    id="show-filters-button"
                    onClick={handleFiltersClick}
                >
                    <Svg svgIcon="icon-filters" />
                    {!activeFilters ? (
                        <span className="text">{t('BACKLOG.FILTERS.TITLE')}</span>
                    ) : null}
                    {activeFilters ? (
                        <span className="text">{t('BACKLOG.FILTERS.HIDE_TITLE')}</span>
                    ) : null}
                    {selectedFilterCount > 0 ? (
                        <span className="selected-filters">{selectedFilterCount}</span>
                    ) : null}
                </button>

                {/*
                  * ⭐ THE SEARCH HOST -- TWO SEPARATE SEAM DECISIONS.
                  *
                  * (a) WHY THE COMPONENT'S TEMPLATE IS REPRODUCED RATHER THAN
                  * HOSTED. `tg-input-search` is an AngularJS 1.5 component, and
                  * AngularJS never `$compile`s anything inside a React root, so
                  * an empty host element would render nothing at all. Its
                  * template is only two nodes -- an `input[type=search]` and a
                  * `tg-svg` -- so it is reproduced here verbatim from
                  * `app/modules/components/input-search/input-search.component.coffee`,
                  * including the tag names. The tags matter: `tg-input-search` is
                  * selected by TAG in both
                  * `app/modules/components/input-search/input-search.component.scss`
                  * and `app/styles/layout/backlog.scss:127`, and the former also
                  * selects the nested `tg-svg` tag to position the magnifier
                  * absolutely -- which `../shared/Svg` already emits. Keeping
                  * both tags is what lets those two stylesheets keep applying
                  * with zero edits (rule T1).
                  *
                  * (b) WHY `createElement` RATHER THAN JSX. `tg-input-search` is
                  * not declared in `app/react/jsx-intrinsic-elements.d.ts`, which
                  * currently declares only `tg-svg` and `tg-card`, and that file
                  * is owned elsewhere and must not be edited from here. Under
                  * this strict configuration an undeclared hyphenated tag is a
                  * type error in JSX, and every way of silencing it -- a
                  * widening cast, a double assertion, a compiler-suppression
                  * comment -- is banned outright. `createElement` needs none of
                  * those escape hatches: its string-tag overload accepts an
                  * arbitrary element name and type-checks cleanly. This
                  * indirection is a coordination item (C-8), to be replaced with
                  * plain JSX once the declaration lands.
                  */}
                {createElement(
                    'tg-input-search',
                    null,
                    <input
                        key="input"
                        type="search"
                        placeholder={t('COMMON.FILTERS.INPUT_PLACEHOLDER')}
                        value={searchText}
                        onChange={handleSearchChange}
                    />,
                    <Svg key="icon" svgIcon="icon-search" />,
                )}

                {userStoryCount > 0 ? (
                    <div className="display-tags-button" id="show-tags">
                        {/*
                          * ⭐ WHY `active` GOES ON `.check` AND NOWHERE ELSE, AND
                          * WHY `toggleShowTags` IS NOT REPRODUCED.
                          *
                          * `main.coffee:906`-`:911` registers a delegated handler
                          * for the selector `#show-tags > input` -- a DIRECT
                          * CHILD selector. The markup nests the input as a
                          * GRANDCHILD: `#show-tags` (`backlog.jade:74`) contains
                          * `.check.js-check` (`:75`) which contains the input
                          * (`:78`). The selector therefore never matches and the
                          * handler NEVER FIRES, which means neither
                          * `$ctrl.toggleShowTags()` (`main.coffee:244`-`:247`)
                          * nor `showHideTags` (`:930`-`:942`) is reachable from a
                          * click. Two consequences are honoured here. The
                          * `active` class that `showHideTags` would have put on
                          * `#show-tags` never appears, so it is not emitted --
                          * and it would have been inert anyway, since no
                          * `.display-tags-button.active` rule exists in
                          * `app/styles/layout/backlog.scss:136`-`:151`. And the
                          * flip-plus-persist that `toggleShowTags` performs is
                          * NOT invoked a second time from the change event; the
                          * only live path is the one described at the input
                          * below. (`showHideTags` does still run on the
                          * `"showTags"` broadcast at `main.coffee:984`-`:985`;
                          * that is the container's business at load time, not
                          * this component's.)
                          *
                          * `active` on `.check` is by contrast fully functional:
                          * `app/styles/components/check.scss:11`-`:20` styles
                          * `.check.active div` to turn the track teal and slide
                          * the knob right, which is the switch's whole ON
                          * appearance. `js-check` has no consumer on this screen
                          * -- the only one in the repository is
                          * `app/coffee/modules/admin/memberships.coffee` -- but
                          * it is emitted verbatim under rule T1.
                          */}
                        <div className={`check js-check${showTags ? ' active' : ''}`}>
                            {/*
                              * ⭐ A REAL, CONTROLLED CHECKBOX -- never a
                              * `div[role=switch]`. `check.scss:21`-`:30` renders
                              * this input at `opacity: 0`, absolutely positioned
                              * over the full 32x18 track, so it IS the click
                              * target and the visible switch is only paint
                              * behind it. Elsewhere on the screen the incumbent
                              * also reads `input:checkbox:checked` out of the DOM
                              * (`main.coffee:861`), so the element has to be a
                              * genuine checkbox that reflects its state.
                              *
                              * ⭐ `ng-checked` AND `ng-model` WERE BOTH BOUND TO
                              * `ctrl.showTags` on this one input
                              * (`backlog.jade:81`-`:82`) -- redundant in
                              * AngularJS, since `ng-model` alone already writes
                              * the property. Both collapse into React's single
                              * `checked`, which is the one honest translation:
                              * React has exactly one notion of a controlled
                              * checked state.
                              *
                              * ⭐ WHAT `onToggleTags` HAS TO MEAN. With the
                              * jQuery handler dead, the only live path on a click
                              * was AngularJS's: `ng-model` flipped the boolean
                              * and then `ng-change="ctrl.toggleTags()"` ran, and
                              * `toggleTags` (`main.coffee:509`-`:510`) ONLY
                              * persists -- `storeShowTags(projectId, showTags)`
                              * -- it flips nothing. React has no `ng-model`, so
                              * the flip has nowhere else to live: the container
                              * must FLIP `showTags` and THEN persist the new
                              * value, in that order. Reading this callback as a
                              * bare "persist" would leave the switch frozen; and
                              * no `preventDefault` is called, because the live
                              * AngularJS path never called one (the only
                              * `preventDefault` was in the dead handler).
                              */}
                            <input
                                type="checkbox"
                                id="show-tags-input"
                                checked={showTags}
                                onChange={onToggleTags}
                            />
                            {/*
                              * Not decorative, and not removable: this bare
                              * element is the switch itself.
                              * `check.scss:31`-`:45` gives it the full size of
                              * the track and draws the round knob as its
                              * `::before`. It must stay the input's NEXT SIBLING
                              * inside `.check`.
                              */}
                            <div />
                        </div>
                        {/*
                          * A SIBLING of `.check`, not a child -- compare the Jade
                          * indentation at `backlog.jade:86` with `:75`.
                          * `app/styles/layout/backlog.scss:136`-`:151` styles
                          * `.display-tags-button label` and
                          * `.display-tags-button .check` as siblings and puts the
                          * `.5rem` gap on the latter.
                          *
                          * The text stays exactly as the locale stores it --
                          * lower-case `tags`. The capital `T` in the design
                          * reference is produced by
                          * `app/styles/layout/backlog.scss:143`-`:145`
                          * (`&::first-letter { text-transform: uppercase }`), so
                          * capitalising it here would duplicate the stylesheet's
                          * job and break locales that capitalise differently.
                          */}
                        <label htmlFor="show-tags-input">{t('BACKLOG.TAGS.SHOW')}</label>
                    </div>
                ) : null}
            </div>

            <div className="backlog-table-options-end">
                {/*
                  * Exactly ONE of these two buttons exists at a time, chosen by
                  * `currentSprint` (`backlog.jade:93` and `:100`). Both carry
                  * `.move-to-sprint` in addition to their distinguishing class,
                  * which is what let the single selector
                  * `$el.find('.move-to-sprint')` in `checkSelected`
                  * (`main.coffee:860`) reach whichever one was rendered -- so
                  * both classes are emitted on both buttons. Neither carries a
                  * `type` attribute, because the Jade omits it and there is no
                  * form in this region; adding one would be a change beyond the
                  * technology transition.
                  */}
                {hasCurrentSprint ? (
                    <button
                        className={moveToCurrentClassName}
                        id="move-to-current-sprint"
                        title={t('BACKLOG.MOVE_US_TO_CURRENT_SPRINT')}
                        style={moveToSprintStyle}
                        onClick={onMoveToCurrentSprint}
                    >
                        <span className="text">{t('BACKLOG.MOVE_US_TO_CURRENT_SPRINT')}</span>
                        <Svg svgIcon="icon-add-to-sprint" />
                    </button>
                ) : null}

                {!hasCurrentSprint ? (
                    <button
                        className={moveToLatestClassName}
                        id="move-to-latest-sprint"
                        title={t('BACKLOG.MOVE_US_TO_LATEST_SPRINT')}
                        style={moveToSprintStyle}
                        onClick={onMoveToLatestSprint}
                    >
                        <span className="text">{t('BACKLOG.MOVE_US_TO_LATEST_SPRINT')}</span>
                        <Svg svgIcon="icon-add-to-sprint" />
                    </button>
                ) : null}

                {/*
                  * The forecasting toggle, as two mutually exclusive buttons.
                  * This one shows while the forecasting view is open and offers
                  * the way back, so it carries the static `active` class from
                  * `backlog.jade:107`, an icon, and the go-back label from
                  * `BACKLOG.FORECASTING.BACKLOG`.
                  */}
                {userStoryCount > 0 && displayVelocity ? (
                    <button
                        className={velocityReturnClassName}
                        title={t('BACKLOG.FORECASTING.TITLE')}
                        onClick={onToggleVelocityForecasting}
                    >
                        <Svg svgIcon="icon-fold-column" />
                        <span className="text">{t('BACKLOG.FORECASTING.BACKLOG')}</span>
                    </button>
                ) : null}

                {/*
                  * ⭐ THE SWAPPED KEYS, PRESERVED EXACTLY AS WRITTEN.
                  *
                  * `backlog.jade:118`-`:119` puts the go-back key
                  * (`BACKLOG.FORECASTING.BACKLOG`) in this button's `title` and
                  * the feature's own name (`BACKLOG.FORECASTING.TITLE`) in its
                  * `translate`. Its sibling above uses the same two keys the
                  * other way round, coherently. So on THIS button the tooltip
                  * says the opposite of the label, and the pairing is reproduced
                  * verbatim: rule T10 forbids a functional change, and
                  * rewording a tooltip a user reads is one. The disagreement is
                  * recorded in the drift register instead of being resolved
                  * here.
                  *
                  * Note also that the `translate` attribute sits on the BUTTON
                  * itself rather than on an inner element, so unlike every other
                  * button in this row this one has NO icon and NO `span.text` --
                  * the translated string is its only child. That is a structural
                  * difference, not an omission.
                  */}
                {userStoryCount > 0 && !displayVelocity && (velocitySpeed ?? 0) > 0 ? (
                    <button
                        className={velocityEnterClassName}
                        title={t('BACKLOG.FORECASTING.BACKLOG')}
                        onClick={onToggleVelocityForecasting}
                    >
                        {t('BACKLOG.FORECASTING.TITLE')}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
