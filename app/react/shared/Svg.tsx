/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type * as React from 'react';

import type { TranslateFn } from '../bridge/useTranslate';

type SvgTitleTranslateValues = Parameters<TranslateFn>[1];

interface SvgProps {
    readonly svgIcon: string;

    readonly svgTitle?: string;

    readonly svgTitleTranslate?: string;

    readonly svgTitleTranslateValues?: SvgTitleTranslateValues;

    readonly svgFill?: string;

    readonly className?: string;

    /**
     * The OWNER'S translator, used only to resolve {@link svgTitleTranslate}.
     *
     * ⭐ INJECTED, NOT RESOLVED HERE, AND OPTIONAL. See the block below for why
     * this component no longer reaches for translation itself.
     */
    readonly translate?: TranslateFn;
}

/*
 * ⭐ WHY THIS COMPONENT NO LONGER RESOLVES TRANSLATION ITSELF (T9)
 *
 * `Svg` is the most-rendered leaf on both screens -- an icon appears inside
 * virtually every component -- and it is PURELY PRESENTATIONAL: given its props it
 * emits markup, with no data of its own to fetch and no state to keep. A leaf like
 * that must not reach into the AngularJS seam.
 *
 * WHAT IT USED TO DO, AND WHY THAT WAS WRONG. An earlier form called
 * `useTranslate()` inside a module-private `SvgTranslatedTitle` child, because the
 * Rules of Hooks forbid calling a hook conditionally and `useTranslate` cannot be
 * called unconditionally here either -- it resolves the translation service through
 * the bridge injector and THROWS when no `AngularBridgeProvider` is mounted above
 * it. So the file carried an extra component whose entire reason for existing was
 * to work around a hook it should never have needed. Two costs followed: the most
 * common leaf in the tree acquired a latent AngularJS provider requirement, visible
 * only when a caller happened to pass a translation key; and the presentational /
 * container split that requirement I9's coverage gate depends on was broken at the
 * leaf, since the component could no longer be rendered as a pure function of its
 * props.
 *
 * WHAT IT DOES NOW. The owner passes {@link SvgProps.translate}, and the workaround
 * component is gone. The hook is not called conditionally -- it is not called at
 * all -- so the Rules of Hooks are satisfied trivially rather than worked around,
 * `<Svg svgIcon="icon-add" />` needs no provider ANYWHERE, and a spec renders this
 * component with no wrapper at all.
 *
 * DEGRADATION IS DELIBERATE AND MATCHES THE INCUMBENT: with a key but no
 * translator, the KEY ITSELF is rendered, which is exactly what
 * `$translate.instant` returns for a key it cannot resolve. A blank title would be
 * a worse outcome and a different behaviour.
 *
 * The two-`<title>` contract is unaffected: `common.coffee:346`-`:347` renders two
 * independent `<title ng-if=…>` elements, and so does this file.
 */

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
 */
function Svg({
    svgIcon,
    svgTitle,
    svgTitleTranslate,
    svgTitleTranslateValues,
    svgFill,
    className,
    translate,
}: SvgProps): React.JSX.Element {
    const spriteFragment = `#${svgIcon}`;

    return (
        <tg-svg class={className}>
            <svg className={`icon ${svgIcon}`} style={{ fill: svgFill }}>
                <use xlinkHref={spriteFragment} href={spriteFragment}>
                    {svgTitle ? <title>{svgTitle}</title> : null}
                    {svgTitleTranslate ? (
                        /*
                          * A text child, so React escapes it (section 6 of the file
                          * header). With no translator the key renders verbatim --
                          * `$translate.instant`'s own missing-key behaviour.
                          */
                        <title>
                            {translate === undefined
                                ? svgTitleTranslate
                                : translate(svgTitleTranslate, svgTitleTranslateValues)}
                        </title>
                    ) : null}
                </use>
            </svg>
        </tg-svg>
    );
}

export { Svg };
export type { SvgProps };
