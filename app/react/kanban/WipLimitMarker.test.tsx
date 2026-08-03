/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { render } from '@testing-library/react';

import {
    WipLimitMarker,
    resolveWipLimitIndex,
    resolveWipLimitState,
} from './WipLimitMarker';
import type { WipLimitMarkerProps, WipLimitState } from './WipLimitMarker';

const ALL_STATES = ['one-left', 'reached', 'exceeded'] as const satisfies readonly WipLimitState[];

const CHIP_LABEL = 'WIP Limit';

const MARKER_CLASS = 'kanban-wip-limit';

const q = (root: HTMLElement, sel: string): HTMLElement => {
    const el = root.querySelector<HTMLElement>(sel);

    if (el === null) {
        throw new Error(`missing selector: ${sel}`);
    }

    return el;
};

const all = (root: HTMLElement, sel: string): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(sel));

const renderColumnMarker = (
    cardCount: number,
    wipLimit: number | null,
    isArchived: boolean,
): HTMLElement => {
    const state = resolveWipLimitState(cardCount, wipLimit, isArchived);

    const { container } = render(
        <>{state === undefined ? null : <WipLimitMarker state={state} />}</>,
    );

    return container;
};

const stateClassesOn = (element: HTMLElement): WipLimitState[] =>
    ALL_STATES.filter((candidate) => element.classList.contains(candidate));

interface StateCase {
    readonly name: string;
    readonly cardCount: number;
    readonly wipLimit: number | null;
    readonly isArchived: boolean;
    readonly expected: WipLimitState | undefined;
}

const STATE_CASES: readonly StateCase[] = [
    {
        name: 'resolves `one-left` when exactly one more card would reach the limit',
        cardCount: 3,
        wipLimit: 4,
        isArchived: false,
        expected: 'one-left',
    },
    {
        name: 'resolves `reached` when the count equals the limit',
        cardCount: 4,
        wipLimit: 4,
        isArchived: false,
        expected: 'reached',
    },
    {
        name: 'resolves `exceeded` when the count is one past the limit',
        cardCount: 5,
        wipLimit: 4,
        isArchived: false,
        expected: 'exceeded',
    },
    {
        name: 'resolves `exceeded` when the count is far past the limit',
        cardCount: 9,
        wipLimit: 4,
        isArchived: false,
        expected: 'exceeded',
    },

    {
        name: 'resolves nothing while the column is two cards short of its limit',
        cardCount: 2,
        wipLimit: 4,
        isArchived: false,
        expected: undefined,
    },
    {
        name: 'resolves nothing while the column is three cards short of its limit',
        cardCount: 1,
        wipLimit: 4,
        isArchived: false,
        expected: undefined,
    },
    {
        name: 'resolves nothing on an empty column with a comfortable limit',
        cardCount: 0,
        wipLimit: 4,
        isArchived: false,
        expected: undefined,
    },

    {
        name: 'resolves `one-left` at a limit of 2 holding one card',
        cardCount: 1,
        wipLimit: 2,
        isArchived: false,
        expected: 'one-left',
    },
    {
        name: 'resolves `reached` at a limit of 1 holding one card',
        cardCount: 1,
        wipLimit: 1,
        isArchived: false,
        expected: 'reached',
    },
    {
        name: 'resolves `exceeded` at a limit of 1 holding two cards',
        cardCount: 2,
        wipLimit: 1,
        isArchived: false,
        expected: 'exceeded',
    },

    {
        name: 'resolves nothing on an empty column whose limit is 1, though `one-left` matches',
        cardCount: 0,
        wipLimit: 1,
        isArchived: false,
        expected: undefined,
    },
    {
        name: 'resolves nothing on an empty column whose limit is 0, though `reached` matches',
        cardCount: 0,
        wipLimit: 0,
        isArchived: false,
        expected: undefined,
    },
    {
        name: 'resolves nothing at a limit of 0 holding one card, though `exceeded` matches',
        cardCount: 1,
        wipLimit: 0,
        isArchived: false,
        expected: undefined,
    },
    {
        name: 'resolves nothing at a limit of 0 holding three cards, though `exceeded` matches',
        cardCount: 3,
        wipLimit: 0,
        isArchived: false,
        expected: undefined,
    },
    {
        name: 'resolves nothing at a limit of 0 holding seven cards, though `exceeded` matches',
        cardCount: 7,
        wipLimit: 0,
        isArchived: false,
        expected: undefined,
    },

    {
        name: 'resolves nothing on an unlimited empty column',
        cardCount: 0,
        wipLimit: null,
        isArchived: false,
        expected: undefined,
    },
    {
        name: 'resolves nothing on an unlimited column holding one card',
        cardCount: 1,
        wipLimit: null,
        isArchived: false,
        expected: undefined,
    },
    {
        name: 'resolves nothing on an unlimited column holding two cards',
        cardCount: 2,
        wipLimit: null,
        isArchived: false,
        expected: undefined,
    },
    {
        name: 'resolves nothing on an unlimited column holding six cards',
        cardCount: 6,
        wipLimit: null,
        isArchived: false,
        expected: undefined,
    },
    {
        name: 'resolves nothing on an unlimited column holding seven cards',
        cardCount: 7,
        wipLimit: null,
        isArchived: false,
        expected: undefined,
    },

    {
        name: 'resolves nothing on the archived status where `one-left` would otherwise match',
        cardCount: 3,
        wipLimit: 4,
        isArchived: true,
        expected: undefined,
    },
    {
        name: 'resolves nothing on the archived status where `reached` would otherwise match',
        cardCount: 4,
        wipLimit: 4,
        isArchived: true,
        expected: undefined,
    },
    {
        name: 'resolves nothing on the archived status where `exceeded` would otherwise match',
        cardCount: 5,
        wipLimit: 4,
        isArchived: true,
        expected: undefined,
    },
    {
        name: 'resolves nothing on the archived status with no configured limit',
        cardCount: 9,
        wipLimit: null,
        isArchived: true,
        expected: undefined,
    },
];

