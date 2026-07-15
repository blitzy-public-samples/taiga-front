/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * FilterBar.test.tsx — Jest + React Testing Library unit spec for the React port of the
 * AngularJS `tg-filter` sidebar (`../components/FilterBar`). Part of the AngularJS 1.5.10
 * -> React 18 coexistence migration for the Kanban screen; these specs count toward the
 * >=70% line-coverage gate over `app/react/**`.
 *
 * Test philosophy: FilterBar is a fully CONTROLLED view — all data (`filters`,
 * `customFilters`, `selectedFilters`) and every mutation flow through props. We therefore
 * drive it entirely with deterministic fixture props + `jest.fn()` spies and assert on the
 * OBSERVABLE outcomes (rendered DOM, `e2e-*` hooks, and the callbacks fired), never on the
 * component's private state.
 *
 * Isolation (hard requirements): jsdom only — NO Playwright, NO browser, NO network. We
 * import ONLY the module under test and the testing libraries; we never reach into the
 * legacy AngularJS / CoffeeScript source trees, their Jade partials or SCSS stylesheets, nor
 * the compiled Angular-Elements bundle. The behavioral origin (the legacy FilterController)
 * and the DOM origin (the legacy tg-filter template) are reproduced from memory here, never
 * imported.
 */

// Automatic JSX runtime (tsconfig `jsx: "react-jsx"`): no default `React` import required.
// `jest` is provided as a global by the Jest runtime — it is intentionally NOT imported.
import { render, screen, fireEvent, within } from '@testing-library/react';

import FilterBar from '../components/FilterBar';
import type {
  FilterCategory,
  FilterCategoryOption,
  AppliedFilter,
  CustomFilter,
  FilterBarProps,
} from '../components/FilterBar';

/* ------------------------------------------------------------------------------------------
 * Small DOM query helpers — typed so strict-mode TS never trips on `Element | null`.
 * ---------------------------------------------------------------------------------------- */

/** querySelector that returns a typed `HTMLElement` and throws a helpful error when missing. */
function qs(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector(selector);
  if (!el) {
    throw new Error(`Expected to find element matching "${selector}" but found none.`);
  }
  return el as HTMLElement;
}

/** querySelectorAll returning a real array of typed `HTMLElement`s. */
function qsa(root: ParentNode, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector)) as HTMLElement[];
}

/**
 * Locate a `.filters-cat-single.e2e-category` button by the visible label in its `.title`
 * span (mirrors how a user recognises a category). Throws when no category matches.
 */
function getCategoryButton(container: HTMLElement, title: string): HTMLElement {
  const button = qsa(container, 'button.e2e-category').find(
    (b) => b.querySelector('.title')?.textContent === title,
  );
  if (!button) {
    throw new Error(`Expected a category button titled "${title}" but found none.`);
  }
  return button;
}

/** Return the `.filter-list` element belonging to a given category button (its `<li>`). */
function getFilterListFor(categoryButton: HTMLElement): HTMLElement | null {
  const li = categoryButton.closest('li');
  return li ? (li.querySelector('.filter-list') as HTMLElement | null) : null;
}

/* ------------------------------------------------------------------------------------------
 * Deterministic, typed fixtures.
 *
 * `status` is EXCLUDED on the kanban screen (excludeFilters=['status']); its applied "New"
 * filter still renders under .filters-included (the applied list is independent of the
 * category list). `tags` exercises a selected option ("bug", hidden) vs an unselected empty
 * option ("ui", shown because `tags` has no hideEmpty). `assigned_users` exercises the user
 * option branch (avatar + count badge). `epic` is a whole-category SKIP case
 * (hideEmpty && totalTaggedElements === 0).
 * ---------------------------------------------------------------------------------------- */

const filters: FilterCategory[] = [
  { dataType: 'status', title: 'Status', content: [{ id: 1, name: 'New', count: 2 }] }, // EXCLUDED on kanban
  {
    dataType: 'tags',
    title: 'Tags',
    content: [
      { id: 'bug', name: 'bug', count: 3, color: '#ff0000' },
      { id: 'ui', name: 'ui', count: 0, color: '#00ff00' },
    ],
  },
  {
    dataType: 'assigned_users',
    title: 'Assigned',
    content: [{ id: 7, name: 'Alice', count: 1, photo: 'alice.png' }],
  },
  {
    dataType: 'epic',
    title: 'Epics',
    content: [{ id: 5, name: 'Epic1', count: 0 }],
    hideEmpty: true,
    totalTaggedElements: 0,
  }, // whole category SKIPPED
];

