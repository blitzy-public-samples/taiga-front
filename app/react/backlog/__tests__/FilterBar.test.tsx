/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * FilterBar.test.tsx (Backlog) — Jest + React Testing Library unit spec for the
 * backlog-local React port of the AngularJS `tg-filter` sidebar
 * (`../components/FilterBar`). Part of the AngularJS 1.5.10 -> React 18
 * coexistence migration; resolves QA finding BL-6 (the backlog filter panel was
 * a truly-empty placeholder). These specs count toward the >=70% line-coverage
 * gate over `app/react/**`.
 *
 * Test philosophy: FilterBar is a fully CONTROLLED view — all data (`filters`,
 * `customFilters`, `selectedFilters`) and every mutation flow through props. We
 * drive it entirely with deterministic fixture props + `jest.fn()` spies and
 * assert on the OBSERVABLE outcomes (rendered DOM, `e2e-*` hooks, and the
 * callbacks fired), never on the component's private state.
 *
 * Backlog vs Kanban: the backlog sidebar does NOT exclude the `status` category
 * (the backlog has no status columns, so status IS a meaningful filter here), so
 * the default fixture passes no `excludeFilters` and the Status category renders.
 *
 * Isolation (hard requirements): jsdom only — NO Playwright, NO browser, NO
 * network. We import ONLY the module under test and the testing libraries; we
 * never reach into the legacy AngularJS / CoffeeScript source trees. The
 * behavioral origin (the legacy FilterController) and DOM origin (the legacy
 * tg-filter template) are reproduced from memory, never imported.
 */

// Automatic JSX runtime (tsconfig `jsx: "react-jsx"`): no default `React` import required.
// `jest` is provided as a global by the Jest runtime — it is intentionally NOT imported.
import { render, screen, fireEvent, within } from '@testing-library/react';

import FilterBar from '../components/FilterBar';
import type {
  FilterCategory,
  AppliedFilter,
  CustomFilter,
  FilterBarProps,
} from '../components/FilterBar';
// The shared i18n layer FilterBar resolves copy through. Reset it around every
// case so English defaults are deterministic and no configured locale leaks.
import { resetI18n } from '../../shared/i18n';

beforeEach(() => {
  resetI18n();
});
afterEach(() => {
  resetI18n();
});

/* ------------------------------------------------------------------------------------------
 * Small DOM query helpers — typed so strict-mode TS never trips on `Element | null`.
 * ---------------------------------------------------------------------------------------- */

/** querySelector returning a typed `HTMLElement`; throws a helpful error when missing. */
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

/** Locate a `.filters-cat-single.e2e-category` button by the visible label in its `.title`. */
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
 * Deterministic, typed fixtures — the FULL backlog category set (status is NOT excluded).
 *   - `status`         : a general option ("New").
 *   - `tags`           : a selected option ("bug", hidden) vs an unselected zero-count option
 *                        ("ui", shown because `tags` has no hideEmpty).
 *   - `assigned_users` : the user-option branch (avatar + count badge).
 *   - `owner`          : a second user category ("Created by").
 *   - `role`           : a general option ("Design").
 *   - `epic`           : a whole-category SKIP case (hideEmpty && totalTaggedElements === 0).
 * ---------------------------------------------------------------------------------------- */

const filters: FilterCategory[] = [
  { dataType: 'status', title: 'Status', content: [{ id: 1, name: 'New', count: 2 }] },
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
    title: 'Assigned to',
    content: [
      {
        id: 7,
        name: 'Alice',
        count: 1,
        // getAvatar returns the photo URL directly when both gravatar_id + photo exist.
        gravatar_id: 'alice-hash',
        photo: 'alice.png',
        username: 'alice',
        full_name_display: 'Alice Anderson',
      },
    ],
  },
  {
    dataType: 'owner',
    title: 'Created by',
    content: [{ id: 9, name: 'Bob', count: 4, gravatar_id: 'bob-hash', photo: 'bob.png' }],
  },
  { dataType: 'role', title: 'Role', content: [{ id: 3, name: 'Design', count: 2 }] },
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
}

/**
 * Render `<FilterBar>` with the fixtures above and fresh `jest.fn()` spies for
 * every callback. No `excludeFilters` by default (the backlog configuration).
 * Overrides are merged AFTER the spies so callers can swap `selectedFilters`,
 * `excludeFilters`, etc. without clobbering the spies they assert on.
 */
