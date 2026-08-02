/**
 * TaskCounter — the task-counter badge rendered at the top-right of every Kanban
 * status-column cell, and vertically inside every collapsed (folded) column rail.
 *
 * ===========================================================================
 * WHAT THIS FILE IS A PORT OF
 * ===========================================================================
 * A behaviour-for-behaviour React port of the AngularJS `tgAnimatedCounter`
 * directive. Every branch, every class name and every rendered node below traces
 * to one of these locators:
 *
 *   template   app/modules/components/animated-counter/animated-counter.directive.coffee:13-29
 *   behaviour  app/modules/components/animated-counter/animated-counter.directive.coffee:31-111
 *   styling    app/modules/components/animated-counter/animated-counter.directive.scss:1-65
 *   call sites app/partials/includes/modules/kanban-table.jade:122-129  (swimlane, expanded)
 *              app/partials/includes/modules/kanban-table.jade:130-136  (swimlane, folded)
 *              app/partials/includes/modules/kanban-table.jade:198-205  (flat, expanded)
 *              app/partials/includes/modules/kanban-table.jade:206-212  (flat, folded)
 *
 * The directive is registered on the `taigaComponents` module at
 * animated-counter.directive.coffee:113 and declares NO `replace: true`, so the
 * host `<tg-animated-counter>` element survives in the rendered DOM and the
 * template is its *content*. That is load-bearing — see the next section.
 *
 * ===========================================================================
 * WHY THE WRAPPER ELEMENT IS MANDATORY   (T9 seam note, and the reason for T1)
 * ===========================================================================
 * `animated-counter.directive.scss` **line 1 is literally `tg-animated-counter {`**
 * and all 65 lines of that file are nested inside that element selector.
 * Rendering only the inner `div.animated-counter-inner` would silently drop:
 *
 *   - `display: block` on the host;
 *   - the 14px `$counter-height` box, its `overflow: hidden`, its `position:
 *     relative` and its `text-align: center`;
 *   - the `translateY` / `translateX` roll transforms and their `.5s` transition;
 *   - the `.wip-amount .current` and `.wip-amount.limit-over .current` colours.
 *
 * It would do so with no error, no warning and no build failure. Rule T1
 * ("preserve every CSS class name") therefore extends to `tg-*` element names,
 * and this component's ROOT element is `<tg-animated-counter>`.
 *
 * ===========================================================================
 * OWNERSHIP BOUNDARY — WHAT THIS FILE DELIBERATELY DOES NOT RENDER
 * ===========================================================================
 * The badge is two nested elements and only the inner one belongs here. The
 * outer chip is owned by the parent column components:
 *
 *   - expanded columns wrap this component in `.kanban-task-counter`, styled at
 *     app/styles/modules/kanban/kanban-table.scss:580-594 — that rule owns the
 *     32x22 box, the `$color-gray200` background, the box-shadow, the inherited
 *     `$color-link-tertiary` text colour, the `.68rem` font size, the 4px
 *     padding, the absolute top/right positioning and the `$first-layer`
 *     stacking. It also owns the `title` attribute (`KANBAN.NUMBER_US`).
 *   - folded columns wrap it in `.ammount`, styled at kanban-table.scss:395-400.
 *
 * Consequently this file authors NO background, NO box-shadow, NO font size, NO
 * padding, NO positioning, NO title and NO ARIA attribute. Every visual property
 * already applies the moment the wrapper element and the exact class names are
 * emitted, which is why there is no stylesheet in this folder: authoring CSS
 * where an existing rule already applies is a compliance violation (G-DS-4), not
 * an improvement.
 *
 * ===========================================================================
 * T9 SEAM NOTES — every technology-specific adaptation, at the point of change
 * ===========================================================================
 * 1. PROPS FLATTENING. The AngularJS call sites bind a single object literal,
 *    `data="{count: <collection>.size, wip: s.wip_limit}"`, against an isolate
 *    scope of `{data: '<', disabled: '<'}`. React has no equivalent of watching
 *    a freshly-allocated object every digest, so the object is flattened into
 *    two primitive props, `count` and `wip`. This is a transition adaptation
 *    only: no prop is added, removed or renamed beyond that flattening.
 *
 * 2. `wip` IS AN EFFECT DEPENDENCY ON PURPOSE. Because the AngularJS binding
 *    allocates a new object every digest, `$watch 'data'` fires on every digest
 *    and `renderData` runs constantly; branch 2 (`lastCount == count`) is what
 *    makes that a no-op. Re-running on a `wip` change is therefore faithful, and
 *    it is observably required: branch 1 re-reads `wip` when `count` is
 *    undefined, so a `wip` change with an undefined `count` really does update
 *    the rendered suffix.
 *
 * 3. INITIAL-LOAD ANIMATION SUPPRESSION. The directive waits for the one-shot
 *    `'kanban:userstories:loaded'` broadcast (animated-counter.directive.coffee:46-48)
 *    before it will animate, so the counts that arrive with the first board load
 *    land without a roll. This component is a pure leaf (I9) with no injector and
 *    no `$rootScope`, so it cannot observe that broadcast. The equivalent is a
 *    first-invocation ref: the first `renderData` pass is treated as
 *    `!initialLoad`, which routes it through the same non-animating branch, and
 *    every later pass may animate.
 *
 * 4. `$scope.$evalAsync` -> NEXT MACROTASK. On a count change the directive
 *    removes `inc dec` synchronously and re-adds the direction class from an
 *    `$evalAsync` callback (animated-counter.directive.coffee:79-86), so the
 *    browser recalculates style once without the class and once with it — which
 *    is what triggers `transition: transform .5s`. Adding the class in the same
 *    tick would skip the transition entirely. Here the direction is first parked
 *    in `pendingDirection` and promoted to the applied `direction` from a
 *    zero-delay timer, i.e. a macrotask, so a style recalculation boundary is
 *    guaranteed. A microtask would not be sufficient — it runs before paint.
 *    The timer is cleared whenever `pendingDirection` changes or the component
 *    unmounts, which reproduces the fact that a queued `$evalAsync` callback
 *    becomes a no-op once `nextUp`/`nextDown` have been cleared.
 *
 * 5. `useLayoutEffect` FOR THE STATE MACHINE. AngularJS runs both `$watch`
 *    listeners inside the first digest, before the browser paints, so the
 *    badge never shows a transient `0`. A passive `useEffect` runs after paint
 *    and would flash `0` on every mount. `useLayoutEffect` is the React
 *    equivalent of "before paint" and preserves the existing behaviour exactly.
 *
 * 6. `class`, NOT `className`, ON THE HYPHENATED TAG. Measured against
 *    react-dom 18.2.0: because a hyphenated tag name is treated as a custom
 *    element, props are forwarded under their raw name, so `className="vertical"`
 *    renders as `classname="vertical"` and the class is silently lost, whereas
 *    `class="vertical"` renders correctly. The intrinsic element declared below
 *    therefore omits `className` and accepts `class`, matching the convention
 *    already established (and measured) in app/react/jsx-intrinsic-elements.d.ts.
 *    The plain `div` and `span` children are ordinary HTML and keep `className`.
 *
 * 7. THE JSX INTRINSIC IS DECLARED HERE, NOT IN THE SHARED DECLARATION FILE.
 *    app/react/jsx-intrinsic-elements.d.ts declares only `tg-svg` and `tg-card`
 *    and is on this task's must-not-modify list, so `tg-animated-counter` is
 *    augmented from this file (T8: one tag, one owning file). The augmentation
 *    targets `React.JSX.IntrinsicElements` via `declare module 'react'` rather
 *    than the deprecated global `JSX` namespace; verified against
 *    @types/react 18.2.79, where `React.JSX.IntrinsicElements` extends the
 *    global interface and `react/jsx-runtime` re-extends `React.JSX`, so the
 *    augmentation propagates to both forms.
 *
 * ===========================================================================
 * DRIFT REGISTER ENTRIES PUBLISHED BY THIS FILE
 * ===========================================================================
 * Behaviour follows AngularJS; layout and spacing follow Figma; disagreements
 * are published rather than silently resolved (T6). The register itself lives at
 * e2e-react/artifacts/figma-comparison/ and is owned by the e2e-react task —
 * these entries are published here, they are not authored here.
 *
 *   D13  `wip` IS TESTED FOR TRUTHINESS, NOT FOR `!== null`. The source tests
 *        `data.wip` for truthiness in three places: the `ng-class` at
 *        animated-counter.directive.coffee:15 and the `ng-if="X.wip"` guard in
 *        each of the three `.result` rows at :19, :22 and :25. A `wip_limit` of
 *        `0` is falsy, so it renders a BARE COUNT and receives no `wip-amount`
 *        class. Implemented as truthiness; never as `wip !== null`.
 *
 *   D14  `limit-over` IS STRICTLY GREATER, AND ITS COLOUR IS NOT EXERCISED BY
 *        THE DESIGN FRAME. The source condition is `data.count > data.wip`
 *        (animated-counter.directive.coffee:15), so a count that is merely EQUAL
 *        to the limit is not "over" it. Figma node 1:7 confirms this
 *        independently: its at-limit badge renders its numerator in
 *        `$color-link-green`, pixel-identical to the under-limit badges, and the
 *        frame contains no `$color-link-red` numerator anywhere. The red state is
 *        therefore implemented from the AngularJS source per T10 and must not be
 *        inferred from, or validated against, that frame.
 *
 *   D15  THE `vertical` VARIANT IS NOT EXERCISED BY THE DESIGN FRAME EITHER.
 *        The folded branch renders the counter inside
 *        `div.ammount(ng-if="!s.is_archived")`, and the only folded column in
 *        node 1:7 is ARCHIVED, whose status record carries `is_archived: true`.
 *        The rail in that frame contains only its status swatch and its rotated
 *        label — no digits. The variant is a legitimately declared state that
 *        the frame simply does not show, so it is implemented from
 *        animated-counter.directive.scss:5-26 rather than from the raster.
 *
 * ===========================================================================
 * ACCESSIBILITY
 * ===========================================================================
 * No ARIA attribute, `role`, `title` or live-region hint is added: the source has
 * none, T10 forbids inventing them, and the accessible name for the badge is
 * already supplied by the parent chip's translated `title`
 * (`KANBAN.NUMBER_US`, kanban-table.jade:123). Light DOM only — no shadow root
 * is created anywhere, because a shadow boundary would sever the cascade from
 * the single global stylesheet (I6).
 */

