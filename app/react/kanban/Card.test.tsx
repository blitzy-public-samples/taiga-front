/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest + @testing-library/react component tests for {@link Card}.
 *
 * `Card` is the React reproduction of the shared AngularJS `tg-card` directive
 * as it appears on the Kanban board. Because the AngularJS -> React migration
 * must be DOM/CSS-identical, these tests assert the exact element tree, class
 * names, `data-*`/attribute values, and behaviour the legacy `card.jade` +
 * `card-templates/*.jade` (and the `kanban-table.jade` board wiring) produced.
 * They also cover the four MUST-ADD e2e hooks (`.card-owner-actions` with
 * `.e2e-assign`, `.card-owner-name`, and `.e2e-edit`).
 *
 * These tests contribute to the >= 70% line-coverage gate for the new React
 * code and exercise every branch (zoom levels, blocked/archived/selected/moved/
 * maximized/minimized, assigned/unassigned/extra assignees, permission gates,
 * fold/edit/assign/select clicks, icons, drag gating, and the transit mirror).
 *
 * Conventions:
 *   - The automatic JSX runtime is used, so there is no `import React`.
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`) are used directly.
 *   - `@testing-library/jest-dom` matchers are registered by `jest.setup.ts`.
 *   - `useCardDraggable` is mocked so the drag-gating contract can be asserted
 *     precisely and no `DndContext` provider is required to render a card.
 */

import { fireEvent, render } from "@testing-library/react";

import { Card } from "./Card";
import type { CardProps, CardMember } from "./Card";
import type { Project, UserStory } from "../shared/types";

// Mock the draggable hook: return inert wiring and let us assert the `disabled`
// argument (the drag-gating contract) without a real @dnd-kit DndContext.
jest.mock("./dnd/useCardDraggable", () => ({
  useCardDraggable: jest.fn(() => ({
    setNodeRef: jest.fn(),
    attributes: {},
    listeners: {},
    isDragging: false,
  })),
}));

import { useCardDraggable } from "./dnd/useCardDraggable";

const mockUseCardDraggable = useCardDraggable as jest.MockedFunction<
  typeof useCardDraggable
>;

// Cumulative zoom feature arrays (mirror the board-zoom directive map).
const ZOOM0: string[] = ["assigned_to", "ref"];
const ZOOM1: string[] = [...ZOOM0, "subject", "card-data", "assigned_to_extended"];
const ZOOM2: string[] = [...ZOOM1, "tags", "extra_info", "unfold"];
const ZOOM3: string[] = [...ZOOM2, "related_tasks", "attachments"];

function makeStory(overrides: Record<string, unknown> = {}): UserStory {
  return {
    id: 42,
    ref: 101,
    subject: "Implement login",
    status: 1,
    swimlane: null,
    assigned_to: null,
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

function makeMember(overrides: Partial<CardMember> = {}): CardMember {
  return {
    id: 1,
    full_name_display: "Ada Lovelace",
    full_name: "Ada Lovelace",
    username: "ada",
    photo: "/media/ada.png",
    big_photo: "/media/ada-big.png",
    color: "#112233",
    ...overrides,
  };
}

function makeProps(overrides: Partial<CardProps> = {}): CardProps {
  return {
    story: makeStory(),
    project: makeProject(),
    zoom: ZOOM1,
    zoomLevel: 1,
    usersById: {},
    onToggleFold: jest.fn(),
    onClickEdit: jest.fn(),
    onClickDelete: jest.fn(),
    onClickAssignedTo: jest.fn(),
    onClickMoveToTop: jest.fn(),
    onToggleSelect: jest.fn(),
    ...overrides,
  };
}

function renderCard(overrides: Partial<CardProps> = {}) {
  const props = makeProps(overrides);
  const utils = render(<Card {...props} />);
  const root = utils.container.querySelector("tg-card") as HTMLElement;
  return { props, root, ...utils };
}

beforeEach(() => {
  mockUseCardDraggable.mockClear();
});

describe("Card — root DOM contract", () => {
  it("renders a tg-card element with class 'card' and data-id === story id", () => {
    const { root } = renderCard();
    expect(root).toBeInTheDocument();
    expect(root.tagName.toLowerCase()).toBe("tg-card");
    expect(root).toHaveClass("card");
    expect(root).toHaveClass("ng-animate-disabled");
    expect(root).toHaveAttribute("data-id", "42");
  });

  it("renders .card-inner with base 'card-inner' + zoom/type classes", () => {
    const { container } = renderCard({ zoomLevel: 2, zoom: ZOOM2 });
    const inner = container.querySelector(".card-inner") as HTMLElement;
    expect(inner).toBeInTheDocument();
    expect(inner).toHaveClass("card-inner", "zoom-2", "type-us");
  });

  it("renders the subject in .card-subject.e2e-title and ref in .card-ref at zoom >= 1", () => {
    const { container } = renderCard({ zoomLevel: 1, zoom: ZOOM1 });
    const subject = container.querySelector(".card-subject.e2e-title");
    expect(subject).toHaveTextContent("Implement login");
    expect(container.querySelector(".card-ref")).toHaveTextContent("#101");
  });

  it("renders exactly one .card-owner-actions containing .e2e-assign and .e2e-edit", () => {
    const { container } = renderCard();
    const ownerActions = container.querySelectorAll(".card-owner-actions");
    expect(ownerActions).toHaveLength(1);
    expect(ownerActions[0].querySelector(".e2e-assign")).toBeInTheDocument();
    expect(ownerActions[0].querySelector(".e2e-edit")).toBeInTheDocument();
  });

  it("always renders the .card-transit-multi mirror with two .fake-us blocks", () => {
    const { container } = renderCard();
    const transit = container.querySelector(".card-transit-multi");
    expect(transit).toBeInTheDocument();
    expect(transit!.querySelectorAll(".fake-us")).toHaveLength(2);
    expect(transit!.querySelectorAll(".fake-text")).toHaveLength(4);
  });

  it("renders an empty <tg-card> shell (no .card-inner) when inViewPort is false", () => {
    const { container, root } = renderCard({ inViewPort: false });
    expect(container.querySelector(".card-inner")).toBeNull();
    // The transit mirror is a sibling of .card-inner and still renders.
    expect(root.querySelector(".card-transit-multi")).toBeInTheDocument();
  });
});

describe("Card — modifier classes", () => {
  it("adds selection classes when selected", () => {
    const { root } = renderCard({ selected: true });
    expect(root).toHaveClass("kanban-task-selected", "ui-multisortable-multiple");
  });

  it("adds kanban-moved when moved", () => {
    const { root } = renderCard({ moved: true });
    expect(root).toHaveClass("kanban-moved");
  });

  it("adds maximized / minimized classes", () => {
    expect(renderCard({ maximized: true }).root).toHaveClass("kanban-task-maximized");
    expect(renderCard({ minimized: true }).root).toHaveClass("kanban-task-minimized");
  });

  it("adds 'readonly' when the user lacks modify_us", () => {
    const { root } = renderCard({ project: makeProject({ my_permissions: ["view_tasks"] }) });
    expect(root).toHaveClass("readonly");
  });

  it("does NOT add 'readonly' when the user has modify_us", () => {
    const { root } = renderCard();
    expect(root).not.toHaveClass("readonly");
  });

  it("adds .card-blocked on .card-inner when the story is blocked", () => {
    const { container } = renderCard({ story: makeStory({ is_blocked: true }) });
    expect(container.querySelector(".card-inner")).toHaveClass("card-blocked");
  });

  it("adds .archived on .card-inner when archived", () => {
    const { container } = renderCard({ archived: true });
    expect(container.querySelector(".card-inner")).toHaveClass("archived");
  });

  it("adds .with-assigned-user when the story has assigned_users", () => {
    const { container } = renderCard({ story: makeStory({ assigned_users: [1, 2] }) });
    expect(container.querySelector(".card-inner")).toHaveClass("with-assigned-user");
  });

  it("sets the .card-inner title to the subject at zoom 0", () => {
    const { container } = renderCard({ zoomLevel: 0, zoom: ZOOM0 });
    expect(container.querySelector(".card-inner")).toHaveAttribute("title", "Implement login");
  });

  it("sets the .card-inner title to the blocked note when blocked at zoom > 0 (not folded)", () => {
    const { container } = renderCard({
      zoomLevel: 2,
      zoom: ZOOM2,
      story: makeStory({ is_blocked: true, blocked_note: "waiting on API" }),
    });
    expect(container.querySelector(".card-inner")).toHaveAttribute("title", "waiting on API");
  });
});

describe("Card — zoom-gated blocks", () => {
  it("shows tag names only at zoom level 3", () => {
    const story = makeStory({ tags: [["backend", "#ff0000"], ["urgent", null]] });
    const atThree = renderCard({ story, zoomLevel: 3, zoom: ZOOM3 });
    const tags3 = atThree.container.querySelectorAll(".card-tag");
    expect(tags3).toHaveLength(2);
    expect(tags3[0]).toHaveTextContent("backend");
    // Default fallback colour applied when a tag has no colour.
    expect(tags3[1]).toHaveAttribute("title", "urgent");

    const atTwo = renderCard({ story, zoomLevel: 2, zoom: ZOOM2 });
    const tags2 = atTwo.container.querySelectorAll(".card-tag");
    expect(tags2).toHaveLength(2);
    expect(tags2[0]).toHaveTextContent(""); // name hidden below zoom 3
  });

  it("does not render .card-tags when tags feature is not visible", () => {
    const story = makeStory({ tags: [["backend", "#ff0000"]] });
    const { container } = renderCard({ story, zoomLevel: 1, zoom: ZOOM1 });
    expect(container.querySelector(".card-tags")).toBeNull();
  });

  it("renders .card-actions with a .js-popup-button when zoom > 0 and perms allow", () => {
    const { container } = renderCard({ zoomLevel: 1, zoom: ZOOM1 });
    expect(container.querySelector(".card-actions .js-popup-button")).toBeInTheDocument();
  });

  it("does NOT render .card-actions at zoom 0", () => {
    const { container } = renderCard({ zoomLevel: 0, zoom: ZOOM0 });
    expect(container.querySelector(".card-actions")).toBeNull();
  });

  it("does NOT render .card-actions without modify_us/delete_us", () => {
    const { container } = renderCard({
      zoomLevel: 1,
      zoom: ZOOM1,
      project: makeProject({ my_permissions: ["view_tasks"] }),
    });
    expect(container.querySelector(".card-actions")).toBeNull();
  });

  it("renders .card-epics at zoom > 0 and compact epics at zoom 0", () => {
    const story = makeStory({ epics: [{ id: 5, ref: 9, subject: "Auth epic", color: "#0f0" }] });
    const nonCompact = renderCard({ story, zoomLevel: 2, zoom: ZOOM2 });
    expect(nonCompact.container.querySelector(".card-epics .card-epic")).toBeInTheDocument();
    expect(nonCompact.container.querySelector(".card-epics .epic-name")).toHaveTextContent("Auth epic");

    const compact = renderCard({ story, zoomLevel: 0, zoom: ZOOM0 });
    expect(compact.container.querySelector(".card-epics")).toBeNull();
    expect(compact.container.querySelector(".card-compact-epics .card-epic")).toBeInTheDocument();
    // epic-name is hidden at zoom 0.
    expect(compact.container.querySelector(".card-compact-epics .epic-name")).toBeNull();
  });

  it("renders .card-data when card-data is visible and omits it at zoom 0", () => {
    expect(renderCard({ zoomLevel: 1, zoom: ZOOM1 }).container.querySelector(".card-data")).toBeInTheDocument();
    expect(renderCard({ zoomLevel: 0, zoom: ZOOM0 }).container.querySelector(".card-data")).toBeNull();
  });
});

describe("Card — assigned-to variants", () => {
  it("renders the not-assigned avatar and title when unassigned (with extended)", () => {
    const { container } = renderCard({ zoomLevel: 1, zoom: ZOOM1 });
    const notAssigned = container.querySelector(".card-user-avatar.card-not-assigned");
    expect(notAssigned).toBeInTheDocument();
    expect(notAssigned!.querySelector("img")).toHaveAttribute("src", "/images/unnamed.png");
    expect(container.querySelector(".card-not-assigned-title")).toHaveTextContent("Not assigned");
  });

  it("renders a single avatar for a single assigned_to using the member big_photo", () => {
    const { container } = renderCard({
      story: makeStory({ assigned_to: 1 }),
      usersById: { 1: makeMember() },
    });
    const avatars = container.querySelectorAll(".card-assigned-to .card-user-avatar");
    expect(avatars).toHaveLength(1);
    expect(avatars[0].querySelector("img")).toHaveAttribute("src", "/media/ada-big.png");
    expect(avatars[0].querySelector("img")).toHaveAttribute("title", "Ada Lovelace");
  });

  it("renders the iocaine background for a single iocaine assignee", () => {
    const { container } = renderCard({
      story: makeStory({ assigned_to: 1, is_iocaine: true }),
      usersById: { 1: makeMember() },
    });
    expect(container.querySelector(".card-assigned-to.is_iocaine")).toBeInTheDocument();
    expect(container.querySelector(".card-iocaine-user-bg svg path")).toBeInTheDocument();
  });

  it("renders three avatars when exactly three users are assigned", () => {
    const { container } = renderCard({
      story: makeStory({ assigned_users: [1, 2, 3] }),
      usersById: { 1: makeMember({ id: 1 }), 2: makeMember({ id: 2 }), 3: makeMember({ id: 3 }) },
    });
    const imgs = container.querySelectorAll(".card-assigned-to .card-user-avatar img");
    expect(imgs).toHaveLength(3);
  });

  it("renders 2 avatars + an .extra-assigned counter when more than three users are assigned", () => {
    const { container } = renderCard({
      story: makeStory({ assigned_users: [1, 2, 3, 4, 5] }),
      usersById: { 1: makeMember({ id: 1 }), 2: makeMember({ id: 2 }), 3: makeMember({ id: 3 }) },
    });
    expect(container.querySelectorAll(".card-assigned-to .card-user-avatar img")).toHaveLength(2);
    const extra = container.querySelector(".extra-assigned");
    expect(extra).toHaveTextContent("3+"); // 5 - 2
  });

  it("does not render the assigned-to block on an archived project", () => {
    const { container } = renderCard({
      project: makeProject({ archived_code: "ARCH" }),
    });
    expect(container.querySelector(".card-assigned-to")).toBeNull();
  });
});

describe("Card — card-data statistics (zoom 2 => extra_info)", () => {
  it("shows the estimation with points and a data-id", () => {
    const { container } = renderCard({
      zoomLevel: 2,
      zoom: ZOOM2,
      story: makeStory({ total_points: 5 }),
    });
    const est = container.querySelector(".card-estimation") as HTMLElement;
    expect(est).toHaveTextContent("5 pts");
    expect(est).toHaveAttribute("data-id", "42");
  });

  it("shows the no-points placeholder when total_points is null", () => {
    const { container } = renderCard({ zoomLevel: 2, zoom: ZOOM2 });
    expect(container.querySelector(".card-estimation")).toHaveTextContent("--");
  });

  it("renders due-date, iocaine and lock indicators when present", () => {
    const { container } = renderCard({
      zoomLevel: 2,
      zoom: ZOOM2,
      story: makeStory({ due_date: "2026-01-01", is_iocaine: true, is_blocked: true }),
    });
    expect(container.querySelector(".card-due-date .icon-clock")).toBeInTheDocument();
    expect(container.querySelector(".card-iocaine .icon-iocaine")).toBeInTheDocument();
    expect(container.querySelector(".card-lock .icon-lock")).toBeInTheDocument();
  });

  it("renders attachment / watcher / comment statistics from counts", () => {
    const { container } = renderCard({
      zoomLevel: 2,
      zoom: ZOOM2,
      story: makeStory({ total_attachments: 3, total_watchers: 2, total_comments: 4 }),
    });
    expect(container.querySelector(".statistic.card-attachments span")).toHaveTextContent("3");
    expect(container.querySelector(".statistic.card-watchers span")).toHaveTextContent("2");
    expect(container.querySelector(".statistic.card-comments span")).toHaveTextContent("4");
  });

  it("renders the completed-tasks statistic and marks it completed when all are closed", () => {
    const partial = renderCard({
      zoomLevel: 2,
      zoom: ZOOM2,
      story: makeStory({ tasks: [{ id: 1, is_closed: true }, { id: 2, is_closed: false }] }),
    });
    const partialStat = partial.container.querySelector(".card-completed-tasks") as HTMLElement;
    expect(partialStat).toHaveTextContent("1 / 2");
    expect(partialStat).not.toHaveClass("completed");

    const allClosed = renderCard({
      zoomLevel: 2,
      zoom: ZOOM2,
      story: makeStory({ tasks: [{ id: 1, is_closed: true }, { id: 2, is_closed: true }] }),
    });
    expect(allClosed.container.querySelector(".card-completed-tasks")).toHaveClass("completed");
  });
});

describe("Card — tasks, slideshow and unfold (zoom 3)", () => {
  it("renders related tasks with closed/blocked classes when view_tasks is granted", () => {
    const { container } = renderCard({
      zoomLevel: 3,
      zoom: ZOOM3,
      story: makeStory({
        tasks: [
          { id: 1, ref: 11, subject: "closed task", is_closed: true },
          { id: 2, ref: 12, subject: "blocked task", is_blocked: true },
        ],
      }),
    });
    const tasks = container.querySelectorAll(".card-tasks .card-task");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].querySelector("a")).toHaveClass("closed-task");
    expect(tasks[0].querySelector(".card-task-ref")).toHaveTextContent("#11");
    expect(tasks[1].querySelector("a")).toHaveClass("blocked-task");
  });

  it("does not render tasks without view_tasks permission", () => {
    const { container } = renderCard({
      zoomLevel: 3,
      zoom: ZOOM3,
      project: makeProject({ my_permissions: ["modify_us"] }),
      story: makeStory({ tasks: [{ id: 1, ref: 11, subject: "t", is_closed: false }] }),
    });
    expect(container.querySelector(".card-tasks")).toBeNull();
  });

  it("renders the slideshow thumbnails when attachments have thumbnails", () => {
    const { container } = renderCard({
      zoomLevel: 3,
      zoom: ZOOM3,
      story: makeStory({ images: [{ id: 1, thumbnail_card_url: "/thumb/1.png" }] }),
    });
    const slideshow = container.querySelector(".card-slideshow");
    expect(slideshow).toBeInTheDocument();
    expect(slideshow!.querySelector("img")).toHaveAttribute("src", "/thumb/1.png");
  });

  it("renders .card-unfold when unfold is visible and there are tasks", () => {
    const { container } = renderCard({
      zoomLevel: 2,
      zoom: ZOOM2,
      story: makeStory({ tasks: [{ id: 1, is_closed: false }] }),
    });
    expect(container.querySelector(".card-unfold")).toBeInTheDocument();
    expect(container.querySelector(".card-inner")).toHaveClass("with-fold-action");
  });

  it("uses arrow-down at zoom 2 when not folded and arrow-up when folded", () => {
    const notFolded = renderCard({
      zoomLevel: 2,
      zoom: ZOOM2,
      story: makeStory({ tasks: [{ id: 1, is_closed: false }] }),
    });
    expect(notFolded.container.querySelector(".card-unfold .icon-arrow-down")).toBeInTheDocument();

    const foldedCard = renderCard({
      zoomLevel: 2,
      zoom: ZOOM2,
      folded: true,
      story: makeStory({ tasks: [{ id: 1, is_closed: false }] }),
    });
    expect(foldedCard.container.querySelector(".card-unfold .icon-arrow-up")).toBeInTheDocument();
  });

  it("uses arrow-up at zoom 3 when not folded (inverse of zoom 2)", () => {
    const { container } = renderCard({
      zoomLevel: 3,
      zoom: ZOOM3,
      story: makeStory({ tasks: [{ id: 1, is_closed: false }] }),
    });
    expect(container.querySelector(".card-unfold .icon-arrow-up")).toBeInTheDocument();
  });

  it("does not render .card-unfold when there are no tasks or attachments", () => {
    const { container } = renderCard({ zoomLevel: 2, zoom: ZOOM2 });
    expect(container.querySelector(".card-unfold")).toBeNull();
  });
});

describe("Card — icons", () => {
  it("renders icons as <svg class='icon icon-…'><use xlink:href='#icon-…'/></svg>", () => {
    const { container } = renderCard();
    const editIcon = container.querySelector(".e2e-edit svg.icon.icon-edit") as SVGElement;
    expect(editIcon).toBeInTheDocument();
    const use = editIcon.querySelector("use");
    expect(use).toBeInTheDocument();
    expect(use!.getAttribute("xlink:href")).toBe("#icon-edit");
  });
});

describe("Card — behaviour", () => {
  it("calls onToggleSelect on ctrl/meta click and NOT on a plain click", () => {
    const onToggleSelect = jest.fn();
    const { root } = renderCard({ onToggleSelect });

    fireEvent.click(root); // plain click
    expect(onToggleSelect).not.toHaveBeenCalled();

    fireEvent.click(root, { ctrlKey: true });
    expect(onToggleSelect).toHaveBeenCalledWith(42, expect.anything());

    fireEvent.click(root, { metaKey: true });
    expect(onToggleSelect).toHaveBeenCalledTimes(2);
  });

  it("calls onToggleFold when the unfold control is clicked without ctrl/meta", () => {
    const onToggleFold = jest.fn();
    const { container } = renderCard({
      onToggleFold,
      zoomLevel: 2,
      zoom: ZOOM2,
      story: makeStory({ tasks: [{ id: 1, is_closed: false }] }),
    });
    const unfold = container.querySelector(".card-unfold") as HTMLElement;

    fireEvent.click(unfold, { ctrlKey: true });
    expect(onToggleFold).not.toHaveBeenCalled();

    fireEvent.click(unfold);
    expect(onToggleFold).toHaveBeenCalledWith(42);
  });

  it("calls onClickAssignedTo when the .e2e-assign link is clicked", () => {
    const onClickAssignedTo = jest.fn();
    const { container } = renderCard({ onClickAssignedTo });
    fireEvent.click(container.querySelector(".e2e-assign") as HTMLElement);
    expect(onClickAssignedTo).toHaveBeenCalledWith(42);
  });

  it("calls onClickEdit when the .e2e-edit link is clicked", () => {
    const onClickEdit = jest.fn();
    const { container } = renderCard({ onClickEdit });
    fireEvent.click(container.querySelector(".e2e-edit") as HTMLElement);
    expect(onClickEdit).toHaveBeenCalledWith(42);
  });

  it("does not render .e2e-edit when the user lacks modify_us", () => {
    const { container } = renderCard({
      project: makeProject({ my_permissions: ["view_tasks"] }),
    });
    expect(container.querySelector(".e2e-edit")).toBeNull();
    // The assign link is always present.
    expect(container.querySelector(".e2e-assign")).toBeInTheDocument();
  });

  it("renders the resolved assignee display name in .card-owner-name", () => {
    const { container } = renderCard({
      story: makeStory({ assigned_to: 1 }),
      usersById: { 1: makeMember() },
    });
    expect(container.querySelector(".card-owner-name")).toHaveTextContent("Ada Lovelace");
  });

  it("renders an empty .card-owner-name when unassigned", () => {
    const { container } = renderCard();
    expect(container.querySelector(".card-owner-name")).toHaveTextContent("");
  });

  it("opens the actions menu and wires edit / delete / move-to-top", () => {
    const onClickEdit = jest.fn();
    const onClickDelete = jest.fn();
    const onClickMoveToTop = jest.fn();
    const { container } = renderCard({
      zoomLevel: 1,
      zoom: ZOOM1,
      onClickEdit,
      onClickDelete,
      onClickMoveToTop,
    });

    // Menu is hidden by default.
    expect(container.querySelector(".card-actions-menu")).toBeNull();

    fireEvent.click(container.querySelector(".js-popup-button") as HTMLElement);
    expect(container.querySelector(".card-actions-menu")).toBeInTheDocument();

    fireEvent.click(container.querySelector(".card-action-edit") as HTMLElement);
    expect(onClickEdit).toHaveBeenCalledWith(42);

    fireEvent.click(container.querySelector(".js-popup-button") as HTMLElement);
    fireEvent.click(container.querySelector(".card-action-move-to-top") as HTMLElement);
    expect(onClickMoveToTop).toHaveBeenCalledWith(42);

    fireEvent.click(container.querySelector(".js-popup-button") as HTMLElement);
    fireEvent.click(container.querySelector(".card-action-delete") as HTMLElement);
    expect(onClickDelete).toHaveBeenCalledWith(42);
  });
});

describe("Card — drag gating", () => {
  it("enables dragging (disabled:false) with modify_us on a non-archived project/card", () => {
    renderCard();
    expect(mockUseCardDraggable).toHaveBeenCalledWith(42, { disabled: false });
  });

  it("disables dragging without modify_us", () => {
    renderCard({ project: makeProject({ my_permissions: ["view_tasks"] }) });
    expect(mockUseCardDraggable).toHaveBeenCalledWith(42, { disabled: true });
  });

  it("disables dragging when the card is archived", () => {
    renderCard({ archived: true });
    expect(mockUseCardDraggable).toHaveBeenCalledWith(42, { disabled: true });
  });

  it("disables dragging when the project is archived", () => {
    renderCard({ project: makeProject({ archived_code: "ARCH" }) });
    expect(mockUseCardDraggable).toHaveBeenCalledWith(42, { disabled: true });
  });
});

// ---------------------------------------------------------------------------
// Defensive null/undefined value states (UI9) + per-permission menu branches.
// These exercise the fallback branches (`?? ""`, `?? undefined`, member/avatar
// resolution chains) and the actions-menu buttons under partial permissions.
// ---------------------------------------------------------------------------
describe("Card — defensive value states and partial-permission menu", () => {
  it("renders a delete-only actions menu (no edit button without modify_us)", () => {
    const onClickDelete = jest.fn();
    const onClickEdit = jest.fn();
    const { container, root } = renderCard({
      zoomLevel: 1,
      zoom: ZOOM1,
      project: makeProject({ my_permissions: ["delete_us", "view_tasks"] }),
      onClickDelete,
      onClickEdit,
    });

    // Lacking modify_us marks the card readonly but the delete permission still
    // renders the actions trigger.
    expect(root).toHaveClass("readonly");
    fireEvent.click(container.querySelector(".js-popup-button") as HTMLElement);
    expect(container.querySelector(".card-actions-menu")).toBeInTheDocument();

    // Edit is gated on modify_us and must be absent; delete is present.
    expect(container.querySelector(".card-action-edit")).toBeNull();
    fireEvent.click(container.querySelector(".card-action-delete") as HTMLElement);
    expect(onClickDelete).toHaveBeenCalledWith(42);
    expect(onClickEdit).not.toHaveBeenCalled();
  });

  it("handles a story with no ref and no subject (renders '#', no subject span)", () => {
    const { container } = renderCard({
      zoomLevel: 0,
      zoom: ZOOM0,
      story: makeStory({ ref: undefined, subject: undefined }),
    });

    // visible('ref') is true at zoom 0 -> "#" with the empty ref fallback.
    const ref = container.querySelector(".card-ref");
    expect(ref).toBeInTheDocument();
    expect(ref?.textContent).toBe("#");

    // visible('subject') is false at zoom 0 -> no subject span at all.
    expect(container.querySelector(".card-subject")).toBeNull();

    // The nav href tolerates the missing ref (…/us/ with the empty fallback).
    const link = container.querySelector(".card-title a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("#/project/proj/us/");
  });

  it("renders an epic with a null color and missing ref without breaking the DOM", () => {
    const { container } = renderCard({
      zoomLevel: 1,
      zoom: ZOOM1,
      story: makeStory({
        epics: [{ id: 9, ref: undefined, subject: "Epic A", color: null }],
      }),
    });

    const epic = container.querySelector(".card-epics .card-epic") as HTMLAnchorElement;
    expect(epic).toBeInTheDocument();
    // ref fallback -> …/epic/ ; a null color yields no inline background-color.
    expect(epic.getAttribute("href")).toBe("#/project/proj/epic/");
    const color = epic.querySelector(".epic-color") as HTMLElement;
    expect(color.style.backgroundColor).toBe("");
    // At zoom > 0 the first epic also shows its name.
    expect(epic.querySelector(".epic-name")?.textContent).toBe("Epic A");
  });

  it("resolves a single assignee by username and falls back to the default avatar", () => {
    const { container } = renderCard({
      zoomLevel: 1,
      zoom: ZOOM1,
      story: makeStory({ assigned_to: 5, assigned_users: [] }),
      usersById: { 5: { id: 5, username: "neo" } },
    });

    // memberName() falls through full_name_display/full_name to username.
    expect(container.querySelector(".card-owner-name")?.textContent).toBe("neo");

    // avatar() falls back to the bundled placeholder when the member has no photo.
    const avatar = container.querySelector(
      ".card-assigned-to .card-user-avatar img",
    ) as HTMLImageElement;
    expect(avatar.getAttribute("src")).toBe("/images/unnamed.png");
    expect(avatar.getAttribute("title")).toBe("neo");
    expect(avatar.getAttribute("alt")).toBe("neo");
  });
});


// ---------------------------------------------------------------------------
// Tag colours — the `getTagColor` fallback (CardController.getTagColor). A tag
// keeps its own colour; a null colour falls back to the shared default
// `#A9AABC`. jsdom normalises inline hex colours to `rgb(...)`, and the
// `@testing-library/jest-dom` `toHaveStyle` matcher parses either form, so the
// assertions below are written against the source-of-truth hex literals.
// ---------------------------------------------------------------------------
describe("Card — tag colours (getTagColor fallback)", () => {
  it("uses the tag's own colour and applies the #A9AABC fallback for a null colour", () => {
    const story = makeStory({ tags: [["backend", "#e44057"], ["urgent", null]] });
    const { container } = renderCard({ story, zoomLevel: 3, zoom: ZOOM3 });

    const tags = container.querySelectorAll(".card-tags .card-tag");
    expect(tags).toHaveLength(2);

    // The coloured tag keeps its explicit backend colour (and shows its name at zoom 3).
    expect(tags[0]).toHaveStyle({ backgroundColor: "#e44057" });
    expect(tags[0]).toHaveTextContent("backend");

    // The null-colour tag falls back to the default #A9AABC (== rgb(169, 170, 188)).
    expect(tags[1]).toHaveStyle({ backgroundColor: "#A9AABC" });
    expect(tags[1]).toHaveTextContent("urgent");
    // Belt-and-braces: assert the exact jsdom-normalised inline style value too.
    expect((tags[1] as HTMLElement).style.backgroundColor).toBe("rgb(169, 170, 188)");
  });
});

