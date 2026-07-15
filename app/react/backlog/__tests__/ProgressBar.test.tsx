/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link ProgressBar} — the React port of the two AngularJS
 * Taiga Backlog progress-bar directives (`tgProgressBar` in
 * components.coffee:433-452 and `tgBacklogProgressBar` in main.coffee:1345-1385).
 *
 * These specs lock in the "zero visual change" contract by asserting the EXACT
 * DOM structure and CSS class names the compiled global SCSS keys off, plus the
 * behavioral-parity math for both variants:
 *
 *  - variant="sprint": round + clamp of `100 * closed / total`, the `.full`
 *    class at 100% (AAP §0.3.3), and the `total`-falsy → 0% degenerate.
 *  - variant="backlog-summary": the `adjustPercentaje` (round∘clamp) pipeline,
 *    the `total_points || defined_points` fallback, the `definedPoints >
 *    totalPoints` branch, the literal `-3` applied BEFORE clamp+round, and the
 *    divide-by-zero guard that keeps a degenerate all-zero project from
 *    emitting `width: NaN%`.
 *
 * TEST ISOLATION (AAP §0.6.2 / §0.7): browserless. Jest + jsdom + React Testing
 * Library ONLY — NO Playwright, NO real browser, NO network, NO `/api/v1/` call.
 *
 * IMPORT WHITELIST (globals-only): imports ONLY '@testing-library/react' and the
 * component under test (with its prop types). React is NOT imported (automatic
 * `react-jsx` runtime); `jest` is a global and the jest-dom matchers are
 * registered globally via jest.config `setupFilesAfterEnv`.
 */

import { render } from '@testing-library/react';
import { ProgressBar } from '../components/ProgressBar';
import type {
  ProgressBarProps,
  SprintProgressBarProps,
  BacklogSummaryProgressBarProps,
} from '../components/ProgressBar';

/* -------------------------------------------------------------------------- */
/* variant="sprint"                                                           */
/* -------------------------------------------------------------------------- */

