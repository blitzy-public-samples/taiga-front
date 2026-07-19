/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * DatePicker — a themed, dependency-free date field that reproduces the
 * AngularJS `tg-date-selector` (Pikaday-backed) control used by the sprint
 * create/edit lightbox (`lightbox-sprint-add-edit.jade`, where the two date
 * fields are `input.date-start` / `input.date-end` declared as `type="text"` +
 * `tg-date-selector`, NOT native date inputs).
 *
 * QA finding BL-03: the React port rendered a native `<input type="date">`,
 * which shows a locale/browser "mm/dd/yyyy" mask plus a native calendar icon.
 * The AngularJS baseline shows a plain text field formatted "DD MMM YYYY"
 * (e.g. "04 Aug 2026") with NO native icon, opening a Pikaday calendar popover
 * on interaction. This component restores that behavior.
 *
 * Design (AAP §0.1.2, §0.3.4 — like-for-like, no new dependency):
 *  - The VALUE is stored/emitted in the canonical `YYYY-MM-DD` wire format,
 *    identical to the native input it replaces, so the surrounding
 *    validate() / normalizeDate() / payload logic in SprintEditLightbox is
 *    untouched (the finding is display-only).
 *  - The value is DISPLAYED formatted "DD MMM YYYY" (`COMMON.PICKERDATE.FORMAT`)
 *    in a read-only text input — no native date UI, no native calendar icon.
 *  - On open it renders a calendar popover reproducing the EXACT Pikaday class
 *    names (`.pika-single.is-bound`, `.pika-lendar`, `.pika-title`,
 *    `.pika-prev` / `.pika-next`, `.pika-label`, `.pika-table`, `.pika-button`,
 *    and the `.is-today` / `.is-selected` / `.is-empty` state classes) so the
 *    already-compiled `app/styles/vendor/pikaday.css` themes it unchanged
 *    (visual parity by construction).
 *
 * The component is dependency-free (uses the already-present `moment`), pure and
 * fully controlled (value in, `onChange` out), and forwards a ref to the inner
 * `<input>` so callers can move focus to the field (e.g. SprintEditLightbox
 * focusing the first invalid date on a failed submit). It renders as a Fragment
 * (input + popover as siblings) — never introducing a wrapper element — so the
 * input keeps sitting DIRECTLY inside the legacy `.dates > div` (which is
 * `position: relative`), preserving both the SCSS anchor for the absolutely
 * positioned popover and the input's parent relationship to its error span.
 */

