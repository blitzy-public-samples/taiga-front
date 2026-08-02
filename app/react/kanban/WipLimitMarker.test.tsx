/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * WipLimitMarker.test.tsx — co-located spec for the Kanban WIP-limit rule
 * ==========================================================================
 *
 * Runs browserless in jsdom (constraint HR-5): no browser binary, no network,
 * no dependency on any generated build output. `npm test` executes this file
 * straight from TypeScript source.
 *
 * WHAT IS UNDER TEST, AND WHAT DELIBERATELY IS NOT
 * ------------------------------------------------
 * The incumbent implementation is `KanbanWipLimitDirective`
 * (app/coffee/modules/kanban/main.coffee L815-L853 in the pre-migration tree,
 * retained in that file as the authoritative behavioural reference after its
 * registration was retired). It fused three separable concerns into one
 * imperative callback: WHEN to recompute, WHICH threshold had been crossed, and
 * WHERE in the column the rule belonged.
 *
 * The React port splits them, and this spec covers exactly two of the three:
 *
 *   WHICH — `resolveWipLimitState(cardCount, wipLimit, isArchived)`
 *   WHERE — `resolveWipLimitIndex(cardCount, wipLimit, state)`
 *   plus  — `<WipLimitMarker state={…} />`, the markup those two decide upon.
 *
 * All three are PURE FUNCTIONS OF (cardCount, wipLimit, isArchived). They read
 * no service, subscribe to nothing, schedule nothing and persist nothing —
 * neither did the directive, which only ever computed and injected.
 *
 * WHEN is somebody else's file, and this spec asserts nothing about it
 * (transformation rule T9, so a reader does not come here looking for event
 * wiring). The directive learned that the card count had changed by listening
 * for four broadcasts — `redraw:wip`, `kanban:us:move`, `usform:new:success`
 * and `usform:bulk:success` (main.coffee L843-L846) — and by receiving a
 * `redraw:wip` deferred 100 ms after a swimlane was toggled (main.coffee
 * L328-L334). It then deferred the work a tick with `$timeout(…, 0, false)`,
 * the trailing `false` suppressing a digest. In React a changed count is a
 * changed prop, so recomputation IS the render; whatever scheduling remains
 * belongs to `hooks/useWipLimit.ts` and `StatusColumn.tsx` and is asserted
 * there. Nothing in this file simulates a broadcast, and nothing in this file
 * asserts persistence, because neither the hook nor this component persists
 * anything.
 *
 * THERE IS NO `folded` CASE TO TEST
 * ---------------------------------
 * A folded column hides its marker entirely through the cascade:
 * app/styles/modules/kanban/kanban-table.scss L79-L81 declares
 * `.vfold .kanban-wip-limit { display: none; }`. That is why the component
 * accepts no `folded` prop and why this spec neither requires suppression on
 * fold nor asserts `display`. jsdom loads no stylesheet, so such an assertion
 * could only ever be theatre.
 *
 * APPEARANCE IS ASSERTED ONLY AS CLASS NAMES (rules T1, T2, gaps G-DS-3/G-DS-4)
 * ----------------------------------------------------------------------------
 * kanban-table.scss L264-L299 already declares every visual property of all
 * three states — the box geometry and radius, the chip's colours and centring
 * transform, the top rule shared by `reached` and `one-left`, the reduced
 * strength that makes `one-left` read as a softer tint of the same red, and the
 * second rule along the bottom edge that marks `exceeded`. That file stays at
 * zero edits, so emitting the right class names is the whole of the visual
 * contract. Accordingly this spec asserts NO colour, height, border, margin,
 * opacity, offset or transform anywhere: those belong to the stylesheet, and
 * `getComputedStyle` in jsdom would report nothing about them regardless.
 *
 * NO SNAPSHOTS
 * ------------
 * The class-name contract is the point of these assertions, and a snapshot
 * would bury it in an opaque blob that a careless update silently rewrites.
 * Every expectation below names what it checks.
 * ========================================================================== */

import { render } from '@testing-library/react';

import {
    WipLimitMarker,
    resolveWipLimitIndex,
    resolveWipLimitState,
} from './WipLimitMarker';
import type { WipLimitMarkerProps, WipLimitState } from './WipLimitMarker';

