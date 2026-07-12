/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link BacklogRow}.
 *
 * `BacklogRow` is a DOM-preserving React 18.2 reproduction of ONE Backlog
 * user-story row (the `.row.us-item-row` element tree the AngularJS
 * `BacklogController` rendered through
 * `app/partials/includes/components/backlog-row.jade`, together with the inline
 * STATUS / POINTS / OPTIONS popovers injected by the `tg-us-status`,
 * `tg-backlog-us-points` and `tg-us-edit-selector` directives). Because the
 * UNCHANGED Taiga SCSS (`app/styles/modules/backlog/backlog-table.scss`) targets
 * specific class names, `data-*` attributes and element hierarchy, these tests
 * assert on the emitted DOM (via `container.querySelector` /
 * `querySelectorAll`) — proving DOM/visual parity — as well as on the
 * permission-gating and callback wiring that reproduce the legacy behavior.
 * They contribute to the >= 70% line-coverage gate for the new React code.
 *
 * Conventions:
 *   - AMBIENT Jest globals (`describe` / `it` / `expect` / `jest`) are used
 *     directly — this file intentionally does NOT import from `@jest/globals`.
 *     The project ships `@types/jest` and lists `"jest"` in the `tsconfig`
 *     `types` array, so the ambient forms type-check cleanly under `tsc
 *     --noEmit` and `jest.fn()` is available for the callback spies.
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — no `import React`.
 *   - `ts-jest` + `jsdom` environment; the `@testing-library/jest-dom` matchers
 *     (`toHaveClass`, `toHaveAttribute`, `toBeChecked`, ...) are registered
 *     globally by `jest.setup.ts`.
 *   - Strict TypeScript: fixtures are built with `as unknown as <Type>` casts so
 *     the tests do not have to enumerate every optional model field, and helper
 *     signatures are explicitly typed (no `any`).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { BacklogRow } from "./BacklogRow";
import type { BacklogRowProps } from "./BacklogRow";
import type { UserStory, Project, Status } from "../shared/types";

// ---------------------------------------------------------------------------
// Fixtures
//
// Module-level singletons so callback assertions can use referential equality
// (`toHaveBeenCalledWith(us, ...)`): `makeProps` uses these exact object
// references as its defaults, so a handler invoked by the component receives the
// very same object the test holds. The tests NEVER mutate these fixtures; when a
// variant is needed a fresh object is spread from the base.
// ---------------------------------------------------------------------------

/** Two ordered US statuses feeding the status popover (`.pop-status`). */
const statuses: Status[] = [
    { id: 1, name: "New", color: "#aaa", order: 1 } as Status,
    { id: 2, name: "In progress", color: "#bbb", order: 2 } as Status,
];

/**
 * Project context. `my_permissions` includes `modify_us` + `delete_us` so the
 * default row renders every affordance; individual tests narrow the permission
 * set to exercise the gating branches. A single computable role is enough for
 * the default points-popover assertions.
 */
const project: Project = {
    id: 7,
    slug: "proj",
    name: "Proj",
    my_permissions: ["modify_us", "delete_us", "view_us"],
    is_kanban_activated: true,
    is_backlog_activated: true,
    roles: [{ id: 5, name: "Design", computable: true }],
} as unknown as Project;

/**
 * The user story rendered by the default row: ref 42, subject "Login page",
 * status "New" (id 1), two tags, 8 total points, not blocked.
 */
const us: UserStory = {
    id: 101,
    ref: 42,
    subject: "Login page",
    status: 1,
    swimlane: null,
    tags: [
        ["urgent", "#f00"],
        ["ui", "#0f0"],
    ],
    total_points: 8,
    is_blocked: false,
} as unknown as UserStory;

/**
 * Build a complete {@link BacklogRowProps} object, layering `overrides` over the
 * default fixtures. Fresh `jest.fn()` spies are created for every callback on
 * each call; a test that needs to assert on a specific callback passes its own
 * spy through `overrides` and keeps the reference.
 *
 * @param overrides - Partial props to merge over the defaults.
 * @returns A fully-populated props object for {@link BacklogRow}.
 */
function makeProps(overrides: Partial<BacklogRowProps> = {}): BacklogRowProps {
    return {
        us,
        project,
        statuses,
        showTags: false,
        selected: false,
        onToggleSelected: jest.fn(),
        onUpdateStatus: jest.fn(),
        onUpdatePoints: jest.fn(),
        onEdit: jest.fn(),
        onDelete: jest.fn(),
        onMoveToTop: jest.fn(),
        ...overrides,
    };
}

/**
 * Render a {@link BacklogRow} with `makeProps(overrides)` and return the
 * rendered `container` element for DOM querying.
 *
 * @param overrides - Partial props to merge over the defaults.
 * @returns The container `HTMLElement` produced by React Testing Library.
 */
