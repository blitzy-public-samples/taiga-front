/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { act, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';

import { TaskCounter } from './TaskCounter';
import type { TaskCounterProps } from './TaskCounter';

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

function rowTexts(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.result')).map(
        (row) => row.textContent ?? '',
    );
}

function rows(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.result'));
}

function outermost(container: HTMLElement): Element {
    const element = container.firstElementChild;

    if (element === null) {
        throw new Error('Expected the counter to render an element.');
    }

    return element;
}

function childAt(element: Element, index: number): Element {
    const child = element.children[index];

    if (child === undefined) {
        throw new Error(`Expected a child at index ${index} of <${element.tagName}>.`);
    }

    return child;
}

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
            expect(container.querySelectorAll('.result')).toHaveLength(3);
        });

        it('makes the `<tg-animated-counter>` host the OUTERMOST node', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);

            expect(outermost(container).tagName.toLowerCase()).toBe('tg-animated-counter');
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

            Array.from(translatorElement.children).forEach((row) => {
                expect(row.tagName).toBe('DIV');
                expect(row.classList.contains('result')).toBe(true);
            });
        });

        it('opens every row with a `span.current`, not only the resting one', () => {
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

            expect(currents).toEqual(['0', '7', '0']);
        });

        it('keeps the space INSIDE the suffix span, with no text node between siblings', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);
            const row = Array.from(container.querySelectorAll<HTMLElement>('.result'))[1];

            expect(row).toBeDefined();
            expect(row?.children).toHaveLength(2);
            expect(row?.children[0]?.getAttribute('class')).toBe('current');
            expect(row?.children[0]?.textContent).toBe('1');
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
            const { container } = render(<TaskCounter count={0} wip={4} />);
            const resting = childAt(translator(container), 1);

            expect(restingText(container)).toBe('0 / 4');
            expect(resting.children).toHaveLength(2);
            expect(childAt(resting, 0).textContent).toBe('0');
            expect(childAt(resting, 1).textContent).toBe(' / 4');
        });

        it('renders `0` for a row that holds no snapshot', () => {
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
            const { container } = render(<TaskCounter count={6} wip={null} vertical />);

            expect(outermost(container).classList.contains('vertical')).toBe(true);
            expect(innerClass(container)).not.toContain('vertical');
            expect(translatorClass(container)).not.toContain('vertical');
        });

        it('renders the folded call-site shape, which passes no `disabled` binding at all', () => {
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
            expect(restingText(container)).toBe('0');
        });

        it('renders a bare count when wip_limit is 0, because the source tests `wip` for truthiness and not for null (Drift D13)', () => {
            const { container } = render(<TaskCounter count={2} wip={0} />);
            const resting = childAt(translator(container), 1);

            expect(innerClass(container)).not.toContain('wip-amount');
            expect(restingText(container)).toBe('2');
            expect(resting.children).toHaveLength(1);
            expect(resting.childNodes).toHaveLength(1);
            expect(childAt(resting, 0).getAttribute('class')).toBe('current');
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

            expect(restingText(container)).toBe('2 / 3');
        });

        it('clears both pending rows so no stale roll target survives', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);
            expect(rowTexts(container)[0]).toBe('2 / 4');

            rerender(<TaskCounter count={2} wip={9} />);

            const [up, resting, down] = rowTexts(container);

            expect(up).toBe('0');
            expect(down).toBe('0');
            expect(resting).toBe('1 / 4');
        });

        it('does not re-enter the value machine when only `vertical` changes', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);
            expect(rowTexts(container)).toEqual(['2 / 4', '1 / 4', '0']);

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

            expect(translatorClass(container)).toBe('counter-translator');
            expect(rowTexts(container)).toEqual(['2 / 4', '1 / 4', '0']);

            act(() => {
                jest.advanceTimersByTime(1);
            });

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
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={4} />);

            const [up, resting, down] = rowTexts(container);

            expect(up).toBe('2 / 4');
            expect(resting).toBe('1 / 4');
            expect(childAt(translator(container), 0).children).toHaveLength(2);
            expect(childAt(translator(container), 1).children).toHaveLength(2);
            expect(down).toBe('0');
            expect(childAt(translator(container), 2).children).toHaveLength(1);
        });

        it('captures the CURRENT limit in the staged snapshot, not the previous one', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            rerender(<TaskCounter count={2} wip={9} />);

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
            const { container, rerender } = render(<TaskCounter count={5} wip={4} />);

            rerender(<TaskCounter count={7} wip={4} />);
            expect(translatorClass(container)).toBe('counter-translator');
            expect(jest.getTimerCount()).toBe(1);

            rerender(<TaskCounter count={6} wip={4} />);

            expect(translatorClass(container)).toBe('counter-translator');
            expect(jest.getTimerCount()).toBe(1);

            act(() => {
                jest.advanceTimersByTime(1);
            });

            const applied = translatorClass(container);
            expect(applied).toBe('counter-translator dec');
            expect(applied).not.toContain('inc');
            expect(rowTexts(container)).toEqual(['0', '5 / 4', '6 / 4']);
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

            expect(rowTexts(container)[0]).toBe('2 / 4');
            expect(rowTexts(container)[1]).toBe('2 / 4');
        });

        it('is harmless when no roll is in flight', () => {
            const { container } = render(<TaskCounter count={1} wip={4} />);

            fireEvent.transitionEnd(translator(container));

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

            expect(innerClass(container)).toBe(
                'animated-counter-inner wip-amount limit-over',
            );
        });

        it('freezes the rendered value while the board re-renders', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} />);

            expect(restingText(container)).toBe('1 / 4');
            expect(translatorClass(container)).toBe('counter-translator');

            rerender(<TaskCounter count={9} wip={4} disabled />);

            expect(restingText(container)).toBe('1 / 4');
            expect(rowTexts(container)[0]).toBe('0');
            expect(translatorClass(container)).toBe('counter-translator');
            expect(translatorClass(container)).not.toContain('inc');
            expect(translatorClass(container)).not.toContain('dec');
        });

        it('lands the pending value once re-enabled', () => {
            const { container, rerender } = render(<TaskCounter count={1} wip={4} disabled />);

            expect(restingText(container)).toBe('0');

            rerender(<TaskCounter count={1} wip={4} />);

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

                expect(translatorClass(container)).toBe('counter-translator inc');
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('StrictMode safety', () => {
        it('mounts correctly when React double-invokes effects', () => {
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