import type * as React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Attribute surface for the `<tg-animated-counter>` custom element.
 *
 * `className` is deliberately removed and replaced by `class`: see T9 seam note
 * 6 in the header. Keeping `className` available would let a caller write the
 * form that silently loses the class.
 */
type TgAnimatedCounterAttributes = Omit<React.HTMLAttributes<HTMLElement>, 'className'> & {
    readonly class?: string;
};

declare module 'react' {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX {
        interface IntrinsicElements {
            /**
             * Host element of the ported `tgAnimatedCounter` directive. Declared
             * here and nowhere else — `tg-svg` and `tg-card` are declared in
             * app/react/jsx-intrinsic-elements.d.ts and must not be redeclared.
             */
            'tg-animated-counter': React.DetailedHTMLProps<TgAnimatedCounterAttributes, HTMLElement>;
        }
    }
}

/**
 * One rendered counter value: the number shown and the WIP limit it was captured
 * with. Mirrors `getCounter` at animated-counter.directive.coffee:51-55, whose
 * `wip` always comes from the CURRENT data rather than from the previous
 * snapshot — which is why the limit is captured alongside the count instead of
 * being read from props at render time.
 */
interface CounterSnapshot {
    readonly current: number;
    readonly wip: number | null;
}

/**
 * The transient class applied to `.counter-translator` while a value rolls.
 * `inc` scrolls up to `nextUp`, `dec` scrolls down to `nextDown`; the transforms
 * and the `.5s` timing live in animated-counter.directive.scss:36-47 (and :10-21
 * for the vertical variant).
 */
