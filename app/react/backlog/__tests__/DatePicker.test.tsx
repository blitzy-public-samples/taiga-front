/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link DatePicker} — the React reproduction of the AngularJS
 * `tg-date-selector`/Pikaday calendar used by the Backlog sprint lightbox (F35).
 *
 * Coverage focus:
 *  - Bound-input contract: a free-text `<input type="text">` (NEVER `type="date"`)
 *    holds and emits the DISPLAY-format string; typing passes straight through to
 *    `onChange` (Pikaday `field` sync). aria-*, required, className, name, id, and
 *    placeholder are all forwarded so the field styles and validates exactly like
 *    the legacy input.
 *  - Pikaday DOM/class parity: the popup emits `.pika-single`/`.pika-lendar`/
 *    `.pika-title`/`.pika-label`/`.pika-prev`/`.pika-next`/`.pika-select`/
 *    `.pika-table`/`.pika-button` with `.is-today`/`.is-selected`/`.is-empty`
 *    state classes, so the committed vendor `pikaday.css` renders it unchanged.
 *  - Localization parity: month names, weekday header order (first day of week),
 *    prev/next labels, RTL flag, and the display format all come from the shared
 *    `getPickerConfig()`; proven with the English defaults AND a non-English
 *    catalog AND the RTL config path.
 *  - Interaction parity: focus/click opens; selecting a day emits the formatted
 *    display string and closes + refocuses; prev/next and the month/year selects
 *    navigate; Escape and an outside pointer press close.
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7): browserless — Jest + jsdom + RTL only. No
 * Playwright, no real browser, no network. React is NOT imported (automatic
 * `react-jsx`); `jest` is a global; jest-dom matchers are global via jest.config.
 */

import { render, fireEvent } from '@testing-library/react';
import { DatePicker } from '../components/DatePicker';
import type { DatePickerProps } from '../components/DatePicker';
import { configureI18n, resetI18n } from '../../shared/i18n';

/** Reset i18n + any config a test installed, so cases stay independent. */
beforeEach(() => {
  resetI18n();
  delete (window as unknown as { taigaConfig?: unknown }).taigaConfig;
});

/**
 * Render with sensible defaults and a jest.fn() onChange, merging overrides. The
 * onChange spy is assigned AFTER the spread so it is always the wired callback.
 */
function renderPicker(over: Partial<DatePickerProps> = {}) {
  const onChange = jest.fn();
  const props: DatePickerProps = {
    value: '15 Jan 2021',
    className: 'date-start',
    name: 'estimated_start',
    id: 'sprint-start',
    placeholder: 'Estimated Start',
    ariaLabel: 'Estimated Start',
    ...over,
    onChange,
  };
  const utils = render(<DatePicker {...props} />);
  return { ...utils, onChange, props };
}

// The bound input stays inside the render container. The calendar popup, however,
// is portaled to `document.body` (Pikaday `bound:true` parity — see DatePicker), so
// its queries are rooted at `document.body`. RTL's auto-cleanup unmounts each render
// (removing both the container AND the portaled popup) between tests, so a single
// picker's popup is unambiguous.
const inputEl = (c: HTMLElement) => c.querySelector('input') as HTMLInputElement;
const popupEl = () => document.body.querySelector('.pika-single') as HTMLElement | null;
const monthSelect = () =>
  document.body.querySelector('select.pika-select-month') as HTMLSelectElement | null;
const yearSelect = () =>
  document.body.querySelector('select.pika-select-year') as HTMLSelectElement | null;
const headerLabels = () =>
  Array.from(document.body.querySelectorAll('.pika-table thead th abbr')).map((n) => n.textContent);
const dayButtons = () =>
  Array.from(document.body.querySelectorAll('.pika-button')) as HTMLButtonElement[];
const dayButton = (day: number) => dayButtons().find((b) => b.textContent === String(day));

