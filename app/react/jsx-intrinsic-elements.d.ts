/**
 * jsx-intrinsic-elements.d.ts — ambient JSX typings for the AngularJS-era element names
 * that the migrated React screens are obliged to keep emitting.
 *
 * TECHNOLOGY-SPECIFIC CHANGE AT THE AngularJS/React SEAM (transformation rule T9).
 *
 * =====================================================================================
 * IF YOU ARRIVED HERE FROM A COMPILE ERROR ABOUT `className`
 * =====================================================================================
 * On `<tg-svg>` and `<tg-card>`, write `class="…"` — NOT `className="…"`.
 *
 * Both tag names contain a hyphen, so react-dom classifies them as custom elements and
 * forwards every prop to `setAttribute()` under its RAW name, skipping the
 * `className` -> `class` translation it performs for stock elements. The branch is
 * `setValueForProperty` in node_modules/react-dom/cjs/react-dom.development.js:787 —
 * `if (isCustomComponentTag || propertyInfo === null) { var _attributeName = name; … }`.
 * Measured against this exact toolchain (react 18.2.0 / react-dom 18.2.0, jsdom):
 *
 *     <tg-svg className="add-action" />   renders   <tg-svg classname="add-action">  WRONG
 *     <tg-svg class="add-action" />       renders   <tg-svg class="add-action">      right
 *     <span className="add-action" />     renders   <span class="add-action">        stock
 *
 * React's own documentation prescribes exactly this: `className` for regular DOM and SVG
 * elements, but the `class` attribute when rendering Web Components. `className` is
 * therefore deliberately REMOVED from these two elements' prop types, so that a slip is a
 * loud compile error rather than the silent, invisible loss of every CSS class on every
 * card and every icon on both migrated screens. Re-adding `className` here would
 * re-introduce that regression — do not.
 *
 * A React component may still expose a `className` PROP of its own, which is idiomatic; it
 * simply has to forward the value to the host element as `class`. For example:
 * `<tg-svg class={className}>…</tg-svg>`.
 *
 * =====================================================================================
 * WHY THIS FILE EXISTS
 * =====================================================================================
 * The migration reuses the existing, UNEDITED Sass verbatim (transformation rule T1:
 * "React markup must emit the same classes in the same nesting so the existing
 * stylesheets apply verbatim"). Those stylesheets do not select on class names alone —
 * they also select on `tg-*` ELEMENT names, so preserving classes while dropping the
 * element names would still break the cascade. The two element names React itself
 * renders are therefore load-bearing markup rather than decoration:
 *
 *   `tg-svg`  — 11 element selectors, none of which may be edited:
 *               app/styles/layout/backlog.scss:109
 *               app/styles/modules/backlog/backlog-table.scss:28, 63, 72, 419
 *               app/styles/modules/backlog/sprints.scss:37, 42
 *               app/styles/modules/kanban/kanban-table.scss:435, 484, 488
 *               app/modules/components/card/card.scss:189
 *   `tg-card` — 2 element selectors:
 *               app/styles/modules/kanban/kanban-table.scss:65, 76
 *
 * card.scss:189 is the strictest of them. It reads `& > tg-svg { fill: currentColor; }`,
 * nested under `.btn-form:not(.card-delete), .btn-link[variant='icon'] { &:hover { … } }`
 * — a DIRECT-CHILD selector, so an extra wrapper element between the button and the
 * `tg-svg` silently kills the rule. Nesting depth is part of the contract, not incidental.
 * card.scss is additionally protected by rule T4, which forbids modifying
 * app/modules/components/card, because the out-of-scope taskboard shares it. Adapting the
 * CSS to suit React was therefore never an option; the markup has to adapt instead.
 *
 * The wrapper is not an invention — the incumbent code already renders it. See
 * app/coffee/modules/kanban/main.coffee L855-L865, where `CardSvgTemplate` wraps the
 * `<svg>` in `<tg-svg>`, and app/coffee/modules/common.coffee L342-L363, where the `tgSvg`
 * element directive declares no `replace: true` and so leaves its host element in the DOM.
 * The card root is likewise `tg-card.card.ng-animate-disabled(data-id="{{ usId }}" …)` at
 * app/partials/includes/modules/kanban-table.jade L150 (swimlane mode) and L226 (flat mode).
 *
 * =====================================================================================
 * WHY A TYPE DECLARATION IS NEEDED AT ALL
 * =====================================================================================
 * Neither name is a Web Component: there is deliberately no `customElements.define` for
 * either one, and React mounts into LIGHT DOM so that the single global stylesheet and the
 * in-document SVG sprite stay reachable. Browsers render unknown elements as ordinary
 * inline boxes, so the CSS applies at runtime with no registration whatsoever — but
 * TypeScript in `strict` mode rejects unknown JSX intrinsic elements at COMPILE time
 * (TS2339, "Property 'tg-svg' does not exist on type 'JSX.IntrinsicElements'"). Declaring
 * the two names here is what keeps `tsc --noEmit` clean across app/react without
 * weakening a single type anywhere else.
 *
 * =====================================================================================
 * SCOPE AND SHAPE — DELIBERATE DECISIONS
 * =====================================================================================
 *  - Exactly two names are declared, because exactly two are rendered by React. Every
 *    other `tg-*` element selector in the stylesheets belongs either to a component that
 *    stays AngularJS-rendered — and so keeps its tag name naturally — or to the shared
 *    card's internals, which rule T4 puts off limits. Nothing is declared speculatively;
 *    a name is added here only once a React component in this migration truly emits it.
 *  - There is NO catch-all index signature. One would make every mistyped element name
 *    compile silently, which is the opposite of what `strict` exists for.
 *  - Everything else on `React.HTMLAttributes` is kept, so `id`, `title`, `style`, `role`,
 *    `tabIndex`, event handlers, `aria-*` and `ref`/`key` are all checked normally. Those
 *    camelCase prop names lowercase to the correct HTML attribute on a hyphenated tag
 *    (`tabIndex` -> `tabindex`), so `className` is the only one that had to be removed.
 *    Hyphenated attributes such as `data-id` are accepted by TypeScript without being
 *    declared, and `style` objects still work because react-dom handles them before the
 *    custom-element branch.
 *  - The DOM type parameter is `HTMLElement`, which is the accurate one: a hyphenated tag
 *    name is a VALID custom-element name, so the parser instantiates it as `HTMLElement`
 *    even while it is unregistered — not as `HTMLUnknownElement`. Verified against the
 *    running application, where every live `tg-svg` reports the prototype chain
 *    HTMLElement -> Element -> Node -> EventTarget and `instanceof HTMLUnknownElement`
 *    is false. `class` is optional and may legitimately be the empty string, which the
 *    incumbent markup does emit.
 *  - `React.JSX.IntrinsicElements` is augmented, rather than the deprecated global `JSX`
 *    namespace, because tsconfig.json sets `jsx: "react-jsx"`: the compiler resolves the
 *    JSX namespace through `react/jsx-runtime`, whose `IntrinsicElements` extends
 *    `React.JSX`'s. Verified sufficient on its own against @types/react 18.2.79, so the
 *    legacy global augmentation is intentionally omitted.
 *  - The React import is TYPE-ONLY, and it has to be an import for two reasons.
 *    tsconfig.json sets `types: ["jest", "node"]`, so react's typings are reached only by
 *    importing them; and a module augmentation is an augmentation only inside a module —
 *    in a script file, `declare module 'react'` would REPLACE the react module wholesale.
 *    `import type` keeps this file a module while emitting nothing, which is what
 *    `isolatedModules` requires.
 *
 * This file contributes ZERO runtime bytes: it declares types only, esbuild strips it from
 * the bundle entirely, and it changes no behaviour (rule T10).
 */

