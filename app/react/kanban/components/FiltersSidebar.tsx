/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * FiltersSidebar — Kanban filter panel (render + local view-state only).
 *
 * React 18 + TypeScript port of the AngularJS `<tg-filter>` component
 * (`app/modules/components/filter/filter.jade` + the `FilterController` in
 * `filter.controller.coffee`), as hosted by the Kanban board's filter drawer
 * (`app/partials/kanban/kanban.jade`, the `.kanban-filter > tg-filter(...)`
 * block). Part of the in-place AngularJS 1.5.10 -> React 18 migration; it
 * reproduces the legacy panel EXACTLY under the Minimal Change Clause (zero
 * feature change).
 *
 * SCOPE / BOUNDARY (see kanban.jade lines ~48-62):
 *  - This component renders ONLY the `<tg-filter>` body — i.e. the entire
 *    `filter.jade` template, whose two sibling roots `.custom-filters` and
 *    `.filters-step-cat` are returned here inside a Fragment, so NO extra
 *    wrapper element is introduced.
 *  - The search input (`tg-input-search`) and the filter-toggle button
 *    (`button.btn-filter`, the drawer open/close control) live in the KanbanApp
 *    HEADER, NOT here. The `.kanban-filter` wrapper and its `ng-if="openFilter"`
 *    gate are owned by KanbanApp, which mounts this component only while the
 *    drawer is open.
 *
 * DATA / STATE CONTRACT ("props down, events up"):
 *  - Purely presentational + local view state. It performs NO data fetching,
 *    NO API/WebSocket calls, and NO `generateFilters` work. The `filters`
 *    array (categories carrying `content`/`count`/`hideEmpty`/
 *    `totalTaggedElements`) is produced upstream by `../state/useKanbanBoard`
 *    from `/userstories/filters_data` and passed in via props.
 *  - The ONLY state kept here is the exact local view state the source
 *    `FilterController` owned: the open category, the include/exclude radio
 *    mode, the custom-filter-form toggle, the typed custom-filter name, the two
 *    validation error flags, and the active custom filter. All are held via
 *    `useState` — component-local view state, never board/reducer/immer state.
 *  - Intent is emitted upward through the callback props; the KanbanApp
 *    container adapts each callback to the board reload + `filters_data`
 *    refresh (mirroring the `tg-filter` `&` bindings in kanban.jade).
 *
 * VISUAL FIDELITY:
 *  - Reuses the EXISTING SCSS class names VERBATIM (the shared filter styles
 *    plus `app/styles/modules/kanban/*` / `app/styles/layout/kanban.scss`) and
 *    every `e2e-*` hook the Playwright/e2e suites target. No `.scss` is
 *    imported, created, or rewritten.
 *
 * TOOLCHAIN: React 18.2.0 / TypeScript 5.4.5 under `strict` + `isolatedModules`,
 * JSX automatic runtime (`jsx: "react-jsx"`) — so there is intentionally no
 * `import React` statement; only the hooks in use and type-only imports are
 * imported. Kept Node v16.19.1 compatible.
 */

import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { FilterOption } from '../../shared/types';

/**
 * A processed filter category as emitted by `generateFilters`
 * (`kanban/main.coffee`) and consumed by the `.filters-cats` list. `dataType`
 * is the facet key (e.g. `"status"`, `"tags"`, `"assigned_users"`, `"owner"`);
 * `title` is the already-translated section heading; `content` is the list of
 * selectable options. `hideEmpty` + `totalTaggedElements` drive the
 * empty-category skip rule. Declared locally because `shared/types` does not
 * export this derived display shape.
 */
export interface FilterCategory {
  dataType: string;
  title: string;
  content: FilterOption[];
  hideEmpty?: boolean;
  totalTaggedElements?: number;
}

/**
 * A currently-applied filter (the shape pushed into the board's
 * `selectedFilters`). `mode` selects the include/exclude bucket; `key` is the
 * legacy `track by it.key` identity, used as a stable React key when present.
 */
export interface SelectedFilter {
  id: number | null;
  key?: string;
  name: string;
  mode: 'include' | 'exclude';
  dataType: string;
  color?: string | null;
}

/**
 * A saved custom filter (id + name) as listed in `.custom-filter-list`.
 */
export interface CustomFilter {
  id: number | string;
  name: string;
}

/**
 * Props for {@link FiltersSidebar}. The three data props mirror the
 * `<tg-filter>` one-way inputs (`filters`, `custom-filters`,
 * `selected-filters`); the five callbacks mirror its `&` output bindings in
 * kanban.jade: `on-add-filter` / `on-remove-filter` / `on-select-custom-filter`
 * / `on-remove-custom-filter` / `on-save-custom-filter`.
 */
