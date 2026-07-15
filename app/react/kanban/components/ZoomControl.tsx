/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * ZoomControl — React port of the AngularJS kanban zoom selector.
 *
 * This component reproduces, pixel-for-pixel, the behaviour and DOM of the
 * legacy `tgKanbanBoardZoom` directive together with the `tgBoardZoom`
 * template it embedded. Both legacy artifacts are currently compiled into the
 * Angular-Elements bundle. Their sources live under the AngularJS components
 * tree (deliberately not linked here, to keep the React bundle free of any
 * legacy reference):
 *
 *   - the `kanban-board-zoom` directive (behaviour)
 *   - the `board-zoom` template (markup)
 *   - the `board-zoom` component styles (class names)
 *
 * Those sources are REFERENCE-ONLY: their behaviour and markup are reproduced
 * here but they are never imported. This preserves the "coexistence, not
 * rewrite" migration boundary (AngularJS 1.5.10 -> React 18) — everything
 * inside the React custom element is owned by React, and no AngularJS /
 * CoffeeScript module is pulled into the React bundle.
 *
 * Design contract (mirrors the directive exactly):
 *   - The four zoom "levels" map to CUMULATIVE arrays of card-feature flags.
 *     Selecting level N yields the concatenation of levels 0..N. `Board` /
 *     `Card` consume the resulting `zoom: string[]` (e.g. via
 *     `zoom.indexOf('subject') !== -1`) to decide which card details to draw.
 *   - `ZoomControl` owns only the selected index and its persistence to
 *     `localStorage` under the `kanban_zoom` key (the same key the legacy
 *     `$tgStorage` service used). It emits `(zoomLevel, zoom)` upward so the
 *     host (`KanbanApp`) can thread the resolved zoom into `<Board>`.
 *
 * Visual parity: the rendered markup uses the exact tag/class structure of
 * the `board-zoom` template, so the existing compiled board-zoom SCSS styles
 * this component with zero changes. In particular that SCSS relies on the
 * sibling selector `.zoom-radio input:checked ~ .checkmark` and hides the
 * radio with `.zoom-radio input { display: none }`, therefore the `<input>`
 * MUST be a preceding sibling of `.checkmark`, and the `<span>` MUST live
 * inside `.checkmark`. The unstyled `<tg-board-zoom>` custom-element wrapper
 * from the legacy template is intentionally NOT reproduced; we render only
 * `.board-zoom`.
 *
 * COLOR CONTRAST (F41): the review flagged the inherited Taiga colors on this
 * control as below WCAG AA contrast — the uppercase title (`.board-zoom-title`,
 * `#008AA8` on white ~4.04:1) and the selected pill's white label on the teal
 * `#008AA8` fill. Those values live ENTIRELY in the reference `board-zoom` SCSS
 * (`$color-link-primary`, `$color-white`, `$color-gray400`), which this
 * coexistence migration treats as REFERENCE-ONLY and must reproduce verbatim:
 * the AAP mandates "zero visual change" (Section 0.3.4), and its precedence
 * rules place the frozen design contract above accessibility heuristics. This
 * component therefore does NOT alter any inherited color/typography token —
 * doing so would change the shared Taiga theme for every other screen and
 * violate the migration's visual-parity guarantee. The contrast issue is a
 * pre-existing property of the Taiga design system and its remediation belongs
 * to a design-token change outside this migration's scope. All accessibility
 * work here is therefore STRUCTURAL (radiogroup semantics, focusable radios,
 * names, a visible focus ring) and introduces no new color (the focus ring
 * reuses the existing `#008AA8` brand value; see {@link FOCUS_OUTLINE}).
 *
 * NOTE ON JSX RUNTIME: this file relies on the automatic JSX runtime
 * (`tsconfig.json` -> `"jsx": "react-jsx"`), so React itself is not imported;
 * only the hooks are.
 */

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
// Shared, AngularJS-free translation layer (F27). Reads the same catalog the
// host installs via configureI18n(); falls back to the embedded English strings
// (ZOOM.TITLE, ZOOM.ZOOM-1..4) so rendered output is human-readable, never a raw
// key. This is a `shared/` sibling — NOT an AngularJS/CoffeeScript import — so
// the globals-only coexistence boundary is preserved.
import { t } from '../../shared/i18n';

