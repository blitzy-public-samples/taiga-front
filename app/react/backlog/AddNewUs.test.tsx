/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * AddNewUs.test.tsx -- co-located spec for the backlog add-story action pair
 * ==========================================================================
 *
 * Browserless by construction (constraint HR-5): jsdom supplies the DOM, the
 * translator is a plain double, no browser binary is launched, no network is
 * touched and nothing here refers to any generated build output.
 *
 * ⭐ NO INJECTOR, NO PROVIDER AND NO ROOT-SCOPE DOUBLE IN THIS FILE.
 * The unit takes its translator as a prop and calls no hook, so it renders bare.
 * That is the whole point of the presentational/container split requirement I9
 * asks for, and this file is the evidence that the split actually holds: if a
 * future edit reached for `useTranslate()` inside the component, every case below
 * would fail with a missing-provider error rather than silently acquiring a
 * dependency.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * `./AddNewUs.tsx`. The unit is presentational, so every assertion is about
 * EMITTED MARKUP -- element names, class names and their ORDER, the `variant`
 * attribute, nesting, sibling order, text content, the accessible name -- plus the
 * two click callbacks.
 *
 * Class names and attributes are asserted rather than computed style because the
 * migration preserves the existing class contract verbatim (rule T1) and the
 * appearance comes wholly from unedited stylesheets, which jsdom does not parse.
 * An assertion on computed style would test nothing here; an assertion on the
 * class-and-attribute contract tests exactly what can break.
 *
 * THE THREE CONTRACTS THAT WOULD FAIL SILENTLY IN PRODUCTION, SO THEY ARE PINNED
 * ------------------------------------------------------------------------------
 *  1. `variant` must reach the DOM as a real attribute, because
 *     `buttons-next.scss` selects `.btn-small[variant='primary']` (`:54`) and
 *     `.btn-icon[variant='secondary']` (`:85`). Lose it and the buttons keep their
 *     shape but lose their colours, with nothing throwing.
 *  2. The class attribute must START with `btn-`, because
 *     `layout/backlog.scss:72` reads `[class^='btn-']:not(:last-child)` and that
 *     rule is the only source of the 16 px gap between the two buttons. So the
 *     ORDER is asserted, not merely the presence of both classes.
 *  3. Denied permission must HIDE, never unmount, because `tgCheckPermission`
 *     (`app/coffee/modules/common.coffee:93`) only toggles a class. A spec that
 *     merely checked "the button is not visible" would pass against a wrong
 *     implementation that removed the node, so presence is asserted explicitly in
 *     the denied case.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 * ------------------------------------
 *  - `Svg`'s own internals (the two-`<title>` contract, fill handling), which
 *    belong to `../shared/Svg.test.tsx`. What IS asserted here is the CALL SITE:
 *    that the `tg-svg` host survives -- the stylesheets target it as an element --
 *    and that the correct sprite fragment is referenced;
 *  - how `canAddUs` is computed. `canEdit` is
 *    `!isArchived() && hasPermission(...)` and per requirement I9 that belongs to
 *    the screen; this unit receives a boolean;
 *  - what the click handlers go on to do. `'standard'` and `'bulk'` open two
 *    RETAINED AngularJS lightboxes; this unit only reports the intent.
 * ========================================================================== */

import { render } from '@testing-library/react';

import type { TranslateFn } from '../bridge/useTranslate';
import { AddNewUs } from './AddNewUs';
import type { AddNewUsKind, AddNewUsProps } from './AddNewUs';

/* --------------------------------------------------------------------------
 * Fixtures and doubles
 * -------------------------------------------------------------------------- */

/** The keys the source reads (`addnewus.jade:15` and `:21`). */
const ADD_KEY = 'US.ADD';
const ADD_BULK_KEY = 'US.ADD_BULK';

/**
 * The values the shipped English locale holds for those keys, verbatim.
 *
 * `US.ADD` is LOWER CASE in `app/locales/taiga/locale-en.json` even though the
 * button reads as upper case on screen, because `%button` applies
 * `text-transform: uppercase` (`buttons-next.scss:15`). Asserting the raw lower-case
 * value is precisely what catches a component that "helpfully" upper-cased the
 * string itself and thereby broke every locale with different casing rules.
 */
const ADD_COPY = 'user story';
const ADD_BULK_COPY = 'Add some new user stories in bulk';

/** The icon host the stylesheets target as an ELEMENT, not as a class. */
const ICON_HOST = 'tg-svg';

type TranslateMock = jest.Mock<string, [key: string, params?: Record<string, unknown>]>;

/**
 * A translator double. It resolves the two real keys to the shipped English
 * values and MARKS anything else, so an unexpected lookup shows up in the
 * rendered output instead of looking plausible.
 */
