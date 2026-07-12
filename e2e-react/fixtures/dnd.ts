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
  await source.scrollIntoViewIfNeeded();
  const sb = await source.boundingBox();
  if (!sb) {
    throw new Error("dragAndDrop: source element has no bounding box (not visible?)");
  }

  await target.scrollIntoViewIfNeeded();
  const tb = await target.boundingBox();
  if (!tb) {
    throw new Error("dragAndDrop: target element has no bounding box (not visible?)");
  }

  const offsetX = opts?.targetOffset?.x ?? 0;
  const offsetY = opts?.targetOffset?.y ?? 0;

  const sx = sb.x + sb.width / 2;
  const sy = sb.y + sb.height / 2;
  const tx = tb.x + tb.width / 2 + offsetX;
  const ty = tb.y + tb.height / 2 + offsetY;

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