const customFilters: CustomFilter[] = [{ id: 100, name: 'MyFilter' }];

const selectedFilters: AppliedFilter[] = [
  { id: 1, name: 'New', dataType: 'status', mode: 'include', key: 'status-1' },
  { id: 'bug', name: 'bug', dataType: 'tags', mode: 'exclude', key: 'tags-bug' },
];

/** The full set of spy callbacks a FilterBar render is wired with. */
interface FilterBarSpies {
  onAddFilter: jest.Mock;
  onRemoveFilter: jest.Mock;
  onSaveCustomFilter: jest.Mock;
  onSelectCustomFilter: jest.Mock;
  onRemoveCustomFilter: jest.Mock;
  onChangeQ: jest.Mock;
}

/**
 * Render `<FilterBar>` with the fixtures above and fresh `jest.fn()` spies for every
 * callback. `excludeFilters` defaults to `['status']` (the kanban configuration). Data
 * overrides are merged AFTER the spies so callers can swap `selectedFilters`,
 * `excludeFilters`, etc. without clobbering the spies they need to assert on. Fresh spies are
 * created on every call so assertions are always isolated (independent of `clearMocks`).
 */
function renderBar(overrides: Partial<FilterBarProps> = {}) {
  const spies: FilterBarSpies = {
    onAddFilter: jest.fn(),
    onRemoveFilter: jest.fn(),
    onSaveCustomFilter: jest.fn(),
    onSelectCustomFilter: jest.fn(),
    onRemoveCustomFilter: jest.fn(),
    onChangeQ: jest.fn(),
  };

  const props: FilterBarProps = {
    filters,
    customFilters,
    selectedFilters,
    excludeFilters: ['status'],
    onAddFilter: spies.onAddFilter,
    onRemoveFilter: spies.onRemoveFilter,
    onSaveCustomFilter: spies.onSaveCustomFilter,
    onSelectCustomFilter: spies.onSelectCustomFilter,
    onRemoveCustomFilter: spies.onRemoveCustomFilter,
    onChangeQ: spies.onChangeQ,
    ...overrides,
  };

  const renderResult = render(<FilterBar {...props} />);
  return { ...renderResult, spies };
}

/* ==========================================================================================
 * Phase C — Root custom element + visual-parity structure
 * ======================================================================================== */

describe('FilterBar — root structure (Phase C)', () => {
  it('renders a <tg-filter> custom element wrapping .custom-filters and .filters-step-cat', () => {
    const { container } = renderBar();

    const tgFilter = container.querySelector('tg-filter');
    expect(tgFilter).toBeTruthy();
    expect(tgFilter!.querySelector('.custom-filters')).toBeTruthy();
    expect(tgFilter!.querySelector('.filters-step-cat')).toBeTruthy();
  });

  it('shows the custom-filters title count and the add-custom-filter button', () => {
    const { container } = renderBar();

    // One custom filter in the fixture -> the header count reads " (1)".
    const numberEl = qs(container, '.custom-filters-title .number');
    expect(numberEl.textContent).toContain('(1)');

    expect(container.querySelector('.add-custom-filter')).toBeTruthy();
  });

  it('renders category buttons carrying the "filters-cat-single e2e-category" classes', () => {
    const { container } = renderBar();

    // The category list lives under `.filters-cats > ul > li`.
    const listItems = qsa(container, '.filters-cats > ul > li');
    expect(listItems.length).toBeGreaterThan(0);

    const catButtons = qsa(container, '.filters-cat-single');
    expect(catButtons.length).toBeGreaterThan(0);
    catButtons.forEach((btn) => {
      expect(btn.classList.contains('filters-cat-single')).toBe(true);
      expect(btn.classList.contains('e2e-category')).toBe(true);
    });
  });
});

/* ==========================================================================================
 * Phase D — excludeFilters + empty-category hiding
 * ======================================================================================== */

