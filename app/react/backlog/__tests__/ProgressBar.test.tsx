/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * ProgressBar.test.tsx — Jest (jsdom) render spec for the Backlog
 * `ProgressBar` presentational component
 * (`app/react/backlog/components/ProgressBar.tsx`).
 *
 * WHAT THIS COVERS
 *   `ProgressBar` is the three-sub-bar backlog-summary meter ported from the
 *   deleted AngularJS `TgBacklogProgressBarDirective`
 *   (`app/coffee/modules/backlog/main.coffee`) and its template
 *   `app/partials/backlog/progress-bar.jade`. It is pure/presentational — it
 *   receives a `stats` object via props, computes two inline width percentages,
 *   and renders static DOM reusing the existing SCSS class names
 *   (`.summary-progress-bar`, `.defined-points`, `.project-points-progress`,
 *   `.closed-points-progress`). There is no network, WebSocket, timer, or
 *   drag-and-drop, so no `<DndContext>` wrapper and no `jest.mock` are needed.
 *
 * WHAT IS ASSERTED
 *   1. DOM / class fidelity — the host and the three sub-bars exist with the
 *      exact class names (the visual-fidelity contract with the reused SCSS).
 *   2. Width math — the exact inline width each `stats` vector produces, locked
 *      to the authored formula (verified against the original directive):
 *        totalPoints   = stats.total_points || stats.defined_points || 0
 *        definedPoints = stats.defined_points || 0
 *        closedPoints  = stats.closed_points || 0
 *        if definedPoints > totalPoints:
 *            project = totalPoints * 100 / definedPoints
 *            closed  = closedPoints * 100 / definedPoints
 *        else:
 *            project = 100
 *            closed  = closedPoints * 100 / totalPoints
 *        project = round(clamp(project - 3, 0, 100))
 *        closed  = round(clamp(closed  - 3, 0, 100))
 *      plus the divide-by-zero guard (no `NaN%` / `Infinity%`) and a null-stats
 *      guard (both bars at 0%).
 *
 * TEST-LAYER CONSTRAINTS (this whole `__tests__` folder)
 *   - jsdom environment (from `jest.config.js`); browserless, no network.
 *   - No `import React` — the root tsconfig uses `jsx: "react-jsx"` (automatic
 *     runtime), so JSX needs no React import.
 *   - `describe` / `it` / `expect` are Jest globals (typed via `@types/jest`)
 *     and are deliberately NOT imported.
 *   - `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveStyle`)
 *     are registered globally by `jest.config.js` `setupFilesAfterEnv`, so this
 *     file must NOT import it.
 *   - `@testing-library/react` auto-cleanup (RTL v14) unmounts between tests, so
 *     no manual cleanup is required.
 */

import { render } from '@testing-library/react';

import { ProgressBar } from '../components/ProgressBar';
// Type-only import (required by `isolatedModules`). `ProgressBarStats` is
// declared locally by the component (it is NOT part of `../../shared/types`).
import type { ProgressBarStats } from '../components/ProgressBar';

/**
 * Render the component under test. Typing the parameter with the authored
 * `ProgressBarStats` (widened with `null | undefined`, exactly as the `stats`
 * prop allows) keeps every vector below structurally checked against the real
 * component contract while still passing a fresh literal on each call.
 */
function renderBar(stats: ProgressBarStats | null | undefined) {
  return render(<ProgressBar stats={stats} />);
}

/**
 * Read the resolved inline `width` (e.g. `"97%"`) of the first element matching
 * `selector` inside `container`. Throws (failing the test with a clear message)
 * when the element is absent, which also narrows the type to `HTMLElement`.
 */
function widthOf(container: HTMLElement, selector: string): string {
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`Expected an element matching "${selector}" to be rendered`);
  }
  return el.style.width;
}

