/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link Backlog} — the top-level React reproduction of the
 * AngularJS `BacklogController` screen container (feature F-002). The rendered
 * DOM mirrors the legacy `backlog.jade` + `backlog-table.jade` + `addnewus.jade`
 * templates, so these tests assert on the exact class names, `data-*`/`ng-repeat`
 * attributes and copy that the (unchanged) compiled Taiga SCSS and the ported
 * Playwright/e2e selectors depend on. They contribute to the >= 70% line-coverage
 * gate enforced by `jest.config.js` for the new React code.
 *
 * Test seam (per the file's agent brief):
 *   - `./hooks/useBacklogStories` is MOCKED. The real hook spins up the API +
 *     WebSocket clients and owns all screen state; mocking it lets each test feed
 *     a fully controlled view-model (`vm`) and keeps the suite a deterministic,
 *     network-free DOM assertion of the CONTAINER.
 *   - `./lightboxes/CreateEditSprint` is MOCKED with a tiny stub that renders a
 *     queryable `[data-testid="sprint-lb"]` marker only while `open` — the sprint
 *     modal itself (form state, validation) is covered by its own suite.
 *   - `BacklogRow`, `SprintList`/`Sprint`/`SprintHeader` and `BurndownSummary`
 *     are kept REAL so the container's composition is genuinely exercised: the
 *     `.backlog-table-body > div[ng-repeat]` rows, the `<aside>` sidebar
 *     `div[tg-backlog-sprint="sprint"]` cards, and the `.summary .data .number`
 *     burndown figure are the ACTUAL child output, not stand-ins.
 *   - `@dnd-kit` is left REAL. Its `DndContext`/`SortableContext`/`useSortable`/
 *     `useDroppable` primitives render correctly under jsdom (they only need
 *     pointer geometry once a drag actually starts, which these DOM-only tests
 *     never trigger), exactly as the sibling `SprintList` suite relies on.
 *
 * Conventions (identical to the sibling React tests):
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — no `import React`.
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`/`beforeEach`) — no
 *     `@jest/globals` import; the tsconfig `types` array ships `"jest"`.
 *   - `ts-jest` + `jsdom`; `@testing-library/jest-dom` matchers are registered by
 *     `jest.setup.ts` (`setupFilesAfterEnv`).
 *   - Strict TypeScript: the controlled view-model is built loosely (`any`) and
 *     handed to the mocked hook cast to its `BacklogVM` return type, so a test can
 *     freely mutate individual fields (permissions, lightbox flag, velocity) per
 *     case without re-satisfying the whole interface.
 */

import { render, fireEvent } from "@testing-library/react";
import { Backlog } from "./Backlog";
import { useBacklogStories } from "./hooks/useBacklogStories";
import type { BacklogVM } from "./hooks/useBacklogStories";
import type { MountContext } from "../shared/types";
import { __resetPopoverRegistry } from "../shared/popover/usePopover";
import { t } from "../shared/i18n/translate";

// ---------------------------------------------------------------------------
// Module mocks
//
// NOTE ON ORDERING: `ts-jest` hoists every `jest.mock(...)` call above the
// imports above, so the mock factories below are registered BEFORE `./Backlog`
// (and its child imports) are evaluated. Keeping the imports first is the
// idiomatic, lint-friendly form and is functionally equivalent to importing
// `Backlog` after the mocks.
// ---------------------------------------------------------------------------

// The hook is the ONLY data/side-effect boundary of the screen; replacing it
// with a bare `jest.fn()` (whose return value each test configures via
// `mockReturnValue`) avoids referencing any out-of-scope variable inside the
// factory (which Jest's hoist guard forbids) while still letting tests drive the
// entire view-model.
jest.mock("./hooks/useBacklogStories", () => ({
  useBacklogStories: jest.fn(),
}));

// The sprint create/edit lightbox is heavy (its own form + validation module).
// Here it is reduced to a presence marker gated on `open`, so the container test
// can prove it is mounted with the right visibility without pulling the modal in.
jest.mock("./lightboxes/CreateEditSprint", () => ({
  CreateEditSprint: (props: { open: boolean }) =>
    props.open ? <div data-testid="sprint-lb" /> : null,
}));

// The shared React story lightboxes (finding C7) are stubbed to queryable
// markers, mirroring the CreateEditSprint stub. Each stub renders submit/close
// buttons ONLY while `open`, so container tests can prove the create / edit /
// bulk wiring by clicking and asserting the correct hook handler fired. A
// factory preserves the real non-component barrel exports (e.g. storyToFormValues).
jest.mock("../shared/lightboxes", () => {
  const actual = jest.requireActual("../shared/lightboxes");
  return {
    ...actual,
    StoryFormLightbox: (props: {
      open: boolean;
      mode: string;
      onSubmit: (v: unknown) => void;
      onClose: () => void;
    }) =>
      props.open ? (
        <div data-testid="story-lb" data-mode={props.mode}>
          <button
            type="button"
            data-testid="story-lb-submit"
            onClick={() => props.onSubmit({ subject: "x" })}
          />
          <button
            type="button"
            data-testid="story-lb-close"
            onClick={() => props.onClose()}
          />
        </div>
      ) : null,
    BulkStoryLightbox: (props: {
      open: boolean;
      onSubmit: (v: unknown) => void;
      onClose: () => void;
    }) =>
      props.open ? (
        <div data-testid="bulk-lb">
          <button
            type="button"
            data-testid="bulk-lb-submit"
            onClick={() =>
              props.onSubmit({ bulk: "a", status: null, swimlane: null, us_position: "bottom" })
            }
          />
          <button
            type="button"
            data-testid="bulk-lb-close"
            onClick={() => props.onClose()}
          />
        </div>
      ) : null,
  };
});

// `@dnd-kit/core` is kept REAL (children's `useDroppable`/`useSortable` render
// under jsdom), but its `DndContext` is wrapped by a thin passthrough that
// CAPTURES the `onDragEnd` callback into `mockCapturedOnDragEnd`. jsdom cannot
// synthesize the pointer geometry a real drag needs, so the C8 wiring tests
// below invoke that captured handler with synthetic `DragEndEvent`s — exercising
// the PRODUCTION `onDragEnd` (active-story lookup across backlog + sprints, the
// over-descriptor routing, id->UserStory mapping and the single `moveUs` call)
// end-to-end. The wrapper still renders the real context, so the existing
// DOM-only tests are unaffected.
let mockCapturedOnDragEnd: ((event: unknown) => void) | undefined;
jest.mock("@dnd-kit/core", () => {
  const actual = jest.requireActual("@dnd-kit/core");
  const ActualDndContext = actual.DndContext;
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DndContext: (props: any) => {
      mockCapturedOnDragEnd = props.onDragEnd;
      return <ActualDndContext {...props} />;
    },
  };
});

/** Typed handle to the mocked hook so tests can set its return value. */
const mockUseBacklogStories = useBacklogStories as jest.MockedFunction<
  typeof useBacklogStories
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Mount context bridged from the `<tg-react-backlog>` custom element. */
const context: MountContext = {
  projectSlug: "proj",
  token: "t",
  sessionId: "s",
  apiUrl: "/api/v1/",
  eventsUrl: null,
  language: "en",
};

/**
 * The controlled view-model returned by the mocked hook. It is typed loosely
 * (`any`) on purpose: individual tests mutate single fields (`project.
 * my_permissions`, `sprintLightbox.open`, `displayVelocity`, …) BEFORE rendering,
 * and the mock returns this exact reference, so those mutations are reflected the
 * moment `<Backlog>` calls the hook. Rebuilt fresh in `beforeEach` so no per-test
 * mutation leaks into the next case.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vm: any;

/**
 * Build a complete, self-consistent Backlog view-model with every permission
 * granted, two backlog stories, one open sprint, and a burndown at 40% complete.
 *
 * Every field the real {@link BacklogVM} exposes is present so `<Backlog>` (and
 * its real children) render exactly as in production. Each action is a fresh
 * `jest.fn()` for per-test call assertions; `hasPermission` is a live predicate
 * over the CURRENT `vm.project.my_permissions` so the read-only test can revoke
 * permissions by reassigning that array. The `project` (and its `my_permissions`
 * array) is rebuilt on every call so a test that reassigns permissions cannot
 * corrupt a shared object.
 */
function makeVM() {
  return {
    // ---- state ----
    loading: false,
    errorMessage: null,
    savingUs: false,
    project: {
      id: 7,
      slug: "proj",
      name: "My Project",
      my_permissions: [
        "modify_us",
        "add_us",
        "delete_us",
        "add_milestone",
        "view_milestones",
        "modify_milestone",
      ],
      is_kanban_activated: true,
      is_backlog_activated: true,
      i_am_admin: true,
      roles: [],
      points: [],
    },
    projectId: 7,
    userstories: [
      { id: 101, ref: 1, subject: "US one", status: 1, tags: [] },
      { id: 102, ref: 2, subject: "US two", status: 1, tags: [] },
    ],
    sprints: [
      {
        id: 3,
        name: "Sprint 1",
        estimated_start: "2020-01-10",
        estimated_finish: "2020-01-24",
        closed: false,
        user_stories: [],
        total_points: 20,
        closed_points: 5,
      },
    ],
    closedSprints: [],
    closedSprintsVisible: false,
    totalMilestones: 1,
    totalClosedMilestones: 0,
    totalUserStories: 2,
    currentSprint: null,
    stats: {
      total_points: 100,
      defined_points: 80,
      closed_points: 40,
      speed: 0,
      completedPercentage: 40,
    },
    showGraphPlaceholder: false,
    showTags: false,
    activeFilters: false,
    displayVelocity: false,
    forecastNewSprint: true,
    filterQ: "",
    selectedFilters: [],
    filters: [],
    customFilters: [],
    statuses: [
      { id: 1, name: "New", color: "#aaa", order: 1 },
      { id: 2, name: "Done", color: "#0f0", order: 2 },
    ],
    selectedUs: new Set<number>(),
    eventsConnected: false,
    apiClient: {},
    sprintLightbox: { open: false, mode: "create", sprint: null, lastSprint: null },
    activeLightbox: null,
    // ---- actions ----
    hasPermission: jest.fn((perm: string) => vm.project.my_permissions.includes(perm)),
    isBacklogActivated: true,
    loadUserstories: jest.fn(),
    changeQ: jest.fn(),
    addFilter: jest.fn(),
    removeFilter: jest.fn(),
    saveCustomFilter: jest.fn(),
    selectCustomFilter: jest.fn(),
    removeCustomFilter: jest.fn(),
    toggleShowTags: jest.fn(),
    toggleActiveFilters: jest.fn(),
    toggleVelocityForecasting: jest.fn(),
    toggleClosedSprints: jest.fn(),
    moveUs: jest.fn(),
    moveToSprint: jest.fn(),
    moveUsToTop: jest.fn(),
    updateUserStoryStatus: jest.fn(),
    updateUserStoryPoints: jest.fn(),
    deleteUserStory: jest.fn(),
    addNewUs: jest.fn(),
    editUserStory: jest.fn(),
    closeLightbox: jest.fn(),
    submitNewUs: jest.fn(),
    submitEditUs: jest.fn(),
    submitBulkUs: jest.fn(),
    toggleSelectedUs: jest.fn(),
    moveSelectedToCurrentSprint: jest.fn(),
    moveSelectedToLatestSprint: jest.fn(),
    openCreateSprint: jest.fn(),
    openEditSprint: jest.fn(),
    closeSprintLightbox: jest.fn(),
    onSprintSaved: jest.fn(),
    onSprintDeleted: jest.fn(),
    createSprintFromForecasting: jest.fn(),
  };
}

/**
 * Render `<Backlog>` with the current `vm` (already installed as the mocked
 * hook's return value in `beforeEach`). Returns the full RTL result so tests can
 * use `container`/`rerender`.
 */
function renderBacklog() {
  return render(<Backlog context={context} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  vm = makeVM();
  mockUseBacklogStories.mockReturnValue(vm as BacklogVM);
});

// The `usePopover` single-active registry is module-level (shared by the real
// `BacklogRow` popovers and the header role selector rendered here); reset it so
// an open popover cannot leak its close handler into the next test.
afterEach(() => {
  __resetPopoverRegistry();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Backlog — root shell", () => {
  it("renders the main.main.scrum container with section.backlog and the sprint sidebar", () => {
    const { container } = renderBacklog();

    expect(container.querySelector("main.main.scrum")).toBeInTheDocument();
    expect(container.querySelector("section.backlog")).toBeInTheDocument();
    // M7: the legacy non-standard `<sidebar>` tag (a React "unrecognized tag"
    // warning) is emitted as the semantic HTML5 `<aside class="sidebar">`, which
    // carries the same `.sidebar` class the theme targets AND exposes a
    // `complementary` landmark. There must be NO invalid `<sidebar>` element.
    expect(container.querySelector("sidebar")).toBeNull();
    const sidebar = container.querySelector("aside.sidebar");
    expect(sidebar).toBeInTheDocument();
    expect(sidebar?.tagName).toBe("ASIDE");
  });
});

describe("Backlog — header & story count", () => {
  it("renders the 'Backlog' title and the '<n> user stories' count when no filters are selected", () => {
    const { container } = renderBacklog();

    const title = container.querySelector(".backlog-header-title h2");
    expect(title).toBeInTheDocument();
    expect(title?.textContent).toBe("Backlog");

    // selectedFilters is empty -> single, unqualified count span.
    const count = container.querySelector(".backlog-stories-number");
    expect(count).toBeInTheDocument();
    expect(count?.textContent).toBe("2 user stories");
  });

  it("renders the mainTitle h1 with ONLY the section name (BACKLOG.SECTION_NAME => 'Scrum'), never the project name", () => {
    const { container } = renderBacklog();

    // main-title.jade renders `span {{ sectionName | translate }}`; the backlog
    // controller sets sectionName = BACKLOG.SECTION_NAME (=> "Scrum"). This is
    // the SOLE title text — the mock project name ("My Project") must NOT leak
    // into the heading (it lives in the AngularJS project menu, legacy parity).
    const heading = container.querySelector("section.backlog > header h1");
    expect(heading).toBeInTheDocument();
    expect(heading?.querySelector("span")).toHaveTextContent("Scrum");
    expect(heading).not.toHaveTextContent("My Project");
    expect(heading?.textContent).toBe("Scrum");
  });
});

describe("Backlog — add-user-story controls (addnewus.jade)", () => {
  it("renders exactly two .new-us anchors and wires them to addNewUs('standard'|'bulk')", () => {
    const { container } = renderBacklog();

    const anchors = container.querySelectorAll(".new-us a");
    expect(anchors).toHaveLength(2);

    // get(0) is the standard story button; get(1) is the bulk-add icon button.
    fireEvent.click(anchors[0]);
    expect(vm.addNewUs).toHaveBeenCalledWith("standard");

    fireEvent.click(anchors[1]);
    expect(vm.addNewUs).toHaveBeenCalledWith("bulk");
  });
});

describe("Backlog — backlog-table body rows (real BacklogRow)", () => {
  it("renders each story as a DIRECT .backlog-table-body > div[ng-repeat] child (SortableBacklogRow adds no wrapper node)", () => {
    const { container } = renderBacklog();

    const rows = container.querySelectorAll(".backlog-table-body > div[ng-repeat]");
    expect(rows).toHaveLength(2);
  });
});

describe("Backlog — show-tags toggle", () => {
  it("renders #show-tags and invokes vm.toggleShowTags on click", () => {
    const { container } = renderBacklog();

    const showTags = container.querySelector("#show-tags");
    expect(showTags).toBeInTheDocument();

    fireEvent.click(showTags as Element);
    expect(vm.toggleShowTags).toHaveBeenCalledTimes(1);
  });
});

describe("Backlog — move-to-sprint control", () => {
  it("renders the 'Move to latest Sprint' variant when there is no current sprint", () => {
    const { container } = renderBacklog();

    const moveBtn = container.querySelector(".e2e-move-to-sprint");
    expect(moveBtn).toBeInTheDocument();
    // currentSprint is null -> latest-sprint variant, not the current-sprint one.
    expect(moveBtn).toHaveClass("move-to-latest-sprint");
    expect(moveBtn?.textContent).toContain("Move to latest Sprint");
  });

  // Parity with the legacy `checkSelected` handler (backlog/main.coffee
  // L822-831): the button is `display:none` (from `.btn-filter.move-to-sprint`)
  // until at least one user story is selected AND an open sprint exists, then it
  // becomes `display:flex`. Without the inline toggle it would stay hidden and
  // never be clickable (regression that broke the "move to latest sprint" e2e).
  it("is hidden by default and revealed (display:flex) once a story is selected", () => {
    // Default VM: empty selectedUs -> button present but display:none.
    const first = renderBacklog();
    const hidden = first.container.querySelector<HTMLElement>(".e2e-move-to-sprint");
    expect(hidden).toBeInTheDocument();
    expect(hidden?.style.display).toBe("none");
    first.unmount();

    // Select a story (and there IS an open sprint) -> button shown.
    vm.selectedUs = new Set<number>([101]);
    const second = renderBacklog();
    const shown = second.container.querySelector<HTMLElement>(".e2e-move-to-sprint");
    expect(shown?.style.display).toBe("flex");
  });

  it("stays hidden when a story is selected but there are no open sprints", () => {
    vm.selectedUs = new Set<number>([101]);
    vm.sprints = [];
    const { container } = renderBacklog();
    const moveBtn = container.querySelector<HTMLElement>(".e2e-move-to-sprint");
    expect(moveBtn?.style.display).toBe("none");
  });
});

describe("Backlog — shift-range multiselect", () => {
  // Parity with the legacy window-level `shiftPressed` tracking (backlog/
  // main.coffee L834-848): a plain click sets the anchor; a Shift-held click on a
  // later row selects the whole contiguous range. The Shift state MUST come from
  // a global keydown/keyup listener because the checkbox change event does not
  // reliably carry `shiftKey` (a click forwarded through the <label> drops it).
  it("selects the contiguous range when Shift is held (global keydown), not just the clicked row", () => {
    vm.userstories = [
      { id: 201, ref: 1, subject: "one", status: 1, tags: [] },
      { id: 202, ref: 2, subject: "two", status: 1, tags: [] },
      { id: 203, ref: 3, subject: "three", status: 1, tags: [] },
      { id: 204, ref: 4, subject: "four", status: 1, tags: [] },
    ];
    const { container } = renderBacklog();
    const cb = (ref: number) =>
      container.querySelector<HTMLInputElement>(`#us-check-${ref}`) as HTMLInputElement;

    // Plain click row0 -> anchor = 201, single toggle.
    fireEvent.click(cb(1));
    expect(vm.toggleSelectedUs).toHaveBeenCalledWith(
      expect.objectContaining({ id: 201 }),
      true
    );
    vm.toggleSelectedUs.mockClear();

    // Hold Shift GLOBALLY, then click row3. The checkbox change carries no
    // shiftKey, but the window listener has recorded Shift-down, so the handler
    // selects the whole 201..204 range.
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    fireEvent.click(cb(4));

    const idsToggled = vm.toggleSelectedUs.mock.calls.map(
      (c: unknown[]) => (c[0] as { id: number }).id
    );
    expect(idsToggled).toEqual(expect.arrayContaining([201, 202, 203, 204]));

    fireEvent.keyUp(window, { key: "Shift", shiftKey: false });
  });

  it("toggles only the clicked row when Shift is NOT held", () => {
    vm.userstories = [
      { id: 201, ref: 1, subject: "one", status: 1, tags: [] },
      { id: 202, ref: 2, subject: "two", status: 1, tags: [] },
      { id: 203, ref: 3, subject: "three", status: 1, tags: [] },
    ];
    const { container } = renderBacklog();
    const cb = (ref: number) =>
      container.querySelector<HTMLInputElement>(`#us-check-${ref}`) as HTMLInputElement;

    fireEvent.click(cb(1));
    vm.toggleSelectedUs.mockClear();
    fireEvent.click(cb(3)); // no Shift held -> single toggle only

    const idsToggled = vm.toggleSelectedUs.mock.calls.map(
      (c: unknown[]) => (c[0] as { id: number }).id
    );
    expect(idsToggled).toEqual([203]);
  });
});