describe('FilterBar — excludeFilters and empty-category hiding (Phase D)', () => {
  it('hides the "Status" category when excludeFilters=["status"], but still shows the applied Status filter', () => {
    const { container } = renderBar(); // default excludeFilters: ['status']

    const categoryTitles = qsa(container, '.filters-cat-single .title').map((el) => el.textContent);
    expect(categoryTitles).not.toContain('Status');

    // The applied "New" status filter is independent of the category list — it still renders.
    const included = qs(container, '.filters-included');
    expect(within(included).getByText('New')).toBeTruthy();
  });

  it('skips a whole category flagged hideEmpty with totalTaggedElements === 0 (the "epic" category)', () => {
    const { container } = renderBar();

    const categoryTitles = qsa(container, '.filters-cat-single .title').map((el) => el.textContent);
    expect(categoryTitles).not.toContain('Epics');
  });

  it('shows the "Status" category when excludeFilters=[] (exclusion is prop-driven)', () => {
    const { container } = renderBar({ excludeFilters: [] });

    const categoryTitles = qsa(container, '.filters-cat-single .title').map((el) => el.textContent);
    expect(categoryTitles).toContain('Status');
  });
});

/* ==========================================================================================
 * Phase E — Applied filters (included / excluded) + unselect
 * ======================================================================================== */

describe('FilterBar — applied filters (Phase E)', () => {
  it('renders included and excluded applied filters with the matching mode modifier class', () => {
    const { container } = renderBar();

    // Included section holds "New" (mode include).
    const includedSection = qs(container, '.filters-included');
    const includedItem = qs(includedSection, '.single-applied-filter');
    expect(includedItem.classList.contains('include')).toBe(true);
    expect(within(includedSection).getByText('New')).toBeTruthy();

    // Excluded section holds "bug" (mode exclude).
    const excludedSection = qs(container, '.filters-excluded');
    const excludedItem = qs(excludedSection, '.single-applied-filter');
    expect(excludedItem.classList.contains('exclude')).toBe(true);
    expect(within(excludedSection).getByText('bug')).toBeTruthy();
  });

  it('calls onRemoveFilter once with the applied filter object when its remove button is clicked', () => {
    const { container, spies } = renderBar();

    const includedSection = qs(container, '.filters-included');
    const removeButton = qs(includedSection, '.remove-filter.e2e-remove-filter');
    fireEvent.click(removeButton);

    expect(spies.onRemoveFilter).toHaveBeenCalledTimes(1);
    expect(spies.onRemoveFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, dataType: 'status', mode: 'include' }),
    );
  });

  it('calls onRemoveFilter with the excluded applied filter when its remove button is clicked', () => {
    const { container, spies } = renderBar();

    const excludedSection = qs(container, '.filters-excluded');
    const removeButton = qs(excludedSection, '.remove-filter.e2e-remove-filter');
    fireEvent.click(removeButton);

    expect(spies.onRemoveFilter).toHaveBeenCalledTimes(1);
    expect(spies.onRemoveFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bug', dataType: 'tags', mode: 'exclude' }),
    );
  });

  it('omits .filters-applied and disables add-custom-filter when there are no selected filters', () => {
    const { container } = renderBar({ selectedFilters: [] });

    expect(container.querySelector('.filters-applied')).toBeNull();

    const addButton = qs(container, '.add-custom-filter');
    expect(addButton).toBeDisabled();
  });

  it('enables the add-custom-filter button when selected filters are present', () => {
    const { container } = renderBar(); // default selectedFilters is non-empty

    const addButton = qs(container, '.add-custom-filter');
    expect(addButton).toBeEnabled();
  });
});

/* ==========================================================================================
 * Phase F — Category open/close + option selection + filter mode
 * ======================================================================================== */

