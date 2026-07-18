/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * WipLimit — the Kanban "WIP Limit" marker for a single board column.
 *
 * This module is the React 18 replacement for the legacy `tgKanbanWipLimit`
 * directive (`KanbanWipLimitDirective`, kanban `main` module, lines 815-853)
 * of the in-place screen migration. Behaviour is reproduced EXACTLY under the
 * Minimal Change Clause — zero feature change.
 *
 * WHAT THE LEGACY DIRECTIVE DID
 *   For a given column status it counted the story cards in the column and,
 *   depending on how that count compared with the column's `wip_limit`,
 *   inserted a single marker node
 *       <div class='kanban-wip-limit {state}'><span>WIP Limit</span></div>
 *   immediately AFTER one specific card:
 *     - count + 1 === wip_limit  -> state 'one-left', after the LAST card
 *     - count     === wip_limit  -> state 'reached',  after the LAST card
 *     - count      >  wip_limit  -> state 'exceeded', after the card at
 *                                   index (wip_limit - 1)
 *   Archived columns, and columns without a positive `wip_limit`, never showed
 *   a marker (the legacy code only attached its handlers when the status
 *   existed and was not archived).
 *
 * HOW THIS MAPS TO REACT
 *   The legacy version recomputed the marker imperatively on four broadcast
 *   events (`redraw:wip`, `kanban:us:move`, `usform:new:success`,
 *   `usform:bulk:success`). In React those broadcasts are replaced by ordinary
 *   re-rendering: whenever the card list changes the owning column re-renders
 *   and the marker is recomputed purely from props. Those events are therefore
 *   NOT ported.
 *
 * PURITY / RESPONSIBILITY SPLIT
 *   This module is presentational and side-effect free. It performs no data
 *   fetching, no network or socket access, no state mutation, and touches no
 *   DOM directly. `computeWipLimit` is a pure function of `(status, cardCount)`
 *   and `WipLimit` is a render-only component. Positioning the marker relative
 *   to the cards is intentionally NOT done here — that is the owning column's
 *   responsibility — which keeps both exports trivially unit-testable.
 *
 * CONSUMER CONTRACT (TaskboardColumn)
 *   // TaskboardColumn computes `const wip = computeWipLimit(status, cardIds.length)` once per render,
 *   // then while mapping cards renders <WipLimit className={wip.className}/> immediately AFTER the
 *   // card whose index === wip.afterIndex. No marker is rendered when computeWipLimit returns null.
 */

import type { Status } from '../../shared/types';

/**
 * The outcome of {@link computeWipLimit}: the visual state class the marker
 * must carry, plus the 0-based index of the card the marker is rendered after.
 *
 * `className` is exactly one of the three legacy state strings. `afterIndex`
 * is an index into the column's ordered card list — the consumer renders the
 * `<WipLimit/>` element immediately after the card at this index.
 */
export interface WipLimitResult {
    /** WIP state modifier: `one-left` (one card left), `reached` (at limit) or `exceeded` (over limit). */
    className: 'one-left' | 'reached' | 'exceeded';
    /** 0-based index of the card the marker is rendered directly after. */
    afterIndex: number;
}

/**
 * Decide whether — and where — a WIP-limit marker should be rendered for a
 * column, reproducing the legacy directive's branching EXACTLY.
 *
 * The evaluation order is significant and mirrors the original sequence:
 *   1. No marker at all when the column is archived, or when it has no positive
 *      `wip_limit` (a `null` / `0` / falsy limit disables the marker entirely).
 *   2. `cardCount + 1 === wip_limit` -> 'one-left' (marker after the last card).
 *   3. `cardCount     === wip_limit` -> 'reached'  (marker after the last card).
 *   4. `cardCount      >  wip_limit` -> 'exceeded' (marker after card wip_limit-1).
 *   5. Otherwise the column is under its limit -> no marker (`null`).
 *
 * @param status    The column's user-story status. Its `wip_limit` drives the
 *                   result and `is_archived` suppresses the marker.
 * @param cardCount The number of story cards currently in the column (the React
 *                   equivalent of the legacy `tg-card` element count).
 * @returns A {@link WipLimitResult} describing the marker, or `null` when no
 *          marker should be shown.
 */
export function computeWipLimit(status: Status, cardCount: number): WipLimitResult | null {
    // Guard (mirrors the legacy `if status and not status.is_archived`): archived
    // columns, and columns without a positive limit, never render a marker.
    if (status.is_archived || !status.wip_limit) {
        return null;
    }

    // `wip_limit` is narrowed to a positive number by the guard above.
    const wipLimit: number = status.wip_limit;

    if (cardCount + 1 === wipLimit) {
        // One card away from the limit: highlight the final card.
        return { className: 'one-left', afterIndex: cardCount - 1 };
    } else if (cardCount === wipLimit) {
        // Exactly at the limit: highlight the final card.
        return { className: 'reached', afterIndex: cardCount - 1 };
    } else if (cardCount > wipLimit) {
        // Over the limit: highlight the card sitting on the limit boundary.
        return { className: 'exceeded', afterIndex: wipLimit - 1 };
    }

    // Under the limit: no marker.
    return null;
}

/**
 * Props for {@link WipLimit}. `className` is the WIP state class produced by
 * {@link computeWipLimit} (`one-left` | `reached` | `exceeded`); it is appended
 * to the fixed `kanban-wip-limit` base class.
 */
interface WipLimitProps {
    /** WIP state modifier class appended to the base `kanban-wip-limit` class. */
    className: string;
}

/**
 * Render-only WIP-limit marker. This is the byte-for-byte React equivalent of
 * the legacy marker node
 *     `<div class='kanban-wip-limit {state}'><span>WIP Limit</span></div>`
 * and reuses the existing `kanban-wip-limit` stylesheet class verbatim. The
 * literal text `WIP Limit` is intentionally NOT translated — it matches the
 * original template exactly.
 */
export function WipLimit({ className }: WipLimitProps): JSX.Element {
    return (
        <div className={`kanban-wip-limit ${className}`}>
            <span>WIP Limit</span>
        </div>
    );
}
