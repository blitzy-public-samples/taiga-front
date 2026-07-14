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
 * checklists and every branch of `KanbanBoard.tsx` (module-activation guard,
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
        className: "kanban-uses-box taskboard-column mock-status-column",
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

// Mock the single `./dnd` provider (M6): `KanbanDndProvider` becomes a plain
// passthrough that records the props the board hands it (the drag `context`, the
// `renderOverlay` mirror renderer, the `enabled` flag) on `__providerState` and
// renders its children. The real drop-forwarding + overlay behaviour is proven
// in `dnd/KanbanDndProvider.test.tsx`; here we assert only the board's WIRING —
// that it forwards the exact hook return as the context and supplies a mirror
// renderer, with no hand-rolled DndContext.
jest.mock("./dnd", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const react = require("react");
  const providerState: {
    lastProps: {
      context?: unknown;
      onDrop?: unknown;
      renderOverlay?: unknown;
      enabled?: unknown;
    } | null;
  } = { lastProps: null };
  return {
    __esModule: true,
    __providerState: providerState,
    KanbanDndProvider: (props: {
      context?: unknown;
      onDrop?: unknown;
      renderOverlay?: unknown;
      enabled?: unknown;
      children?: unknown;
    }) => {
      providerState.lastProps = {
        context: props.context,
        onDrop: props.onDrop,
        renderOverlay: props.renderOverlay,
        enabled: props.enabled,
      };
      return react.createElement(
        "div",
        {
          "data-testid": "dnd-provider",
          "data-has-context": String(props.context != null),
          "data-has-render-overlay": String(typeof props.renderOverlay === "function"),
        },
        props.children,
      );
    },
  };
});

// The mocked hook — cast to a Jest mock so we can drive its return value per test.
const mockedUseKanbanStories = useKanbanStories as unknown as jest.Mock;

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
    roles: [],
    points: [],
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
    filters: [],
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
    // C7: delete-confirmation surface (closed by default in the fixture).
    pendingDelete: null,
    deleteBusy: false,
    confirmDelete: jest.fn(),
    cancelDelete: jest.fn(),
    changeUsAssignedUsers: jest.fn(),
    moveToTopDropdown: jest.fn(),
    toggleSelectedUs: jest.fn(),
    showArchivedStatus: jest.fn(),
    setColumnMode: jest.fn(),
    isMaximized: jest.fn(() => false),
    isMinimized: jest.fn(() => false),
    isUsInArchivedHiddenStatus: jest.fn(() => false),
    showPlaceHolder: jest.fn(() => false),
    activeLightbox: null,
    savingUs: false,
    errorMessage: null,
    closeLightbox: jest.fn(),
    submitNewUs: jest.fn(),
    submitEditUs: jest.fn(),
    submitBulkUs: jest.fn(),
    submitAssignedUsers: jest.fn(),
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
  it("renders the authoritative permission-denied page when the kanban module is deactivated (M5)", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ project: makeProject({ is_kanban_activated: false }) }),
    );
    const { container } = renderBoard();

    // M5: reproduce the legacy permission-denied.jade DOM (`.error-main`) with
    // the exact legacy i18n keys resolved through `t()` (English in tests).
    const errorMain = container.querySelector(".error-main");
    expect(errorMain).toBeInTheDocument();
    expect(errorMain?.querySelector("h1.logo")?.textContent).toBe(
      "Permission denied",
    );
    expect(errorMain?.querySelector("p")?.textContent).toBe(
      "You don't have permission to access this page.",
    );
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
/* Phase B — C7 delete confirmation modal                                      */
/* -------------------------------------------------------------------------- */

