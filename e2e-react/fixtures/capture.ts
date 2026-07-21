/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Two-phase screenshot capture helper for the isolated Playwright e2e layer.
 *
 * This is the Playwright-native port of the legacy Protractor helper
 * `common.takeScreenshot` (taiga-front e2e suite: utils/common.js:128-151) together
 * with `common.waitRequestAnimationFrame` (common.js:335-346). It routes
 * manually-captured PNG evidence into the *committed* artifact tree keyed by
 * capture phase, IDENTICALLY to how the sibling `playwright.config.ts` resolves
 * the phase for its `outputDir`.
 *
 * Two independent capture passes run over the SAME seeded database (AAP §0.6.3):
 *   - baseline: the AngularJS screens, captured FIRST (before removal), with an
 *     unset/default `CAPTURE_PHASE` environment variable.
 *   - react:    the migrated React screens, captured AFTER, with
 *     `CAPTURE_PHASE=react`.
 * The database is never reseeded between the two passes, so identically-named
 * files land in parallel `baseline/` and `react/` subtrees for easy
 * side-by-side composition.
 *
 * Consumed by `../tests/kanban.spec.ts` and `../tests/backlog.spec.ts` and
 * re-exported from `./index.ts`. It has NO intra-folder dependencies.
 *
 * Runtime note: the package has no top-level `"type": "module"`, so Playwright
 * transpiles this module as CommonJS and `__dirname` is available, pointing to
 * this file's directory (`e2e-react/fixtures/`). `__dirname` is therefore used
 * as the stable anchor for resolving the sibling `artifacts/` tree.
 */

import type { Page } from '@playwright/test';
import * as path from 'path';

/**
 * The two mutually-exclusive capture phases of the migration evidence run.
 *
 * `baseline` corresponds to the incumbent AngularJS screens (captured first)
 * and `react` corresponds to the migrated React screens (captured after).
 */
export type CapturePhase = 'baseline' | 'react';

/**
 * Resolve the active capture phase.
 *
 * The expression below is intentionally byte-identical to the phase resolution
 * in `playwright.config.ts`. Any divergence would land baseline captures in the
 * react folder (or vice-versa) — a correctness bug (AAP §0.6.3). An unset or
 * any non-`'react'` value resolves to `baseline`, so the default (and safest)
 * behaviour is the baseline pass over the still-AngularJS application.
 *
 * @returns The resolved capture phase, `'react'` when `CAPTURE_PHASE === 'react'`,
 *          otherwise `'baseline'`.
 */
export function resolveCapturePhase(): CapturePhase {
  return process.env.CAPTURE_PHASE === 'react' ? 'react' : 'baseline';
}

/**
 * Absolute path to the committed `e2e-react/artifacts` root.
 *
 * Anchored on `__dirname` (this file lives in `e2e-react/fixtures/`), so
 * `artifacts/` is resolved as its sibling directory under `e2e-react/`. These
 * `baseline/` and `react/` subtrees are git-tracked — `.gitignore` does not
 * list `e2e-react/` — so the captured evidence is preserved in the repository
 * (AAP §0.6.3).
 *
 * @returns The absolute filesystem path to `e2e-react/artifacts`.
 */
export function artifactsDir(): string {
  return path.resolve(__dirname, '..', 'artifacts');
}

/**
 * Compute the committed screenshot path for a capture.
 *
 * The resulting layout is `artifacts/<phase>/<section>/<name>.png`. This lands
 * deliberately *beside* — not inside — Playwright's per-phase `outputDir`
 * (`artifacts/<phase>/output`) and the HTML report (`artifacts/report`), so the
 * manually-captured evidence never collides with Playwright-managed output.
 *
 * @param section Logical screen/section grouping (e.g. `'kanban'`, `'backlog'`).
 * @param name    Base file name without extension (e.g. `'kanban'`, `'create-us'`).
 * @returns The absolute `.png` path under the resolved phase subtree.
 */
export function screenshotPath(section: string, name: string): string {
  return path.join(artifactsDir(), resolveCapturePhase(), section, `${name}.png`);
}

/**
 * Capture a viewport screenshot into `artifacts/<phase>/<section>/<name>.png`.
 *
 * Ports `common.waitRequestAnimationFrame` + `common.takeScreenshot`: it first
 * awaits a single `requestAnimationFrame` tick inside the page so pending
 * layout/paint work has settled, then writes the PNG to the phase-keyed path
 * computed by {@link screenshotPath}.
 *
 * Notes:
 *  - `page.screenshot({ path })` auto-creates parent directories recursively,
 *    so no manual directory creation (and therefore no `fs` import) is needed,
 *    unlike the legacy helper.
 *  - The default `fullPage: false` reproduces the legacy viewport capture; the
 *    optional `fullPage` flag lets callers request a full-page image.
 *  - Video is NOT captured here — it is configured globally (`video: 'on'`) in
 *    `playwright.config.ts` and lands in `outputDir`. This helper only handles
 *    the manual `page.screenshot()` evidence (AAP §0.6.4).
 *
 * @param page    The Playwright {@link Page} to capture.
 * @param section Logical screen/section grouping (e.g. `'kanban'`, `'backlog'`).
 * @param name    Base file name without extension (e.g. `'kanban'`, `'zoom1'`).
 * @param options Optional capture flags; `fullPage` defaults to `false`.
 * @returns A promise resolving to the absolute path of the written PNG.
 */
export async function screenshot(
  page: Page,
  section: string,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<string> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const target = screenshotPath(section, name);
  await page.screenshot({ path: target, fullPage: options.fullPage ?? false });
  return target;
}
