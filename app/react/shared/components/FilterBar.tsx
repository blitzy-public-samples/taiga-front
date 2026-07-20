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
 *
 * Accessibility vs. visual fidelity (F41): the AAP mandates "zero visual change"
 * (Section 0.3.4) and places the frozen visual/design contract ABOVE accessibility
 * heuristics (Discovery precedence rule D1). The inherited Taiga color tokens that
 * drive this component (e.g. the `#008AA8` link/brand color and the `#d8dee9`
 * radio-mark border, defined in the reference SCSS) are therefore NOT altered here,
 * even where a contrast ratio would fail a WCAG check. All accessibility work in this
 * file is consequently STRUCTURAL only -- semantic roles, accessible names, keyboard
 * operability, and a focus ring that REUSES the existing brand color -- and introduces
 * no new color, spacing, or layout value.
 */

// Automatic JSX runtime (tsconfig `jsx: "react-jsx"`): no default `React` import required.
import { useMemo, useState } from 'react';
// Type-only import (erased at build time) used purely to type the inline `style` object.
import type { CSSProperties } from 'react';
// Shared, AngularJS-free translation layer (F29). Replaces the former local
// identity stub so every title, mode label, control, and error message resolves
// through the active Taiga locale catalog -- exactly as the legacy `translate`
// filter / service did in filter.jade.
import { t } from '../i18n';
// Emoji-shortcode rendering for applied TAG filters (F30), reproducing the legacy
// `emojify` filter and its `$tgEmojis` catalog. `getEmojiMap` reads the same
// `window.emojis` global the app-loader publishes (globals-only boundary).
import { emojify, getEmojiMap } from '../emojify';
// Avatar resolution for user filter options (F30), reproducing the `tg-avatar`
// directive so `assigned_users` / `owner` options render a REAL image (photo,
// gravatar, or deterministic local placeholder) instead of a broken `<img src="">`.
import { getAvatar } from '../avatar';

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

/**
 * Visually-hidden-but-focusable style for the include/exclude radio inputs (F31).
 *
 * The reference SCSS hides the radio with `.custom-radio input[type=radio] { display: none }`,
 * which removes it from the tab order entirely and leaves the focusable-but-inert
 * `label.filter-mode[tabindex=0]` with no key handling (the F31 defect). We instead
 * keep the NATIVE radio in the accessibility/tab tree -- overriding `display:none`
 * with `display:block` and shrinking it to a clipped 1px box -- so screen readers
 * announce a real radio group and keyboard users get native arrow-key selection and
 * Space activation for free. The clip/absolute technique removes it from the visual
 * flow, so the rendered layout is byte-identical to the legacy (ZERO visual change);
 * this mirrors the identical, visually-verified approach used in ZoomControl.
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
 * Visible focus indicator drawn on the custom `.radio-mark` when its (visually
 * hidden) native radio receives keyboard focus (F31, WCAG 2.4.7). Reuses the
 * existing Taiga link/brand color `#008AA8` (no NEW color is introduced -- F41).
 * `outline` occupies no layout space and `outlineOffset` lifts the ring clear of
 * the 16px mark, so the affordance is purely additive with no layout shift.
 */