function renderRow(overrides: Partial<BacklogRowProps> = {}): HTMLElement {
    const { container } = render(<BacklogRow {...makeProps(overrides)} />);
    return container;
}

describe("BacklogRow — row root DOM & modifier classes", () => {
    it("renders the .row.us-item-row root with the static ng-repeat attr and data-id", () => {
        const container = renderRow();

        const row = container.querySelector("div.row.us-item-row");
        expect(row).not.toBeNull();

        // `ng-repeat` is a STATIC passthrough string (NOT AngularJS behavior),
        // required so the ported e2e selector `.backlog-table-body >
        // div[ng-repeat]` still matches the migrated row.
        expect(row!.getAttribute("ng-repeat")).not.toBeNull();
        expect(row!.getAttribute("ng-repeat")).toBe("us in userstories");

        // `data-id` mirrors the legacy `data-id="{{ us.id }}"` binding.
        expect(row).toHaveAttribute("data-id", "101");
    });

    it("adds the 'blocked' modifier class when the story is blocked", () => {
        const container = renderRow({ us: { ...us, is_blocked: true } });
        expect(container.querySelector("div.row.us-item-row")).toHaveClass("blocked");
    });

    it("adds the 'new' modifier class when the story is new", () => {
        // `new` is a legacy view flag not on the strict UserStory model, so the
        // override is cast through `unknown` (no `any`).
        const container = renderRow({ us: { ...us, new: true } as unknown as UserStory });
        expect(container.querySelector("div.row.us-item-row")).toHaveClass("new");
    });

    it("renders the .due-date only when the story has a due_date", () => {
        const withDue = renderRow({
            us: { ...us, due_date: "2025-01-01" } as unknown as UserStory,
        });
        const due = withDue.querySelector(".due-date");
        expect(due).not.toBeNull();
        expect(due!.textContent).toBe("2025-01-01");

        // The default story has no due_date -> the node is omitted.
        expect(renderRow().querySelector(".due-date")).toBeNull();
    });

    it("renders one .belong-to-epic-pill per epic", () => {
        const epics = [
            { id: 1, ref: 7, subject: "Epic A", color: "#123456" },
            { id: 2, ref: 8, subject: "Epic B", color: "#654321" },
        ];
        const container = renderRow({ us: { ...us, epics } });
        expect(container.querySelectorAll(".belong-to-epic-pill")).toHaveLength(2);
    });

    it("adds the 'first' class to the options button when isFirstInBacklog", () => {
        const container = renderRow({ isFirstInBacklog: true });
        const button = container.querySelector(".us-option-popup-button");
        expect(button).not.toBeNull();
        expect(button).toHaveClass("first");
    });

    it("wires @dnd-kit refs/attributes and toggles the 'dragging' class", () => {
        const setNodeRef = jest.fn();
        const setActivatorNodeRef = jest.fn();
        const onPointerDown = jest.fn();

        const container = renderRow({
            dnd: {
                setNodeRef,
                setActivatorNodeRef,
                isDragging: true,
                attributes: { role: "button", tabIndex: 0 },
                listeners: { onPointerDown },
            },
        });

        // `isDragging` toggles the `dragging` modifier on the row root.
        expect(container.querySelector("div.row.us-item-row")).toHaveClass("dragging");

        // `setNodeRef` is bound to the row root; `setActivatorNodeRef` to the
        // drag handle. React invokes ref callbacks with the DOM node on mount.
        expect(setNodeRef).toHaveBeenCalled();
        expect(setActivatorNodeRef).toHaveBeenCalled();

        // The drag `attributes` are spread onto the handle.
        const handle = container.querySelector(".draggable-us-row");
        expect(handle).not.toBeNull();
        expect(handle).toHaveAttribute("role", "button");
    });
});

describe("BacklogRow — left column (drag handle & checkbox)", () => {
    it("renders the drag handle carrying the icon-drag e2e hook", () => {
        const container = renderRow();

        const handle = container.querySelector(".draggable-us-row");
        expect(handle).not.toBeNull();

        // The `tg-svg` <svg> carries the `icon-drag` class used as the e2e hook.
        expect(handle!.querySelector(".icon-drag")).not.toBeNull();
    });

    it("renders the multiselect checkbox + label and reports selection on click", () => {
        const onToggleSelected = jest.fn();
        const container = renderRow({ onToggleSelected });

        const checkbox = container.querySelector<HTMLInputElement>(
            'input#us-check-42[type="checkbox"]',
        );
        expect(checkbox).not.toBeNull();
        expect(checkbox!).not.toBeChecked();

        // The paired label targets the same id (custom-checkbox styling hook).
        expect(container.querySelector('label[for="us-check-42"]')).not.toBeNull();

        // Clicking toggles the native checkbox -> onChange fires with
        // target.checked === true. (The input is controlled, so React reverts
        // the visual state; the handler call is what matters.)
        fireEvent.click(checkbox!);
        expect(onToggleSelected).toHaveBeenCalledTimes(1);
        expect(onToggleSelected).toHaveBeenCalledWith(us, true);
    });
});

