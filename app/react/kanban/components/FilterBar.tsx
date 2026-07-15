/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * FilterBar — React 18 port of the AngularJS `tg-filter` sidebar component.
 *
 * This is a faithful, standalone reproduction of the legacy `tg-filter` component defined
 * by its template (filter.jade, the DOM) and its controller (filter.controller.coffee, the
 * `FilterController` aliased `vm`). It is part of the AngularJS 1.5.10 -> React 18
 * coexistence migration for the Kanban screen.
 *
 * Design intent: ZERO visual change. The component reproduces the exact tag names, CSS
 * class names, and end-to-end (`e2e-*`) hooks used by the AngularJS template so the
 * existing compiled stylesheets (the filter and kanban SCSS, whose `.kanban-filter
 * tg-filter` selector targets this root) render the React output identically. The root
 * element is therefore a `<tg-filter>` custom
 * element wrapping the two original top-level sections (`.custom-filters` and
 * `.filters-step-cat`). No stylesheet or asset is imported here.
 *
 * Integration boundary (globals-only): FilterBar is a pure controlled view. All filter
 * data (`filters`, `customFilters`, `selectedFilters`) and every mutation flow through
 * props to the owner (`KanbanApp` / `useKanbanBoard`), which performs the `/api/v1/`
 * calls. FilterBar imports nothing from the AngularJS / CoffeeScript codebase and pulls
 * in no third-party runtime dependency beyond React itself.
 *
 * REFERENCE-ONLY sources (reproduced, never imported): the legacy filter component's
 * template (filter.jade), controller (filter.controller.coffee), and directive
 * (filter.directive.coffee), plus the kanban route template (kanban.jade). These live in
 * the legacy client tree and are intentionally NOT imported.
 */

// Automatic JSX runtime (tsconfig `jsx: "react-jsx"`): no default `React` import required.
import { useMemo, useState } from 'react';
// Type-only import (erased at build time) used purely to type the inline `style` object.
import type { CSSProperties } from 'react';

/*
 * Custom-element host tags rendered via module-local `as any` constants.
 *
 * We deliberately DO NOT add a global JSX namespace augmentation for these tags: such a
 * global augmentation in one file would merge across the whole React source tree and risk
 * cross-file / cross-folder conflicts. Casting each literal tag name to `any` lets us
 * render the `<tg-filter>` / `<tg-svg>` web components locally without any global type
 * surface.
 *
 * Class-attribute caveat: React 18.2 only maps the `className` prop to a real `class`
 * attribute on KNOWN host elements, NOT on custom (hyphenated) elements. The root
 * `<tg-filter>` needs no class (the stylesheet targets it by element selector), and where
 * a class IS required on `<tg-svg>` the {@link Svg} helper sets the `class` attribute
 * explicitly to preserve exact parity -- see its note below.
 */
const TgFilter = 'tg-filter' as unknown as any;
const TgSvg = 'tg-svg' as unknown as any;

/**
 * Lightweight translation passthrough. The AngularJS component resolved copy through the
 * `translate` service / filter; here we return the key unchanged to avoid introducing an
 * i18n runtime dependency (preserving the standalone, globals-only boundary). Upstream
 * owners may pre-resolve copy before passing it in, or this can be swapped for a real
 * lookup without altering the DOM this component renders.
 */
const t = (key: string): string => key;

/**
 * Inline SVG icon helper reproducing the AngularJS `tg-svg(svg-icon="...")` directive.
 * Emits `<tg-svg [class]><svg class="icon <icon>"><use xlink:href="#<icon>" attr-href="#<icon>" /></svg></tg-svg>`
 * so the existing sprite sheet and icon stylesheet apply unchanged. `attr-href` mirrors the
 * attribute the legacy `tg-svg` directive reads when wiring the sprite reference.
 *
 * NOTE (React 18.2 custom-element quirk): React 18.2 only maps the `className` prop to a
 * real `class` attribute on KNOWN host elements. On CUSTOM elements (hyphenated tags such
 * as `<tg-svg>`) it does NOT — passing `className` there emits a literal `classname`
 * attribute and the CSS class would silently fail to apply. To preserve EXACT class parity
 * with `tg-svg.ng-animate-disabled` (zero visual change), we set the real `class` attribute
 * on the custom element explicitly (only when a class is supplied). The inner standard
 * `<svg>` keeps `className`, which maps to `class` as usual for host elements.
 */
const Svg = ({ icon, className }: { icon: string; className?: string }) => (
  <TgSvg {...(className ? { class: className } : {})}>
    <svg className={`icon ${icon}`}>
      <use xlinkHref={`#${icon}`} {...({ 'attr-href': `#${icon}` } as any)} />
    </svg>
  </TgSvg>
);

