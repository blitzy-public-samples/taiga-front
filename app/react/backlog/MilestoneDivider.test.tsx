/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Executable contract for `MilestoneDivider`.
 *
 * WHAT IS ACTUALLY AT RISK HERE
 * -----------------------------
 * This component carries no logic, so the tests below do not chase branches --
 * they pin the two things that can silently break it.
 *
 *   1. THE CLASS CONTRACT. `app/styles/components/doomline.scss` is an unedited
 *      pass-through asset. It selects `.doom-line` and `.doom-line span`, and it
 *      supplies the fill, the corner radius, the flex centring on both axes, the
 *      vertical rhythm and the label's colour, family, weight and size. Emit a
 *      different element, a different class, or an extra wrapper between the two,
 *      and the band silently renders unstyled -- a total visual failure that
 *      still compiles and still shows the right words. Several assertions below
 *      therefore check the markup EXACTLY rather than merely sufficiently: an
 *      added attribute or child is a regression even though nothing looks broken
 *      in a snapshot of the text.
 *
 *   2. TEXT, NOT MARKUP. The incumbent interpolated this label through lodash's
 *      `<%- %>` form, which HTML-escapes. React's default escaping of a text
 *      child is the equivalent guarantee, and the hostile-label test below turns
 *      that equivalence into a standing assertion: switching the label onto
 *      React's raw-markup escape hatch -- the "dangerously"-prefixed inner-HTML
 *      prop -- cannot land without failing here.
 *
 *      That identifier is paraphrased rather than spelled out for the same reason
 *      it is paraphrased in `app/react/test-support/jestConfigContract.test.tsx`
 *      and `app/react/bridge/ErrorBoundary.tsx`: the migration is verified in
 *      part by a repository-wide grep for exactly that name, so a prose mention
 *      would become the very hit the grep exists to catch.
 *
 * Placement is deliberately NOT tested here, because it is deliberately not
 * implemented here. `selectDoomLineIndex` in `./state/backlogSelectors.ts` owns
 * which row the band precedes and the fact that at most one band ever exists;
 * this spec covers the leaf that draws it.
 */
import { render } from '@testing-library/react';

import { MilestoneDivider } from './MilestoneDivider';
import type { MilestoneDividerProps } from './MilestoneDivider';

const DIVIDER_CLASS = 'doom-line';

/**
 * The label the container passes in production, resolved from the
 * `BACKLOG.DOOMLINE` message rather than written here, so this spec does not
 * quietly become a second home for user-facing copy. The shape matters: the real
 * catalogue value carries capitals, spaces and square brackets, so using a
 * stand-in of the same shape keeps the round-trip assertions meaningful.
 */
const LABEL = 'Scope boundary [marker]';

function renderDivider(props: MilestoneDividerProps): HTMLElement {
    const { container } = render(<MilestoneDivider {...props} />);

    return container;
}

function bandIn(container: HTMLElement): HTMLElement {
    const band = container.querySelector<HTMLElement>(`.${DIVIDER_CLASS}`);

    if (band === null) {
        throw new Error(`Expected the divider to render ".${DIVIDER_CLASS}".`);
    }

    return band;
}

function labelIn(container: HTMLElement): HTMLElement {
    const label = container.querySelector<HTMLElement>(`.${DIVIDER_CLASS} > span`);

    if (label === null) {
        throw new Error(`Expected the divider to render ".${DIVIDER_CLASS} > span".`);
    }

    return label;
}