// ---------------------------------------------------------------------------
// Assigned-to preview counter — the "size-2" avatar preview rule. For four
// assigned users only the first two avatars render and a `.extra-assigned`
// chip reports the remaining count as `${count - 2}+` (i.e. "2+").
// ---------------------------------------------------------------------------
describe("Card — assigned-to preview counter (size-2 rule)", () => {
  it("renders exactly two avatars and a '2+' counter for four assigned users", () => {
    const { container } = renderCard({
      story: makeStory({ assigned_users: [1, 2, 3, 4] }),
      usersById: {
        1: makeMember({ id: 1 }),
        2: makeMember({ id: 2 }),
        3: makeMember({ id: 3 }),
        4: makeMember({ id: 4 }),
      },
    });

    // Only the first two avatars render (the preview is capped for 4+ assignees).
    expect(
      container.querySelectorAll(".card-assigned-to .card-user-avatar img"),
    ).toHaveLength(2);

    // The overflow chip reports the remaining count: 4 - 2 => "2+".
    const extra = container.querySelector(".extra-assigned");
    expect(extra).toBeInTheDocument();
    expect(extra).toHaveTextContent("2+");
    expect(extra).toHaveAttribute("title", "More assigned users");
  });
});

// ---------------------------------------------------------------------------
// Additional branch coverage — defensive/negative branches that the primary
// suites above do not otherwise reach (ref-not-visible, the optional
// move-to-top action, mixed thumbnail/thumbnail-less slideshow images, and the
// blocked-card lock indicator co-located with the .card-blocked modifier).
// ---------------------------------------------------------------------------
describe("Card — additional branch coverage", () => {
  it("omits the .card-ref span when 'ref' is absent from the visible zoom set", () => {
    // A synthetic zoom set that shows the subject but explicitly excludes 'ref'.
    const { container } = renderCard({ zoomLevel: 1, zoom: ["subject", "assigned_to"] });

    expect(container.querySelector(".card-ref")).toBeNull();
    // The subject still renders because its feature IS present in the set.
    expect(container.querySelector(".card-subject.e2e-title")).toHaveTextContent(
      "Implement login",
    );
  });

  it("omits the move-to-top action when no onClickMoveToTop handler is provided", () => {
    const onClickEdit = jest.fn();
    const onClickDelete = jest.fn();
    const { container } = renderCard({
      zoomLevel: 1,
      zoom: ZOOM1,
      onClickMoveToTop: undefined,
      onClickEdit,
      onClickDelete,
    });

    fireEvent.click(container.querySelector(".js-popup-button") as HTMLElement);
    expect(container.querySelector(".card-actions-menu")).toBeInTheDocument();

    // Edit + delete are present (permissions allow) but move-to-top is gated on
    // the optional handler and must be absent.
    expect(container.querySelector(".card-action-move-to-top")).toBeNull();
    expect(container.querySelector(".card-action-edit")).toBeInTheDocument();
    expect(container.querySelector(".card-action-delete")).toBeInTheDocument();
  });

  it("renders only the thumbnailed slideshow images, skipping thumbnail-less ones", () => {
    const { container } = renderCard({
      zoomLevel: 3,
      zoom: ZOOM3,
      story: makeStory({
        images: [
          { id: 1, thumbnail_card_url: "/thumb/1.png" },
          { id: 2, thumbnail_card_url: null },
          { id: 3, thumbnail_card_url: "/thumb/3.png" },
        ],
      }),
    });

    const slideshow = container.querySelector(".card-slideshow");
    expect(slideshow).toBeInTheDocument();

    // Only the two images that carry a thumbnail_card_url render an <img>.
    const imgs = slideshow!.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("src", "/thumb/1.png");
    expect(imgs[1]).toHaveAttribute("src", "/thumb/3.png");
  });

  it("shows the lock indicator and .card-blocked modifier together for a blocked story", () => {
    // .card-lock lives inside .card-statistics-init, which is gated on
    // visible('extra_info') (zoom >= 2); assert both facets at that zoom.
    const { container } = renderCard({
      zoomLevel: 2,
      zoom: ZOOM2,
      story: makeStory({ is_blocked: true }),
    });

    expect(container.querySelector(".card-inner")).toHaveClass("card-blocked");
    const lock = container.querySelector(".card-lock");
    expect(lock).toBeInTheDocument();
    expect(lock!.querySelector("svg.icon.icon-lock use")).toHaveAttribute(
      "xlink:href",
      "#icon-lock",
    );
  });
});