function createTranslateDouble(): TranslateMock {
    return jest.fn((key: string): string => {
        if (key === ADD_KEY) {
            return ADD_COPY;
        }

        if (key === ADD_BULK_KEY) {
            return ADD_BULK_COPY;
        }

        return `UNEXPECTED:${key}`;
    });
}

interface Harness {
    readonly root: HTMLElement;
    readonly primary: HTMLButtonElement;
    readonly secondary: HTMLButtonElement;
    readonly onAddNewUs: jest.Mock<void, [kind: AddNewUsKind]>;
    readonly translate: TranslateMock;
}

/**
 * Renders the unit and hands back the root plus both buttons.
 *
 * The buttons are located POSITIONALLY, by child index, rather than by class or
 * role. That is deliberate: locating by class would make the class assertions
 * circular, and locating by accessible name would silently skip a button whose
 * name regressed. Index also lets the sibling ORDER be asserted directly.
 */
function renderAddNewUs(overrides: Partial<AddNewUsProps> = {}): Harness {
    const onAddNewUs = jest.fn<void, [kind: AddNewUsKind]>();
    const translate = createTranslateDouble();

    const props: AddNewUsProps = {
        canAddUs: true,
        onAddNewUs,
        t: translate as TranslateFn,
        ...overrides,
    };

    const { container } = render(<AddNewUs {...props} />);

    const root = container.firstElementChild;

    if (!(root instanceof HTMLElement)) {
        throw new Error('AddNewUs rendered no root element.');
    }

    const [primary, secondary] = Array.from(root.children);

    if (!(primary instanceof HTMLButtonElement) || !(secondary instanceof HTMLButtonElement)) {
        throw new Error('AddNewUs did not render two button elements.');
    }

    return { root, primary, secondary, onAddNewUs, translate };
}

/* --------------------------------------------------------------------------
 * Structure -- the class and nesting contract (rule T1)
 * -------------------------------------------------------------------------- */

describe('AddNewUs structure', () => {
    it('renders a single .new-us root holding exactly two buttons', () => {
        const { root } = renderAddNewUs();

        expect(root.tagName).toBe('DIV');
        expect(root).toHaveClass('new-us');
        expect(root.className).toBe('new-us');

        // Exactly two, and both buttons: the source declares no third control, and
        // inventing one would be a rule DS2-d violation.
        expect(root.children).toHaveLength(2);
        expect(Array.from(root.children).map((child) => child.tagName)).toEqual([
            'BUTTON',
            'BUTTON',
        ]);
    });

    it('renders the primary add button first and the bulk button second', () => {
        const { primary, secondary } = renderAddNewUs();

        expect(primary).toHaveClass('btn-small');
        expect(secondary).toHaveClass('btn-icon');
    });

    it('uses real <button> elements rather than clickable containers', () => {
        const { primary, secondary } = renderAddNewUs();

        // Semantic elements, so both are keyboard-operable and focusable with no
        // ARIA scaffolding of any kind.
        expect(primary).toBeInstanceOf(HTMLButtonElement);
        expect(secondary).toBeInstanceOf(HTMLButtonElement);
    });
});

/* --------------------------------------------------------------------------
 * ⭐ The `variant` attribute -- load-bearing styling
 * -------------------------------------------------------------------------- */

describe('AddNewUs variant attribute', () => {
    it('emits variant="primary" on the add button as a real DOM attribute', () => {
        const { primary } = renderAddNewUs();

        // `.btn-small[variant='primary']` (buttons-next.scss:54) is the ONLY source
        // of the primary button's fill and label colour.
        expect(primary).toHaveAttribute('variant', 'primary');
    });

    it('emits variant="secondary" on the bulk button as a real DOM attribute', () => {
        const { secondary } = renderAddNewUs();

        // `.btn-icon[variant='secondary']` (buttons-next.scss:85) is the ONLY source
        // of the bulk button's grey fill and glyph colour.
        expect(secondary).toHaveAttribute('variant', 'secondary');
    });

    it('does not substitute a data-* attribute, which would match no selector', () => {
        const { primary, secondary } = renderAddNewUs();

        expect(primary).not.toHaveAttribute('data-variant');
        expect(secondary).not.toHaveAttribute('data-variant');
    });
});

/* --------------------------------------------------------------------------
 * Icons -- the sprite contract (rule T3)
 * -------------------------------------------------------------------------- */