type TranslateDirection = 'inc' | 'dec';

/**
 * Everything the template reads, held in one state object so that a single
 * update commits the value change and the direction change together — exactly as
 * one AngularJS digest would.
 *
 * `direction` is the class currently APPLIED to `.counter-translator`;
 * `pendingDirection` is the class SCHEDULED for the next macrotask. Splitting
 * them is what reproduces the source's remove-then-re-add sequence (see T9 seam
 * note 4) instead of collapsing it into a single mutation.
 */
interface CounterRenderState {
    readonly renderCount: CounterSnapshot | undefined;
    readonly nextUp: CounterSnapshot | undefined;
    readonly nextDown: CounterSnapshot | undefined;
    readonly direction: TranslateDirection | undefined;
    readonly pendingDirection: TranslateDirection | undefined;
}

const INITIAL_RENDER_STATE: CounterRenderState = {
    renderCount: undefined,
    nextUp: undefined,
    nextDown: undefined,
    direction: undefined,
    pendingDirection: undefined,
};

/**
 * Renders one `.result` row, reproducing animated-counter.directive.coffee:18-26
 * exactly.
 *
 * Two details are easy to lose and both are asserted by this component's spec:
 *
 *   - `{{ X.current || 0 }}` uses `||`, so `0`, `undefined` and `null` all render
 *     `0`. An absent snapshot therefore renders `0` rather than nothing.
 *   - the suffix span's text is `" / " + wip` with the space INSIDE the span, and
 *     the two spans are immediate siblings with no whitespace text node between
 *     them. They are kept on one line here to guarantee that.
 *
 * The suffix is gated on the truthiness of `wip` (Drift D13), so a limit of `0`
 * produces a bare count with no ` / 0`.
 */
