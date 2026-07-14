/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * KanbanHeader.tsx
 *
 * React 18.2 + TypeScript reproduction of the Kanban board `.taskboard-actions`
 * bar. This is a purely presentational, controlled leaf component owned by
 * `KanbanBoard.tsx`. It reproduces — byte-for-byte at the DOM/class level — the
 * markup that the AngularJS `KanbanController` renders through
 * `app/partials/kanban/kanban.jade` (L20-46), so the existing (unchanged) SCSS
 * (`app/styles/layout/kanban.scss`, `app/styles/components/buttons-next.scss`,
 * `app/modules/components/input-search/input-search.component.scss`) styles it
 * identically. No behavior, endpoint, or styling changes are introduced.
 *
 * The bar renders three legacy affordances:
 *   1. The filter-toggle button (`button.btn-filter.e2e-open-filter`).
 *   2. The search box (`tg-input-search`), reproducing the bindings and dirty
 *      tracking of `input-search.component.coffee` (`q:'<'`, `change:'&'`).
 *   3. The zoom control (`tg-board-zoom.board-zoom`), reproducing the radios of
 *      `board-zoom.jade`. This component ONLY renders the radios and reports the
 *      picked index upward via `onSetZoom`; the cumulative zoom feature map and
 *      the `kanban_zoom` localStorage persistence live in the `useKanbanStories`
 *      hook (as documented in `kanban-board-zoom.directive.coffee`), NOT here —
 *      this avoids double-ownership of the zoom state.
 *
 * SCOPE BOUNDARY: KanbanHeader renders ONLY `.taskboard-actions`. It does NOT
 * render the surrounding `.kanban-header`, the `mainTitle`, or the filter PANEL
 * (`.kanban-manager > .kanban-filter > tg-filter`) — those belong to
 * `KanbanBoard.tsx`.
 *
 * Migration notes (technology-specific changes vs. the AngularJS original):
 *   - Jade template -> JSX; CoffeeScript controller state -> React hooks.
 *   - AngularJS `ng-if`/`ng-class`/`ng-click`/`ng-model` -> React conditional
 *     rendering, computed className, `onClick`, and controlled inputs.
 *   - Visible text uses the English values from `app/locales/taiga/locale-en.json`
 *     so the rendered output matches the AngularJS `translate` output exactly
 *     (true visual parity), rather than placeholder literals.
 */

// jsx automatic runtime => NO `import React`. The type-only import provides the
// `React.*` types used by the `declare global` JSX augmentation and event typings.
import type * as React from "react";
import { useEffect, useState } from "react";

// M5: resolve visible text through the shared i18n resolver at RENDER time so
// the active-language bundle (loaded at runtime by `localeBridge.ts`) is used.
// These MUST be called inside the component (not at module scope) so a language
// switch re-renders the resolved strings.
import { t } from "../shared/i18n/translate";

/**
 * Custom-element JSX typing. AngularJS custom elements (`tg-*`) that this
 * component emits are unknown to React's intrinsic element table, so we augment
 * the global `JSX.IntrinsicElements` interface. The right-hand side is kept
 * byte-identical to the other kanban React files so the `declare global` blocks
 * merge cleanly across the bundle.
 */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "tg-svg": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
      "tg-input-search": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
      "tg-board-zoom": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

/**
 * Module-local `tg-svg` wrapper reproducing the AngularJS `tg-svg` directive
 * output: `<tg-svg><svg class="icon icon-<name>"><use xlink:href="#<name>"/></svg></tg-svg>`.
 * Kept verbatim/identical to the sibling kanban components (Card, Swimlane) so the
 * existing icon SCSS applies unchanged.
 */
function Icon(props: { name: string; className?: string; fill?: string; title?: string }) {
  const { name, className, fill, title } = props;
  // `class` (not `className`) is intentional: React 18 renders `className`
  // on a hyphenated custom element (`tg-svg`) as the literal `classname`
  // attribute, which would break the unchanged SCSS that styles the wrapper
  // (e.g. `.add-action`, `.fold-action`, `.default-swimlane-icon`). The
  // literal `class` prop is passed through verbatim as the real attribute.
  return (
    <tg-svg class={className}>
      <svg className={`icon ${name}`} style={fill ? { fill } : undefined}>
        <use xlinkHref={`#${name}`}>{title ? <title>{title}</title> : null}</use>
      </svg>
    </tg-svg>
  );
}

/**
 * The Kanban zoom radios (index 0..3) map to the `ZOOM.ZOOM-1..4` keys and the
 * title to `ZOOM.TITLE`; the filter/search affordances map to
 * `BACKLOG.FILTERS.{TITLE,HIDE_TITLE}` and
 * `COMMON.FILTERS.{INPUT_PLACEHOLDER,APPLIED_FILTERS_NUM}` — the EXACT keys the
 * legacy `kanban.jade` (L18-60) and `board-zoom.jade` referenced. They are
 * resolved via `t(...)` INSIDE the component render (M5) rather than captured in
 * module-scope constants, so a runtime language switch produces the correct
 * localized text instead of frozen English.
 */

/**
 * Props contract for {@link KanbanHeader}.
 *
 * The component is fully controlled: it owns no filter/zoom state itself and
 * mirrors the AngularJS bindings the legacy template used. The only internal
 * state is the debounced/dirty search text (see {@link KanbanHeader}), mirroring
 * `input-search.component.coffee`.
 */
export interface KanbanHeaderProps {
  /**
   * Whether the filter panel is open. Owned by `KanbanBoard.tsx` and shared with
   * the filter panel; mirrors `ctrl.openFilter`.
   */
  openFilter: boolean;
  /** Toggle handler for the filter panel; mirrors `ng-click="ctrl.openFilter = !ctrl.openFilter"`. */
  onToggleFilter: () => void;
  /** Number of applied filters; mirrors `ctrl.selectedFilters.length`. */
  selectedFiltersCount: number;

