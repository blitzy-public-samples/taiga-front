/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link KanbanHeader}.
 *
 * These tests assert the exact DOM contract reproduced from
 * `app/partials/kanban/kanban.jade` (L20-46) — the `.taskboard-actions` bar —
 * plus the controlled behavior of the filter toggle, the `tg-input-search`
 * search box, and the `tg-board-zoom` zoom radios.
 */

import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { KanbanHeader } from "./KanbanHeader";
import type { KanbanHeaderProps } from "./KanbanHeader";

/** Build a full props object, overriding only what a test cares about. */
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

  it("renders the filter button with both btn-filter and e2e-open-filter classes", () => {
    const { container } = render(<KanbanHeader {...makeProps()} />);

    const btn = container.querySelector("button.btn-filter.e2e-open-filter");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("type")).toBe("button");
    // Not active when the filter panel is closed.
    expect(btn!.classList.contains("active")).toBe(false);
  });

  it("renders the filter icon as tg-svg > svg.icon-filters", () => {
    const { container } = render(<KanbanHeader {...makeProps()} />);

    const icon = container.querySelector(
      ".kanban-table-options-start button .btn-filter, .kanban-table-options-start button",
    );
    expect(icon).not.toBeNull();
    const filterSvg = container.querySelector("button.btn-filter tg-svg svg.icon-filters");
    expect(filterSvg).not.toBeNull();
    expect(filterSvg!.querySelector("use")!.getAttribute("xlink:href")).toBe("#icon-filters");
  });

  it("adds the active class and swaps the label when openFilter is true", () => {
    const { container } = render(<KanbanHeader {...makeProps({ openFilter: true })} />);

    const btn = container.querySelector("button.btn-filter")!;
    expect(btn.classList.contains("active")).toBe(true);
    expect(btn.querySelector("span.text")!.textContent).toBe("Hide filters");
  });

  it("shows 'Filters' label when openFilter is false", () => {
    const { container } = render(<KanbanHeader {...makeProps({ openFilter: false })} />);

    expect(container.querySelector("button.btn-filter span.text")!.textContent).toBe("Filters");
  });

  it("renders .selected-filters only when selectedFiltersCount > 0", () => {
    const { container: c0 } = render(<KanbanHeader {...makeProps({ selectedFiltersCount: 0 })} />);
    expect(c0.querySelector(".selected-filters")).toBeNull();

    const { container: c3 } = render(<KanbanHeader {...makeProps({ selectedFiltersCount: 3 })} />);
    const badge = c3.querySelector(".selected-filters");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("3");
  });

  it("sets the button title from the applied-filters count", () => {
    const { container } = render(<KanbanHeader {...makeProps({ selectedFiltersCount: 5 })} />);
    expect(container.querySelector("button.btn-filter")!.getAttribute("title")).toBe(
      "5 filters applied",
    );
  });

  it("renders tg-input-search with a type=search input and the search tg-svg icon", () => {
    const { container } = render(<KanbanHeader {...makeProps({ filterQ: "abc" })} />);

    const input = container.querySelector("tg-input-search input[type='search']") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute("placeholder")).toBe("subject or reference");
    expect(input.value).toBe("abc");

    const searchSvg = container.querySelector("tg-input-search tg-svg svg.icon-search");
    expect(searchSvg).not.toBeNull();
    expect(searchSvg!.querySelector("use")!.getAttribute("xlink:href")).toBe("#icon-search");
  });

  it("renders tg-board-zoom.board-zoom with a title and 4 zoom radios (value 0..3)", () => {
    const { container } = render(<KanbanHeader {...makeProps({ zoomLevel: 2 })} />);

    const zoom = container.querySelector("tg-board-zoom.board-zoom");
    expect(zoom).not.toBeNull();
    expect(zoom!.querySelector(".board-zoom-title")!.textContent).toBe("Zoom:");

    const radios = zoom!.querySelectorAll("label.zoom-radio");
    expect(radios).toHaveLength(4);

    radios.forEach((label, index) => {
      const input = label.querySelector("input[type='radio']") as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.getAttribute("value")).toBe(String(index));
      expect(input.getAttribute("name")).toBe("kanban-zoom");
      // The checked radio reflects zoomLevel (2).
      expect(input.checked).toBe(index === 2);
      // Visible target is .checkmark > span.
      expect(label.querySelector(".checkmark > span")).not.toBeNull();
    });
  });

  it("renders zoom labels from the locale (Compact/Default/Detailed/Expanded)", () => {
    const { container } = render(<KanbanHeader {...makeProps()} />);
    const labels = Array.from(
      container.querySelectorAll("tg-board-zoom .zoom-radio .checkmark span"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["Compact", "Default", "Detailed", "Expanded"]);
  });
});

describe("KanbanHeader — interactions", () => {
  it("calls onToggleFilter when the filter button is clicked", () => {
    const onToggleFilter = jest.fn();
    const { container } = render(<KanbanHeader {...makeProps({ onToggleFilter })} />);

    fireEvent.click(container.querySelector("button.btn-filter")!);
    expect(onToggleFilter).toHaveBeenCalledTimes(1);
  });

  it("calls onChangeQ and reflects typed text (dirty) when typing in search", () => {
    const onChangeQ = jest.fn();
    const { container } = render(<KanbanHeader {...makeProps({ onChangeQ })} />);

    const input = container.querySelector("tg-input-search input[type='search']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "story-42" } });

    expect(onChangeQ).toHaveBeenCalledWith("story-42");
    expect(input.value).toBe("story-42");
  });

  it("calls onSetZoom with the picked index when a zoom radio is selected", () => {
    const onSetZoom = jest.fn();
    const { container } = render(<KanbanHeader {...makeProps({ zoomLevel: 0, onSetZoom })} />);

    const radios = container.querySelectorAll("tg-board-zoom input[type='radio']");
    fireEvent.click(radios[3]);
    expect(onSetZoom).toHaveBeenCalledWith(3);
  });

  it("syncs the input from filterQ while not dirty, then stops syncing once dirty", () => {
    // A wrapper that lets us push new filterQ values from the parent.
    function Harness() {
      const [q, setQ] = useState("initial");
      return (
        <div>
          <button type="button" data-testid="push" onClick={() => setQ("pushed")}>
            push
          </button>
          <KanbanHeader {...makeProps({ filterQ: q })} />
        </div>
      );
    }

    const { container, getByTestId } = render(<Harness />);
    const input = container.querySelector("tg-input-search input[type='search']") as HTMLInputElement;
    expect(input.value).toBe("initial");

    // While not dirty, an external filterQ change propagates into the input.
    fireEvent.click(getByTestId("push"));
    expect(input.value).toBe("pushed");

    // After the user types (dirty), external pushes no longer overwrite the input.
    fireEvent.change(input, { target: { value: "typed" } });
    expect(input.value).toBe("typed");
    fireEvent.click(getByTestId("push"));
    expect(input.value).toBe("typed");
  });
});
