/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * TaskCounter.test.tsx -- co-located spec for the Kanban task-counter badge
 * ==========================================================================
 *
 * Browserless (HR-5): jsdom only, no browser, no network, no dependency on
 * `dist/`.
 *
 * `TaskCounter` is the port of `tgAnimatedCounter`
 * (app/modules/components/kanban-board-zoom/animated-counter.directive.coffee),
 * which is by far the most stateful unit on the board: a four-branch value
 * machine, a deferred class promotion that makes the CSS transition run at all,
 * and a `transitionEnd` handler that promotes the scrolled-in row to the resting
 * row. None of that is visible in a screenshot, so it is asserted here.
 *
 * What these specs hold, in the source's own terms:
 *
 *  - the four branches of `renderData` (:60-86) in order, each reachable and
 *    each with the right effect on the baseline;
 *  - the remove-then-re-add direction sequence (:80-86) -- the class must be
 *    ABSENT on the commit that changes the value and applied only on the next
 *    macrotask, or `transition: transform .5s` never fires;
 *  - `transitionEnd` (:32-42) promoting `nextUp`/`nextDown` to `renderCount`;
 *  - the `disabled` guard (:88-98) freezing the value while leaving the
 *    template-derived classes live, because `ng-class` was never gated by it;
 *  - Drift D13 (`wip-amount` is truthiness, so a limit of `0` sets nothing) and
 *    Drift D14 (`limit-over` is strictly greater, so a count equal to its limit
 *    is not over it);
 *  - the three-row geometry the stylesheet's resting offset depends on.
 *
 * Timing is driven with fake timers rather than waited on, so the assertions
 * pin the ORDER of the two commits instead of merely their end state.
 *
 * KNOWN UNCOVERED BRANCH, stated rather than hidden: the `previous
 * .pendingDirection === undefined ? previous : {...}` guard inside the deferred
 * updater is unreachable through the public props. Every path that clears
 * `pendingDirection` also changes the effect's dependency, so the cleanup clears
 * the timer before the callback can observe a cleared direction. The guard is
 * the source's own `$evalAsync` safety and deleting it to win a branch would be
 * a behaviour change, which the Minimal Change Clause forbids. Line coverage is
 * unaffected; the gate in jest.config.js is on lines.
 * ========================================================================== */

import { act, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';

import { TaskCounter } from './TaskCounter';
import type { TaskCounterProps } from './TaskCounter';

/* --------------------------------------------------------------------------
 * Query helpers. The badge exposes no test id -- deliberately, since it adds no
 * attribute the AngularJS directive did not emit -- so it is queried by the very
 * class names that form its contract with the unedited stylesheet.
 * -------------------------------------------------------------------------- */

function mustFind(container: HTMLElement, selector: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(selector);

    if (element === null) {
        throw new Error(`Expected the counter to render "${selector}".`);
    }

    return element;
}

function host(container: HTMLElement): HTMLElement {
    return mustFind(container, 'tg-animated-counter');
}

function innerClass(container: HTMLElement): string {
    return mustFind(container, '.animated-counter-inner').getAttribute('class') ?? '';
}

function translator(container: HTMLElement): HTMLElement {
    return mustFind(container, '.counter-translator');
}

function translatorClass(container: HTMLElement): string {
    return translator(container).getAttribute('class') ?? '';
}

/** `[nextUp, renderCount, nextDown]`, in the source's row order. */
function rowTexts(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.result')).map(
        (row) => row.textContent ?? '',
    );
}

/** The resting (middle) row -- the only one visible at rest. */
function restingText(container: HTMLElement): string {
    return rowTexts(container)[1] ?? '';
}