function renderBar(overrides: Partial<FilterBarProps> = {}) {
  const spies: FilterBarSpies = {
    onAddFilter: jest.fn(),
    onRemoveFilter: jest.fn(),
    onSaveCustomFilter: jest.fn(),
    onSelectCustomFilter: jest.fn(),
    onRemoveCustomFilter: jest.fn(),
  };

  const props: FilterBarProps = {
    filters,
    customFilters,
    selectedFilters,
    onAddFilter: spies.onAddFilter,
    onRemoveFilter: spies.onRemoveFilter,
    onSaveCustomFilter: spies.onSaveCustomFilter,
    onSelectCustomFilter: spies.onSelectCustomFilter,
    onRemoveCustomFilter: spies.onRemoveCustomFilter,
    ...overrides,
  };

  const renderResult = render(<FilterBar {...props} />);
  return { ...renderResult, spies };
}

/* ==========================================================================================
 * Root custom element + visual-parity structure
 * ======================================================================================== */

describe('Backlog FilterBar — root structure', () => {
  it('renders a <tg-filter> custom element wrapping .custom-filters and .filters-step-cat', () => {
    const { container } = renderBar();

    const tgFilter = container.querySelector('tg-filter');
    expect(tgFilter).toBeTruthy();
    expect(tgFilter!.querySelector('.custom-filters')).toBeTruthy();
    expect(tgFilter!.querySelector('.filters-step-cat')).toBeTruthy();
  });

  it('shows the custom-filters title count and the add-custom-filter button', () => {
    const { container } = renderBar();

    const numberEl = qs(container, '.custom-filters-title .number');
    expect(numberEl.textContent).toContain('(1)');
    expect(container.querySelector('.add-custom-filter')).toBeTruthy();
  });

  it('renders the FULL backlog category set INCLUDING Status (backlog does not exclude it)', () => {
    const { container } = renderBar();

    const categoryTitles = qsa(container, '.filters-cat-single .title').map((el) => el.textContent);
    expect(categoryTitles).toContain('Status');
    expect(categoryTitles).toContain('Tags');
    expect(categoryTitles).toContain('Assigned to');
    expect(categoryTitles).toContain('Created by');
    expect(categoryTitles).toContain('Role');
  });

  it('renders category buttons carrying the "filters-cat-single e2e-category" classes', () => {
    const { container } = renderBar();

    const catButtons = qsa(container, '.filters-cat-single');
    expect(catButtons.length).toBeGreaterThan(0);
    catButtons.forEach((btn) => {
      expect(btn.classList.contains('filters-cat-single')).toBe(true);
      expect(btn.classList.contains('e2e-category')).toBe(true);
    });
  });
});

/* ==========================================================================================
 * excludeFilters (prop-driven) + empty-category hiding
 * ======================================================================================== */

describe('Backlog FilterBar — excludeFilters and empty-category hiding', () => {
  it('skips a whole category flagged hideEmpty with totalTaggedElements === 0 (the "epic" category)', () => {
    const { container } = renderBar();

    const categoryTitles = qsa(container, '.filters-cat-single .title').map((el) => el.textContent);
    expect(categoryTitles).not.toContain('Epics');
  });

  it('hides a category whose dataType is passed in excludeFilters', () => {
    const { container } = renderBar({ excludeFilters: ['status'] });

    const categoryTitles = qsa(container, '.filters-cat-single .title').map((el) => el.textContent);
    expect(categoryTitles).not.toContain('Status');
    // The applied "New" status chip is independent of the category list — still shown.
    const included = qs(container, '.filters-included');
    expect(within(included).getByText('New')).toBeTruthy();
  });
});

/* ==========================================================================================
 * Applied filters (included / excluded) + unselect
 * ======================================================================================== */

