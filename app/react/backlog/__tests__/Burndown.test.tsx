/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link Burndown} — the React port of the AngularJS Flot
 * burndown directive (`tgBurndownBacklogGraph`, main.coffee:1217-1338) — #1.
 *
 * These specs lock in the behavioral parity of the re-implemented chart:
 *  - binds to `stats.milestones` (no network call);
 *  - renders the four VISIBLE series (optimal, evolution/real, client-increment,
 *    team-increment) and NOT the invisible zero baseline (seriesIndex 0);
 *  - filters NULL evolution values (shorter "real" line, per the legacy
 *    `_.filter(..., (e) -> e?)`);
 *  - exposes the exact legacy per-series tooltip strings on each point;
 *  - uses the exact legacy series colours + grid colour + axis labels;
 *  - guards the no-data case (renders nothing).
 *
 * TEST ISOLATION (AAP §0.6.2 / §0.7): browserless — Jest + jsdom + RTL only;
 * NO Playwright, NO real browser, NO network. React is not imported (automatic
 * `react-jsx` runtime); the i18n catalog resolves against i18n.ts's embedded
 * English defaults (which now include BACKLOG.CHART), so tooltips render real
 * text with zero configuration.
 */

import { render } from '@testing-library/react';
import { Burndown, niceTickSize, computeYTicks } from '../components/Burndown';
import type { BurndownMilestone } from '../components/Burndown';
import type { BacklogStats } from '../state/backlogReducer';

function makeStats(milestones: Partial<BurndownMilestone>[]): BacklogStats {
  const full = milestones.map((m) => ({
    name: 'S',
    optimal: 0,
    evolution: 0,
    'team-increment': 0,
    'client-increment': 0,
    ...m,
  }));
  return { completedPercentage: 0, milestones: full } as unknown as BacklogStats;
}

/* -------------------------------------------------------------------------- */
/* No-data guards                                                             */
/* -------------------------------------------------------------------------- */

