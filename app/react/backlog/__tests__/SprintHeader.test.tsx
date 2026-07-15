/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link SprintHeader} — the React port of the AngularJS
 * `tgBacklogSprintHeader` directive (sprints.coffee:67-117 + sprint-header.jade).
 *
 * Coverage focus (the review findings this component carries):
 *  - F32 (Localization / Date Parity): every label, tooltip, point label, and the
 *    date-range FORMAT are resolved through the shared `t()` runtime against the
 *    ACTIVE locale — never hardcoded. Proven with both the embedded English
 *    defaults AND an injected non-English (Spanish) catalog whose different
 *    `BACKLOG.SPRINTS.DATE` pattern must flow through to the rendered date range.
 *  - F33 (Accessibility): the fold toggle exposes `aria-expanded` reflecting the
 *    fold state, and the edit pencil (rendered `opacity: 0` by the SCSS, revealed
 *    only on hover) gains a focus-visible reveal so keyboard focus never lands on
 *    an invisible control.
 *  - F09 (Test Completeness): SprintHeader previously had 0% coverage; this spec
 *    exercises every branch — the two permission gates, the fold class/aria,
 *    interactions, the `?? 0` point fallbacks, and the focus reveal — to satisfy
 *    the >=70% line gate for app/react/** (AAP 0.7.1).
 *
 * The GO_TO_TASKBOARD tooltip parity is subtle and verified against the LIVE
 * AngularJS app: the catalog value is "Go to the taskboard of {{::name}}", but the
 * jade uses the bare `| translate` filter with NO params, so AngularJS interpolates
 * the placeholder against an empty context to the empty string. The component
 * reproduces that EXACT render ("Go to the taskboard of ", trailing space, no
 * name); these tests lock that byte-exact parity in.
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7): browserless. Jest + jsdom + React Testing
 * Library ONLY — NO Playwright, NO real browser, NO network, NO `/api/v1/` call.
 *
 * IMPORT WHITELIST (globals-only): imports ONLY '@testing-library/react', the
 * component under test, and the REAL shared i18n runtime (to drive the locale
 * cases the way the hosting screen does). React is NOT imported (automatic
 * `react-jsx` runtime); `jest` is a global; jest-dom matchers are registered
 * globally via jest.config `setupFilesAfterEnv`.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { SprintHeader } from '../components/SprintHeader';
import type { SprintHeaderProps } from '../components/SprintHeader';
import { configureI18n, resetI18n } from '../../shared/i18n';

/**
 * Expected English strings, copied VERBATIM from `app/locales/taiga/locale-en.json`
 * (and the embedded default catalog). `GO_TO_TASKBOARD_EMPTY` has an intentional
 * trailing space and NO name — the empirically-verified legacy render.
 */
const EN = {
  COMPACT: 'Compact Sprint',
  EDIT: 'Edit Sprint',
  GO_TO_TASKBOARD_EMPTY: 'Go to the taskboard of ',
  CLOSED: 'closed',
  TOTAL: 'total',
  // moment.format('DD MMM YYYY') for the two default fixture dates.
  DATE_RANGE: '01 Jan 2021-15 Jan 2021',
};

/**
 * A minimal Spanish catalog. Note the deliberately NUMERIC date pattern
 * ("DD/MM/YYYY"): it proves the format string is sourced from the active catalog
 * WITHOUT depending on moment's own month-name locale (moment stays 'en' here).
 */
const ES_CATALOG = {
  BACKLOG: {
    COMPACT_SPRINT: 'Compactar Sprint',
    EDIT_SPRINT: 'Editar Sprint',
    GO_TO_TASKBOARD: 'Ir al taskboard de {{::name}}',
    CLOSED_POINTS: 'cerrados',
    TOTAL_POINTS: 'totales',
    SPRINTS: { DATE: 'DD/MM/YYYY' },
  },
};

const ES = {
  COMPACT: 'Compactar Sprint',
  EDIT: 'Editar Sprint',
  GO_TO_TASKBOARD_EMPTY: 'Ir al taskboard de ',
  CLOSED: 'cerrados',
  TOTAL: 'totales',
  DATE_RANGE: '01/01/2021-15/01/2021',
};