describe('Backlog FilterBar — applied filters', () => {
  it('renders included and excluded applied filters with the matching mode modifier class', () => {
    const { container } = renderBar();

    const includedSection = qs(container, '.filters-included');
    const includedItem = qs(includedSection, '.single-applied-filter');
    expect(includedItem.classList.contains('include')).toBe(true);
    expect(within(includedSection).getByText('New')).toBeTruthy();

    const excludedSection = qs(container, '.filters-excluded');
    const excludedItem = qs(excludedSection, '.single-applied-filter');
    expect(excludedItem.classList.contains('exclude')).toBe(true);
    expect(within(excludedSection).getByText('bug')).toBeTruthy();
  });

  it('calls onRemoveFilter once with the included applied filter when its remove button is clicked', () => {
    const { container, spies } = renderBar();

    const includedSection = qs(container, '.filters-included');
    fireEvent.click(qs(includedSection, '.remove-filter.e2e-remove-filter'));

    expect(spies.onRemoveFilter).toHaveBeenCalledTimes(1);
    expect(spies.onRemoveFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, dataType: 'status', mode: 'include' }),
    );
  });

  it('calls onRemoveFilter with the excluded applied filter when its remove button is clicked', () => {
    const { container, spies } = renderBar();

    const excludedSection = qs(container, '.filters-excluded');
    fireEvent.click(qs(excludedSection, '.remove-filter.e2e-remove-filter'));

    expect(spies.onRemoveFilter).toHaveBeenCalledTimes(1);
    expect(spies.onRemoveFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bug', dataType: 'tags', mode: 'exclude' }),
    );
  });

  it('omits .filters-applied and disables add-custom-filter when there are no selected filters', () => {
    const { container } = renderBar({ selectedFilters: [] });

    expect(container.querySelector('.filters-applied')).toBeNull();
    expect(qs(container, '.add-custom-filter')).toBeDisabled();
  });

  it('enables the add-custom-filter button when selected filters are present', () => {
    const { container } = renderBar();
    expect(qs(container, '.add-custom-filter')).toBeEnabled();
  });
});

/* ==========================================================================================
 * Category open/close + option selection + filter mode
 * ======================================================================================== */

