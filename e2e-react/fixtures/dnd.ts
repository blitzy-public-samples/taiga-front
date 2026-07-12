/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { Page, Locator } from "@playwright/test";

/**
 * Options for {@link dragAndDrop}.
 *
 * @property targetOffset - Pixel offset added to the *center* of the target
 *   element when computing the final drop coordinates. Useful when the drop
 *   must land inside a specific region of the destination (e.g. the Kanban
 *   column body below its header) rather than exactly on its geometric center.
 */
export interface DragOptions {
  targetOffset?: { x: number; y: number };
  /**
   * Fractional drop position WITHIN the target's bounding box, measured from
   * its top-left corner (`x` and `y` each in the range [0, 1]). When provided,
   * it OVERRIDES the default "center + {@link DragOptions.targetOffset}"
   * computation.
   *
   * Use this to drop into a specific region of a variable-height target. The
   * key case is a list reorder that must insert the dragged row BEFORE the
   * first row (index 0): the reliable "insert-before" zone is the top slice of
   * the destination row, and a fixed pixel offset from the row's center is
   * fragile because backlog rows vary in height (a 56px plain row vs a 102px
   * row carrying tags/description). Expressing the drop as a fraction of the
   * row's height — e.g. `{ x: 0.5, y: 0.1 }` for "horizontally centered, near
   * the top" — lands in that zone independent of the row's height and works on
   * both parity builds (dragula on `baseline`, `@dnd-kit` on `react`).
   */
  targetPosition?: { x: number; y: number };
}

/**
 * Perform a drag-and-drop gesture from `source` onto `target` using REAL
 * Playwright pointer input.
 *
 * Dual-build compatibility (AAP §0.6.3)
 * -------------------------------------
 * This single helper must drive drag-and-drop on BOTH parity builds without
 * branching on which one is active:
 *
 *   - `baseline` (stock AngularJS) drives sorting with **dragula +
 *     dom-autoscroller**, which listen for the classic `mouse*` event stream
 *     (`mousedown` / `mousemove` / `mouseup`).
 *   - `react` (migrated) drives sorting with **`@dnd-kit/core`'s
 *     `PointerSensor`**, which listens for the `pointer*` event stream and only
 *     *starts* a drag once the pointer has travelled a small activation
 *     distance from the press origin.
 *
 * Because `page.mouse.*` produces trusted browser input, each call dispatches
 * BOTH the `mouse*` and `pointer*` event families simultaneously. That is the
 * core reason the identical implementation can satisfy dragula and `@dnd-kit`
 * at once. Synthetic `CustomEvent` dispatch (the approach used by the legacy
 * Protractor `e2e/utils/common.js#drag`) is deliberately avoided: it would not
 * trip `@dnd-kit`'s `PointerSensor` and would therefore never start a React
 * drag.
 *
 * Gesture shape
 * -------------
 * 0. The drop TARGET is first scrolled to the vertical center of the viewport
 *    (native `scrollIntoView({ block: "center" })`). This keeps a target that
 *    sits near the top of a scroll container from being occluded by sticky
 *    chrome (e.g. the Backlog's sticky `.backlog-menu`); an occluded target's
 *    upper half is unreachable by the pointer, which would make an
 *    "insert before the first row" drop land one slot too low. Both bounding
 *    boxes are captured only after this and the source scroll have settled so
 *    that neither is stale.
 * 1. A small "activation nudge" (`+6,+6` over 6 steps) moves the pointer far
 *    enough to exceed `@dnd-kit`'s default `PointerSensor` activation distance
 *    and to begin a dragula/dom-autoscroller `mousemove` sequence.
 * 2. A multi-step glide to the drop point is issued TWICE: the first pass lets
 *    dom-autoscroller / `@dnd-kit` register continuous movement (and trigger
 *    any autoscroll), and the second guarantees the pointer has settled over
 *    the droppable at the final coordinates before release.
 *
 * The helper performs pointer input only and returns immediately after
 * releasing; callers assert that the drop settled using their own web-first
 * expectations (e.g. `expect(locator).toHaveCount(...)`).
 *
 * @param page   - The Playwright {@link Page} whose mouse input is driven.
 * @param source - {@link Locator} for the element to pick up.
 * @param target - {@link Locator} for the drop destination.
 * @param opts   - Optional {@link DragOptions}; `targetOffset` shifts the drop
 *                 coordinates relative to the target's center.
 * @throws If either the source or the target element has no bounding box
 *         (typically because it is not visible / not laid out).
 */