import {
    forwardRef,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type {
    KeyboardEvent as ReactKeyboardEvent,
    MutableRefObject,
} from "react";
import moment from "moment";

import { t } from "../i18n/translate";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Canonical wire format — matches sprintForm `DATE_FORMAT` and the API. */
const WIRE_FORMAT = "YYYY-MM-DD";
/** Human-facing display format (`COMMON.PICKERDATE.FORMAT` — "DD MMM YYYY"). */
const DISPLAY_FORMAT = "DD MMM YYYY";
/** A calendar month is always laid out on a fixed 6×7 grid (Pikaday default). */
const WEEKS = 6;
const DAYS_PER_WEEK = 7;

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

export interface DatePickerProps {
    /**
     * Current value in `YYYY-MM-DD`. An empty or unparseable value renders a
     * blank field (and no calendar selection), matching the native input which
     * showed nothing for an unset/invalid date.
     */
    value: string;
    /** Emits the newly-picked date in `YYYY-MM-DD`. */
    onChange: (nextIso: string) => void;
    /**
     * Class(es) for the text input (e.g. `"date-start"`, optionally suffixed
     * with `" checksley-error"` by the caller to show the invalid-field border).
     */
    className?: string;
    /** `name` attribute mirrored from the legacy markup (`estimated_start`/`_finish`). */
    name?: string;
    /** Accessible label — the field has no visible `<label>` in the legacy markup. */
    ariaLabel?: string;
    /** Disables interaction while a request is in flight. */
    disabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
    function DatePicker(
        { value, onChange, className, name, ariaLabel, disabled = false },
        ref,
    ) {
        const [open, setOpen] = useState(false);
        const popoverRef = useRef<HTMLDivElement>(null);
        const inputRef = useRef<HTMLInputElement | null>(null);

        // Keep our own ref (needed for the outside-click boundary check) while
        // still honoring the forwarded ref the caller passes for focus control.
        const setInputRef = useCallback(
            (node: HTMLInputElement | null) => {
                inputRef.current = node;
                if (typeof ref === "function") {
                    ref(node);
                } else if (ref) {
                    (ref as MutableRefObject<HTMLInputElement | null>).current = node;
                }
            },
            [ref],
        );

        // Strictly-parsed selection: `null` when empty/unparseable, so the field
        // shows blank and no day is highlighted (the value in state is left
        // untouched so validate() can still report an invalid date on submit).
        const selected = useMemo(() => {
            const parsed = moment(value, WIRE_FORMAT, true);
            return parsed.isValid() ? parsed : null;
        }, [value]);

        // The month shown in the calendar. Re-anchors to the selection whenever
        // the external value changes.
        const [viewMonth, setViewMonth] = useState<moment.Moment>(() =>
            (selected ?? moment()).clone().startOf("month"),
        );
        useEffect(() => {
            if (selected) {
                setViewMonth(selected.clone().startOf("month"));
            }
            // Intentionally keyed on `value` (the external source of truth).
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [value]);

        const displayValue = selected ? selected.format(DISPLAY_FORMAT) : "";

        // Close on an outside mousedown or on Escape (returning focus to the field).
        useEffect(() => {
            if (!open) {
                return undefined;
            }
            const onDocMouseDown = (event: MouseEvent): void => {
                const target = event.target as Node;
                if (
                    !popoverRef.current?.contains(target) &&
                    target !== inputRef.current
                ) {
                    setOpen(false);
                }
            };
            const onDocKeyDown = (event: KeyboardEvent): void => {
                if (event.key === "Escape") {
                    setOpen(false);
                    inputRef.current?.focus();
                }
            };
            document.addEventListener("mousedown", onDocMouseDown);
            document.addEventListener("keydown", onDocKeyDown);
            return () => {
                document.removeEventListener("mousedown", onDocMouseDown);
                document.removeEventListener("keydown", onDocKeyDown);
            };
        }, [open]);

        const openCalendar = useCallback((): void => {
            if (disabled) {
                return;
            }
            // Anchor the visible month on the current selection each time it opens.
            setViewMonth((selected ?? moment()).clone().startOf("month"));
            setOpen(true);
        }, [disabled, selected]);

        const pick = useCallback(
            (day: moment.Moment): void => {
                onChange(day.format(WIRE_FORMAT));
                setOpen(false);
                inputRef.current?.focus();
            },
            [onChange],
        );

        const handleInputKeyDown = useCallback(
            (event: ReactKeyboardEvent<HTMLInputElement>): void => {
                if (
                    event.key === "Enter" ||
                    event.key === " " ||
                    event.key === "ArrowDown"
                ) {
                    event.preventDefault();
                    openCalendar();
                }
            },
            [openCalendar],
        );

        // Build the 6×7 day grid for `viewMonth`. Pikaday's default pads with
        // EMPTY cells (not adjacent-month days), so out-of-month slots are `null`.
        const grid = useMemo<Array<Array<moment.Moment | null>>>(() => {
            const firstOfMonth = viewMonth.clone().startOf("month");
            const gridStart = firstOfMonth.clone().startOf("week"); // locale-aware first day
            const leading = firstOfMonth.diff(gridStart, "days");
            const daysInMonth = viewMonth.daysInMonth();

            const cells: Array<moment.Moment | null> = [];
            for (let i = 0; i < leading; i += 1) {
                cells.push(null);
            }
            for (let d = 1; d <= daysInMonth; d += 1) {
                cells.push(firstOfMonth.clone().date(d));
            }
            while (cells.length < WEEKS * DAYS_PER_WEEK) {
                cells.push(null);
            }

            const weeks: Array<Array<moment.Moment | null>> = [];
            for (let w = 0; w < WEEKS; w += 1) {
                weeks.push(cells.slice(w * DAYS_PER_WEEK, (w + 1) * DAYS_PER_WEEK));
            }
            return weeks;
        }, [viewMonth]);

        // Locale- and first-day-aware weekday labels ("Su".."Sa" in en).
        const weekdayShort = useMemo(() => moment.weekdaysMin(true), []);
        const weekdayFull = useMemo(() => moment.weekdays(true), []);
        const today = moment();

        return (
            <>
                <input
                    ref={setInputRef}
                    type="text"
                    className={className}
                    name={name}
                    value={displayValue}
                    readOnly
                    disabled={disabled}
                    aria-label={ariaLabel}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    autoComplete="off"
                    onClick={openCalendar}
                    onKeyDown={handleInputKeyDown}
                />
                {open && (
                    <div
                        ref={popoverRef}
                        className="pika-single is-bound"
                        role="dialog"
                        aria-modal="false"
                        aria-label={ariaLabel}
                        /* Structural placement only (not a theme value): anchor the
                           absolutely-positioned Pikaday popover just below the field
                           within the `position: relative` `.dates > div`, mirroring
                           Pikaday's bound-mode inline positioning. Pikaday sets
                           `position: absolute` inline in bound mode (the
                           `.pika-single.is-bound` CSS rule is only a fallback that a
                           descendant-scoped `.pika-single` rule can override), so we
                           set it inline here to guarantee the popover overlays rather
                           than pushing sibling content in-flow. */
                        style={{ position: "absolute", top: "100%", left: 0 }}
                    >
                        <div className="pika-lendar">
                            <div className="pika-title">
                                <button
                                    type="button"
                                    className="pika-prev"
                                    aria-label={t("COMMON.PICKERDATE.PREV_MONTH", "Prev")}
                                    onClick={() =>
                                        setViewMonth((m) => m.clone().subtract(1, "month"))
                                    }
                                >
                                    {t("COMMON.PICKERDATE.PREV_MONTH", "Prev")}
                                </button>
                                <span className="pika-label">{viewMonth.format("MMMM")}</span>
                                <span className="pika-label">{viewMonth.format("YYYY")}</span>
                                <button
                                    type="button"
                                    className="pika-next"
                                    aria-label={t("COMMON.PICKERDATE.NEXT_MONTH", "Next")}
                                    onClick={() =>
                                        setViewMonth((m) => m.clone().add(1, "month"))
                                    }
                                >
                                    {t("COMMON.PICKERDATE.NEXT_MONTH", "Next")}
                                </button>
                            </div>
                            <table className="pika-table" role="grid">
                                <thead>
                                    <tr>
                                        {weekdayShort.map((wd, i) => (
                                            <th key={i} scope="col">
                                                <abbr title={weekdayFull[i]}>{wd}</abbr>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {grid.map((week, wi) => (
                                        <tr key={wi} className="pika-row">
                                            {week.map((day, di) => {
                                                if (!day) {
                                                    return <td key={di} className="is-empty" />;
                                                }
                                                const isToday = day.isSame(today, "day");
                                                const isSelected =
                                                    selected != null && day.isSame(selected, "day");
                                                const tdClass = [
                                                    isToday ? "is-today" : "",
                                                    isSelected ? "is-selected" : "",
                                                ]
                                                    .filter(Boolean)
                                                    .join(" ");
                                                return (
                                                    <td key={di} className={tdClass || undefined}>
                                                        <button
                                                            type="button"
                                                            className="pika-button"
                                                            data-day={day.date()}
                                                            aria-label={day.format(DISPLAY_FORMAT)}
                                                            aria-selected={isSelected}
                                                            onClick={() => pick(day)}
                                                        >
                                                            {day.date()}
                                                        </button>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </>
        );
    },
);

export default DatePicker;