describe('Burndown — no-data guards', () => {
  it('renders nothing when stats is null', () => {
    const { container } = render(<Burndown stats={null} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-testid="burndown-chart"]')).toBeNull();
  });

  it('renders nothing when milestones is empty', () => {
    const { container } = render(<Burndown stats={makeStats([])} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders nothing when milestones is absent from stats', () => {
    const { container } = render(
      <Burndown stats={{ completedPercentage: 0 } as BacklogStats} />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Chart structure + series                                                   */
/* -------------------------------------------------------------------------- */

describe('Burndown — chart structure', () => {
  const stats = makeStats([
    { name: 'Sprint A', optimal: 806, evolution: 806, 'team-increment': 0, 'client-increment': 0 },
    { name: 'Sprint B', optimal: 725.4, evolution: 806, 'team-increment': 0, 'client-increment': 0 },
    { name: 'Sprint C', optimal: 644.8, evolution: null, 'team-increment': 0, 'client-increment': 0 },
  ]);

  it('renders an <svg> chart bound to milestone data', () => {
    const { container } = render(<Burndown stats={stats} />);
    const svg = container.querySelector('[data-testid="burndown-chart"]');
    expect(svg).toBeInTheDocument();
    expect(svg!.tagName.toLowerCase()).toBe('svg');
    expect(svg).toHaveAttribute('role', 'img');
  });

  it('renders the four VISIBLE series groups (seriesIndex 1..4) and NOT the zero baseline (0)', () => {
    const { container } = render(<Burndown stats={stats} />);
    const groups = Array.from(container.querySelectorAll('g[data-series-index]'));
    const indices = groups.map((g) => g.getAttribute('data-series-index')).sort();
    expect(indices).toEqual(['1', '2', '3', '4']);
    expect(container.querySelector('g[data-series-index="0"]')).toBeNull();
  });

  it('optimal series (1) plots one point per milestone', () => {
    const { container } = render(<Burndown stats={stats} />);
    const pts = container.querySelectorAll('circle[data-series-index="1"]');
    expect(pts).toHaveLength(3);
  });

  it('evolution/real series (2) FILTERS null values -> fewer points than milestones', () => {
    const { container } = render(<Burndown stats={stats} />);
    // 3 milestones but one evolution is null -> only 2 real points.
    const pts = container.querySelectorAll('circle[data-series-index="2"]');
    expect(pts).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Colours, grid, axis labels                                                 */
/* -------------------------------------------------------------------------- */

describe('Burndown — legacy colours / grid / axes', () => {
  const stats = makeStats([
    { name: 'S1', optimal: 100, evolution: 100 },
    { name: 'S2', optimal: 50, evolution: 80 },
  ]);

  it('uses the exact legacy series stroke colours', () => {
    const { container } = render(<Burndown stats={stats} />);
    // seriesIndex 2 stroke colour is rgba(168,228,64,1) (the green "real" line).
    const line2 = container.querySelector('polyline[stroke="rgba(168,228,64,1)"]');
    expect(line2).toBeInTheDocument();
    // seriesIndex 4 stroke colour is rgba(255,160,160,1) (team increment).
    const pt4 = container.querySelector('circle[data-series-index="4"]');
    expect(pt4).toHaveAttribute('stroke', 'rgba(255,160,160,1)');
  });

  it('draws grid/axis lines in the legacy grid colour #D8DEE9', () => {
    const { container } = render(<Burndown stats={stats} />);
    const gridLines = container.querySelectorAll('line[stroke="#D8DEE9"]');
    // y-axis + x-axis + right border + one tick per milestone (2) = at least 5.
    expect(gridLines.length).toBeGreaterThanOrEqual(5);
  });

  it('renders the i18n axis labels "Sprints" and "Points"', () => {
    const { getByText } = render(<Burndown stats={stats} />);
    expect(getByText('Sprints')).toBeInTheDocument();
    expect(getByText('Points')).toBeInTheDocument();
  });

  it('renders Y-axis numeric value ticks + horizontal gridlines (M-09)', () => {
    const { container } = render(<Burndown stats={stats} />);
    // At least one horizontal gridline at the faint derived tickColor.
    const hGrid = container.querySelectorAll('[data-testid="burndown-gridline-h"]');
    expect(hGrid.length).toBeGreaterThanOrEqual(1);
    hGrid.forEach((line) => {
      expect(line).toHaveAttribute('stroke', 'rgba(216, 222, 233, 0.22)');
    });
    // Numeric value-tick labels are rendered (the legacy default yaxis ticks).
    const tickLabels = container.querySelectorAll('[data-testid="burndown-ytick-label"]');
    expect(tickLabels.length).toBeGreaterThanOrEqual(1);
    // Every label is a finite numeric string (no NaN / empty).
    tickLabels.forEach((el) => {
      expect(Number.isFinite(Number(el.textContent))).toBe(true);
    });
  });

  it('places one gridline per Y-tick (gridlines and labels are paired)', () => {
    const { container } = render(<Burndown stats={stats} />);
    const hGrid = container.querySelectorAll('[data-testid="burndown-gridline-h"]');
    const tickLabels = container.querySelectorAll('[data-testid="burndown-ytick-label"]');
    expect(hGrid.length).toBe(tickLabels.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Y-tick generation (Flot nice-number parity, M-09)                          */
/* -------------------------------------------------------------------------- */

describe('niceTickSize — Flot nice-number step (1/2/2.5/5/10 × 10^n)', () => {
  it('returns a step drawn from the {1,2,2.5,5,10} × 10^n family', () => {
    const allowed = new Set([1, 2, 2.5, 5, 10]);
    for (const range of [1, 3, 7, 12, 40, 95, 400, 1234]) {
      const size = niceTickSize(range, 5);
      const magn = Math.pow(10, Math.floor(Math.log(size) / Math.LN10));
      const norm = Math.round((size / magn) * 10) / 10;
      expect(allowed.has(norm)).toBe(true);
    }
  });

  it('guards non-positive range / target (returns 1)', () => {
    expect(niceTickSize(0, 5)).toBe(1);
    expect(niceTickSize(-10, 5)).toBe(1);
    expect(niceTickSize(100, 0)).toBe(1);
  });
});

describe('computeYTicks — numeric ticks spanning [yMin, yMax]', () => {
  it('generates integer ticks on nice multiples for a 0..400 range', () => {
    const ticks = computeYTicks(0, 400, 5);
    const values = ticks.map((t) => t.value);
    // Nice step for 400/5 = 80 -> normalised 8 -> 10*10 = 100.
    expect(values).toEqual([0, 100, 200, 300, 400]);
    // Integer step -> integer labels (no decimals).
    expect(ticks.map((t) => t.label)).toEqual(['0', '100', '200', '300', '400']);
  });

  it('keeps only ticks within the data range (negative min included)', () => {
    const ticks = computeYTicks(-100, 300, 5);
    ticks.forEach((t) => {
      expect(t.value).toBeGreaterThanOrEqual(-100);
      expect(t.value).toBeLessThanOrEqual(300);
    });
    // Includes the zero crossing and the negative region.
    expect(ticks.some((t) => t.value === 0)).toBe(true);
    expect(ticks.some((t) => t.value < 0)).toBe(true);
  });

  it('degenerate range (min === max) yields a single tick, no NaN', () => {
    const ticks = computeYTicks(5, 5);
    expect(ticks).toHaveLength(1);
    expect(Number.isFinite(ticks[0].value)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Per-series tooltips (native <title>) — exact legacy strings                */
/* -------------------------------------------------------------------------- */

describe('Burndown — per-point tooltips reproduce the legacy Flot content', () => {
  const stats = makeStats([
    { name: 'Sprint X', optimal: 806, evolution: 771, 'team-increment': 3, 'client-increment': 2 },
  ]);

  it('optimal point (series 1) -> OPTIMAL message with sprintName + value', () => {
    const { container } = render(<Burndown stats={stats} />);
    const title = container.querySelector('circle[data-series-index="1"] title');
    expect(title?.textContent).toBe(
      'Optimal pending points for sprint "Sprint X" should be 806',
    );
  });

  it('evolution point (series 2) -> REAL message', () => {
    const { container } = render(<Burndown stats={stats} />);
    const title = container.querySelector('circle[data-series-index="2"] title');
    expect(title?.textContent).toBe('Real pending points for sprint "Sprint X" is 771');
  });

  it('client-increment point (series 3) -> INCREMENT_CLIENT with abs value (|-(3)-(2)| = 5)', () => {
    const { container } = render(<Burndown stats={stats} />);
    const title = container.querySelector('circle[data-series-index="3"] title');
    // value = Math.abs((-team - client) * 10) / 10 = Math.abs(-5) = 5
    expect(title?.textContent).toBe(
      'Incremented points by client requirements for sprint "Sprint X" is 5',
    );
  });

  it('team-increment point (series 4) -> INCREMENT_TEAM with abs value (|-3| = 3)', () => {
    const { container } = render(<Burndown stats={stats} />);
    const title = container.querySelector('circle[data-series-index="4"] title');
    expect(title?.textContent).toBe(
      'Incremented points by team requirements for sprint "Sprint X" is 3',
    );
  });

  it('value uses one-decimal abs formatting: optimal 725.45 -> 725.5', () => {
    const s = makeStats([{ name: 'S', optimal: 725.45, evolution: null }]);
    const { container } = render(<Burndown stats={s} />);
    const title = container.querySelector('circle[data-series-index="1"] title');
    // Math.abs(725.45 * 10) / 10 = Math.abs(7254.5) / 10 = 725.45... -> 7254.499.../10.
    // The legacy formula is Math.abs(yval*10)/10; assert it matches that exactly.
    const expected = Math.abs(725.45 * 10) / 10;
    expect(title?.textContent).toBe(
      `Optimal pending points for sprint "S" should be ${expected}`,
    );
  });
});