describe('ProgressBar', () => {
  describe('DOM structure & class fidelity', () => {
    it('renders the .summary-progress-bar host and the three sub-bars', () => {
      const { container } = renderBar({ total_points: 100, defined_points: 100, closed_points: 50 });

      // These exact class names ARE the visual-fidelity contract (reused SCSS).
      expect(container.querySelector('.summary-progress-bar')).toBeInTheDocument();
      expect(container.querySelector('.defined-points')).toBeInTheDocument();
      expect(container.querySelector('.project-points-progress')).toBeInTheDocument();
      expect(container.querySelector('.closed-points-progress')).toBeInTheDocument();
    });

    it('nests the three sub-bars inside the .summary-progress-bar host', () => {
      const { container } = renderBar({ total_points: 100, defined_points: 100, closed_points: 50 });

      const host = container.querySelector('.summary-progress-bar');
      expect(host).toBeInTheDocument();
      expect(host?.querySelector('.defined-points')).toBeInTheDocument();
      expect(host?.querySelector('.project-points-progress')).toBeInTheDocument();
      expect(host?.querySelector('.closed-points-progress')).toBeInTheDocument();
    });

    it('F-UI-06: the three sub-bar titles come through the i18n bridge', () => {
      const { container } = renderBar({ total_points: 100, defined_points: 100, closed_points: 50 });

      // English fallback in the shell-less unit env — NOT hardcoded literals.
      expect(container.querySelector('.defined-points')).toHaveAttribute(
        'title',
        'Excess of points',
      );
      expect(container.querySelector('.project-points-progress')).toHaveAttribute(
        'title',
        'Pending Points',
      );
      expect(container.querySelector('.closed-points-progress')).toHaveAttribute(
        'title',
        'closed',
      );
    });
  });

  describe('width math', () => {
    // V1 — else branch (definedPoints === totalPoints): project is pinned to
    // 100 then inset by 3 -> 97%; closed = 50 * 100 / 100 = 50 -> 47%.
    it('else branch, defined == total: project 97% / closed 47%', () => {
      const { container } = renderBar({ total_points: 100, defined_points: 100, closed_points: 50 });

      expect(container.querySelector('.project-points-progress')).toHaveStyle({ width: '97%' });
      expect(container.querySelector('.closed-points-progress')).toHaveStyle({ width: '47%' });
    });

    // V2 — else branch (definedPoints < totalPoints): closed = 40 * 100 / 100 = 40 -> 37%.
    // RECONCILE-AGAINST-ACTUAL: the analysis-time recorded target listed project
    // ~= 77% for `{ defined: 80, total: 100 }`, but under the AUTHORED formula
    // defined_points (80) <= total_points (100) engages the `else` branch, which
    // pins project to 100 -> (- 3) -> 97%. We assert the authored output (97%);
    // the 77% path is exercised separately by V3 (defined_points > total_points).
    it('else branch, defined < total: project 97% / closed 37%', () => {
      const { container } = renderBar({ total_points: 100, defined_points: 80, closed_points: 40 });

      expect(container.querySelector('.project-points-progress')).toHaveStyle({ width: '97%' });
      expect(container.querySelector('.closed-points-progress')).toHaveStyle({ width: '37%' });
    });

    // V3 — if branch (definedPoints > totalPoints): project = 80 * 100 / 100 = 80 -> 77%;
    // closed = 40 * 100 / 100 = 40 -> 37%. Locks the `definedPoints > totalPoints`
    // path and reproduces the recorded 77% project width.
    it('if branch, defined > total: project 77% / closed 37%', () => {
      const { container } = renderBar({ total_points: 80, defined_points: 100, closed_points: 40 });

      expect(container.querySelector('.project-points-progress')).toHaveStyle({ width: '77%' });
      expect(container.querySelector('.closed-points-progress')).toHaveStyle({ width: '37%' });
    });

    // V4 — zero-total safety. All points zero: totalPoints = 0 so
    // closed = 0 * 100 / 0 = NaN, which the component's finite-guard coerces to 0.
    // project stays in the else branch at 100 -> 97%. The bar MUST render valid
    // width strings (no `NaN%` / `Infinity%`) — this locks the divide-by-zero guard.
    it('zero-total: renders 97% / 0% with no NaN or Infinity width', () => {
      const { container } = renderBar({ total_points: 0, defined_points: 0, closed_points: 0 });

      const projectWidth = widthOf(container, '.project-points-progress');
      const closedWidth = widthOf(container, '.closed-points-progress');

      expect(projectWidth).toBe('97%');
      expect(closedWidth).toBe('0%');

      // Every emitted width must be a plain, finite percentage string.
      for (const width of [projectWidth, closedWidth]) {
        expect(width).toMatch(/^\d+(\.\d+)?%$/);
        expect(width).not.toBe('NaN%');
        expect(width).not.toBe('Infinity%');
      }
    });

    // V5 — null stats (before data loads): the component short-circuits to 0/0.
    it('null stats: both bars render at 0%', () => {
      const { container } = renderBar(null);

      expect(container.querySelector('.project-points-progress')).toHaveStyle({ width: '0%' });
      expect(container.querySelector('.closed-points-progress')).toHaveStyle({ width: '0%' });
    });

    // Monotonicity — with total/defined held constant, a larger closed_points must
    // not shrink the closed bar. closed = closed_points * 100 / total - 3, so
    // 20 -> 17% and 60 -> 57%. Guards the direction/sign of the formula.
    it('monotonicity: a higher closed_points yields a >= closed-bar width', () => {
      const low = renderBar({ total_points: 100, defined_points: 100, closed_points: 20 });
      const lowWidth = parseFloat(widthOf(low.container, '.closed-points-progress'));

      const high = renderBar({ total_points: 100, defined_points: 100, closed_points: 60 });
      const highWidth = parseFloat(widthOf(high.container, '.closed-points-progress'));

      expect(highWidth).toBeGreaterThanOrEqual(lowWidth);

      // Exact anchors so the math (and its direction) stays locked.
      expect(lowWidth).toBe(17);
      expect(highWidth).toBe(57);
    });
  });

  /* ======================================================================== *
   * F-UI-05 — the meter is an announced `progressbar`.
   *
   * The legacy template announced nothing (the three sub-bars were visual-only
   * with tooltip titles). F-UI-05 requires progress to be announced, so the
   * host now carries `role="progressbar"` with a CLEAN closed-points completion
   * as `aria-valuenow` (no `- 3` visual inset).
   * ======================================================================== */
  describe('F-UI-05 progressbar semantics', () => {
    it('exposes role="progressbar" with the 0–100 bounds and a labelled value', () => {
      const { getByRole } = renderBar({ total_points: 100, defined_points: 100, closed_points: 50 });
      const bar = getByRole('progressbar');

      expect(bar).toHaveClass('summary-progress-bar');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
      // 50 closed of 100 total = 50% (clean, WITHOUT the -3 sub-bar inset).
      expect(bar).toHaveAttribute('aria-valuenow', '50');
      expect(bar).toHaveAttribute('aria-valuetext', '50%');
      expect(bar).toHaveAttribute('aria-label', 'Backlog points progress');
    });

    it('reports 0% when there is no data (null stats)', () => {
      const { getByRole } = renderBar(null);
      const bar = getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '0');
    });

    it('never emits a non-finite value when totals are zero (divide-by-zero guard)', () => {
      const { getByRole } = renderBar({ total_points: 0, defined_points: 0, closed_points: 0 });
      const bar = getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '0');
      expect(bar).toHaveAttribute('aria-valuetext', '0%');
    });
  });
});
