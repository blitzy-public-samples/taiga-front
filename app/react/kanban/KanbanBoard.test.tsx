/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest + @testing-library/react component tests for {@link KanbanBoard}.
 *
 * `KanbanBoard` is the React reproduction of the AngularJS `KanbanController` +
 * the board DOM (`app/partials/kanban/kanban.jade` +
 * `app/partials/includes/modules/kanban-table.jade`). Because the AngularJS ->
 * React migration must be DOM/CSS-identical, these tests assert the EXACT element
 * tree, class names, `data-*`/marker attributes, and the CONTRACTUAL `.options`
 * ordering the legacy Jade + the ported Playwright page objects depend on.
 *
 * They exercise the file's Phase A (compile/types — implicitly, via ts-jest),
 * Phase B (DOM / e2e selector parity) and Phase C (behaviour) validation
 * checklists and every branch of `KanbanBoard.tsx` (module-disabled guard,
 * loading vs. loaded, filter open/closed, swimlane vs. non-swimlane, the
 * swimlane-add gate across its three conditions, the permission gate on
 * add/bulk, all four lightbox states, the drag-end wiring, and the
 * `--kanban-width` ResizeObserver), so it contributes to the >= 70% line-coverage
 * gate for the new React code.
 *
 * Conventions (matching the sibling React specs, e.g. Swimlane.test.tsx):
 *   - The automatic JSX runtime is used, so there is no `import React`.
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`) are used directly.
 *   - `@testing-library/jest-dom` matchers are registered by `jest.setup.ts`.
 *   - The child components (`KanbanHeader`, `Swimlane`, `StatusColumn`), the
 *     `useKanbanStories` hook, the `./dnd` drag-end glue, and `@dnd-kit/core`'s
 *     `DndContext` are all MOCKED so the unit under test is exactly what
 *     `KanbanBoard` itself renders/forwards. The mock child factories pull React
 *     in via `require` (Jest hoists `jest.mock` above the imports) and echo the
 *     forwarded props as `data-*` attributes.
 */

import { cleanup, fireEvent, render } from "@testing-library/react";

import { KanbanBoard } from "./KanbanBoard";
import { useKanbanStories } from "./hooks/useKanbanStories";
import { useKanbanDragEnd } from "./dnd";

/* -------------------------------------------------------------------------- */
/* Mocks                                                                       */
/* -------------------------------------------------------------------------- */

// Mock `KanbanHeader`: echoes the forwarded controlled props as data-* and
// exposes buttons to drive the `onToggleFilter`/`onSetZoom`/`onChangeQ` callbacks
// upward so the board's state-forwarding can be asserted.
jest.mock("./KanbanHeader", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const react = require("react");
  return {
    KanbanHeader: (props: {
      openFilter: boolean;
      onToggleFilter: () => void;
      selectedFiltersCount: number;
      filterQ: string;
      onChangeQ: (q: string) => void;
      zoomLevel: number;
      onSetZoom: (index: number) => void;
    }) =>
      react.createElement(
        "div",
        {
          className: "mock-kanban-header",
          "data-testid": "kanban-header",
          "data-open-filter": String(props.openFilter),
          "data-selected-filters-count": String(props.selectedFiltersCount),
          "data-filter-q": String(props.filterQ),
          "data-zoom-level": String(props.zoomLevel),
        },
        react.createElement("button", {
          type: "button",
          className: "mock-toggle-filter",
          onClick: props.onToggleFilter,
        }),
        react.createElement("button", {
          type: "button",
          className: "mock-set-zoom-2",
          onClick: () => props.onSetZoom(2),
        }),
        react.createElement("button", {
          type: "button",
          className: "mock-change-q",
          onClick: () => props.onChangeQ("hello"),
        }),
      ),
  };
});

// Mock `Swimlane`: echoes the identity + gate-relevant props so the board's
// per-swimlane mapping can be asserted without pulling in the real component.
jest.mock("./Swimlane", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const react = require("react");
  return {
    Swimlane: (props: {
      swimlane: { id: number };
      folded: boolean;
      swimlaneCount: number;
      defaultSwimlaneId: number | null;
    }) =>
      react.createElement("div", {
        className: "mock-swimlane",
        "data-testid": "swimlane",
        "data-swimlane-id": String(props.swimlane.id),
        "data-folded": String(!!props.folded),
        "data-swimlane-count": String(props.swimlaneCount),
        "data-default-swimlane-id": String(props.defaultSwimlaneId),
      }),
  };
});

// Mock `StatusColumn`: the stub carries the REAL body-column classes
// (`kanban-uses-box taskboard-column`) so the board's `--kanban-width`
// ResizeObserver query (`.kanban-uses-box.taskboard-column`) resolves to it, plus
// a `.mock-status-column` hook the specs count.
jest.mock("./StatusColumn", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const react = require("react");
  return {
    StatusColumn: (props: {
      status: { id: number };
      storyIds: number[];
      folded: boolean;
      maximized?: boolean;
      minimized?: boolean;
    }) =>
      react.createElement("div", {
        className: "kanban-uses-box taskboard-column task-column mock-status-column",
        "data-testid": "status-column",
        "data-status-id": String(props.status.id),
        "data-story-ids": (props.storyIds || []).join(","),
        "data-folded": String(!!props.folded),
        "data-maximized": String(!!props.maximized),
        "data-minimized": String(!!props.minimized),
      }),
  };
});

// Mock the `useKanbanStories` hook: the board is a pure consumer, so the hook is
// replaced with a jest.fn() whose return value each test drives via `makeKb`.
jest.mock("./hooks/useKanbanStories", () => ({
  __esModule: true,
  useKanbanStories: jest.fn(),
}));

// Mock the `./dnd` drag-end glue: `useKanbanDragEnd` returns a stable handler so
// the board's DndContext wiring can be asserted (handler passed + called with kb).
jest.mock("./dnd", () => {
  const handler = jest.fn();
  return {
    __esModule: true,
    useKanbanDragEnd: jest.fn(() => handler),
  };
});

// Mock `@dnd-kit/core`: `DndContext` becomes a plain div echoing whether it
// received an `onDragEnd` function + the `autoScroll` flag; the sensor helpers
// are inert stubs (the real pointer sensor is not needed for a DOM unit test).
// The most recent props DndContext received are captured on `__dndState` so a
// spec can assert the EXACT `onDragEnd` handler identity (it must be the fn
// returned by the mocked `useKanbanDragEnd`, not merely "some function").
jest.mock("@dnd-kit/core", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const react = require("react");
  const dndState: { lastProps: { onDragEnd?: unknown; autoScroll?: unknown } | null } = {
    lastProps: null,
  };
  return {
    __esModule: true,
    __dndState: dndState,
    DndContext: (props: { onDragEnd?: unknown; autoScroll?: unknown; children?: unknown }) => {
      dndState.lastProps = { onDragEnd: props.onDragEnd, autoScroll: props.autoScroll };
      return react.createElement(
        "div",
        {
          "data-testid": "dnd-context",
          "data-has-drag-end": String(typeof props.onDragEnd === "function"),
          "data-autoscroll": String(!!props.autoScroll),
        },
        props.children,
      );
    },
    PointerSensor: function PointerSensor() {
      /* inert sensor stub */
    },
    useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
    useSensors: (...descriptors: unknown[]) => descriptors,
  };
});

// The mocked hook — cast to a Jest mock so we can drive its return value per test.
const mockedUseKanbanStories = useKanbanStories as unknown as jest.Mock;
const mockedUseKanbanDragEnd = useKanbanDragEnd as unknown as jest.Mock;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const CONTEXT = {
  projectSlug: "proj-1",
  token: "jwt-token",
  sessionId: "session-1",
  apiUrl: "http://localhost:8000/api/v1/",
  eventsUrl: null,
  language: "en",
};

interface ProjectOverrides {
  [key: string]: unknown;
}

function makeProject(overrides: ProjectOverrides = {}) {
  return {
    id: 1,
    slug: "proj-1",
    name: "My Project",
    my_permissions: ["add_us", "modify_us"],
    is_kanban_activated: true,
    is_backlog_activated: true,
    members: [],
    ...overrides,
  };
}

function makeStatus(id: number, overrides: ProjectOverrides = {}) {
  return {
    id,
    name: `Status ${id}`,
    color: "#aabbcc",
    is_archived: false,
    wip_limit: null,
    ...overrides,
  };
}

function makeSwimlane(id: number, overrides: ProjectOverrides = {}) {
  return { id, name: `Swimlane ${id}`, order: id, ...overrides };
}

// Build a complete `useKanbanStories` return surface. Every member `KanbanBoard`
// destructures is present; actions are jest.fn()s so behaviour can be asserted.
function makeKb(overrides: ProjectOverrides = {}) {
  return {
    initialLoad: true,
    project: makeProject(),
    projectId: 1,
    isAdmin: false,
    renderInProgress: false,
    notFoundUserstories: false,
    error: null,
    usStatusList: [],
    swimlanesList: [],
    swimlanesStatuses: {},
    usByStatus: {},
    usByStatusSwimlanes: {},
    usMap: {},
    usersById: {},
    folds: {},
    foldedSwimlane: {},
    foldStatusChanged: {},
    unfold: null,
    selectedUss: {},
    movedUs: [],
    usCardVisibility: {},
    defaultSwimlaneId: null,
    zoom: [],
    zoomLevel: 1,
    setZoom: jest.fn(),
    filters: null,
    customFilters: [],
    selectedFilters: [],
    filterQ: "",
    changeQ: jest.fn(),
    addFilter: jest.fn(),
    saveCustomFilter: jest.fn(),
    selectCustomFilter: jest.fn(),
    removeCustomFilter: jest.fn(),
    removeFilter: jest.fn(),
    handleDragEnd: jest.fn(),
    toggleSwimlane: jest.fn(),
    foldStatus: jest.fn(),
    toggleFold: jest.fn(),
    addNewUs: jest.fn(),
    editUs: jest.fn(),
    deleteUs: jest.fn(),
    changeUsAssignedUsers: jest.fn(),
    moveToTopDropdown: jest.fn(),
    toggleSelectedUs: jest.fn(),
    editWipLimit: jest.fn(),
    showArchivedStatus: jest.fn(),
    setColumnMode: jest.fn(),
    isMaximized: jest.fn(() => false),
    isMinimized: jest.fn(() => false),
    isUsInArchivedHiddenStatus: jest.fn(() => false),
    showPlaceHolder: jest.fn(() => false),
    activeLightbox: null,
    closeLightbox: jest.fn(),
    submitNewUs: jest.fn(),
    submitBulkUs: jest.fn(),
    ...overrides,
  };
}

function renderBoard() {
  return render(<KanbanBoard context={CONTEXT} />);
}

/* -------------------------------------------------------------------------- */
/* Test lifecycle                                                              */
/* -------------------------------------------------------------------------- */

// jsdom does not implement ResizeObserver; provide a minimal class so the board's
// effect body runs (covering the observe/recompute/disconnect path).
class MockResizeObserver {
  constructor(_callback: ResizeObserverCallback) {
    /* store nothing; recompute() is invoked directly by the effect */
  }
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
  document.body.style.removeProperty("--kanban-width");
  mockedUseKanbanStories.mockReturnValue(makeKb());
});

afterEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* Phase B — Module activation + loading gates                                 */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — module activation + loading", () => {
  it("renders a minimal disabled placeholder when the kanban module is deactivated", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ project: makeProject({ is_kanban_activated: false }) }),
    );
    const { container } = renderBoard();

    expect(container.querySelector(".module-disabled")).toBeInTheDocument();
    // No board, no lightbox hosts in the disabled placeholder branch.
    expect(container.querySelector(".kanban-table")).not.toBeInTheDocument();
    expect(container.querySelector("[tg-lb-create-edit-userstory]")).not.toBeInTheDocument();
  });

  it("renders the loading placeholder (no .kanban-table) until initialLoad is true", () => {
    mockedUseKanbanStories.mockReturnValue(makeKb({ initialLoad: false }));
    const { container } = renderBoard();

    expect(container.querySelector(".kanban-table-loading")).toBeInTheDocument();
    expect(container.querySelector(".kanban-table")).not.toBeInTheDocument();
    // The section + header + lightbox hosts still render.
    expect(container.querySelector("section.main.kanban")).toBeInTheDocument();
    expect(container.querySelector("[tg-lb-create-edit-userstory]")).toBeInTheDocument();
  });

  it("does not render the board while the project context is still null", () => {
    mockedUseKanbanStories.mockReturnValue(makeKb({ project: null }));
    const { container } = renderBoard();

    expect(container.querySelector(".kanban-table")).not.toBeInTheDocument();
    expect(container.querySelector(".kanban-table-loading")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Phase B — Section + header (no wrapper / no project-menu)                    */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — section + header", () => {
  it("returns section.main.kanban and never renders div.wrapper or tg-project-menu", () => {
    const { container } = renderBoard();
    const section = container.querySelector("section.main.kanban");

    expect(section).toBeInTheDocument();
    expect(container.querySelector(".wrapper")).not.toBeInTheDocument();
    expect(container.querySelector("tg-project-menu")).not.toBeInTheDocument();
    expect(container.querySelector("tg-project-archived-warning")).not.toBeInTheDocument();
  });

  it("adds the swimlane class to the section only in swimlane mode", () => {
    const { container, rerender } = renderBoard();
    expect(container.querySelector("section.main.kanban")).not.toHaveClass("swimlane");

    mockedUseKanbanStories.mockReturnValue(
      makeKb({ swimlanesList: [makeSwimlane(1)], usStatusList: [makeStatus(10)] }),
    );
    rerender(<KanbanBoard context={CONTEXT} />);
    expect(container.querySelector("section.main.kanban")).toHaveClass("swimlane");
  });

  it("reproduces the mainTitle header (header > h1.main-title) with the project name + section label", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ project: makeProject({ name: "Acme Board" }) }),
    );
    const { container } = renderBoard();

    const heading = container.querySelector(".kanban-header header h1.main-title");
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent("Acme Board");
    expect(heading?.querySelector("span")).toHaveTextContent("Kanban");
  });

  it("renders KanbanHeader inside .kanban-header and forwards the controlled props", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ zoomLevel: 3, selectedFilters: [{}, {}], filterQ: "abc" }),
    );
    const { container } = renderBoard();

    const header = container.querySelector(".kanban-header .mock-kanban-header");
    expect(header).toBeInTheDocument();
    expect(header).toHaveAttribute("data-open-filter", "false");
    expect(header).toHaveAttribute("data-zoom-level", "3");
    expect(header).toHaveAttribute("data-selected-filters-count", "2");
    expect(header).toHaveAttribute("data-filter-q", "abc");
  });
});

/* -------------------------------------------------------------------------- */
/* Phase B/C — Manager + filter panel                                          */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — manager + filter panel", () => {
  it("marks .kanban-manager expanded when the filter is closed and hides the filter panel", () => {
    const { container } = renderBoard();
    expect(container.querySelector(".kanban-manager")).toHaveClass("expanded");
    expect(container.querySelector(".kanban-filter")).not.toBeInTheDocument();
  });

  it("toggles the filter panel + expanded class when KanbanHeader reports onToggleFilter", () => {
    const { container } = renderBoard();

    fireEvent.click(container.querySelector(".mock-toggle-filter") as Element);

    expect(container.querySelector(".kanban-manager")).not.toHaveClass("expanded");
    const panel = container.querySelector(".kanban-filter");
    expect(panel).toBeInTheDocument();
    expect(panel?.querySelector("tg-filter")).toBeInTheDocument();
    // The mock header now reflects the flipped state.
    expect(container.querySelector(".mock-kanban-header")).toHaveAttribute("data-open-filter", "true");

    // Toggling again collapses it.
    fireEvent.click(container.querySelector(".mock-toggle-filter") as Element);
    expect(container.querySelector(".kanban-filter")).not.toBeInTheDocument();
    expect(container.querySelector(".kanban-manager")).toHaveClass("expanded");
  });

  it("wires the filter panel chips to the hook filter handlers", () => {
    const selected = [{ id: "s1" }];
    const custom = [{ id: "c1" }];
    const kb = makeKb({ selectedFilters: selected, customFilters: custom });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    fireEvent.click(container.querySelector(".mock-toggle-filter") as Element);

    fireEvent.click(container.querySelector(".filters-applied .filter-applied") as Element);
    expect(kb.removeFilter).toHaveBeenCalledWith(selected[0]);

    fireEvent.click(container.querySelector(".custom-filter .custom-filter-select") as Element);
    expect(kb.selectCustomFilter).toHaveBeenCalledWith(custom[0]);

    fireEvent.click(container.querySelector(".custom-filter .custom-filter-remove") as Element);
    expect(kb.removeCustomFilter).toHaveBeenCalledWith(custom[0]);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase B — Board table classes + directive tags                              */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — .kanban-table", () => {
  it("emits zoom-{level} and (swimlane mode) kanban-table-swimlane and the inert directive tags", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ zoomLevel: 2, swimlanesList: [makeSwimlane(1)], usStatusList: [makeStatus(10)] }),
    );
    const { container } = renderBoard();

    const table = container.querySelector(".kanban-table");
    expect(table).toBeInTheDocument();
    expect(table).toHaveClass("zoom-2");
    expect(table).toHaveClass("kanban-table-swimlane");
    expect(table).toHaveAttribute("tg-kanban");
    expect(table).toHaveAttribute("tg-kanban-swimlane");
    expect(table).toHaveAttribute("tg-kanban-sortable");
    expect(table).toHaveAttribute("tg-kanban-squish-column");
  });

  it("omits kanban-table-swimlane in non-swimlane mode and reflects the zoom level", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ zoomLevel: 0, usStatusList: [makeStatus(10)] }),
    );
    const { container } = renderBoard();

    const table = container.querySelector(".kanban-table");
    expect(table).toHaveClass("zoom-0");
    expect(table).not.toHaveClass("kanban-table-swimlane");
  });
});

/* -------------------------------------------------------------------------- */
/* Phase B/C — Header row: task-colum-name + .options ordering + permissions    */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — header row + options ordering", () => {
  it("renders one h2.task-colum-name (SIC one 'm') per status, not .task-column", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ usStatusList: [makeStatus(10), makeStatus(20), makeStatus(30)] }),
    );
    const { container } = renderBoard();

    const headers = container.querySelectorAll(".kanban-table-header .task-colum-name");
    expect(headers).toHaveLength(3);
    headers.forEach((h2) => {
      expect(h2.tagName).toBe("H2");
      expect(h2).not.toHaveClass("task-column");
    });
    // The class is the shipped legacy typo with ONE 'm' (`task-colum-name`). The
    // "correct" two-'m' spelling must NOT appear anywhere in the board DOM, or the
    // unchanged SCSS + the ported Playwright page objects would fail to select it.
    expect(container.querySelectorAll(".task-column-name")).toHaveLength(0);
  });

  it("adds .vfold to the folded header cell but NOT .task-column", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ usStatusList: [makeStatus(10)], folds: { 10: true } }),
    );
    const { container } = renderBoard();

    const header = container.querySelector(".task-colum-name");
    expect(header).toHaveClass("vfold");
    expect(header).not.toHaveClass("task-column");
    // The .deco-square is hidden when folded.
    expect(header?.querySelector(".deco-square")).toHaveClass("hidden");
  });

  it("orders .options as [fold a, unfold a, add button, bulk button] when add_us is granted", () => {
    mockedUseKanbanStories.mockReturnValue(makeKb({ usStatusList: [makeStatus(10)] }));
    const { container } = renderBoard();

    const options = container.querySelector(".task-colum-name .options") as Element;
    const optionEls = options.querySelectorAll(".option");
    const anchors = options.querySelectorAll("a");

    expect(anchors).toHaveLength(2); // fold + unfold are the only <a> elements
    expect(optionEls).toHaveLength(4); // fold, unfold, add, bulk
    expect(optionEls[2].tagName).toBe("BUTTON"); // .option index 2 == the add button
    expect(optionEls[3].tagName).toBe("BUTTON"); // .option index 3 == the bulk button
    // The bulk button's inner svg carries .icon-bulk (openBulkUsLb target).
    expect(optionEls[3].querySelector(".icon-bulk")).toBeInTheDocument();
    expect(container.querySelectorAll(".icon-bulk")).toHaveLength(1);
    // Icons render through the reproduced `tg-svg` wrapper (matching the legacy
    // `tgSvg` directive output `<tg-svg><svg class="icon icon-…">`). Assert BOTH
    // the `tg-svg` wrapper element AND the inner `svg.icon-*` exist on the add and
    // bulk options, so the unchanged SCSS's `tg-svg` selectors and the e2e
    // `.icon-*` selectors both resolve against the migrated DOM.
    expect(optionEls[2].querySelector("tg-svg")).toBeInTheDocument();
    expect(optionEls[2].querySelector("tg-svg > svg.icon.icon-add")).toBeInTheDocument();
    expect(optionEls[3].querySelector("tg-svg")).toBeInTheDocument();
    expect(optionEls[3].querySelector("tg-svg > svg.icon.icon-bulk")).toBeInTheDocument();
  });

  it("hides the add + bulk buttons when the add_us permission is absent", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        usStatusList: [makeStatus(10)],
        project: makeProject({ my_permissions: ["modify_us"] }),
      }),
    );
    const { container } = renderBoard();

    const options = container.querySelector(".task-colum-name .options") as Element;
    expect(options.querySelectorAll(".option")).toHaveLength(2); // fold + unfold only
    expect(options.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelector(".icon-bulk")).not.toBeInTheDocument();
  });

  it("hides the add + bulk buttons for an archived status even with add_us", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ usStatusList: [makeStatus(10, { is_archived: true })] }),
    );
    const { container } = renderBoard();

    const options = container.querySelector(".task-colum-name .options") as Element;
    expect(options.querySelectorAll("button")).toHaveLength(0);
    expect(options.querySelectorAll("a")).toHaveLength(2);
  });

  it("invokes foldStatus / addNewUs from the header controls", () => {
    const status = makeStatus(10);
    const kb = makeKb({ usStatusList: [status] });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    const options = container.querySelector(".task-colum-name .options") as Element;
    const anchors = options.querySelectorAll("a");
    const buttons = options.querySelectorAll("button");

    fireEvent.click(anchors[0]); // fold
    expect(kb.foldStatus).toHaveBeenCalledWith(status);

    fireEvent.click(anchors[1]); // unfold (also foldStatus in the legacy toggle)
    expect(kb.foldStatus).toHaveBeenCalledTimes(2);

    fireEvent.click(buttons[0]); // add
    expect(kb.addNewUs).toHaveBeenCalledWith("standard", 10);

    fireEvent.click(buttons[1]); // bulk
    expect(kb.addNewUs).toHaveBeenCalledWith("bulk", 10);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase B — Body branch: swimlane vs non-swimlane                              */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — body branch", () => {
  it("non-swimlane mode renders one .kanban-table-body > .kanban-table-inner with a StatusColumn per status", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        usStatusList: [makeStatus(10), makeStatus(20)],
        usByStatus: { "10": [1, 2], "20": [3] },
      }),
    );
    const { container } = renderBoard();

    const body = container.querySelector(".kanban-table > .kanban-table-body > .kanban-table-inner");
    expect(body).toBeInTheDocument();
    expect(container.querySelectorAll(".mock-status-column")).toHaveLength(2);
    expect(container.querySelector(".mock-swimlane")).not.toBeInTheDocument();
    expect(container.querySelector("a.kanban-swimlane-add")).not.toBeInTheDocument();
    // storyIds are forwarded per status.
    const firstColumn = container.querySelector('[data-status-id="10"]');
    expect(firstColumn).toHaveAttribute("data-story-ids", "1,2");
  });

  it("swimlane mode renders one Swimlane per swimlane (each owns its body) and no top-level table body", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        usStatusList: [makeStatus(10)],
        swimlanesList: [makeSwimlane(1), makeSwimlane(2)],
        foldedSwimlane: { 2: true },
        defaultSwimlaneId: 1,
      }),
    );
    const { container } = renderBoard();

    const swimlanes = container.querySelectorAll(".mock-swimlane");
    expect(swimlanes).toHaveLength(2);
    // The board does not render its own .kanban-table-body in swimlane mode.
    expect(
      container.querySelector(".kanban-table > .kanban-table-body"),
    ).not.toBeInTheDocument();
    // Fold + count + default id forwarded.
    expect(container.querySelector('[data-swimlane-id="2"]')).toHaveAttribute("data-folded", "true");
    expect(container.querySelector('[data-swimlane-id="1"]')).toHaveAttribute("data-folded", "false");
    expect(swimlanes[0]).toHaveAttribute("data-swimlane-count", "2");
    expect(swimlanes[0]).toHaveAttribute("data-default-swimlane-id", "1");
  });
});

/* -------------------------------------------------------------------------- */
/* Phase B — a.kanban-swimlane-add gate (three conditions)                      */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — swimlane-add link gate", () => {
  it("renders exactly ONE a.kanban-swimlane-add when admin and swimlane count <= 1", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        usStatusList: [makeStatus(10)],
        swimlanesList: [makeSwimlane(1)],
        isAdmin: true,
        project: makeProject({ slug: "acme" }),
      }),
    );
    const { container } = renderBoard();

    const links = container.querySelectorAll("a.kanban-swimlane-add");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "#/project/acme/admin/project-values/kanban");
  });

  it("does not render the swimlane-add link when the user is not an admin", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        usStatusList: [makeStatus(10)],
        swimlanesList: [makeSwimlane(1)],
        isAdmin: false,
      }),
    );
    const { container } = renderBoard();
    expect(container.querySelector("a.kanban-swimlane-add")).not.toBeInTheDocument();
  });

  it("does not render the swimlane-add link when there is more than one swimlane", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        usStatusList: [makeStatus(10)],
        swimlanesList: [makeSwimlane(1), makeSwimlane(2)],
        isAdmin: true,
      }),
    );
    const { container } = renderBoard();
    expect(container.querySelector("a.kanban-swimlane-add")).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Phase B/C — Lightbox hosts                                                  */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — lightbox hosts", () => {
  it("renders all three hosts (hidden) by default with the e2e marker attributes", () => {
    const { container } = renderBoard();

    const createEdit = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
    const bulk = container.querySelector("[tg-lb-create-bulk-userstories]") as HTMLElement;
    const assign = container.querySelector("[tg-lb-assignedto]") as HTMLElement;

    expect(createEdit).toBeInTheDocument();
    expect(bulk).toBeInTheDocument();
    expect(assign).toBeInTheDocument();
    expect(createEdit).toHaveStyle({ display: "none" });
    expect(bulk).toHaveStyle({ display: "none" });
    expect(assign).toHaveStyle({ display: "none" });
    expect(createEdit).toHaveClass("lightbox", "lightbox-create-edit");
  });

  it("shows the create/edit host for the create AND edit lightbox states", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ activeLightbox: { type: "create", statusId: 10 } }),
    );
    const { container, rerender } = renderBoard();
    expect(container.querySelector("[tg-lb-create-edit-userstory]")).toHaveStyle({ display: "flex" });

    mockedUseKanbanStories.mockReturnValue(makeKb({ activeLightbox: { type: "edit", usId: 5 } }));
    rerender(<KanbanBoard context={CONTEXT} />);
    expect(container.querySelector("[tg-lb-create-edit-userstory]")).toHaveStyle({ display: "flex" });
  });

  it("shows the bulk host for the bulk lightbox state", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ activeLightbox: { type: "bulk", statusId: 10 } }),
    );
    const { container } = renderBoard();
    expect(container.querySelector("[tg-lb-create-bulk-userstories]")).toHaveStyle({ display: "flex" });
    expect(container.querySelector("[tg-lb-create-edit-userstory]")).toHaveStyle({ display: "none" });
  });

  it("shows the assign host + member list for the assign lightbox state", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        activeLightbox: { type: "assign", usId: 5 },
        project: makeProject({
          members: [
            { id: 1, full_name_display: "Ada Lovelace" },
            { id: 2, username: "grace" },
          ],
        }),
      }),
    );
    const { container } = renderBoard();

    const assign = container.querySelector("[tg-lb-assignedto]") as HTMLElement;
    expect(assign).toHaveStyle({ display: "flex" });
    const items = assign.querySelectorAll(".user-list-single");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Ada Lovelace");
    expect(items[1]).toHaveTextContent("grace");
  });

  it("submits the create form to submitNewUs and closes via closeLightbox", () => {
    const kb = makeKb({ activeLightbox: { type: "create", statusId: 10 } });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    const host = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
    const input = host.querySelector('input[name="subject"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "A brand new story" } });
    fireEvent.submit(host.querySelector("form") as HTMLFormElement);
    expect(kb.submitNewUs).toHaveBeenCalledWith("A brand new story");

    fireEvent.click(host.querySelector("button.close") as Element);
    expect(kb.closeLightbox).toHaveBeenCalledTimes(1);
  });

  it("submits the bulk form to submitBulkUs", () => {
    const kb = makeKb({ activeLightbox: { type: "bulk", statusId: 10 } });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    const host = container.querySelector("[tg-lb-create-bulk-userstories]") as HTMLElement;
    const textarea = host.querySelector('textarea[name="bulk"]') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "US 1\nUS 2" } });
    fireEvent.submit(host.querySelector("form") as HTMLFormElement);
    expect(kb.submitBulkUs).toHaveBeenCalledWith("US 1\nUS 2");
  });
});

/* -------------------------------------------------------------------------- */
/* Phase C — Drag-and-drop wiring                                              */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — drag-and-drop wiring", () => {
  it("builds the drag-end handler from the hook and passes it (with autoScroll) to DndContext", () => {
    const kb = makeKb({ usStatusList: [makeStatus(10)] });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    expect(mockedUseKanbanDragEnd).toHaveBeenCalledWith(kb);
    const dnd = container.querySelector('[data-testid="dnd-context"]');
    expect(dnd).toHaveAttribute("data-has-drag-end", "true");
    expect(dnd).toHaveAttribute("data-autoscroll", "true");

    // The handler passed to DndContext is EXACTLY the fn returned by the mocked
    // useKanbanDragEnd (the board forwards it verbatim — it does not wrap or
    // recreate it), so the single-bulk-update-per-drop contract stays in `./dnd`.
    const returnedHandler = mockedUseKanbanDragEnd.mock.results[0]?.value;
    const dndMock = jest.requireMock("@dnd-kit/core") as {
      __dndState: { lastProps: { onDragEnd?: unknown; autoScroll?: unknown } | null };
    };
    expect(dndMock.__dndState.lastProps?.onDragEnd).toBe(returnedHandler);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase C — Zoom + search forwarding (hook-owned, board only forwards)         */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — zoom + search forwarding", () => {
  it("forwards zoom + search callbacks to KanbanHeader without recomputing them", () => {
    const kb = makeKb({ zoomLevel: 1 });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    fireEvent.click(container.querySelector(".mock-set-zoom-2") as Element);
    expect(kb.setZoom).toHaveBeenCalledWith(2);

    fireEvent.click(container.querySelector(".mock-change-q") as Element);
    expect(kb.changeQ).toHaveBeenCalledWith("hello");
  });
});

/* -------------------------------------------------------------------------- */
/* Phase C — --kanban-width ResizeObserver                                     */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — --kanban-width ResizeObserver", () => {
  it("sets --kanban-width from the summed column widths when columns have width", () => {
    const widthSpy = jest
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(120);
    try {
      mockedUseKanbanStories.mockReturnValue(
        makeKb({ usStatusList: [makeStatus(10), makeStatus(20)] }),
      );
      renderBoard();
      // Two mock columns (.kanban-uses-box.taskboard-column) * 120px = 240px.
      expect(document.body.style.getPropertyValue("--kanban-width")).toBe("240px");
    } finally {
      widthSpy.mockRestore();
    }
  });

  it("does not throw when ResizeObserver is unavailable (jsdom guard)", () => {
    (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = undefined;
    mockedUseKanbanStories.mockReturnValue(makeKb({ usStatusList: [makeStatus(10)] }));
    expect(() => renderBoard()).not.toThrow();
  });
});