export interface FiltersSidebarProps {
  filters: FilterCategory[];
  customFilters: CustomFilter[];
  selectedFilters: SelectedFilter[];
  onAddFilter: (filter: {
    category: FilterCategory;
    filter: FilterOption;
    mode: 'include' | 'exclude';
  }) => void;
  onRemoveFilter: (filter: SelectedFilter) => void;
  onSelectCustomFilter: (filter: CustomFilter) => void;
  onRemoveCustomFilter: (filter: CustomFilter) => void;
  onSaveCustomFilter: (name: string) => void;
}

/**
 * The two advanced-filter modes, in the source order. `as const` narrows the
 * element type to the `'include' | 'exclude'` union used throughout.
 */
const filterModeOptions = ['include', 'exclude'] as const;

/**
 * Human-readable labels for each mode
 * (COMMON.FILTERS.ADVANCED_FILTERS.INCLUDE / .EXCLUDE), resolved to their
 * shipped English strings.
 */
const filterModeLabels: Record<'include' | 'exclude', string> = {
  include: 'Include',
  exclude: 'Exclude',
};

/**
 * Render an inline SVG sprite icon, reproducing the legacy `tg-svg(svg-icon=…)`
 * output. The `icon <name>` class pair is what the existing SCSS targets, and
 * `<use xlinkHref="#<name>">` references the globally-loaded sprite sheet. The
 * optional extra class reproduces the template's `tg-svg.ng-animate-disabled`
 * modifier on the category arrows. The icon is decorative; ARIA is deliberately
 * kept identical to the source (this migration adds no new ARIA outside the
 * @dnd-kit board, per the AAP).
 */
function svgIcon(icon: string, className?: string): ReactElement {
  const cls = className ? `icon ${icon} ${className}` : `icon ${icon}`;
  return (
    <svg className={cls}>
      <use xlinkHref={`#${icon}`} />
    </svg>
  );
}

/**
 * Resolve the avatar URL for a user-facet option, reproducing the `tg-avatar`
 * fallback used by the card components: the option's own `photo` when present,
 * otherwise the version-prefixed default `/images/unnamed.png`. Gravatar /
 * murmurhash resolution is intentionally NOT reimplemented — the DOM is only an
 * `<img className="user-pic">`.
 */
function resolveAvatar(it: FilterOption): string {
  const photo = it.photo as string | null | undefined;
  const version = (window as unknown as { _version?: string })._version || '';
  return photo || `${version}/images/unnamed.png`;
}

/**
 * Reproduce the template's `orderBy:'-mode'` — a descending sort by the `mode`
 * string — without mutating the input. (Within a single bucket every entry
 * shares the same `mode`, so this is order-preserving there, exactly as the
 * legacy filter behaved.)
 */
function sortByModeDesc(list: SelectedFilter[]): SelectedFilter[] {
  return [...list].sort((a, b) => (a.mode < b.mode ? 1 : a.mode > b.mode ? -1 : 0));
}

/**
 * The Kanban filter panel. Receives the current `filters` / `customFilters` /
 * `selectedFilters` and renders the exact `filter.jade` DOM, holding only the
 * `FilterController`'s local view state and emitting intent through the callback
 * props.
 */
