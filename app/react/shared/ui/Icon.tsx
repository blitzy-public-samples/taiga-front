/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { createElement } from "react";

/**
 * Shared SVG-sprite icon, reproducing the AngularJS `tgSvg` directive output
 * (`app/coffee/modules/common.coffee` L343-361) verbatim so the compiled theme
 * styles it unchanged.
 *
 * The AngularJS directive `tg-svg.<wrapperClass>(svg-icon="icon-NAME"
 * svg-fill="…" svg-title="…")` expands to:
 *
 *     <tg-svg class="<wrapperClass>">
 *       <svg class="icon icon-NAME" style="fill: <fill>">
 *         <use xlink:href="#icon-NAME" href="#icon-NAME">
 *           <title>…</title>            <!-- only when a title is provided -->
 *         </use>
 *       </svg>
 *     </tg-svg>
 *
 * Reproducing this exact structure matters for TWO reasons:
 *
 *  1. **Intrinsic sizing.** `app/styles/core/elements.scss` sizes every inline
 *     `svg { height: 1rem; width: 1rem; }` and `app/styles/core/base.scss`
 *     lays out `tg-svg { display: flex; align-items: center; justify-content:
 *     center; }`. A bare `<span class="icon">` (the pre-fix output) has no
 *     intrinsic size, so icons rendered at 0×0 and icon-only buttons (the card
 *     `⋮` trigger) were unclickable. Emitting the real `<svg><use>` restores
 *     visible, correctly-sized glyphs.
 *
 *  2. **Descendant selectors.** Several theme rules target the wrapper class on
 *     `tg-svg` (e.g. `.add-action`, `.bulk-action`, `.fold-action`,
 *     `.default-swimlane-icon .icon`). Keeping the wrapper class on the
 *     `<tg-svg>` element — not on the `<svg>` — preserves those selectors.
 *
 * `createElement("tg-svg", …)` is used (instead of a literal `<tg-svg>` JSX
 * tag) so we do not have to augment the global `JSX.IntrinsicElements`
 * interface — matching the established precedent in the sibling React modules
 * (`BacklogTable`/`BacklogApp` `Svg` helper).
 */
export interface IconProps {
    /** Sprite symbol id WITHOUT the leading `#`, e.g. `"icon-add"`. */
    name: string;
    /**
     * Extra class(es) placed on the `<tg-svg>` wrapper element (mirrors the
     * AngularJS `tg-svg.<class>` selector target), e.g. `"add-action"`,
     * `"bulk-action"`, `"fold-action"`, `"default-swimlane-icon"`.
     */
    wrapperClass?: string;
    /** Explicit `fill` for the `<svg>` (mirrors `svg-fill`). */
    fill?: string;
    /**
     * Accessible/tooltip title rendered as `<title>` inside `<use>` (mirrors
     * `svg-title`). When omitted, no `<title>` is emitted and the glyph is
     * purely decorative (`aria-hidden`), matching the AngularJS default.
     */
    title?: string;
    /** Extra class(es) appended to the `<svg>` after `"icon icon-NAME"`. */
    className?: string;
}

export function Icon(props: IconProps): JSX.Element {
    const { name, wrapperClass, fill, title, className } = props;

    const svgClassName = `icon ${name}` + (className ? ` ${className}` : "");
    const decorative = !title;

    // NOTE: `<tg-svg>` is a custom element (unknown tag). React 18 does NOT map
    // the `className` prop to a `class` attribute on unknown elements — it emits
    // a literal, non-matching `classname="…"` attribute instead. The wrapper
    // class is a theme selector target (e.g. `.default-swimlane-icon .icon`,
    // `.add-action`), so it MUST land on a real `class` attribute; pass `class`
    // directly. (The inner `<svg>` is a known element, so `className` is correct
    // there.)
    return createElement(
        "tg-svg",
        wrapperClass ? ({ class: wrapperClass } as Record<string, string>) : null,
        <svg
            className={svgClassName}
            style={fill ? { fill } : undefined}
            aria-hidden={decorative ? "true" : undefined}
            focusable="false"
        >
            <use xlinkHref={`#${name}`} href={`#${name}`}>
                {title ? <title>{title}</title> : null}
            </use>
        </svg>,
    );
}

export default Icon;
