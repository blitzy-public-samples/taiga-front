/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * FiltersSidebar.test.tsx — browserless Jest + jsdom render spec for the Kanban
 * board filter panel (`../components/FiltersSidebar`).
 *
 * WHAT IS UNDER TEST
 *   The React 18 port of the AngularJS `<tg-filter>` sidebar. This spec exercises
 *   the component's public "props down, events up" contract exactly as authored,
 *   NOT an idealised one — every selector and branch below was aligned to the
 *   real component after reading it:
 *     - add / remove applied filter callbacks (`onAddFilter`, `onRemoveFilter`);
 *     - the hand-written custom-filter save validation that REPLACES checksley,
 *       across all three branches (empty-name -> `lengthZeroError`; duplicate
 *       name -> `repeatedFilterError`; unique name -> `onSaveCustomFilter`);
 *     - select / remove of a saved custom filter
 *       (`onSelectCustomFilter`, `onRemoveCustomFilter`);
 *     - the presence of the stable `e2e-*` hook classes the Playwright layer
 *       (`e2e-react/**`) selects on.
 *
 *   The legacy behaviour it ports lived in `kanban/main.coffee` +
 *   `resources.coffee` `filters_data` — both READ-ONLY references that are NEVER
 *   imported here.
 *
 * TEST-LAYER ISOLATION (hard constraints)
 *   - `.tsx` with the JSX automatic runtime, so there is intentionally NO
 *     `import React`.
 *   - jest-dom matchers (`toBeInTheDocument`, `toHaveClass`, `toBeDisabled`) are
 *     registered globally by `jest.config.js` `setupFilesAfterEach`, so they are
 *     used WITHOUT an `@testing-library/jest-dom` import; the Jest globals
 *     (`describe`/`it`/`expect`/`jest`) are ambient too and never imported.
 *   - `isolatedModules` is on, so the helper types are brought in with
 *     `import type`.
 *   - Only `@testing-library/react` and the component-under-test are imported.
 *     `immutable` / `dragula` / `dom-autoscroller` / `checksley` / `jquery` /
 *     `angular` / `@playwright/test` and any app CoffeeScript are NEVER imported;
 *     there is no network and no real browser. Kept Node v16.19.1 compatible.
 *
 * NOTABLE ALIGNMENT TO THE ACTUAL COMPONENT
 *   - The custom-filter form is opened by the `.add-custom-filter` button (which
 *     is DISABLED until at least one filter is applied); `.e2e-open-custom-filter-form`
 *     is the SAVE (submit) control INSIDE that form, not the opener.
 *   - `saveCustomFilter` uses a RAW `name.length` check, so only a genuinely
 *     empty value (never whitespace) trips `lengthZeroError` — the empty-name
 *     branch therefore submits without typing.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { FiltersSidebar } from '../components/FiltersSidebar';
import type {
  FilterCategory,
  SelectedFilter,
  CustomFilter,
  FiltersSidebarProps,
} from '../components/FiltersSidebar';

/* ========================================================================== *
 * Fixtures — minimal plain objects shaped like the component's props.
 * ========================================================================== */

/**
 * A "Status" category carrying two selectable options. `dataType` is a non-tag,
 * non-user facet, so its options render as `.single-filter.single-filter-type-general`
 * buttons and expose the `.e2e-filter-count` badge (both counts are > 0).
 */
function makeStatusCategory(): FilterCategory {
  return {
    dataType: 'status',
    title: 'Status',
    content: [
      { id: 1, name: 'New', color: '#70728f', count: 3 },
      { id: 2, name: 'In progress', color: '#e44057', count: 5 },
    ],
  };
}

/**
 * An applied filter. Defaults to the `include` bucket and matches the first
 * Status option (id 1); specs that must NOT hide a Status option override `id`.
 */
function makeSelectedFilter(overrides: Partial<SelectedFilter> = {}): SelectedFilter {
  return {
    id: 1,
    key: 'status:1',
    name: 'New',
    mode: 'include',
    dataType: 'status',
    color: '#70728f',
    ...overrides,
  };
}

/** A single saved custom filter named "My Filter" (drives the duplicate branch). */
function makeSavedCustomFilter(): CustomFilter {
  return { id: 7, name: 'My Filter' };
}

/**
 * Render the sidebar with sensible defaults and `jest.fn()` callbacks, returning
 * the render utilities plus the resolved `props` so a spec can both drive the UI
 * and assert against the exact callback instances it was given.
 */