describe("KanbanBoard — C7 delete confirmation modal", () => {
  it("keeps the delete-confirm lightbox host present but CLOSED when there is no pending delete", () => {
    const { container } = renderBoard();
    const host = container.querySelector(".lightbox-generic-delete");
    // The shared Lightbox host is always mounted (marker attr resolves) ...
    expect(host).toBeInTheDocument();
    expect(host).toHaveAttribute("tg-lb-generic-delete");
    // ... but it is NOT open, and the confirm/cancel controls (content renders
    // only while open) are absent.
    expect(host).not.toHaveClass("open");
    expect(container.querySelector(".lightbox-generic-delete .js-confirm")).toBeNull();
  });

  it("opens the localized modal with the subject and wires confirm/cancel when a delete is pending", () => {
    const confirmDelete = jest.fn();
    const cancelDelete = jest.fn();
    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        pendingDelete: { target: 101, subject: "Delete this US" },
        confirmDelete,
        cancelDelete,
      }),
    );
    const { container } = renderBoard();

    const host = container.querySelector(".lightbox-generic-delete");
    expect(host).toHaveClass("open");
    // Legacy DOM: h2.title + span.subtitle + span.message (the subject).
    expect(container.querySelector(".lightbox-generic-delete .title")?.textContent).toBe(
      "Delete user story",
    );
    expect(container.querySelector(".lightbox-generic-delete .message")?.textContent).toBe(
      "Delete this US",
    );

    fireEvent.click(container.querySelector(".lightbox-generic-delete .js-confirm")!);
    expect(confirmDelete).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector(".lightbox-generic-delete .js-cancel")!);
    expect(cancelDelete).toHaveBeenCalledTimes(1);
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

  it("reproduces the mainTitle header (header > h1.main-title) with ONLY the section label - main-title.jade renders `span {{ sectionName | translate }}`, never the project name", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ project: makeProject({ name: "Acme Board" }) }),
    );
    const { container } = renderBoard();

    const heading = container.querySelector(".kanban-header header h1.main-title");
    expect(heading).toBeInTheDocument();
    // The section label (KANBAN.SECTION_NAME => "Kanban") is the SOLE title text.
    expect(heading?.querySelector("span")).toHaveTextContent("Kanban");
    // Legacy parity: the project NAME must NOT leak into the heading (it lives in
    // the AngularJS project menu, never in the reproduced mainTitle h1).
    expect(heading).not.toHaveTextContent("Acme Board");
    expect(heading?.textContent).toBe("Kanban");
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

  it("wires the shared filter panel (BacklogFilterPanel) to the hook handlers", () => {
    // The board now renders the FULL shared `tg-filter` panel (C11/C4), so the
    // params-based FilterChip / CustomFilter shapes drive its DOM: an applied
    // chip in `.filters-applied` and a saved row in `.custom-filter-list`.
    const selected = [
      { id: "s1", key: "tags:s1", dataType: "tags", name: "S1", mode: "include" },
    ];
    const custom = [{ id: "c1", name: "C1", filter: { tags: "s1" } }];
    const kb = makeKb({ selectedFilters: selected, customFilters: custom });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    fireEvent.click(container.querySelector(".mock-toggle-filter") as Element);

    // Remove an applied chip (the ✕ inside `.filters-applied`).
    fireEvent.click(
      container.querySelector(".filters-applied .remove-filter") as Element,
    );
    expect(kb.removeFilter).toHaveBeenCalledWith(selected[0]);

    // Apply a saved custom filter (its name button in the custom-filter list).
    fireEvent.click(
      container.querySelector(
        ".custom-filter-list .single-filter-type-custom .name",
      ) as Element,
    );
    expect(kb.selectCustomFilter).toHaveBeenCalledWith(custom[0]);

    // Remove a saved custom filter (its trash button).
    fireEvent.click(
      container.querySelector(".custom-filter-list .remove-filter") as Element,
    );
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

  it("orders .options as [add button, bulk button, fold a, unfold a] matching kanban-table.jade", () => {
    mockedUseKanbanStories.mockReturnValue(makeKb({ usStatusList: [makeStatus(10)] }));
    const { container } = renderBoard();

    const options = container.querySelector(".task-colum-name .options") as Element;
    const optionEls = options.querySelectorAll(".option");
    const anchors = options.querySelectorAll("a");

    expect(anchors).toHaveLength(2); // fold + unfold are the only <a> elements
    expect(optionEls).toHaveLength(4); // add, bulk, fold, unfold
    // Legacy `kanban-table.jade` (L30-59) renders add + bulk FIRST, then the
    // fold/unfold toggles. The E2E helper opens the new-US lightbox from the
    // column header's FIRST `.option`, so the add button MUST be index 0.
    expect(optionEls[0].tagName).toBe("BUTTON"); // .option index 0 == the add button
    expect(optionEls[1].tagName).toBe("BUTTON"); // .option index 1 == the bulk button
    expect(optionEls[2].tagName).toBe("A"); // .option index 2 == the fold control
    expect(optionEls[3].tagName).toBe("A"); // .option index 3 == the unfold control
    // The bulk button's inner svg carries .icon-bulk (openBulkUsLb target).
    expect(optionEls[1].querySelector(".icon-bulk")).toBeInTheDocument();
    expect(container.querySelectorAll(".icon-bulk")).toHaveLength(1);
    // Icons render through the reproduced `tg-svg` wrapper (matching the legacy
    // `tgSvg` directive output `<tg-svg><svg class="icon icon-…">`). Assert BOTH
    // the `tg-svg` wrapper element AND the inner `svg.icon-*` exist on the add and
    // bulk options, so the unchanged SCSS's `tg-svg` selectors and the e2e
    // `.icon-*` selectors both resolve against the migrated DOM.
    expect(optionEls[0].querySelector("tg-svg")).toBeInTheDocument();
    expect(optionEls[0].querySelector("tg-svg > svg.icon.icon-add")).toBeInTheDocument();
    expect(optionEls[1].querySelector("tg-svg")).toBeInTheDocument();
    expect(optionEls[1].querySelector("tg-svg > svg.icon.icon-bulk")).toBeInTheDocument();
    // M15: the authoritative `tg-svg.add-action` / `tg-svg.bulk-action` wrapper
    // modifier classes (`kanban-table.jade` L37,L46) must render as REAL `class`
    // attributes on the `<tg-svg>` element — `.add-action` is styled by the
    // unchanged `kanban-table.scss` (fill + right margin). React 18 renders a
    // `className` prop on a custom element as the literal `classname` attribute,
    // so the source passes the `class` prop; assert the wrappers are selectable
    // by their real class (they would NOT be if the quirk regressed).
    expect(optionEls[0].querySelector("tg-svg.add-action")).toBeInTheDocument();
    expect(optionEls[1].querySelector("tg-svg.bulk-action")).toBeInTheDocument();
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
    expect(links[0]).toHaveAttribute("href", "/project/acme/admin/project-values/kanban-power-ups");
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

describe("KanbanBoard — story lightboxes (C2 real integration)", () => {
  it("always mounts all three lightbox hosts (marker attrs) and keeps them closed by default", () => {
    const { container } = renderBoard();

    const createEdit = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
    const bulk = container.querySelector("[tg-lb-create-bulk-userstories]") as HTMLElement;
    const assign = container.querySelector("[tg-lb-assignedto]") as HTMLElement;

    // Hosts are always present (so the e2e host selectors resolve before the
    // opening click) even though the content mounts only while open.
    expect(createEdit).toBeInTheDocument();
    expect(bulk).toBeInTheDocument();
    expect(assign).toBeInTheDocument();

    // Closed = NO `.open` class (the ONLY thing the preserved lightbox.scss
    // reveals) + aria-hidden; the previous inline `display` hack is gone (C2).
    for (const host of [createEdit, bulk, assign]) {
      expect(host).toHaveClass("lightbox");
      expect(host).not.toHaveClass("open");
      expect(host).toHaveAttribute("aria-hidden", "true");
      expect(host).toHaveAttribute("role", "dialog");
    }
    // Closed content is not mounted (mirrors legacy `form(ng-if=lightboxOpen)`).
    expect(createEdit.querySelector("form")).toBeNull();
  });

  it("adds `.open` (never inline display) to the create host and mounts the rich form", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        activeLightbox: { type: "create", statusId: 10 },
        usStatusList: [makeStatus(10), makeStatus(11)],
      }),
    );
    const { container } = renderBoard();

    const host = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
    expect(host).toHaveClass("open");
    expect(host).not.toHaveAttribute("aria-hidden");
    // Rich form DOM (not the old subject-only stub): subject + description +
    // status dropdown + creation-position radios.
    expect(host.querySelector('input[name="subject"]')).toBeInTheDocument();
    expect(host.querySelector("textarea.description")).toBeInTheDocument();
    expect(host.querySelector("fieldset.status-button .status-dropdown")).toBeInTheDocument();
    expect(host.querySelector("fieldset.creation-position")).toBeInTheDocument();
    // Create caption.
    expect(host.querySelector("#submitButton")).toHaveTextContent("Create");
  });

  it("shows the create host for BOTH create and edit states, with the edit caption on edit", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ activeLightbox: { type: "create", statusId: 10 }, usStatusList: [makeStatus(10)] }),
    );
    const { container, rerender } = renderBoard();
    expect(container.querySelector("[tg-lb-create-edit-userstory]")).toHaveClass("open");

    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        activeLightbox: { type: "edit", usId: 5 },
        usStatusList: [makeStatus(10)],
        usMap: { 5: { id: 5, subject: "Existing story", status: 10, version: 3 } },
      }),
    );
    rerender(<KanbanBoard context={CONTEXT} />);
    const host = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
    expect(host).toHaveClass("open");
    // Seeded from the target story + edit caption.
    expect(host.querySelector('input[name="subject"]')).toHaveValue("Existing story");
    expect(host.querySelector("#submitButton")).toHaveTextContent("Save");
  });

  it("submits the create form to submitNewUs with a value object and cancels via closeLightbox", () => {
    const kb = makeKb({
      activeLightbox: { type: "create", statusId: 10 },
      usStatusList: [makeStatus(10)],
    });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    const host = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
    const input = host.querySelector('input[name="subject"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "A brand new story" } });
    fireEvent.submit(host.querySelector("form") as HTMLFormElement);

    // M2: the collected VALUE OBJECT is handed to the hook (not a bare string),
    // and the board never clears the field before persistence — the form owns it.
    expect(kb.submitNewUs).toHaveBeenCalledTimes(1);
    expect(kb.submitNewUs).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "A brand new story", status: 10, us_position: "bottom" }),
    );
    expect(kb.submitEditUs).not.toHaveBeenCalled();

    // M1: the form is now DIRTY (subject was typed and the board never clears
    // it before persistence), so the close affordances route through the
    // localized dirty-close confirm (reproducing the legacy
    // `CreateEditDirective.checkClose` -> `$confirm.ask(CONFIRM_CLOSE)`). Cancel
    // opens the ask dialog rather than closing immediately.
    fireEvent.click(host.querySelector("button.cancel") as Element);
    expect(kb.closeLightbox).not.toHaveBeenCalled();
    const ask = container.querySelector("[tg-lb-generic-ask]") as HTMLElement;
    expect(ask).toHaveClass("open");
    // Confirming the discard performs the actual close.
    fireEvent.click(ask.querySelector(".js-confirm") as Element);
    expect(kb.closeLightbox).toHaveBeenCalledTimes(1);
  });

  it("routes the edit-form submit to submitEditUs (not submitNewUs)", () => {
    const kb = makeKb({
      activeLightbox: { type: "edit", usId: 5 },
      usStatusList: [makeStatus(10)],
      usMap: { 5: { id: 5, subject: "Existing story", status: 10, version: 3 } },
    });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    const host = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
    fireEvent.submit(host.querySelector("form") as HTMLFormElement);
    expect(kb.submitEditUs).toHaveBeenCalledTimes(1);
    expect(kb.submitEditUs).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Existing story" }),
    );
    expect(kb.submitNewUs).not.toHaveBeenCalled();
  });

  it("adds `.open` to the bulk host and submits a value object to submitBulkUs", () => {
    const kb = makeKb({
      activeLightbox: { type: "bulk", statusId: 10 },
      usStatusList: [makeStatus(10)],
    });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    const host = container.querySelector("[tg-lb-create-bulk-userstories]") as HTMLElement;
    expect(host).toHaveClass("open");
    expect(container.querySelector("[tg-lb-create-edit-userstory]")).not.toHaveClass("open");

    const textarea = host.querySelector('textarea[name="bulk"]') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "US 1\nUS 2" } });
    fireEvent.submit(host.querySelector("form") as HTMLFormElement);
    expect(kb.submitBulkUs).toHaveBeenCalledTimes(1);
    expect(kb.submitBulkUs).toHaveBeenCalledWith(
      expect.objectContaining({ bulk: "US 1\nUS 2", status: 10 }),
    );
  });

  it("opens the assign host with a selectable member list and submits to submitAssignedUsers", () => {
    const kb = makeKb({
      activeLightbox: { type: "assign", usId: 5 },
      usMap: { 5: { id: 5, subject: "S", status: 10, assigned_users: [2] } },
      project: makeProject({
        members: [
          { id: 1, full_name_display: "Ada Lovelace" },
          { id: 2, username: "grace" },
        ],
      }),
    });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    const assign = container.querySelector("[tg-lb-assignedto]") as HTMLElement;
    expect(assign).toHaveClass("open");
    const items = assign.querySelectorAll(".user-list-single");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Ada Lovelace");
    expect(items[1]).toHaveTextContent("grace");
    // Seeded from the story's current collaborators.
    expect(items[1]).toHaveClass("selected");

    fireEvent.submit(assign.querySelector("form") as HTMLFormElement);
    expect(kb.submitAssignedUsers).toHaveBeenCalledTimes(1);
    // Current collaborators preserved (grace = id 2).
    expect(kb.submitAssignedUsers).toHaveBeenCalledWith([2], 2);
  });
});

