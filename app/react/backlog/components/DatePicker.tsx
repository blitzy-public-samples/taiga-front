/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * DatePicker — a self-contained React reproduction of the AngularJS
 * `tg-date-selector` directive (common/components.coffee:44-79), which wrapped the
 * third-party **Pikaday** calendar. It replaces that directive for the migrated
 * Backlog sprint lightbox (F35) WITHOUT importing AngularJS, Pikaday, or any new
 * npm dependency — the calendar is built from `moment` (already a project
 * dependency) and the shared i18n runtime.
 *
 * PARITY CONTRACT (why this is a faithful port, not an enhancement):
 *  - Visual parity: the popup reproduces Pikaday's EXACT DOM and class names
 *    (`.pika-single.is-bound`, `.pika-lendar`, `.pika-title`, `.pika-label`,
 *    `.pika-prev`/`.pika-next`, `.pika-select`, `.pika-table` with `.pika-button`
 *    day cells and the `.is-today`/`.is-selected`/`.is-disabled` state classes), so
 *    the committed vendor stylesheet `app/styles/vendor/pikaday.css` renders it
 *    byte-identically. No new SCSS is added.
 *  - Localization parity: month names, weekday headers, prev/next labels, the
 *    first day of the week, and the display format all come from
 *    `getPickerConfig()` — the shared reproduction of the legacy
 *    `tgDatePickerConfigService` (`DataPickerConfig`, common.coffee) — so the
 *    calendar localizes exactly as before.
 *  - Data contract parity: the bound `<input type="text">` (never
 *    `<input type="date">`) holds the DISPLAY-format string ("DD MMM YYYY"), and
 *    `onChange` emits that same display string. Serialization to the frozen
 *    `/api/v1/` "YYYY-MM-DD" happens at submit time in `SprintForm`, exactly as the
 *    legacy `$('.date-start').val()` + `moment(val, prettyDate).format("YYYY-MM-DD")`
 *    path did (lightboxes.coffee:54-67). The field also remains free-text editable,
 *    matching Pikaday's `field` sync.
 *
 * Coexistence boundary (AAP 0.7): imports ONLY React, `moment`, and the sibling
 * shared i18n module. No AngularJS/CoffeeScript import; no direct DOM/config access
 * beyond the standard controlled-input pattern. Uses the automatic JSX runtime.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import moment from 'moment';
import { getPickerConfig } from '../../shared/i18n';

/** Props for {@link DatePicker}. */
export interface DatePickerProps {
  /** Controlled display-format value ("DD MMM YYYY"). Empty string = no date. */
  value: string;
  /** Emitted with the new DISPLAY-format string on typing or day selection. */
  onChange: (display: string) => void;
  /** Input class (e.g. `date-start` / `date-end`) — drives the existing SCSS. */
  className?: string;
  /** Input `name` attribute (e.g. `estimated_start`). */
  name?: string;
  /** Input `id` (used to wire an external `<label htmlFor>` / aria-describedby). */
  id?: string;
  /** Placeholder text (already translated by the caller). */
  placeholder?: string;
  /** Accessible name for the input (the caller passes the translated field label). */
  ariaLabel?: string;
  /** Marks the field invalid for assistive tech (mirrors the checksley error state). */
  ariaInvalid?: boolean;
  /** id of an error element describing the field. */
  ariaDescribedBy?: string;
  /**
   * Announces the field as required via `aria-required` (mirrors the legacy
   * `data-required="true"` checksley rule). Deliberately NOT the native `required`
   * attribute: the legacy relied on checksley for validation, and a native
   * `required` would trigger the browser's own validation bubble and block submit
   * before the hand-written validators run — a behavior change. Validation stays
   * in `sprintValidators`; this only exposes the required state to assistive tech.
   */
  ariaRequired?: boolean;
}

/**
 * The calendar popup is rendered through a portal to `document.body` and
 * absolutely positioned, EXACTLY as Pikaday does with `bound: true` (its default
 * when a field is supplied). This is not merely stylistic: the sprint lightbox
 * SCSS uses the descendant rule `.lightbox-sprint-add-edit .dates div { float:
 * left; width: 49% }` (app/styles/modules/common/lightbox.scss:270-283), which
 * would otherwise match every `<div>` inside the calendar (`.pika-single`,
 * `.pika-lendar`, `.pika-title`, `.pika-label`) and shatter its layout. Appending
 * the popup to `<body>` — verified against the live AngularJS screen, where
 * `.pika-single` is a direct child of `document.body` — keeps it outside `.dates`
 * so the committed `pikaday.css` renders it byte-identically.
 */