export async function dragAndDrop(
  page: Page,
  source: Locator,
  target: Locator,
  opts?: DragOptions
): Promise<void> {
  // Bring the DROP TARGET fully into view FIRST, centered vertically. A target
  // near the top of a scroll container can otherwise be left occluded beneath a
  // sticky header/toolbar (e.g. the Backlog's sticky `.backlog-menu`). When the
  // target's upper half is covered by such sticky chrome, the pointer can never
  // reach it, so an "insert before the first row" drop is impossible and the
  // drop lands exactly one slot too low (index 1 instead of index 0). Centering
  // the target with the native `scrollIntoView({ block: "center" })` clears any
  // sticky header. This is framework-agnostic and benefits BOTH parity builds
  // equally (dragula + dom-autoscroller on `baseline`, `@dnd-kit` on `react`).
  await target.evaluate((el) =>
    (el as HTMLElement).scrollIntoView({ block: "center", inline: "nearest" })
  );
  // Then ensure the SOURCE is visible. Capturing BOTH bounding boxes only AFTER
  // all scrolling has settled guarantees that neither box is stale (a later
  // scroll would otherwise invalidate an earlier capture).
  await source.scrollIntoViewIfNeeded();

  const sb = await source.boundingBox();
  if (!sb) {
    throw new Error("dragAndDrop: source element has no bounding box (not visible?)");
  }

  const tb = await target.boundingBox();
  if (!tb) {
    throw new Error("dragAndDrop: target element has no bounding box (not visible?)");
  }

  const offsetX = opts?.targetOffset?.x ?? 0;
  const offsetY = opts?.targetOffset?.y ?? 0;

  const sx = sb.x + sb.width / 2;
  const sy = sb.y + sb.height / 2;
  // Default drop point is the target's center (optionally nudged by
  // `targetOffset`). When `targetPosition` is supplied it takes precedence and
  // the drop lands at that fractional position within the target box — used to
  // hit a row's top slice for a deterministic "insert before" (index 0) drop
  // regardless of the row's height (see DragOptions.targetPosition).
  const tx = opts?.targetPosition
    ? tb.x + tb.width * opts.targetPosition.x
    : tb.x + tb.width / 2 + offsetX;
  const ty = opts?.targetPosition
    ? tb.y + tb.height * opts.targetPosition.y
    : tb.y + tb.height / 2 + offsetY;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // 1) Small nudge to exceed @dnd-kit PointerSensor activation distance and to
  //    begin a dragula/dom-autoscroller mousemove sequence.
  await page.mouse.move(sx + 6, sy + 6, { steps: 6 });
  // 2) Multi-step glide to the drop point (twice) so dom-autoscroller/@dnd-kit
  //    register continuous movement and the pointer settles over the droppable.
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.mouse.up();
}