/* --------------------------------------------------------------------------
 * Fixtures and query helpers.
 *
 * Fixtures are plain numbers, booleans and object literals throughout. The port
 * flattens board state at the AngularJS/React seam, so nothing under app/react
 * ever sees an immutable collection and no such structure is constructed here.
 *
 * The marker exposes no test id — deliberately, since the directive emitted no
 * attribute beyond `class` — so it is queried by the very class name that forms
 * its contract with the unedited stylesheet.
 * -------------------------------------------------------------------------- */

/**
 * Every state the port can resolve, in the source's ladder order. Guards against
 * silent drift: if a member is ever renamed, `satisfies` fails the type-check
 * rather than leaving the marker quietly unstyled.
 */
const ALL_STATES = ['one-left', 'reached', 'exceeded'] as const satisfies readonly WipLimitState[];

/** The chip label, verbatim from main.coffee L839. See Drift Register entry D5. */
const CHIP_LABEL = 'WIP Limit';

/** The class every marker carries, from the same injected string. */
const MARKER_CLASS = 'kanban-wip-limit';

/**
 * Strict-safe single-element query. `querySelector` is typed as nullable, and
 * `strict` will not let that nullability be ignored; throwing here keeps every
 * call site free of casts and turns a missing element into a named failure
 * instead of a downstream `TypeError`.
 *
 * Mirrors the `mustFind` helper of the sibling TaskCounter spec.
 */
const q = (root: HTMLElement, sel: string): HTMLElement => {
    const el = root.querySelector<HTMLElement>(sel);

    if (el === null) {
        throw new Error(`missing selector: ${sel}`);
    }

    return el;
};

/** Strict-safe multi-element query, materialised so `toHaveLength` applies. */
const all = (root: HTMLElement, sel: string): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(sel));

/**
 * Renders what a status column would render for the given inputs.
 *
 * This reproduces the caller contract documented on the component itself —
 * resolve the state first, render the marker only when a state came back — so
 * the DOM-level half of the port's behaviour can be asserted: the incumbent
 * guard at main.coffee L838 was `if element`, so a matched branch pointing at no
 * card injected NOTHING. Testing the component alone cannot show that, because
 * the component's single prop admits only the three real states; the decision
 * not to render lives at the seam between the two functions, which is exactly
 * what this harness exercises.
 *
 * The fragment keeps `render` receiving a `ReactElement` in the no-marker case
 * without inventing a wrapper element that no column emits.
 *
 * @returns The container to query — empty when no marker is due.
 */
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

/**
 * The state classes actually present on an element, filtered against the known
 * set. Used instead of comparing the raw `class` attribute string: CSS selects
 * on class PRESENCE, so the attribute's internal order is not part of the
 * contract, and asserting it would couple this spec to an incidental detail of
 * how the component composes the string.
 */
const stateClassesOn = (element: HTMLElement): WipLimitState[] =>
    ALL_STATES.filter((candidate) => element.classList.contains(candidate));

/** One row of the `resolveWipLimitState` truth table. */
interface StateCase {
    /** Test name, so a failure reads as prose rather than as coordinates. */
    readonly name: string;
    /** Cards rendered in the column — the directive's `$el.find("tg-card")`. */
    readonly cardCount: number;
    /** The status's configured limit, or `null` when it has none. */
    readonly wipLimit: number | null;
    /** Whether this is the archived status (main.coffee L842's gate). */
    readonly isArchived: boolean;
    /** The state the column should resolve, or `undefined` for no marker. */
    readonly expected: WipLimitState | undefined;
}

/**
 * The complete truth table, ordered by the concern each row exercises.
 *
 * Every row is a `(cardCount, wipLimit, isArchived) -> expected` tuple taken
 * straight from the directive's arithmetic. The table is exhaustive over the
 * ladder, over both index formulas, over every input that matches a branch and
 * still resolves nothing, and over the archived gate.
 */