describe('resolveWipLimitState', () => {
    it.each(STATE_CASES)('$name', ({ cardCount, wipLimit, isArchived, expected }) => {
        expect(resolveWipLimitState(cardCount, wipLimit, isArchived)).toBe(expected);
    });

    it('resolves `one-left` for swimlane "autem quas", whose NEW column reads 2 / 3', () => {
        expect(resolveWipLimitState(2, 3, false)).toBe('one-left');
    });

    it('resolves `reached` for swimlane "hic ut", whose NEW column reads 2 / 2', () => {
        expect(resolveWipLimitState(2, 2, false)).toBe('reached');
    });

    it('draws nothing on the frame columns that read 1 / 4 and 0 / 2', () => {
        expect(resolveWipLimitState(1, 4, false)).toBeUndefined();
        expect(resolveWipLimitState(0, 2, false)).toBeUndefined();
    });

    it('assigns each rung of the ladder the branch the source gave it', () => {
        expect(resolveWipLimitState(4, 5, false)).toBe('one-left');
        expect(resolveWipLimitState(5, 5, false)).toBe('reached');
        expect(resolveWipLimitState(6, 5, false)).toBe('exceeded');
    });

    it('lets the archived gate win over an otherwise loud limit', () => {
        expect(resolveWipLimitState(4, 4, false)).toBe('reached');
        expect(resolveWipLimitState(4, 4, true)).toBeUndefined();
    });

    it('returns only states the component is able to render', () => {
        const resolved = [
            resolveWipLimitState(2, 3, false),
            resolveWipLimitState(2, 2, false),
            resolveWipLimitState(9, 4, false),
        ];

        resolved.forEach((state) => {
            expect(ALL_STATES).toContain(state);
        });
    });

    it('is pure: repeated calls agree and no DOM node is touched', () => {
        const before = document.body.innerHTML;

        expect(resolveWipLimitState(9, 4, false)).toBe(resolveWipLimitState(9, 4, false));
        expect(document.body.innerHTML).toBe(before);
    });
});