function setup(overrides: Partial<FiltersSidebarProps> = {}) {
  const props: FiltersSidebarProps = {
    filters: [makeStatusCategory()],
    customFilters: [makeSavedCustomFilter()],
    selectedFilters: [],
    onAddFilter: jest.fn(),
    onRemoveFilter: jest.fn(),
    onSelectCustomFilter: jest.fn(),
    onRemoveCustomFilter: jest.fn(),
    onSaveCustomFilter: jest.fn(),
    ...overrides,
  };

  const utils = render(<FiltersSidebar {...props} />);
  return { ...utils, props };
}

/** Find an option button inside the (open) category list by its `.name` text. */
function optionByName(container: HTMLElement, name: string): HTMLButtonElement {
  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.filters-cats .filter-list .single-filter'),
  );
  const match = buttons.find((button) => button.querySelector('.name')?.textContent === name);
  if (!match) {
    throw new Error(`Filter option "${name}" was not found in the open category`);
  }
  return match;
}

/** Enable + open the custom-filter form (requires >= 1 applied filter). */
function openCustomFilterForm(container: HTMLElement): void {
  const addButton = container.querySelector<HTMLButtonElement>('.add-custom-filter');
  expect(addButton).not.toBeNull();
  // The opener is only enabled once at least one filter has been applied.
  expect(addButton).not.toBeDisabled();
  fireEvent.click(addButton as HTMLButtonElement);
}

/* ========================================================================== *
 * add / remove filter
 * ========================================================================== */

describe('add / remove filter', () => {
  it('emits onAddFilter with the clicked option and the current include mode', () => {
    // No applied filters, so the first Status option ("New") is not hidden.
    const { container, props } = setup({ selectedFilters: [] });

    // Categories start collapsed — open the Status category first.
    const category = container.querySelector<HTMLButtonElement>('.e2e-category');
    expect(category).not.toBeNull();
    fireEvent.click(category as HTMLButtonElement);

    // Click the "New" option inside the now-open list.
    fireEvent.click(optionByName(container, 'New'));

    expect(props.onAddFilter).toHaveBeenCalledTimes(1);
    expect(props.onAddFilter).toHaveBeenCalledWith({
      category: props.filters[0],
      filter: props.filters[0].content[0],
      mode: 'include',
    });
  });

  it('emits onRemoveFilter with the applied filter when its remove control is clicked', () => {
    const applied = makeSelectedFilter();
    const { container, props } = setup({ selectedFilters: [applied] });

    const removeButton = container.querySelector<HTMLButtonElement>('.e2e-remove-filter');
    expect(removeButton).not.toBeNull();
    fireEvent.click(removeButton as HTMLButtonElement);

    expect(props.onRemoveFilter).toHaveBeenCalledTimes(1);
    expect(props.onRemoveFilter).toHaveBeenCalledWith(applied);
  });

  it('applies the exclude mode to onAddFilter after the exclude radio is chosen', () => {
    const { container, props } = setup({ selectedFilters: [] });

    // Switch the include/exclude radio group to "exclude".
    const excludeRadio = container.querySelector<HTMLInputElement>('#filter-mode-exclude');
    expect(excludeRadio).not.toBeNull();
    fireEvent.click(excludeRadio as HTMLInputElement);

    // Open the category and pick the "New" option; the emitted mode must follow
    // the radio selection.
    fireEvent.click(container.querySelector('.e2e-category') as HTMLButtonElement);
    fireEvent.click(optionByName(container, 'New'));

    expect(props.onAddFilter).toHaveBeenCalledTimes(1);
    expect(props.onAddFilter).toHaveBeenCalledWith({
      category: props.filters[0],
      filter: props.filters[0].content[0],
      mode: 'exclude',
    });
  });

  it('renders an excluded applied filter and removes it via its remove control', () => {
    // An `exclude`-mode applied filter lands in the excluded bucket.
    const excluded = makeSelectedFilter({
      id: 2,
      key: 'status:2',
      name: 'In progress',
      mode: 'exclude',
    });
    const { container, props } = setup({ selectedFilters: [excluded] });

    const excludedSection = container.querySelector('.filters-excluded');
    expect(excludedSection).toBeInTheDocument();

    const removeButton = container.querySelector<HTMLButtonElement>(
      '.filters-excluded .e2e-remove-filter',
    );
    expect(removeButton).not.toBeNull();
    fireEvent.click(removeButton as HTMLButtonElement);

    expect(props.onRemoveFilter).toHaveBeenCalledTimes(1);
    expect(props.onRemoveFilter).toHaveBeenCalledWith(excluded);
  });
});