const BASE_POPUP_STYLE: CSSProperties = { position: 'absolute' };

/** Absolute page coordinates for the bound popup (Pikaday's field-relative anchor). */
interface PopupPosition {
  left: number;
  top: number;
}

/**
 * Computes the popup anchor the way Pikaday's `adjustPosition` does for the
 * default (left-aligned, below-field) case: the popup's top-left aligns with the
 * field's bottom-left in PAGE coordinates (viewport rect + scroll offset).
 */
function computePopupPosition(input: HTMLInputElement | null): PopupPosition {
  if (!input) {
    return { left: 0, top: 0 };
  }
  const rect = input.getBoundingClientRect();
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  return { left: rect.left + scrollX, top: rect.bottom + scrollY };
}

/**
 * Builds the weeks matrix for a month view. Each week is a 7-slot array whose
 * entries are the day-of-month number, or `null` for the leading/trailing blank
 * cells (Pikaday's default `showDaysInNextAndPreviousMonths: false`). `firstDay`
 * rotates the grid so the week starts on the configured day.
 */
function buildWeeks(year: number, month: number, firstDay: number): Array<Array<number | null>> {
  const first = moment([year, month, 1]);
  const daysInMonth = first.daysInMonth();
  const startWeekday = first.day(); // 0 = Sunday .. 6 = Saturday
  const offset = (startWeekday - firstDay + 7) % 7;

  const cells: Array<number | null> = [];
  for (let i = 0; i < offset; i += 1) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(d);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: Array<Array<number | null>> = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/**
 * The date picker. Renders the bound text input and, while focused/open, the
 * Pikaday-equivalent calendar popup positioned just beneath it.
 */
export function DatePicker(props: DatePickerProps) {
  const {
    value,
    onChange,
    className,
    name,
    id,
    placeholder,
    ariaLabel,
    ariaInvalid,
    ariaDescribedBy,
    ariaRequired,
  } = props;

  const config = useMemo(() => getPickerConfig(), []);
  const { format, firstDay, isRTL, i18n } = config;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The portaled popup lives outside `containerRef`, so it needs its own ref for
  // the outside-click test below (a click inside the calendar must not close it).
  const popupRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  // Page coordinates for the portaled popup, recomputed on open and while it is
  // shown (scroll/resize) — mirrors Pikaday keeping the bound calendar anchored.
  const [position, setPosition] = useState<PopupPosition>({ left: 0, top: 0 });

  // Guards the deliberate "hide, then return focus to the field" sequence: focusing
  // the input would otherwise re-fire `onFocus` and immediately reopen the popup.
  // Pikaday avoids the same loop internally; here a one-shot ref does it.
  const suppressReopenRef = useRef(false);

  // The parsed selected date (or null when the field is empty/unparseable),
  // recomputed from the controlled `value` so typing keeps the calendar in sync.
  const selected = useMemo(() => {
    if (!value) {
      return null;
    }
    const m = moment(value, format);
    return m.isValid() ? m : null;
  }, [value, format]);

  // The month currently shown in the calendar (a moment at day 1). Seeded from the
  // selected date, else today.
  const [viewDate, setViewDate] = useState(() => (selected ? selected.clone() : moment()));

  // When the popup opens, re-center the view on the selected date (or today), so
  // reopening after a value change shows the right month.
  const openPopup = useCallback(() => {
    // Skip exactly one open request when it was triggered by our own refocus.
    if (suppressReopenRef.current) {
      suppressReopenRef.current = false;
      return;
    }
    setViewDate(selected ? selected.clone() : moment());
    setOpen(true);
  }, [selected]);

  /** Close the popup and return focus to the field without reopening it. */
  const hideAndRefocus = useCallback(() => {
    suppressReopenRef.current = true;
    setOpen(false);
    inputRef.current?.focus();
  }, []);

  // Close on an outside pointer press (Pikaday's document click handler). Because
  // the popup is portaled to `<body>` (outside `containerRef`), a press inside the
  // calendar must be recognised via `popupRef` so it is NOT treated as "outside".
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const inField = containerRef.current?.contains(target) ?? false;
      const inPopup = popupRef.current?.contains(target) ?? false;
      if (!inField && !inPopup) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // Anchor the portaled popup to the field. Positioned in a layout effect so the
  // first paint is already correct, then kept in sync on scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    const reposition = () => setPosition(computePopupPosition(inputRef.current));
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const viewYear = viewDate.year();
  const viewMonth = viewDate.month(); // 0-based

  const weeks = useMemo(
    () => buildWeeks(viewYear, viewMonth, firstDay),
    [viewYear, viewMonth, firstDay],
  );

  // Weekday header labels rotated to start on `firstDay`.
  const weekdayHeaders = useMemo(() => {
    const headers: Array<{ short: string; full: string }> = [];
    for (let i = 0; i < 7; i += 1) {
      const idx = (firstDay + i) % 7;
      headers.push({ short: i18n.weekdaysShort[idx], full: i18n.weekdays[idx] });
    }
    return headers;
  }, [firstDay, i18n]);

  const today = useMemo(() => moment(), []);

  const goPrevMonth = () => setViewDate((d) => d.clone().subtract(1, 'month'));
  const goNextMonth = () => setViewDate((d) => d.clone().add(1, 'month'));

  const selectDay = (day: number) => {
    const picked = moment([viewYear, viewMonth, day]);
    onChange(picked.format(format));
    // Close and return focus to the field, matching a native-picker close.
    hideAndRefocus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      // Escape closes ONLY the calendar here; stop propagation so a hosting dialog
      // (e.g. the SprintForm lightbox, which also closes on Escape) does not close
      // too. When the calendar is already closed the event bubbles normally so the
      // dialog can handle it — matching native date-input behavior.
      event.preventDefault();
      event.stopPropagation();
      hideAndRefocus();
    }
  };

  // Year range for the quick-jump select: view year ± 10 (Pikaday's default range).
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = viewYear - 10; y <= viewYear + 10; y += 1) {
      list.push(y);
    }
    return list;
  }, [viewYear]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }} onKeyDown={onKeyDown}>
      <input
        ref={inputRef}
        className={className}
        type="text"
        name={name}
        id={id}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        aria-required={ariaRequired || undefined}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={openPopup}
        onClick={openPopup}
      />
      {open
        ? createPortal(
            <div
              ref={popupRef}
              className={`pika-single is-bound left-aligned bottom-aligned${isRTL ? ' is-rtl' : ''}`}
              style={{ ...BASE_POPUP_STYLE, left: position.left, top: position.top }}
              role="dialog"
              aria-label={ariaLabel}
              onKeyDown={onKeyDown}
            >
              <div className="pika-lendar">
                <div className="pika-title">
                  <div className="pika-label">
                    {i18n.months[viewMonth]}
                    <select
                      className="pika-select pika-select-month"
                      aria-label={i18n.months[viewMonth]}
                      value={viewMonth}
                      onChange={(e) =>
                        setViewDate((d) => d.clone().month(parseInt(e.target.value, 10)))
                      }
                    >
                      {i18n.months.map((label, idx) => (
                        <option key={label} value={idx}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pika-label">
                    {viewYear}
                    <select
                      className="pika-select pika-select-year"
                      aria-label={String(viewYear)}
                      value={viewYear}
                      onChange={(e) => setViewDate((d) => d.clone().year(parseInt(e.target.value, 10)))}
                    >
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="pika-prev"
                    title={i18n.previousMonth}
                    onClick={goPrevMonth}
                  >
                    {i18n.previousMonth}
                  </button>
                  <button
                    type="button"
                    className="pika-next"
                    title={i18n.nextMonth}
                    onClick={goNextMonth}
                  >
                    {i18n.nextMonth}
                  </button>
                </div>
                <table className="pika-table" role="grid">
                  <thead>
                    <tr>
                      {weekdayHeaders.map((wd) => (
                        <th key={wd.full} scope="col">
                          <abbr title={wd.full}>{wd.short}</abbr>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((week, wi) => (
                      <tr key={wi} className="pika-row">
                        {week.map((day, di) => {
                          if (day === null) {
                            return <td key={di} className="is-empty" />;
                          }
                          const cellDate = moment([viewYear, viewMonth, day]);
                          const isToday = cellDate.isSame(today, 'day');
                          const isSelected = selected ? cellDate.isSame(selected, 'day') : false;
                          const cls = [isToday ? 'is-today' : '', isSelected ? 'is-selected' : '']
                            .filter(Boolean)
                            .join(' ');
                          return (
                            <td key={di} className={cls || undefined} data-day={day}>
                              <button
                                type="button"
                                className="pika-button"
                                data-day={day}
                                aria-label={cellDate.format(format)}
                                aria-pressed={isSelected}
                                onClick={() => selectDay(day)}
                              >
                                {day}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