  /** Current search query pushed down from the controller; mirrors the `q:'<'` binding (`ctrl.filterQ`). */
  filterQ: string;
  /** Search change callback; mirrors the `change:'&'` binding (`ctrl.changeQ(q)`). */
  onChangeQ: (q: string) => void;

  /** Current zoom index (0..3) — the checked radio; mirrors the hook-owned `kanban_zoom`. */
  zoomLevel: number;
  /** Called with the picked zoom index (0..3) when a radio is selected. */
  onSetZoom: (index: number) => void;
}

/**
 * The Kanban board actions bar (`.taskboard-actions`).
 *
 * @param props - See {@link KanbanHeaderProps}.
 * @returns The `.taskboard-actions` element tree matching `kanban.jade` L20-46.
 */
export function KanbanHeader(props: KanbanHeaderProps) {
  const {
    openFilter,
    onToggleFilter,
    selectedFiltersCount,
    filterQ,
    onChangeQ,
    zoomLevel,
    onSetZoom,
  } = props;

  // --- Search internal logic (reproduces input-search.component.coffee) --------
  // `searchText` is the local, editable value shown in the input. `dirty` tracks
  // whether the user has typed since the last external `q` push. While NOT dirty
  // we keep the input synchronized with the incoming `filterQ` prop (the legacy
  // `$onChanges: if changes.q && !dirty => searchText = q`).
  const [searchText, setSearchText] = useState<string>(filterQ ?? "");
  const [dirty, setDirty] = useState<boolean>(false);

  useEffect(() => {
    if (!dirty) {
      setSearchText(filterQ ?? "");
    }
  }, [filterQ, dirty]);

  /** Mirrors the legacy `onChange(text)`: mark dirty, update local text, notify up. */
  function handleSearchChange(value: string): void {
    setDirty(true);
    setSearchText(value);
    onChangeQ(value);
  }

  // `btn-filter` + `e2e-open-filter` are always present; `active` is added only
  // while the filter panel is open (mirrors `ng-class="{active: ctrl.openFilter}"`).
  const filterButtonClassName = `btn-filter e2e-open-filter${openFilter ? " active" : ""}`;

  // M5: zoom radio labels resolved at render time (index 0..3 -> ZOOM.ZOOM-1..4),
  // so a runtime language switch localizes them. Order matches the four
  // `value="0".."3"` radios of the legacy `board-zoom.jade`.
  const zoomLabels: readonly string[] = [
    t("ZOOM.ZOOM-1"),
    t("ZOOM.ZOOM-2"),
    t("ZOOM.ZOOM-3"),
    t("ZOOM.ZOOM-4"),
  ];

  return (
    <div className="taskboard-actions">
      <div className="kanban-table-options-start">
        <button
          type="button"
          className={filterButtonClassName}
          title={`${selectedFiltersCount} ${t("COMMON.FILTERS.APPLIED_FILTERS_NUM")}`}
          onClick={onToggleFilter}
        >
          <Icon name="icon-filters" />
          {/*
            Legacy renders two mutually-exclusive `span.text` via ng-if; a single
            span whose content swaps on `openFilter` is DOM-equivalent for styling.
          */}
          <span className="text">{openFilter ? t("BACKLOG.FILTERS.HIDE_TITLE") : t("BACKLOG.FILTERS.TITLE")}</span>
          {selectedFiltersCount > 0 ? (
            <span className="selected-filters">{selectedFiltersCount}</span>
          ) : null}
        </button>

        {/*
          tg-input-search reproduction. The search icon MUST live inside
          `tg-input-search` as a `tg-svg` so the `tg-input-search tg-svg svg` SCSS
          (absolute-positioned icon) applies.
        */}
        <tg-input-search>
          <input
            type="search"
            placeholder={t("COMMON.FILTERS.INPUT_PLACEHOLDER")}
            aria-label={t("COMMON.FILTERS.INPUT_PLACEHOLDER")}
            value={searchText}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              handleSearchChange(event.target.value)
            }
          />
          <Icon name="icon-search" />
        </tg-input-search>
      </div>

      <div className="kanban-table-options-end">
        {/*
          Emit `<tg-board-zoom class="board-zoom">` directly (the element the
          Playwright spec targets via `$('tg-board-zoom')`). The 4 `.zoom-radio`
          labels are direct children, in ascending order, so the SCSS-driven
          layout — and therefore the pixel x-offsets a pixel-based click relies on
          — matches the AngularJS baseline exactly. Radio inputs are visually
          hidden by SCSS; `.checkmark` is the visible target.

          NOTE: React 18 does NOT map the `className` prop to the `class`
          attribute on custom elements (elements with a hyphen) — it would emit a
          literal `classname` attribute instead. We therefore set `class` directly
          so the existing `.board-zoom` SCSS applies (true visual parity). Standard
          elements below (`div`, `span`, `label`, `input`) correctly use
          `className`.
        */}
        <tg-board-zoom class="board-zoom">
          <div className="board-zoom-title">{t("ZOOM.TITLE")}</div>
          {zoomLabels.map((label, index) => (
            <label className="zoom-radio" key={index} title={label}>
              <input
                type="radio"
                name="kanban-zoom"
                value={index}
                aria-label={label}
                checked={zoomLevel === index}
                onChange={() => onSetZoom(index)}
              />
              <div className="checkmark">
                <span>{label}</span>
              </div>
            </label>
          ))}
        </tg-board-zoom>
      </div>
    </div>
  );
}
