/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * Svg.tsx -- THE REACT REPLACEMENT FOR THE AngularJS `tgSvg` ELEMENT DIRECTIVE
 * ==========================================================================
 *
 * TECHNOLOGY-SPECIFIC CHANGE AT THE AngularJS/React SEAM (transformation rule
 * T9: "Comment every technology-specific change at the point of change,
 * especially at the AngularJS/React seam"). Every statement below is a measured
 * fact with a locator, in the form `path:line`; a bare `:line` continues the
 * path named immediately before it.
 *
 * This is the ONE icon renderer for BOTH migrated screens (kanban and backlog).
 * It supersedes the `tgSvg` element directive at
 * `app/coffee/modules/common.coffee:342`-`:363`, whose template is, verbatim:
 *
 *     <svg class="{{ 'icon ' + svgIcon }}" style="fill: {{ svgFill }}">
 *         <use xlink:href="" ng-attr-xlink:href="{{ '#' + svgIcon }}" ng-attr-href="{{ '#' + svgIcon }}">
 *             <title ng-if="svgTitle">{{svgTitle}}</title>
 *             <title ng-if="svgTitleTranslate">{{svgTitleTranslate | translate: svgTitleTranslateValues}}</title>
 *         </use>
 *     </svg>
 *
 * declared over the isolate scope `{svgIcon: "@", svgTitle: "@",
 * svgTitleTranslate: "@", svgTitleTranslateValues: "=", svgFill: "="}` at
 * `:353`-`:359`. The six props below are that scope, one for one, plus the
 * `className` explained in section 3. Nothing is added and nothing is dropped
 * (rule T10 -- no functional or feature change whatsoever).
 *
 * ⚠ A NOTE ON HOW THIS FILE IS COMMENTED. Several constructs are forbidden
 * across `app/react/**` and are checked by simple text greps that do not
 * distinguish code from comments. Where such a construct has to be discussed
 * below it is therefore DESCRIBED rather than spelled out, so those greps stay
 * clean over the prose as well as over the code. This matches the convention
 * already established by `../bridge/useTranslate.ts` and
 * `../jsx-intrinsic-elements.d.ts`.
 *
 * The ONE deliberate exception is the AngularJS template quoted immediately
 * above, which is reproduced VERBATIM so that a reader can check this file
 * against its source without opening the CoffeeScript. It therefore contains the
 * two spellings sections 3 and 4 go on to reject -- the empty XLink literal and
 * the `ng-attr-*` forms -- as QUOTED INCUMBENT SOURCE, never as anything this
 * file emits. Search the JSX at the bottom, not the header, to see what is
 * actually rendered.
 *
 * --------------------------------------------------------------------------
 * 1. ZERO NEW ASSETS, AND WHY THE ICON IS A FRAGMENT REFERENCE (rule T3)
 * --------------------------------------------------------------------------
 * Rule T3 is verbatim: "Zero new icon assets. Reuse the 126-symbol sprite
 * already inlined into the document; the React `<Svg>` component references the
 * same fragment ids." So this file ships no icon of its own -- no path element,
 * no definitions element, no symbol element: it emits a `<use>` pointing at
 * `#<svgIcon>`, which resolves against `app/svg/sprite.svg` -- 126 symbol
 * elements, 609 lines, 128,660 bytes, measured -- inlined into the document by
 * `include svg/sprite.svg` at `app/index.jade:96`. `svgIcon` is therefore a
 * sprite fragment id such as `icon-add` or `icon-star`, NOT a path, a URL or an
 * imported asset.
 *
 * ⛔ LIGHT DOM ONLY -- NEVER SHADOW DOM (requirement I6). The shadow-root
 * attachment API is not called anywhere in this file, and calling it would break
 * the screen twice over: the
 * single global stylesheet is loaded at `app/index.jade:25` and a shadow root
 * would sever that cascade, collapsing the pass-through-Sass strategy of rule
 * T1; and a document-level `#icon-…` fragment is not reachable from inside a
 * shadow root, so every icon would render blank.
 *
 * --------------------------------------------------------------------------
 * 2. ⭐⭐ THE `<tg-svg>` WRAPPER IS LOAD-BEARING MARKUP, NOT DECORATION
 * --------------------------------------------------------------------------
 * Rule T1 is verbatim: "Preserve every CSS class name. The in-scope Sass is a
 * pass-through asset, not a rewrite target. React markup must emit the same
 * classes in the same nesting so the existing stylesheets apply verbatim." The
 * measured extension of that rule is that the stylesheets ALSO select on `tg-*`
 * ELEMENT names, so preserving classes while dropping the element name would
 * still break the cascade. `tg-svg` has ELEVEN such selectors, none of which may
 * be edited (rule T1 keeps the six in-scope stylesheets at zero edits, and rule
 * T4 puts `app/modules/components/card/**` off limits entirely):
 *
 *     app/styles/layout/backlog.scss:109
 *     app/styles/modules/backlog/backlog-table.scss:28, 63, 72, 419
 *     app/styles/modules/backlog/sprints.scss:37, 42
 *     app/styles/modules/kanban/kanban-table.scss:435, 484, 488
 *     app/modules/components/card/card.scss:189
 *
 * Those rules set `fill`, `width` and `margin` ON THE ELEMENT, and
 * `backlog-table.scss:28` nests `tg-svg { svg { @include svg-size(1rem); … } }`
 * -- a descendant `svg` INSIDE a `tg-svg` -- which independently pins the
 * `tg-svg > svg` nesting emitted below.
 *
 * ⭐ `card.scss:189` is the strictest of the eleven and the reason the wrapper
 * must be the OUTERMOST node this component returns. It reads
 * `& > tg-svg { fill: currentColor; }`, nested under
 * `.btn-form:not(.card-delete), .btn-link[variant='icon'] { &:hover { … } }`
 * (`:185`-`:191`) -- a DIRECT-CHILD combinator. Any extra element between the
 * button and the `tg-svg` (a `<span>`, a `<div>`, a styling wrapper) silently
 * kills the rule: no error, no warning, no build failure, nothing in the
 * console, just icons that stop tracking their button's hover colour. Nesting
 * depth is part of the contract, so this component returns `<tg-svg>` and never
 * wraps it.
 *
 * The wrapper is not an invention. `tgSvg` declares no `replace: true`
 * (`common.coffee:352`-`:361`), so AngularJS leaves the host `<tg-svg>` element
 * in the DOM; and `CardSvgTemplate` at `app/coffee/modules/kanban/main.coffee:855`-`:865`
 * writes the wrapper out literally. ⚠ That lodash template spells the second
 * attribute `attr-href` (`:858`), an AngularJS attribute-directive spelling that
 * is NOT reproduced here -- `common.coffee` is authoritative, and it emits a
 * real `href` (see section 4).
 *
 * `tg-svg` is deliberately NOT a Web Component: there is no `customElements.define`
 * for it anywhere (`elements.js` registers only `tg-legacy`, `tg-legacy-loader`
 * and `tg-project-navigation`). Browsers render an unregistered hyphenated tag as
 * an ordinary inline box, so the CSS above applies at runtime with no
 * registration at all. Its JSX typing already exists at
 * `app/react/jsx-intrinsic-elements.d.ts:151`, which is why this file declares
 * no ambient element type of its own.
 *
 * --------------------------------------------------------------------------
 * 3. ⭐ `className` IS FORWARDED TO THE HOST AS `class` -- NOT `className`
 * --------------------------------------------------------------------------
 * Two independent facts meet here, and getting either wrong is silent.
 *
 * FIRST, the class belongs on the HOST, not on the inner `<svg>`. Every call
 * site in the incumbent markup puts it there while the inner `<svg>` keeps its
 * fixed `icon <id>` class: `tg-svg.default-swimlane-icon(svg-icon="icon-star")`
 * at `app/partials/includes/modules/kanban-table.jade:103`,
 * `tg-svg.add-action(svg-icon="icon-add")` at `:181`, `tg-svg.unfold-action(…)`
 * at `:85`, `tg-svg.fold-action(…)` at `:89`, and
 * `<tg-svg class="capslock" … svg-icon='icon-capslock' …>` at
 * `common.coffee:333`. It is load-bearing rather than cosmetic:
 * `app/styles/modules/kanban/kanban-table.scss:465`-`:471` sizes
 * `.unfold-action, .fold-action` at `height: 16px; width: 16px`, so a class that
 * landed on the inner `<svg>` instead would leave those icons unsized. The inner
 * `<svg>`'s class is therefore EXACTLY `icon <svgIcon>` -- a fixed two-token
 * class, never a place to merge a caller's value.
 *
 * SECOND, the attribute has to be spelled `class`. react-dom 18 classifies a
 * hyphenated tag name as a custom element and forwards every prop to
 * `setAttribute()` under its RAW name, skipping the `className` -> `class`
 * translation it performs for stock elements
 * (`node_modules/react-dom/cjs/react-dom.development.js:787`). Measured against
 * this exact toolchain (react 18.2.0 / react-dom 18.2.0):
 *
 *     <tg-svg className="add-action" />  renders  <tg-svg className="add-action">  WRONG
 *     <tg-svg class="add-action" />      renders  <tg-svg class="add-action">      right
 *
 * `app/react/jsx-intrinsic-elements.d.ts:130`-`:138` therefore REMOVES
 * `className` from this element's prop type and adds `class`, so the slip is a
 * loud compile error instead of the invisible loss of every CSS class on every
 * icon. Its header prescribes the resolution used below in terms: a component
 * "may still expose a `className` PROP of its own, which is idiomatic; it simply
 * has to forward the value to the host element as `class`". So the PUBLIC prop
 * keeps the idiomatic React name and only the emitted ATTRIBUTE differs. The
 * same split is already house style for `tg-animated-counter` in
 * `app/react/kanban/TaskCounter.tsx`.
 *
 * --------------------------------------------------------------------------
 * 4. `<use>` CARRIES BOTH `xlink:href` AND `href`, AND NEITHER IS EMPTY
 * --------------------------------------------------------------------------
 * `common.coffee:345` interpolates the fragment onto BOTH attributes, via
 * `ng-attr-xlink:href` and `ng-attr-href`, and both are reproduced: the legacy
 * XLink form for SVG 1.1 consumers and the plain form for SVG 2. React 18
 * renders the `xlinkHref` prop as the namespaced `xlink:href` attribute, which
 * was verified against this toolchain rather than assumed.
 *
 * ⚠ The bare, EMPTY XLink literal written on that same line is NOT reproduced.
 * It exists only because `ng-attr-*` is what AngularJS uses to keep an unresolved
 * `{{…}}` out of an attribute the browser parses eagerly, and the empty literal
 * is what sits there until the first digest resolves it. React computes the value
 * before it ever reaches the DOM, so there is no unresolved interval to guard and
 * an empty duplicate would be pure noise.
 *
 * --------------------------------------------------------------------------
 * 5. TWO INDEPENDENT `<title>` CHILDREN, BOTH INSIDE `<use>`
 * --------------------------------------------------------------------------
 * `common.coffee:346`-`:347` places two `<title>` elements INSIDE `<use>` --
 * not inside `<svg>` directly, and not as siblings of `<use>` -- under two
 * SEPARATE `ng-if`s. Separate, not exclusive: supplying both `svgTitle` and
 * `svgTitleTranslate` renders BOTH titles, in source order, `svgTitle` first.
 * That is reproduced exactly, including AngularJS's truthiness, under which an
 * empty string renders no title at all -- which matters because
 * `main.coffee:886` defaults `svgTitle` to `''` for every card icon.
 *
 * --------------------------------------------------------------------------
 * 6. NO ACCESSIBILITY, PERFORMANCE OR ROBUSTNESS ADDITIONS (rule T10)
 * --------------------------------------------------------------------------
 * The incumbent directive emits no accessibility role attribute, no ARIA
 * attributes, no focusability hint, no view-box, no description element, no
 * fallback for an unknown fragment id and no error handling, so neither does
 * this file: each of those would be a functional change, and the Minimal Change
 * Clause forbids enhancing beyond the requirement.
 *
 * ⚠ Invisible accessibility is not being skipped here -- there is none to add.
 * An icon is decorative when it carries no title and is labelled by its own
 * title element when it does, and both of those are already exactly what the
 * incumbent emits. Anything further belongs on the CALLING control (the button
 * or link that owns the icon), not on the icon.
 *
 * For the same Minimal-Change reason this component is not memoised: neither a
 * memoising component wrapper nor either of React's memoised-value and
 * memoised-callback hooks is used. The directive has no such behaviour, the
 * render is a handful of elements, and memoising it would be optimisation the
 * requirement does not ask for.
 *
 * Caller-supplied text is rendered as a JSX CHILD, so React escapes it. That
 * satisfies the security mandate of AAP section 0.8.2 -- user-authored content
 * renders as TEXT, never as markup. React's raw-HTML injection prop is not used,
 * and must never appear anywhere under `app/react/**`.
 *
 * All new code is isolated to this file under `app/react/**` (rule T8), and no
 * stylesheet accompanies it: the existing rules already style `tg-svg` and
 * `.icon`, so adding one would be an unnecessary change.
 * ========================================================================== */

import type * as React from 'react';

import { useTranslate } from '../bridge/useTranslate';
import type { TranslateFn } from '../bridge/useTranslate';

/**
 * Interpolation parameters for a translated title.
 *
 * Derived STRUCTURALLY from the second parameter of the translate function
 * rather than restated, so this type and `../bridge/useTranslate` can never
 * drift apart. It is the React counterpart of `svgTitleTranslateValues` from the
 * directive's isolate scope (`app/coffee/modules/common.coffee:357`), which the
 * template hands to the `translate` filter at `:347`.
 */
type SvgTitleTranslateValues = Parameters<TranslateFn>[1];

/**
 * Props of {@link Svg}, one for one with the `tgSvg` isolate scope at
 * `app/coffee/modules/common.coffee:353`-`:359`, plus `className`.
 */
interface SvgProps {
    /**
     * A fragment id in the inlined sprite, without the leading `#` -- for
     * example `icon-add` or `icon-star`. Emitted twice: as the second token of
     * the inner `<svg>`'s `icon <svgIcon>` class, and as the `#<svgIcon>`
     * fragment on `<use>`. Required, because an icon with no symbol to
     * reference has nothing to draw.
     */
    readonly svgIcon: string;

    /**
     * A pre-translated, literal title. Rendered verbatim as an escaped text
     * child of a `<title>` inside `<use>`. An empty string renders no title,
     * matching the AngularJS truthiness of `<title ng-if="svgTitle">`.
     */
    readonly svgTitle?: string;

    /**
     * A translation KEY -- for example `COMMON.CAPSLOCK_WARNING`. Resolved
     * through the AngularJS translation service and rendered as a SECOND
     * `<title>`, independently of `svgTitle`.
     */
    readonly svgTitleTranslate?: string;

    /**
     * Interpolation values for `svgTitleTranslate`. Ignored, exactly as the
     * `translate` filter ignores them, when there is no key to interpolate into.
     */
    readonly svgTitleTranslateValues?: SvgTitleTranslateValues;

    /**
     * A CSS colour for the inner `<svg>`'s `fill`, applied inline as the
     * directive does. Omit it to let the stylesheets decide -- which is the
     * normal case, since the eleven `tg-svg` rules listed in section 2 of this
     * file's header set `fill` themselves.
     */
    readonly svgFill?: string;

    /**
     * Classes for the HOST `<tg-svg>` element, such as `add-action` or
     * `fold-action`. Forwarded to the host as the `class` attribute, for the two
     * reasons set out in section 3 of this file's header. Never merged into the
     * inner `<svg>`'s fixed `icon <svgIcon>` class.
     */
    readonly className?: string;
}

/** Props of the module-private {@link SvgTranslatedTitle}. */
interface SvgTranslatedTitleProps {
    /** The translation key to resolve. */
    readonly translateKey: string;

    /** Interpolation values for `translateKey`. */
    readonly values?: SvgTitleTranslateValues;
}

/*
 * ⭐ WHY THE TRANSLATED TITLE IS ITS OWN COMPONENT (technology-specific, T9)
 *
 * This exists so that the overwhelmingly common `<Svg svgIcon="icon-add" />`
 * needs NO AngularJS provider above it, while the translated path still behaves
 * exactly like the `| translate:` filter at
 * `app/coffee/modules/common.coffee:347`.
 *
 * The Rules of Hooks forbid calling a hook conditionally, so `Svg` cannot call
 * `useTranslate()` only when a key was supplied. Calling it unconditionally is
 * not an option either: `useTranslate` resolves `$translate` and `$rootScope`
 * through the bridge injector and THROWS when there is no
 * `AngularBridgeProvider` above it (`../bridge/useAngularService.ts`). Since
 * icons appear inside virtually every component on both screens, that would drag
 * a provider requirement into every downstream spec that renders anything
 * containing an icon -- a large, purely incidental cost.
 *
 * Moving the hook into a child resolves it cleanly, because conditionally
 * RENDERING a component that uses a hook is legal, while conditionally CALLING
 * the hook is not. The result also maps one-for-one onto the source: two
 * independent `<title ng-if=…>` elements become two independently rendered
 * children, and only the translated one has a translation dependency.
 */
function SvgTranslatedTitle({ translateKey, values }: SvgTranslatedTitleProps): React.JSX.Element {
    // Legal and unconditional AT THIS COMPONENT'S TOP LEVEL, which is what the
    // Rules of Hooks require. The subscription and teardown live in the hook.
    const t: TranslateFn = useTranslate();

    // A text child, so React escapes it (section 6 of this file's header).
    return <title>{t(translateKey, values)}</title>;
}

/**
 * Renders one icon from the sprite inlined at `app/index.jade:96`.
 *
 * The React replacement for the `tgSvg` element directive at
 * `app/coffee/modules/common.coffee:342`-`:363`, emitting the same markup so the
 * existing stylesheets apply with zero edits (rule T1). The rendered shape is
 * exactly:
 *
 * ```html
 * <tg-svg class="add-action">
 *     <svg class="icon icon-add" style="fill: #008AA8">
 *         <use xlink:href="#icon-add" href="#icon-add">
 *             <title>…</title>
 *         </use>
 *     </svg>
 * </tg-svg>
 * ```
 *
 * @example Plain icon -- needs no AngularJS provider above it.
 * ```tsx
 * <Svg svgIcon="icon-add" />
 * ```
 *
 * @example Host classes, which is how the incumbent markup sizes its icons.
 * ```tsx
 * <Svg svgIcon="icon-star" className="default-swimlane-icon" />
 * ```
 *
 * @example A translated title -- requires an `AngularBridgeProvider` ancestor.
 * ```tsx
 * <Svg svgIcon="icon-add" svgTitleTranslate="COMMON.CAPSLOCK_WARNING" />
 * ```
 *
 * @param props - see {@link SvgProps}.
 * @returns the `<tg-svg>` host element with the sprite reference inside it.
 * @throws Error, from `useTranslate`, only when `svgTitleTranslate` is supplied
 *         and no `AngularBridgeProvider` is mounted above this component. The
 *         sibling error boundary contains that so the AngularJS shell survives.
 */
function Svg({
    svgIcon,
    svgTitle,
    svgTitleTranslate,
    svgTitleTranslateValues,
    svgFill,
    className,
}: SvgProps): React.JSX.Element {
    // Computed once and used on both attributes below, so the two can never
    // disagree. `common.coffee:345` interpolates `'#' + svgIcon` twice.
    const spriteFragment = `#${svgIcon}`;

    return (
        // `class`, NOT `className` -- react-dom 18 does not translate `className`
        // on a hyphenated tag name, so the idiomatic React prop is forwarded to
        // the idiomatic HTML attribute here (section 3 of the file header).
        // `undefined` makes React omit the attribute, which is what the
        // incumbent markup does for a call site that passes no class.
        <tg-svg class={className}>
            {/*
              * The inner class is EXACTLY `icon <svgIcon>`, reproducing
              * `{{ 'icon ' + svgIcon }}` at `common.coffee:344`.
              *
              * `style={{ fill: svgFill }}`: when `svgFill` is undefined React
              * omits the whole `style` attribute, whereas AngularJS emitted an
              * empty `style="fill: "`. The two are CSS-equivalent -- an empty
              * declaration is invalid and discarded by the parser -- and no
              * stylesheet in scope selects on `[style]`, so nothing observes the
              * difference. An empty string is deliberately NOT synthesised to
              * fake the attribute.
              */}
            <svg className={`icon ${svgIcon}`} style={{ fill: svgFill }}>
                {/*
                  * BOTH the namespaced and the plain reference, as
                  * `common.coffee:345` does through its two `ng-attr-*` forms.
                  * The bare, EMPTY XLink literal on that same line is an
                  * AngularJS interpolation guard with no React equivalent and is
                  * intentionally not emitted (section 4 of the file header).
                  */}
                <use xlinkHref={spriteFragment} href={spriteFragment}>
                    {/*
                      * Two independent titles inside `<use>`, `svgTitle` first,
                      * mirroring `common.coffee:346`-`:347`. Independent, not
                      * exclusive: both render when both props are supplied.
                      */}
                    {svgTitle ? <title>{svgTitle}</title> : null}
                    {svgTitleTranslate ? (
                        <SvgTranslatedTitle
                            translateKey={svgTitleTranslate}
                            values={svgTitleTranslateValues}
                        />
                    ) : null}
                </use>
            </svg>
        </tg-svg>
    );
}

/* ==========================================================================
 * EXPORTS
 *
 * The public surface is exactly the component and the type of its props. The
 * translated-title child stays module-private: it is an implementation detail of
 * the two-`<title>` contract, not something a caller composes. There is no
 * default export, so every consumer imports the same named symbol --
 * `import { Svg } from '../shared/Svg';`. `isolatedModules: true`
 * (`tsconfig.json:19`) requires the type-only export to be declared as such.
 * ========================================================================== */

export { Svg };
export type { SvgProps };