describe('TaskCounter', () => {
    describe('structure', () => {
        it('renders the host element, inner box, translator and three rows', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);

            expect(host(container).tagName).toBe('TG-ANIMATED-COUNTER');
            expect(innerClass(container)).toContain('animated-counter-inner');
            expect(translatorClass(container)).toContain('counter-translator');
            // The translator's resting offset of one row height assumes exactly
            // three rows; dropping any would break the geometry.
            expect(container.querySelectorAll('.result')).toHaveLength(3);
        });

        it('nests the rows inside the translator inside the inner box', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);
            const rows = translator(container).children;

            expect(rows).toHaveLength(3);
            expect(mustFind(container, '.animated-counter-inner').children).toHaveLength(1);
            expect(host(container).children).toHaveLength(1);
        });

        it('renders the count in a `.current` span', () => {
            const { container } = render(<TaskCounter count={7} wip={null} />);
            const currents = Array.from(
                container.querySelectorAll<HTMLElement>('.result .current'),
            ).map((span) => span.textContent);

            // One `.current` per row, and the value lives in the resting one.
            expect(currents).toEqual(['0', '7', '0']);
        });

        it('keeps the space INSIDE the suffix span, with no text node between siblings', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);
            const row = Array.from(container.querySelectorAll<HTMLElement>('.result'))[1];

            expect(row).toBeDefined();
            expect(row?.children).toHaveLength(2);
            expect(row?.children[0]?.getAttribute('class')).toBe('current');
            expect(row?.children[0]?.textContent).toBe('1');
            // The leading space belongs to the suffix, not to a whitespace text
            // node -- otherwise the rendered value gains a stray gap.
            expect(row?.children[1]?.textContent).toBe(' / 4');
            expect(row?.childNodes).toHaveLength(2);
        });

        it('renders `n / limit` for a status with a WIP limit', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);

            expect(restingText(container)).toBe('1 / 4');
        });

        it('renders a bare count for a status with no WIP limit', () => {
            const { container } = render(<TaskCounter count={6} wip={null} />);

            expect(restingText(container)).toBe('6');
            expect(container.querySelectorAll('.result')[1]?.children).toHaveLength(1);
        });

        it('renders `0` for a row that holds no snapshot', () => {
            // `{{ X.current || 0 }}` uses `||`, so an absent snapshot renders `0`
            // rather than nothing (animated-counter.directive.coffee:18-26).
            const { container } = render(<TaskCounter count={1} wip={4} />);
            const [up, , down] = rowTexts(container);

            expect(up).toBe('0');
            expect(down).toBe('0');
        });
    });

    describe('the `vertical` variant', () => {
        it('adds the `vertical` class to the host element', () => {
            const { container } = render(<TaskCounter count={6} wip={null} vertical />);

            expect(host(container).getAttribute('class')).toBe('vertical');
        });

        it('omits the class attribute entirely when not vertical', () => {
            const { container } = render(<TaskCounter count={6} wip={null} />);

            expect(host(container).hasAttribute('class')).toBe(false);
        });
    });

    describe('the template-derived classes', () => {
        it('adds `wip-amount` when the status has a limit', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);

            expect(innerClass(container)).toBe('animated-counter-inner wip-amount');
        });

        it('omits `wip-amount` for a limit of 0 (Drift D13 -- truthiness, not `!== null`)', () => {
            const { container } = render(<TaskCounter count={0} wip={0} />);

            expect(innerClass(container)).toBe('animated-counter-inner');
            // A zero limit also renders no ` / 0` suffix.
            expect(restingText(container)).toBe('0');
        });

        it('omits `limit-over` when the count merely equals its limit (Drift D14)', () => {
            const { container } = render(<TaskCounter count={4} wip={4} />);

            expect(innerClass(container)).toBe('animated-counter-inner wip-amount');
            expect(innerClass(container)).not.toContain('limit-over');
        });

        it('adds `limit-over` when the count is strictly over its limit', () => {
            const { container } = render(<TaskCounter count={5} wip={4} />);

            expect(innerClass(container)).toBe(
                'animated-counter-inner wip-amount limit-over',
            );
        });

        it('adds `limit-over` WITHOUT `wip-amount` for a zero limit holding cards', () => {
            // `count > null` in the source coerced the missing limit to 0, so this
            // asymmetric pair is exactly what AngularJS emitted. The stylesheet
            // only colours `.wip-amount .current`, so it renders no differently.
            const { container } = render(<TaskCounter count={1} wip={0} />);

            expect(innerClass(container)).toBe('animated-counter-inner limit-over');
        });

        it('adds `limit-over` WITHOUT `wip-amount` for an unlimited status holding cards', () => {
            const { container } = render(<TaskCounter count={6} wip={null} />);

            expect(innerClass(container)).toBe('animated-counter-inner limit-over');
        });

        it('adds neither class for an empty unlimited status', () => {
            const { container } = render(<TaskCounter count={0} wip={null} />);

            expect(innerClass(container)).toBe('animated-counter-inner');
        });

        it('derives both classes from the live props, not from the rendered snapshot', () => {
            const { container, rerender } = render(<TaskCounter count={2} wip={3} />);

            expect(innerClass(container)).toBe('animated-counter-inner wip-amount');

            // Only the limit moves. The rendered value is frozen by branch 2,
            // but the classes must follow the new props immediately.
            rerender(<TaskCounter count={2} wip={1} />);

            expect(innerClass(container)).toBe(
                'animated-counter-inner wip-amount limit-over',
            );
        });
    });

    describe('branch 1 -- the count has not resolved yet (:60-63)', () => {
        it('renders 0 while the collection is still loading', () => {
            const { container } = render(<TaskCounter count={undefined} wip={4} />);

            expect(restingText(container)).toBe('0 / 4');
        });

        it('renders a bare 0 when there is no limit either', () => {
            const { container } = render(<TaskCounter count={undefined} wip={null} />);

            expect(restingText(container)).toBe('0');
        });

        it('resets the baseline to 0, so the first real count rolls up from 0', () => {
            const { container, rerender } = render(<TaskCounter count={undefined} wip={4} />);

            expect(restingText(container)).toBe('0 / 4');

            rerender(<TaskCounter count={1} wip={4} />);

            // Baseline 0 -> 1 is a MOVE, so it animates: the new value lands in
            // the `nextUp` row while the resting row still shows 0.
            const [up, resting] = rowTexts(container);

            expect(up).toBe('1 / 4');
            expect(resting).toBe('0 / 4');
        });

        it('treats a later `undefined` as a reset back to 0', () => {
            const { container, rerender } = render(<TaskCounter count={3} wip={4} />);

            expect(restingText(container)).toBe('3 / 4');

            rerender(<TaskCounter count={undefined} wip={4} />);

            expect(restingText(container)).toBe('0 / 4');
        });
    });

    describe('branch 2 -- the count has not moved (:64-65)', () => {
        it('freezes the rendered suffix at its previous limit when only `wip` changes', () => {
            const { container, rerender } = render(<TaskCounter count={2} wip={3} />);

            expect(restingText(container)).toBe('2 / 3');

            rerender(<TaskCounter count={2} wip={5} />);

            // The snapshot is not recomputed, so the suffix stays at 3. This is
            // the source's behaviour, not an oversight -- `getCounter` only ran
            // in the branches that changed the value.
            expect(restingText(container)).toBe('2 / 3');
        });

        it('clears both pending rows so no stale roll target survives', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);
            expect(rowTexts(container)[0]).toBe('2 / 4');

            // Re-enter with the same count. `wip` is what moves, because it is a
            // dependency of the value effect and `vertical` deliberately is not.
            rerender(<TaskCounter count={2} wip={9} />);

            const [up, resting, down] = rowTexts(container);

            expect(up).toBe('0');
            expect(down).toBe('0');
            // The resting row is preserved, not recomputed.
            expect(resting).toBe('1 / 4');
        });

        it('does not re-enter the value machine when only `vertical` changes', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);
            expect(rowTexts(container)).toEqual(['2 / 4', '1 / 4', '0']);

            // `vertical` is a pure presentation flag and is absent from the value
            // effect's dependency list, so a roll in flight must survive it.
            rerender(<TaskCounter count={2} wip={4} vertical />);

            expect(host(container).getAttribute('class')).toBe('vertical');
            expect(rowTexts(container)).toEqual(['2 / 4', '1 / 4', '0']);
        });

        it('is idempotent across repeated renders with identical props', () => {
            const { container, rerender } = render(<TaskCounter count={2} wip={4} />);
            const first = container.innerHTML;

            rerender(<TaskCounter count={2} wip={4} />);
            rerender(<TaskCounter count={2} wip={4} />);

            expect(container.innerHTML).toBe(first);
        });
    });

    describe('branch 3 -- land the first value without animating (:67-70)', () => {
        it('shows the mounted count immediately, with no direction class', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);

            expect(restingText(container)).toBe('1 / 4');
            // No `inc`/`dec`: the badge must not roll in from nowhere on mount.
            expect(translatorClass(container)).toBe('counter-translator');
        });

        it('leaves both pending rows empty on mount', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);
            const [up, , down] = rowTexts(container);

            expect(up).toBe('0');
            expect(down).toBe('0');
        });
    });

    describe('branch 4 -- roll to the new value (:72-86)', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('stages an increase in `nextUp` and defers the `inc` class by one macrotask', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);

            // Commit 1: value staged, direction ABSENT. This is the "remove" half
            // of the remove-then-re-add sequence the CSS transition depends on.
            expect(translatorClass(container)).toBe('counter-translator');
            expect(rowTexts(container)).toEqual(['2 / 4', '1 / 4', '0']);

            act(() => {
                jest.advanceTimersByTime(1);
            });

            // Commit 2: the class lands in a separate style recalculation.
            expect(translatorClass(container)).toBe('counter-translator inc');
            expect(restingText(container)).toBe('1 / 4');
        });

        it('stages a decrease in `nextDown` and applies `dec`', () => {
            const { container, rerender } = render(<TaskCounter count={5} wip={4} />);

            rerender(<TaskCounter count={3} wip={4} />);

            expect(translatorClass(container)).toBe('counter-translator');
            expect(rowTexts(container)).toEqual(['0', '5 / 4', '3 / 4']);

            act(() => {
                jest.advanceTimersByTime(1);
            });

            expect(translatorClass(container)).toBe('counter-translator dec');
        });

        it('captures the CURRENT limit in the staged snapshot, not the previous one', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={9} />);

            // `getCounter` always read `wip` from live data (:51-55).
            expect(rowTexts(container)[0]).toBe('2 / 9');
            expect(rowTexts(container)[1]).toBe('1 / 4');
        });

        it('advances the baseline so a roll back down is detected as a decrease', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);
            act(() => {
                jest.advanceTimersByTime(1);
            });
            rerender(<TaskCounter count={1} wip={4} />);
            act(() => {
                jest.advanceTimersByTime(1);
            });

            expect(translatorClass(container)).toBe('counter-translator dec');
            expect(rowTexts(container)[2]).toBe('1 / 4');
        });

        it('clears the pending timer on unmount, scheduling nothing after teardown', () => {
            const { rerender, unmount } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);
            expect(jest.getTimerCount()).toBeGreaterThan(0);

            unmount();

            expect(jest.getTimerCount()).toBe(0);
        });
    });

    describe('the `transitionEnd` handler (:32-42)', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('promotes `nextUp` to the resting row and drops the direction class', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);
            act(() => {
                jest.advanceTimersByTime(1);
            });
            expect(translatorClass(container)).toBe('counter-translator inc');

            fireEvent.transitionEnd(translator(container));

            expect(restingText(container)).toBe('2 / 4');
            // The class is removed so the translator snaps back to its resting
            // offset without animating.
            expect(translatorClass(container)).toBe('counter-translator');
        });

        it('promotes `nextDown` when the roll was downward', () => {
            const { container, rerender } = render(<TaskCounter count={5} wip={4} />);

            rerender(<TaskCounter count={3} wip={4} />);
            act(() => {
                jest.advanceTimersByTime(1);
            });

            fireEvent.transitionEnd(translator(container));

            expect(restingText(container)).toBe('3 / 4');
            expect(translatorClass(container)).toBe('counter-translator');
        });

        it('leaves the staged row in place, as the source does', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);
            fireEvent.transitionEnd(translator(container));

            // `nextUp` is deliberately NOT cleared here.
            expect(rowTexts(container)[0]).toBe('2 / 4');
            expect(rowTexts(container)[1]).toBe('2 / 4');
        });

        it('is harmless when no roll is in flight', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);

            fireEvent.transitionEnd(translator(container));

            // Both staged rows are empty, so the resting row becomes the absent
            // `nextDown` snapshot and renders `0` -- the same thing the source
            // did, since its handler was also unconditional.
            expect(restingText(container)).toBe('0');
            expect(translatorClass(container)).toBe('counter-translator');
        });
    });

    describe('the `disabled` guard (:88-98)', () => {
        it('renders nothing but zeros when mounted disabled', () => {
            const { container } = render(<TaskCounter count={1} wip={4} disabled />);

            expect(rowTexts(container)).toEqual(['0', '0', '0']);
        });

        it('still derives the template classes from the live props while disabled', () => {
            const { container } = render(<TaskCounter count={5} wip={4} disabled />);

            // `ng-class` was a template binding the guard never gated.
            expect(innerClass(container)).toBe(
                'animated-counter-inner wip-amount limit-over',
            );
        });

        it('freezes the rendered value while the board re-renders', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            expect(restingText(container)).toBe('1 / 4');

            rerender(<TaskCounter count={9} wip={4} disabled />);

            expect(restingText(container)).toBe('1 / 4');
            expect(rowTexts(container)[0]).toBe('0');
        });

        it('lands the pending value once re-enabled', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} disabled />);

            expect(restingText(container)).toBe('0');

            rerender(<TaskCounter count={1} wip={4} />);

            // The first non-disabled pass is still the initial one, so it lands
            // without animating.
            expect(restingText(container)).toBe('1 / 4');
            expect(translatorClass(container)).toBe('counter-translator');
        });

        it('preserves an applied direction class across a disabled pass', () => {
            jest.useFakeTimers();

            try {
                const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

                rerender(<TaskCounter count={2} wip={4} />);
                act(() => {
                    jest.advanceTimersByTime(1);
                });
                expect(translatorClass(container)).toBe('counter-translator inc');

                rerender(<TaskCounter count={2} wip={4} disabled />);

                // `removeClass('inc dec')` appeared only in the value-changed
                // branch, so a disabled pass must not strip it.
                expect(translatorClass(container)).toBe('counter-translator inc');
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('StrictMode safety', () => {
        it('mounts correctly when React double-invokes effects', () => {
            // `ReactHostElement` may mount a screen inside StrictMode. Refs are
            // mutated in the effect body rather than inside a state updater, so a
            // double-invoked effect must not advance the baseline twice.
            const { container } = render(
                <StrictMode>
                    <TaskCounter count={3} wip={4} />
                </StrictMode>,
            );

            expect(restingText(container)).toBe('3 / 4');
            expect(translatorClass(container)).toBe('counter-translator');
            expect(rowTexts(container)).toEqual(['0', '3 / 4', '0']);
        });
    });

    it('accepts the documented props object shape', () => {
        const props: TaskCounterProps = { count: 2, wip: 3, disabled: false, vertical: false };
        const { container } = render(<TaskCounter {...props} />);

        expect(restingText(container)).toBe('2 / 3');
    });
});