export function FiltersSidebar(props: FiltersSidebarProps): ReactElement {
  const {
    filters,
    customFilters,
    selectedFilters,
    onAddFilter,
    onRemoveFilter,
    onSelectCustomFilter,
    onRemoveCustomFilter,
    onSaveCustomFilter,
  } = props;

  // ---- Local view state (mirrors FilterController's instance fields) --------
  const [opened, setOpened] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'include' | 'exclude'>('include');
  const [customFilterForm, setCustomFilterForm] = useState<boolean>(false);
  const [customFilterName, setCustomFilterName] = useState<string>('');
  const [lengthZeroError, setLengthZeroError] = useState<boolean>(false);
  const [repeatedFilterError, setRepeatedFilterError] = useState<boolean>(false);
  const [activeCustomFilter, setActiveCustomFilter] = useState<number | string | null>(null);

  // ---- Derived, recomputed from selectedFilters (mirrors getIncluded/Excluded)
  const includedFilters = useMemo(
    () => selectedFilters.filter((f) => f.mode === 'include'),
    [selectedFilters],
  );
  const excludedFilters = useMemo(
    () => selectedFilters.filter((f) => f.mode === 'exclude'),
    [selectedFilters],
  );

  // ---- VM method ports (behaviour lifted from filter.controller.coffee) -----

  /** Open the given category, or close it if it is already open. */
  const toggleFilterCategory = (dataType: string): void => {
    setOpened(opened === dataType ? null : dataType);
  };

  /** Whether the given category is the currently-open one. */
  const isOpen = (dataType: string): boolean => opened === dataType;

  /** Reveal the "add custom filter" form and clear any prior validation error. */
  const openCustomFilter = (): void => {
    setCustomFilterForm(true);
    setLengthZeroError(false);
    setRepeatedFilterError(false);
  };

  /**
   * Save the typed custom filter, reproducing the source branching. `repeated`
   * is computed once against the current name (the React state value is stable
   * within this call, so — unlike the CoffeeScript original that mutated the
   * name mid-method — the subsequent error flags reflect the name the user
   * actually submitted): on a valid, non-duplicate name we emit
   * `onSaveCustomFilter`, close the form, open the `custom-filter` category and
   * clear the field; then the two error flags are set independently.
   */
  const saveCustomFilter = (): void => {
    const repeated = customFilters.some((f) => f.name === customFilterName);

    if (customFilterName.length > 0 && !repeated) {
      setLengthZeroError(false);
      setRepeatedFilterError(false);
      onSaveCustomFilter(customFilterName);
      setCustomFilterForm(false);
      setOpened('custom-filter');
      setCustomFilterName('');
    }

    setLengthZeroError(customFilterName.length === 0);
    setRepeatedFilterError(repeated);
  };

  /** Remove an applied filter and drop any active custom-filter highlight. */
  const unselectFilter = (it: SelectedFilter): void => {
    setActiveCustomFilter(null);
    onRemoveFilter(it);
  };

  /** Apply an option from a category, tagged with the current include/exclude mode. */
  const selectFilter = (category: FilterCategory, it: FilterOption): void => {
    setActiveCustomFilter(null);
    onAddFilter({ category, filter: it, mode: filterMode });
  };

  /** Delete a saved custom filter. */
  const removeCustomFilter = (it: CustomFilter): void => {
    setActiveCustomFilter(null);
    onRemoveCustomFilter(it);
  };

  /** Activate a saved custom filter (and remember which one is active). */
  const selectCustomFilter = (it: CustomFilter): void => {
    setActiveCustomFilter(it.id);
    onSelectCustomFilter(it);
  };

  /** Whether an option is already applied within its category. */
  const isFilterSelected = (category: FilterCategory, it: FilterOption): boolean =>
    selectedFilters.some((s) => s.id === it.id && s.dataType === category.dataType);

  return (
    <>
      <div className="custom-filters">
        <div className="custom-filters-header">
          <div className="custom-filters-title">
            {/* i18n: COMMON.FILTERS.TITLE */}
            <span className="name">Custom filters</span>
            {/* Parentheses are part of the label, matching `({{vm.customFilters.length}})`. */}
            <span className="number">({customFilters.length})</span>
          </div>
          {!customFilterForm ? (
            <button
              type="button"
              className="add-custom-filter"
              disabled={selectedFilters.length === 0}
              onClick={() => openCustomFilter()}
            >
              {/* i18n: COMMON.FILTERS.ACTION_ADD */}
              Add
            </button>
          ) : null}
        </div>

        {customFilterForm && selectedFilters.length > 0 ? (
          <form
            className="custom-filters-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveCustomFilter();
            }}
          >
            <input
              className={`add-filter-input e2e-filter-name-input${
                lengthZeroError || repeatedFilterError ? ' checksley-error' : ''
              }`}
              type="text"
              aria-label="Write the filter name and press enter"
              placeholder="Write the filter name and press enter"
              value={customFilterName}
              onChange={(e) => setCustomFilterName(e.target.value)}
            />

            {lengthZeroError ? (
              // i18n: COMMON.FILTERS.LENGTH_ZERO_ERROR
              <span className="error-text">Please add a filter name</span>
            ) : null}
            {repeatedFilterError && !lengthZeroError ? (
              // i18n: COMMON.FILTERS.REPEATED_FILTER_ERROR
              <span className="error-text">This filter name is already in use</span>
            ) : null}

            {/* i18n: COMMON.FILTERS.ACTION_SAVE_CUSTOM_FILTER */}
            <button type="submit" className="btn-small e2e-open-custom-filter-form">
              save filter
            </button>
          </form>
        ) : null}

        {customFilters.length > 0 ? (
          <div className="custom-filter-list">
            {customFilters.map((it) => (
              <div
                key={it.id}
                className={`single-filter single-filter-type-custom${
                  it.id === activeCustomFilter ? ' active' : ''
                }`}
              >
                <button type="button" className="name" onClick={() => selectCustomFilter(it)}>
                  {it.name}
                </button>
                <button
                  type="button"
                  className="remove-filter e2e-remove-custom-filter"
                  onClick={() => removeCustomFilter(it)}
                >
                  {svgIcon('icon-trash')}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="filters-step-cat">
        {includedFilters.length > 0 || excludedFilters.length > 0 ? (
          <div className="filters-applied">
            {includedFilters.length > 0 ? (
              <div className="filters-included">
                {/* i18n: COMMON.FILTERS.ADVANCED_FILTERS.INCLUDED */}
                <div className="filters-title">Filtered by:</div>
                <div className="filters-wrapper">
                  {sortByModeDesc(includedFilters).map((it) => (
                    <div
                      key={it.key ?? `${it.dataType}:${String(it.id)}`}
                      className={`single-applied-filter ng-animate-disabled ${it.mode}`}
                    >
                      {/* Tags used `emojify` in the source; the card components
                          downgraded that to plain text, so `{it.name}` is rendered
                          verbatim for every data type. */}
                      <div className="name">{it.name}</div>
                      <button
                        type="button"
                        className="remove-filter e2e-remove-filter"
                        onClick={() => unselectFilter(it)}
                      >
                        {svgIcon('icon-close')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {excludedFilters.length > 0 ? (
              <div className="filters-excluded">
                {/* i18n: COMMON.FILTERS.ADVANCED_FILTERS.EXCLUDED */}
                <div className="filters-title">Excluded:</div>
                <div className="filters-wrapper">
                  {sortByModeDesc(excludedFilters).map((it) => (
                    <div
                      key={it.key ?? `${it.dataType}:${String(it.id)}`}
                      className={`single-applied-filter ng-animate-disabled ${it.mode}`}
                    >
                      <div className="name">{it.name}</div>
                      <button
                        type="button"
                        className="remove-filter e2e-remove-filter"
                        onClick={() => unselectFilter(it)}
                      >
                        {svgIcon('icon-close')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="filters-advanced">
          <div className="filters-advanced-form">
            {filterModeOptions.map((option) => (
              <div key={option} className="custom-radio">
                <input
                  type="radio"
                  name="filter-mode"
                  id={`filter-mode-${option}`}
                  value={option}
                  checked={filterMode === option}
                  onChange={() => setFilterMode(option)}
                />
                <label
                  className={`filter-mode ${option}${filterMode === option ? ' active' : ''}`}
                  htmlFor={`filter-mode-${option}`}
                  tabIndex={0}
                >
                  <div className="radio-mark">
                    <div className={`radio-mark-inner ${option}`} />
                  </div>
                  <span>{filterModeLabels[option]}</span>
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="filters-cats">
          <ul>
            {filters.map((filter) => {
              // Skip a category that is explicitly empty-hidden with nothing tagged.
              if (filter.hideEmpty && filter.totalTaggedElements === 0) {
                return null;
              }

              const open = isOpen(filter.dataType);

              return (
                <li key={filter.dataType} className={open ? 'selected' : undefined}>
                  <button
                    type="button"
                    className={`filters-cat-single e2e-category${open ? ' selected' : ''}`}
                    onClick={() => toggleFilterCategory(filter.dataType)}
                  >
                    <span className="title">{filter.title}</span>
                    {open
                      ? svgIcon('icon-arrow-down', 'ng-animate-disabled')
                      : svgIcon('icon-arrow-right', 'ng-animate-disabled')}
                  </button>

                  {open ? (
                    <div className="filter-list">
                      {filter.content.map((it, index) => {
                        // Skip options already applied, or empty ones in a hide-empty category.
                        if (
                          isFilterSelected(filter, it) ||
                          (it.count === 0 && filter.hideEmpty)
                        ) {
                          return null;
                        }

                        const isUser =
                          filter.dataType === 'assigned_users' || filter.dataType === 'owner';

                        // Reproduce the source ng-class exactly: a user category is
                        // BOTH `single-filter-type-general` (dataType !== 'tags') AND
                        // `single-filter-type-user`.
                        const classes = ['single-filter'];
                        if (filter.dataType !== 'tags') {
                          classes.push('single-filter-type-general');
                        }
                        if (filter.dataType === 'tags') {
                          classes.push('single-filter-type-tag');
                        }
                        if (isUser) {
                          classes.push('single-filter-type-user');
                        }

                        return (
                          <button
                            key={`${filter.dataType}-${String(it.id)}-${index}`}
                            type="button"
                            className={classes.join(' ')}
                            onClick={() => selectFilter(filter, it)}
                            style={{
                              borderColor:
                                it.color && filter.dataType !== 'tags' ? it.color : 'transparent',
                              background:
                                it.color && filter.dataType === 'tags' ? it.color : undefined,
                            }}
                          >
                            {isUser ? (
                              <img className="user-pic" src={resolveAvatar(it)} alt="" />
                            ) : null}
                            <span className="name">{it.name}</span>
                            {it.count > 0 ? (
                              <span className="number e2e-filter-count">{it.count}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