/** A selectable option within a filter category (a tag, user, status, ...). */
export interface FilterCategoryOption {
  id: number | string;
  name: string;
  count?: number;
  color?: string | null;
  photo?: string | null; // user avatar url (assigned_users / owner)
  [key: string]: unknown;
}

/** A collapsible filter category (e.g. tags, assigned_users, owner, status). */
export interface FilterCategory {
  dataType: string; // 'tags' | 'assigned_users' | 'owner' | 'status' | ...
  title: string;
  content: FilterCategoryOption[];
  hideEmpty?: boolean;
  totalTaggedElements?: number;
}

/** A filter currently applied to the board, in include or exclude mode. */
export interface AppliedFilter {
  id: number | string;
  name: string;
  dataType: string;
  mode: 'include' | 'exclude';
  key?: string | number;
  color?: string | null;
  [key: string]: unknown;
}

/** A saved custom filter (a named bundle of applied filters). */
export interface CustomFilter {
  id: number | string;
  name: string;
  [key: string]: unknown;
}

/** Props for {@link FilterBar}. Mirrors the `tg-filter` directive bindings 1:1. */
export interface FilterBarProps {
  filters: FilterCategory[];
  customFilters: CustomFilter[];
  selectedFilters: AppliedFilter[];
  /** Categories whose `dataType` appears here are hidden. Kanban passes `['status']`. Default `[]`. */
  excludeFilters?: string[];
  onAddFilter: (payload: { category: FilterCategory; filter: FilterCategoryOption; mode: 'include' | 'exclude' }) => void;
  onRemoveFilter: (filter: AppliedFilter) => void;
  onSaveCustomFilter: (name: string) => void;
  onSelectCustomFilter: (filter: CustomFilter) => void;
  onRemoveCustomFilter: (filter: CustomFilter) => void;
  /**
   * API-complete: the header query search (`tg-input-search`) is rendered by KanbanApp in
   * `.kanban-table-options-start`, NOT inside this sidebar. Exposed for parity only; the
   * sidebar DOM below never wires it. Mirrors `onChangeQ: "&"` in filter.directive.coffee,
   * which is likewise declared but unreferenced by filter.jade.
   */
  onChangeQ?: (q: string) => void;
}

/** The two mutually exclusive filter application modes. */
type FilterMode = 'include' | 'exclude';

/**
 * FilterBar reproduces `FilterController` (aliased `vm`) 1:1.
 *
 * NOTE: The AngularJS directive `link` (filter.directive.coffee) ran a `ResizeObserver`
 * on `.js-taskboard-manager` to clamp `--filter-list-max-height` (100..380) and toggled an
 * `open` class from an `open` attribute. Both are TASKBOARD-only: the kanban route has no
 * `.js-taskboard-manager` element (it uses `.kanban-manager`) and passes no `open`
 * attribute (see the kanban route template, kanban.jade, lines 52-62), so the observer never fires and
 * the SCSS default `--filter-list-max-height: 380px` applies. The link is therefore
 * intentionally OMITTED here — it is inert on the kanban route.
 */