describe("Backlog — velocity forecasting toggle", () => {
  it("shows the ENABLE control only when the project has a velocity (stats.speed > 0) and toggles on click", () => {
    // Legacy backlog.jade L116: the enable button is gated on
    // `userstories.length && !displayVelocity && stats.speed > 0`.
    vm.displayVelocity = false;
    vm.stats = { ...vm.stats, speed: 12 };
    const { container } = renderBacklog();

    const velocityBtn = container.querySelector(".e2e-velocity-forecasting");
    expect(velocityBtn).toBeInTheDocument();
    // Enable control is NOT the active one and reads "Velocity forecasting".
    expect(velocityBtn).not.toHaveClass("active");
    expect(velocityBtn?.textContent).toContain("Velocity forecasting");

    fireEvent.click(velocityBtn as Element);
    expect(vm.toggleVelocityForecasting).toHaveBeenCalledTimes(1);
  });

  it("hides the forecasting control entirely when there is no velocity (stats.speed = 0)", () => {
    // Without velocity there is nothing to forecast, so NEITHER the enable nor
    // the active control renders (faithful to the legacy two-button gating).
    vm.displayVelocity = false;
    vm.stats = { ...vm.stats, speed: 0 };
    const { container } = renderBacklog();

    expect(container.querySelector(".e2e-velocity-forecasting")).not.toBeInTheDocument();
  });

  it("shows the ACTIVE 'return to backlog' control while forecasting is on and toggles off on click", () => {
    // Legacy backlog.jade L107: the active button is gated on
    // `userstories.length && displayVelocity`, reads "return to backlog", and
    // carries the `active` modifier + the fold-column icon.
    vm.displayVelocity = true;
    const { container } = renderBacklog();

    const velocityBtn = container.querySelector(".e2e-velocity-forecasting");
    expect(velocityBtn).toBeInTheDocument();
    expect(velocityBtn).toHaveClass("active");
    expect(velocityBtn?.textContent).toContain("return to backlog");

    fireEvent.click(velocityBtn as Element);
    expect(vm.toggleVelocityForecasting).toHaveBeenCalledTimes(1);
  });
});