describe('AddNewUs icons', () => {
    it('renders the add glyph inside a tg-svg host, before the label', () => {
        const { primary } = renderAddNewUs();

        const host = primary.children[0];

        // The host element must be the FIRST child: the stylesheets space the icon
        // from the label with `.btn-small tg-svg { margin-right: .5rem }`
        // (buttons-next.scss:69), and the design frame shows the glyph ahead of the
        // text.
        expect(host?.tagName.toLowerCase()).toBe(ICON_HOST);

        const svg = host?.querySelector('svg');

        expect(svg).not.toBeNull();
        expect(svg?.getAttribute('class')).toBe('icon icon-add');
    });

    it('references the add sprite symbol by same-document fragment', () => {
        const { primary } = renderAddNewUs();

        const use = primary.querySelector('use');

        // A fragment reference into the sprite inlined at `app/index.jade:96`. No new
        // asset is introduced (rule T3), and light DOM is required for this to
        // resolve at all (requirement I6).
        expect(use?.getAttribute('href')).toBe('#icon-add');
        expect(use?.getAttribute('xlink:href')).toBe('#icon-add');
    });

    it('renders the bulk glyph inside a tg-svg host as the button\u2019s only content', () => {
        const { secondary } = renderAddNewUs();

        expect(secondary.children).toHaveLength(1);

        const host = secondary.children[0];

        expect(host?.tagName.toLowerCase()).toBe(ICON_HOST);
        expect(host?.querySelector('svg')?.getAttribute('class')).toBe('icon icon-bulk');
        expect(secondary.querySelector('use')?.getAttribute('href')).toBe('#icon-bulk');
    });

    it('renders no visible text in the bulk button', () => {
        const { secondary } = renderAddNewUs();

        // Measured against the design frame: the button's interior holds one glyph
        // and no text whatsoever. Its accessible name therefore has to come from
        // `aria-label`.
        expect(secondary.textContent).toBe('');
    });
});

/* --------------------------------------------------------------------------
 * Copy and accessible naming
 * -------------------------------------------------------------------------- */

describe('AddNewUs copy', () => {
    it('renders the label in span.text using the raw lower-case locale value', () => {
        const { primary } = renderAddNewUs();

        const label = primary.children[1];

        expect(label?.tagName).toBe('SPAN');
        expect(label).toHaveClass('text');

        // Lower case, exactly as the locale holds it. Upper-casing is
        // `%button { text-transform: uppercase }`, not this component's job.
        expect(label?.textContent).toBe(ADD_COPY);
        expect(label?.textContent).not.toBe(ADD_COPY.toUpperCase());
    });

    it('names the bulk button with aria-label, and only that button', () => {
        const { primary, secondary } = renderAddNewUs();

        expect(secondary).toHaveAttribute('aria-label', ADD_BULK_COPY);

        // The primary button has visible text, so the source gives it no
        // `aria-label`; adding one would be a feature change (rule T10).
        expect(primary).not.toHaveAttribute('aria-label');
    });

    it('adds no title attribute to either button', () => {
        const { primary, secondary } = renderAddNewUs();

        // Neither exists in `addnewus.jade`; adding one would be a rule T10 change.
        expect(primary).not.toHaveAttribute('title');
        expect(secondary).not.toHaveAttribute('title');
    });

    it('looks up exactly the two source keys, with no interpolation values', () => {
        const { translate } = renderAddNewUs();

        expect(translate).toHaveBeenCalledWith(ADD_KEY);
        expect(translate).toHaveBeenCalledWith(ADD_BULK_KEY);

        // Both are called with a single argument: the source binds no interpolation
        // values either.
        for (const call of translate.mock.calls) {
            expect(call).toHaveLength(1);
        }
    });

    it('renders nothing that looks like an unresolved key', () => {
        const { root } = renderAddNewUs();

        expect(root.textContent).not.toContain('UNEXPECTED:');
        expect(root.textContent).toBe(ADD_COPY);
    });
});

/* --------------------------------------------------------------------------
 * ⭐ Permission gating -- hide, never unmount
 * -------------------------------------------------------------------------- */

