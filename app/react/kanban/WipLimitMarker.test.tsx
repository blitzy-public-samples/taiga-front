/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * WipLimitMarker.test.tsx -- co-located spec for the WIP-limit rule
 * ==========================================================================
 *
 * Browserless (HR-5): jsdom only, no browser, no network, no dependency on
 * `dist/`.
 *
 * `KanbanWipLimitDirective` (app/coffee/modules/kanban/main.coffee L1069-L1105)
 * decided WHICH marker to show and WHERE to put it by measuring the DOM. The
 * port splits that into two pure functions plus a presentational component, so
 * the arithmetic is assertable without a board. These specs hold the port to the
 * directive's exact semantics:
 *
 *   - the archived gate wins over every limit value (L1096);
 *   - the ladder is tested in the source's order -- `one-left`, then `reached`,
 *     then `exceeded` (L1080-L1088);
 *   - `exceeded` positions the rule at a DIFFERENT index from the other two
 *     (L1088 vs L1082/L1085), which is what pushes the surplus cards below it;
 *   - a matched branch whose index addresses no card renders NOTHING, which is
 *     the guard at L1092 and the reason an empty column and a zero limit are
 *     both silent.
 *
 * Appearance is asserted only as class names: the three states are styled
 * entirely by the unedited kanban-table.scss, so a class-name contract is the
 * whole of the visual contract (rule T1).
 * ========================================================================== */

import { render, screen } from '@testing-library/react';

import {
    WipLimitMarker,
    resolveWipLimitIndex,
    resolveWipLimitState,
} from './WipLimitMarker';
import type { WipLimitMarkerProps, WipLimitState } from './WipLimitMarker';

/** Every state the port can resolve, guarded against silent drift. */
const ALL_STATES = ['one-left', 'reached', 'exceeded'] as const satisfies readonly WipLimitState[];

describe('resolveWipLimitState', () => {
    describe('the archived gate (main.coffee L1096)', () => {
        it.each([
            ['one-left', 3, 4],
            ['reached', 4, 4],
            ['exceeded', 9, 4],
        ])(
            'renders no marker on the archived status even where a column would be %s',
            (_label, cardCount, wipLimit) => {
                expect(resolveWipLimitState(cardCount, wipLimit, true)).toBeUndefined();
            },
        );

        it('wins over a limit value, checked before any arithmetic', () => {
            // Same inputs, only the archived flag differs.
            expect(resolveWipLimitState(4, 4, false)).toBe('reached');
            expect(resolveWipLimitState(4, 4, true)).toBeUndefined();
        });
    });

    describe('a status with no configured limit', () => {
        it.each([0, 1, 2, 6, 99])('renders no marker for a column of %i cards', (cardCount) => {
            expect(resolveWipLimitState(cardCount, null, false)).toBeUndefined();
        });
    });

    describe('the three-branch ladder (main.coffee L1080-L1088)', () => {
        it('resolves `one-left` when one more card would reach the limit', () => {
            // The board frame's "2 / 3" swimlane column.
            expect(resolveWipLimitState(2, 3, false)).toBe('one-left');
            expect(resolveWipLimitState(3, 4, false)).toBe('one-left');
        });

        it('resolves `reached` when the count equals the limit', () => {
            // The board frame's "2 / 2" swimlane column.
            expect(resolveWipLimitState(2, 2, false)).toBe('reached');
            expect(resolveWipLimitState(4, 4, false)).toBe('reached');
        });

        it('resolves `exceeded` when the count is strictly greater than the limit', () => {
            expect(resolveWipLimitState(3, 2, false)).toBe('exceeded');
            expect(resolveWipLimitState(9, 4, false)).toBe('exceeded');
        });

        it('renders no marker while the column is comfortably under its limit', () => {
            expect(resolveWipLimitState(0, 4, false)).toBeUndefined();
            expect(resolveWipLimitState(1, 4, false)).toBeUndefined();
            expect(resolveWipLimitState(2, 4, false)).toBeUndefined();
        });

        it('tests `one-left` before `reached`, preserving the source order', () => {
            // A limit of 1 holding 0 cards satisfies `count + 1 === limit`. It
            // resolves nothing only because the index guard rejects it -- NOT
            // because `reached` was consulted first. A limit of 2 holding 1 card
            // is the same branch with a valid index, which proves the ordering.
            expect(resolveWipLimitState(1, 2, false)).toBe('one-left');
        });
    });

    describe('the index guard (main.coffee L1092)', () => {
        it('renders no marker on an empty column whose limit is 1', () => {
            // Matches `one-left`, but the rule would follow card index -1.
            expect(resolveWipLimitState(0, 1, false)).toBeUndefined();
        });

        it('renders no marker on an empty column whose limit is 0', () => {
            // Matches `reached`, index -1.
            expect(resolveWipLimitState(0, 0, false)).toBeUndefined();
        });

        it('renders no marker for a zero limit holding cards', () => {
            // Matches `exceeded`, but `wipLimit - 1` is -1.
            expect(resolveWipLimitState(1, 0, false)).toBeUndefined();
            expect(resolveWipLimitState(7, 0, false)).toBeUndefined();
        });

        it('admits the smallest column that has a card to sit above', () => {
            expect(resolveWipLimitState(1, 1, false)).toBe('reached');
            expect(resolveWipLimitIndex(1, 1, 'reached')).toBe(0);
        });
    });

    it('returns only states the component can render', () => {
        const resolved = [
            resolveWipLimitState(2, 3, false),
            resolveWipLimitState(2, 2, false),
            resolveWipLimitState(9, 4, false),
        ];

        resolved.forEach((state) => {
            expect(ALL_STATES).toContain(state);
        });
    });
});