describe('ProgressBar — variant="sprint"', () => {
  it('renders exactly .sprint-progress-bar > .current-progress', () => {
    const { container } = render(
      <ProgressBar variant="sprint" closedPoints={3} totalPoints={10} />,
    );

    const bar = container.querySelector('.sprint-progress-bar');
    expect(bar).toBeInTheDocument();
    // Single child, the inner fill (Sprint.tsx owns the .summary-progress-wrapper).
    expect(bar!.children).toHaveLength(1);

    const current = bar!.querySelector('.current-progress');
    expect(current).toBeInTheDocument();
    expect(current!.tagName).toBe('DIV');
  });

  it('computes width = round(100 * closed / total): (3,10) -> 30%', () => {
    const { container } = render(
      <ProgressBar variant="sprint" closedPoints={3} totalPoints={10} />,
    );
    const current = container.querySelector('.current-progress') as HTMLElement;
    expect(current).toHaveStyle({ width: '30%' });
    expect(current).not.toHaveClass('full');
  });

  it('rounds a fractional percentage: (1,3) -> 33% (33.33… rounded)', () => {
    const { container } = render(
      <ProgressBar variant="sprint" closedPoints={1} totalPoints={3} />,
    );
    const current = container.querySelector('.current-progress') as HTMLElement;
    expect(current.style.width).toBe('33%');
  });

  it('adds the .full class and renders 100% when closed === total: (10,10)', () => {
    const { container } = render(
      <ProgressBar variant="sprint" closedPoints={10} totalPoints={10} />,
    );
    const current = container.querySelector('.current-progress') as HTMLElement;
    expect(current).toHaveStyle({ width: '100%' });
    expect(current).toHaveClass('current-progress', 'full');
  });

  it('clamps above 100% to 100% and keeps .full: (15,10)', () => {
    const { container } = render(
      <ProgressBar variant="sprint" closedPoints={15} totalPoints={10} />,
    );
    const current = container.querySelector('.current-progress') as HTMLElement;
    expect(current.style.width).toBe('100%');
    expect(current).toHaveClass('full');
  });

  it('clamps a negative ratio up to 0%: (-5,10)', () => {
    const { container } = render(
      <ProgressBar variant="sprint" closedPoints={-5} totalPoints={10} />,
    );
    const current = container.querySelector('.current-progress') as HTMLElement;
    expect(current.style.width).toBe('0%');
    expect(current).not.toHaveClass('full');
  });

  it('renders 0% when total is 0 (no division / no Infinity)', () => {
    const { container } = render(
      <ProgressBar variant="sprint" closedPoints={5} totalPoints={0} />,
    );
    const current = container.querySelector('.current-progress') as HTMLElement;
    expect(current.style.width).toBe('0%');
    expect(current.style.width).not.toContain('Infinity');
    expect(current).not.toHaveClass('full');
  });

  it('renders 0% when total is undefined', () => {
    const { container } = render(
      <ProgressBar variant="sprint" closedPoints={5} totalPoints={undefined} />,
    );
    const current = container.querySelector('.current-progress') as HTMLElement;
    expect(current.style.width).toBe('0%');
  });

  it('treats undefined closed as 0: (undefined, 10) -> 0%', () => {
    const { container } = render(
      <ProgressBar variant="sprint" closedPoints={undefined} totalPoints={10} />,
    );
    const current = container.querySelector('.current-progress') as HTMLElement;
    expect(current.style.width).toBe('0%');
  });

  it('does NOT render any backlog-summary markup', () => {
    const { container } = render(
      <ProgressBar variant="sprint" closedPoints={3} totalPoints={10} />,
    );
    expect(container.querySelector('.summary-progress-bar')).toBeNull();
    expect(container.querySelector('.defined-points')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* variant="backlog-summary"                                                  */
/* -------------------------------------------------------------------------- */

describe('ProgressBar — variant="backlog-summary"', () => {
  it('renders .summary-progress-bar with the three layers in order', () => {
    const { container } = render(
      <ProgressBar
        variant="backlog-summary"
        stats={{ total_points: 20, defined_points: 30, closed_points: 10 }}
      />,
    );

    const bar = container.querySelector('.summary-progress-bar');
    expect(bar).toBeInTheDocument();
    expect(bar!.children).toHaveLength(3);
    expect(bar!.children[0]).toHaveClass('defined-points');
    expect(bar!.children[1]).toHaveClass('project-points-progress');
    expect(bar!.children[2]).toHaveClass('closed-points-progress');
  });

  it('sets the (non-visual) i18n tooltip titles', () => {
    const { container } = render(
      <ProgressBar
        variant="backlog-summary"
        stats={{ total_points: 20, defined_points: 30, closed_points: 10 }}
      />,
    );
    expect(container.querySelector('.defined-points')).toHaveAttribute(
      'title',
      'Excess of points',
    );
    expect(container.querySelector('.project-points-progress')).toHaveAttribute(
      'title',
      'Pending points',
    );
    expect(container.querySelector('.closed-points-progress')).toHaveAttribute(
      'title',
      'Closed points',
    );
  });

  it('the .defined-points background layer carries no inline width', () => {
    const { container } = render(
      <ProgressBar
        variant="backlog-summary"
        stats={{ total_points: 20, defined_points: 30, closed_points: 10 }}
      />,
    );
    const defined = container.querySelector('.defined-points') as HTMLElement;
    // No `style` prop is passed, so React emits no style attribute at all.
    expect(defined.getAttribute('style')).toBeNull();
  });

  it('definedPoints > totalPoints branch: {20,30,10} -> project 64%, closed 30%', () => {
    // projectPct = adjust(20*100/30 - 3) = adjust(66.66… - 3) = round(63.66…) = 64
    // closedPct  = adjust(10*100/30 - 3) = adjust(33.33… - 3) = round(30.33…) = 30
    const { container } = render(
      <ProgressBar
        variant="backlog-summary"
        stats={{ total_points: 20, defined_points: 30, closed_points: 10 }}
      />,
    );
    const project = container.querySelector('.project-points-progress') as HTMLElement;
    const closed = container.querySelector('.closed-points-progress') as HTMLElement;
    expect(project.style.width).toBe('64%');
    expect(closed.style.width).toBe('30%');
  });

  it('else branch (definedPoints <= totalPoints): project pinned to 100 -> 97% after -3', () => {
    // definedPoints(20) !> totalPoints(30) -> project = 100 -> adjust(97) = 97
    // closed = 10*100/30 = 33.33… -> adjust(30.33…) = 30
    const { container } = render(
      <ProgressBar
        variant="backlog-summary"
        stats={{ total_points: 30, defined_points: 20, closed_points: 10 }}
      />,
    );
    const project = container.querySelector('.project-points-progress') as HTMLElement;
    const closed = container.querySelector('.closed-points-progress') as HTMLElement;
    expect(project.style.width).toBe('97%');
    expect(closed.style.width).toBe('30%');
  });

  it('falls back to defined_points when total_points is falsy: {0,30,6}', () => {
    // totalPoints = total_points(0, falsy) -> defined_points(30) = 30
    // definedPoints(30) !> totalPoints(30) -> project = 100 -> 97
    // closed = 6*100/30 = 20 -> adjust(17) = 17
    const { container } = render(
      <ProgressBar
        variant="backlog-summary"
        stats={{ total_points: 0, defined_points: 30, closed_points: 6 }}
      />,
    );
    const project = container.querySelector('.project-points-progress') as HTMLElement;
    const closed = container.querySelector('.closed-points-progress') as HTMLElement;
    expect(project.style.width).toBe('97%');
    expect(closed.style.width).toBe('17%');
  });

  it('guards divide-by-zero for a degenerate all-zero project (no NaN width)', () => {
    const { container } = render(
      <ProgressBar
        variant="backlog-summary"
        stats={{ total_points: 0, defined_points: 0, closed_points: 0 }}
      />,
    );
    const project = container.querySelector('.project-points-progress') as HTMLElement;
    const closed = container.querySelector('.closed-points-progress') as HTMLElement;
    // adjusted per ProgressBar.tsx on disk: the naive expectation is "all widths
    // 0%", but the component follows the AngularJS branch math. With everything
    // zero: totalPoints = defined_points fallback = 0, so definedPoints(0) is NOT
    // > totalPoints(0) -> ELSE branch -> project pinned to 100 -> adjust(100-3) = 97;
    // closed = ratio(0,0) guarded to 0 -> adjust(0-3) = adjust(-3) = 0. The legacy
    // directive divided UNGUARDED here (0*100/0 = NaN -> "width: NaN%"); the React
    // port's divide-by-zero guard yields 0 instead, which the NaN assertions below lock in.
    expect(project.style.width).toBe('97%');
    expect(closed.style.width).toBe('0%');
    expect(project.getAttribute('style')).not.toContain('NaN');
    expect(closed.getAttribute('style')).not.toContain('NaN');
  });

  it('handles a stats object with all fields undefined (no throw, no NaN)', () => {
    const { container } = render(
      <ProgressBar variant="backlog-summary" stats={{}} />,
    );
    const project = container.querySelector('.project-points-progress') as HTMLElement;
    const closed = container.querySelector('.closed-points-progress') as HTMLElement;
    expect(project.style.width).toBe('97%');
    expect(closed.style.width).toBe('0%');
    expect(closed.getAttribute('style')).not.toContain('NaN');
  });

  it('does NOT render any sprint markup', () => {
    const { container } = render(
      <ProgressBar
        variant="backlog-summary"
        stats={{ total_points: 20, defined_points: 30, closed_points: 10 }}
      />,
    );
    expect(container.querySelector('.sprint-progress-bar')).toBeNull();
    expect(container.querySelector('.current-progress')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Type-level sanity (compile-time only; keeps the exported union honest)     */
/* -------------------------------------------------------------------------- */

describe('ProgressBar — exported prop types', () => {
  it('accepts each member of the discriminated union', () => {
    const sprintProps: SprintProgressBarProps = {
      variant: 'sprint',
      closedPoints: 1,
      totalPoints: 2,
    };
    const summaryProps: BacklogSummaryProgressBarProps = {
      variant: 'backlog-summary',
      stats: { total_points: 1, defined_points: 2, closed_points: 0 },
    };
    const asUnionA: ProgressBarProps = sprintProps;
    const asUnionB: ProgressBarProps = summaryProps;

    expect(asUnionA.variant).toBe('sprint');
    expect(asUnionB.variant).toBe('backlog-summary');
  });
});