describe("Backlog — sidebar sprint list (real SprintList)", () => {
  it("renders one open sprint card and the add-sprint control", () => {
    const { container } = renderBacklog();

    const sprintCards = container.querySelectorAll('div[tg-backlog-sprint="sprint"]');
    expect(sprintCards).toHaveLength(1);
    expect(sprintCards[0]).toHaveClass("sprint-open");

    // totalMilestones > 0 && add_milestone -> the header add-sprint button renders.
    expect(container.querySelector(".add-sprint")).toBeInTheDocument();
  });
});

describe("Backlog — burndown summary (real BurndownSummary)", () => {
  it("composes the real summary, whose .summary .data .number shows the completed percentage", () => {
    const { container } = renderBacklog();

    expect(container.querySelector(".backlog-summary")).toBeInTheDocument();

    const number = container.querySelector(".summary .data .number");
    expect(number).toBeInTheDocument();
    expect(number?.textContent).toBe("40%");
  });
});

describe("Backlog — sprint lightbox visibility", () => {
  it("mounts the sprint lightbox only when vm.sprintLightbox.open is true", () => {
    const { container, rerender } = renderBacklog();

    // Closed by default -> the mocked lightbox renders nothing.
    expect(container.querySelector('[data-testid="sprint-lb"]')).toBeNull();

    // Open it and re-render: the mock now emits its presence marker.
    vm.sprintLightbox.open = true;
    rerender(<Backlog context={context} />);
    expect(container.querySelector('[data-testid="sprint-lb"]')).toBeInTheDocument();
  });
});