describe('FilterBar — category open/close, option selection, and filter mode (Phase F)', () => {
  it('opens a category to reveal its options, rendering a user option with avatar and count badge', () => {
    const { container } = renderBar();

    const assignedButton = getCategoryButton(container, 'Assigned');
    fireEvent.click(assignedButton);

    const filterList = getFilterListFor(assignedButton);
    expect(filterList).toBeTruthy();

    const aliceOption = qs(filterList!, '.single-filter');
    expect(within(aliceOption).getByText('Alice')).toBeTruthy();
    // assigned_users -> user option class + avatar.
    expect(aliceOption.classList.contains('single-filter-type-user')).toBe(true);
    expect(aliceOption.querySelector('.user-pic')).toBeTruthy();
    // count === 1 (> 0) -> badge visible.
    const countBadge = qs(aliceOption, '.number.e2e-filter-count');
    expect(countBadge.textContent).toBe('1');
  });

  it('emits onAddFilter with the default "include" mode when an option is clicked', () => {
    const { container, spies } = renderBar();

    const assignedButton = getCategoryButton(container, 'Assigned');
    fireEvent.click(assignedButton);

    const filterList = getFilterListFor(assignedButton)!;
    const aliceButton = within(filterList).getByText('Alice').closest('button')!;
    fireEvent.click(aliceButton);

    expect(spies.onAddFilter).toHaveBeenCalledTimes(1);
    expect(spies.onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        category: expect.objectContaining({ dataType: 'assigned_users' }),
        filter: expect.objectContaining({ id: 7 }),
        mode: 'include',
      }),
    );
  });

  it('emits onAddFilter with "exclude" mode after the exclude radio is selected', () => {
    const { container, spies } = renderBar();

    // Selecting the exclude radio drives `filterMode` -> emitted mode.
    const excludeRadio = qs(container, 'input[value="exclude"]');
    fireEvent.click(excludeRadio);

    const assignedButton = getCategoryButton(container, 'Assigned');
    fireEvent.click(assignedButton);
    const filterList = getFilterListFor(assignedButton)!;
    const aliceButton = within(filterList).getByText('Alice').closest('button')!;
    fireEvent.click(aliceButton);

    expect(spies.onAddFilter).toHaveBeenCalledTimes(1);
    expect(spies.onAddFilter).toHaveBeenCalledWith(expect.objectContaining({ mode: 'exclude' }));
  });

  it('closes an open category when its button is clicked again', () => {
    const { container } = renderBar();

    const assignedButton = getCategoryButton(container, 'Assigned');

    fireEvent.click(assignedButton); // open
    expect(getFilterListFor(assignedButton)).toBeTruthy();
    expect(screen.queryByText('Alice')).toBeTruthy();

    fireEvent.click(assignedButton); // close (toggle)
    expect(getFilterListFor(assignedButton)).toBeNull();
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('hides an already-selected option while showing an unselected empty option (tags)', () => {
    const { container } = renderBar();

    const tagsButton = getCategoryButton(container, 'Tags');
    fireEvent.click(tagsButton);

    const filterList = getFilterListFor(tagsButton)!;
    // "bug" is selected (exclude) -> hidden from the option list. Scope the query to the
    // filter-list because "bug" ALSO renders in the .filters-excluded applied section.
    expect(within(filterList).queryByText('bug')).toBeNull();
    // "ui" is unselected; tags has no hideEmpty so a count of 0 does NOT hide it.
    expect(within(filterList).queryByText('ui')).toBeTruthy();
  });
});

/* ==========================================================================================
 * Phase G — Custom filter save flow (reproduces the controller quirk) + select / remove
 *
 * The AngularJS controller resets `customFilterName` to '' BEFORE the error-flag checks on a
 * successful save, so a valid save leaves the internal `lengthZeroError` true — invisible
 * because the form is hidden. We assert ONLY observable outcomes (callback fired / form
 * hidden / error text shown), never the private flag.
 * ======================================================================================== */