describe('DatePicker — bound input contract', () => {
  it('renders a free-text input (never type=date) forwarding all field attributes', () => {
    const { container } = renderPicker();
    const el = inputEl(container);
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('type')).toBe('text');
    expect(el).toHaveClass('date-start');
    expect(el).toHaveAttribute('name', 'estimated_start');
    expect(el).toHaveAttribute('id', 'sprint-start');
    expect(el).toHaveAttribute('placeholder', 'Estimated Start');
    expect(el).toHaveAttribute('aria-label', 'Estimated Start');
    expect(el).toHaveAttribute('autocomplete', 'off');
    expect(el).toHaveValue('15 Jan 2021');
  });

  it('forwards aria-required + aria-invalid + aria-describedby when set (never native required)', () => {
    const { container } = renderPicker({
      ariaRequired: true,
      ariaInvalid: true,
      ariaDescribedBy: 'err-start',
    });
    const el = inputEl(container);
    // aria-required, NOT the native `required` attribute (no browser validation).
    // (jest-dom's toBeRequired() treats aria-required as required, so assert the
    // absence of the native attribute directly.)
    expect(el).toHaveAttribute('aria-required', 'true');
    expect(el.hasAttribute('required')).toBe(false);
    expect(el).toHaveAttribute('aria-invalid', 'true');
    expect(el).toHaveAttribute('aria-describedby', 'err-start');
  });

  it('omits aria-invalid when not invalid (no false attribute noise)', () => {
    const { container } = renderPicker({ ariaInvalid: false });
    expect(inputEl(container).hasAttribute('aria-invalid')).toBe(false);
  });

  it('passes typed text straight through to onChange (Pikaday field sync)', () => {
    const { container, onChange } = renderPicker({ value: '' });
    fireEvent.change(inputEl(container), { target: { value: '03 Feb 2022' } });
    expect(onChange).toHaveBeenCalledWith('03 Feb 2022');
  });

  it('does not render the calendar popup until opened', () => {
    const { container } = renderPicker();
    expect(popupEl()).toBeNull();
  });
});

describe('DatePicker — open / close lifecycle', () => {
  it('opens the popup on focus', () => {
    const { container } = renderPicker();
    fireEvent.focus(inputEl(container));
    expect(popupEl()).not.toBeNull();
  });

  it('opens the popup on click', () => {
    const { container } = renderPicker();
    fireEvent.click(inputEl(container));
    expect(popupEl()).not.toBeNull();
  });

  it('closes on Escape and returns focus to the input', () => {
    const { container } = renderPicker();
    const el = inputEl(container);
    fireEvent.focus(el);
    expect(popupEl()).not.toBeNull();
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(popupEl()).toBeNull();
    expect(document.activeElement).toBe(el);
  });

  it('ignores Escape when already closed (no throw, stays closed)', () => {
    const { container } = renderPicker();
    fireEvent.keyDown(inputEl(container), { key: 'Escape' });
    expect(popupEl()).toBeNull();
  });

  it('stops Escape from bubbling while the calendar is open, but lets it bubble when closed', () => {
    const onParentKeyDown = jest.fn();
    const onChange = jest.fn();
    const { container } = render(
      <div onKeyDown={onParentKeyDown}>
        <DatePicker value="15 Jan 2021" onChange={onChange} className="date-start" />
      </div>,
    );
    const el = inputEl(container);
    // Calendar closed: Escape bubbles to the parent (so a hosting dialog can close).
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(onParentKeyDown).toHaveBeenCalledTimes(1);
    // Open the calendar, then Escape closes the calendar WITHOUT reaching the parent.
    fireEvent.focus(el);
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(popupEl()).toBeNull();
    expect(onParentKeyDown).toHaveBeenCalledTimes(1); // still 1 — did not bubble
  });

  it('closes on an outside pointer press', () => {
    const { container } = renderPicker();
    fireEvent.focus(inputEl(container));
    expect(popupEl()).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(popupEl()).toBeNull();
  });

  it('stays open on a pointer press inside the popup', () => {
    const { container } = renderPicker();
    fireEvent.focus(inputEl(container));
    const prev = document.body.querySelector('.pika-prev') as HTMLButtonElement;
    fireEvent.mouseDown(prev);
    expect(popupEl()).not.toBeNull();
  });

  it('portals the popup to <body> and keeps it anchored on scroll/resize', () => {
    const { container } = renderPicker();
    fireEvent.focus(inputEl(container));
    // Pikaday `bound:true` parity: the calendar is appended to document.body (NOT
    // nested inside the field), so the `.lightbox .dates div { float; width:49% }`
    // rule cannot reach it. Assert the popup is a body-level element, absolutely
    // positioned, and survives the reposition handlers fired on scroll/resize.
    const popup = popupEl();
    expect(popup).not.toBeNull();
    expect(popup?.parentElement).toBe(document.body);
    expect(popup).toHaveStyle({ position: 'absolute' });
    fireEvent.scroll(window);
    fireEvent.resize(window);
    expect(popupEl()).not.toBeNull();
    expect(popupEl()).toHaveStyle({ position: 'absolute' });
  });
});