describe('resolveWipLimitIndex', () => {
    it('positions `one-left` and `reached` after the final card', () => {
        expect(resolveWipLimitIndex(3, 4, 'one-left')).toBe(2);
        expect(resolveWipLimitIndex(4, 4, 'reached')).toBe(3);
    });

    it('positions `exceeded` after the last PERMITTED card, not the last card', () => {
        // main.coffee L1088. This is what pushes the surplus below the rule, and
        // it is the one index that does not depend on the column's length.
        expect(resolveWipLimitIndex(9, 4, 'exceeded')).toBe(3);
        expect(resolveWipLimitIndex(5, 4, 'exceeded')).toBe(3);
        expect(resolveWipLimitIndex(100, 4, 'exceeded')).toBe(3);
    });

    it('ignores the card count entirely when the state is `exceeded`', () => {
        const indices = [5, 6, 7, 40].map((cardCount) =>
            resolveWipLimitIndex(cardCount, 4, 'exceeded'),
        );

        expect(new Set(indices).size).toBe(1);
    });

    it('returns a negative index rather than clamping it', () => {
        // Documented and relied upon: `resolveWipLimitState` uses exactly this
        // to reject a matched branch that addresses no card.
        expect(resolveWipLimitIndex(0, 1, 'one-left')).toBe(-1);
        expect(resolveWipLimitIndex(0, 0, 'reached')).toBe(-1);
        expect(resolveWipLimitIndex(1, 0, 'exceeded')).toBe(-1);
    });

    it('agrees with the index that `resolveWipLimitState` admitted', () => {
        const cardCount = 9;
        const wipLimit = 4;
        const state = resolveWipLimitState(cardCount, wipLimit, false);

        expect(state).toBe('exceeded');

        const index = resolveWipLimitIndex(cardCount, wipLimit, state as WipLimitState);

        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(cardCount);
    });
});

describe('WipLimitMarker', () => {
    it.each(ALL_STATES)('emits `kanban-wip-limit` first and `%s` second', (state) => {
        const { container } = render(<WipLimitMarker state={state} />);
        const marker = container.firstElementChild;

        expect(marker).not.toBeNull();
        // Order matters: it is the order of the string the directive injected at
        // main.coffee L1093 (rule T1).
        expect(marker?.getAttribute('class')).toBe(`kanban-wip-limit ${state}`);
    });

    it('renders a DIV holding exactly one bare SPAN', () => {
        const { container } = render(<WipLimitMarker state="reached" />);
        const marker = container.firstElementChild as HTMLElement;

        expect(marker.tagName).toBe('DIV');
        expect(marker.children).toHaveLength(1);

        const chip = marker.children[0] as HTMLElement;

        expect(chip.tagName).toBe('SPAN');
        // kanban-table.scss L270-L281 selects a plain descendant `span`; a class
        // of its own or an extra wrapper would leave the chip unstyled.
        expect(chip).not.toHaveAttribute('class');
        expect(chip.children).toHaveLength(0);
    });

    it('renders the fixed label "WIP Limit" with a capital L', () => {
        render(<WipLimitMarker state="one-left" />);

        expect(screen.getByText('WIP Limit')).toBeInTheDocument();
    });

    it('adds no icon, no title and no ARIA attribute', () => {
        const { container } = render(<WipLimitMarker state="exceeded" />);
        const marker = container.firstElementChild as HTMLElement;

        expect(marker.querySelector('svg')).toBeNull();
        expect(marker).not.toHaveAttribute('title');
        expect(marker).not.toHaveAttribute('role');
        expect(marker).not.toHaveAttribute('aria-label');
        // Two attributes only would still be one too many: only `class` is set.
        expect(marker.getAttributeNames()).toEqual(['class']);
    });

    it('renders identical markup for the same state, holding no internal state', () => {
        const first = render(<WipLimitMarker state="reached" />);
        const firstHtml = first.container.innerHTML;
        first.unmount();

        const second = render(<WipLimitMarker state="reached" />);

        expect(second.container.innerHTML).toBe(firstHtml);
    });

    it('accepts the state resolved for a column end to end', () => {
        const state = resolveWipLimitState(2, 2, false);

        expect(state).toBeDefined();

        const props: WipLimitMarkerProps = { state: state as WipLimitState };
        const { container } = render(<WipLimitMarker {...props} />);

        expect(container.firstElementChild?.getAttribute('class')).toBe(
            'kanban-wip-limit reached',
        );
    });
});
