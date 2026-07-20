/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * WipLimit — React port of the AngularJS `tgKanbanWipLimit` directive.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration. This module
 * reproduces, with byte-for-byte visual parity, the WIP-limit indicator that
 * the legacy `KanbanWipLimitDirective` drew on each Kanban column
 * (app/coffee/modules/kanban/main.coffee, `tgKanbanWipLimit`). That directive
 * is REFERENCE-ONLY: its behaviour and markup are reproduced here, but it is
 * NEVER imported. Nothing from `app/coffee`, `app/partials`, `app/styles`, the
 * compiled `elements` bundle, `angular`, `Immutable`, `dragula`, or `jquery` is
 * pulled in — the only import is the sibling `../../shared/api/userstories`
 * adapter, preserving the "coexistence, not rewrite" boundary (AAP 0.7).
 *
 * ---------------------------------------------------------------------------
 * What the legacy directive did (main.coffee `KanbanWipLimitDirective`):
 * ---------------------------------------------------------------------------
 *   - Read the column's `status` object (`status.wip_limit`, `status.is_archived`).
 *   - `redrawWipLimit()` counted the `tg-card` children of the column and, in
 *     THIS exact evaluation order, chose an indicator class + a boundary card:
 *       * cards.length + 1 === wip_limit  -> 'one-left', after the LAST card
 *       * cards.length     === wip_limit  -> 'reached',  after the LAST card
 *       * cards.length      >  wip_limit  -> 'exceeded', after the card at
 *                                            index (wip_limit - 1)
 *       * otherwise                       -> no indicator
 *   - Removed any existing `.kanban-wip-limit`, then inserted
 *     `<div class='kanban-wip-limit {class}'><span>WIP Limit</span></div>`
 *     immediately AFTER the chosen boundary card.
 *   - Only wired its recompute listeners when `status and not status.is_archived`
 *     (archived columns never show a WIP indicator).
 *
 * ---------------------------------------------------------------------------
 * The React split: placement (Column) vs. rendering (WipLimit)
 * ---------------------------------------------------------------------------
 * The AngularJS directive imperatively inserted a DOM node after a specific
 * card. React expresses the same thing declaratively, so the responsibility is
 * split in two:
 *
 *   1. `computeWipLimit(...)` — a PURE, side-effect-free helper that mirrors
 *      `redrawWipLimit`'s decision logic. It returns WHICH indicator state to
 *      show and the array index of the card the indicator sits AFTER (or `null`
 *      for "no indicator"). It touches no DOM, no timers, and no `$timeout`
 *      (the directive's `$timeout(..., 0, false)` was only a digest-deferral
 *      detail, irrelevant to React's render model).
 *
 *   2. `WipLimit` — a display-only component that renders exactly
 *      `<div class="kanban-wip-limit {state}"><span>WIP Limit</span></div>`.
 *
 * `Column.tsx` owns placement: it calls `computeWipLimit` with its current card
 * count and, when a placement is returned, renders `<WipLimit>` immediately
 * after the card at `boundaryIndex`. Because Column only renders `<WipLimit>`
 * for a card that actually exists at `boundaryIndex`, the degenerate legacy
 * case (`wip_limit === 1`, zero cards -> `cards[-1]` was `undefined`, so the
 * directive inserted nothing) is preserved naturally: `computeWipLimit` reports
 * `boundaryIndex === -1`, no rendered card has index `-1`, and nothing is drawn.
 *
 * Visual parity: the rendered class (`kanban-wip-limit`) and the three state
 * modifiers (`one-left` / `reached` / `exceeded`) and the literal `WIP Limit`
 * label match the legacy string EXACTLY, so the existing compiled kanban SCSS
 * styles this component with zero changes and no new stylesheet is introduced.
 * The label is hardcoded (not translated) because the source hardcodes it.
 *
 * JSX runtime: this file relies on the automatic JSX runtime
 * (`tsconfig.json` -> `"jsx": "react-jsx"`), so React itself is not imported;
 * this component uses no hooks, so nothing is imported from `react` at all.
 */

// The sole import: the sibling user-story API adapter. `editStatus` PATCHes a
// user-story status's `wip_limit` against the frozen `/api/v1/` contract; it is
// re-exported here (see `editWipLimit`) so the Kanban column header's
// WIP-limit editor can persist a change without hand-building a new endpoint.
import { editStatus } from '../../shared/api/userstories';

// ---------------------------------------------------------------------------
// WIP-limit computation (pure helper)
// ---------------------------------------------------------------------------

/**
 * The three visual states the legacy directive could apply to the indicator.
 * These map 1:1 onto the CSS modifier classes appended after `kanban-wip-limit`.
 */
export type WipLimitState = 'one-left' | 'reached' | 'exceeded';

/**
 * The result of {@link computeWipLimit}: which indicator to show and the array
 * index of the card the indicator is rendered immediately AFTER.
 *
 * `boundaryIndex` is expressed in terms of the column's rendered card list so
 * that `Column.tsx` can place `<WipLimit>` right after `cards[boundaryIndex]`.
 * For `one-left` / `reached` it is the last card (`cardCount - 1`); for
 * `exceeded` it is the card at `wipLimit - 1` (matching the directive's
 * `cards[status.wip_limit - 1]`).
 */
export interface WipLimitPlacement {
  /** Which indicator state to render (drives the CSS modifier class). */
  state: WipLimitState;
  /**
   * Array index of the card the indicator sits AFTER. May be `-1` in the
   * degenerate `one-left` case (`wipLimit === 1`, `cardCount === 0`); callers
   * render the indicator only when a real card exists at this index, exactly
   * reproducing the legacy `if element` guard.
   */
  boundaryIndex: number;
}

/**
 * Reproduces `KanbanWipLimitDirective.redrawWipLimit`'s decision logic as a
 * pure function.
 *
 * The source's evaluation ORDER is preserved precisely — `one-left` is checked
 * before `reached`, which is checked before `exceeded` — because the branches
 * are not mutually exclusive on their face and the first match wins. The
 * archived / no-limit guard runs first, mirroring the directive's
 * `status and not status.is_archived` gate together with the implicit
 * truthiness of `status.wip_limit`.
 *
 * This helper has NO side effects (no DOM, network, timers, or logging) so it
 * is trivially unit-testable and contributes to the >=70% React coverage gate;
 * the kanban `__tests__` exercise it directly.
 *
 * @param cardCount  - Number of `tg-card` elements currently rendered in the
 *                     column (the React equivalent of `$el.find("tg-card")`).
 * @param wipLimit   - `status.wip_limit`. `null`/`undefined`/`0` all mean
 *                     "no limit" and yield `null`.
 * @param isArchived - `status.is_archived`. Archived columns never show a WIP
 *                     indicator.
 * @returns A {@link WipLimitPlacement} (state + boundary card index) or `null`
 *          when no indicator should be shown.
 */
export function computeWipLimit(
  cardCount: number,
  wipLimit: number | null | undefined,
  isArchived: boolean,
): WipLimitPlacement | null {
  // Guard first (matches the directive's `status and not status.is_archived`
  // listener gate plus the implicit `status.wip_limit` truthiness): archived
  // columns and columns with no (falsy) limit never render an indicator.
  if (isArchived || !wipLimit) {
    return null;
  }

  // one-left: exactly one card short of the limit -> after the LAST card
  // (`cards[cards.length - 1]`).
  if (cardCount + 1 === wipLimit) {
    return { state: 'one-left', boundaryIndex: cardCount - 1 };
  }

  // reached: card count equals the limit -> after the LAST card
  // (`cards[cards.length - 1]`).
  if (cardCount === wipLimit) {
    return { state: 'reached', boundaryIndex: cardCount - 1 };
  }

  // exceeded: over the limit -> after the card AT index `wipLimit - 1`
  // (`cards[status.wip_limit - 1]`).
  if (cardCount > wipLimit) {
    return { state: 'exceeded', boundaryIndex: wipLimit - 1 };
  }

  // Below the limit and not one-left -> no indicator (the directive's implicit
  // else branch left `element` null).
  return null;
}

// ---------------------------------------------------------------------------
// WIP-limit indicator (display-only component)
// ---------------------------------------------------------------------------

/**
 * Props for {@link WipLimit}. The component is intentionally minimal: it renders
 * one of the three indicator states and nothing else, exactly like the `<div>`
 * the legacy directive injected.
 */
export interface WipLimitProps {
  /** The indicator state, resolved by {@link computeWipLimit}. */
  state: WipLimitState;
}

/**
 * The WIP-limit indicator, rendered by `Column.tsx` immediately after the
 * boundary card that {@link computeWipLimit} identifies.
 *
 * Renders EXACTLY `<div class="kanban-wip-limit {state}"><span>WIP Limit</span></div>`
 * — identical markup, class names, and label to the string the AngularJS
 * directive inserted (`main.coffee`), guaranteeing zero visual change under the
 * existing compiled kanban SCSS. The `WIP Limit` text is a literal, matching the
 * hardcoded source string (it is intentionally NOT run through translation).
 */
const WipLimit = ({ state }: WipLimitProps) => (
  <div className={`kanban-wip-limit ${state}`}>
    <span>WIP Limit</span>
  </div>
);

export default WipLimit;

// ---------------------------------------------------------------------------
// WIP-limit persistence wrapper
// ---------------------------------------------------------------------------

// NOTE: The migration deliberately SPLITS the always-on visual indicator (the
// display-only `WipLimit` component above, which mirrors the legacy directive's
// injected `<div>` and adds no new UI) from the ACT of persisting a WIP-limit
// change. `WipLimit` stays purely presentational — exactly like the AngularJS
// directive, which only drew the indicator and never edited the limit. The
// separate write path is exposed here as a thin, typed wrapper so a column
// header's WIP-limit editor (owned elsewhere) can save an edit without this
// component gaining state or side effects. The wrapper reuses the EXISTING
// `editStatus` adapter (userstory-statuses PATCH) — no new endpoint is added,
// keeping the `/api/v1/` contract frozen (AAP goal 2).

/**
 * Persist a status's WIP-limit change.
 *
 * Delegates to the shared {@link editStatus} adapter, which PATCHes
 * `userstory-statuses/{statusId}` with `{ wip_limit }` over the frozen
 * `/api/v1/` contract (reproducing the AngularJS user-story-statuses edit path).
 *
 * @param statusId - Id of the user-story status whose limit is changing.
 * @param wipLimit - The new WIP limit, or `null` to clear it.
 * @returns A promise that resolves once the PATCH completes.
 */
export function editWipLimit(statusId: number, wipLimit: number | null): Promise<unknown> {
  return editStatus(statusId, wipLimit);
}