describe('Backlog FilterBar — category open/close, option selection, filter mode', () => {
  it('opens a category to reveal its options, rendering a user option with avatar and count badge', () => {
    const { container } = renderBar();

    const assignedButton = getCategoryButton(container, 'Assigned to');
    fireEvent.click(assignedButton);

    const filterList = getFilterListFor(assignedButton);
    expect(filterList).toBeTruthy();

    const aliceOption = qs(filterList!, '.single-filter');
    expect(within(aliceOption).getByText('Alice')).toBeTruthy();
    expect(aliceOption.classList.contains('single-filter-type-user')).toBe(true);
    expect(aliceOption.querySelector('.user-pic')).toBeTruthy();
    expect(qs(aliceOption, '.number.e2e-filter-count').textContent).toBe('1');
  });

  it('emits onAddFilter with the default "include" mode when an option is clicked', () => {
    // No pre-selection here so the "New" status option is NOT hidden as already-applied.
    const { container, spies } = renderBar({ selectedFilters: [] });

    const statusButton = getCategoryButton(container, 'Status');
    fireEvent.click(statusButton);
    const filterList = getFilterListFor(statusButton)!;
    fireEvent.click(within(filterList).getByText('New').closest('button')!);

    expect(spies.onAddFilter).toHaveBeenCalledTimes(1);
    expect(spies.onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({
        category: expect.objectContaining({ dataType: 'status' }),
        filter: expect.objectContaining({ id: 1 }),
        mode: 'include',
      }),
    );
  });

  it('emits onAddFilter with "exclude" mode after the exclude radio is selected', () => {
    const { container, spies } = renderBar();

    fireEvent.click(qs(container, 'input[value="exclude"]'));

    const roleButton = getCategoryButton(container, 'Role');
    fireEvent.click(roleButton);
    const filterList = getFilterListFor(roleButton)!;
    fireEvent.click(within(filterList).getByText('Design').closest('button')!);

    expect(spies.onAddFilter).toHaveBeenCalledTimes(1);
    expect(spies.onAddFilter).toHaveBeenCalledWith(expect.objectContaining({ mode: 'exclude' }));
  });

  it('closes an open category when its button is clicked again', () => {
    const { container } = renderBar();

    const assignedButton = getCategoryButton(container, 'Assigned to');

    fireEvent.click(assignedButton); // open
    expect(getFilterListFor(assignedButton)).toBeTruthy();
    expect(screen.queryByText('Alice')).toBeTruthy();

    fireEvent.click(assignedButton); // close (toggle)
    expect(getFilterListFor(assignedButton)).toBeNull();
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('hides an already-selected option while showing an unselected zero-count option (tags)', () => {
    const { container } = renderBar();

    const tagsButton = getCategoryButton(container, 'Tags');
    fireEvent.click(tagsButton);

    const filterList = getFilterListFor(tagsButton)!;
    // "bug" is selected -> hidden from the option list (still shown in .filters-excluded).
    expect(within(filterList).queryByText('bug')).toBeNull();
    // "ui" is unselected; tags has no hideEmpty so a 0 count does NOT hide it.
    expect(within(filterList).queryByText('ui')).toBeTruthy();
  });

  it('reflects the selected radio through the .active label class (include default)', () => {
    const { container } = renderBar();

    const includeLabel = qs(container, 'label[for="filter-mode-include"]');
    const excludeLabel = qs(container, 'label[for="filter-mode-exclude"]');
    expect(includeLabel.classList.contains('active')).toBe(true);
    expect(excludeLabel.classList.contains('active')).toBe(false);

    fireEvent.click(qs(container, 'input[value="exclude"]'));
    expect(qs(container, 'label[for="filter-mode-exclude"]').classList.contains('active')).toBe(true);
  });
});

/* ==========================================================================================
 * Custom filter save flow + select / remove
 * ======================================================================================== */

describe('Backlog FilterBar — custom filter save/select/remove', () => {
  /** Open the add-custom-filter form and return the live form + input elements. */
  function openForm(container: HTMLElement): { form: HTMLFormElement; input: HTMLInputElement } {
    fireEvent.click(qs(container, '.add-custom-filter'));
    const form = qs(container, '.custom-filters-add-form') as HTMLFormElement;
    const input = qs(form, 'input.e2e-filter-name-input') as HTMLInputElement;
    return { form, input };
  }

  it('opens the add-custom-filter form with an empty, error-free, id/name-bearing input', () => {
    const { container } = renderBar();

    const { form, input } = openForm(container);
    expect(form).toBeTruthy();
    expect(qs(form, '.e2e-open-custom-filter-form')).toBeTruthy();
    // a11y: the filter-name field carries an id AND name.
    expect(input.getAttribute('id')).toBe('backlog-add-filter-name');
    expect(input.getAttribute('name')).toBe('backlog-add-filter-name');
    // No validation error before the first submit.
    expect(container.querySelector('.error-text')).toBeNull();
    expect(input.classList.contains('checksley-error')).toBe(false);
  });

  it('emits onSaveCustomFilter with the typed name and hides the form on a valid submit', () => {
    const { container, spies } = renderBar();

    const { form, input } = openForm(container);
    fireEvent.change(input, { target: { value: 'Sprint-ready' } });
    fireEvent.submit(form);

    expect(spies.onSaveCustomFilter).toHaveBeenCalledTimes(1);
    expect(spies.onSaveCustomFilter).toHaveBeenCalledWith('Sprint-ready');
    // Form is hidden after a successful save.
    expect(container.querySelector('.custom-filters-add-form')).toBeNull();
  });

  it('does NOT emit onSaveCustomFilter for a duplicate name (matches an existing custom filter)', () => {
    const { container, spies } = renderBar();

    const { form, input } = openForm(container);
    fireEvent.change(input, { target: { value: 'MyFilter' } }); // already in customFilters
    fireEvent.submit(form);

    expect(spies.onSaveCustomFilter).not.toHaveBeenCalled();
  });

  it('lists saved custom filters; clicking the name selects it and the trash removes it', () => {
    const { container, spies } = renderBar();

    const customItem = qs(container, '.single-filter-type-custom');
    // Select.
    fireEvent.click(qs(customItem, 'button.name'));
    expect(spies.onSelectCustomFilter).toHaveBeenCalledTimes(1);
    expect(spies.onSelectCustomFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100, name: 'MyFilter' }),
    );

    // Remove (trash button).
    fireEvent.click(qs(customItem, '.remove-filter.e2e-remove-custom-filter'));
    expect(spies.onRemoveCustomFilter).toHaveBeenCalledTimes(1);
    expect(spies.onRemoveCustomFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100, name: 'MyFilter' }),
    );
  });

  it('marks the selected custom filter active after it is clicked', () => {
    const { container } = renderBar();

    const customItem = qs(container, '.single-filter-type-custom');
    expect(customItem.classList.contains('active')).toBe(false);
    fireEvent.click(qs(customItem, 'button.name'));
    expect(qs(container, '.single-filter-type-custom').classList.contains('active')).toBe(true);
  });
});
