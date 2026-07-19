/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BurndownChart.test.tsx — Jest (jsdom) render spec for the Backlog
 * `BurndownChart` presentational component
 * (`app/react/backlog/components/BurndownChart.tsx`).
 *
 * WHAT IS UNDER TEST
 *   `BurndownChart` is the dependency-free inline-SVG port of the deleted
 *   AngularJS `tgBurndownBacklogGraph` directive (jQuery Flot). It receives the
 *   `stats.milestones` slice via props and plots five series (a zero baseline
 *   plus optimal / evolution / client-increment / team-increment) over the
 *   milestone index. It is pure/presentational — no network, WebSocket, timer,
 *   or state — so no `jest.mock` and no provider wrapper are needed.
 *
 * These specs assert the ACTUAL contract of the authored component:
 *   - a null / empty `milestones` renders nothing (the `if $scope.stats?`
 *     guard parity);
 *   - a populated series renders an `<svg class="burndown-graph">` whose
 *     optimal series has exactly one marker per milestone;
 *   - the evolution series is COMPACTED to non-null values (matching the
 *     directive's `_.filter(..., e?)` + `_.zip` truncation);
 *   - per-point `<title>` tooltips carry the legacy Flot tooltip text;
 *   - both axis labels ("Sprints" / "Points") render.
 *
 * CONVENTIONS (per this `__tests__` folder): jsdom env is central to
 * `jest.config.js`; no `import React` (automatic `jsx: "react-jsx"` runtime);
 * `describe`/`it`/`expect` are Jest globals; `@testing-library/jest-dom`
 * matchers are registered globally; RTL v14 auto-cleanup unmounts between tests.
 */

import { render } from '@testing-library/react';

import { BurndownChart } from '../components/BurndownChart';
import type { BurndownMilestoneStat } from '../state/backlogReducer';

/**
 * Build a milestone-stat row with realistic defaults; callers override only the
 * fields a given spec exercises. Mirrors the seed shape returned by
 * `GET /projects/{id}/stats` → `milestones[]`.
 */
function makeMilestoneStat(
  overrides: Partial<BurndownMilestoneStat> = {},
): BurndownMilestoneStat {
  return {
    name: 'Sprint 1',
    optimal: 100,
    evolution: 100,
    'team-increment': 0,
    'client-increment': 0,
    ...overrides,
  };
}

describe('BurndownChart', () => {
  describe('empty / guard states', () => {
    it('renders nothing when milestones is null', () => {
      const { container } = render(<BurndownChart milestones={null} />);
      expect(container.querySelector('svg')).toBeNull();
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when milestones is undefined', () => {
      const { container } = render(<BurndownChart milestones={undefined} />);
      expect(container.querySelector('svg')).toBeNull();
    });

    it('renders nothing for an empty milestones array', () => {
      const { container } = render(<BurndownChart milestones={[]} />);
      expect(container.querySelector('svg')).toBeNull();
    });
  });

  describe('populated chart', () => {
    const milestones: BurndownMilestoneStat[] = [
      makeMilestoneStat({ name: 'Sprint A', optimal: 392, evolution: 392 }),
      makeMilestoneStat({ name: 'Sprint B', optimal: 326.6, evolution: 371 }),
      makeMilestoneStat({ name: 'Sprint C', optimal: 261.3, evolution: null }),
      makeMilestoneStat({ name: 'Sprint D', optimal: 196, evolution: null }),
    ];

    it('renders an <svg class="burndown-graph"> with role="img"', () => {
      const { container } = render(<BurndownChart milestones={milestones} />);
      const svg = container.querySelector('svg.burndown-graph');
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute('role', 'img');
      expect(svg).toHaveAttribute('viewBox', '0 0 720 120');
    });

    it('plots the optimal series with exactly one marker per milestone', () => {
      const { container } = render(<BurndownChart milestones={milestones} />);
      const optimal = container.querySelector('.burndown-series-optimal');
      expect(optimal).not.toBeNull();
      // One <circle> marker per milestone (4).
      expect(optimal?.querySelectorAll('circle')).toHaveLength(4);
      // A connecting polyline is drawn for 2+ points.
      expect(optimal?.querySelector('polyline')).not.toBeNull();
      // And a filled area path down to the baseline.
      expect(optimal?.querySelector('path')).not.toBeNull();
    });

    it('COMPACTS the evolution series to non-null values only (2 of 4 here)', () => {
      const { container } = render(<BurndownChart milestones={milestones} />);
      const evolution = container.querySelector('.burndown-series-evolution');
      expect(evolution).not.toBeNull();
      // Only Sprint A + Sprint B have a non-null evolution → 2 markers.
      expect(evolution?.querySelectorAll('circle')).toHaveLength(2);
    });

    it('renders the client + team increment series', () => {
      const { container } = render(<BurndownChart milestones={milestones} />);
      expect(container.querySelector('.burndown-series-client')).not.toBeNull();
      expect(container.querySelector('.burndown-series-team')).not.toBeNull();
    });

    it('carries the legacy Flot tooltip text in per-point <title> elements', () => {
      const { container } = render(<BurndownChart milestones={milestones} />);
      const titles = Array.from(container.querySelectorAll('title')).map(
        (t) => t.textContent ?? '',
      );
      // Optimal tooltip for Sprint A.
      expect(
        titles.some((t) => /Optimal pending points for sprint "Sprint A" should be 392/.test(t)),
      ).toBe(true);
      // Real (evolution) tooltip for Sprint B.
      expect(
        titles.some((t) => /Real pending points for sprint "Sprint B" is 371/.test(t)),
      ).toBe(true);
    });

    it('renders both axis labels', () => {
      const { getByText } = render(<BurndownChart milestones={milestones} />);
      expect(getByText('Sprints')).toBeInTheDocument();
      expect(getByText('Points')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('renders a single-milestone chart without a connecting polyline', () => {
      const { container } = render(
        <BurndownChart milestones={[makeMilestoneStat({ name: 'Only', optimal: 50, evolution: 50 })]} />,
      );
      const svg = container.querySelector('svg.burndown-graph');
      expect(svg).not.toBeNull();
      const optimal = container.querySelector('.burndown-series-optimal');
      // One marker, but no polyline (needs 2+ points).
      expect(optimal?.querySelectorAll('circle')).toHaveLength(1);
      expect(optimal?.querySelector('polyline')).toBeNull();
    });

    it('reports increment magnitudes (abs) in the tooltip for negative series', () => {
      const { container } = render(
        <BurndownChart
          milestones={[
            makeMilestoneStat({
              name: 'Sprint X',
              optimal: 10,
              evolution: 10,
              'team-increment': 5,
              'client-increment': 3,
            }),
          ]}
        />,
      );
      const titles = Array.from(container.querySelectorAll('title')).map(
        (t) => t.textContent ?? '',
      );
      // team-increment plotted as -5 but reported as magnitude 5.
      expect(
        titles.some((t) => /team requirements for sprint "Sprint X" is 5/.test(t)),
      ).toBe(true);
      // client-increment line value = -(5) - (3) = -8 → magnitude 8.
      expect(
        titles.some((t) => /client requirements for sprint "Sprint X" is 8/.test(t)),
      ).toBe(true);
    });

    it('omits the evolution series entirely when every evolution is null (future-only sprints)', () => {
      const { container } = render(
        <BurndownChart
          milestones={[
            makeMilestoneStat({ name: 'Future 1', optimal: 100, evolution: null }),
            makeMilestoneStat({ name: 'Future 2', optimal: 50, evolution: null }),
          ]}
        />,
      );
      // The chart still renders (optimal series present) but the compacted
      // evolution series has zero points, so `renderSeries` returns null and the
      // `.burndown-series-evolution` group is not emitted at all.
      expect(container.querySelector('svg.burndown-graph')).not.toBeNull();
      expect(container.querySelector('.burndown-series-optimal')).not.toBeNull();
      expect(container.querySelector('.burndown-series-evolution')).toBeNull();
    });

    it('does not crash when every value is zero (degenerate range)', () => {
      const { container } = render(
        <BurndownChart
          milestones={[
            makeMilestoneStat({ optimal: 0, evolution: 0 }),
            makeMilestoneStat({ optimal: 0, evolution: 0 }),
          ]}
        />,
      );
      expect(container.querySelector('svg.burndown-graph')).not.toBeNull();
    });
  });
});