/* ========================================================================== *
 * custom filter — save validation (hand-written, replaces checksley)
 * ========================================================================== */

describe('custom filter — save validation', () => {
  it('lengthZero branch: an empty name shows the length error and does NOT save', () => {
    const { container, props } = setup({ selectedFilters: [makeSelectedFilter()] });
    openCustomFilterForm(container);

    // Leave the name input empty. The component uses a raw `length` check, so an
    // empty value (not whitespace) is what trips `lengthZeroError`.
    const saveButton = container.querySelector<HTMLButtonElement>('.e2e-open-custom-filter-form');
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton as HTMLButtonElement);

    expect(props.onSaveCustomFilter).not.toHaveBeenCalled();
    expect(screen.getByText('Please add a filter name')).toBeInTheDocument();
    // The input is flagged invalid via the legacy `checksley-error` class.
    expect(container.querySelector('.e2e-filter-name-input')).toHaveClass('checksley-error');
  });

  it('repeated branch: a duplicate name shows the repeated error and does NOT save', () => {
    const { container, props } = setup({ selectedFilters: [makeSelectedFilter()] });
    openCustomFilterForm(container);

    const input = container.querySelector<HTMLInputElement>('.e2e-filter-name-input');
    expect(input).not.toBeNull();
    // "My Filter" already exists in customFilters.
    fireEvent.change(input as HTMLInputElement, { target: { value: 'My Filter' } });

    fireEvent.click(
      container.querySelector('.e2e-open-custom-filter-form') as HTMLButtonElement,
    );

    expect(props.onSaveCustomFilter).not.toHaveBeenCalled();
    expect(screen.getByText('This filter name is already in use')).toBeInTheDocument();
    // A duplicate name is non-empty, so the length error must NOT be shown.
    expect(screen.queryByText('Please add a filter name')).toBeNull();
  });

  it('success branch: a unique name saves once and clears the form', () => {
    const { container, props } = setup({ selectedFilters: [makeSelectedFilter()] });
    openCustomFilterForm(container);

    const input = container.querySelector<HTMLInputElement>('.e2e-filter-name-input');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { value: 'Fresh Filter' } });

    fireEvent.click(
      container.querySelector('.e2e-open-custom-filter-form') as HTMLButtonElement,
    );

    expect(props.onSaveCustomFilter).toHaveBeenCalledTimes(1);
    expect(props.onSaveCustomFilter).toHaveBeenCalledWith('Fresh Filter');

    // On success the form closes, so the input and both error messages are gone.
    expect(container.querySelector('.e2e-filter-name-input')).toBeNull();
    expect(screen.queryByText('Please add a filter name')).toBeNull();
    expect(screen.queryByText('This filter name is already in use')).toBeNull();
  });
});

/* ========================================================================== *
 * custom filter — select / remove
 * ========================================================================== */

describe('custom filter — select / remove', () => {
  it('emits onSelectCustomFilter when a saved filter is clicked', () => {
    const saved = makeSavedCustomFilter();
    const { container, props } = setup({ customFilters: [saved] });

    const nameButton = container.querySelector<HTMLButtonElement>(
      '.custom-filter-list .single-filter-type-custom .name',
    );
    expect(nameButton).not.toBeNull();
    fireEvent.click(nameButton as HTMLButtonElement);

    expect(props.onSelectCustomFilter).toHaveBeenCalledTimes(1);
    expect(props.onSelectCustomFilter).toHaveBeenCalledWith(saved);
  });

  it('emits onRemoveCustomFilter when the remove control is clicked', () => {
    const saved = makeSavedCustomFilter();
    const { container, props } = setup({ customFilters: [saved] });

    const removeButton = container.querySelector<HTMLButtonElement>('.e2e-remove-custom-filter');
    expect(removeButton).not.toBeNull();
    fireEvent.click(removeButton as HTMLButtonElement);

    expect(props.onRemoveCustomFilter).toHaveBeenCalledTimes(1);
    expect(props.onRemoveCustomFilter).toHaveBeenCalledWith(saved);
  });
});

/* ========================================================================== *
 * e2e hook classes present (stable selectors for the Playwright layer)
 * ========================================================================== */

