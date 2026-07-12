/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Public barrel for the React-parity Playwright fixtures.
 *
 * This is the SINGLE module the two parity specs import from:
 *
 *   import {
 *     test, expect, lightbox, openPopover,
 *     dragAndDrop, fillTags, uploadAttachment, runSharedFilters,
 *   } from "./fixtures";
 *
 * consumed by `../kanban.spec.ts` and `../backlog.spec.ts`. It is the
 * Playwright/TypeScript analogue of the legacy Protractor aggregating barrel
 * `e2e/utils/index.js`.
 *
 * It is a PURE RE-EXPORT barrel — no logic, no declarations, no side effects.
 * It re-exports ONLY the locked public names from the five sibling helper
 * modules plus the EXTENDED `test`/`expect` from `taiga-fixtures.ts`:
 *
 *   - `test`, `expect`       ← `./taiga-fixtures` (the extended test carrying the
 *                              auto-login `taiga` fixture; `expect` is re-exported
 *                              here so specs pull both from this one barrel rather
 *                              than reaching into `@playwright/test` directly)
 *   - `lightbox`             ← `./lightbox`
 *   - `openPopover`          ← `./popover`
 *   - `dragAndDrop`,
 *     `dragViaEvents`        ← `./dnd` (`dragViaEvents` is the synthetic-event
 *                              drag used ONLY for the viewport-spanning
 *                              closed-sprints drags; see its docstring)
 *   - `fillTags`,
 *     `uploadAttachment`     ← `./interactions`
 *   - `runSharedFilters`     ← `./filters`
 *
 * Named re-exports are used deliberately (never `export *`) so private helpers
 * and internal types (e.g. `clearFilters`, `DragOptions`, `TaigaHarness`) are
 * NOT leaked and no name collisions can occur. Sibling specifiers are
 * extension-less, matching how Playwright's TypeScript loader resolves the
 * `.ts` files.
 */

export { test, expect } from "./taiga-fixtures";
export { lightbox } from "./lightbox";
export { openPopover } from "./popover";
export { dragAndDrop, dragViaEvents } from "./dnd";
export { fillTags, uploadAttachment } from "./interactions";
export { runSharedFilters } from "./filters";
