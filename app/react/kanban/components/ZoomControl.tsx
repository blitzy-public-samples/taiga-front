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
 * NOTE ON JSX RUNTIME: this file relies on the automatic JSX runtime
 * (`tsconfig.json` -> `"jsx": "react-jsx"`), so React itself is not imported;
 * only the hooks are.
 */

import { useEffect, useRef, useState } from 'react';

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
 * Clamp a zoom index into the valid `[0, MAX_ZOOM_INDEX]` range.
 *
 * The legacy directive only clamped the upper bound (`if zoomIndex > 3 ->
 * zoomIndex = 3`); the lower-bound guard is a defensive superset that can
 * never change observable behaviour because the UI only ever produces indices
 * 0..3, while protecting against a corrupt/negative persisted value.
 */
function clamp(index: number): number {
  if (index > MAX_ZOOM_INDEX) {
    return MAX_ZOOM_INDEX;
  }
  if (index < 0) {
    return 0;
  }
  return index;
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

  // `storage.get("kanban_zoom", 1)` -> unset means the default level 1.
  if (raw == null || raw === '') {
    return 1;
  }

  const parsed = Number(raw);

  return Number.isNaN(parsed) ? 1 : clamp(parsed);
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
 * Translation passthrough.
 *
 * The legacy template rendered `{{ 'ZOOM.TITLE' | translate }}` via the
 * AngularJS translate filter. To honour the "globals-only boundary / no i18n
 * dependency" rule this standalone component does not embed an i18n library;
 * it returns the translation key unchanged. The host application's i18n layer
 * is responsible for supplying the human-readable strings when the migrated
 * screen is wired up, keeping this component dependency-free and its output
 * deterministic for unit tests.
 *
 * Recognised keys: `ZOOM.TITLE`, `ZOOM.ZOOM-1`, `ZOOM.ZOOM-2`, `ZOOM.ZOOM-3`,
 * `ZOOM.ZOOM-4`.
 */
function t(key: string): string {
  return key;
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
 * The kanban zoom selector: a title plus four radio "pills". The currently
 * selected pill expands (via the reference SCSS) to reveal its label.
 */
function ZoomControl({ onZoomChange, initialZoom }: ZoomControlProps) {
  const [zoomIndex, setZoomIndex] = useState<number>(() =>
    readInitialZoom(initialZoom),
  );

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
    <div className="board-zoom">
      <div className="board-zoom-title">{t('ZOOM.TITLE')}</div>

      {[0, 1, 2, 3].map((value) => (
        <label
          key={value}
          className="zoom-radio"
          title={t(`ZOOM.ZOOM-${value + 1}`)}
        >
          {/*
            The <input> MUST precede .checkmark so the reference SCSS selector
            `.zoom-radio input:checked ~ .checkmark` matches. The radio is
            fully controlled: `checked` reflects state and `onChange` drives it
            (no `name` attribute — mutual exclusivity is guaranteed by state,
            exactly as the legacy `ng-model="value"` binding behaved).
          */}
          <input
            type="radio"
            value={value}
            checked={zoomIndex === value}
            onChange={() => setZoomIndex(value)}
          />
          <div className="checkmark">
            <span>{t(`ZOOM.ZOOM-${value + 1}`)}</span>
          </div>
        </label>
      ))}
    </div>
  );
}

export default ZoomControl;
