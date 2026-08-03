/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type * as React from 'react';

/**
 * Prop type for the hyphenated element names React renders in light DOM.
 *
 * `className` is removed and the real HTML `class` attribute added, because
 * react-dom forwards props to a hyphenated tag name verbatim and never translates
 * `className` into `class` for one. Existing stylesheet rules select on `class`, so
 * that spelling is the only one that lands.
 */
type TgElementAttributes = Omit<React.HTMLAttributes<HTMLElement>, 'className'> & {
    class?: string;
};

declare module 'react' {
    namespace JSX {
        interface IntrinsicElements {
            /**
             * Neither of these is a registered custom element. They are declared
             * because the existing stylesheets select on the element NAME — the icon
             * host has direct-child rules against it, and the card root appears inside
             * the fold and fold-animation selectors — so the tags have to survive into
             * the React markup for those unedited rules to keep matching.
             */
            'tg-svg': React.DetailedHTMLProps<TgElementAttributes, HTMLElement>;

            'tg-card': React.DetailedHTMLProps<TgElementAttributes, HTMLElement>;
        }
    }
}
