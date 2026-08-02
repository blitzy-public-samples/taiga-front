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
 * (app/modules/components/animated-counter/animated-counter.directive.coffee --
 * every `:NNN` locator below refers to that file), which is by far the most
 * stateful unit on the board: a four-branch value machine, a deferred class
 * promotion that makes the CSS transition run at all, and a `transitionEnd`
 * handler that promotes the scrolled-in row to the resting row. None of that is
 * visible in a screenshot, so it is asserted here.
 *
 * What these specs hold, in the source's own terms:
 *
 *  - the rendered shape: the `<tg-animated-counter>` HOST element as the
 *    outermost node, then `.animated-counter-inner` > `.counter-translator` >
 *    exactly three `.result` rows (:13-29). The host is not cosmetic --
 *    animated-counter.directive.scss line 1 is literally
 *    `tg-animated-counter {` and all 65 of its lines nest inside that element
 *    selector, so dropping the wrapper would silently unstyle the badge with no
 *    error and no build failure. That makes it the single most load-bearing
 *    assertion in this file (transformation rule T1 extends to `tg-*` element
 *    names, not only to class names);
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

/** The three `.result` rows themselves, in the source's row order. */
function rows(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.result'));
}

/**
 * The `<tg-animated-counter>` host as the container's OUTERMOST element, rather
 * than as "some descendant that happens to match". Anything but the outermost
 * node would mean the component had emitted a wrapper the directive never had.
 */
function outermost(container: HTMLElement): Element {
    const element = container.firstElementChild;

    if (element === null) {
        throw new Error('Expected the counter to render an element.');
    }

    return element;
}

/**
 * `element.children[index]`, narrowed. Used to walk the nesting chain one level
 * at a time so a missing or reordered level names itself in the failure.
 */
function childAt(element: Element, index: number): Element {
    const child = element.children[index];

    if (child === undefined) {
        throw new Error(`Expected a child at index ${index} of <${element.tagName}>.`);
    }

    return child;
}