describe("KanbanBoard — M2 board error region + M7 a11y", () => {
  it("renders the sanitized hook error in the board status live region when no lightbox is open", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ errorMessage: "Could not reorder the story. Please retry.", activeLightbox: null }),
    );
    const { container } = renderBoard();

    const region = container.querySelector(".kanban-board-status") as HTMLElement;
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.querySelector(".notification-message-error")).toHaveTextContent(
      "Could not reorder the story. Please retry.",
    );
  });

  it("does NOT duplicate the error in the board region while a lightbox is open (shown in-lightbox)", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({
        errorMessage: "Server said no.",
        activeLightbox: { type: "create", statusId: 10 },
        usStatusList: [makeStatus(10)],
      }),
    );
    const { container } = renderBoard();

    // Board-level region is empty (no duplicate)...
    expect(container.querySelector(".kanban-board-status .notification-message-error")).toBeNull();
    // ...and the error is surfaced INSIDE the open lightbox instead.
    const host = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
    expect(host.querySelector(".lightbox-error")).toHaveTextContent("Server said no.");
  });

  it("resolves the section label through t() (M7 i18n, not a hard-coded literal)", () => {
    const { container } = renderBoard();
    // KANBAN.SECTION_NAME => "Kanban" in the bundled catalogue.
    expect(container.querySelector("h1.main-title span")).toHaveTextContent("Kanban");
  });

  it("resolves the fold/unfold column titles through t() (M7)", () => {
    mockedUseKanbanStories.mockReturnValue(
      makeKb({ usStatusList: [makeStatus(10)], project: makeProject({ my_permissions: [] }) }),
    );
    const { container } = renderBoard();
    const options = container.querySelector(".task-colum-name .options") as HTMLElement;
    const anchors = options.querySelectorAll("a[role='button']");
    expect(anchors[0]).toHaveAttribute("title", "Fold column");
    expect(anchors[1]).toHaveAttribute("title", "Unfold column");
  });

  it("makes the fold/unfold role-button anchors keyboard-operable (tabIndex + Enter/Space) — M7", () => {
    const kb = makeKb({ usStatusList: [makeStatus(10)] });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    const options = container.querySelector(".task-colum-name .options") as HTMLElement;
    const fold = options.querySelectorAll("a[role='button']")[0] as HTMLElement;
    expect(fold).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(fold, { key: "Enter" });
    fireEvent.keyDown(fold, { key: " " });
    // Enter + Space both activate (parity with the mouse click handler).
    expect(kb.foldStatus).toHaveBeenCalledTimes(2);
  });
});