describe("Backlog — permission gating (read-only member)", () => {
  it("hides add-us, velocity-forecasting and the draggable column for a view-only member", () => {
    // Revoke every mutating permission before render; hasPermission and the
    // container's addUs/modifyUs gates all read this same array.
    vm.project.my_permissions = ["view_us"];

    const { container } = renderBacklog();

    // add_us gone -> no new-us anchors.
    expect(container.querySelectorAll(".new-us a")).toHaveLength(0);
    // add_milestone gone -> no velocity forecasting button.
    expect(container.querySelector(".e2e-velocity-forecasting")).toBeNull();
    // modify_us gone -> the drag handle column is not rendered in the header row.
    expect(container.querySelector(".draggable-us-column")).toBeNull();
  });
});

describe("Backlog — velocity forecasting add-sprint row", () => {
  it("renders .e2e-velocity-forecasting-add and .e2e-sprint-name when displayVelocity is on", () => {
    vm.displayVelocity = true;

    const { container } = renderBacklog();

    expect(container.querySelector(".e2e-velocity-forecasting-add")).toBeInTheDocument();
    expect(container.querySelector(".e2e-sprint-name")).toBeInTheDocument();
  });
});

describe("Backlog — M2 user-visible error + pending surface", () => {
  it("renders the board-status live region with the sanitized error when a mutation fails", () => {
    vm.errorMessage = "This item was changed elsewhere. Please reload and try again.";

    const { container } = renderBacklog();

    const region = container.querySelector(".backlog-board-status");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region?.textContent).toContain("changed elsewhere");
  });

  it("renders no message text in the board-status region on the happy path", () => {
    vm.errorMessage = null;

    const { container } = renderBacklog();

    const region = container.querySelector(".backlog-board-status");
    expect(region).toBeInTheDocument();
    expect(region?.textContent).toBe("");
  });

  it("marks the main region aria-busy while a story delete is in flight (savingUs)", () => {
    vm.savingUs = true;

    const { container } = renderBacklog();

    expect(container.querySelector("main.main.scrum")).toHaveAttribute("aria-busy", "true");
  });

  it("fails CLOSED: a null project WITH an error renders an assertive alert, not a blank board", () => {
    vm.project = null;
    vm.errorMessage = "You don't have permission to perform this action.";

    const { container } = renderBacklog();

    const alert = container.querySelector(".backlog-board-status");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert?.textContent).toContain("permission");
  });

  it("renders the plain empty shell while still loading (null project, no error)", () => {
    vm.project = null;
    vm.errorMessage = null;

    const { container } = renderBacklog();

    // No status/alert region while loading.
    expect(container.querySelector(".backlog-board-status")).toBeNull();
    expect(container.querySelector("main.main.scrum")).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
 * Filter panel DOM (C4) — the `.backlog-filter` region hosting the reproduced
 * `tg-filter` component (real `BacklogFilterPanel`). These assert the exact
 * class names + wiring the preserved SCSS and the ported Playwright fixtures
 * (`e2e-react/fixtures/filters.ts`) depend on. The panel renders only while the
 * filter toggle is open (`vm.activeFilters`), mirroring `ng-if="ctrl.activeFilters"`.
 * ------------------------------------------------------------------------- */

function statusPanel() {
  return {
    title: "Status",
    dataType: "status",
    content: [
      { id: "1", name: "New", count: 3 },
      { id: "2", name: "Done", count: 0 },
    ],
  };
}
function tagsPanel() {
  return {
    title: "Tags",
    dataType: "tags",
    content: [{ id: "bug", name: "bug", color: "#ff0000", count: 2 }],
    hideEmpty: true,
    totalTaggedElements: 1,
  };
}
function epicPanel() {
  return { title: "Epic", dataType: "epic", content: [{ id: "null", name: "Not in an epic", count: 1 }] };
}

describe("Backlog — filter panel (C4, real BacklogFilterPanel)", () => {
  it("does NOT render the .backlog-filter region when activeFilters is off", () => {
    vm.activeFilters = false;
    const { container } = renderBacklog();
    expect(container.querySelector("#backlog-filter")).toBeNull();
    expect(container.querySelector("tg-filter")).toBeNull();
  });

  it("renders the tg-filter panel with every category header when activeFilters is on", () => {
    vm.activeFilters = true;
    vm.filters = [statusPanel(), tagsPanel(), epicPanel()];

    const { container } = renderBacklog();

    expect(container.querySelector("#backlog-filter")).toBeInTheDocument();
    expect(container.querySelector("tg-filter")).toBeInTheDocument();
    const cats = Array.from(container.querySelectorAll(".filters-cat-single.e2e-category"));
    expect(cats.map((c) => c.querySelector(".title")?.textContent)).toEqual([
      "Status",
      "Tags",
      "Epic",
    ]);
    // Category options are collapsed until a header is clicked.
    expect(container.querySelector(".filter-list")).toBeNull();
  });

  it("reveals selectable options with a count badge on category click and wires addFilter (include mode)", () => {
    vm.activeFilters = true;
    vm.filters = [statusPanel()];

    const { container } = renderBacklog();

    fireEvent.click(container.querySelector(".filters-cat-single.e2e-category") as Element);
    const options = Array.from(container.querySelectorAll(".filter-list .single-filter"));
    // Both status options render; only the count>0 one carries the e2e count badge.
    expect(options).toHaveLength(2);
    const withCount = container.querySelector(".filter-list .single-filter .number.e2e-filter-count");
    expect(withCount?.textContent).toBe("3");

    fireEvent.click(options[0]);
    expect(vm.addFilter).toHaveBeenCalledWith({
      category: { dataType: "status" },
      filter: { id: "1" },
      mode: "include",
    });
  });

  it("applies the exclude mode to a selected option when the exclude radio is chosen", () => {
    vm.activeFilters = true;
    vm.filters = [statusPanel()];

    const { container } = renderBacklog();

    // Switch the include/exclude mode radio to exclude.
    fireEvent.click(container.querySelector("#filter-mode-exclude") as Element);
    fireEvent.click(container.querySelector(".filters-cat-single.e2e-category") as Element);
    fireEvent.click(container.querySelector(".filter-list .single-filter") as Element);

    expect(vm.addFilter).toHaveBeenCalledWith({
      category: { dataType: "status" },
      filter: { id: "1" },
      mode: "exclude",
    });
  });

  it("renders applied chips split into included/excluded and wires removeFilter", () => {
    vm.activeFilters = true;
    vm.filters = [statusPanel()];
    const includeChip = { id: "1", key: "status:1", dataType: "status", name: "New", mode: "include" };
    const excludeChip = { id: "bug", key: "tags:bug", dataType: "tags", name: "bug", mode: "exclude" };
    vm.selectedFilters = [includeChip, excludeChip];

    const { container } = renderBacklog();

    const included = container.querySelector(".filters-applied .filters-included");
    const excluded = container.querySelector(".filters-applied .filters-excluded");
    expect(included?.querySelector(".single-applied-filter .name")?.textContent).toBe("New");
    expect(excluded?.querySelector(".single-applied-filter .name")?.textContent).toBe("bug");

    fireEvent.click(included?.querySelector(".remove-filter.e2e-remove-filter") as Element);
    expect(vm.removeFilter).toHaveBeenCalledWith(includeChip);
  });

  it("renders persisted custom filters with a count and wires select + remove", () => {
    vm.activeFilters = true;
    vm.filters = [statusPanel()];
    const cfA = { id: "Alpha", name: "Alpha", filter: { status: "1" } };
    const cfB = { id: "Beta", name: "Beta", filter: { tags: "bug" } };
    vm.customFilters = [cfA, cfB];

    const { container } = renderBacklog();

    expect(container.querySelector(".custom-filters-title .number")?.textContent).toContain("2");
    const rows = Array.from(
      container.querySelectorAll(".custom-filter-list .single-filter.single-filter-type-custom"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".name")?.textContent).toBe("Alpha");

    fireEvent.click(rows[0].querySelector("button.name") as Element);
    expect(vm.selectCustomFilter).toHaveBeenCalledWith(cfA);

    fireEvent.click(rows[1].querySelector(".remove-filter.e2e-remove-custom-filter") as Element);
    expect(vm.removeCustomFilter).toHaveBeenCalledWith(cfB);
  });

  it("disables the add-custom-filter opener when no filters are applied", () => {
    vm.activeFilters = true;
    vm.filters = [statusPanel()];
    vm.selectedFilters = [];

    const { container } = renderBacklog();

    const opener = container.querySelector(".add-custom-filter");
    expect(opener).toBeInTheDocument();
    expect(opener).toBeDisabled();
    // The name form is not present until the (enabled) opener is used.
    expect(container.querySelector(".add-filter-input")).toBeNull();
  });

  it("opens the save-custom-filter form and submits a valid name via saveCustomFilter", () => {
    vm.activeFilters = true;
    vm.filters = [statusPanel()];
    vm.selectedFilters = [
      { id: "1", key: "status:1", dataType: "status", name: "New", mode: "include" },
    ];

    const { container } = renderBacklog();

    fireEvent.click(container.querySelector(".add-custom-filter") as Element);
    const input = container.querySelector(".add-filter-input.e2e-filter-name-input") as HTMLInputElement;
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "  My filter  " } });
    fireEvent.submit(input.closest("form") as Element);

    // Trimmed name persisted via the hook callback.
    expect(vm.saveCustomFilter).toHaveBeenCalledWith("My filter");
  });

  it("blocks a duplicate custom-filter name with a checksley error instead of saving", () => {
    vm.activeFilters = true;
    vm.filters = [statusPanel()];
    vm.selectedFilters = [
      { id: "1", key: "status:1", dataType: "status", name: "New", mode: "include" },
    ];
    vm.customFilters = [{ id: "Dup", name: "Dup", filter: { status: "1" } }];

    const { container } = renderBacklog();

    fireEvent.click(container.querySelector(".add-custom-filter") as Element);
    const input = container.querySelector(".add-filter-input.e2e-filter-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Dup" } });
    fireEvent.submit(input.closest("form") as Element);

    expect(vm.saveCustomFilter).not.toHaveBeenCalled();
    expect(input).toHaveClass("checksley-error");
  });
});