function renderResultRow(snapshot: CounterSnapshot | undefined): React.JSX.Element {
    const current: number = snapshot?.current || 0;
    const wipLimit: number | null | undefined = snapshot?.wip;

    return (
        <div className="result">
            <span className="current">{current}</span>{wipLimit ? <span>{` / ${wipLimit}`}</span> : null}
        </div>
    );
}

/**
 * Props for {@link TaskCounter}.
 *
 * These are the flattened form of the AngularJS isolate scope
 * `{data: '<', disabled: '<'}`, where `data` was the object literal
 * `{count: <collection>.size, wip: s.wip_limit}` built at each call site. See T9
 * seam note 1 in the header for why the object became two primitives.
 */
export interface TaskCounterProps {
    /**
     * Number of user stories in this status cell — `usByStatusSwimlanes.getIn([
     * swimlane.id, s.id]).size` in swimlane mode, `usByStatus.get(s.id.toString()).size`
     * in flat mode.
     *
     * `undefined` models the pre-load state: the collection has not resolved yet,
     * so the AngularJS template rendered `0`. Passing `undefined` therefore
     * renders `0` and resets the internal baseline, matching
     * animated-counter.directive.coffee:60-63.
     */
    readonly count: number | undefined;

    /**
     * The status's WIP limit, `s.wip_limit`.
     *
     * `null` means "no limit configured", which renders a bare count. Note that
     * `0` is ALSO falsy and therefore also renders a bare count with no
     * `wip-amount` class — that is Drift D13, and it is why this must never be
     * tested with `wip !== null`.
     */
    readonly wip: number | null;

    /**
     * Suppresses the roll animation and all value updates while the board is
     * re-rendering, bound from `ctrl.renderInProgress`.
     *
     * Optional and defaulting to `false` because the folded-column call sites
     * (kanban-table.jade:133-136 and :209-212) pass no `disabled` binding at all.
     */
    readonly disabled?: boolean;

    /**
     * Adds the `vertical` class to the host element, switching the roll from the
     * Y axis to the X axis and the box from full-width to the 14px
     * `$counter-height` rail (animated-counter.directive.scss:5-26).
     *
     * Set only by the folded-column call sites, which render
     * `tg-animated-counter(class="vertical" ...)`. See Drift D15 for why the
     * design frame does not exercise it.
     */
    readonly vertical?: boolean;
}

/**
 * The Kanban task-counter badge.
 *
 * Renders `n` when the status has no WIP limit and `n / limit` when it has one,
 * rolling between values with the same 0.5s translate animation as the AngularJS
 * directive it replaces.
 *
 * @example Expanded column cell, status with a WIP limit of 4 holding 1 story
 * ```tsx
 * <div className="kanban-task-counter" title={t('KANBAN.NUMBER_US')}>
 *     <TaskCounter count={1} wip={4} disabled={renderInProgress} />
 * </div>
 * ```
 *
 * @example Folded column rail, status with no WIP limit
 * ```tsx
 * <div className="ammount">
 *     <TaskCounter count={6} wip={null} vertical />
 * </div>
 * ```
 */
