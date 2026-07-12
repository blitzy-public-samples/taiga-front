/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest + @testing-library/react component tests for {@link Swimlane}.
 *
 * `Swimlane` is the React reproduction of ONE Kanban swimlane row
 * (`div.kanban-swimlane`) from the legacy AngularJS board template
 * `app/partials/includes/modules/kanban-table.jade` (L73-121). Because the
 * AngularJS -> React migration must be DOM/CSS-identical, these tests assert the
 * exact element tree, class names, `data-*` attribute values, and fold/unfold
 * icon semantics the legacy Jade produced.
 *
 * They cover the file's Phase B (DOM/selector parity) and Phase C (behaviour)
 * validation checklist and every branch of `Swimlane.tsx` (folded vs. expanded,
 * classified vs. unclassified swimlane, default-star shown vs. hidden across all
 * its guard conditions, empty vs. populated status list, and the full per-status
 * prop forwarding to `StatusColumn`), so it contributes to the >= 70%
 * line-coverage gate for the new React code.
 *
 * Conventions (matching the sibling React specs, e.g. StatusColumn.test.tsx):
 *   - The automatic JSX runtime is used, so there is no `import React`.
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`) are used directly.
 *   - `@testing-library/jest-dom` matchers are registered by `jest.setup.ts`.
 *   - The child `StatusColumn` is mocked with a lightweight stub that echoes the
 *     forwarded props as `data-*` attributes. This isolates the unit under test:
 *     it lets the specs assert EXACTLY what `Swimlane` maps/forwards (per-status
 *     `swimlaneId`, `storyIds`, `folded`, `maximized`, ...) and keeps the specs
 *     stable against `StatusColumn`'s internals (covered by StatusColumn.test.tsx)
 *     and independent of the real `@dnd-kit` droppable wiring it pulls in.
 */

import { fireEvent, render } from "@testing-library/react";

import { Swimlane } from "./Swimlane";
import type { SwimlaneProps } from "./Swimlane";
import type { Status, Project, Swimlane as SwimlaneModel } from "../shared/types";

// --- Mocks -----------------------------------------------------------------

// Stub `StatusColumn`. The factory must not close over module-scope runtime
// bindings (jest hoists `jest.mock` above the imports), so React is pulled in via
// `require` inside the factory. The stub emits a `.mock-status-column` element
// echoing the forwarded props as `data-*` attributes so the specs can assert
// EXACTLY what `Swimlane` forwards per status.
jest.mock("./StatusColumn", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const react = require("react");
  return {
    StatusColumn: (props: {
      status: { id: number };
      swimlaneId?: number | null;
      storyIds: number[];
      folded: boolean;
      unfold?: boolean;
      maximized?: boolean;
      minimized?: boolean;
      renderInProgress?: boolean;
      showPlaceholder?: boolean;
      notFoundUserstories?: boolean;
    }) =>
      react.createElement("div", {
        className: "mock-status-column",
        "data-testid": "status-column",
        "data-status-id": String(props.status.id),
        "data-swimlane-id": String(props.swimlaneId),
        "data-story-ids": (props.storyIds || []).join(","),
        "data-folded": String(!!props.folded),
        "data-unfold": String(!!props.unfold),
        "data-maximized": String(!!props.maximized),
        "data-minimized": String(!!props.minimized),
        "data-render-in-progress": String(!!props.renderInProgress),
        "data-show-placeholder": String(!!props.showPlaceholder),
        "data-not-found": String(!!props.notFoundUserstories),
      }),
  };
});

// --- Fixtures --------------------------------------------------------------

function makeStatus(id: number, overrides: Partial<Status> = {}): Status {
  return {
    id,
    name: `Status ${id}`,
    color: "#70728f",
    wip_limit: null,
    is_archived: false,
    ...overrides,
  };
}

function makeSwimlane(overrides: Partial<SwimlaneModel> = {}): SwimlaneModel {
  return { id: 3, name: "Swimlane A", ...overrides };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 7,
    slug: "proj",
    my_permissions: ["modify_us", "add_us"],
    is_kanban_activated: true,
    is_backlog_activated: true,
    archived_code: null,
    points: [],
    roles: [],
    ...overrides,
  };
}

/** Build a complete, valid `SwimlaneProps`, defaulting `statuses`/`storiesByStatus`. */
function buildProps(overrides: Partial<SwimlaneProps> = {}): SwimlaneProps {
  const statuses = overrides.statuses ?? [makeStatus(1), makeStatus(2)];
  return {
    swimlane: makeSwimlane(),
    storiesByStatus: { 1: [10, 11], 2: [12] },
    usMap: {},
    project: makeProject(),
    zoom: ["subject"],
    zoomLevel: 1,
    folded: false,
    folds: {},
    foldStatusChanged: {},
    usersById: {},
    selectedUss: {},
    movedUs: [],
    swimlaneCount: 2,
    isMaximized: () => false,
    isMinimized: () => false,
    isArchivedHidden: () => false,
    showPlaceholder: () => false,
    onToggleSwimlane: jest.fn(),
    onToggleFold: jest.fn(),
    onClickEdit: jest.fn(),
    onClickDelete: jest.fn(),
    onClickAssignedTo: jest.fn(),
    onToggleSelect: jest.fn(),
    ...overrides,
    // Re-apply after the spread so an overridden `statuses` stays consistent.
    statuses,
  };
}

function renderSwimlane(overrides: Partial<SwimlaneProps> = {}) {
  const props = buildProps(overrides);
  const utils = render(<Swimlane {...props} />);
  const root = utils.container.firstElementChild as HTMLElement;
  const title = utils.container.querySelector(
    ".kanban-swimlane-title",
  ) as HTMLButtonElement;
  return { ...utils, props, root, title };
}

/** Read the sprite reference from an `Icon`'s `<use>` (React emits `xlink:href`). */
function iconUseHref(svg: Element | null): string | null {
  const use = svg ? svg.querySelector("use") : null;
  if (!use) return null;
  return use.getAttribute("xlink:href") ?? use.getAttribute("href");
}

// --- Phase B: DOM / selector parity ---------------------------------------

describe("Swimlane — DOM parity (Phase B)", () => {
  it("renders the root div.kanban-swimlane carrying data-swimlane === swimlane id", () => {
    const { root } = renderSwimlane({ swimlane: makeSwimlane({ id: 3 }) });
    expect(root.tagName).toBe("DIV");
    expect(root).toHaveClass("kanban-swimlane");
    expect(root).toHaveAttribute("data-swimlane", "3");
  });

  it("carries data-swimlane === '-1' for the synthetic unclassified swimlane", () => {
    const { root } = renderSwimlane({
      swimlane: makeSwimlane({ id: -1, name: "Unclassified" }),
    });
    expect(root).toHaveAttribute("data-swimlane", "-1");
  });

  it("renders the title button and the h2.title-name with the swimlane name", () => {
    const { title, container } = renderSwimlane({
      swimlane: makeSwimlane({ id: 3, name: "Swimlane A" }),
    });
    expect(title.tagName).toBe("BUTTON");
    expect(title).toHaveAttribute("type", "button");
    expect(title).toHaveClass("kanban-swimlane-title");
    const heading = container.querySelector("h2.title-name") as HTMLElement;
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent("Swimlane A");
  });

  it("shows the unfold-action icon (#icon-unfolded-swimlane) when NOT folded and omits the folded class", () => {
    const { title, container } = renderSwimlane({ folded: false });
    expect(title).not.toHaveClass("folded");
    const unfold = container.querySelector(".unfold-action");
    expect(unfold).toBeInTheDocument();
    expect(unfold).toHaveClass("icon", "icon-unfolded-swimlane");
    expect(iconUseHref(unfold)).toBe("#icon-unfolded-swimlane");
    // The fold-action icon must NOT be present in the expanded state.
    expect(container.querySelector(".fold-action")).toBeNull();
  });

  it("shows the fold-action icon (#icon-folded-swimlane) and the folded class when folded", () => {
    const { title, container } = renderSwimlane({ folded: true });
    expect(title).toHaveClass("folded");
    const fold = container.querySelector(".fold-action");
    expect(fold).toBeInTheDocument();
    expect(fold).toHaveClass("icon", "icon-folded-swimlane");
    expect(iconUseHref(fold)).toBe("#icon-folded-swimlane");
    expect(container.querySelector(".unfold-action")).toBeNull();
  });

  it("adds the unclassified classes and renders the help tooltip for swimlane id -1", () => {
    const { title, container } = renderSwimlane({
      swimlane: makeSwimlane({ id: -1, name: "Unclassified" }),
    });
    expect(title).toHaveClass("unclassified-swimlane");
    expect(container.querySelector("h2.title-name")).toHaveClass(
      "unclassified-us-title",
    );
    const info = container.querySelector(".unclassified-us-info");
    expect(info).toBeInTheDocument();
    const tooltip = container.querySelector(".unclassified-us-info .tooltip.pop-help");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent(
      "The user stories that are not part of any swimlane are here.",
    );
    // The help-circle icon is present inside the info block.
    expect(iconUseHref(info!.querySelector(".icon-help-circle"))).toBe(
      "#icon-help-circle",
    );
  });

  it("does NOT render the unclassified info block for a classified swimlane", () => {
    const { title, container } = renderSwimlane({
      swimlane: makeSwimlane({ id: 3 }),
    });
    expect(title).not.toHaveClass("unclassified-swimlane");
    expect(container.querySelector("h2.title-name")).not.toHaveClass(
      "unclassified-us-title",
    );
    expect(container.querySelector(".unclassified-us-info")).toBeNull();
  });

  it("renders the default-swimlane star only when this is the default AND swimlaneCount > 1", () => {
    const { container } = renderSwimlane({
      swimlane: makeSwimlane({ id: 5, name: "Default one" }),
      defaultSwimlaneId: 5,
      swimlaneCount: 2,
    });
    const def = container.querySelector(".default-swimlane");
    expect(def).toBeInTheDocument();
    const star = def!.querySelector(".default-swimlane-icon");
    expect(star).toHaveClass("icon", "icon-star");
    expect(iconUseHref(star)).toBe("#icon-star");
    expect(def!.querySelector(".default-text")).toHaveTextContent("Default");
  });

  it("hides the default-swimlane star when only one swimlane exists", () => {
    const { container } = renderSwimlane({
      swimlane: makeSwimlane({ id: 5 }),
      defaultSwimlaneId: 5,
      swimlaneCount: 1,
    });
    expect(container.querySelector(".default-swimlane")).toBeNull();
  });

  it("hides the default-swimlane star when this swimlane is not the default", () => {
    const { container } = renderSwimlane({
      swimlane: makeSwimlane({ id: 3 }),
      defaultSwimlaneId: 5,
      swimlaneCount: 2,
    });
    expect(container.querySelector(".default-swimlane")).toBeNull();
  });

  it("hides the default-swimlane star when there is no default swimlane", () => {
    const { container } = renderSwimlane({
      swimlane: makeSwimlane({ id: 3 }),
      defaultSwimlaneId: null,
      swimlaneCount: 3,
    });
    expect(container.querySelector(".default-swimlane")).toBeNull();
  });

  it("omits the body (.kanban-table-body) entirely when folded", () => {
    const { container } = renderSwimlane({ folded: true });
    expect(container.querySelector(".kanban-table-body")).toBeNull();
    expect(container.querySelector(".mock-status-column")).toBeNull();
  });

  it("renders the body with one StatusColumn per status when expanded", () => {
    const statuses = [makeStatus(1), makeStatus(2), makeStatus(3)];
    const { container } = renderSwimlane({ folded: false, statuses });
    const body = container.querySelector(".kanban-table-body");
    expect(body).toBeInTheDocument();
    const inner = body!.querySelector(".kanban-table-inner");
    expect(inner).toBeInTheDocument();
    const columns = inner!.querySelectorAll(".mock-status-column");
    expect(columns).toHaveLength(3);
    expect(Array.from(columns).map((c) => c.getAttribute("data-status-id"))).toEqual(
      ["1", "2", "3"],
    );
  });

  it("renders an empty inner (no columns) when the status list is empty", () => {
    const { container } = renderSwimlane({ folded: false, statuses: [] });
    const inner = container.querySelector(".kanban-table-inner");
    expect(inner).toBeInTheDocument();
    expect(inner!.querySelectorAll(".mock-status-column")).toHaveLength(0);
  });
});

// --- Phase C: behaviour + prop forwarding ---------------------------------

describe("Swimlane — behaviour (Phase C)", () => {
  it("calls onToggleSwimlane(swimlane.id) when the title bar is clicked", () => {
    const onToggleSwimlane = jest.fn();
    const { title } = renderSwimlane({
      swimlane: makeSwimlane({ id: 42 }),
      onToggleSwimlane,
    });
    fireEvent.click(title);
    expect(onToggleSwimlane).toHaveBeenCalledTimes(1);
    expect(onToggleSwimlane).toHaveBeenCalledWith(42);
  });

  it("forwards swimlaneId === swimlane.id to every StatusColumn", () => {
    const { container } = renderSwimlane({
      swimlane: makeSwimlane({ id: 3 }),
      statuses: [makeStatus(1), makeStatus(2)],
    });
    const columns = container.querySelectorAll(".mock-status-column");
    expect(columns).toHaveLength(2);
    columns.forEach((column) => {
      expect(column).toHaveAttribute("data-swimlane-id", "3");
    });
  });

  it("forwards the per-status ordered storyIds from storiesByStatus", () => {
    const { container } = renderSwimlane({
      statuses: [makeStatus(1), makeStatus(2)],
      storiesByStatus: { 1: [10, 11], 2: [12] },
    });
    const [first, second] = Array.from(
      container.querySelectorAll(".mock-status-column"),
    );
    expect(first).toHaveAttribute("data-story-ids", "10,11");
    expect(second).toHaveAttribute("data-story-ids", "12");
  });

  it("forwards an empty storyIds array for a status missing from storiesByStatus", () => {
    const { container } = renderSwimlane({
      statuses: [makeStatus(9)],
      storiesByStatus: {},
    });
    const column = container.querySelector(".mock-status-column");
    expect(column).toHaveAttribute("data-story-ids", "");
  });

  it("resolves folded/maximized/minimized per status and forwards them", () => {
    const { container } = renderSwimlane({
      statuses: [makeStatus(1), makeStatus(2)],
      folds: { 1: true },
      unfoldStatusId: 2,
      isMaximized: (id) => id === 2,
      isMinimized: (id) => id === 1,
    });
    const [first, second] = Array.from(
      container.querySelectorAll(".mock-status-column"),
    );
    // Column 1: folded true, minimized true, not maximized, not the unfold target.
    expect(first).toHaveAttribute("data-status-id", "1");
    expect(first).toHaveAttribute("data-folded", "true");
    expect(first).toHaveAttribute("data-minimized", "true");
    expect(first).toHaveAttribute("data-maximized", "false");
    expect(first).toHaveAttribute("data-unfold", "false");
    // Column 2: not folded, maximized true, the unfold target.
    expect(second).toHaveAttribute("data-status-id", "2");
    expect(second).toHaveAttribute("data-folded", "false");
    expect(second).toHaveAttribute("data-maximized", "true");
    expect(second).toHaveAttribute("data-minimized", "false");
    expect(second).toHaveAttribute("data-unfold", "true");
  });

  it("resolves showPlaceholder(statusId, swimlaneId) per status and forwards the result", () => {
    const showPlaceholder = jest.fn(
      (statusId: number, swimlaneId: number | null) =>
        statusId === 2 && swimlaneId === 3,
    );
    const { container } = renderSwimlane({
      swimlane: makeSwimlane({ id: 3 }),
      statuses: [makeStatus(1), makeStatus(2)],
      showPlaceholder,
    });
    const [first, second] = Array.from(
      container.querySelectorAll(".mock-status-column"),
    );
    expect(first).toHaveAttribute("data-show-placeholder", "false");
    expect(second).toHaveAttribute("data-show-placeholder", "true");
    expect(showPlaceholder).toHaveBeenCalledWith(1, 3);
    expect(showPlaceholder).toHaveBeenCalledWith(2, 3);
  });

  it("forwards board-level flags (renderInProgress, notFoundUserstories) to every column", () => {
    const { container } = renderSwimlane({
      statuses: [makeStatus(1)],
      renderInProgress: true,
      notFoundUserstories: true,
    });
    const column = container.querySelector(".mock-status-column");
    expect(column).toHaveAttribute("data-render-in-progress", "true");
    expect(column).toHaveAttribute("data-not-found", "true");
  });
});