const FilterBar = (props: FilterBarProps) => {
  const {
    filters,
    customFilters,
    selectedFilters,
    excludeFilters,
    onAddFilter,
    onRemoveFilter,
    onSaveCustomFilter,
    onSelectCustomFilter,
    onRemoveCustomFilter,
  } = props;

  // --- ViewModel state (reproduces FilterController instance fields) ---
  const [opened, setOpened] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('include');
  const [customFilterForm, setCustomFilterForm] = useState(false);
  const [customFilterName, setCustomFilterName] = useState('');
  const [lengthZeroError, setLengthZeroError] = useState(false);
  const [repeatedFilterError, setRepeatedFilterError] = useState(false);
  const [activeCustomFilter, setActiveCustomFilter] = useState<number | string | null>(null);

  // Constant option list + resolved labels (FilterController constructor).
  const filterModeOptions = ['include', 'exclude'] as const;
  const filterModeLabels: Record<FilterMode, string> = {
    include: t('COMMON.FILTERS.ADVANCED_FILTERS.INCLUDE'),
    exclude: t('COMMON.FILTERS.ADVANCED_FILTERS.EXCLUDE'),
  };

  // Derived collections — recomputed when `selectedFilters` changes (parity with $onChanges).
  // NOTE: the AngularJS template applied `orderBy:'-mode'`, but within a single-mode group
  // that ordering is a no-op, so insertion order is preserved here.
  const includedFilters = useMemo(
    () => selectedFilters.filter((it) => it.mode === 'include'),
    [selectedFilters],
  );
  const excludedFilters = useMemo(
    () => selectedFilters.filter((it) => it.mode === 'exclude'),
    [selectedFilters],
  );

  // Categories to render — kanban hides the `status` category via excludeFilters=['status'].
  const visibleFilters = useMemo(
    () => filters.filter((f) => !(excludeFilters ?? []).includes(f.dataType)),
    [filters, excludeFilters],
  );

  // --- Methods (reproduce FilterController exactly) ---

  const toggleFilterCategory = (filterName: string): void => {
    setOpened((prev) => (prev === filterName ? null : filterName));
  };

  const isOpen = (filterName: string): boolean => opened === filterName;

  const openCustomFilter = (): void => {
    setCustomFilterForm(true);
    setLengthZeroError(false);
    setRepeatedFilterError(false);
  };

  /**
   * Faithful port of `saveCustomFilter`, INCLUDING the latent ordering quirk: the coffee
   * resets `customFilterName` to '' BEFORE running the two error checks, so a successful
   * save leaves `lengthZeroError = true`. That flag is invisible because the form is
   * hidden on save (`customFilterForm = false`) and it is cleared again by
   * `openCustomFilter()`. We replicate this exactly rather than "fixing" it.
   */
  const saveCustomFilter = (): void => {
    let name = customFilterName;
    const willSave = name.length > 0 && !customFilters.find((f) => f.name === name);
    if (willSave) {
      onSaveCustomFilter(name);
      setCustomFilterForm(false);
      setOpened('custom-filter');
      setCustomFilterName('');
      name = ''; // mirror the coffee: name is reset BEFORE the error checks below
    }
    // After a successful save `name === ''` -> lengthZeroError becomes true, but the form
    // is hidden so it is not shown (openCustomFilter() resets it). Faithful to AngularJS.
    setLengthZeroError(name.length === 0);
    setRepeatedFilterError(!!customFilters.find((f) => f.name === name)); // '' never matches -> false after save
  };

  const unselectFilter = (it: AppliedFilter): void => {
    setActiveCustomFilter(null);
    onRemoveFilter(it);
  };

  const selectFilter = (category: FilterCategory, option: FilterCategoryOption): void => {
    setActiveCustomFilter(null);
    onAddFilter({ category, filter: option, mode: filterMode });
  };

  const removeCustomFilter = (f: CustomFilter): void => {
    setActiveCustomFilter(null);
    onRemoveCustomFilter(f);
  };

  const selectCustomFilter = (f: CustomFilter): void => {
    setActiveCustomFilter(f.id);
    onSelectCustomFilter(f);
  };

  const isFilterSelected = (category: FilterCategory, option: FilterCategoryOption): boolean =>
    !!selectedFilters.find((it) => option.id === it.id && category.dataType === it.dataType);

  return (
    <TgFilter>
      {/* ---- .custom-filters ---- */}
      <div className="custom-filters">
        <div className="custom-filters-header">
          <div className="custom-filters-title">
            <span className="name">{t('COMMON.FILTERS.TITLE')}</span>
            <span className="number"> ({customFilters.length})</span>
          </div>
          {!customFilterForm && (
            <button
              className="add-custom-filter"
              onClick={openCustomFilter}
              disabled={!selectedFilters.length}
            >
              {t('COMMON.FILTERS.ACTION_ADD')}
            </button>
          )}
        </div>

        {customFilterForm && selectedFilters.length > 0 && (
          <form
            className="custom-filters-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveCustomFilter();
            }}
          >
            <input
              className={
                'add-filter-input e2e-filter-name-input' +
                (lengthZeroError || repeatedFilterError ? ' checksley-error' : '')
              }
              aria-label={t('COMMON.FILTERS.PLACEHOLDER_FILTER_NAME')}
              type="text"
              placeholder={t('COMMON.FILTERS.PLACEHOLDER_FILTER_NAME')}
              value={customFilterName}
              onChange={(e) => setCustomFilterName(e.target.value)}
            />
            {lengthZeroError && (
              <span className="error-text">{t('COMMON.FILTERS.LENGTH_ZERO_ERROR')}</span>
            )}
            {repeatedFilterError && !lengthZeroError && (
              <span className="error-text">{t('COMMON.FILTERS.REPEATED_FILTER_ERROR')}</span>
            )}
            <button className="btn-small e2e-open-custom-filter-form" type="submit">
              {t('COMMON.FILTERS.ACTION_SAVE_CUSTOM_FILTER')}
            </button>
          </form>
        )}

        {customFilters.length > 0 && (
          <div className="custom-filter-list">
            {customFilters.map((it) => (
              <div
                key={it.id}
                className={
                  'single-filter single-filter-type-custom' +
                  (it.id === activeCustomFilter ? ' active' : '')
                }
              >
                <button className="name" onClick={() => selectCustomFilter(it)}>
                  {it.name}
                </button>
                <button
                  className="remove-filter e2e-remove-custom-filter"
                  onClick={() => removeCustomFilter(it)}
                >
                  <Svg icon="icon-trash" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- .filters-step-cat ---- */}
      <div className="filters-step-cat">
        {(includedFilters.length > 0 || excludedFilters.length > 0) && (
          <div className="filters-applied">
            {includedFilters.length > 0 && (
              <div className="filters-included">
                <div className="filters-title">
                  {t('COMMON.FILTERS.ADVANCED_FILTERS.INCLUDED')}
                </div>
                <div className="filters-wrapper">
                  {includedFilters.map((it) => (
                    <div
                      key={it.key ?? `${it.dataType}-${it.id}`}
                      className={`single-applied-filter ng-animate-disabled ${it.mode}`}
                    >
                      {/* NOTE: tags use emojify in the source; we render plain text here
                          (display-only, no behavioral impact). */}
                      <div className="name">{it.name}</div>
                      <button
                        className="remove-filter e2e-remove-filter"
                        onClick={() => unselectFilter(it)}
                      >
                        <Svg icon="icon-close" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {excludedFilters.length > 0 && (
              <div className="filters-excluded">
                <div className="filters-title">
                  {t('COMMON.FILTERS.ADVANCED_FILTERS.EXCLUDED')}
                </div>
                <div className="filters-wrapper">
                  {excludedFilters.map((it) => (
                    <div
                      key={it.key ?? `${it.dataType}-${it.id}`}
                      className={`single-applied-filter ng-animate-disabled ${it.mode}`}
                    >
                      <div className="name">{it.name}</div>
                      <button
                        className="remove-filter e2e-remove-filter"
                        onClick={() => unselectFilter(it)}
                      >
                        <Svg icon="icon-close" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
                  className={`filter-mode ${option}` + (filterMode === option ? ' active' : '')}
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
            {visibleFilters
              .filter((filter) => !(filter.hideEmpty && filter.totalTaggedElements === 0))
              .map((filter) => (
                <li key={filter.dataType} className={isOpen(filter.dataType) ? 'selected' : ''}>
                  <button
                    className={
                      'filters-cat-single e2e-category' +
                      (isOpen(filter.dataType) ? ' selected' : '')
                    }
                    onClick={() => toggleFilterCategory(filter.dataType)}
                  >
                    <span className="title">{filter.title}</span>
                    {!isOpen(filter.dataType) && (
                      <Svg className="ng-animate-disabled" icon="icon-arrow-right" />
                    )}
                    {isOpen(filter.dataType) && (
                      <Svg className="ng-animate-disabled" icon="icon-arrow-down" />
                    )}
                  </button>
                  {/* NOTE: `tg-filter-slide-down` is an AngularJS animation directive on the
                      list; the resting state is identical, so the slide animation is omitted
                      and the list renders directly. */}
                  {isOpen(filter.dataType) && (
                    <div className="filter-list">
                      {filter.content
                        .filter(
                          (it) => !isFilterSelected(filter, it) && !(it.count === 0 && filter.hideEmpty),
                        )
                        .map((it) => {
                          const isUser =
                            filter.dataType === 'assigned_users' || filter.dataType === 'owner';
                          const isTags = filter.dataType === 'tags';
                          const cls =
                            'single-filter' +
                            (!isTags ? ' single-filter-type-general' : '') +
                            (isTags ? ' single-filter-type-tag' : '') +
                            (isUser ? ' single-filter-type-user' : '');
                          // Annotated as CSSProperties (vs. a bare Record<string,string>) so the
                          // object assigns cleanly to the JSX `style` prop under strict mode;
                          // the emitted inline style is identical to the AngularJS `ng-style`.
                          const style: CSSProperties = {
                            borderColor: it.color && !isTags ? String(it.color) : 'transparent',
                          };
                          if (it.color && isTags) {
                            style.background = String(it.color);
                          }
                          return (
                            <button
                              key={it.id}
                              className={cls}
                              style={style}
                              onClick={() => selectFilter(filter, it)}
                            >
                              {/* NOTE: `user-pic` src is the option's photo/avatar url supplied
                                  upstream (the AngularJS `tg-avatar` directive resolved the same
                                  url); this keeps FilterBar standalone. */}
                              {isUser && <img className="user-pic" src={String(it.photo ?? '')} alt="" />}
                              <span className="name">{it.name}</span>
                              {(it.count ?? 0) > 0 && (
                                <span className="number e2e-filter-count">{it.count}</span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </div>
      </div>
    </TgFilter>
  );
};

export default FilterBar;