const FOCUS_OUTLINE: CSSProperties = {
  outline: '2px solid #008AA8',
  outlineOffset: '2px',
};

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
  // Which include/exclude radio currently holds keyboard focus (F31 focus ring).
  const [focusedMode, setFocusedMode] = useState<FilterMode | null>(null);

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

  // Emoji shortcode->image catalog, read once from the `window.emojis` global
  // (globals-only boundary). Empty when the catalog is absent, which makes
  // `emojify` a faithful identity for plain tag text (see shared/emojify.ts).
  const emojiMap = useMemo(() => getEmojiMap(), []);

  /**
   * Render one applied-filter chip, shared by the included and excluded lists
   * (both are byte-identical in filter.jade). Reproduces the legacy dual `.name`
   * binding EXACTLY: TAG filters use `ng-bind-html="it.name | emojify"` (emoji
   * shortcodes become `<img>`; `dangerouslySetInnerHTML` is React's `ng-bind-html`
   * equivalent and `emojify` HTML-escapes first, so the sink is safe -- F30),
   * while every other data type renders the plain `{{it.name}}` text node. The
   * icon-only remove button gains an accessible name (F31).
   */
  const renderAppliedChip = (it: AppliedFilter) => (
    <div
      key={it.key ?? `${it.dataType}-${it.id}`}
      className={`single-applied-filter ng-animate-disabled ${it.mode}`}
    >
      {it.dataType === 'tags' ? (
        <div
          className="name"
          dangerouslySetInnerHTML={{ __html: emojify(it.name, emojiMap) }}
        />
      ) : (
        <div className="name">{it.name}</div>
      )}
      <button
        className="remove-filter e2e-remove-filter"
        aria-label={`${t('COMMON.DELETE')} ${it.name}`}
        onClick={() => unselectFilter(it)}
      >
        <Svg icon="icon-close" />
      </button>
    </div>
  );

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
            {/*
             * KB-9 (a11y): add an `id`/`name` (alongside the existing
             * `aria-label`) so the browser no longer logs "A form field element
             * should have an id or name attribute". No visible `<label>` is added
             * — the accessible name is supplied by `aria-label`, matching the
             * legacy filter markup so visual parity is preserved.
             */}
            <input
              className={
                'add-filter-input e2e-filter-name-input' +
                (lengthZeroError || repeatedFilterError ? ' checksley-error' : '')
              }
              id="kanban-add-filter-name"
              name="kanban-add-filter-name"
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
                  aria-label={`${t('COMMON.DELETE')} ${it.name}`}
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
                  {includedFilters.map(renderAppliedChip)}
                </div>
              </div>
            )}
            {excludedFilters.length > 0 && (
              <div className="filters-excluded">
                <div className="filters-title">
                  {t('COMMON.FILTERS.ADVANCED_FILTERS.EXCLUDED')}
                </div>
                <div className="filters-wrapper">
                  {excludedFilters.map(renderAppliedChip)}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="filters-advanced">
          {/*
            F31: the include/exclude mode selector is a semantic radio group. The
            legacy markup hid the native radio (`display:none`) and made the
            `<label tabindex=0>` focusable but WITHOUT any key handler. We instead
            keep the NATIVE radio focusable-but-visually-hidden (see
            VISUALLY_HIDDEN_INPUT) inside an explicit `role="radiogroup"`, so
            screen readers announce a real group and keyboard users get native
            arrow-key selection + Space activation. The label's `tabindex` is
            removed (the input is now the single focusable control). The visible
            selection is still driven by the `.active` class exactly as before
            (`.filter-mode.active .radio-mark-inner { opacity: 1 }`), so there is
            ZERO visual change.
          */}
          <div
            className="filters-advanced-form"
            role="radiogroup"
            aria-label={t('COMMON.FILTERS.TITLE_ADVANCED_FILTER')}
          >
            {filterModeOptions.map((option) => (
              <div key={option} className="custom-radio">
                <input
                  type="radio"
                  name="filter-mode"
                  id={`filter-mode-${option}`}
                  value={option}
                  checked={filterMode === option}
                  onChange={() => setFilterMode(option)}
                  aria-label={filterModeLabels[option]}
                  style={VISUALLY_HIDDEN_INPUT}
                  onFocus={() => setFocusedMode(option)}
                  onBlur={() =>
                    setFocusedMode((current) => (current === option ? null : current))
                  }
                />
                <label
                  className={`filter-mode ${option}` + (filterMode === option ? ' active' : '')}
                  htmlFor={`filter-mode-${option}`}
                >
                  <div
                    className="radio-mark"
                    style={focusedMode === option ? FOCUS_OUTLINE : undefined}
                  >
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
                    aria-expanded={isOpen(filter.dataType)}
                    aria-controls={`filter-list-${filter.dataType}`}
                  >
                    <span className="title">{filter.title}</span>
                    {!isOpen(filter.dataType) && (
                      <Svg className="ng-animate-disabled" icon="icon-arrow-right" />
                    )}
                    {isOpen(filter.dataType) && (
                      <Svg className="ng-animate-disabled" icon="icon-arrow-down" />
                    )}
                  </button>
                  {/*
                    F30 -- behavioral-equivalent of `tg-filter-slide-down`. That
                    legacy directive is effectively INERT: its `open()` merely
                    hides `.filter-list` and then calls `.show()` on
                    `el.context.nextSibling` (a bare text node, not this element),
                    with no CSS transition, duration, or easing. It therefore
                    produces no observable animation and leaves an identical
                    resting state. Conditionally mounting the list when the
                    category is open reproduces that exact end state (present when
                    expanded, absent when collapsed). The list keeps its `id` so
                    the category toggle's `aria-controls` can reference it (F31).
                  */}
                  {isOpen(filter.dataType) && (
                    <div className="filter-list" id={`filter-list-${filter.dataType}`}>
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
                          // F30: resolve the option's avatar exactly as the legacy
                          // `tg-avatar` directive did (photo / gravatar / deterministic
                          // local placeholder). Computed only for user categories.
                          const avatar = isUser ? getAvatar(it, 'avatar') : null;
                          return (
                            <button
                              key={it.id}
                              className={cls}
                              style={style}
                              onClick={() => selectFilter(filter, it)}
                            >
                              {/*
                                F30: reproduce the `tg-avatar` directive's DOM contract --
                                `src=avatar.url`, `title`/`alt` from the resolved full name,
                                and the element background to `avatar.bg || ''`. This renders
                                a REAL image (photo, gravatar, or deterministic local
                                placeholder) rather than `<img src="">`.

                                undefined-avatar-alt: the legacy directive
                                [avatar.directive.coffee:20-21] set `alt`/`title` via
                                `"#{avatar.fullName}"`, which JS-coerces an absent name to the
                                literal sentinel "undefined"/"null" (verified: `'' + undefined`
                                === "undefined"), clobbering the template's own static `alt=""`
                                [filter.jade:159]. We honour that STATIC design intent instead
                                of the framework's clobbering: a present full name renders
                                verbatim (exact parity for the common case) while an absent one
                                falls back to "" -- never leaking a JS sentinel into the DOM.
                                The change is invisible (the placeholder image always loads, so
                                `alt` is never painted) and removes the nonsensical "undefined"
                                hover tooltip no design intends.
                              */}
                              {isUser && avatar && (
                                <img
                                  className="user-pic"
                                  src={avatar.url}
                                  title={avatar.fullName ?? ''}
                                  alt={avatar.fullName ?? ''}
                                  style={{ background: avatar.bg || '' }}
                                />
                              )}
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