/**
 * Render `SprintHeader` with sensible defaults and jest.fn() callbacks, merging
 * per-test overrides. The two callbacks are ALWAYS owned by this helper (assigned
 * AFTER the `...over` spread), so the returned spies are guaranteed to be the ones
 * wired into the rendered component.
 */
function renderHeader(over: Partial<SprintHeaderProps> = {}) {
  const onToggleFold = jest.fn();
  const onEdit = jest.fn();

  const props: SprintHeaderProps = {
    name: 'Sprint 1',
    estimatedStart: '2021-01-01',
    estimatedFinish: '2021-01-15',
    closedPoints: 5,
    totalPoints: 20,
    taskboardUrl: '/project/proj-1/taskboard/sprint-1',
    isVisible: true,
    isEditable: true,
    isOpen: false,
    ...over,
    onToggleFold,
    onEdit,
  };

  const utils = render(<SprintHeader {...props} />);
  return { ...utils, onToggleFold, onEdit, props };
}

/** Query helpers scoped to the rendered container (precise, order-independent). */
const foldButton = (c: HTMLElement) =>
  c.querySelector('button.compact-sprint') as HTMLButtonElement | null;
const taskboardLink = (c: HTMLElement) =>
  c.querySelector('.sprint-name a') as HTMLAnchorElement | null;
const editLink = (c: HTMLElement) => c.querySelector('a.edit-sprint') as HTMLAnchorElement | null;
const dateEl = (c: HTMLElement) => c.querySelector('.sprint-date') as HTMLElement | null;
const numbers = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.sprint-points .number')).map((n) => n.textContent);
const descriptions = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.sprint-points .description')).map((n) => n.textContent);

beforeEach(() => resetI18n());
afterEach(() => resetI18n());

describe('SprintHeader — structure', () => {
  it('renders the summary skeleton (.sprint-summary with name container, date, and points)', () => {
    const { container } = renderHeader();
    expect(container.querySelector('.sprint-summary')).toBeInTheDocument();
    expect(container.querySelector('.sprint-name-container .sprint-name')).toBeInTheDocument();
    expect(dateEl(container)).toBeInTheDocument();
    expect(container.querySelector('.sprint-points .sprint-info ul')).toBeInTheDocument();
  });

  it('always renders the fold toggle button with the arrow icon', () => {
    const { container } = renderHeader();
    const btn = foldButton(container);
    expect(btn).toBeInTheDocument();
    expect(btn?.getAttribute('type')).toBe('button');
    expect(container.querySelector('button.compact-sprint [svg-icon="icon-arrow-right"]')).toBeInTheDocument();
  });
});

describe('SprintHeader — permission gating (sprints.coffee isVisible / isEditable)', () => {
  it('renders the taskboard link with the sprint name when isVisible', () => {
    const { container } = renderHeader({ isVisible: true, name: 'Sprint 42' });
    const link = taskboardLink(container);
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/project/proj-1/taskboard/sprint-1');
    expect(link?.querySelector('span')?.textContent).toBe('Sprint 42');
  });

  it('omits the taskboard link (and the name) when NOT isVisible', () => {
    const { container } = renderHeader({ isVisible: false, name: 'Sprint 42' });
    expect(taskboardLink(container)).toBeNull();
    expect(screen.queryByText('Sprint 42')).not.toBeInTheDocument();
  });

  it('renders the edit pencil when isEditable', () => {
    const { container } = renderHeader({ isEditable: true });
    const link = editLink(container);
    expect(link).toBeInTheDocument();
    expect(container.querySelector('a.edit-sprint [svg-icon="icon-edit"]')).toBeInTheDocument();
  });

  it('omits the edit pencil when NOT isEditable', () => {
    const { container } = renderHeader({ isEditable: false });
    expect(editLink(container)).toBeNull();
  });
});