const STATE_CASES: readonly StateCase[] = [
    /* ---- the ladder, matched with an index that addresses a real card ---- */
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

    /* ---- the quiet branch: under the limit by more than one ---- */
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

    /* ---- the smallest limits, where the ladder and the index guard meet ---- */
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

    /* ------------------------------------------------------------------
     * The index guard (main.coffee L838 is `if element`, NOT
     * `if wipLimitClass`). Each row below MATCHES a ladder branch and still
     * resolves nothing, because the index the branch computes addresses no
     * card. These are the rows a reimplementation that renders on "a branch
     * matched" alone would get wrong, and the resulting phantom rules would be
     * the most visible possible regression on this screen.
     * ------------------------------------------------------------------ */
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

    /* ------------------------------------------------------------------
     * A status with NO configured limit. The source compared loosely, so the
     * absent limit coerced to zero and a non-empty column entered `exceeded`;
     * the index it then computed was -1 and the guard discarded it. An empty
     * column did not even match. Either way the observable contract is the
     * same for EVERY count — an unlimited column never shows a rule — which is
     * why the port short-circuits the case instead of reproducing the
     * coercion. The counts below are the bare counter values the board frame
     * actually displays on its unlimited columns, plus a larger one.
     * ------------------------------------------------------------------ */
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

    /* ------------------------------------------------------------------
     * The archived gate (main.coffee L842: `if status and not
     * status.is_archived`). It guarded the LISTENER REGISTRATION, so the
     * archived status never recomputed and therefore never acquired a rule —
     * at any count, including counts that would otherwise resolve loudly.
     * ------------------------------------------------------------------ */
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

    /* ----------------------------------------------------------------------
     * Named regression cases. Both are LIVE states measured off the board
     * design reference (Figma node 1:7, file B0XlGp5ZYFOfeARVceUVRE, whose
     * byte-verified equivalent is committed at design-reference/kanban-screen.png).
     * They are the only two markers visible anywhere in the frame, so they are
     * named after the swimlanes that produce them and kept separate from the
     * table above — a failure here says "the board no longer looks like the
     * reference", which is a different report from "the arithmetic is wrong".
     *
     * Colours are asserted NOWHERE. `one-left` reads as a softer pink than
     * `reached` purely because kanban-table.scss L291-L293 applies a reduced
     * opacity to the same red; that is stylesheet-owned (Drift Register entry
     * D3) and jsdom could not observe it in any case.
     * -------------------------------------------------------------------- */
    it('resolves `one-left` for swimlane "autem quas", whose NEW column reads 2 / 3', () => {
        expect(resolveWipLimitState(2, 3, false)).toBe('one-left');
    });

    it('resolves `reached` for swimlane "hic ut", whose NEW column reads 2 / 2', () => {
        expect(resolveWipLimitState(2, 2, false)).toBe('reached');
    });

    it('draws nothing on the frame columns that read 1 / 4 and 0 / 2', () => {
        // The same frame corroborates the ladder from the other direction: of
        // its limited columns, only the two above draw a rule.
        expect(resolveWipLimitState(1, 4, false)).toBeUndefined();
        expect(resolveWipLimitState(0, 2, false)).toBeUndefined();
    });

    it('assigns each rung of the ladder the branch the source gave it', () => {
        // Stated precisely, because it is easy to overclaim here: for whole-number
        // counts the three comparisons at main.coffee L826-L832 are MUTUALLY
        // EXCLUSIVE — `count + 1 === limit` forces `count < limit`, which rules
        // out both `reached` and `exceeded`. So the source's `else if` chain is
        // structure, not disambiguation, and no input can reach two branches.
        //
        // What therefore needs pinning is not precedence but the boundary: three
        // consecutive counts either side of one limit, each resolving its own
        // state and none resolving its neighbour's. Any off-by-one in the ladder
        // swaps two of these three answers.
        expect(resolveWipLimitState(4, 5, false)).toBe('one-left');
        expect(resolveWipLimitState(5, 5, false)).toBe('reached');
        expect(resolveWipLimitState(6, 5, false)).toBe('exceeded');
    });

    it('lets the archived gate win over an otherwise loud limit', () => {
        // Identical inputs; only the flag differs. Proves the gate is checked
        // ahead of the arithmetic rather than merely coinciding with it.
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

/* ==========================================================================
 * WHERE the rule goes.
 *
 * This is the half of the behaviour a class-name assertion cannot see. A wrong
 * index still produces the right class on the right column — nothing throws, no
 * console warning appears, and a screenshot comparison at any realistic
 * tolerance passes — while the rule sits one row away from where the
 * application would have put it. Hence the direct assertions below.
 * ========================================================================== */
describe('resolveWipLimitIndex', () => {
    it('positions `one-left` after the final card', () => {
        // main.coffee L828: `element = cards[cards.length - 1]`.
        expect(resolveWipLimitIndex(3, 4, 'one-left')).toBe(2);
        expect(resolveWipLimitIndex(1, 2, 'one-left')).toBe(0);
    });

    it('positions `reached` after the final card', () => {
        // main.coffee L831: the same formula as `one-left`.
        expect(resolveWipLimitIndex(4, 4, 'reached')).toBe(3);
        expect(resolveWipLimitIndex(1, 1, 'reached')).toBe(0);
    });

    it('positions `exceeded` after the last PERMITTED card, not after the last card', () => {
        // ⭐ THE OFF-BY-ONE THIS FILE EXISTS TO PIN DOWN.
        // main.coffee L834 is `element = cards[status.wip_limit - 1]`, a
        // DIFFERENT formula from the two branches above. With 5 cards and a
        // limit of 4 the rule follows index 3 — the fourth card — so the
        // surplus card falls BELOW the rule and the rule marks the boundary at
        // the limit. `cards.length - 1` would be 4 here: the same class, the
        // wrong row, and a regression no class-name check can detect.
        expect(resolveWipLimitIndex(5, 4, 'exceeded')).toBe(3);
        expect(resolveWipLimitIndex(5, 4, 'exceeded')).not.toBe(4);
    });

    it('derives the `exceeded` index from the limit rather than from the count', () => {
        // A deliberately lopsided column: nine cards against a limit of two puts
        // the rule after the SECOND card, index 1. Any count-derived formula
        // would answer 8.
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
        // Documented behaviour that `resolveWipLimitState` depends on: the
        // negative value is how a matched branch addressing no card is rejected,
        // reproducing the incumbent `if element` guard at main.coffee L838.
        // Clamping to 0 here would resurrect every phantom rule.
        expect(resolveWipLimitIndex(0, 1, 'one-left')).toBe(-1);
        expect(resolveWipLimitIndex(0, 0, 'reached')).toBe(-1);
        expect(resolveWipLimitIndex(1, 0, 'exceeded')).toBe(-1);
        expect(resolveWipLimitIndex(3, 0, 'exceeded')).toBe(-1);
    });

    it('is never reached for a status with no configured limit', () => {
        // The remaining "no card at that index" family is the unlimited status.
        // It cannot be expressed as a call at all: the parameter is typed as a
        // plain number, so passing `null` is a compile error rather than a
        // runtime surprise, and `resolveWipLimitState` rejects the case before
        // any index is computed. That upstream rejection is the assertion.
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
        // Round-trip: whenever a state is resolved, its index must address a real
        // card. This is the invariant that ties the two functions together, and
        // it holds for all three states rather than for a hand-picked one.
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


/* ==========================================================================
 * The markup itself, byte-for-byte against the string the directive injected at
 * main.coffee L839:
 *
 *     <div class='kanban-wip-limit one-left'><span>WIP Limit</span></div>
 *
 * Every element, class and character of text below is a contract with the
 * unedited stylesheet, so each is asserted by name and none is left to a
 * snapshot.
 * ========================================================================== */
describe('WipLimitMarker', () => {
    describe('the class contract (rule T1)', () => {
        it.each(ALL_STATES)('carries `kanban-wip-limit` together with `%s`', (state) => {
            const { container } = render(<WipLimitMarker state={state} />);
            const marker = q(container, `.${MARKER_CLASS}`);

            // Presence, not the raw attribute string: CSS selects on class
            // presence, and kanban-table.scss L264 and L283-L298 need both names
            // on the element. The source happens to write the base class first,
            // but the order is not what the stylesheet reads.
            expect(marker).toHaveClass(MARKER_CLASS, state);
            expect(marker.classList).toHaveLength(2);
        });

        it.each(ALL_STATES)('carries `%s` as its ONLY state class', (state) => {
            const { container } = render(<WipLimitMarker state={state} />);
            const marker = q(container, `.${MARKER_CLASS}`);

            // Two state classes at once would stack two different rule
            // treatments from kanban-table.scss L283-L298 onto one element.
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

            // kanban-table.scss L270-L281 selects a plain descendant `span` with
            // no class of its own; a class here, or an extra wrapper between the
            // two, would leave the chip unstyled.
            expect(q(marker, 'span')).not.toHaveAttribute('class');
        });

        it('labels the chip with the literal "WIP Limit", capital L and untranslated', () => {
            const { container } = render(<WipLimitMarker state="one-left" />);
            const chip = q(container, `.${MARKER_CLASS} span`);

            // Strict equality, not containment: the label is a HARDCODED English
            // string in the source (main.coffee L839). It is not a translation
            // key, and the nearest locale entry reads "WIP limit" with a
            // lower-case "l", so routing it through the translation layer would
            // visibly change the board. Recorded as Drift Register entry D5.
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

            // Exactly one descendant element in total.
            expect(all(marker, '*')).toHaveLength(1);
            expect(marker.querySelector('svg')).toBeNull();
            expect(marker.querySelector('tg-svg')).toBeNull();
            expect(marker.querySelector('div')).toBeNull();
        });

        it('sets no attribute other than `class`', () => {
            const { container } = render(<WipLimitMarker state="reached" />);
            const marker = q(container, `.${MARKER_CLASS}`);

            // The directive emitted `class` alone. A title, a role or an
            // aria-label would each be a capability the application does not
            // have — a feature change, which rule T10 forbids. The rule is
            // decorative reinforcement of the numeric counter the column already
            // renders beside it, so no information is carried by it alone.
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

        // Typed as the exported props interface, so the call the column makes is
        // the call this spec makes.
        const props: WipLimitMarkerProps = { state };
        const { container } = render(<WipLimitMarker {...props} />);
        const marker = q(container, `.${MARKER_CLASS}`);

        expect(stateClassesOn(marker)).toEqual(['reached']);
        expect(q(marker, 'span').textContent).toBe(CHIP_LABEL);
    });
});

/* ==========================================================================
 * The observable contract, asserted in the DOM.
 *
 * `resolveWipLimitState` and `<WipLimitMarker>` are only correct TOGETHER: the
 * incumbent guard was `if element` (main.coffee L838), so what a user could see
 * is "a rule exists in the column if and only if the directive would have found
 * a card at the computed index". Neither function alone shows that, so both
 * tables below drive the pair exactly as a column drives it and then look at the
 * resulting DOM.
 *
 * The two tables are derived from the single truth table above rather than
 * restated, so every row of it is checked at the DOM level as well as at the
 * function level and the two can never disagree.
 * ========================================================================== */
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

            // Nothing at all — not a hidden element, not an empty one.
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
        // The directive removed any earlier rule before injecting (main.coffee
        // L836) precisely because re-running the injection would otherwise
        // accumulate duplicates. React renders the marker at a single position,
        // so duplication has no mechanism — this asserts that it stays that way.
        const container = renderColumnMarker(9, 4, false);

        expect(all(container, `.${MARKER_CLASS}`)).toHaveLength(1);
    });

    it('renders no rule on an unlimited column at any card count', () => {
        // The single most important negative case: every status without a limit
        // matched the source's `exceeded` branch once it held a card, and was
        // then discarded by the guard. A port that rendered on "a branch matched"
        // alone would show a phantom rule on every unlimited column on the
        // board, which is the most visible regression available on this screen.
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
        // The whole ladder walked in one place, so an off-by-one anywhere in it
        // shows up as a sequence that reads wrong at a glance. Limit 3, counts
        // 0 to 5.
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
            null, // 0 cards: under the limit by more than one.
            null, // 1 card: still quiet.
            'one-left', // 2 cards: one more would reach 3.
            'reached', // 3 cards: at the limit.
            'exceeded', // 4 cards: past it, rule after card index 2.
            'exceeded', // 5 cards: still after card index 2.
        ]);
    });
});