describe('resolveWipLimitIndex', () => {
    it('positions `one-left` after the final card', () => {
        expect(resolveWipLimitIndex(3, 4, 'one-left')).toBe(2);
        expect(resolveWipLimitIndex(1, 2, 'one-left')).toBe(0);
    });

    it('positions `reached` after the final card', () => {
        expect(resolveWipLimitIndex(4, 4, 'reached')).toBe(3);
        expect(resolveWipLimitIndex(1, 1, 'reached')).toBe(0);
    });

    it('positions `exceeded` after the last PERMITTED card, not after the last card', () => {
        expect(resolveWipLimitIndex(5, 4, 'exceeded')).toBe(3);
        expect(resolveWipLimitIndex(5, 4, 'exceeded')).not.toBe(4);
    });

    it('derives the `exceeded` index from the limit rather than from the count', () => {
        expect(resolveWipLimitIndex(9, 2, 'exceeded')).toBe(1);
        expect(resolveWipLimitIndex(100, 4, 'exceeded')).toBe(3);
    });

    it('ignores the card count entirely while the state is `exceeded`', () => {
        const indices = [5, 6, 7, 40].map((cardCount) =>
            resolveWipLimitIndex(cardCount, 4, 'exceeded'),
        );

        expect(new Set(indices).size).toBe(1);
        expect(indices).toEqual([3, 3, 3, 3]);
    });

    it('returns a negative index rather than clamping it', () => {
        expect(resolveWipLimitIndex(0, 1, 'one-left')).toBe(-1);
        expect(resolveWipLimitIndex(0, 0, 'reached')).toBe(-1);
        expect(resolveWipLimitIndex(1, 0, 'exceeded')).toBe(-1);
        expect(resolveWipLimitIndex(3, 0, 'exceeded')).toBe(-1);
    });

    it('is never reached for a status with no configured limit', () => {
        expect(resolveWipLimitState(0, null, false)).toBeUndefined();
        expect(resolveWipLimitState(1, null, false)).toBeUndefined();
        expect(resolveWipLimitState(7, null, false)).toBeUndefined();
    });

    it('is pure: repeated calls agree and no DOM node is touched', () => {
        const before = document.body.innerHTML;

        const first = resolveWipLimitIndex(9, 4, 'exceeded');
        const second = resolveWipLimitIndex(9, 4, 'exceeded');

        expect(second).toBe(first);
        expect(document.body.innerHTML).toBe(before);
        expect(document.body.querySelector(`.${MARKER_CLASS}`)).toBeNull();
    });

    it('agrees with every index that `resolveWipLimitState` admitted', () => {
        const admitted: ReadonlyArray<readonly [number, number]> = [
            [3, 4],
            [4, 4],
            [5, 4],
            [9, 2],
            [1, 1],
        ];

        admitted.forEach(([cardCount, wipLimit]) => {
            const state = resolveWipLimitState(cardCount, wipLimit, false);

            expect(state).toBeDefined();

            if (state === undefined) {
                return;
            }

            const index = resolveWipLimitIndex(cardCount, wipLimit, state);

            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(cardCount);
        });
    });
});

describe('WipLimitMarker', () => {
    describe('the class contract (rule T1)', () => {
        it.each(ALL_STATES)('carries `kanban-wip-limit` together with `%s`', (state) => {
            const { container } = render(<WipLimitMarker state={state} />);
            const marker = q(container, `.${MARKER_CLASS}`);

            expect(marker).toHaveClass(MARKER_CLASS, state);
            expect(marker.classList).toHaveLength(2);
        });

        it.each(ALL_STATES)('carries `%s` as its ONLY state class', (state) => {
            const { container } = render(<WipLimitMarker state={state} />);
            const marker = q(container, `.${MARKER_CLASS}`);

            expect(stateClassesOn(marker)).toEqual([state]);
        });

        it('never lets one state class leak into another', () => {
            const oneLeft = q(
                render(<WipLimitMarker state="one-left" />).container,
                `.${MARKER_CLASS}`,
            );

            expect(oneLeft).toHaveClass('one-left');
            expect(oneLeft).not.toHaveClass('reached');
            expect(oneLeft).not.toHaveClass('exceeded');

            const exceeded = q(
                render(<WipLimitMarker state="exceeded" />).container,
                `.${MARKER_CLASS}`,
            );

            expect(exceeded).toHaveClass('exceeded');
            expect(exceeded).not.toHaveClass('reached');
            expect(exceeded).not.toHaveClass('one-left');
        });
    });

    describe('the markup and its fixed label (Drift Register entry D5)', () => {
        it('renders a DIV holding exactly one bare SPAN', () => {
            const { container } = render(<WipLimitMarker state="reached" />);
            const marker = q(container, `.${MARKER_CLASS}`);

            expect(marker.tagName).toBe('DIV');
            expect(all(marker, 'span')).toHaveLength(1);

            expect(q(marker, 'span')).not.toHaveAttribute('class');
        });

        it('labels the chip with the literal "WIP Limit", capital L and untranslated', () => {
            const { container } = render(<WipLimitMarker state="one-left" />);
            const chip = q(container, `.${MARKER_CLASS} span`);

            expect(chip.textContent).toBe(CHIP_LABEL);
            expect(chip.textContent).toBe('WIP Limit');
        });

        it('puts the label inside the span and nowhere else', () => {
            const { container } = render(<WipLimitMarker state="exceeded" />);
            const marker = q(container, `.${MARKER_CLASS}`);

            expect(marker.textContent).toBe(CHIP_LABEL);
        });

        it('adds no icon and no nested element beyond the span', () => {
            const { container } = render(<WipLimitMarker state="exceeded" />);
            const marker = q(container, `.${MARKER_CLASS}`);

            expect(all(marker, '*')).toHaveLength(1);
            expect(marker.querySelector('svg')).toBeNull();
            expect(marker.querySelector('tg-svg')).toBeNull();
            expect(marker.querySelector('div')).toBeNull();
        });

        it('sets no attribute other than `class`', () => {
            const { container } = render(<WipLimitMarker state="reached" />);
            const marker = q(container, `.${MARKER_CLASS}`);

            expect(marker.getAttributeNames()).toEqual(['class']);
            expect(q(container, `.${MARKER_CLASS} span`).getAttributeNames()).toEqual([]);
        });
    });

    it('renders identical markup for the same state, holding no internal state', () => {
        const first = render(<WipLimitMarker state="reached" />);
        const firstHtml = first.container.innerHTML;

        first.unmount();

        const second = render(<WipLimitMarker state="reached" />);

        expect(second.container.innerHTML).toBe(firstHtml);
    });

    it('accepts the props object a column builds from the resolved state', () => {
        const state = resolveWipLimitState(2, 2, false);

        expect(state).toBeDefined();

        if (state === undefined) {
            throw new Error('the "hic ut" configuration must resolve a state');
        }

        const props: WipLimitMarkerProps = { state };
        const { container } = render(<WipLimitMarker {...props} />);
        const marker = q(container, `.${MARKER_CLASS}`);

        expect(stateClassesOn(marker)).toEqual(['reached']);
        expect(q(marker, 'span').textContent).toBe(CHIP_LABEL);
    });
});