describe('AddNewUs permission gating', () => {
    it('leaves both buttons unhidden when the member may add stories', () => {
        const { primary, secondary } = renderAddNewUs({ canAddUs: true });

        expect(primary).not.toHaveClass('hidden');
        expect(secondary).not.toHaveClass('hidden');

        // No stray classes either: the class attribute is exactly the source's.
        expect(primary.className).toBe('btn-small');
        expect(secondary.className).toBe('btn-icon');
    });

    it('keeps BOTH buttons mounted when permission is denied, only adding hidden', () => {
        const { root, primary, secondary } = renderAddNewUs({ canAddUs: false });

        // ⭐ The element always exists. `tgCheckPermission` toggles a class and never
        // detaches the node (`app/coffee/modules/common.coffee:90`/`:93`), so
        // conditional rendering would be a behavioural change (rule T10).
        expect(root.children).toHaveLength(2);
        expect(primary).toBeInTheDocument();
        expect(secondary).toBeInTheDocument();

        expect(primary).toHaveClass('hidden');
        expect(secondary).toHaveClass('hidden');
    });

    it('APPENDS hidden after the btn- class so [class^=\u2018btn-\u2019] still matches', () => {
        const { primary, secondary } = renderAddNewUs({ canAddUs: false });

        // ⭐ ORDER, not just membership. `layout/backlog.scss:72` anchors with `^=` to
        // the start of the whole class attribute value, and that rule is the only
        // source of the 16 px gap between the two buttons. Prepending `hidden` would
        // silently collapse them together.
        expect(primary.className).toBe('btn-small hidden');
        expect(secondary.className).toBe('btn-icon hidden');

        expect(primary.getAttribute('class')?.startsWith('btn-')).toBe(true);
        expect(secondary.getAttribute('class')?.startsWith('btn-')).toBe(true);
    });

    it('expresses denial through the class alone, not through disabled or ARIA', () => {
        const { primary, secondary } = renderAddNewUs({ canAddUs: false });

        // The retired directive set neither, and the design frame shows no disabled
        // treatment. Adding either would be a rule T10 change.
        expect(primary).not.toBeDisabled();
        expect(secondary).not.toBeDisabled();
        expect(primary).not.toHaveAttribute('aria-disabled');
        expect(secondary).not.toHaveAttribute('aria-disabled');
    });

    it('keeps the variant attribute in both permission states', () => {
        const denied = renderAddNewUs({ canAddUs: false });

        expect(denied.primary).toHaveAttribute('variant', 'primary');
        expect(denied.secondary).toHaveAttribute('variant', 'secondary');
    });
});

/* --------------------------------------------------------------------------
 * The submit-type omission (rule T10)
 * -------------------------------------------------------------------------- */

describe('AddNewUs button type', () => {
    it('emits no explicit type attribute on either button', () => {
        const { primary, secondary } = renderAddNewUs();

        // `addnewus.jade:9`/`:17` emit bare `button` elements, so the DOM default
        // applies. Adding `type="button"` would be a functional change; the buttons
        // sit outside every form, so the default is inert.
        expect(primary.hasAttribute('type')).toBe(false);
        expect(secondary.hasAttribute('type')).toBe(false);
        expect(primary.type).toBe('submit');
        expect(secondary.type).toBe('submit');
    });
});

/* --------------------------------------------------------------------------
 * Callbacks
 * -------------------------------------------------------------------------- */

describe('AddNewUs callbacks', () => {
    it('reports the standard flow once when the primary button is clicked', () => {
        const { primary, onAddNewUs } = renderAddNewUs();

        primary.click();

        expect(onAddNewUs).toHaveBeenCalledTimes(1);
        expect(onAddNewUs).toHaveBeenCalledWith('standard');
    });

    it('reports the bulk flow once when the bulk button is clicked', () => {
        const { secondary, onAddNewUs } = renderAddNewUs();

        secondary.click();

        expect(onAddNewUs).toHaveBeenCalledTimes(1);
        expect(onAddNewUs).toHaveBeenCalledWith('bulk');
    });

    it('does not invoke the callback while merely rendering', () => {
        const { onAddNewUs } = renderAddNewUs();

        expect(onAddNewUs).not.toHaveBeenCalled();
    });

    it('reports each flow independently across repeated clicks', () => {
        const { primary, secondary, onAddNewUs } = renderAddNewUs();

        primary.click();
        secondary.click();
        primary.click();

        expect(onAddNewUs).toHaveBeenCalledTimes(3);
        expect(onAddNewUs.mock.calls.map(([kind]) => kind)).toEqual([
            'standard',
            'bulk',
            'standard',
        ]);
    });

    it('still reports clicks when permission is denied', () => {
        // The retired directive hid the control with a class and did not detach a
        // handler, so a hidden button remains wired. Guarding the ACTION is the
        // screen's job, and reproducing the directive faithfully means not
        // inventing a guard here (rule T10).
        const { primary, onAddNewUs } = renderAddNewUs({ canAddUs: false });

        primary.click();

        expect(onAddNewUs).toHaveBeenCalledWith('standard');
    });
});

/* --------------------------------------------------------------------------
 * Presentational purity (requirement I9)
 * -------------------------------------------------------------------------- */

describe('AddNewUs purity', () => {
    it('renders identical markup for identical props', () => {
        const first = renderAddNewUs();
        const firstMarkup = first.root.outerHTML;

        const second = renderAddNewUs();

        expect(second.root.outerHTML).toBe(firstMarkup);
    });

    it('emits no inline style on the root or either button', () => {
        const { root, primary, secondary } = renderAddNewUs();

        // Every visual property comes from the unedited stylesheets (rule G-DS-4).
        expect(root.hasAttribute('style')).toBe(false);
        expect(primary.hasAttribute('style')).toBe(false);
        expect(secondary.hasAttribute('style')).toBe(false);
    });
});
