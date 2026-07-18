/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * WipLimit.test.tsx — PRIMARY browserless Jest + jsdom unit spec for the Kanban
 * WIP-limit logic and its render-only marker component.
 *
 * WHAT IS UNDER TEST
 *   - `computeWipLimit(status, cardCount)` — the pure decision function that
 *     ports the legacy `KanbanWipLimitDirective`
 *     (`app/coffee/modules/kanban/main.coffee:815-853`, READ-ONLY, never
 *     imported here). It decides whether a WIP marker is shown for a column and,
 *     if so, its state class (`one-left` | `reached` | `exceeded`) and the index
 *     of the card the marker is rendered after.
 *   - `WipLimit` — the render-only marker component, the byte-for-byte React
 *     equivalent of the legacy `<div class='kanban-wip-limit {state}'>
 *     <span>WIP Limit</span></div>` node.
 *
 * SOURCE-OF-TRUTH PARITY
 *   The legacy directive branched on the number of `tg-card` elements in a
 *   column (`cards.length`) versus `status.wip_limit`:
 *     - `cards.length + 1 === wip_limit` -> 'one-left', marker after the LAST card
 *     - `cards.length     === wip_limit` -> 'reached',  marker after the LAST card
 *     - `cards.length      >  wip_limit` -> 'exceeded', marker after card wip_limit-1
 *   and attached its handlers only when `status` existed and was NOT archived.
 *   The React `computeWipLimit` reproduces this exactly, additionally treating a
 *   falsy `wip_limit` (`null` / `0`) as "no limit configured" (no marker). Note
 *   that for the `one-left` / `reached` branches the "last card" index is
 *   `cardCount - 1`, which — at those exact boundaries — equals `wip_limit - 2`
 *   and `wip_limit - 1` respectively; the numeric vectors below are pinned to
 *   the real implementation.
 *
 * ISOLATION CONTRACT (hard requirements)
 *   - jsdom environment, no real/headless browser, no network, no timers.
 *   - No `import React` (tsconfig `jsx: 'react-jsx'` — automatic runtime).
 *   - No `@testing-library/jest-dom` import (registered via `setupFilesAfterEnv`;
 *     its matchers `toBeInTheDocument` / `toHaveClass` are globally available).
 *   - No `describe` / `it` / `expect` import (Jest globals).
 *   - Never imports `immutable`, `dragula`, `dom-autoscroller`, `checksley`,
 *     `jquery`, `angular`, `@playwright/test`, or any `app/coffee/**` module.
 */

import { render, screen } from '@testing-library/react';

import { computeWipLimit, WipLimit } from '../components/WipLimit';
import { makeStatus } from './factories';

/*
 * Boundary vectors for a column configured with `wip_limit = 3`. The card count
 * walks from empty (0) to over the limit (5) so every branch of the decision
 * function is exercised at its exact edge.
 */
describe('computeWipLimit — boundaries with wip_limit = 3', () => {
    const status = makeStatus({ wip_limit: 3, is_archived: false });

    it('returns null for an empty column (count 0, well under the limit)', () => {
        expect(computeWipLimit(status, 0)).toBeNull();
    });

    it('returns null one card before the "one-left" edge (count 1)', () => {
        // 1 + 1 !== 3 and 1 < 3 -> still under the limit, so no marker yet.
        expect(computeWipLimit(status, 1)).toBeNull();
    });

    it('flags "one-left" when exactly one card away from the limit (count 2)', () => {
        // 2 + 1 === 3 -> marker after the last card (index cardCount - 1 = 1).
        expect(computeWipLimit(status, 2)).toEqual({ className: 'one-left', afterIndex: 1 });
    });

    it('flags "reached" when the count equals the limit (count 3)', () => {
        // 3 === 3 -> marker after the last card (index cardCount - 1 = 2).
        expect(computeWipLimit(status, 3)).toEqual({ className: 'reached', afterIndex: 2 });
    });

    it('flags "exceeded" when one card over the limit (count 4)', () => {
        // 4 > 3 -> marker sits on the limit boundary (index wip_limit - 1 = 2).
        expect(computeWipLimit(status, 4)).toEqual({ className: 'exceeded', afterIndex: 2 });
    });

    it('keeps "exceeded" with a stable afterIndex further over the limit (count 5)', () => {
        // 5 > 3 -> still pinned to the boundary card (index wip_limit - 1 = 2).
        expect(computeWipLimit(status, 5)).toEqual({ className: 'exceeded', afterIndex: 2 });
    });
});

/*
 * Disabled cases: the marker is suppressed entirely when the column is archived
 * or has no positive WIP limit, regardless of how many cards it holds.
 */
describe('computeWipLimit — disabled cases → null', () => {
    it('never marks an archived column, even when over the limit', () => {
        const status = makeStatus({ wip_limit: 3, is_archived: true });
        expect(computeWipLimit(status, 5)).toBeNull();
    });

    it('never marks a column whose wip_limit is null (no limit configured)', () => {
        const status = makeStatus({ wip_limit: null });
        expect(computeWipLimit(status, 5)).toBeNull();
    });

    it('never marks a column whose wip_limit is 0 (falsy → disabled)', () => {
        const status = makeStatus({ wip_limit: 0 });
        expect(computeWipLimit(status, 5)).toBeNull();
    });
});

/*
 * Render tests: the marker must reproduce the legacy DOM — a `div.kanban-wip-limit`
 * carrying the WIP state class, wrapping a `span` with the literal (untranslated)
 * text "WIP Limit". The root has no ARIA role, so it is queried by its class.
 */
describe('WipLimit render', () => {
    it('renders the "reached" marker with the base class and literal "WIP Limit" text', () => {
        const { container } = render(<WipLimit className="reached" />);

        const marker = container.querySelector('.kanban-wip-limit');
        expect(marker).toBeInTheDocument();
        expect(marker).toHaveClass('reached');
        expect(screen.getByText(/WIP Limit/i)).toBeInTheDocument();
    });

    it('renders the "exceeded" marker with the exceeded state class', () => {
        const { container } = render(<WipLimit className="exceeded" />);

        const marker = container.querySelector('.kanban-wip-limit');
        expect(marker).toBeInTheDocument();
        expect(marker).toHaveClass('exceeded');
    });

    it('renders the "one-left" marker with the one-left state class', () => {
        const { container } = render(<WipLimit className="one-left" />);

        const marker = container.querySelector('.kanban-wip-limit');
        expect(marker).toBeInTheDocument();
        expect(marker).toHaveClass('one-left');
    });
});