const NO_MARKER_CASES: readonly StateCase[] = STATE_CASES.filter(
    (testCase) => testCase.expected === undefined,
);

const MARKER_CASES: readonly StateCase[] = STATE_CASES.filter(
    (testCase) => testCase.expected !== undefined,
);

describe('the column contract', () => {
    it.each(NO_MARKER_CASES)(
        'renders NO rule for $cardCount card(s) against limit $wipLimit (archived: $isArchived)',
        ({ cardCount, wipLimit, isArchived }) => {
            const container = renderColumnMarker(cardCount, wipLimit, isArchived);

            expect(container.querySelector(`.${MARKER_CLASS}`)).toBeNull();
            expect(container.childElementCount).toBe(0);
            expect(container.textContent).toBe('');
        },
    );

    it.each(MARKER_CASES)(
        'renders the $expected rule for $cardCount card(s) against limit $wipLimit',
        ({ cardCount, wipLimit, isArchived, expected }) => {
            const container = renderColumnMarker(cardCount, wipLimit, isArchived);
            const marker = q(container, `.${MARKER_CLASS}`);

            expect(marker).toHaveClass(MARKER_CLASS);
            expect(stateClassesOn(marker)).toEqual([expected]);
            expect(q(marker, 'span').textContent).toBe(CHIP_LABEL);
        },
    );

    it('renders at most one rule per column', () => {
        const container = renderColumnMarker(9, 4, false);

        expect(all(container, `.${MARKER_CLASS}`)).toHaveLength(1);
    });

    it('renders no rule on an unlimited column at any card count', () => {
        [0, 1, 2, 3, 6, 7, 20].forEach((cardCount) => {
            const container = renderColumnMarker(cardCount, null, false);

            expect(container.querySelector(`.${MARKER_CLASS}`)).toBeNull();
        });
    });

    it('renders no rule on the archived status at any card count', () => {
        [0, 1, 3, 4, 5, 9].forEach((cardCount) => {
            const container = renderColumnMarker(cardCount, 4, true);

            expect(container.querySelector(`.${MARKER_CLASS}`)).toBeNull();
        });
    });

    it('crosses from silence to a rule exactly at the documented thresholds', () => {
        const walked = [0, 1, 2, 3, 4, 5].map((cardCount): WipLimitState | null => {
            const container = renderColumnMarker(cardCount, 3, false);
            const marker = container.querySelector<HTMLElement>(`.${MARKER_CLASS}`);

            if (marker === null) {
                return null;
            }

            const [stateClass] = stateClassesOn(marker);

            return stateClass ?? null;
        });

        expect(walked).toEqual([
            null,
            null,
            'one-left',
            'reached',
            'exceeded',
            'exceeded',
        ]);
    });
});