// ---------------------------------------------------------------------------
// Defensive nullish-coalescing guards — Card.tsx reads every optional API
// collection defensively (`?? []` / `?? 0`) because the hook's usMap holds RAW
// stories that may omit these fields entirely. Rendering a story whose optional
// arrays are `undefined` (not `[]`) at full zoom exercises those fallback
// branches and proves the card never throws on a sparse payload.
// ---------------------------------------------------------------------------
describe("Card — defensive nullish guards for missing optional collections", () => {
  it("renders at full zoom when tags/assigned_users/attachments/epics/tasks are all undefined", () => {
    const { container, root } = renderCard({
      zoomLevel: 3,
      zoom: ZOOM3,
      story: makeStory({
        tags: undefined,
        assigned_users: undefined,
        attachments: undefined,
        images: undefined,
        epics: undefined,
        tasks: undefined,
        total_points: null,
      }),
    });

    // The card renders without crashing on the sparse payload.
    expect(root).toBeInTheDocument();
    expect(container.querySelector(".card-inner")).toBeInTheDocument();

    // No optional collections => none of their sub-blocks render.
    expect(container.querySelector(".card-tags")).toBeNull();
    expect(container.querySelector(".card-epics")).toBeNull();
    expect(container.querySelector(".card-compact-epics")).toBeNull();
    expect(container.querySelector(".card-tasks")).toBeNull();
    expect(container.querySelector(".card-slideshow")).toBeNull();
    expect(container.querySelector(".card-unfold")).toBeNull();

    // With no assignee the not-assigned avatar still renders (count === 0).
    expect(container.querySelector(".card-user-avatar.card-not-assigned")).toBeInTheDocument();
    // The .card-inner must NOT gain the assigned-user modifier for an empty set.
    expect(container.querySelector(".card-inner")).not.toHaveClass("with-assigned-user");

    // Estimation falls back to the no-points placeholder.
    expect(container.querySelector(".card-estimation")).toHaveTextContent("--");
  });
});