describe('FilterBar — custom filter save flow (Phase G)', () => {
  /** Open the add-custom-filter form and return the live form + input elements. */
  function openForm(container: HTMLElement): { form: HTMLFormElement; input: HTMLInputElement } {
    fireEvent.click(qs(container, '.add-custom-filter'));
    const form = qs(container, '.custom-filters-add-form') as HTMLFormElement;
    const input = qs(form, 'input.e2e-filter-name-input') as HTMLInputElement;
    return { form, input };
  }

  it('opens the add-custom-filter form with an empty, error-free name input', () => {
    const { container } = renderBar();

    const { form, input } = openForm(container);
    expect(form).toBeTruthy();
    expect(input).toBeTruthy();
    // The submit button carries the e2e hook.
    expect(qs(form, '.e2e-open-custom-filter-form')).toBeTruthy();
    // No validation error is shown before the first submit.
    expect(container.querySelector('.error-text')).toBeNull();
    expect(input.classList.contains('checksley-error')).toBe(false);
  });

  it('rejects an empty name with the length-zero error and does not save', () => {
    const { container, spies } = renderBar();

    const { form, input } = openForm(container);
    fireEvent.submit(form); // empty name

    expect(spies.onSaveCustomFilter).not.toHaveBeenCalled();
    expect(input.classList.contains('checksley-error')).toBe(true);

    const errorText = qs(container, '.error-text');
    expect(errorText.textContent).toBe('COMMON.FILTERS.LENGTH_ZERO_ERROR');
  });

  it('rejects a duplicate name with the repeated-filter error and does not save', () => {
    const { container, spies } = renderBar();

    const { form, input } = openForm(container);
    fireEvent.change(input, { target: { value: 'MyFilter' } }); // already exists in customFilters
    fireEvent.submit(form);

    expect(spies.onSaveCustomFilter).not.toHaveBeenCalled();
    expect(input.classList.contains('checksley-error')).toBe(true);

    const errorText = qs(container, '.error-text');
    expect(errorText.textContent).toBe('COMMON.FILTERS.REPEATED_FILTER_ERROR');
  });

  it('saves a valid, unique name exactly once and then hides the form', () => {
    const { container, spies } = renderBar();

    const { form, input } = openForm(container);
    fireEvent.change(input, { target: { value: 'NewFilter' } });
    fireEvent.submit(form);

    expect(spies.onSaveCustomFilter).toHaveBeenCalledTimes(1);
    expect(spies.onSaveCustomFilter).toHaveBeenCalledWith('NewFilter');

    // Observable post-save outcome: the form is gone and the add button reappears. We do NOT
    // assert on the (hidden) internal lengthZeroError flag — see the block comment above.
    expect(container.querySelector('.custom-filters-add-form')).toBeNull();
    expect(container.querySelector('.add-custom-filter')).toBeTruthy();
  });

  it('selects a custom filter, invoking onSelectCustomFilter and marking the row active', () => {
    const { container, spies } = renderBar();

    const nameButton = qs(container, '.single-filter-type-custom .name');
    fireEvent.click(nameButton);

    expect(spies.onSelectCustomFilter).toHaveBeenCalledTimes(1);
    expect(spies.onSelectCustomFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100, name: 'MyFilter' }),
    );

    // The selected row gains the `active` modifier.
    const row = qs(container, '.single-filter-type-custom');
    expect(row.classList.contains('active')).toBe(true);
  });

  it('removes a custom filter, invoking onRemoveCustomFilter with the filter object', () => {
    const { container, spies } = renderBar();

    const removeButton = qs(container, '.single-filter-type-custom .e2e-remove-custom-filter');
    fireEvent.click(removeButton);

    expect(spies.onRemoveCustomFilter).toHaveBeenCalledTimes(1);
    expect(spies.onRemoveCustomFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100, name: 'MyFilter' }),
    );
  });
});

/* ==========================================================================================
 * Branch coverage — option class + inline color styling variants
 *
 * The base fixtures already cover the user option (Alice: avatar + count badge + transparent
 * border) and the tag option (ui: background color from `color`). These extra cases cover the
 * general (non-tag, non-user) option class and the `border-color` branch driven by a color on
 * a non-tag option, plus the include-mode branch of a freshly added general option.
 * ======================================================================================== */