describe("Backlog - story lightboxes (C7)", () => {
  it("mounts NEITHER shared story lightbox while activeLightbox is null", () => {
    const { container } = renderBacklog();
    expect(container.querySelector('[data-testid="story-lb"]')).toBeNull();
    expect(container.querySelector('[data-testid="bulk-lb"]')).toBeNull();
  });

  it("mounts the CREATE story lightbox for activeLightbox.type 'create' and wires submit/close", () => {
    vm.activeLightbox = { type: "create" };
    const { container } = renderBacklog();

    const lb = container.querySelector('[data-testid="story-lb"]');
    expect(lb).toBeInTheDocument();
    expect(lb).toHaveAttribute("data-mode", "create");
    expect(container.querySelector('[data-testid="bulk-lb"]')).toBeNull();

    fireEvent.click(container.querySelector('[data-testid="story-lb-submit"]') as Element);
    expect(vm.submitNewUs).toHaveBeenCalledTimes(1);
    expect(vm.submitEditUs).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('[data-testid="story-lb-close"]') as Element);
    expect(vm.closeLightbox).toHaveBeenCalledTimes(1);
  });

  it("mounts the EDIT story lightbox (mode='edit') and wires submit to submitEditUs", () => {
    vm.activeLightbox = { type: "edit", usId: 101 };
    const { container } = renderBacklog();

    const lb = container.querySelector('[data-testid="story-lb"]');
    expect(lb).toBeInTheDocument();
    expect(lb).toHaveAttribute("data-mode", "edit");

    fireEvent.click(container.querySelector('[data-testid="story-lb-submit"]') as Element);
    expect(vm.submitEditUs).toHaveBeenCalledTimes(1);
    expect(vm.submitNewUs).not.toHaveBeenCalled();
  });

  it("mounts the BULK story lightbox for activeLightbox.type 'bulk' and wires submit/close", () => {
    vm.activeLightbox = { type: "bulk" };
    const { container } = renderBacklog();

    expect(container.querySelector('[data-testid="bulk-lb"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="story-lb"]')).toBeNull();

    fireEvent.click(container.querySelector('[data-testid="bulk-lb-submit"]') as Element);
    expect(vm.submitBulkUs).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('[data-testid="bulk-lb-close"]') as Element);
    expect(vm.closeLightbox).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Drag-and-drop wiring (finding C8)
//
// These drive the PRODUCTION `onDragEnd` (captured via `mockCapturedOnDragEnd`)
// with synthetic `@dnd-kit` `DragEndEvent`s to prove EVERY movement direction is
// reachable and maps to exactly ONE `vm.moveUs(...)` call with the correct index
// basis and neighbours — and that the drag path NEVER calls `vm.moveToSprint`
// (that is the toolbar-only `bulk-update-us-milestone` path). The pure index
// maths is covered exhaustively by `./dnd/resolveBacklogDrop.test.tsx`; here we
// verify the container's BRIDGING (active lookup across backlog + sprints, the
// over-descriptor routing, closed rejection, multi-move and id->UserStory
// mapping).
// ---------------------------------------------------------------------------
describe("Backlog - drag and drop (C8)", () => {
  // Sprint story fixtures — references retained so arg assertions can compare by
  // identity against the exact objects `onDragEnd` maps the resolved ids to.
  const s301 = { id: 301, ref: 301, subject: "S1 US1", status: 1, tags: [], milestone: 3 };
  const s302 = { id: 302, ref: 302, subject: "S1 US2", status: 1, tags: [], milestone: 3 };
  const s401 = { id: 401, ref: 401, subject: "S2 US1", status: 1, tags: [], milestone: 4 };
  const c901 = { id: 901, ref: 901, subject: "C US1", status: 1, tags: [], milestone: 9 };

  /** Populate two OPEN sprints (with stories) and one CLOSED sprint on the vm. */
  function installSprints(): void {
    vm.sprints = [
      {
        id: 3,
        name: "Sprint 1",
        closed: false,
        user_stories: [s301, s302],
        total_points: 20,
        closed_points: 5,
      },
      {
        id: 4,
        name: "Sprint 2",
        closed: false,
        user_stories: [s401],
        total_points: 10,
        closed_points: 0,
      },
    ];
    vm.closedSprints = [
      { id: 9, name: "Closed", closed: true, user_stories: [c901], total_points: 5, closed_points: 5 },
    ];
    vm.totalMilestones = 2;
    vm.totalClosedMilestones = 1;
  }

  // Synthetic `over` descriptors matching the real droppable `data.current` shapes.
  const rowOver = (id: number) => ({ id, data: { current: {} } });
  const sprintOver = (sprintId: number) => ({
    id: `sprint-${sprintId}`,
    data: { current: { type: "sprint", sprintId } },
  });
  const backlogOver = () => ({ id: "backlog", data: { current: { type: "backlog" } } });
  const fire = (activeId: number, over: unknown): void =>
    mockCapturedOnDragEnd!({ active: { id: activeId }, over });

  it("reorders within the backlog via moveUs (never moveToSprint)", () => {
    installSprints();
    renderBacklog();
    const [us101, us102] = vm.userstories;
    fire(102, rowOver(101));
    expect(vm.moveUs).toHaveBeenCalledTimes(1);
    expect(vm.moveUs).toHaveBeenCalledWith([us102], 0, null, null, us101);
    expect(vm.moveToSprint).not.toHaveBeenCalled();
  });

  it("moves a backlog story INTO a sprint via moveUs (bulk-backlog-order), not moveToSprint", () => {
    installSprints();
    renderBacklog();
    const us101 = vm.userstories[0];
    fire(101, sprintOver(3));
    expect(vm.moveUs).toHaveBeenCalledTimes(1);
    expect(vm.moveUs).toHaveBeenCalledWith([us101], 2, 3, s302, null);
    expect(vm.moveToSprint).not.toHaveBeenCalled();
  });

  it("moves a sprint story BACK to the backlog via moveUs", () => {
    installSprints();
    renderBacklog();
    const us102 = vm.userstories[1];
    fire(301, backlogOver());
    expect(vm.moveUs).toHaveBeenCalledTimes(1);
    expect(vm.moveUs).toHaveBeenCalledWith([s301], 2, null, us102, null);
  });

  it("reorders WITHIN a sprint via moveUs", () => {
    installSprints();
    renderBacklog();
    fire(302, rowOver(301));
    expect(vm.moveUs).toHaveBeenCalledTimes(1);
    expect(vm.moveUs).toHaveBeenCalledWith([s302], 0, 3, null, s301);
  });

  it("moves a story BETWEEN sprints via moveUs", () => {
    installSprints();
    renderBacklog();
    fire(301, sprintOver(4));
    expect(vm.moveUs).toHaveBeenCalledTimes(1);
    expect(vm.moveUs).toHaveBeenCalledWith([s301], 1, 4, s401, null);
  });

  it("moves a story into an UNFOLDED closed sprint via moveUs (legacy reopen-by-drag)", () => {
    // Closed rejection is a property of the fold-gated droppable (a FOLDED closed
    // sprint is not a live drop target), NOT of `onDragEnd`. Once the user UNFOLDS
    // the closed sprint, @dnd-kit reports `over: sprint-9` and the drop is a REAL
    // move into sprint 9 (appended after its existing story c901); persisting that
    // move reopens the sprint on the backend (legacy `open sprint by drag open US
    // to closed sprint`). This uses the drag path (`moveUs`), never the toolbar
    // `moveToSprint` (`bulk-update-us-milestone`) path.
    installSprints();
    renderBacklog();
    const us101 = vm.userstories[0];
    fire(101, sprintOver(9));
    expect(vm.moveUs).toHaveBeenCalledTimes(1);
    expect(vm.moveUs).toHaveBeenCalledWith([us101], 1, 9, c901, null);
    expect(vm.moveToSprint).not.toHaveBeenCalled();
  });

  it("moves the whole SELECTION when a selected row is dragged (multi-move)", () => {
    installSprints();
    vm.selectedUs = new Set<number>([101, 102]);
    renderBacklog();
    const [us101, us102] = vm.userstories;
    fire(101, sprintOver(3));
    expect(vm.moveUs).toHaveBeenCalledTimes(1);
    expect(vm.moveUs).toHaveBeenCalledWith([us101, us102], 2, 3, s302, null);
  });

  it("is a no-op when there is no drop target", () => {
    installSprints();
    renderBacklog();
    fire(101, null);
    expect(vm.moveUs).not.toHaveBeenCalled();
  });

  it("ignores a drag whose active id is not a known story", () => {
    installSprints();
    renderBacklog();
    fire(9999, rowOver(101));
    expect(vm.moveUs).not.toHaveBeenCalled();
  });

  // The phantom story-link click a whole-row drop fires is suppressed at the
  // document CAPTURE phase for a short window after a drag ends (reproducing
  // dragula's no-navigation-on-drop). A story link clicked WITHOUT a preceding
  // drag navigates normally.
  it("suppresses a story-link click that lands right after a drag ends", () => {
    installSprints();
    const { container } = renderBacklog();
    const link = container.querySelector(".milestone-us-item-row a.us-name") as HTMLAnchorElement;
    expect(link).not.toBeNull();

    // A drag just ended (any completed drag records the timestamp, even a no-op).
    fire(302, rowOver(301));
    const clickAfterDrag = fireEvent.click(link);
    expect(clickAfterDrag).toBe(false); // preventDefault -> navigation suppressed
  });

  it("does NOT suppress a story-link click when no drag preceded it", () => {
    installSprints();
    const { container } = renderBacklog();
    const link = container.querySelector(".milestone-us-item-row a.us-name") as HTMLAnchorElement;
    expect(link).not.toBeNull();

    const plainClick = fireEvent.click(link);
    expect(plainClick).toBe(true); // default NOT prevented -> navigation proceeds
  });
});

// ---------------------------------------------------------------------------
// Header points role selector (M4/M7) — the `.backlog-table-header .points`
// `tg-us-role-points-selector`. It is interactive only with MORE than one
// computable role, broadcasts a selected role id to every row's points display,
// and clears back to "All points".
// ---------------------------------------------------------------------------
describe("Backlog — header points role selector (M4/M7)", () => {
  /** Give the mocked project two computable roles + a point scale. */
  function withTwoRoles(): void {
    vm.project.roles = [
      { id: 5, name: "Design", computable: true },
      { id: 6, name: "Front", computable: true },
    ];
    vm.project.points = [
      { id: 30, name: "S", value: 1 },
      { id: 31, name: "L", value: 8 },
    ];
    // Stories with per-role point assignments so a selected role changes the
    // row's rendered points value.
    vm.userstories = [
      { id: 101, ref: 1, subject: "US one", status: 1, tags: [], points: { "5": 31, "6": 30 } },
      { id: 102, ref: 2, subject: "US two", status: 1, tags: [], points: { "5": 30, "6": 31 } },
    ];
  }

  it("renders a NON-interactive header when there are no computable roles", () => {
    const { container } = renderBacklog();
    const header = container.querySelector(".backlog-table-header .points");
    expect(header).not.toBeNull();
    // The label is the plain, not-clickable "Points"; no popover trigger.
    const label = header!.querySelector(".header-points");
    expect(label).toHaveClass("not-clickable");
    expect(header!.querySelector('.inner[role="button"]')).toBeNull();
    expect(label!.textContent).toBe(t("COMMON.FIELDS.POINTS"));
  });

  it("renders an interactive selector (All points + one entry per role) with >1 role", () => {
    withTwoRoles();
    const { container } = renderBacklog();

    const inner = container.querySelector('.backlog-table-header .points .inner[role="button"]');
    expect(inner).not.toBeNull();
    expect(inner!.querySelector(".header-points")!.textContent).toBe(t("COMMON.FIELDS.POINTS"));

    fireEvent.click(inner!);
    const popover = container.querySelector(".backlog-table-header .points .popover.pop-role.active");
    expect(popover).not.toBeNull();

    // "All points" is the first entry and starts active.
    const all = popover!.querySelector("a.clear-selection");
    expect(all).toHaveClass("active-popover");
    expect(all!.textContent).toBe(t("COMMON.ROLES.ALL"));

    // One `.role` entry per computable role (just the name — the header does
    // NOT show per-role points, unlike the row popover).
    const roles = popover!.querySelectorAll("a.role .item-text");
    expect(roles).toHaveLength(2);
    expect(roles[0].textContent).toBe("Design");
    expect(roles[1].textContent).toBe("Front");
  });

  it("selecting a role updates the header label and switches every row to the split display", () => {
    withTwoRoles();
    const { container } = renderBacklog();

    // Before selection: rows show the bare total (8 + 1 = 9).
    const firstValueBefore = container
      .querySelector(".backlog-table-body .us-item-row .us-points .points-value")!
      .textContent;
    expect(firstValueBefore).toBe("9");

    // Open the header selector and choose "Front".
    fireEvent.click(container.querySelector('.backlog-table-header .points .inner[role="button"]')!);
    fireEvent.click(container.querySelector('.backlog-table-header a.role[data-role-id="6"]')!);

    // Header label now shows the selected role name.
    expect(container.querySelector(".backlog-table-header .header-points")!.textContent).toBe(
      "Front",
    );

    // Row 1: Front -> point 30 (S); total 9 -> "S / 9".
    expect(
      container.querySelector(".backlog-table-body .us-item-row .us-points .points-value")!
        .textContent,
    ).toBe("S / 9");
  });

  it("clear-selection returns the header to All points", () => {
    withTwoRoles();
    const { container } = renderBacklog();

    // Select Front first.
    fireEvent.click(container.querySelector('.backlog-table-header .points .inner[role="button"]')!);
    fireEvent.click(container.querySelector('.backlog-table-header a.role[data-role-id="6"]')!);
    expect(container.querySelector(".backlog-table-header .header-points")!.textContent).toBe(
      "Front",
    );

    // Re-open and clear.
    fireEvent.click(container.querySelector('.backlog-table-header .points .inner[role="button"]')!);
    fireEvent.click(container.querySelector(".backlog-table-header a.clear-selection")!);
    expect(container.querySelector(".backlog-table-header .header-points")!.textContent).toBe(
      t("COMMON.FIELDS.POINTS"),
    );
  });

  it("resolves the header column labels through the i18n bundle", () => {
    const { container } = renderBacklog();
    const header = container.querySelector(".backlog-table-header .row.backlog-table-title")!;
    expect(header.querySelector(".user-stories")!.textContent).toBe(t("BACKLOG.TABLE.COLUMN_US"));
    expect(header.querySelector(".status")!.textContent).toBe(t("COMMON.FIELDS.STATUS"));
    expect(header.querySelector(".points")!.getAttribute("title")).toBe(
      t("BACKLOG.TABLE.TITLE_COLUMN_POINTS"),
    );
  });
});

// ---------------------------------------------------------------------------
// Shift-range multiselect (M4) — a plain checkbox click toggles ONE row and
// sets the anchor; a shift+click selects the contiguous range from the anchor
// to the clicked row over the ordered visible list.
// ---------------------------------------------------------------------------
describe("Backlog — shift-range multiselect (M4)", () => {
  function withThreeRows(): void {
    vm.userstories = [
      { id: 101, ref: 1, subject: "US one", status: 1, tags: [] },
      { id: 102, ref: 2, subject: "US two", status: 1, tags: [] },
      { id: 103, ref: 3, subject: "US three", status: 1, tags: [] },
    ];
  }

  it("toggles a single row on a plain click", () => {
    withThreeRows();
    const { container } = renderBacklog();
    fireEvent.click(container.querySelector("input#us-check-1")!);
    expect(vm.toggleSelectedUs).toHaveBeenCalledTimes(1);
    expect(vm.toggleSelectedUs).toHaveBeenCalledWith(vm.userstories[0], true);
  });

  it("selects the whole range between the anchor and a shift+clicked row", () => {
    withThreeRows();
    const { container } = renderBacklog();

    // Plain click row 1 sets the anchor.
    fireEvent.click(container.querySelector("input#us-check-1")!);
    (vm.toggleSelectedUs as jest.Mock).mockClear();

    // Shift+click row 3 selects rows 1, 2 AND 3 (checked = true for each).
    fireEvent.click(container.querySelector("input#us-check-3")!, { shiftKey: true });

    const calls = (vm.toggleSelectedUs as jest.Mock).mock.calls;
    const selectedIds = calls.map((c) => (c[0] as { id: number }).id);
    expect(selectedIds).toEqual([101, 102, 103]);
    expect(calls.every((c) => c[1] === true)).toBe(true);
  });

  it("falls back to a single toggle when shift is held with no prior anchor", () => {
    withThreeRows();
    const { container } = renderBacklog();
    // No prior plain click -> no anchor -> shift+click toggles only that row.
    fireEvent.click(container.querySelector("input#us-check-2")!, { shiftKey: true });
    expect(vm.toggleSelectedUs).toHaveBeenCalledTimes(1);
    expect(vm.toggleSelectedUs).toHaveBeenCalledWith(vm.userstories[1], true);
  });
});