import type * as React from 'react';

/**
 * Prop type shared by the AngularJS-era element names React renders in light DOM.
 *
 * It is `React.HTMLAttributes<HTMLElement>` with `className` removed and the real HTML
 * `class` attribute added, because react-dom 18 forwards props to hyphenated tag names
 * verbatim and never translates `className` into `class` for them — see this file's
 * header for the measurement and the react-dom locator.
 */
type TgElementAttributes = Omit<React.HTMLAttributes<HTMLElement>, 'className'> & {
    /**
     * The literal `class` attribute. Use this instead of `className`: it is the only
     * spelling react-dom writes through correctly on a hyphenated element name, and every
     * `.card`, `.card-inner`, `.add-action`, `.bulk-action`, `.fold-action` and similar
     * rule in the untouched stylesheets depends on it landing as `class`.
     */
    class?: string;
};

declare module 'react' {
    namespace JSX {
        interface IntrinsicElements {
            /**
             * `<tg-svg>` — the icon host emitted by app/react/shared/Svg.tsx around the
             * `<svg><use href="#icon-…" /></svg>` it renders, mirroring `CardSvgTemplate`
             * at app/coffee/modules/kanban/main.coffee L855-L865. Required so that the 11
             * `tg-svg` element selectors listed in this file's header keep matching,
             * including the direct-child rule at
             * app/modules/components/card/card.scss:189. NOT a registered custom element.
             */
            'tg-svg': React.DetailedHTMLProps<TgElementAttributes, HTMLElement>;

            /**
             * `<tg-card>` — the card root emitted by app/react/kanban/KanbanCard.tsx,
             * reproducing `tg-card.card.ng-animate-disabled(data-id="{{ usId }}" …)` from
             * app/partials/includes/modules/kanban-table.jade L150 and L226. Required so
             * that the fold rule and the fold/unfold animation rules at
             * app/styles/modules/kanban/kanban-table.scss:65 and :76 keep matching. Those
             * are nested inside the file's outer `.kanban-table` block, so they compile to
             * `.kanban-table .vfold tg-card { display: none; }` and
             * `.kanban-table .vfold-remove-active tg-card, …` — the element name is part of
             * the selector, which is why the tag has to survive into the React markup.
             * NOT a registered custom element.
             */
            'tg-card': React.DetailedHTMLProps<TgElementAttributes, HTMLElement>;
        }
    }
}