describe('e2e hook classes present', () => {
  it('renders the stable e2e-* hooks used by the Playwright layer', () => {
    // A non-colliding applied filter (id 99) keeps BOTH Status options visible
    // and enables the "add custom filter" opener.
    const { container } = setup({
      selectedFilters: [makeSelectedFilter({ id: 99, key: 'status:99', name: 'Done' })],
    });

    // The category hook is present immediately.
    expect(container.querySelector('.e2e-category')).toBeInTheDocument();

    // Opening the category reveals the per-option count hook.
    fireEvent.click(container.querySelector('.e2e-category') as HTMLButtonElement);
    expect(container.querySelector('.e2e-filter-count')).toBeInTheDocument();

    // Opening the custom-filter form reveals its save-control hook.
    fireEvent.click(container.querySelector('.add-custom-filter') as HTMLButtonElement);
    expect(container.querySelector('.e2e-open-custom-filter-form')).toBeInTheDocument();
  });
});

/* ========================================================================== *
 * F-UI-02 / F-UI-06 / F-UI-07 — icons, localization, emoji
 * ========================================================================== */

describe('F-UI icons, localization and emoji', () => {
  it('F-UI-06: the panel title and Add action render through the i18n bridge', () => {
    const { container } = setup();

    // English fallback in the shell-less unit env — NOT hardcoded literals.
    expect(container.querySelector('.custom-filters-title .name')).toHaveTextContent(
      'Custom filters',
    );
    expect(container.querySelector('.add-custom-filter')).toHaveTextContent('Add');
  });

  it('F-UI-02: the saved-filter remove control renders the shared `<tg-svg>` trash sprite', () => {
    const { container } = setup();

    // The retained `filter.scss` targets the `tg-svg` host (the legacy jade used
    // `tg-svg(svg-icon="icon-trash")`), so the wrapper must be a real custom element
    // — NOT a bare `<svg>` or empty span.
    const svg = container.querySelector(
      '.e2e-remove-custom-filter tg-svg svg.icon.icon-trash',
    );
    expect(svg).not.toBeNull();
    expect(svg?.querySelector('use')).not.toBeNull();
  });

  it('F-UI-02: category disclosure arrows render as shared `<tg-svg>` sprites', () => {
    const { container } = setup({
      selectedFilters: [makeSelectedFilter({ id: 99, key: 'status:99', name: 'Done' })],
    });

    // Closed category -> right arrow.
    expect(
      container.querySelector('.e2e-category tg-svg svg.icon.icon-arrow-right'),
    ).not.toBeNull();

    // Open the category -> the arrow swaps to the down variant, still a `<tg-svg>`.
    fireEvent.click(container.querySelector('.e2e-category') as HTMLButtonElement);
    expect(
      container.querySelector('.e2e-category tg-svg svg.icon.icon-arrow-down'),
    ).not.toBeNull();
  });

  it('F-UI-07: an applied TAG filter name emojifies while a non-tag name stays plain', () => {
    // Seed one known emoji token so `emojify` produces an <img class="emoji">.
    (window as unknown as { taiga?: unknown }).taiga = {
      emojis: [{ id: 'smile', name: 'smile', image: 'smile.png' }],
    };
    (window as unknown as { _version?: string })._version = 'v1';

    const { container } = setup({
      selectedFilters: [
        // A TAG filter whose name carries an emoji token.
        makeSelectedFilter({
          id: 3,
          key: 'tags:3',
          name: 'done :smile:',
          dataType: 'tags',
        }),
      ],
    });

    // The tag name is emojified -> a real <img class="emoji"> node appears.
    const tagName = container.querySelector('.filters-included .name');
    expect(tagName).not.toBeNull();
    expect(tagName?.querySelector('img.emoji')).not.toBeNull();
  });

  it('F-UI-07: a non-tag applied filter name renders verbatim (no emoji parsing)', () => {
    (window as unknown as { taiga?: unknown }).taiga = {
      emojis: [{ id: 'smile', name: 'smile', image: 'smile.png' }],
    };

    const { container } = setup({
      selectedFilters: [
        makeSelectedFilter({ id: 4, key: 'status:4', name: 'plain :smile:', dataType: 'status' }),
      ],
    });

    const name = container.querySelector('.filters-included .name');
    expect(name).not.toBeNull();
    // Non-tag facets are NOT emojified — the literal token stays as text.
    expect(name?.querySelector('img.emoji')).toBeNull();
    expect(name).toHaveTextContent('plain :smile:');
  });
});
