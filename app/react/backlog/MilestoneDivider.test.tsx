/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * MilestoneDivider.test.tsx -- the executable contract for the doom-line band.
 * ==========================================================================
 *
 * WHAT IS ACTUALLY AT RISK HERE
 * -----------------------------
 * The component under test carries no logic, so these tests do not chase
 * branches. They pin the two things that can break it silently.
 *
 *   1. THE CLASS AND NESTING CONTRACT (rule T1). `app/styles/components/
 *      doomline.scss` is an unedited pass-through asset. Its fourteen lines
 *      select `.doom-line` and the `span` nested inside it, and from those two
 *      selectors come the purple fill, the two-pixel corner radius, the flex
 *      centring on both axes, the vertical rhythm, and the label's colour,
 *      family, weight and size. Emit a different element or a different class
 *      name and the band renders COMPLETELY unstyled while still compiling and
 *      still showing the right words -- a total visual failure that a lax
 *      assertion waves straight through. Interpose a wrapper between the two
 *      and the failure is subtler and worse, because the stylesheet's own
 *      descendant selector keeps matching and hides it; that case is measured
 *      and set out at `labelIn` below. Section 1 therefore checks the markup
 *      EXACTLY rather than merely sufficiently: an added attribute or an added
 *      child is a regression there even though nothing reads as broken in the
 *      text.
 *
 *   2. TEXT, NEVER MARKUP. The incumbent interpolated this label through
 *      lodash's `<%- %>` form, which HTML-ESCAPES its value -- deliberately,
 *      because the string arrives from a translation catalogue, which is
 *      editable content. React's default escaping of a text child is the
 *      equivalent guarantee, and section 3 turns that equivalence into a
 *      standing assertion: moving the label onto React's raw-markup escape
 *      hatch -- the "dangerously"-prefixed inner-HTML prop -- cannot land
 *      without failing there.
 *
 *      That identifier is paraphrased rather than spelled out, for the same
 *      reason it is paraphrased in `app/react/test-support/
 *      jestConfigContract.test.tsx` and `app/react/bridge/ErrorBoundary.tsx`:
 *      this migration is verified in part by a repository-wide grep over
 *      `app/react` for exactly that name, so a prose mention would become the
 *      very hit the grep exists to catch.
 *
 * AT MOST ONE BAND EVER RENDERS -- AND THAT IS NOT THIS FILE'S JOB
 * ---------------------------------------------------------------
 * Recorded here so a later reader does not mistake the omission for an
 * oversight and grow a "several dividers" feature on the leaf. The incumbent
 * walked the stories accumulating points and `break`ed out of the loop at
 * `app/coffee/modules/backlog/main.coffee:L748` the moment the running total
 * passed the project's own point total, so exactly one band was ever spliced
 * in. The React tree keeps that invariant and keeps it elsewhere:
 * `selectDoomLineIndex` in `./state/backlogSelectors.ts` computes the single
 * crossing index, and `./StoryTable.tsx` renders one band at that index. This
 * component receives a label and draws a band -- it reads no state, computes
 * no index and knows nothing of its neighbours -- so there is no placement or
 * cardinality behaviour here to test, and adding one would put the invariant
 * in two places at once.
 *
 * BROWSERLESS AND INJECTOR-FREE BY CONSTRUCTION
 * --------------------------------------------
 * Constraint HR-5: jsdom only -- no end-to-end runner import, no browser
 * launch, no network, and no dependence on build output, so this file passes
 * with `dist/` deleted and with no browser binary installed. Requirement I9:
 * the component is a pure function of its props, so there is no injector to
 * provide, no AngularJS service to stand in for and no mock of either. The
 * whole spec is render, read the DOM, assert.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED, and must not be added later
 * -------------------------------------------------------------
 * No `role`, no `aria-*`, no `title`, no `id`, no `data-*` hook, no inline
 * style, no hide-when-empty shortcut, no truncation, no error handling. The
 * incumbent template emitted none of those, and rule T10 forbids functional
 * or feature change of every kind, so asserting them as present would
 * legislate a feature into existence instead of locking the behaviour being
 * migrated -- which is why section 1 asserts their ABSENCE instead. There is
 * no snapshot here either: a snapshot would absorb a regression in the class
 * name or in the nesting without a word, and that is precisely the class of
 * failure this file exists to catch.
 * ========================================================================== */

