/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * autoScroll.ts — auto-scroll behavior for the React DnD layer.
 *
 * WHAT THIS REPRODUCES
 * --------------------
 * The AngularJS 1.5.10 Kanban and Backlog sortables attach `dom-autoscroller`
 * to the drag interaction so the viewport keeps scrolling while a card/story is
 * dragged toward (or past) a scroll edge. This module reproduces that "feel"
 * using `@dnd-kit`'s BUILT-IN auto-scroll instead of a third-party library — the
 * mapped options are consumed by `DndProvider.tsx`, which passes them to the
 * `autoScroll` prop of `<DndContext>` (selected per screen via `DndMode`).
 *
 * WHY NOT REUSE `dom-autoscroller`
 * --------------------------------
 * `dom-autoscroller` (and `dragula`) are RETAINED npm dependencies — they are
 * still consumed by out-of-scope AngularJS screens (admin, taskboard, wiki), so
 * they MUST NOT be removed from package.json (AAP §0.5.2). The React screens
 * simply do not import them: `@dnd-kit` ships its own auto-scroll, keeping the
 * new React tree free of the legacy DnD stack (AAP §0.7).
 *
 * ANGULARJS SOURCES REPRODUCED
 * ----------------------------
 *   - Kanban  (kanban/sortable.coffee:155-160):
 *       autoScroll(containers, { margin: 100, scrollWhenOutside: true,
 *                                autoScroll: -> this.down && drake.dragging })
 *     where `containers` are the scrollable `.taskboard-column` card columns.
 *   - Backlog (backlog/sortable.coffee:145-151):
 *       autoScroll([window], { margin: 20, pixels: 30, scrollWhenOutside: true,
 *                              autoScroll: -> this.down && drake.dragging })
 *     where the scroll target is the WINDOW (whole-page vertical scroll).
 *
 * COEXISTENCE BOUNDARY (HARD, AAP §0.7)
 * -------------------------------------
 * The only imports are `@dnd-kit/core` (npm) and the sibling `./types`. This
 * module pulls in none of the legacy client's CoffeeScript sources, the modern
 * TypeScript modules, the Jade partials, the SCSS styles, the compiled elements
 * bundle, or the AngularJS framework — the coexistence boundary is globals-only.
 */

import { AutoScrollActivator, type AutoScrollOptions } from '@dnd-kit/core';
import type { AutoScrollConfig, DndMode } from './types';

/* ------------------------------------------------------------------------- *
 * Phase 1 — Original `dom-autoscroller` values (verbatim from the sources)
 * ------------------------------------------------------------------------- *
 * These constants preserve the EXACT numeric options the AngularJS sortables
 * passed to `dom-autoscroller`. They are exported for documentation, parity
 * assertions, and any consumer that needs the raw source-of-truth values rather
 * than the `@dnd-kit`-mapped options defined further below.
 */

/** `dom-autoscroller` options from kanban/sortable.coffee:155-160 (card columns). */
export const KANBAN_AUTOSCROLL_CONFIG: AutoScrollConfig = {
  margin: 100,
  scrollWhenOutside: true,
};

/** `dom-autoscroller` options from backlog/sortable.coffee:145-151 (window scroll). */
export const BACKLOG_AUTOSCROLL_CONFIG: AutoScrollConfig = {
  margin: 20,
  pixels: 30,
  scrollWhenOutside: true,
};

/* ------------------------------------------------------------------------- *
 * Phase 2 — Mapping the raw config onto `@dnd-kit` `AutoScrollOptions`
 * ------------------------------------------------------------------------- *
 * MAPPING RATIONALE (px `margin` -> ratio `threshold`)
 * ----------------------------------------------------
 * `dom-autoscroller` expressed its edge zone as an ABSOLUTE pixel `margin`
 * (begin scrolling within N px of an edge) and its speed as an absolute
 * `pixels`-per-tick step. `@dnd-kit` models the same two concepts differently,
 * so a direct numeric copy is impossible; we map INTENT, not raw numbers:
 *
 *   - `threshold: { x, y }` is a 0-1 RATIO of the scroll container per axis at
 *     which scrolling begins (container-size-RELATIVE, not pixels). Exact px
 *     equivalence is therefore neither possible nor necessary — the goal is
 *     behavioral parity: auto-scroll engages near the scroll edges.
 *   - `acceleration` is the scroll speed (@dnd-kit default 10) — the analogue of
 *     `dom-autoscroller`'s `pixels`-per-tick step.
 *   - `activator: AutoScrollActivator.Pointer` scrolls based on POINTER
 *     position, so scrolling continues while the pointer leaves the element —
 *     the analogue of `scrollWhenOutside: true`. (The `@dnd-kit` default is
 *     `AutoScrollActivator.DraggableRect`, which we deliberately override here.)
 *
 * The chosen ratios preserve the RELATIVE characteristics of the two sources:
 *   - Kanban keeps a LARGER edge zone (orig 100px over the columns)  -> 0.2.
 *   - Backlog keeps a SMALLER vertical edge zone (orig 20px)         -> 0.1,
 *     with NO horizontal scroll (the window scrolls vertically only) -> x: 0.0,
 *     and a FASTER speed (orig `pixels: 30`) -> acceleration 30 > kanban's 10.
 * These ratios may be fine-tuned during the Playwright parity run if the scroll
 * feel differs materially, but the invariants above (kanban edge zone > backlog;
 * backlog acceleration > kanban; both pointer-activated) are preserved.
 */

/**
 * Kanban auto-scroll options: a larger edge zone (orig `margin: 100` over the
 * card columns) with pointer-based activation so scrolling continues when the
 * pointer leaves a column (`scrollWhenOutside: true`).
 * Reproduces kanban/sortable.coffee:155-160.
 */
export const KANBAN_AUTOSCROLL: AutoScrollOptions = {
  enabled: true,
  activator: AutoScrollActivator.Pointer, // ~ scrollWhenOutside: true
  threshold: { x: 0.2, y: 0.2 }, // ~ 100px edge zone (ratio; @dnd-kit is container-relative)
  acceleration: 10, // default speed
};

/**
 * Backlog auto-scroll options: window/page scroll, a smaller edge zone (orig
 * `margin: 20`), a faster speed (orig `pixels: 30` -> higher acceleration), and
 * pointer-based activation.
 * Reproduces backlog/sortable.coffee:145-151.
 */
export const BACKLOG_AUTOSCROLL: AutoScrollOptions = {
  enabled: true,
  activator: AutoScrollActivator.Pointer, // ~ scrollWhenOutside: true
  threshold: { x: 0.0, y: 0.1 }, // vertical page scroll near top/bottom (~20px); no horizontal
  acceleration: 30, // ~ dom-autoscroller pixels: 30 (scroll speed)
};

/* ------------------------------------------------------------------------- *
 * Phase 3 — Selector by screen mode
 * ------------------------------------------------------------------------- */

/**
 * Returns the `@dnd-kit` auto-scroll options for the given screen, ready to pass
 * to `<DndContext>`'s `autoScroll` prop. Pure: it returns the corresponding
 * module-level constant by reference (no allocation, no side effects), so
 * `getAutoScrollOptions('kanban') === KANBAN_AUTOSCROLL` and
 * `getAutoScrollOptions('backlog') === BACKLOG_AUTOSCROLL`.
 *
 * @param mode - the active screen (`'kanban'` or `'backlog'`).
 * @returns the matching `AutoScrollOptions` constant.
 */
export function getAutoScrollOptions(mode: DndMode): AutoScrollOptions {
  return mode === 'kanban' ? KANBAN_AUTOSCROLL : BACKLOG_AUTOSCROLL;
}