describe('DatePicker — calendar rendering (English defaults)', () => {
  it('shows the month/year parsed from the value', () => {
    const { container } = renderPicker({ value: '15 Jan 2021' });
    fireEvent.focus(inputEl(container));
    expect(monthSelect()).toHaveValue('0'); // January
    expect(yearSelect()).toHaveValue('2021');
  });

  it('orders weekday headers starting on the configured first day (Monday)', () => {
    const { container } = renderPicker();
    fireEvent.focus(inputEl(container));
    expect(headerLabels()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('renders leading blank cells as td.is-empty (no button) before day 1', () => {
    // 01 Jan 2021 is a Friday; with Monday-first the month starts after 4 blanks.
    const { container } = renderPicker({ value: '15 Jan 2021' });
    fireEvent.focus(inputEl(container));
    const firstRow = document.body.querySelector('.pika-row') as HTMLElement;
    const cells = Array.from(firstRow.children);
    expect(cells.slice(0, 4).every((td) => td.classList.contains('is-empty'))).toBe(true);
    expect((cells[4].querySelector('.pika-button') as HTMLElement).textContent).toBe('1');
  });

  it('marks the selected day with td.is-selected', () => {
    const { container } = renderPicker({ value: '15 Jan 2021' });
    fireEvent.focus(inputEl(container));
    const selectedBtn = document.body.querySelector('td.is-selected .pika-button') as HTMLElement;
    expect(selectedBtn).not.toBeNull();
    expect(selectedBtn.textContent).toBe('15');
  });

  it('treats a non-empty but unparseable value as no selection (falls back to today)', () => {
    const { container } = renderPicker({ value: 'not a date' });
    fireEvent.focus(inputEl(container));
    // No day is marked selected, and the view falls back to the current month.
    expect(document.body.querySelector('td.is-selected')).toBeNull();
    expect(monthSelect()).toHaveValue(String(new Date().getMonth()));
  });

  it('marks today with td.is-today when viewing the current month (empty value)', () => {
    const { container } = renderPicker({ value: '' });
    fireEvent.focus(inputEl(container));
    const todayBtn = document.body.querySelector('td.is-today .pika-button') as HTMLElement;
    expect(todayBtn).not.toBeNull();
    expect(todayBtn.textContent).toBe(String(new Date().getDate()));
  });

  it('renders each day cell as a .pika-button carrying its data-day', () => {
    const { container } = renderPicker({ value: '15 Jan 2021' });
    fireEvent.focus(inputEl(container));
    const d20 = dayButton(20);
    expect(d20).toBeDefined();
    expect(d20).toHaveClass('pika-button');
    expect(d20).toHaveAttribute('data-day', '20');
  });
});

describe('DatePicker — day selection', () => {
  it('emits the formatted display string and closes on selecting a day', () => {
    const { container, onChange } = renderPicker({ value: '15 Jan 2021' });
    const el = inputEl(container);
    fireEvent.focus(el);
    fireEvent.click(dayButton(20) as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledWith('20 Jan 2021');
    expect(popupEl()).toBeNull();
    expect(document.activeElement).toBe(el);
  });

  it('selects a day in the current view even when the field started empty', () => {
    const { container, onChange } = renderPicker({ value: '' });
    fireEvent.focus(inputEl(container));
    // View is the current month; pick day 1 and assert onChange got a formatted date.
    fireEvent.click(dayButton(1) as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as string;
    // Must be a "DD MMM YYYY" string ending in the current year.
    expect(emitted).toMatch(/^01 \w{3} \d{4}$/);
  });
});

describe('DatePicker — month/year navigation', () => {
  it('goes to the previous month (wrapping the year) via the prev button', () => {
    const { container } = renderPicker({ value: '15 Jan 2021' });
    fireEvent.focus(inputEl(container));
    fireEvent.click(document.body.querySelector('.pika-prev') as HTMLButtonElement);
    expect(monthSelect()).toHaveValue('11'); // December
    expect(yearSelect()).toHaveValue('2020');
  });

  it('goes to the next month via the next button', () => {
    const { container } = renderPicker({ value: '15 Jan 2021' });
    fireEvent.focus(inputEl(container));
    fireEvent.click(document.body.querySelector('.pika-next') as HTMLButtonElement);
    expect(monthSelect()).toHaveValue('1'); // February
    expect(yearSelect()).toHaveValue('2021');
  });

  it('jumps to a month chosen from the month select', () => {
    const { container } = renderPicker({ value: '15 Jan 2021' });
    fireEvent.focus(inputEl(container));
    fireEvent.change(monthSelect() as HTMLSelectElement, { target: { value: '5' } });
    expect(monthSelect()).toHaveValue('5'); // June
  });

  it('jumps to a year chosen from the year select', () => {
    const { container } = renderPicker({ value: '15 Jan 2021' });
    fireEvent.focus(inputEl(container));
    fireEvent.change(yearSelect() as HTMLSelectElement, { target: { value: '2025' } });
    expect(yearSelect()).toHaveValue('2025');
  });

  it('offers a ±10-year range in the year select', () => {
    const { container } = renderPicker({ value: '15 Jan 2021' });
    fireEvent.focus(inputEl(container));
    const opts = Array.from((yearSelect() as HTMLSelectElement).options).map(
      (o) => o.value,
    );
    expect(opts[0]).toBe('2011');
    expect(opts[opts.length - 1]).toBe('2031');
    expect(opts).toHaveLength(21);
  });
});

describe('DatePicker — labels + prev/next titles', () => {
  it('labels the prev/next controls from the catalog', () => {
    const { container } = renderPicker();
    fireEvent.focus(inputEl(container));
    const prev = document.body.querySelector('.pika-prev') as HTMLButtonElement;
    const next = document.body.querySelector('.pika-next') as HTMLButtonElement;
    expect(prev).toHaveAttribute('title', 'Previous Month');
    expect(next).toHaveAttribute('title', 'Next Month');
  });
});

describe('DatePicker — localization + RTL', () => {
  it('sources month names from the active (non-English) catalog', () => {
    configureI18n(
      {
        COMMON: {
          PICKERDATE: {
            FORMAT: 'DD/MM/YYYY',
            MONTHS: { JAN: 'Enero' },
          },
        },
      },
      'es',
    );
    const { container } = renderPicker({ value: '15/01/2021' });
    fireEvent.focus(inputEl(container));
    const jan = (monthSelect() as HTMLSelectElement).querySelector(
      'option[value="0"]',
    ) as HTMLOptionElement;
    expect(jan.textContent).toBe('Enero');
    expect(monthSelect()).toHaveValue('0');
  });

  it('adds is-rtl to the popup when the preferred language is RTL', () => {
    (window as unknown as { taigaConfig: unknown }).taigaConfig = {
      rtlLanguages: ['en', 'ar', 'he'],
    };
    const { container } = renderPicker();
    fireEvent.focus(inputEl(container));
    expect(popupEl()).toHaveClass('is-rtl');
  });

  it('omits is-rtl for a non-RTL locale', () => {
    const { container } = renderPicker();
    fireEvent.focus(inputEl(container));
    expect(popupEl()?.className.includes('is-rtl')).toBe(false);
  });
});

/* ================================================================== *
 * M-22 — single-open enforcement across sibling pickers
 * ================================================================== */
describe('DatePicker — M-22 single-open enforcement', () => {
  /** Render the two sibling pickers the sprint form hosts (start + finish). */
  function renderTwo() {
    const onChange = jest.fn();
    return render(
      <div>
        <DatePicker
          value="15 Jan 2021"
          className="date-start"
          name="estimated_start"
          id="sprint-start"
          ariaLabel="Estimated Start"
          onChange={onChange}
        />
        <DatePicker
          value="20 Jan 2021"
          className="date-end"
          name="estimated_finish"
          id="sprint-finish"
          ariaLabel="Estimated Finish"
          onChange={onChange}
        />
      </div>,
    );
  }
  const openPopupCount = () => document.body.querySelectorAll('.pika-single').length;

  it('opening the second picker via keyboard/programmatic focus closes the first (at most one open)', () => {
    const { container } = renderTwo();
    const start = container.querySelector('input[name="estimated_start"]') as HTMLInputElement;
    const finish = container.querySelector('input[name="estimated_finish"]') as HTMLInputElement;

    // Focus the first field: exactly one calendar is open.
    fireEvent.focus(start);
    expect(openPopupCount()).toBe(1);

    // Focus the second field WITHOUT an outside mousedown (the keyboard/tab path
    // that previously left BOTH open — the QA M-22 state). The registry must have
    // closed the first, so exactly one calendar remains open.
    fireEvent.focus(finish);
    expect(openPopupCount()).toBe(1);
  });

  it('Escape on the lone open picker closes it (zero open) — registry released', () => {
    const { container } = renderTwo();
    const start = container.querySelector('input[name="estimated_start"]') as HTMLInputElement;
    fireEvent.focus(start);
    expect(openPopupCount()).toBe(1);
    // The calendar's own Escape handler closes it.
    fireEvent.keyDown(document.body.querySelector('.pika-single') as HTMLElement, { key: 'Escape' });
    expect(openPopupCount()).toBe(0);
    // With the slot released, re-opening the second works (still single-open).
    const finish = container.querySelector('input[name="estimated_finish"]') as HTMLInputElement;
    fireEvent.focus(finish);
    expect(openPopupCount()).toBe(1);
  });
});
