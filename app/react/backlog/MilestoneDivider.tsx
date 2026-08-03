/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { ReactElement } from 'react';

/**
 * The doom line: the labelled band the backlog interposes into the story list at the point
 * where cumulative estimation runs past the project's own point total.
 *
 * TECHNOLOGY SEAM -- what this supersedes, and why the shape changed.
 * This replaces the doomline portion of the retired `tgBacklog` directive, `linkDoomLine`
 * at `coffee/modules/backlog/main.coffee:L722-L764`, which the directive factory attached
 * to the screen at `L941`. That implementation was imperative and stateful about the DOM: a
 * lodash template compiled once at `L723-L725`, a jQuery `.before()` splice at `L755` that
 * injected the band in front of an already-rendered row, and a `.remove()` teardown at
 * `L751` that had to run FIRST on every recomputation so the previous band did not survive
 * into the next one. Four separate `$scope` listeners at `L761-L764` drove that cycle.
 *
 * React needs none of that machinery, so none of it is ported. `StoryTable.tsx` renders
 * this component declaratively at a computed position, which makes the band's presence and
 * its position both consequences of the data: recomputation is a re-render, and removal is
 * simply not rendering it. There is therefore no imperative insert, no imperative remove,
 * and no ordering hazard between the two -- the class of bug the `L751`-before-`L755`
 * sequencing existed to prevent cannot occur here.
 *
 * PLACEMENT IS DELIBERATELY NOT IN THIS FILE.
 * Where the band belongs is decided by `selectDoomLineIndex` in `./state/backlogSelectors.ts`,
 * which reproduces the arithmetic of `main.coffee:L727-L755` exactly: the running total is
 * seeded from the points already committed to sprints rather than from zero, story totals
 * accumulate in rendered order, the trigger is a strict greater-than, and the loop stops at
 * the first row that crosses the threshold -- so AT MOST ONE band ever exists, matching the
 * `break` at `L748`. That selector also carries the two dead velocity guards from `L729`
 * and `L732`: the incumbent tested a scope property the controller never assigned, so
 * neither guard could ever fire, and the band's real condition reduces to a non-zero
 * project point total. This component is a leaf that renders the band and reads no state,
 * computes no index and touches no DOM, so a reader should not look for placement here.
 *
 * STYLING IS ENTIRELY EXTERNAL.
 * `app/styles/components/doomline.scss` already dresses this element completely -- the fill,
 * the two-pixel corner radius, the flex centring on both axes, the vertical rhythm and the
 * label's colour, family, weight and size all come from there. Reproducing the incumbent's
 * class names verbatim is what lets that stylesheet apply unedited, so this file authors NO
 * CSS and hardcodes no colour, dimension or spacing: the band's rendered height and its
 * full-bleed width are outputs of that padding and of the backlog's own column grid, never
 * values written here.
 */
export interface MilestoneDividerProps {
    /**
     * The already-translated label. Translation belongs to the container: the incumbent
     * resolved it as `$translate.instant("BACKLOG.DOOMLINE")` at `main.coffee:L754`, and the
     * React equivalent is the caller reading the same message key through `useTranslate`.
     * Keeping the resolved string in a prop is what leaves this component pure, and it is
     * also why the English wording is nowhere in this file.
     */
    readonly text: string;
}

export function MilestoneDivider({ text }: MilestoneDividerProps): ReactElement {
    return (
        <div className="doom-line">
            {/*
             * The incumbent template interpolated this label with lodash's `<%- %>` form,
             * which HTML-ESCAPES its value -- deliberately, since the string arrives from a
             * translation catalogue. React's default escaping of a text child is equivalent,
             * so passing `text` as a child preserves that guarantee with no extra work: a
             * story or catalogue value containing markup renders as literal characters. The
             * "dangerously"-prefixed inner-HTML prop is the one construct that would break
             * the equivalence, and it is forbidden here.
             *
             * A text child also needs no nullish guard. React skips `null` and `undefined`
             * children instead of stringifying them, so a missing label degrades to an empty
             * band rather than printing the word for absence -- which is also what the
             * incumbent template did, since lodash's escape helper renders a nullish value
             * as an empty string.
             */}
            <span>{text}</span>
        </div>
    );
}