import { render } from '@testing-library/react';

import { MilestoneDivider } from './MilestoneDivider';
import type { MilestoneDividerProps } from './MilestoneDivider';

/**
 * The one class name in the contract, and the only selector `doomline.scss`
 * offers. Held in a constant so the assertions and the selector helpers below
 * all read it from the same place: a rename that misses one call site cannot
 * then hide behind a still-passing test.
 */
const DIVIDER_CLASS = 'doom-line';

/**
 * The English label exactly as the catalogue holds it -- `BACKLOG.DOOMLINE` at
 * `app/locales/taiga/locale-en.json:1435` -- which is what the container
 * resolves through `useTranslate` before handing it down, reproducing
 * `$translate.instant("BACKLOG.DOOMLINE")` at `main.coffee:L754`. The shape is
 * what makes it a useful fixture rather than a decoration: capitals, a space
 * and square brackets all survive the round trip only if nothing transforms,
 * trims or escapes the value on the way through.
 */
const EN_LABEL = 'Project Scope [Doomline]';

/**
 * The same message in Japanese, verbatim from
 * `app/locales/taiga/locale-ja.json:1428`. Non-ASCII copy is the cheapest
 * proof that this component is locale-agnostic and holds no English of its
 * own: were a word baked into the markup, this fixture would expose it.
 */
const JA_LABEL = 'プロジェクトスコープ [Doomline]';

function renderDivider(props: MilestoneDividerProps): HTMLElement {
    const { container } = render(<MilestoneDivider {...props} />);

    return container;
}

/** The band itself, throwing rather than handing back a nullable reference. */
function bandIn(container: HTMLElement): HTMLElement {
    const band = container.querySelector<HTMLElement>(`.${DIVIDER_CLASS}`);

    if (band === null) {
        throw new Error(`Expected the divider to render ".${DIVIDER_CLASS}".`);
    }

    return band;
}

/**
 * The label element, selected through a DIRECT-CHILD combinator on purpose,
 * and the reason is worth stating precisely because the obvious version of it
 * is wrong. The stylesheet's own rule, `.doom-line span`, is a DESCENDANT
 * selector, so a wrapper quietly interposed between the band and its label
 * keeps that rule matching: the label goes on rendering white, Ubuntu-Medium
 * and 14px. It even goes on LOOKING centred, because the wrapper becomes the
 * flex item, `justify-content: center` centres that instead, and it
 * shrink-wraps to the same width the label had. Which is what makes the
 * mistake dangerous -- the descendant rule MASKS the structural change, and
 * the real damage surfaces somewhere nobody is looking.
 *
 * Measured against the deployed stylesheet with a single `<em>` interposed:
 * the band grows from 26px to 29px, because the wrapper is not matched by
 * `.doom-line span` and so keeps a 16px inherited line box; the label turns
 * ITALIC, because that rule sets family, size, weight and colour but never
 * `font-style`, leaving nothing to correct an inherited slant; and the label's
 * own `display` flips from block to inline. jsdom loads no stylesheet, so none
 * of those three is measurable in this suite -- which is exactly why the guard
 * has to be STRUCTURAL. Refusing the wrapper here, and in section 1's
 * one-child and only-DIV-and-SPAN assertions, keeps that drift from ever
 * arising instead of trying to detect it after the fact.
 */
function labelIn(container: HTMLElement): HTMLElement {
    const label = container.querySelector<HTMLElement>(`.${DIVIDER_CLASS} > span`);

    if (label === null) {
        throw new Error(`Expected the divider to render ".${DIVIDER_CLASS} > span".`);
    }

    return label;
}