describe('FilterBar — option class + color styling branches', () => {
  // Explicitly typed as FilterCategoryOption to lock the option shape (id/name/count/color).
  const highOption: FilterCategoryOption = { id: 9, name: 'High', count: 4, color: '#0000ff' };
  const severity: FilterCategory = {
    dataType: 'severity',
    title: 'Severity',
    content: [highOption],
  };

  it('renders a general (non-tag, non-user) option with the general class and a colored border', () => {
    const { container } = renderBar({ filters: [severity], selectedFilters: [] });

    const severityButton = getCategoryButton(container, 'Severity');
    fireEvent.click(severityButton);

    const option = qs(getFilterListFor(severityButton)!, '.single-filter');
    expect(option.classList.contains('single-filter-type-general')).toBe(true);
    expect(option.classList.contains('single-filter-type-tag')).toBe(false);
    expect(option.classList.contains('single-filter-type-user')).toBe(false);
    // A color on a non-tag option drives the border color (not the default "transparent").
    // Assert the meaningful branch (a real color was applied) rather than an exact string,
    // because jsdom/cssstyle normalises color formats (e.g. "#0000ff" -> "rgb(0, 0, 255)").
    expect(option.getAttribute('style')).toContain('border-color');
    expect(option.style.borderColor).not.toBe('');
    expect(option.style.borderColor).not.toBe('transparent');
    // No avatar for a non-user option.
    expect(option.querySelector('.user-pic')).toBeNull();
  });

  it('emits onAddFilter for the general option with the include mode by default', () => {
    const { container, spies } = renderBar({ filters: [severity], selectedFilters: [] });

    const severityButton = getCategoryButton(container, 'Severity');
    fireEvent.click(severityButton);
    const optionButton = within(getFilterListFor(severityButton)!).getByText('High').closest('button')!;
    fireEvent.click(optionButton);

    expect(spies.onAddFilter).toHaveBeenCalledTimes(1);
    expect(spies.onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        category: expect.objectContaining({ dataType: 'severity' }),
        filter: expect.objectContaining({ id: 9 }),
        mode: 'include',
      }),
    );
  });

  it('applies a tag option background color from its color and keeps the tag class', () => {
    // `tags` has no hideEmpty, so "ui" (count 0, color #00ff00) renders when Tags opens.
    const { container } = renderBar({ selectedFilters: [] });

    const tagsButton = getCategoryButton(container, 'Tags');
    fireEvent.click(tagsButton);

    const filterList = getFilterListFor(tagsButton)!;
    const uiOption = within(filterList).getByText('ui').closest('button') as HTMLElement;
    expect(uiOption.classList.contains('single-filter-type-tag')).toBe(true);
    // A color on a tag option drives the background (only set for colored tag options), so its
    // presence in the inline style proves the tag-background branch executed. We avoid an exact
    // color-string comparison because jsdom/cssstyle normalises color formats.
    expect(uiOption.getAttribute('style')).toContain('background');
  });
});

/* ==========================================================================================
 * Prop edge cases — nullish-fallback branch completeness
 *
 * These cases lock down the optional-prop / optional-field fallbacks: an omitted
 * `excludeFilters` (defaults to no exclusions), applied filters with no precomputed `key`
 * (React key falls back to `${dataType}-${id}`), and a user option lacking a photo url and a
 * count (avatar src falls back to '' and no count badge renders).
 * ======================================================================================== */

describe('FilterBar — prop edge cases (branch completeness)', () => {
  it('excludes nothing (shows the Status category) when excludeFilters is omitted', () => {
    const { container } = renderBar({ excludeFilters: undefined });

    const categoryTitles = qsa(container, '.filters-cat-single .title').map((el) => el.textContent);
    expect(categoryTitles).toContain('Status');
  });

  it('renders applied filters that carry no precomputed key', () => {
    const { container } = renderBar({
      selectedFilters: [
        { id: 2, name: 'InProgress', dataType: 'status', mode: 'include' },
        { id: 'feature', name: 'feature', dataType: 'tags', mode: 'exclude' },
      ],
    });

    expect(within(qs(container, '.filters-included')).getByText('InProgress')).toBeTruthy();
    expect(within(qs(container, '.filters-excluded')).getByText('feature')).toBeTruthy();
  });

  it('renders a user option lacking a photo url (empty avatar src) and no count badge', () => {
    const { container } = renderBar({
      filters: [{ dataType: 'assigned_users', title: 'Assigned', content: [{ id: 8, name: 'Bob' }] }],
      selectedFilters: [],
    });

    const assignedButton = getCategoryButton(container, 'Assigned');
    fireEvent.click(assignedButton);

    const option = qs(getFilterListFor(assignedButton)!, '.single-filter');
    // The avatar still renders for a user option; its src falls back to '' with no photo.
    const avatar = qs(option, '.user-pic');
    expect(avatar.getAttribute('src')).toBe('');
    // No count -> no count badge.
    expect(option.querySelector('.number.e2e-filter-count')).toBeNull();
  });
});
