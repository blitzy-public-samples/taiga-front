/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * shared/icon.tsx — the ONE shared SVG-sprite icon primitive for the migrated
 * React Kanban + Backlog screens (F-UI-02).
 *
 * WHY THIS EXISTS
 *   Taiga renders every icon as an inline SVG-sprite reference through its
 *   AngularJS `tg-svg` web component (`app/coffee/modules/common.coffee:341-363`),
 *   whose template is:
 *
 *     <svg class="{{ 'icon ' + svgIcon }}" style="fill: {{ svgFill }}">
 *       <use xlink:href="" ng-attr-xlink:href="{{ '#' + svgIcon }}"
 *            ng-attr-href="{{ '#' + svgIcon }}">
 *         <title ng-if="svgTitle">{{ svgTitle }}</title>
 *       </use>
 *     </svg>
 *
 *   The sprite `<symbol>`s are injected into the page by the shell, so a
 *   `<use href="#icon-name">` resolves at runtime. An empty `<span class="icon
 *   icon-name">` (as the Backlog container's placeholder emitted) CANNOT render
 *   a sprite icon, and the retained SCSS targets the `tg-svg` host and
 *   `svg.icon` directly (`app/styles/modules/kanban/kanban-table.scss:435,484,
 *   488,514`). This module reproduces the directive's exact DOM so the retained
 *   styles apply and the icons actually paint.
 *
 * CONSOLIDATION (per the F-UI-02 resolution — "use ONE shared primitive")
 *   Before this module, ~10 components each carried their own `tg-svg`
 *   declaration (a `declare global { JSX.IntrinsicElements }` block or a
 *   module-local `'tg-svg' as ...` alias) and hand-rolled the `<svg><use/></svg>`
 *   markup, and the Backlog container rendered a broken empty span. Those call
 *   sites now import {@link TgSvg} from here.
 *
 * ACCESSIBILITY (F-UI-04)
 *   Most icons are decorative and sit inside a labelled control, so the default
 *   is `aria-hidden` (removed from the a11y tree). When an icon is
 *   MEANINGFUL on its own (e.g. a status glyph with no adjacent text) the caller
 *   passes `title`, which renders an SVG `<title>` as the first child and marks
 *   the `<svg>` `role="img"` so assistive tech announces the accessible name.
 *   `focusable="false"` suppresses the legacy IE/Edge SVG focus quirk.
 *
 * NO GLOBAL JSX AUGMENTATION
 *   The `tg-svg` host is expressed through a module-local typed alias rather than
 *   a global `JSX.IntrinsicElements` augmentation, so importing this primitive
 *   never risks a duplicate-property merge conflict with any sibling that still
 *   declares its own intrinsic. At runtime the alias is simply the string
 *   `'tg-svg'`, which the React JSX runtime emits as a native custom element.
 *
 * Toolchain: React 18.2.0 / TypeScript 5.4.5 (`strict`, `jsx: "react-jsx"` — no
 * `import React`), Node v16.19.1 compatible.
 */

import type { CSSProperties, ReactElement, ReactNode } from 'react';

/**
 * Typed alias for the `<tg-svg>` custom-element host. Declaring it as a local
 * value (rather than augmenting the global JSX namespace) keeps this module
 * self-contained and collision-free.
 */
const TgSvgHost = 'tg-svg' as unknown as (props: {
    // NOTE: a custom element takes the literal `class` attribute — React 18
    // lowercases the special `className` prop to `classname` on unknown tags, so
    // the host MUST receive `class` to match the retained SCSS.
    class?: string;
    children?: ReactNode;
}) => ReactElement;

/** Props for {@link TgSvg}. */
export interface TgSvgProps {
    /** Sprite symbol id, e.g. `"icon-add"` (the legacy `svg-icon` value). */
    icon: string;
    /**
     * Accessible name. When provided the icon is treated as MEANINGFUL: an SVG
     * `<title>` is rendered and the `<svg>` gets `role="img"`. When omitted the
     * icon is decorative and hidden from assistive tech (`aria-hidden`).
     */
    title?: string;
    /** Optional `fill` colour (the legacy `svg-fill`); omitted → styled by SCSS. */
    fill?: string;
    /** Optional extra class applied to the `<tg-svg>` host (legacy placed
     *  modifier classes there). */
    className?: string;
}

/**
 * Render Taiga's `tg-svg` sprite icon. Reproduces the AngularJS `tg-svg`
 * directive's DOM exactly so the retained SCSS styles it and the injected
 * sprite symbol paints.
 *
 * @example Decorative (inside a labelled button): `<TgSvg icon="icon-add" />`
 * @example Meaningful (standalone): `<TgSvg icon="icon-lock" title="Blocked" />`
 */
export function TgSvg({ icon, title, fill, className }: TgSvgProps): ReactElement {
    const style: CSSProperties | undefined = fill ? { fill } : undefined;
    return (
        <TgSvgHost class={className}>
            <svg
                className={`icon ${icon}`}
                style={style}
                role={title ? 'img' : undefined}
                aria-hidden={title ? undefined : true}
                focusable="false"
            >
                {title ? <title>{title}</title> : null}
                {/* Both `xlink:href` (legacy browsers) and `href` (modern) — the
                    directive emitted both via `ng-attr-*`. */}
                <use xlinkHref={`#${icon}`} href={`#${icon}`} />
            </svg>
        </TgSvgHost>
    );
}

/**
 * Backwards-compatible thin alias used by call sites that passed a `name` prop
 * to a local `TgIcon`. It forwards to {@link TgSvg}, so a decorative icon is
 * `<TgIcon name="icon-add" />`. Prefer {@link TgSvg} in new code.
 */
export function TgIcon({ name, title }: { name: string; title?: string }): ReactElement {
    return <TgSvg icon={name} title={title} />;
}