describe("BacklogRow — user-story link, ref, name & tags", () => {
    it("renders the user-story link with href, ref number and (escaped) name", () => {
        const container = renderRow();

        const link = container.querySelector("a.user-story-link");
        expect(link).not.toBeNull();
        // Read the literal attribute (jsdom resolves the `.href` PROPERTY to an
        // absolute URL, but the emitted markup must keep the hashbang route).
        expect(link).toHaveAttribute("href", "#/project/proj/us/42");

        const number = container.querySelector(".user-story-number");
        expect(number).not.toBeNull();
        // "#42 " — hash + ref + a trailing space. Assert on textContent with an
        // exact `toBe` (jest-dom's toHaveTextContent normalizes whitespace and
        // would drop the trailing space).
        expect(number!.textContent).toBe("#42 ");
        // The literal `tg-bo-ref` attribute is preserved for the e2e binding.
        expect(number).toHaveAttribute("tg-bo-ref", "us.ref");

        const name = container.querySelector(".user-story-name");
        expect(name!.textContent).toBe("Login page");
        // The name node is reachable by its literal text and IS the
        // `.user-story-name` span (RTL `screen`, document-scoped query).
        expect(screen.getByText("Login page")).toHaveClass("user-story-name");
    });

    it("hides tags when showTags is false", () => {
        const container = renderRow({ showTags: false });
        expect(container.querySelectorAll(".tag")).toHaveLength(0);
    });

    it("renders tags with titles and a trailing 'last' modifier when showTags is true", () => {
        const container = renderRow({ showTags: true });

        const tags = container.querySelectorAll(".tag");
        expect(tags).toHaveLength(2);

        expect(tags[0].textContent).toBe("urgent");
        expect(tags[1].textContent).toBe("ui");
        expect(tags[0]).toHaveAttribute("title", "urgent");
        expect(tags[1]).toHaveAttribute("title", "ui");

        // Only the final tag gets the `last` class (legacy `ng-class="{last:$last}"`).
        expect(tags[0]).not.toHaveClass("last");
        expect(tags[1]).toHaveClass("last");
    });
});

describe("BacklogRow — inline status editor", () => {
    it("renders the current status and opens the .pop-status popover on click", () => {
        const onUpdateStatus = jest.fn();
        const container = renderRow({ onUpdateStatus });

        // The bound status name matches `us.status` (id 1 -> "New").
        expect(container.querySelector(".us-status .us-status-bind")!.textContent).toBe("New");

        // No popover exists before the status control is clicked.
        expect(container.querySelector(".popover")).toBeNull();

        fireEvent.click(container.querySelector(".us-status")!);

        // Exactly one active popover, and it is the status popover.
        const popover = container.querySelector(".popover.pop-status.active");
        expect(popover).not.toBeNull();

        const items = container.querySelectorAll("a.status");
        expect(items).toHaveLength(2);
        items.forEach((item) => expect(item).toHaveAttribute("data-status-id"));

        // Choosing "In progress" (id 2) fires the callback and closes the popover.
        fireEvent.click(container.querySelector('a.status[data-status-id="2"]')!);
        expect(onUpdateStatus).toHaveBeenCalledWith(us, 2);
        expect(container.querySelectorAll(".popover.active")).toHaveLength(0);
    });

    it("keeps at most one .popover.active open at a time (single-open invariant)", () => {
        const container = renderRow();

        // Opening the status popover -> exactly one active popover.
        fireEvent.click(container.querySelector(".us-status")!);
        expect(container.querySelectorAll(".popover.active")).toHaveLength(1);
        expect(container.querySelector(".popover.pop-status.active")).not.toBeNull();

        // Opening the points popover must CLOSE the status one — still exactly
        // one `.popover.active`, now the role/points popover.
        fireEvent.click(container.querySelector(".us-points")!);
        expect(container.querySelectorAll(".popover.active")).toHaveLength(1);
        expect(container.querySelector(".popover.pop-role.active")).not.toBeNull();
        expect(container.querySelector(".popover.pop-status.active")).toBeNull();
    });
});

