/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest + @testing-library/react component tests for {@link KanbanHeader}.
 *
 * `KanbanHeader` is the React reproduction of the Kanban board
 * `.taskboard-actions` bar (`app/partials/kanban/kanban.jade` L20-46). Because
 * the AngularJS -> React migration must be DOM/CSS-identical, these tests assert
 * the exact element tree, class names, `data-*`/attribute values, and controlled
 * behavior the legacy template + directives produced:
 *   - the filter-toggle button (`button.btn-filter.e2e-open-filter`, with its
 *     `active` state, label swap, and applied-filter badge),
 *   - the search box (`tg-input-search`), reproducing the `q:'<'` / `change:'&'`
 *     bindings and the `$onChanges`-style dirty-tracking of
 *     `input-search.component.coffee`,
 *   - the zoom control (`tg-board-zoom.board-zoom`), reproducing the four
 *     `value="0".."3"` radios of `board-zoom.jade`.
 *
 * These tests contribute to the >= 70% line-coverage gate for the new React
 * code and cover every branch of the component.
 *
 * Conventions (per the build constraints for this file):
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`) are used directly
 *     (provided by @types/jest); they are intentionally NOT imported from the
 *     Jest globals module.
 *   - The automatic JSX runtime is used, so there is no `import React`.
 *   - `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument`) are
 *     registered globally by `jest.setup.ts`.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { KanbanHeader } from "./KanbanHeader";
import type { KanbanHeaderProps } from "./KanbanHeader";

/**
 * Build a complete, valid {@link KanbanHeaderProps} object, overriding only the
 * fields a given test cares about. Every callback defaults to a fresh
 * `jest.fn()` so a test that does not pass its own spy still receives a valid
 * no-op handler.
 */
function makeProps(overrides: Partial<KanbanHeaderProps> = {}): KanbanHeaderProps {
  return {
    openFilter: false,
    onToggleFilter: jest.fn(),
    selectedFiltersCount: 0,
    filterQ: "",
    onChangeQ: jest.fn(),
    zoomLevel: 1,
    onSetZoom: jest.fn(),
    ...overrides,
  };
}

describe("KanbanHeader — DOM contract", () => {
  it("renders the .taskboard-actions root with both option groups", () => {
    const { container } = render(<KanbanHeader {...makeProps()} />);

    const root = container.querySelector(".taskboard-actions");
    expect(root).not.toBeNull();
    expect(root!.querySelector(".kanban-table-options-start")).not.toBeNull();
    expect(root!.querySelector(".kanban-table-options-end")).not.toBeNull();
  });

  it("renders the filter button inactive with the 'Filters' label and no badge when closed", () => {
    const { container } = render(
      <KanbanHeader {...makeProps({ openFilter: false, selectedFiltersCount: 0 })} />,
    );

    const btn = container.querySelector("button.btn-filter.e2e-open-filter");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("type")).toBe("button");
    // Not active while the filter panel is closed.
    expect(btn!.classList.contains("active")).toBe(false);
    // The not-open label.
    expect(btn!.querySelector("span.text")!.textContent).toBe("Filters");
    // No applied-filters badge when the count is 0.
    expect(container.querySelector(".selected-filters")).toBeNull();

    // The filter icon renders as a tg-svg wrapper around svg.icon-filters.
    const filterSvg = container.querySelector(".btn-filter tg-svg svg.icon-filters");
    expect(filterSvg).not.toBeNull();
    expect(filterSvg!.querySelector("use")!.getAttribute("xlink:href")).toBe("#icon-filters");
  });

  it("marks the filter button active, swaps to 'Hide filters', and shows the badge when open", () => {
    const { container } = render(
      <KanbanHeader {...makeProps({ openFilter: true, selectedFiltersCount: 3 })} />,
    );

    const btn = container.querySelector("button.btn-filter.e2e-open-filter");
    expect(btn).not.toBeNull();
    // Active while the filter panel is open.
    expect(btn!.classList.contains("active")).toBe(true);
    // The open label.
    expect(btn!.querySelector("span.text")!.textContent).toBe("Hide filters");
    // The applied-filters badge is present and shows the count.
    const badge = container.querySelector(".selected-filters");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("3");
  });

  it("sets the button title from the applied-filters count", () => {
    const { container } = render(<KanbanHeader {...makeProps({ selectedFiltersCount: 5 })} />);

    expect(container.querySelector("button.btn-filter")!.getAttribute("title")).toBe(
      "5 filters applied",
    );
  });

  it("renders tg-input-search with a search input (value from filterQ) and a search tg-svg icon", () => {
    const { container } = render(<KanbanHeader {...makeProps({ filterQ: "abc" })} />);

    // `screen` resolves the single search box by its placeholder (locale text).
    const input = screen.getByPlaceholderText("subject or reference") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.getAttribute("type")).toBe("search");
    // The controlled value mirrors the pushed `filterQ`.
    expect(input.value).toBe("abc");
    // The input must live inside the `tg-input-search` custom element.
    expect(container.querySelector("tg-input-search input[type='search']")).toBe(input);

    // The search icon renders as a tg-svg wrapper around svg.icon-search.
    const searchSvg = container.querySelector("tg-input-search tg-svg svg.icon-search");
    expect(searchSvg).not.toBeNull();
    expect(searchSvg!.querySelector("use")!.getAttribute("xlink:href")).toBe("#icon-search");
  });

  it("renders tg-board-zoom.board-zoom with a title and 4 zoom radios (value 0..3)", () => {
    const { container } = render(<KanbanHeader {...makeProps({ zoomLevel: 1 })} />);

    const zoom = container.querySelector("tg-board-zoom.board-zoom");
    expect(zoom).not.toBeNull();
    expect(zoom!.querySelector(".board-zoom-title")!.textContent).toBe("Zoom:");

    const radios = zoom!.querySelectorAll("label.zoom-radio");
    expect(radios).toHaveLength(4);

    radios.forEach((label, index) => {
      const input = label.querySelector<HTMLInputElement>("input[type='radio']");
      expect(input).not.toBeNull();
      expect(input!.getAttribute("value")).toBe(String(index));
      expect(input!.getAttribute("name")).toBe("kanban-zoom");
      // With zoomLevel === 1, only the value="1" radio is checked.
      expect(input!.checked).toBe(index === 1);
      // The visible click target is `.checkmark > span`.
      expect(label.querySelector(".checkmark > span")).not.toBeNull();
    });
  });

  it("renders the zoom labels from the locale (Compact/Default/Detailed/Expanded)", () => {
    const { container } = render(<KanbanHeader {...makeProps()} />);

    const labels = Array.from(
      container.querySelectorAll("tg-board-zoom .zoom-radio .checkmark span"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["Compact", "Default", "Detailed", "Expanded"]);
  });
});

describe("KanbanHeader — interactions", () => {
  it("calls onToggleFilter once when the filter button is clicked", () => {
    const onToggleFilter = jest.fn();
    const { container } = render(<KanbanHeader {...makeProps({ onToggleFilter })} />);

    const btn = container.querySelector<HTMLButtonElement>("button.btn-filter.e2e-open-filter");
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);

    expect(onToggleFilter).toHaveBeenCalledTimes(1);
  });

  it("calls onChangeQ and reflects the typed text (dirty) when typing in search", () => {
    const onChangeQ = jest.fn();
    const { container } = render(<KanbanHeader {...makeProps({ onChangeQ })} />);

    const input = container.querySelector<HTMLInputElement>(
      "tg-input-search input[type='search']",
    );
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "story-42" } });

    expect(onChangeQ).toHaveBeenCalledWith("story-42");
    expect(input!.value).toBe("story-42");
  });

  it("calls onSetZoom with the picked index when the value=2 zoom radio is selected", () => {
    const onSetZoom = jest.fn();
    const { container } = render(<KanbanHeader {...makeProps({ zoomLevel: 1, onSetZoom })} />);

    const radio2 = container.querySelector<HTMLInputElement>(
      "tg-board-zoom input[type='radio'][value='2']",
    );
    expect(radio2).not.toBeNull();
    fireEvent.click(radio2!);

    expect(onSetZoom).toHaveBeenCalledWith(2);
  });

  it("syncs the input from filterQ while not dirty (rerender), then stops once dirty", () => {
    // A stable props object so only `filterQ` changes across rerenders (the
    // callback mock identities are preserved).
    const props = makeProps({ filterQ: "initial" });
    const { container, rerender } = render(<KanbanHeader {...props} />);

    const input = container.querySelector<HTMLInputElement>(
      "tg-input-search input[type='search']",
    );
    expect(input).not.toBeNull();
    expect(input!.value).toBe("initial");

    // While not dirty, an external `filterQ` change propagates into the input
    // (mirrors input-search.component.coffee `$onChanges: if changes.q && !dirty`).
    rerender(<KanbanHeader {...props} filterQ="pushed" />);
    expect(input!.value).toBe("pushed");

    // Once the user types, the field is dirty and external pushes no longer
    // overwrite it.
    fireEvent.change(input!, { target: { value: "typed" } });
    expect(input!.value).toBe("typed");
    rerender(<KanbanHeader {...props} filterQ="ignored" />);
    expect(input!.value).toBe("typed");
  });
});