/**
 * CUMULATIVE feature groups per zoom level, reproduced verbatim from the
 * legacy directive's `zooms` array
 * [kanban-board-zoom.directive.coffee:15-20]. Index 0 is the least-detailed
 * view; each higher index ADDS to the previous one.
 */
const ZOOMS: string[][] = [
  ['assigned_to', 'ref'],
  ['subject', 'card-data', 'assigned_to_extended'],
  ['tags', 'extra_info', 'unfold'],
  ['related_tasks', 'attachments'],
];

/**
 * The highest selectable zoom index. Derived from the legacy directive
 * (`scope.levels = 4` -> valid indices 0..3). Kept as a named constant so the
 * clamp and the rendered radio list stay in lock-step.
 */
const MAX_ZOOM_INDEX = ZOOMS.length - 1; // 3

/**
 * localStorage key. Identical to the `$tgStorage` key used by the legacy
 * directive (`storage.get/set("kanban_zoom", ...)`) so the React and AngularJS
 * screens share the same persisted preference across the coexistence boundary.
 */
const STORAGE_KEY = 'kanban_zoom';

/**
 * Default zoom level when nothing (valid) is persisted. Mirrors
 * `storage.get("kanban_zoom", 1)` from the legacy directive.
 */
const DEFAULT_ZOOM_INDEX = 1;

/**
 * Normalize a raw zoom value to a valid INTEGER level in `[0, MAX_ZOOM_INDEX]`
 * (F47).
 *
 * The legacy directive only clamped the upper bound (`if zoomIndex > 3 ->
 * zoomIndex = 3`) and never coerced fractions, so a corrupt/fractional persisted
 * value (e.g. `1.5`) left the control in an inconsistent state: no radio matched
 * (`checked` compares against integers 0..3) yet `getZoomView` still emitted a
 * partial cumulative feature list (`key <= 1.5` -> levels 0,1). This function
 * removes that gap deterministically:
 *   - non-finite input (`NaN`, `Infinity`) -> the default level, and
 *   - fractional input is truncated toward zero so it selects the same real
 *     radio the legacy cumulative logic effectively resolved to (`1.5` -> `1`,
 *     preserving the emitted feature list), then bounded into `[0, 3]`.
 * The lower-bound guard is a defensive superset (the UI only ever produces
 * 0..3) that protects against a corrupt/negative persisted value.
 */
function clamp(index: number): number {
  if (!Number.isFinite(index)) {
    return DEFAULT_ZOOM_INDEX;
  }
  const level = Math.trunc(index);
  if (level > MAX_ZOOM_INDEX) {
    return MAX_ZOOM_INDEX;
  }
  if (level < 0) {
    return 0;
  }
  return level;
}

/**
 * Resolve the initial zoom index.
 *
 * Mirrors `scope.zoomIndex = storage.get("kanban_zoom", 1)` from the legacy
 * directive: default to level 1 when nothing is persisted. An explicit
 * `initialZoom` prop (used by the host or by tests) overrides the persisted
 * value. Any value read is clamped so a stale/out-of-range entry still selects
 * a real radio.
 */
function readInitialZoom(override?: number): number {
  if (override != null) {
    return clamp(override);
  }

  const raw = localStorage.getItem(STORAGE_KEY);

  // `storage.get("kanban_zoom", 1)` -> unset means the default level.
  if (raw == null || raw === '') {
    return DEFAULT_ZOOM_INDEX;
  }

  // `clamp` normalizes to an integer level and maps a non-finite/NaN parse
  // (e.g. a corrupt persisted value) to DEFAULT_ZOOM_INDEX (F47).
  return clamp(Number(raw));
}