/**
 * Perform a drag-and-drop gesture from `source` onto `target` by dispatching
 * SYNTHETIC mouse events inside the page — a faithful TypeScript port of the
 * legacy Protractor helper `e2e/utils/common.js#drag`.
 *
 * Why a second, synthetic-event drag helper exists
 * ------------------------------------------------
 * The primary {@link dragAndDrop} helper drives REAL Playwright pointer input,
 * which is what trips `@dnd-kit`'s `PointerSensor` on the migrated `react`
 * build. Real pointer input, however, cannot span a drop whose source and
 * target are farther apart than the viewport is tall: the pointer must
 * physically travel from one to the other, and Playwright can only move it over
 * on-screen pixels. The Backlog "closed sprints" flow is exactly that case — a
 * story created at the BOTTOM of a long, fully-loaded backlog must be dropped
 * onto a sprint drop-zone in the tall, `position: static` sidebar, and after
 * `loadFullBacklog` scrolls to the last row those two elements are ~3000px
 * apart in a 720px viewport. No real-pointer gesture can hold both on screen at
 * once, and dom-autoscroller does NOT engage for a programmatic pointer parked
 * at the viewport edge (empirically verified), so {@link dragAndDrop} silently
 * fails to drop there.
 *
 * The stock AngularJS build's own Protractor suite solved this by NOT using a
 * real pointer: `common.drag` dispatched a synthetic `mousedown` on the drag
 * handle, then `mousemove`/`mouseup` on `document.documentElement` at the
 * TARGET's page-absolute coordinates, calling `element.scrollIntoView()` on the
 * destination between the moves. Because the drop coordinates are computed
 * arithmetically (not walked to) and the destination is scrolled into view on
 * demand, the gesture never needs the source and target co-visible. dragula
 * (which drives sorting on the `baseline` build) listens for this classic
 * `mouse*` stream, so the synthetic sequence drives it faithfully — the drop
 * settles exactly as the legacy suite relied upon.
 *
 * Scope of use (minimal blast radius)
 * -----------------------------------
 * This helper backs EXACTLY the two viewport-spanning closed-sprints drags in
 * `backlog.spec.ts`; every other drag continues to use the real-input
 * {@link dragAndDrop}. It is therefore only ever exercised on the `baseline`
 * (dragula) build in practice and is intentionally NOT relied upon to start an
 * `@dnd-kit` drag on the `react` build (synthetic `CustomEvent`s do not trip
 * the `PointerSensor`) — matching the legacy Protractor suite's own
 * baseline-only reliance on this technique.
 *
 * The `client` coordinates are derived as `page - scroll` AFTER the destination
 * has been scrolled into view (`window.pageXOffset`/`pageYOffset`), reproducing
 * the legacy `triggerMouseEvent`'s coordinate math without any jQuery
 * dependency (the original used `$(dest).offset()`; this uses
 * `getBoundingClientRect()` + the window scroll offsets, which is equivalent).
 *
 * @param page   - The Playwright {@link Page} in which to dispatch the events.
 * @param source - {@link Locator} for the drag handle to pick up.
 * @param target - {@link Locator} for the drop destination.
 * @param extraX - Pixels added to the target's left edge for the drop point
 *                 (default `5`, matching the legacy helper's small inset).
 * @param extraY - Pixels added to the target's top edge for the drop point
 *                 (default `5`).
 * @throws If either the source or the target element cannot be resolved to a
 *         live DOM handle (typically because it is not attached / not laid out).
 */
export async function dragViaEvents(
  page: Page,
  source: Locator,
  target: Locator,
  extraX = 5,
  extraY = 5
): Promise<void> {
  const sourceHandle = await source.elementHandle();
  if (!sourceHandle) {
    throw new Error("dragViaEvents: source element has no DOM handle (not attached?)");
  }
  const targetHandle = await target.elementHandle();
  if (!targetHandle) {
    throw new Error("dragViaEvents: target element has no DOM handle (not attached?)");
  }

  await page.evaluate(
    ({ drag, dest, ex, ey }) => {
      // A node is "in view" when its whole box lies within the viewport — the
      // legacy `isScrolledIntoView` guard.
      const isScrolledIntoView = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      };

      // Dispatch a bubbling/cancelable mouse-like CustomEvent. When `coords`
      // are supplied, the destination is scrolled into view first and the event
      // is given page- and client-space coordinates (client = page - scroll),
      // faithfully reproducing the legacy `triggerMouseEvent`.
      const fire = (
        node: Element,
        type: string,
        coords?: { x: number; y: number }
      ): void => {
        const event = new CustomEvent(type, { bubbles: true, cancelable: true });
        if (coords) {
          dest.scrollIntoView();
          (event as unknown as MouseEvent & { pageX: number; pageY: number }).pageX = coords.x;
          (event as unknown as MouseEvent & { pageX: number; pageY: number }).pageY = coords.y;
          (event as { clientX: number }).clientX = coords.x;
          (event as { clientY: number }).clientY = coords.y - window.pageYOffset;
        }
        (event as { which: number }).which = 1;
        node.dispatchEvent(event);
      };

      if (!isScrolledIntoView(drag)) {
        drag.scrollIntoView();
      }
      fire(drag, "mousedown");

      const rect = dest.getBoundingClientRect();
      const coords = {
        x: rect.left + window.pageXOffset + ex,
        y: rect.top + window.pageYOffset + ey,
      };
      // First glide registers movement; scroll the destination into view; the
      // second settles the pointer over it; release completes the drop.
      fire(document.documentElement, "mousemove", coords);
      if (!isScrolledIntoView(dest)) {
        dest.scrollIntoView();
      }
      fire(document.documentElement, "mousemove", coords);
      fire(document.documentElement, "mouseup", coords);
    },
    { drag: sourceHandle, dest: targetHandle, ex: extraX, ey: extraY }
  );

  // Allow dragula's async drop handling + the resulting bulk-order XHR to
  // settle before the caller asserts (mirrors the legacy `common.dragEnd`
  // post-drop settle).
  await page.waitForTimeout(1000);
}