describe('MilestoneDivider', () => {
    describe('markup contract', () => {
        it('renders the incumbent template byte for byte, and nothing besides', () => {
            // The single strictest assertion in this spec. The incumbent template
            // was `<div class="doom-line"><span><%- text %></span></div>`, so the
            // rendered markup is compared whole: an extra attribute, an extra
            // class, an extra child or a changed tag all fail right here.
            const container = renderDivider({ text: LABEL });

            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span>${LABEL}</span></div>`,
            );
        });

        it('makes the band the only node in the tree', () => {
            const container = renderDivider({ text: LABEL });

            expect(container.childNodes).toHaveLength(1);
            expect(container.firstElementChild).toBe(bandIn(container));
        });

        it('renders the band as a `div` carrying the class the stylesheet selects', () => {
            const band = bandIn(renderDivider({ text: LABEL }));

            expect(band.tagName).toBe('DIV');
            expect(band).toHaveClass(DIVIDER_CLASS);
            expect(band.classList).toHaveLength(1);
        });

        it('gives the band exactly one child, a `span`, with no wrapper between them', () => {
            const band = bandIn(renderDivider({ text: LABEL }));

            expect(band.childNodes).toHaveLength(1);
            expect(band.children).toHaveLength(1);
            expect(band.firstElementChild?.tagName).toBe('SPAN');
            expect(labelIn(renderDivider({ text: LABEL })).parentElement).toHaveClass(
                DIVIDER_CLASS,
            );
        });

        it('puts the label text directly inside the `span` as a single text node', () => {
            const label = labelIn(renderDivider({ text: LABEL }));

            expect(label.childNodes).toHaveLength(1);
            expect(label.firstChild?.nodeType).toBe(Node.TEXT_NODE);
            expect(label.children).toHaveLength(0);
        });

        it('adds no attribute to the band beyond `class`', () => {
            // Guards against a `role`, a `data-*` hook, an `aria-*` label, an
            // `id`, a `title` or an inline `style` creeping in. The design frame
            // shows a plain labelled band, and the stylesheet needs only `class`.
            const band = bandIn(renderDivider({ text: LABEL }));

            expect(band.getAttributeNames()).toEqual(['class']);
        });

        it('adds no attribute at all to the label', () => {
            const label = labelIn(renderDivider({ text: LABEL }));

            expect(label.getAttributeNames()).toEqual([]);
        });

        it('authors no inline style, leaving every visual value to the stylesheet', () => {
            const container = renderDivider({ text: LABEL });

            expect(bandIn(container).getAttribute('style')).toBeNull();
            expect(labelIn(container).getAttribute('style')).toBeNull();
            expect(container.innerHTML).not.toContain('style=');
        });

        it('emits no element other than the band and its label', () => {
            const container = renderDivider({ text: LABEL });

            const tags = Array.from(container.querySelectorAll('*')).map(
                (element) => element.tagName,
            );

            expect(tags).toEqual(['DIV', 'SPAN']);
        });
    });

    describe('label content', () => {
        it('passes the `text` prop through verbatim', () => {
            const label = labelIn(renderDivider({ text: LABEL }));

            expect(label.textContent).toBe(LABEL);
            expect(bandIn(renderDivider({ text: LABEL })).textContent).toBe(LABEL);
        });

        it('preserves square brackets, punctuation and mixed case exactly', () => {
            // The real catalogue value is bracketed, so a stray transform or trim
            // would be visible in production and invisible in a laxer assertion.
            const text = 'Project boundary [Marker] - 42.5% / 3';

            expect(labelIn(renderDivider({ text })).textContent).toBe(text);
        });

        it('preserves leading and trailing whitespace rather than trimming it', () => {
            const text = '  padded label  ';

            expect(labelIn(renderDivider({ text })).textContent).toBe(text);
        });

        it('renders an empty label as an empty band, still fully formed', () => {
            const container = renderDivider({ text: '' });

            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span></span></div>`,
            );
            expect(bandIn(container).textContent).toBe('');
        });

        it('renders a long label without truncating or clipping it in markup', () => {
            const text = 'boundary '.repeat(40).trim();

            expect(labelIn(renderDivider({ text })).textContent).toBe(text);
        });

        it('updates the label in place when the prop changes', () => {
            const { container, rerender } = render(<MilestoneDivider text={LABEL} />);

            expect(labelIn(container).textContent).toBe(LABEL);

            rerender(<MilestoneDivider text="Revised boundary" />);

            expect(labelIn(container).textContent).toBe('Revised boundary');
            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span>Revised boundary</span></div>`,
            );
        });
    });

    describe('escaping parity with the incumbent lodash template', () => {
        it('renders a markup-looking label as literal text, never as markup', () => {
            const text = '<b>bold</b>';
            const container = renderDivider({ text });

            expect(labelIn(container).textContent).toBe(text);
            expect(container.querySelector('b')).toBeNull();
            expect(labelIn(container).children).toHaveLength(0);
            expect(labelIn(container).innerHTML).toBe('&lt;b&gt;bold&lt;/b&gt;');
        });

        it('neutralises an injection attempt in the label', () => {
            // A translation catalogue is editable content, so this is a standing
            // security assertion rather than a formality: no element may be
            // created from the label and no handler attached.
            const text = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
            const container = renderDivider({ text });

            expect(container.querySelector('img')).toBeNull();
            expect(container.querySelector('script')).toBeNull();
            expect(labelIn(container).children).toHaveLength(0);
            expect(labelIn(container).textContent).toBe(text);
            expect(labelIn(container).innerHTML).not.toContain('<img');
            expect(labelIn(container).innerHTML).not.toContain('<script');
        });

        it('escapes bare ampersands and quotes the way the incumbent did', () => {
            const text = 'scope & "limit" \'reached\'';
            const container = renderDivider({ text });

            expect(labelIn(container).textContent).toBe(text);
            expect(labelIn(container).innerHTML).toContain('&amp;');
        });
    });

    describe('degradation at the untyped AngularJS seam', () => {
        // `text` is a required `string`, so TypeScript rejects these callers. The
        // seam they model is real all the same: the bridge hands params across as
        // DOM properties assigned from CoffeeScript, where no compiler checks the
        // shape. The incumbent degraded quietly here -- lodash's escape helper
        // renders a nullish value as an empty string -- and React matches that by
        // skipping nullish children rather than stringifying them. These two
        // tests keep the band from ever printing the words for absence.
        const untyped = (value: unknown): string => value as string;

        it('renders an empty band when the label is undefined', () => {
            const container = renderDivider({ text: untyped(undefined) });

            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span></span></div>`,
            );
            expect(bandIn(container).textContent).toBe('');
        });

        it('renders an empty band when the label is null', () => {
            const container = renderDivider({ text: untyped(null) });

            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span></span></div>`,
            );
            expect(bandIn(container).textContent).toBe('');
        });
    });

    describe('module surface', () => {
        it('exports the component as a plain named function', () => {
            // A plain function keeps the leaf trivially renderable from a spec and
            // from `StoryTable.tsx` alike; wrapping it would change the export
            // shape for no measurable gain at this size.
            expect(typeof MilestoneDivider).toBe('function');
            expect(MilestoneDivider.name).toBe('MilestoneDivider');
        });
    });
});