describe("BacklogRow — inline points editor", () => {
    it("renders the points value and opens the .pop-role popover on click", () => {
        const container = renderRow();

        expect(container.querySelector(".us-points .points-value")!.textContent).toBe("8");
        expect(container.querySelector(".popover")).toBeNull();

        fireEvent.click(container.querySelector(".us-points")!);

        expect(container.querySelector(".popover.pop-role.active")).not.toBeNull();
        expect(container.querySelectorAll(".popover.active")).toHaveLength(1);
    });

    it("walks the role -> point selection steps and calls onUpdatePoints", () => {
        const onUpdatePoints = jest.fn();
        // Two computable roles force the role-selection step (no preselection);
        // points populate the second step.
        const multiRoleProject = {
            ...project,
            roles: [
                { id: 5, name: "Design", computable: true },
                { id: 6, name: "Front", computable: true },
            ],
            points: [
                { id: 30, name: "1", value: 1, order: 1 },
                { id: 31, name: "2", value: 2, order: 2 },
            ],
        } as unknown as Project;

        const container = renderRow({ project: multiRoleProject, onUpdatePoints });

        // Step 1: the role list.
        fireEvent.click(container.querySelector(".us-points")!);
        expect(container.querySelectorAll("a.role")).toHaveLength(2);

        // Step 2: choosing a role reveals the point values.
        fireEvent.click(container.querySelector('a.role[data-role-id="6"]')!);
        expect(container.querySelectorAll("a.point")).toHaveLength(2);

        // Choosing a point calls back with (us, roleId, pointId) and closes.
        fireEvent.click(container.querySelector('a.point[data-point-id="31"]')!);
        expect(onUpdatePoints).toHaveBeenCalledWith(us, 6, 31);
        expect(container.querySelectorAll(".popover.active")).toHaveLength(0);
    });
});

describe("BacklogRow — options popup", () => {
    it("opens the .us-option-popup and calls onEdit(us) from the edit action", () => {
        const onEdit = jest.fn();
        const container = renderRow({ onEdit });

        expect(container.querySelector(".us-option-popup.active")).toBeNull();

        fireEvent.click(container.querySelector(".us-option-popup-button")!);
        expect(container.querySelector(".us-option-popup.active")).not.toBeNull();

        fireEvent.click(container.querySelector(".e2e-edit.edit-story")!);
        expect(onEdit).toHaveBeenCalledWith(us);
        // Selecting an action closes the popup.
        expect(container.querySelector(".us-option-popup.active")).toBeNull();
    });

    it("calls onDelete(us) and onMoveToTop(us) from the options popup", () => {
        // Delete (delete_us present by default).
        const onDelete = jest.fn();
        const deleteContainer = renderRow({ onDelete });
        fireEvent.click(deleteContainer.querySelector(".us-option-popup-button")!);
        fireEvent.click(deleteContainer.querySelector(".e2e-delete")!);
        expect(onDelete).toHaveBeenCalledWith(us);

        // Move-to-top (a fresh render keeps the two interactions isolated).
        const onMoveToTop = jest.fn();
        const moveContainer = renderRow({ onMoveToTop });
        fireEvent.click(moveContainer.querySelector(".us-option-popup-button")!);
        fireEvent.click(moveContainer.querySelector(".move-to-top")!);
        expect(onMoveToTop).toHaveBeenCalledWith(us);
    });
});

describe("BacklogRow — permission gating", () => {
    it("gates every mutating control when modify_us is absent", () => {
        const container = renderRow({
            project: { ...project, my_permissions: ["view_us"] } as unknown as Project,
        });

        // No drag handle and no multiselect checkbox.
        expect(container.querySelector(".draggable-us-row")).toBeNull();
        expect(container.querySelector('input[type="checkbox"]')).toBeNull();

        // The status arrow is removed and the status anchor is not-clickable.
        expect(container.querySelector(".us-status .icon-arrow-down")).toBeNull();
        expect(container.querySelector(".us-status")).toHaveClass("not-clickable");

        // The row root gains the `readonly` modifier and the options control is gone.
        expect(container.querySelector("div.row.us-item-row")).toHaveClass("readonly");
        expect(container.querySelector(".us-option")).toBeNull();
    });

    it("hides only the delete action when delete_us is absent but modify_us present", () => {
        const container = renderRow({
            project: {
                ...project,
                my_permissions: ["modify_us", "view_us"],
            } as unknown as Project,
        });

        fireEvent.click(container.querySelector(".us-option-popup-button")!);
        expect(container.querySelector(".us-option-popup.active")).not.toBeNull();

        // Delete is gated out; edit and move-to-top remain.
        expect(container.querySelector(".e2e-delete")).toBeNull();
        expect(container.querySelector(".e2e-edit.edit-story")).not.toBeNull();
        expect(container.querySelector(".move-to-top")).not.toBeNull();
    });
});