/**
 * Compute the CUMULATIVE feature list for a given zoom index and persist the
 * (clamped) index when it differs from what is currently stored.
 *
 * Faithful re-implementation of the directive's `getZoomView`
 * [kanban-board-zoom.directive.coffee:22-35]:
 *   1. clamp `> 3` down to `3` (and, defensively, negatives up to `0`);
 *   2. coerce to a number;
 *   3. if `Number(storage.get("kanban_zoom")) !== idx` then persist `idx`;
 *   4. reduce the `zooms` groups, concatenating every group whose key
 *      (`0..3`) is `<= idx` — i.e. the cumulative union of levels `0..idx`.
 *
 * The legacy `_.reduce(...concat...)` call is inlined here as a plain loop so
 * the component pulls in no third-party utility dependency.
 */
function getZoomView(zoomIndex: number): string[] {
  const idx = clamp(Number(zoomIndex));

  // Persist only on change, matching `Number(storage.get(...)) != zoomIndex`.
  // `Number(null)` / `Number('')` both coerce to `0`, exactly as the legacy
  // `Number(storage.get("kanban_zoom"))` did for an unset key.
  if (Number(localStorage.getItem(STORAGE_KEY)) !== idx) {
    localStorage.setItem(STORAGE_KEY, String(idx));
  }

  const result: string[] = [];

  ZOOMS.forEach((group, key) => {
    if (key <= idx) {
      result.push(...group);
    }
  });

  return result;
}

/**
 * Props for {@link ZoomControl}.
 *
 * Mirrors the legacy directive's isolate scope (`onZoomChange: "&"`).
 */
export interface ZoomControlProps {
  /**
   * Invoked once on mount and again on every zoom change — reproducing the
   * directive's `scope.$watch('zoomIndex', ...)` which fired on init and on
   * each subsequent change. Receives the selected level and its cumulative
   * feature list.
   */
  onZoomChange: (zoomLevel: number, zoom: string[]) => void;

  /**
   * Optional initial zoom override. When omitted, the initial value is read
   * from `localStorage['kanban_zoom']` (falling back to level `1`).
   */
  initialZoom?: number;
}

/**
 * "Visually hidden" style for the real radio `<input>` (F28).
 *
 * The reference SCSS hides the radio with `.zoom-radio input { display: none }`,
 * which ALSO removes it from the keyboard tab order — the root accessibility
 * defect this finding addresses. Rather than reproduce that (accessibility-
 * hostile) rule, the radio is hidden with the standard "visually hidden"
 * technique: it stays in the DOM and in the tab order (so keyboard and
 * assistive-technology users can operate it) but is clipped to a 1px box.
 *
 * `display` MUST be set to a value other than `none` here to OVERRIDE the SCSS
 * rule inline (otherwise the element would generate no box and could not receive
 * focus). Because the box is clipped to 1px and pulled out of flow, the rendered
 * layout is byte-for-byte identical to the legacy control — zero visual change
 * (F41). The visible pill is still driven entirely by the reference SCSS via the
 * `.zoom-radio input:checked ~ .checkmark` sibling selector, which continues to
 * match because the `<input>` remains the checkmark's preceding sibling.
 */
const VISUALLY_HIDDEN_INPUT: CSSProperties = {
  position: 'absolute',
  display: 'block',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
};

/**
 * Focus indicator mirrored onto the visible pill when its (visually hidden)
 * radio holds keyboard focus (F28 / WCAG 2.4.7 Focus Visible).
 *
 * There is NO focus treatment in the reference SCSS to reproduce, so this is a
 * purely ADDITIVE accessibility affordance — it introduces no new brand color:
 * it reuses the existing Taiga primary token value (`$color-link-primary` =
 * `#008AA8`, the same color the checked pill already uses). `outline` (unlike a
 * border) occupies no layout space, and `outlineOffset` lifts the ring off the
 * pill so it reads against both the unchecked (gray) and checked (teal) states,
 * so the control's size and position are unchanged (F41).
 */
const FOCUS_OUTLINE: CSSProperties = {
  outline: '2px solid #008AA8',
  outlineOffset: '2px',
};