export function TaskCounter({
    count,
    wip,
    disabled = false,
    vertical = false,
}: TaskCounterProps): React.JSX.Element {
    const [renderState, setRenderState] = useState<CounterRenderState>(INITIAL_RENDER_STATE);

    /**
     * The `lastCount` closure variable of animated-counter.directive.coffee:44.
     * A ref, not state: the source never renders it, and it must survive a
     * re-render without scheduling one.
     */
    const lastCountRef = useRef<number | undefined>(undefined);

    /**
     * Stands in for the one-shot `'kanban:userstories:loaded'` broadcast at
     * animated-counter.directive.coffee:46-48. `false` until the first
     * `renderData` pass has run, which routes that first pass through the
     * non-animating branch. See T9 seam note 3.
     */
    const initialLoadCompleteRef = useRef<boolean>(false);

    /**
     * `renderData`, ported from animated-counter.directive.coffee:50-86 in the
     * source's exact branch order.
     *
     * `useLayoutEffect`, not `useEffect`, so the first pass commits before the
     * browser paints and the badge never flashes a transient `0` (T9 seam
     * note 5). Refs are mutated in the effect body and never inside a state
     * updater, so a double-invoked effect cannot advance the baseline twice.
     */
    useLayoutEffect(() => {
        // Both `$watch` listeners early-return while disabled
        // (animated-counter.directive.coffee:88-98). Returning here leaves the
        // previous render state — and the applied direction class — untouched.
        if (disabled) {
            return;
        }

        // `getCounter` (:51-55). The limit always comes from the CURRENT props,
        // never from the previous snapshot.
        const snapshotOf = (value: number): CounterSnapshot => ({ current: value, wip });

        const initialLoadComplete: boolean = initialLoadCompleteRef.current;
        initialLoadCompleteRef.current = true;

        const previousCount: number | undefined = lastCountRef.current;

        // `nextUp` and `nextDown` are cleared unconditionally, ahead of every
        // branch including the no-op return (:57-58). `pendingDirection` is
        // cleared with them, because a queued `$evalAsync` callback that finds
        // both cleared adds no class at all.
        //
        // `direction` is NOT cleared here: `removeClass('inc dec')` appears only
        // in the value-changed branch (:80), so the branches below that return
        // early must preserve whatever class is currently applied.

        // Branch 1 — no data, or a count that has not resolved yet (:60-63).
        // The AngularJS guard was `!$scope.data || $scope.data.count == undefined`;
        // the flattened prop contract removes the "no data at all" case, and the
        // loose `== undefined` narrows to `=== undefined` because `count` is
        // typed `number | undefined`.
        if (count === undefined) {
            lastCountRef.current = 0;
            const resolved: CounterSnapshot = snapshotOf(0);

            setRenderState((previous) => ({
                renderCount: resolved,
                nextUp: undefined,
                nextDown: undefined,
                direction: previous.direction,
                pendingDirection: undefined,
            }));
            return;
        }

        // Branch 2 — the count has not moved, so there is nothing to roll
        // (:64-65). This is the branch that makes the source's per-digest
        // re-entry harmless, and it is why a `wip` change alone leaves the
        // already-rendered suffix frozen at its previous limit.
        if (previousCount === count) {
            setRenderState((previous) => ({
                renderCount: previous.renderCount,
                nextUp: undefined,
                nextDown: undefined,
                direction: previous.direction,
                pendingDirection: undefined,
            }));
            return;
        }

        // Branch 3 — land the value without animating (:67-70). Either the board
        // has not finished its initial load, or this is the very first count this
        // component has seen.
        if (!initialLoadComplete || previousCount === undefined) {
            lastCountRef.current = count;
            const resolved: CounterSnapshot = snapshotOf(count);

            setRenderState((previous) => ({
                renderCount: resolved,
                nextUp: undefined,
                nextDown: undefined,
                direction: previous.direction,
                pendingDirection: undefined,
            }));
            return;
        }

        // Branch 4 — the count moved, so roll to it (:72-86). Equality was
        // already excluded by branch 2, so the comparison is exhaustive: up
        // populates `nextUp`, down populates `nextDown`. The applied direction is
        // dropped now and the new one is only scheduled, which is the
        // remove-then-re-add sequence the CSS transition depends on.
        const goingUp: boolean = count > previousCount;
        lastCountRef.current = count;
        const resolved: CounterSnapshot = snapshotOf(count);

        setRenderState((previous) => ({
            renderCount: previous.renderCount,
            nextUp: goingUp ? resolved : undefined,
            nextDown: goingUp ? undefined : resolved,
            direction: undefined,
            pendingDirection: goingUp ? 'inc' : 'dec',
        }));
    }, [count, wip, disabled]);

    /**
     * The `$scope.$evalAsync` stand-in of
     * animated-counter.directive.coffee:82-86: promote the scheduled direction
     * to the applied one on the next macrotask, so the class lands in a separate
     * style recalculation and `transition: transform .5s` actually runs.
     *
     * Cleaning the timer up whenever `pendingDirection` changes reproduces the
     * source's own guard — a queued callback that finds the direction cleared
     * adds nothing — and also prevents an update after unmount.
     */
    useEffect(() => {
        if (renderState.pendingDirection === undefined) {
            return undefined;
        }

        const timer: number = window.setTimeout(() => {
            setRenderState((previous) =>
                previous.pendingDirection === undefined
                    ? previous
                    : {
                          renderCount: previous.renderCount,
                          nextUp: previous.nextUp,
                          nextDown: previous.nextDown,
                          direction: previous.pendingDirection,
                          pendingDirection: undefined,
                      },
            );
        }, 0);

        return () => {
            window.clearTimeout(timer);
        };
    }, [renderState.pendingDirection]);

    /**
     * `transitionEnd` handler, ported from
     * animated-counter.directive.coffee:32-42: the row that just scrolled into
     * view becomes the resting row, then the direction class is removed so the
     * translator snaps back to its resting offset.
     *
     * `nextUp` and `nextDown` are deliberately left in place — the source does
     * not clear them here. Bound as a React prop on `.counter-translator` rather
     * than through `addEventListener`, so there is nothing to detach on unmount
     * (the source's :100-102 teardown).
     */
    const handleTransitionEnd = useCallback((): void => {
        setRenderState((previous) => ({
            renderCount: previous.nextUp !== undefined ? previous.nextUp : previous.nextDown,
            nextUp: previous.nextUp,
            nextDown: previous.nextDown,
            direction: undefined,
            pendingDirection: previous.pendingDirection,
        }));
    }, []);

    // `ng-class="{'wip-amount': data.wip, 'limit-over': data.count > data.wip}"`
    // (animated-counter.directive.coffee:15). Both flags are derived from the
    // LIVE props rather than from render state, because the source's `ng-class`
    // is a template binding that the `disabled` guard never gated.
    //
    // `wip-amount` is truthiness, so a limit of `0` does not set it (Drift D13).
    // `limit-over` is STRICTLY greater, so a count equal to its limit is not over
    // it (Drift D14). Coercing an absent limit to `0` reproduces what the source
    // expression did with `count > null`; note that this can set `limit-over`
    // without `wip-amount`, which is exactly what AngularJS emitted and which the
    // stylesheet renders as no visual change at all, since it only colours
    // `.wip-amount .current` and `.wip-amount.limit-over .current`.
    const hasWipLimit: boolean = Boolean(wip);
    const isOverWipLimit: boolean = count !== undefined && count > (wip ?? 0);

    let innerClassName = 'animated-counter-inner';
    if (hasWipLimit) {
        innerClassName += ' wip-amount';
    }
    if (isOverWipLimit) {
        innerClassName += ' limit-over';
    }

    const translatorClassName: string =
        renderState.direction === undefined
            ? 'counter-translator'
            : `counter-translator ${renderState.direction}`;

    // All three rows always render, in the source's order — `nextUp`,
    // `renderCount`, `nextDown` (animated-counter.directive.coffee:18-26). The
    // translator's resting offset of one row height assumes exactly three rows of
    // exactly that height, so dropping any of them would break the geometry, and
    // `.animated-counter-inner`'s `overflow: hidden` is what keeps only the
    // middle one visible at rest.
    return (
        <tg-animated-counter class={vertical ? 'vertical' : undefined}>
            <div className={innerClassName}>
                <div className={translatorClassName} onTransitionEnd={handleTransitionEnd}>
                    {renderResultRow(renderState.nextUp)}
                    {renderResultRow(renderState.renderCount)}
                    {renderResultRow(renderState.nextDown)}
                </div>
            </div>
        </tg-animated-counter>
    );
}
