/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest + @testing-library/react component tests for {@link StatusColumn}.
 *
 * `StatusColumn` is the React reproduction of ONE Kanban body column
 * (`div.kanban-uses-box.taskboard-column`) from the legacy AngularJS board
 * template `app/partials/includes/modules/kanban-table.jade`. Because the
 * AngularJS -> React migration must be DOM/CSS-identical, these tests assert the
 * exact element tree, class names, and `data-*` attribute values the legacy
 * Jade produced, plus the WIP-limit marker placement the legacy
 * `KanbanWipLimitDirective.redrawWipLimit` (`kanban/main.coffee` L826-834)
 * computed and the `target-drop` drop-hover affordance.
 *
 * They cover the file's Phase B (DOM/selector parity) and Phase C (behaviour)
 * validation checklist and every branch of `StatusColumn.tsx` (folded vs. not,
 * archived vs. not, WIP set vs. null, over/at/one-left/under-limit, placeholder
 * shown vs. hidden, swimlane vs. non-swimlane, drop-hover on/off, and the full
 * per-card prop forwarding), so it contributes to the >= 70% line-coverage gate
 * for the new React code.
 *
 * Conventions (matching the sibling React specs, e.g. Card.test.tsx):
 *   - The automatic JSX runtime is used, so there is no `import React`.
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`) are used directly.
 *   - `@testing-library/jest-dom` matchers are registered by `jest.setup.ts`.
 *   - The child `Card` is mocked with a lightweight stub that emits a `<tg-card>`
 *     tag, echoes the forwarded props as `data-*` attributes, and exposes one
 *     button per handler. This isolates the unit under test: it lets the specs
 *     assert EXACTLY what `StatusColumn` maps/forwards (including `isFirst`,
 *     which the real `Card` intentionally does not render) and keeps the specs
 *     stable against changes to `Card`'s internals (covered by Card.test.tsx).
 *   - `useColumnDroppable` is mocked so the `isOver` -> `target-drop` contract
 *     and the `{ statusId, swimlaneId }` wiring can be asserted without a real
 *     `@dnd-kit` `DndContext`.
 */

import { fireEvent, render } from "@testing-library/react";

import { StatusColumn } from "./StatusColumn";
import type { StatusColumnProps } from "./StatusColumn";
import type { Status, UserStory, Project } from "../shared/types";

// --- Mocks -----------------------------------------------------------------

// Control the droppable hook: a spy whose `{ setNodeRef, isOver }` return we
// drive per test, and whose single `{ statusId, swimlaneId }` argument we assert.
jest.mock("./dnd/useColumnDroppable", () => ({
  useColumnDroppable: jest.fn(() => ({ setNodeRef: jest.fn(), isOver: false })),
}));

// Stub `Card`. The factory must not close over module-scope runtime bindings
// (jest hoists `jest.mock` above the imports), so React is pulled in via
// `require` inside the factory. The stub emits a real `<tg-card>` element with
// the forwarded props echoed as `data-*` attributes and a button per handler.
jest.mock("./Card", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const react = require("react");
  return {
    Card: (props: {
      story: { id: number };
      isFirst?: boolean;
      selected?: boolean;
      moved?: boolean;
      folded?: boolean;
      archived?: boolean;
      maximized?: boolean;
      minimized?: boolean;
      onToggleFold: (id: number) => void;
      onClickEdit: (id: number) => void;
      onClickDelete: (id: number) => void;
      onClickAssignedTo: (id: number) => void;
      onClickMoveToTop?: (id: number) => void;
      onToggleSelect: (id: number, event: unknown) => void;
    }) => {
      const id = props.story.id;
      const b = (className: string, onClick: () => void) =>
        react.createElement("button", { type: "button", className, onClick }, className);
      return react.createElement(
        "tg-card",
        {
          // `class` (not `className`) on a custom element — see StatusColumn.tsx.
          class: "card",
          "data-id": id,
          "data-is-first": props.isFirst ? "true" : "false",
          "data-selected": props.selected ? "true" : "false",
          "data-moved": props.moved ? "true" : "false",
          "data-folded": props.folded ? "true" : "false",
          "data-archived": props.archived ? "true" : "false",
          "data-maximized": props.maximized ? "true" : "false",
          "data-minimized": props.minimized ? "true" : "false",
        },
        b("mock-fold", () => props.onToggleFold(id)),
        b("mock-edit", () => props.onClickEdit(id)),
        b("mock-delete", () => props.onClickDelete(id)),
        b("mock-assign", () => props.onClickAssignedTo(id)),
        b("mock-movetotop", () => props.onClickMoveToTop && props.onClickMoveToTop(id)),
        react.createElement(
          "button",
          {
            type: "button",
            className: "mock-select",
            onClick: (event: unknown) => props.onToggleSelect(id, event),
          },
          "mock-select",
        ),
      );
    },
  };
});

import { useColumnDroppable } from "./dnd/useColumnDroppable";

const mockUseColumnDroppable = useColumnDroppable as jest.MockedFunction<
  typeof useColumnDroppable
>;

// --- Fixtures --------------------------------------------------------------

function makeStatus(overrides: Partial<Status> = {}): Status {
  return {
    id: 1,
    name: "New",
    color: "#70728f",
    wip_limit: null,
    is_archived: false,
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 7,
    slug: "proj",
    my_permissions: ["modify_us", "delete_us", "view_tasks", "add_us"],
    is_kanban_activated: true,
    is_backlog_activated: true,
    archived_code: null,
    points: [],
    roles: [],
    ...overrides,
  };
}

function makeStory(id: number, overrides: Partial<UserStory> = {}): UserStory {
  return {
    id,
    ref: 100 + id,
    subject: `US ${id}`,
    status: 1,
    swimlane: null,
    assigned_users: [],
    tags: [],
    attachments: [],
    is_blocked: false,
    is_closed: false,
    total_points: null,
    epics: [],
    ...overrides,
  } as UserStory;
}

/** Build a complete, valid props object, defaulting `usMap` to cover `storyIds`. */
function buildProps(overrides: Partial<StatusColumnProps> = {}): StatusColumnProps {
  const storyIds = overrides.storyIds ?? [1, 2, 3];
  const usMap: Record<number, UserStory> =
    overrides.usMap ??
    storyIds.reduce<Record<number, UserStory>>((acc, id) => {
      acc[id] = makeStory(id);
      return acc;
    }, {});

  return {
    status: makeStatus(),
    project: makeProject(),
    zoom: ["assigned_to", "ref", "subject"],
    zoomLevel: 1,
    folded: false,
    foldStatusChanged: {},
    usersById: {},
    selectedUss: {},
    movedUs: [],
    isArchivedHidden: () => false,
    onToggleFold: jest.fn(),
    onClickEdit: jest.fn(),
    onClickDelete: jest.fn(),
    onClickAssignedTo: jest.fn(),
    onToggleSelect: jest.fn(),
    ...overrides,
    // Applied AFTER the spread so the pre-merged, mutually consistent
    // storyIds/usMap win even when only one of them was overridden.
    storyIds,
    usMap,
  };
}

function renderColumn(overrides: Partial<StatusColumnProps> = {}) {
  const props = buildProps(overrides);
  const utils = render(<StatusColumn {...props} />);
  const root = utils.container.firstElementChild as HTMLElement;
  return { ...utils, props, root };
}

/**
 * Ordered signature of the card/marker siblings, so WIP-marker placement can be
 * asserted precisely: e.g. ["card:1", "card:2", "marker:reached", "card:3"].
 */
function childSignature(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("tg-card, .kanban-wip-limit")).map((el) => {
    if (el.tagName.toLowerCase() === "tg-card") {
      return `card:${el.getAttribute("data-id")}`;
    }
    return `marker:${el.className.replace("kanban-wip-limit", "").trim()}`;
  });
}

beforeEach(() => {
  mockUseColumnDroppable.mockReset();
  mockUseColumnDroppable.mockReturnValue({ setNodeRef: jest.fn(), isOver: false });
});

// --- Phase B: root element / DOM shape -------------------------------------

describe("StatusColumn — root element", () => {
  it("renders div.kanban-uses-box.taskboard-column#column-<id> with data-status", () => {
    // Non-swimlane mode: the document id is the plain `column-<statusId>`.
    const { container } = renderColumn({ status: makeStatus({ id: 5 }) });
    const root = container.querySelector("#column-5") as HTMLElement;
    expect(root).toBeInTheDocument();
    expect(root.tagName.toLowerCase()).toBe("div");
    // M15: authoritative column classes ONLY (`kanban-table.jade` L110). The
    // previously-added test-only `task-column` class has been removed.
    expect(root).toHaveClass("kanban-uses-box", "taskboard-column");
    expect(root).not.toHaveClass("task-column");
    expect(root).toHaveAttribute("data-status", "5");
  });

  it("qualifies the document id with the swimlane id in swimlane mode (M7 unique ids)", () => {
    // The legacy `kanban-table.jade` emitted `id="column-{{s.id}}"` INSIDE the
    // per-swimlane repeat, so the same id repeated across swimlanes (a duplicate-
    // id defect). In swimlane mode the React column qualifies the id with the
    // swimlane id so every column is a UNIQUE document node, while `data-status`
    // (styling/e2e authority) stays the bare status id.
    const colA = renderColumn({ status: makeStatus({ id: 5 }), swimlaneId: 3 });
    expect(colA.container.querySelector("#column-3-5")).toBeInTheDocument();
    expect(colA.root).toHaveAttribute("data-status", "5");
    expect(colA.root).toHaveAttribute("data-swimlane", "3");
    // The same status in a DIFFERENT swimlane yields a DIFFERENT document id, so
    // the two columns never collide.
    const colB = renderColumn({ status: makeStatus({ id: 5 }), swimlaneId: 7 });
    expect(colB.container.querySelector("#column-7-5")).toBeInTheDocument();
    expect(colA.root.id).not.toBe(colB.root.id);
  });

  it("qualifies the id for the unclassified swimlane (-1) too", () => {
    const { container } = renderColumn({ status: makeStatus({ id: 5 }), swimlaneId: -1 });
    expect(container.querySelector("#column--1-5")).toBeInTheDocument();
  });

  it("omits data-swimlane in non-swimlane mode (swimlaneId undefined)", () => {
    const { root } = renderColumn();
    expect(root).not.toHaveAttribute("data-swimlane");
  });

  it("omits data-swimlane when swimlaneId is null", () => {
    const { root } = renderColumn({ swimlaneId: null });
    expect(root).not.toHaveAttribute("data-swimlane");
  });

  it("renders data-swimlane for a positive swimlane id", () => {
    const { root } = renderColumn({ swimlaneId: 3 });
    expect(root).toHaveAttribute("data-swimlane", "3");
  });

  it("renders data-swimlane=\"-1\" for the unclassified swimlane", () => {
    const { root } = renderColumn({ swimlaneId: -1 });
    expect(root).toHaveAttribute("data-swimlane", "-1");
  });

  it("renders data-swimlane=\"0\" for swimlane id 0 (falsy-but-present edge)", () => {
    const { root } = renderColumn({ swimlaneId: 0 });
    expect(root).toHaveAttribute("data-swimlane", "0");
  });

  it("adds vunfold when unfold is true", () => {
    const { root } = renderColumn({ unfold: true });
    expect(root).toHaveClass("vunfold");
  });
});

// --- Phase B: WIP counter (not folded) -------------------------------------

describe("StatusColumn — WIP counter (not folded)", () => {
  it("renders .kanban-task-counter with a counter whose count === storyIds.length", () => {
    const { root } = renderColumn({ storyIds: [1, 2, 3] });
    const counter = root.querySelector(".kanban-task-counter");
    expect(counter).toBeInTheDocument();
    expect(counter).toHaveAttribute("title");
    const animated = counter!.querySelector("tg-animated-counter") as HTMLElement;
    expect(animated).toHaveAttribute("data-count", "3");
    expect(root.querySelector(".placeholder-collapsed")).not.toBeInTheDocument();
    expect(animated.querySelector(".current")).toHaveTextContent("3");
  });

  it("omits data-wip and the wip-amount modifier when the status has no WIP limit", () => {
    const { root } = renderColumn({ status: makeStatus({ wip_limit: null }) });
    const animated = root.querySelector("tg-animated-counter") as HTMLElement;
    expect(animated).not.toHaveAttribute("data-wip");
    expect(root.querySelector(".animated-counter-inner")).not.toHaveClass("wip-amount");
    expect(root.querySelector(".animated-counter-inner")).not.toHaveClass("limit-over");
  });

  it("sets data-wip and wip-amount (not limit-over) when count is below the WIP limit", () => {
    const { root } = renderColumn({
      storyIds: [1, 2, 3],
      status: makeStatus({ wip_limit: 5 }),
    });
    const animated = root.querySelector("tg-animated-counter") as HTMLElement;
    expect(animated).toHaveAttribute("data-wip", "5");
    const inner = root.querySelector(".animated-counter-inner") as HTMLElement;
    expect(inner).toHaveClass("wip-amount");
    expect(inner).not.toHaveClass("limit-over");
    // The " / {wip}" suffix is rendered.
    expect(root.querySelector(".result")).toHaveTextContent("3 / 5");
  });

  it("adds limit-over when the count exceeds the WIP limit", () => {
    const { root } = renderColumn({
      storyIds: [1, 2, 3, 4],
      status: makeStatus({ wip_limit: 2 }),
    });
    const inner = root.querySelector(".animated-counter-inner") as HTMLElement;
    expect(inner).toHaveClass("wip-amount", "limit-over");
  });

  it("surfaces renderInProgress as data-disabled on the counter", () => {
    const { root } = renderColumn({ renderInProgress: true });
    expect(root.querySelector("tg-animated-counter")).toHaveAttribute("data-disabled", "true");
  });

  it("omits data-disabled when renderInProgress is false/absent", () => {
    const { root } = renderColumn();
    expect(root.querySelector("tg-animated-counter")).not.toHaveAttribute("data-disabled");
  });
});

// --- Phase B: folded / collapsed placeholder -------------------------------

describe("StatusColumn — folded state", () => {
  it("adds vfold to the folded body column and shows the collapsed placeholder", () => {
    const { root } = renderColumn({ folded: true });
    // M15: `vfold` on the authoritative `.kanban-uses-box.taskboard-column`
    // body column (no test-only `task-column` hook). The folded header cell
    // (`.task-colum-name`) is a DIFFERENT element, so the body column is still
    // uniquely identified by its `.kanban-uses-box` base class.
    expect(root).toHaveClass("vfold");
    expect(root).not.toHaveClass("task-column");
    expect(root.matches(".vfold.kanban-uses-box.taskboard-column")).toBe(true);
    expect(root.querySelector(".placeholder-collapsed")).toBeInTheDocument();
    // The counter block is not rendered while folded.
    expect(root.querySelector(".kanban-task-counter")).not.toBeInTheDocument();
  });

  it("still renders one card per story while folded (CSS hides them, DOM keeps them)", () => {
    const { root } = renderColumn({ folded: true, storyIds: [1, 2] });
    expect(root.querySelectorAll("tg-card")).toHaveLength(2);
  });

  it("renders the vertical counter inside .ammount, the status name, and the colour swatch for a non-archived folded column", () => {
    const { root } = renderColumn({
      folded: true,
      status: makeStatus({ name: "In progress", color: "#ff0000", is_archived: false }),
    });
    const wrapper = root.querySelector(".placeholder-collapsed-wrapper") as HTMLElement;
    expect(wrapper).toBeInTheDocument();
    const ammount = wrapper.querySelector(".ammount");
    expect(ammount).toBeInTheDocument();
    expect(ammount!.querySelector("tg-animated-counter")).toHaveClass("vertical");
    expect(wrapper.querySelector(".text-holder .name")).toHaveTextContent("In progress");
    expect(wrapper.querySelector(".archived")).not.toBeInTheDocument();
    const swatch = wrapper.querySelector(".square-color") as HTMLElement;
    expect(swatch).toBeInTheDocument();
    expect(swatch.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  it("for an archived folded column omits .ammount and shows the Archived label", () => {
    const { root } = renderColumn({
      folded: true,
      status: makeStatus({ is_archived: true, name: "Archived col" }),
    });
    const wrapper = root.querySelector(".placeholder-collapsed-wrapper") as HTMLElement;
    expect(wrapper.querySelector(".ammount")).not.toBeInTheDocument();
    expect(wrapper.querySelector(".text-holder .archived")).toHaveTextContent("Archived");
    expect(wrapper.querySelector(".text-holder .name")).toHaveTextContent("Archived col");
  });
});

// --- Phase B: card placeholder ---------------------------------------------

describe("StatusColumn — card placeholder", () => {
  it("renders .card-placeholder only when showPlaceholder is set", () => {
    expect(renderColumn().root.querySelector(".card-placeholder")).not.toBeInTheDocument();
    const { root } = renderColumn({ showPlaceholder: true });
    expect(root.querySelector(".card-placeholder")).toBeInTheDocument();
  });

  it("adds not-found only when notFoundUserstories is set", () => {
    const withNotFound = renderColumn({ showPlaceholder: true, notFoundUserstories: true });
    expect(withNotFound.root.querySelector(".card-placeholder")).toHaveClass("not-found");

    const without = renderColumn({ showPlaceholder: true, notFoundUserstories: false });
    expect(without.root.querySelector(".card-placeholder")).not.toHaveClass("not-found");
  });

  // C8 — reproduce the COMPLETE authoritative placeholder DOM from
  // `common/components/kanban-placeholder.html`, both state branches.
  it("renders the full SKELETON branch DOM + title/help text when NOT not-found (C8)", () => {
    const { root } = renderColumn({ showPlaceholder: true, notFoundUserstories: false });
    const ph = root.querySelector(".card-placeholder") as HTMLElement;

    // Skeleton board card: three rows (small+big, single, avatar row).
    const boardCard = ph.querySelector(".placeholder-board-card") as HTMLElement;
    expect(boardCard).toBeInTheDocument();
    expect(boardCard.querySelectorAll(".placeholder-board-row").length).toBe(3);
    expect(boardCard.querySelector(".placeholder-board-text.small")).toBeInTheDocument();
    expect(boardCard.querySelector(".placeholder-board-text.big")).toBeInTheDocument();
    expect(boardCard.querySelector(".placeholder-board-row.avatar")).toBeInTheDocument();
    expect(boardCard.querySelector(".placeholder-board-avatar")).toBeInTheDocument();
    expect(boardCard.querySelector(".placeholder-board-user")).toBeInTheDocument();

    // Secondary skeleton blocks.
    const titles = ph.querySelector(".placeholder-titles") as HTMLElement;
    expect(titles).toBeInTheDocument();
    expect(titles.querySelector(".text-small")).toBeInTheDocument();
    expect(titles.querySelector(".text-large")).toBeInTheDocument();
    const avatar = ph.querySelector(".placeholder-avatar") as HTMLElement;
    expect(avatar).toBeInTheDocument();
    expect(avatar.querySelector(".image")).toBeInTheDocument();
    expect(avatar.querySelector(".text")).toBeInTheDocument();

    // Localized title + help paragraph.
    expect(ph.querySelector("p.title")).toHaveTextContent("This could be a user story");
    expect(ph).toHaveTextContent(
      "Create user stories here and change their status to track their progress.",
    );

    // The decorative skeleton wrappers are hidden from assistive tech.
    expect(boardCard).toHaveAttribute("aria-hidden", "true");
    expect(titles).toHaveAttribute("aria-hidden", "true");
    expect(avatar).toHaveAttribute("aria-hidden", "true");

    // The not-found branch must be absent here.
    expect(ph).not.toHaveTextContent("No matching results found");
  });

  it("renders the NOT-FOUND branch (title + two help paragraphs, with a <strong> archived span) (C8)", () => {
    const { root } = renderColumn({ showPlaceholder: true, notFoundUserstories: true });
    const ph = root.querySelector(".card-placeholder") as HTMLElement;

    expect(ph.querySelector("p.title")).toHaveTextContent("No matching results found");
    expect(ph).toHaveTextContent(
      "Try again using more general search terms or disabled some filters.",
    );

    // P2 carries the trusted <strong>Archived stories</strong> span the SCSS
    // (`.card-placeholder.not-found strong`) targets — rendered as a real node.
    const strong = ph.querySelector("strong") as HTMLElement;
    expect(strong).toBeInTheDocument();
    expect(strong).toHaveTextContent("Archived stories");
    expect(ph).toHaveTextContent(
      "Archived stories are not loaded by default. Unfold the archived statuses to expand your search.",
    );

    // The loading SKELETON must NOT appear in the not-found branch.
    expect(ph.querySelector(".placeholder-board-card")).not.toBeInTheDocument();
    expect(ph.querySelector(".placeholder-titles")).not.toBeInTheDocument();
  });
});

// --- Phase B: archived intro -----------------------------------------------

describe("StatusColumn — archived intro", () => {
  it("renders .kanban-column-intro only for an archived status", () => {
    expect(renderColumn().root.querySelector(".kanban-column-intro")).not.toBeInTheDocument();
    const { root } = renderColumn({ status: makeStatus({ is_archived: true }) });
    expect(root.querySelector(".kanban-column-intro")).toBeInTheDocument();
  });
});

// --- Phase B: defensive value states ---------------------------------------

describe("StatusColumn — defensive value states", () => {
  it("renders the collapsed vertical counter with a WIP limit (data-wip + wip-amount)", () => {
    const { root } = renderColumn({
      folded: true,
      storyIds: [1, 2, 3],
      status: makeStatus({ wip_limit: 5 }),
    });
    const vertical = root.querySelector(".ammount tg-animated-counter") as HTMLElement;
    expect(vertical).toHaveAttribute("data-wip", "5");
    expect(vertical.querySelector(".animated-counter-inner")).toHaveClass("wip-amount");
  });

  it("omits the swatch background when the status has no colour", () => {
    const { root } = renderColumn({
      folded: true,
      status: makeStatus({ color: undefined }),
    });
    const swatch = root.querySelector(".square-color") as HTMLElement;
    expect(swatch.style.backgroundColor).toBe("");
  });

  it("treats a status with undefined wip_limit/is_archived as no-limit, non-archived", () => {
    // A leaner status projection (wip_limit + is_archived absent) exercises the
    // `?? null` / `?? false` fallbacks: counter with no data-wip, no marker, no intro.
    const status = { id: 1, name: "New", color: "#70728f" } as Status;
    const { root } = renderColumn({ status, storyIds: [1, 2, 3] });
    const counter = root.querySelector("tg-animated-counter") as HTMLElement;
    expect(counter).toHaveAttribute("data-count", "3");
    expect(counter).not.toHaveAttribute("data-wip");
    expect(root.querySelector(".kanban-wip-limit")).not.toBeInTheDocument();
    expect(root.querySelector(".kanban-column-intro")).not.toBeInTheDocument();
  });
});

// --- Phase B/C: card rendering + prop forwarding ---------------------------

describe("StatusColumn — cards", () => {
  it("renders one tg-card per storyId in order", () => {
    const { root } = renderColumn({ storyIds: [11, 22, 33] });
    const ids = Array.from(root.querySelectorAll("tg-card")).map((c) =>
      c.getAttribute("data-id"),
    );
    expect(ids).toEqual(["11", "22", "33"]);
  });

  it("renders no cards for an empty column", () => {
    const { root } = renderColumn({ storyIds: [] });
    expect(root.querySelectorAll("tg-card")).toHaveLength(0);
  });

  it("sets isFirst on the first card only", () => {
    const { root } = renderColumn({ storyIds: [1, 2, 3] });
    const cards = Array.from(root.querySelectorAll("tg-card"));
    expect(cards.map((c) => c.getAttribute("data-is-first"))).toEqual([
      "true",
      "false",
      "false",
    ]);
  });

  it("forwards selected, moved, per-card fold and archived-hidden flags to the right cards", () => {
    const { root } = renderColumn({
      storyIds: [1, 2, 3],
      selectedUss: { 2: true },
      movedUs: [3],
      foldStatusChanged: { 1: true },
      isArchivedHidden: (id) => id === 3,
    });
    const byId = (id: number) =>
      root.querySelector(`tg-card[data-id="${id}"]`) as HTMLElement;
    expect(byId(2)).toHaveAttribute("data-selected", "true");
    expect(byId(1)).toHaveAttribute("data-selected", "false");
    expect(byId(3)).toHaveAttribute("data-moved", "true");
    expect(byId(1)).toHaveAttribute("data-moved", "false");
    expect(byId(1)).toHaveAttribute("data-folded", "true");
    expect(byId(2)).toHaveAttribute("data-folded", "false");
    expect(byId(3)).toHaveAttribute("data-archived", "true");
    expect(byId(1)).toHaveAttribute("data-archived", "false");
  });

  it("forwards maximized/minimized to every card", () => {
    const { root } = renderColumn({ storyIds: [1, 2], maximized: true, minimized: true });
    root.querySelectorAll("tg-card").forEach((c) => {
      expect(c).toHaveAttribute("data-maximized", "true");
      expect(c).toHaveAttribute("data-minimized", "true");
    });
  });

  it("forwards each card action handler with the story id (Phase C)", () => {
    const { root, props } = renderColumn({ storyIds: [42] });
    const card = root.querySelector('tg-card[data-id="42"]') as HTMLElement;

    fireEvent.click(card.querySelector(".mock-fold") as HTMLElement);
    expect(props.onToggleFold).toHaveBeenCalledWith(42);

    fireEvent.click(card.querySelector(".mock-edit") as HTMLElement);
    expect(props.onClickEdit).toHaveBeenCalledWith(42);

    fireEvent.click(card.querySelector(".mock-delete") as HTMLElement);
    expect(props.onClickDelete).toHaveBeenCalledWith(42);

    fireEvent.click(card.querySelector(".mock-assign") as HTMLElement);
    expect(props.onClickAssignedTo).toHaveBeenCalledWith(42);

    fireEvent.click(card.querySelector(".mock-select") as HTMLElement);
    expect(props.onToggleSelect).toHaveBeenCalledWith(42, expect.anything());
  });

  it("forwards the optional onClickMoveToTop handler when provided", () => {
    const onClickMoveToTop = jest.fn();
    const { root } = renderColumn({ storyIds: [7], onClickMoveToTop });
    fireEvent.click(
      (root.querySelector('tg-card[data-id="7"]') as HTMLElement).querySelector(
        ".mock-movetotop",
      ) as HTMLElement,
    );
    expect(onClickMoveToTop).toHaveBeenCalledWith(7);
  });
});

// --- Phase B: WIP-limit marker placement -----------------------------------

describe("StatusColumn — WIP-limit marker", () => {
  it("inserts .kanban-wip-limit.reached after the last card when count === wip", () => {
    const { root } = renderColumn({
      storyIds: [1, 2, 3],
      status: makeStatus({ wip_limit: 3 }),
    });
    expect(childSignature(root)).toEqual([
      "card:1",
      "card:2",
      "card:3",
      "marker:reached",
    ]);
  });

  it("inserts .kanban-wip-limit.exceeded after the (wip-1)-th card when count > wip", () => {
    const { root } = renderColumn({
      storyIds: [1, 2, 3, 4],
      status: makeStatus({ wip_limit: 2 }),
    });
    // targetIndex = wip - 1 = 1 -> marker spliced at position 2 (after card:2).
    expect(childSignature(root)).toEqual([
      "card:1",
      "card:2",
      "marker:exceeded",
      "card:3",
      "card:4",
    ]);
  });

  it("inserts .kanban-wip-limit.one-left after the last card when count + 1 === wip", () => {
    const { root } = renderColumn({
      storyIds: [1, 2],
      status: makeStatus({ wip_limit: 3 }),
    });
    expect(childSignature(root)).toEqual(["card:1", "card:2", "marker:one-left"]);
  });

  it("renders no marker when the count is well under the WIP limit", () => {
    const { root } = renderColumn({
      storyIds: [1],
      status: makeStatus({ wip_limit: 5 }),
    });
    expect(root.querySelector(".kanban-wip-limit")).not.toBeInTheDocument();
  });

  it("renders no marker for a status with no WIP limit", () => {
    const { root } = renderColumn({ storyIds: [1, 2, 3], status: makeStatus({ wip_limit: null }) });
    expect(root.querySelector(".kanban-wip-limit")).not.toBeInTheDocument();
  });

  it("renders no marker for an archived status even when the count matches the limit", () => {
    const { root } = renderColumn({
      storyIds: [1, 2, 3],
      status: makeStatus({ wip_limit: 3, is_archived: true }),
    });
    expect(root.querySelector(".kanban-wip-limit")).not.toBeInTheDocument();
  });

  it("renders no marker when the computed target index is out of range (empty column, one-left)", () => {
    // count = 0, wip = 1 -> one-left, targetIndex = count - 1 = -1 -> guarded off.
    const { root } = renderColumn({ storyIds: [], status: makeStatus({ wip_limit: 1 }) });
    expect(root.querySelector(".kanban-wip-limit")).not.toBeInTheDocument();
  });

  it("renders no marker for an exceeded column whose target index is negative (wip 0)", () => {
    // count = 2 > wip = 0 -> exceeded, targetIndex = wip - 1 = -1 -> guarded off.
    const { root } = renderColumn({ storyIds: [1, 2], status: makeStatus({ wip_limit: 0 }) });
    expect(root.querySelector(".kanban-wip-limit")).not.toBeInTheDocument();
  });
});

// --- Phase C: droppable wiring ---------------------------------------------

describe("StatusColumn — droppable", () => {
  it("adds target-drop to the root when a card is dragged over it", () => {
    mockUseColumnDroppable.mockReturnValue({ setNodeRef: jest.fn(), isOver: true });
    const { root } = renderColumn();
    expect(root).toHaveClass("target-drop");
  });

  it("does not add target-drop when nothing is over the column", () => {
    mockUseColumnDroppable.mockReturnValue({ setNodeRef: jest.fn(), isOver: false });
    const { root } = renderColumn();
    expect(root).not.toHaveClass("target-drop");
  });

  it("wires the droppable with the status id and swimlaneId null in non-swimlane mode", () => {
    renderColumn({ status: makeStatus({ id: 9 }) });
    expect(mockUseColumnDroppable).toHaveBeenCalledWith({ statusId: 9, swimlaneId: null });
  });

  it("wires the droppable with the raw swimlane id (including -1) in swimlane mode", () => {
    renderColumn({ status: makeStatus({ id: 9 }), swimlaneId: -1 });
    expect(mockUseColumnDroppable).toHaveBeenCalledWith({ statusId: 9, swimlaneId: -1 });
  });

  it("attaches the droppable setNodeRef to the root column element", () => {
    const setNodeRef = jest.fn();
    mockUseColumnDroppable.mockReturnValue({ setNodeRef, isOver: false });
    renderColumn();
    expect(setNodeRef).toHaveBeenCalled();
    // The ref callback receives the root .taskboard-column element.
    const el = setNodeRef.mock.calls[0][0] as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el).toHaveClass("taskboard-column");
  });
});