describe('SprintHeader — fold state & aria-expanded (F33)', () => {
  it('collapsed: class is "compact-sprint" (no active) and aria-expanded is false', () => {
    const { container } = renderHeader({ isOpen: false });
    const btn = foldButton(container);
    expect(btn?.className).toBe('compact-sprint');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('expanded: class gains "active" and aria-expanded is true', () => {
    const { container } = renderHeader({ isOpen: true });
    const btn = foldButton(container);
    expect(btn?.className).toBe('compact-sprint active');
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('SprintHeader — interactions', () => {
  it('invokes onToggleFold when the fold button is clicked', () => {
    const { container, onToggleFold } = renderHeader();
    fireEvent.click(foldButton(container) as HTMLButtonElement);
    expect(onToggleFold).toHaveBeenCalledTimes(1);
  });

  it('invokes onEdit and prevents default navigation when the edit pencil is clicked', () => {
    const { container, onEdit } = renderHeader({ isEditable: true });
    const link = editLink(container) as HTMLAnchorElement;
    // Dispatch a real cancelable click so we can assert preventDefault() ran
    // (the handler calls e.preventDefault() before onEdit, mirroring href="").
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(evt);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(true);
  });
});

describe('SprintHeader — i18n English defaults (F32)', () => {
  it('renders every label/tooltip and the date range from the English catalog', () => {
    const { container } = renderHeader();
    expect(foldButton(container)).toHaveAttribute('title', EN.COMPACT);
    expect(editLink(container)).toHaveAttribute('title', EN.EDIT);
    // GO_TO_TASKBOARD renders with an EMPTY name (trailing space) — legacy parity.
    expect(taskboardLink(container)).toHaveAttribute('title', EN.GO_TO_TASKBOARD_EMPTY);
    expect(descriptions(container)).toEqual([EN.CLOSED, EN.TOTAL]);
    expect(dateEl(container)?.textContent).toBe(EN.DATE_RANGE);
  });

  it('does NOT interpolate the sprint name into the taskboard tooltip (no "Sprint 1")', () => {
    const { container } = renderHeader({ name: 'Sprint 1' });
    const title = taskboardLink(container)?.getAttribute('title');
    expect(title).toBe(EN.GO_TO_TASKBOARD_EMPTY);
    expect(title).not.toContain('Sprint 1');
    expect(title).not.toContain('{{'); // no leftover placeholder either
  });
});

describe('SprintHeader — i18n non-English catalog (F32 locale parity)', () => {
  it('renders labels, point labels, and the date FORMAT from the active Spanish catalog', () => {
    configureI18n(ES_CATALOG, 'es');
    const { container } = renderHeader();
    expect(foldButton(container)).toHaveAttribute('title', ES.COMPACT);
    expect(editLink(container)).toHaveAttribute('title', ES.EDIT);
    expect(taskboardLink(container)).toHaveAttribute('title', ES.GO_TO_TASKBOARD_EMPTY);
    expect(descriptions(container)).toEqual([ES.CLOSED, ES.TOTAL]);
    // The DD/MM/YYYY pattern came from the catalog, proving nothing is hardcoded.
    expect(dateEl(container)?.textContent).toBe(ES.DATE_RANGE);
  });
});

describe('SprintHeader — point formatting & fallbacks', () => {
  it('renders the closed/total point numbers', () => {
    const { container } = renderHeader({ closedPoints: 5, totalPoints: 20 });
    expect(numbers(container)).toEqual(['5', '20']);
  });

  it('falls back to 0 when closed/total points are undefined (sprint.*_points or 0)', () => {
    const { container } = renderHeader({ closedPoints: undefined, totalPoints: undefined });
    expect(numbers(container)).toEqual(['0', '0']);
  });

  it('formats fractional points with up to three fraction digits (| number parity)', () => {
    const { container } = renderHeader({ closedPoints: 1.5, totalPoints: 3.14159 });
    expect(numbers(container)).toEqual(['1.5', '3.142']);
  });
});

describe('SprintHeader — edit pencil focus-visible reveal (F33)', () => {
  it('is not revealed by default, reveals on focus, and hides again on blur', () => {
    const { container } = renderHeader({ isEditable: true });
    const link = editLink(container) as HTMLAnchorElement;

    // Default: no inline reveal (SCSS keeps it opacity:0 until hover).
    expect(link.style.opacity).toBe('');
    expect(link.style.background).toBe('');

    // Keyboard focus reveals it with the EXACT hover treatment.
    fireEvent.focus(link);
    expect(link.style.opacity).toBe('1');
    expect(link.style.background).toContain('rgba(255, 255, 255, 0.8)');

    // Blur removes the inline reveal, restoring the SCSS-driven appearance.
    fireEvent.blur(link);
    expect(link.style.opacity).toBe('');
    expect(link.style.background).toBe('');
  });
});