describe('MilestoneDivider', () => {
    describe('1. the markup contract the stylesheet depends on', () => {
        it('renders the incumbent template byte for byte, and nothing besides', () => {
            // The strictest single assertion in this file. The incumbent
            // compiled `<div class="doom-line"><span><%- text %></span></div>`
            // at `app/coffee/modules/backlog/main.coffee:L723-L725`, so the
            // rendered markup is compared whole: a changed tag, an extra
            // class, an extra attribute or an extra child each fail right
            // here, before the more specific assertions below narrow down
            // which of them it was.
            const container = renderDivider({ text: EN_LABEL });

            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span>${EN_LABEL}</span></div>`,
            );
        });

        it('makes the band the only node in the rendered tree', () => {
            const container = renderDivider({ text: EN_LABEL });

            expect(container.childNodes).toHaveLength(1);
            expect(container.firstElementChild).toBe(bandIn(container));
        });

        it('renders the band as a `div` whose class is exactly the one selector', () => {
            const band = bandIn(renderDivider({ text: EN_LABEL }));

            // String equality, never containment: a containment check passes
            // with a stray extra class, and an extra class is exactly the
            // well-meaning addition that shifts specificity somewhere else.
            expect(band.tagName).toBe('DIV');
            expect(band.className).toBe(DIVIDER_CLASS);
            expect(band.classList).toHaveLength(1);
        });

        it('gives the band exactly one child element, a `span`', () => {
            const band = bandIn(renderDivider({ text: EN_LABEL }));

            expect(band.childNodes).toHaveLength(1);
            expect(band.children).toHaveLength(1);
            expect(band.firstElementChild?.tagName).toBe('SPAN');
        });

        it('leaves the label unclassed, so the stylesheet rule is all that dresses it', () => {
            const label = labelIn(renderDivider({ text: EN_LABEL }));

            expect(label.className).toBe('');
            expect(label.classList).toHaveLength(0);
        });

        it('nests the label directly inside the band, with no wrapper between them', () => {
            const container = renderDivider({ text: EN_LABEL });

            expect(labelIn(container).parentElement).toBe(bandIn(container));
        });

        it('puts the label straight into the `span` as a single text node', () => {
            const label = labelIn(renderDivider({ text: EN_LABEL }));

            expect(label.textContent).toBe(EN_LABEL);
            expect(label.childNodes).toHaveLength(1);
            expect(label.firstChild?.nodeType).toBe(Node.TEXT_NODE);
            expect(label.children).toHaveLength(0);
        });

        it('adds no attribute to the band beyond `class`', () => {
            // Counted as well as named, so an attribute nobody thought to
            // check for still fails the count. `style`, `role`, `title`, `id`
            // and a `data-*` hook are each spelled out besides, because each
            // is a plausible addition and each would either invent accessible
            // semantics the incumbent never had or move a visual value out of
            // the stylesheet and into this tree.
            const band = bandIn(renderDivider({ text: EN_LABEL }));

            expect(band.attributes).toHaveLength(1);
            expect(band.getAttributeNames()).toEqual(['class']);
            expect(band.getAttribute('style')).toBeNull();
            expect(band.getAttribute('role')).toBeNull();
            expect(band.getAttribute('title')).toBeNull();
            expect(band.getAttribute('id')).toBeNull();
            expect(Object.keys(band.dataset)).toHaveLength(0);
        });

        it('adds no attribute at all to the label', () => {
            const label = labelIn(renderDivider({ text: EN_LABEL }));

            expect(label.attributes).toHaveLength(0);
            expect(label.getAttributeNames()).toEqual([]);
            expect(label.getAttribute('style')).toBeNull();
            expect(Object.keys(label.dataset)).toHaveLength(0);
        });

        it('authors no inline style, leaving every visual value to the stylesheet', () => {
            const container = renderDivider({ text: EN_LABEL });

            expect(container.innerHTML).not.toContain('style=');
        });

        it('emits no element other than the band and its label', () => {
            const container = renderDivider({ text: EN_LABEL });

            const tags = Array.from(container.querySelectorAll('*')).map(
                (element) => element.tagName,
            );

            expect(tags).toEqual(['DIV', 'SPAN']);
        });
    });

    describe('2. the label is exactly, and only, what the container passes', () => {
        it('passes the `text` prop through verbatim', () => {
            const container = renderDivider({ text: EN_LABEL });

            expect(labelIn(container).textContent).toBe(EN_LABEL);
            expect(bandIn(container).textContent).toBe(EN_LABEL);
        });

        it('renders nothing the prop did not supply, so no copy can hide in the leaf', () => {
            // The standing rule for these two screens is that every
            // user-facing string is resolved through `useTranslate` AT THE
            // CONTAINER and arrives here already translated. A label, a
            // separator, a bracket or a stray space hardcoded in this
            // component would show up as extra text content, and this is the
            // assertion that catches it. The fixture is deliberately a
            // meaningless string, so a match here cannot be a coincidence.
            const container = renderDivider({ text: 'XYZ' });

            expect(container.textContent).toBe('XYZ');
        });

        it('renders non-ASCII catalogue copy verbatim', () => {
            // The Japanese `BACKLOG.DOOMLINE` value, proving the component is
            // locale-agnostic: it neither transliterates nor normalises, and
            // it contributes no wording of its own in either direction.
            const container = renderDivider({ text: JA_LABEL });

            expect(labelIn(container).textContent).toBe(JA_LABEL);
            expect(container.textContent).toBe(JA_LABEL);
            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span>${JA_LABEL}</span></div>`,
            );
        });

        it('preserves brackets, punctuation, digits and mixed case exactly', () => {
            const text = 'Project boundary [Marker] - 42.5% / 3';

            expect(labelIn(renderDivider({ text })).textContent).toBe(text);
        });

        it('preserves leading and trailing whitespace rather than trimming it', () => {
            const text = '  padded label  ';

            expect(labelIn(renderDivider({ text })).textContent).toBe(text);
        });

        it('renders a long label without truncating or clipping it in the markup', () => {
            // Overflow is a styling concern and belongs to `doomline.scss`;
            // the markup carries the whole string either way.
            const text = 'boundary '.repeat(40).trim();

            expect(labelIn(renderDivider({ text })).textContent).toBe(text);
        });

        it('renders an empty label as an empty band, still fully formed', () => {
            // The negative path, and a deliberate NON-feature: there is no
            // hide-when-empty shortcut. The incumbent spliced the band in
            // whenever the running point total crossed the project total,
            // irrespective of the resolved string, and lodash's escape helper
            // rendered a missing value as an empty string. Suppressing the
            // band here would be new behaviour, which rule T10 forbids -- so
            // the band, the label element and the class contract all survive
            // an empty string intact.
            const container = renderDivider({ text: '' });

            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span></span></div>`,
            );
            expect(bandIn(container).className).toBe(DIVIDER_CLASS);
            expect(bandIn(container).textContent).toBe('');
            expect(labelIn(container).textContent).toBe('');
        });

        it('updates the label in place when the prop changes', () => {
            // Also the language-switch path: `useTranslate` re-resolves on
            // `$translateChangeEnd`, which reaches this leaf as nothing more
            // exotic than a new `text`. The band is reused rather than torn
            // down, so the class contract has to hold across the update too.
            const { container, rerender } = render(<MilestoneDivider text={EN_LABEL} />);

            expect(labelIn(container).textContent).toBe(EN_LABEL);

            rerender(<MilestoneDivider text={JA_LABEL} />);

            expect(labelIn(container).textContent).toBe(JA_LABEL);
            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span>${JA_LABEL}</span></div>`,
            );
        });
    });

    describe('3. escaping parity with the incumbent lodash template', () => {
        it('renders a label that looks like markup as literal text', () => {
            // AngularJS used lodash `<%- %>` (escaped). React's default
            // escaping is equivalent; the "dangerously"-prefixed inner-HTML
            // prop is forbidden. Spelled out: `<%- %>` is lodash's ESCAPING
            // interpolation, where `<%= %>` would have been the raw one, so
            // the incumbent's choice was deliberate and this component
            // inherits the same guarantee for free by passing the label as a
            // text child. Both halves are asserted -- the text survives whole,
            // AND no element is created from it.
            const text = '<b>bold</b> & <script>x</script>';
            const container = renderDivider({ text });
            const label = labelIn(container);

            expect(label.textContent).toBe(text);
            expect(label.querySelector('b')).toBeNull();
            expect(label.querySelector('script')).toBeNull();
            expect(label.children).toHaveLength(0);
            expect(label.innerHTML).toContain('&lt;b&gt;');
            expect(label.innerHTML).toContain('&lt;script&gt;');
        });

        it('neutralises an injection attempt in the label', () => {
            // A translation catalogue is editable content, so this is a
            // standing security assertion rather than a formality: no element
            // may be created from the label and no handler attached. The
            // serialised form still shows the attribute text, because a text
            // node escapes only `&`, `<` and `>` -- what matters is that the
            // angle brackets are escaped, so the browser parses none of it.
            const text = '<img src=x onerror="alert(1)">';
            const container = renderDivider({ text });
            const label = labelIn(container);

            expect(container.querySelector('img')).toBeNull();
            expect(label.children).toHaveLength(0);
            expect(label.textContent).toBe(text);
            expect(label.innerHTML).not.toContain('<img');
            expect(label.innerHTML).toContain('&lt;img');
        });

        it('escapes a bare ampersand and leaves quotes as written', () => {
            const text = 'scope & "limit" \'reached\'';
            const container = renderDivider({ text });

            expect(labelIn(container).textContent).toBe(text);
            expect(labelIn(container).innerHTML).toContain('&amp;');
        });
    });

    describe('4. degradation at the untyped AngularJS seam', () => {
        // `text` is a required `string`, so TypeScript rejects both callers
        // below outright. The seam they model is real all the same: the bridge
        // hands `params` across as DOM PROPERTIES assigned from CoffeeScript,
        // where no compiler checks the shape, so a container that failed to
        // resolve the message would deliver a missing value. The incumbent
        // degraded quietly there -- lodash's escape helper renders a missing
        // value as an empty string -- and React matches it by skipping nullish
        // children rather than stringifying them. These two tests keep the
        // band from ever printing the word for absence, which is the visible
        // symptom this class of mistake would otherwise produce.
        const untypedLabel = (value: string | undefined | null): string => value as string;

        it('renders an empty band when the label is undefined', () => {
            const container = renderDivider({ text: untypedLabel(undefined) });

            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span></span></div>`,
            );
            expect(bandIn(container).textContent).toBe('');
        });

        it('renders an empty band when the label is null', () => {
            const container = renderDivider({ text: untypedLabel(null) });

            expect(container.innerHTML).toBe(
                `<div class="${DIVIDER_CLASS}"><span></span></div>`,
            );
            expect(bandIn(container).textContent).toBe('');
        });
    });

    describe('5. module surface', () => {
        it('exports the component as a plain named function', () => {
            // A plain function keeps the leaf trivially renderable from a spec
            // and from `StoryTable.tsx` alike, and the name is what React puts
            // in the component stack when something above it throws, so it is
            // worth pinning rather than leaving to a bundler.
            expect(typeof MilestoneDivider).toBe('function');
            expect(MilestoneDivider.name).toBe('MilestoneDivider');
        });

        it('renders from props alone, needing no provider, injector or context', () => {
            // Requirement I9 made executable: the render below is wrapped in
            // nothing at all. `useAngularService` throws when no injector is
            // in scope, so were a service reach introduced into this leaf this
            // test would fail instead of passing quietly. That is what keeps
            // the presentational half of the presentational/container split
            // honest, and what makes the coverage gate reachable without a
            // browser.
            expect(() => renderDivider({ text: EN_LABEL })).not.toThrow();
        });
    });
});