/**
 * The resting (middle) row -- the only one visible at rest.
 *
 * WHITESPACE, and why these assertions read `'1 / 4'` rather than the AngularJS
 * string (T9 seam note, confirmed against the running application):
 *
 * The directive's template is a multi-line CoffeeScript string, so AngularJS
 * emits indentation text nodes inside each `.result` and the live DOM reports
 * `textContent === "\n            1 / 4\n        "` (measured on
 * /project/project-3/kanban: 30 counters, every row shaped that way). React
 * renders the same two spans with no text node between or around them, so
 * `textContent === "1 / 4"`.
 *
 * That divergence is deliberate and is NOT a fidelity loss: the whitespace is an
 * artefact of how the template literal was authored, it collapses to nothing in
 * a block-level `.result` box, and reproducing it would mean emitting decorative
 * text nodes React has no reason to emit. The space that DOES matter -- the one
 * inside the suffix span, `" / 4"` -- is asserted by exact equality below,
 * because that one is the visible separator between numerator and divider and it
 * is confirmed byte-for-byte in the live DOM.
 */
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

        it('makes the `<tg-animated-counter>` host the OUTERMOST node', () => {
            // The directive declares no `replace`, so AngularJS kept the host
            // element and rendered the template as its CONTENT (:104-111). The
            // whole stylesheet nests inside `tg-animated-counter { … }`
            // (animated-counter.directive.scss:1), so an extra wrapper above the
            // host -- or the host being dropped for its inner div -- silently
            // detaches all 65 lines of it. Asserted on `firstElementChild`, not
            // with a selector, because a selector would also match a host buried
            // under a wrapper this component must never introduce.
            const { container } = render(<TaskCounter count={1} wip={4} />);

            expect(outermost(container).tagName.toLowerCase()).toBe('tg-animated-counter');
            // Exactly one root: no sibling node is emitted alongside the host.
            expect(container.children).toHaveLength(1);
        });

        it('nests the rows inside the translator inside the inner box', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);
            const rows = translator(container).children;

            expect(rows).toHaveLength(3);
            expect(mustFind(container, '.animated-counter-inner').children).toHaveLength(1);
            expect(host(container).children).toHaveLength(1);
        });

        it('reproduces the template nesting chain level by level, by tag and class', () => {
            // Walks :13-29 top-down. The stylesheet's selectors are
            // `tg-animated-counter .animated-counter-inner`,
            // `… .counter-translator` and `… .result`, so both the tag names and
            // the class names at each level are part of the contract -- and so is
            // the fact that each level holds exactly one child until the rows.
            const { container } = render(<TaskCounter count={1} wip={4} />);

            const hostElement = outermost(container);
            expect(hostElement.tagName.toLowerCase()).toBe('tg-animated-counter');
            expect(hostElement.children).toHaveLength(1);

            const inner = childAt(hostElement, 0);
            expect(inner.tagName).toBe('DIV');
            expect(inner.classList.contains('animated-counter-inner')).toBe(true);
            expect(inner.children).toHaveLength(1);

            const translatorElement = childAt(inner, 0);
            expect(translatorElement.tagName).toBe('DIV');
            expect(translatorElement.classList.contains('counter-translator')).toBe(true);
            expect(translatorElement.children).toHaveLength(3);

            // All three rows are `div.result`, in order and with nothing between
            // them: the resting offset of one row height depends on it.
            Array.from(translatorElement.children).forEach((row) => {
                expect(row.tagName).toBe('DIV');
                expect(row.classList.contains('result')).toBe(true);
            });
        });

        it('opens every row with a `span.current`, not only the resting one', () => {
            // `<span class="current">{{ X.current || 0 }}</span>` is the FIRST
            // child of each of the three rows (:19, :22, :25). The suffix span,
            // when present, is its next sibling -- never its parent or its
            // predecessor.
            const { container } = render(<TaskCounter count={1} wip={4} />);
            const allRows = rows(container);

            expect(allRows).toHaveLength(3);

            allRows.forEach((row) => {
                const first = childAt(row, 0);

                expect(first.tagName).toBe('SPAN');
                expect(first.getAttribute('class')).toBe('current');
            });
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

        it('renders `0 / limit` for an empty status that has a WIP limit', () => {
            // The `|| 0` fallback at :22 with a GENUINE zero rather than an absent
            // snapshot: the count really is 0, so the suffix must still render.
            // This is the empty-column state the board shows most often, and the
            // Kanban frame (node 1:7) evidences it as "0 / 2".
            const { container } = render(<TaskCounter count={0} wip={4} />);
            const resting = childAt(translator(container), 1);

            expect(restingText(container)).toBe('0 / 4');
            expect(resting.children).toHaveLength(2);
            expect(childAt(resting, 0).textContent).toBe('0');
            expect(childAt(resting, 1).textContent).toBe(' / 4');
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

        it('puts the class on the HOST element, never on the inner box', () => {
            // `&.vertical` is nested directly under `tg-animated-counter` in
            // animated-counter.directive.scss:5-26, so the class has to sit on the
            // host for `.vertical .animated-counter-inner`,
            // `.vertical .counter-translator` and `.vertical .result` to match. The
            // call site puts it there too: `tg-animated-counter(class="vertical" …)`
            // at kanban-table.jade:133-136 and :209-212.
            const { container } = render(<TaskCounter count={6} wip={null} vertical />);

            expect(outermost(container).classList.contains('vertical')).toBe(true);
            expect(innerClass(container)).not.toContain('vertical');
            expect(translatorClass(container)).not.toContain('vertical');
        });

        it('renders the folded call-site shape, which passes no `disabled` binding at all', () => {
            // Both folded call sites bind only `class` and `data`
            // (kanban-table.jade:133-136 and :209-212) -- there is no
            // `disabled="ctrl.renderInProgress"` on either, unlike their expanded
            // counterparts at :126-129 and :202-205. `disabled` must therefore be
            // optional and must default to "not disabled", or the vertical rail
            // would render a permanent 0.
            const { container } = render(<TaskCounter count={6} wip={2} vertical />);

            expect(outermost(container).classList.contains('vertical')).toBe(true);
            expect(restingText(container)).toBe('6 / 2');
            expect(innerClass(container)).toBe(
                'animated-counter-inner wip-amount limit-over',
            );
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

        it('renders a bare count when wip_limit is 0, because the source tests `wip` for truthiness and not for null (Drift D13)', () => {
            // THE quirk of this component, spelled out with a non-zero count so it
            // cannot be confused with the empty-column case above. `data.wip` is
            // read as a boolean in three places -- the `ng-class` at :15 and the
            // `ng-if="X.wip"` guard on each of the three rows at :19, :22 and :25 --
            // and `0` is falsy in all three. A status configured with a WIP limit of
            // zero therefore renders EXACTLY like a status with no limit at all:
            // a bare count, no `wip-amount` class, and no suffix ELEMENT (not merely
            // an empty one). Preserved verbatim under T10; implementing this as
            // `wip !== null` would print " / 0" in production.
            const { container } = render(<TaskCounter count={2} wip={0} />);
            const resting = childAt(translator(container), 1);

            expect(innerClass(container)).not.toContain('wip-amount');
            expect(restingText(container)).toBe('2');
            // One child only: the suffix span is absent from the DOM, not blank.
            expect(resting.children).toHaveLength(1);
            expect(resting.childNodes).toHaveLength(1);
            expect(childAt(resting, 0).getAttribute('class')).toBe('current');
            // Not one row carries a suffix, since `getCounter` copies the same
            // falsy limit onto every snapshot it builds (:51-55).
            rows(container).forEach((row) => {
                expect(row.children).toHaveLength(1);
            });
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

        it('copies the limit onto every snapshot it builds, so both live rows carry the suffix', () => {
            // `getCounter` returns `{current: num, wip: data.wip}` (:51-55) -- the
            // limit is copied onto EVERY counter object, not held once on the
            // resting one. That is why each of the three rows has its own
            // `ng-if="X.wip"` suffix guard rather than sharing a single one, and it
            // is what makes the rolling digits read "1 / 4" -> "2 / 4" instead of
            // the limit vanishing mid-roll.
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);

            const [up, resting, down] = rowTexts(container);

            // Both rows that now hold a snapshot render the suffix...
            expect(up).toBe('2 / 4');
            expect(resting).toBe('1 / 4');
            expect(childAt(translator(container), 0).children).toHaveLength(2);
            expect(childAt(translator(container), 1).children).toHaveLength(2);
            // ...and the one that holds none renders the bare `|| 0` fallback,
            // because an absent snapshot has no `wip` to be truthy.
            expect(down).toBe('0');
            expect(childAt(translator(container), 2).children).toHaveLength(1);
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

        it('never carries `inc` and `dec` together when a reversal lands before the roll completes', () => {
            // The source removes BOTH classes before re-adding either
            // (`counter.removeClass('inc dec')` at :80, then the `$evalAsync` at
            // :82-86 adds exactly one), so the two are mutually exclusive by
            // construction. Here the reversal arrives while the first roll is still
            // only SCHEDULED, which is the case that exercises the deferred
            // promotion's cleanup: the queued `inc` must be cancelled rather than
            // applied alongside the `dec` that superseded it. In the source this is
            // the same guarantee, expressed there as a queued `$evalAsync` callback
            // finding `nextUp` already cleared.
            const { container, rerender } = render(<TaskCounter count={5} wip={4} />);

            rerender(<TaskCounter count={7} wip={4} />);
            // The `inc` is queued but not yet applied.
            expect(translatorClass(container)).toBe('counter-translator');
            expect(jest.getTimerCount()).toBe(1);

            rerender(<TaskCounter count={6} wip={4} />);

            // Still nothing applied, and still exactly one timer: the `inc` one was
            // cleared and replaced rather than left to fire as well.
            expect(translatorClass(container)).toBe('counter-translator');
            expect(jest.getTimerCount()).toBe(1);

            act(() => {
                jest.advanceTimersByTime(1);
            });

            // Exactly one direction survives, and it is the later one.
            const applied = translatorClass(container);
            expect(applied).toBe('counter-translator dec');
            expect(applied).not.toContain('inc');
            // The reversal is measured from the SUPERSEDED value (7), not from the
            // last resting value (5), because branch 4 advanced the baseline before
            // its class was ever applied.
            expect(rowTexts(container)).toEqual(['0', '5 / 4', '6 / 4']);
            // Nothing is left queued behind it.
            expect(jest.getTimerCount()).toBe(0);
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
            expect(translatorClass(container)).toBe('counter-translator');

            rerender(<TaskCounter count={9} wip={4} disabled />);

            // Both `$watch` listeners return before `renderData` (:88-98), so a
            // count change arriving while `ctrl.renderInProgress` is true neither
            // moves the number nor stages a roll.
            expect(restingText(container)).toBe('1 / 4');
            expect(rowTexts(container)[0]).toBe('0');
            // No direction class is applied, and none is scheduled either: an
            // eight-step jump must not roll once the board re-enables.
            expect(translatorClass(container)).toBe('counter-translator');
            expect(translatorClass(container)).not.toContain('inc');
            expect(translatorClass(container)).not.toContain('dec');
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