/**
 * The kanban zoom selector: a title plus four radio "pills". The currently
 * selected pill expands (via the reference SCSS) to reveal its label.
 *
 * Accessibility (F28): the four radios form a NATIVE radio group (shared `name`)
 * wrapped in an explicit `role="radiogroup"` that is named by the visible title
 * via `aria-labelledby`. Because the radios are visually hidden but remain in
 * the tab order (see {@link VISUALLY_HIDDEN_INPUT}), keyboard users can Tab into
 * the group and use the arrow keys to move between and select zoom levels — the
 * standard native radio-group interaction — and the currently focused option is
 * indicated on the visible pill (see {@link FOCUS_OUTLINE}). Each option is
 * named for assistive technology with an `aria-label` sourced from the shared
 * translation layer.
 */
function ZoomControl({ onZoomChange, initialZoom }: ZoomControlProps) {
  const [zoomIndex, setZoomIndex] = useState<number>(() =>
    readInitialZoom(initialZoom),
  );

  // Which pill currently holds keyboard focus (null = none), used only to
  // mirror the visually-hidden radio's focus ring onto the visible pill (F28).
  const [focusedValue, setFocusedValue] = useState<number | null>(null);

  // Stable, unique id that binds the visible title to the radiogroup as its
  // accessible name via `aria-labelledby` (F28). `useId` guarantees uniqueness
  // even if more than one board mounts on a page.
  const titleId = useId();

  // Keep the latest `onZoomChange` in a ref so the emit effect can depend
  // solely on `[zoomIndex]` while still invoking the current callback. This
  // reproduces `$watch 'zoomIndex'` (fires on mount + each change) even when
  // the parent passes a freshly-created callback on every render, and it
  // prevents an emit -> re-render -> emit feedback loop.
  const onZoomChangeRef = useRef(onZoomChange);

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  });

  // Emit on mount and whenever the selected index changes. `getZoomView` also
  // persists the (clamped) index to localStorage, matching the directive.
  // IMPORTANT: `onZoomChange` is intentionally NOT in this dependency array —
  // it is read through the ref above.
  useEffect(() => {
    onZoomChangeRef.current(zoomIndex, getZoomView(zoomIndex));
  }, [zoomIndex]);

  return (
    <div className="board-zoom" role="radiogroup" aria-labelledby={titleId}>
      <div className="board-zoom-title" id={titleId}>
        {t('ZOOM.TITLE')}
      </div>

      {[0, 1, 2, 3].map((value) => {
        // Human-readable option label (e.g. "Compact"/"Default"/...). Sourced
        // from the shared translation layer so it is never a raw key (F27), and
        // reused as the visible pill text, the `title` tooltip, and the radio's
        // `aria-label` so screen readers announce a meaningful name (F28).
        const label = t(`ZOOM.ZOOM-${value + 1}`);

        return (
          <label key={value} className="zoom-radio" title={label}>
            {/*
              The <input> MUST precede .checkmark so the reference SCSS selector
              `.zoom-radio input:checked ~ .checkmark` matches. The radio is
              fully controlled: `checked` reflects state and `onChange` drives
              it. All four share `name="kanban-zoom"` so the browser treats them
              as ONE native radio group — restoring arrow-key navigation and
              selection between zoom levels (F28) — while still guaranteeing
              mutual exclusivity exactly as the legacy `ng-model="value"` did.
              It is visually hidden (not display:none) so it stays keyboard-
              focusable with zero visual change (F41), and `aria-label` names it
              for assistive technology.
            */}
            <input
              type="radio"
              name="kanban-zoom"
              value={value}
              aria-label={label}
              checked={zoomIndex === value}
              style={VISUALLY_HIDDEN_INPUT}
              onChange={() => setZoomIndex(value)}
              onFocus={() => setFocusedValue(value)}
              onBlur={() =>
                setFocusedValue((current) =>
                  current === value ? null : current,
                )
              }
            />
            <div
              className="checkmark"
              // Mirror the (visually hidden) radio's keyboard focus onto the
              // visible pill so focus is perceivable (F28 / WCAG 2.4.7). This is
              // an additive indicator drawn with `outline`, which occupies no
              // layout space, so the pill is visually unchanged otherwise (F41).
              style={focusedValue === value ? FOCUS_OUTLINE : undefined}
            >
              <span>{label}</span>
            </div>
          </label>
        );
      })}
    </div>
  );
}

export default ZoomControl;