describe("KanbanBoard — drag-and-drop wiring (single KanbanDndProvider, M6)", () => {
  const providerMock = () =>
    jest.requireMock("./dnd") as {
      __providerState: {
        lastProps: {
          context?: unknown;
          renderOverlay?: (id: number) => unknown;
        } | null;
      };
    };

  it("wraps the board in the single tested KanbanDndProvider with the hook as the drag context", () => {
    const kb = makeKb({ usStatusList: [makeStatus(10)] });
    mockedUseKanbanStories.mockReturnValue(kb);
    const { container } = renderBoard();

    // The board no longer hand-wires a DndContext; it renders the one tested
    // provider (M6) and forwards the EXACT hook return as the drag context.
    const provider = container.querySelector('[data-testid="dnd-provider"]');
    expect(provider).not.toBeNull();
    expect(provider).toHaveAttribute("data-has-context", "true");
    expect(provider).toHaveAttribute("data-has-render-overlay", "true");

    expect(providerMock().__providerState.lastProps?.context).toBe(kb);
    expect(typeof providerMock().__providerState.lastProps?.renderOverlay).toBe("function");
  });

  it("supplies a .gu-mirror DragOverlay clone (with the story subject) via renderOverlay (C3)", () => {
    const kb = makeKb({
      usStatusList: [makeStatus(10)],
      usMap: { 7: { id: 7, status: 10, swimlane: null, subject: "Fix login" } },
      selectedUss: {},
    });
    mockedUseKanbanStories.mockReturnValue(kb);
    renderBoard();

    const renderOverlay = providerMock().__providerState.lastProps
      ?.renderOverlay as (id: number) => React.ReactElement | null;
    const { container } = render(renderOverlay(7) as React.ReactElement);

    const mirror = container.querySelector(".gu-mirror");
    expect(mirror).not.toBeNull();
    expect(mirror).toHaveClass("multiple-drag-mirror");
    expect(mirror?.textContent).toContain("Fix login");
    // A single drag shows no multi-count badge.
    expect(container.querySelector(".multiple-drag-count")).toBeNull();
  });

  it("shows the multi-drag count in the overlay when several cards are selected (C3)", () => {
    const kb = makeKb({
      usMap: {
        7: { id: 7, status: 10, swimlane: null, subject: "A" },
        8: { id: 8, status: 10, swimlane: null, subject: "B" },
      },
      selectedUss: { 7: true, 8: true },
    });
    mockedUseKanbanStories.mockReturnValue(kb);
    renderBoard();

    const renderOverlay = providerMock().__providerState.lastProps
      ?.renderOverlay as (id: number) => React.ReactElement | null;
    const { container } = render(renderOverlay(7) as React.ReactElement);

    expect(container.querySelector(".multiple-drag-count")?.textContent).toBe("2");
  });

  it("renders no mirror for an unknown active id", () => {
    const kb = makeKb({ usMap: {} });
    mockedUseKanbanStories.mockReturnValue(kb);
    renderBoard();

    const renderOverlay = providerMock().__providerState.lastProps
      ?.renderOverlay as (id: number) => React.ReactElement | null;
    expect(renderOverlay(999)).toBeNull();
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
