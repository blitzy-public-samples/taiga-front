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
 * STATUS / POINTS / OPTIONS popovers). Because the UNCHANGED Taiga SCSS targets
 * specific class names, `data-*` attributes and element hierarchy, these tests
 * assert on the emitted DOM (via `container.querySelector` / `querySelectorAll`)
 * — proving DOM/visual parity — as well as on the permission-gating, popover
 * behavior and callback wiring that reproduce the legacy behavior.
 *
 * These tests assert the ROOT-CAUSE M4/M7 fixes rather than encoding prior
 * defects:
 *   - the three inline popovers share the {@link usePopover} hook, so at most
 *     ONE popover is open across the WHOLE document (not merely within one row),
 *     and each closes on outside pointer-down and on Escape;
 *   - the points value is computed with the legacy estimation rules, so an
 *     unestimated story renders the literal `"?"` (never `0`), the per-role
 *     popover entries render `"{role} ({point})"`, and a header-selected role
 *     switches the display to the `"{point} / {total}"` split form;
 *   - a `saving` row disables its controls;
 *   - visible text is resolved through the real i18n bundle.
 *
 * Conventions:
 *   - AMBIENT Jest globals are used directly (the project ships `@types/jest`
 *     and lists `"jest"` in the tsconfig `types` array).
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — no `import React`.
 *   - `ts-jest` + `jsdom`; `@testing-library/jest-dom` matchers are registered
 *     globally by `jest.setup.ts`.
 *   - The module-level `usePopover` single-active registry is reset in
 *     `afterEach` via `__resetPopoverRegistry()` so tests do not leak an open
 *     popover's close handler into the next test.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { BacklogRow } from "./BacklogRow";
import type { BacklogRowProps } from "./BacklogRow";
import type { UserStory, Project, Status } from "../shared/types";
import { __resetPopoverRegistry } from "../shared/popover/usePopover";
import { t } from "../shared/i18n/translate";

// ---------------------------------------------------------------------------
// Fixtures
//
// Module-level singletons so callback assertions can use referential equality
// (`toHaveBeenCalledWith(us, ...)`). The tests NEVER mutate these fixtures; a
// variant is spread from the base when needed.
// ---------------------------------------------------------------------------

/** Two ordered US statuses feeding the status popover (`.pop-status`). */
const statuses: Status[] = [
    { id: 1, name: "New", color: "#aaa", order: 1 } as Status,
    { id: 2, name: "In progress", color: "#bbb", order: 2 } as Status,
];

/**
 * Estimation points shared by the fixtures. `name` is the human label shown in
 * the popovers ("S" / "L" / "XL"); `value` is the numeric weight summed by
 * `calculateTotalPoints`.
 */
const POINTS = [
    { id: 30, name: "S", value: 1, order: 1 },
    { id: 31, name: "L", value: 8, order: 2 },
    { id: 32, name: "XL", value: 13, order: 3 },
];

/**
 * Default project: ONE computable role (Design, id 5). `my_permissions`
 * includes `modify_us` + `delete_us` so the default row renders every
 * affordance; individual tests narrow the permission set.
 */
const project: Project = {
    id: 7,
    slug: "proj",
    name: "Proj",
    my_permissions: ["modify_us", "delete_us", "view_us"],
    is_kanban_activated: true,
    is_backlog_activated: true,
    roles: [{ id: 5, name: "Design", computable: true }],
    points: POINTS,
} as unknown as Project;

/**
 * Project with TWO computable roles (Design 5, Front 6) — forces the
 * role-selection step of the points popover and the header split display.
 */
const multiRoleProject: Project = {
    ...project,
    roles: [
        { id: 5, name: "Design", computable: true },
        { id: 6, name: "Front", computable: true },
    ],
} as unknown as Project;

/**
 * Default story: ref 42, status "New" (id 1), Design -> point 31 (L, value 8),
 * two tags, not blocked. With a single computable role the total is 8.
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
    points: { "5": 31 },
    is_blocked: false,
} as unknown as UserStory;

/** A second story for the cross-row single-active popover test. */
const us2: UserStory = {
    id: 202,
    ref: 43,
    subject: "Signup page",
    status: 1,
    swimlane: null,
    tags: [],
    points: { "5": 30 },
    is_blocked: false,
} as unknown as UserStory;

/** A multi-role story: Design -> L (8), Front -> S (1); total 9. */
const multiRoleUs: UserStory = {
    ...us,
    points: { "5": 31, "6": 30 },
} as unknown as UserStory;

/** An unestimated story (empty points map) — the total must render as "?". */
const unestimatedUs: UserStory = {
    ...us,
    points: {},
    total_points: null,
} as unknown as UserStory;

/**
 * Build a complete {@link BacklogRowProps} object, layering `overrides` over
 * the default fixtures. Fresh `jest.fn()` spies are created for every callback
 * on each call.
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

// The single-active popover registry is module-level; reset it between tests
// so an open popover from one test cannot leak its close handler into the next.
afterEach(() => {
    __resetPopoverRegistry();
});

describe("BacklogRow — row root DOM & modifier classes", () => {
    it("renders the .row.us-item-row root with the static ng-repeat attr and data-id", () => {
        const container = renderRow();

        const row = container.querySelector("div.row.us-item-row");
        expect(row).not.toBeNull();

        // `ng-repeat` is a STATIC passthrough string (NOT AngularJS behavior),
        // required so the ported e2e selector `.backlog-table-body >
        // div[ng-repeat]` still matches the migrated row.
        expect(row!.getAttribute("ng-repeat")).toBe("us in userstories");

        // `data-id` mirrors the legacy `data-id="{{ us.id }}"` binding.
        expect(row).toHaveAttribute("data-id", "101");
    });

    it("adds the 'blocked' modifier class when the story is blocked", () => {
        const container = renderRow({ us: { ...us, is_blocked: true } });
        expect(container.querySelector("div.row.us-item-row")).toHaveClass("blocked");
    });

    it("adds the 'new' modifier class when the story is new", () => {
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
        expect(container.querySelector(".us-option-popup-button")).toHaveClass("first");
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

        expect(container.querySelector("div.row.us-item-row")).toHaveClass("dragging");
        expect(setNodeRef).toHaveBeenCalled();
        expect(setActivatorNodeRef).toHaveBeenCalled();

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
        expect(handle!.querySelector(".icon-drag")).not.toBeNull();
    });

    it("reports a plain checkbox click as onToggleSelected(us, true, false)", () => {
        const onToggleSelected = jest.fn();
        const container = renderRow({ onToggleSelected });

        const checkbox = container.querySelector<HTMLInputElement>(
            'input#us-check-42[type="checkbox"]',
        );
        expect(checkbox).not.toBeNull();
        expect(checkbox!).not.toBeChecked();
        expect(container.querySelector('label[for="us-check-42"]')).not.toBeNull();

        fireEvent.click(checkbox!);
        expect(onToggleSelected).toHaveBeenCalledTimes(1);
        // Third argument is the shift-key modifier — false for a plain click.
        expect(onToggleSelected).toHaveBeenCalledWith(us, true, false);
    });

    it("forwards the shift modifier as the third argument on shift+click", () => {
        const onToggleSelected = jest.fn();
        const container = renderRow({ onToggleSelected });
        const checkbox = container.querySelector<HTMLInputElement>("input#us-check-42")!;

        fireEvent.click(checkbox, { shiftKey: true });
        expect(onToggleSelected).toHaveBeenCalledWith(us, true, true);
    });

    it("suppresses the native text-selection gesture on a shift+mousedown so the toggle still fires", () => {
        // A Shift+click after a prior row is focused otherwise starts a native
        // text selection that swallows the checkbox activation. The
        // `.custom-checkbox` calls preventDefault ONLY for the Shift gesture so
        // the toggle survives; ordinary (non-Shift) selection is untouched.
        const container = renderRow();
        const box = container.querySelector<HTMLElement>(".custom-checkbox")!;

        const shiftDown = fireEvent.mouseDown(box, { shiftKey: true });
        // fireEvent returns false when a handler called preventDefault.
        expect(shiftDown).toBe(false);

        const plainDown = fireEvent.mouseDown(box, { shiftKey: false });
        expect(plainDown).toBe(true);
    });

    it("disables the checkbox while the row is saving", () => {
        const container = renderRow({ saving: true });
        expect(container.querySelector<HTMLInputElement>("input#us-check-42")).toBeDisabled();
    });
});

describe("BacklogRow — user-story link, ref, name & tags", () => {
    it("renders the user-story link with plain route href, ref number and (escaped) name", () => {
        const container = renderRow();

        const link = container.querySelector("a.user-story-link");
        expect(link).toHaveAttribute("href", "/project/proj/us/42");

        const number = container.querySelector(".user-story-number");
        expect(number!.textContent).toBe("#42 ");
        expect(number).toHaveAttribute("tg-bo-ref", "us.ref");

        const name = container.querySelector(".user-story-name");
        expect(name!.textContent).toBe("Login page");
        expect(screen.getByText("Login page")).toHaveClass("user-story-name");
    });

    it("hides tags when showTags is false", () => {
        expect(renderRow({ showTags: false }).querySelectorAll(".tag")).toHaveLength(0);
    });

    it("renders tags with titles and a trailing 'last' modifier when showTags is true", () => {
        const container = renderRow({ showTags: true });
        const tags = container.querySelectorAll(".tag");
        expect(tags).toHaveLength(2);
        expect(tags[0].textContent).toBe("urgent");
        expect(tags[1].textContent).toBe("ui");
        expect(tags[0]).toHaveAttribute("title", "urgent");
        expect(tags[0]).not.toHaveClass("last");
        expect(tags[1]).toHaveClass("last");
    });
});

describe("BacklogRow — inline status editor", () => {
    it("renders the current status and opens the .pop-status popover on click", () => {
        const onUpdateStatus = jest.fn();
        const container = renderRow({ onUpdateStatus });

        expect(container.querySelector(".us-status .us-status-bind")!.textContent).toBe("New");
        expect(container.querySelector(".popover")).toBeNull();

        fireEvent.click(container.querySelector(".us-status")!);
        expect(container.querySelector(".popover.pop-status.active")).not.toBeNull();

        const items = container.querySelectorAll("a.status");
        expect(items).toHaveLength(2);
        items.forEach((item) => expect(item).toHaveAttribute("data-status-id"));

        fireEvent.click(container.querySelector('a.status[data-status-id="2"]')!);
        expect(onUpdateStatus).toHaveBeenCalledWith(us, 2);
        expect(container.querySelectorAll(".popover.active")).toHaveLength(0);
    });

    it("resolves the status control title through the i18n bundle", () => {
        const container = renderRow();
        expect(container.querySelector(".us-status")).toHaveAttribute(
            "title",
            t("BACKLOG.STATUS_NAME"),
        );
    });

    it("does not open the status popover while the row is saving", () => {
        const container = renderRow({ saving: true });
        expect(container.querySelector(".us-status")).toHaveClass("not-clickable");
        fireEvent.click(container.querySelector(".us-status")!);
        expect(container.querySelector(".popover")).toBeNull();
    });
});

describe("BacklogRow — inline points editor (estimation parity)", () => {
    it("renders the computed total (never a fabricated 0) for an estimated story", () => {
        // Single computable role -> total is the value of point 31 (L) = 8.
        expect(renderRow().querySelector(".us-points .points-value")!.textContent).toBe("8");
    });

    it("renders '?' for an unestimated story (empty points map)", () => {
        const container = renderRow({ us: unestimatedUs });
        expect(container.querySelector(".us-points .points-value")!.textContent).toBe("?");
    });

    it("preselects the point step for a single computable role and calls onUpdatePoints", () => {
        const onUpdatePoints = jest.fn();
        const container = renderRow({ onUpdatePoints });

        // One computable role -> clicking jumps straight to the point-value step
        // (`.pop-points-open`), never showing the role step.
        fireEvent.click(container.querySelector(".us-points")!);
        expect(container.querySelector(".popover.pop-points-open.active")).not.toBeNull();
        expect(container.querySelector(".popover.pop-role")).toBeNull();

        // The currently-assigned point (31 = L) is marked active.
        expect(container.querySelector('a.point[data-point-id="31"]')).toHaveClass("active");

        fireEvent.click(container.querySelector('a.point[data-point-id="32"]')!);
        expect(onUpdatePoints).toHaveBeenCalledWith(us, 5, 32);
        expect(container.querySelectorAll(".popover.active")).toHaveLength(0);
    });

    it("shows the role step with '{role} ({point})' entries for multiple roles", () => {
        const container = renderRow({ project: multiRoleProject, us: multiRoleUs });

        fireEvent.click(container.querySelector(".us-points")!);
        expect(container.querySelector(".popover.pop-role.active")).not.toBeNull();

        const roles = container.querySelectorAll("a.role .item-text");
        expect(roles).toHaveLength(2);
        // Design -> L (point 31), Front -> S (point 30).
        expect(roles[0].textContent).toBe("Design (L)");
        expect(roles[1].textContent).toBe("Front (S)");
    });

    it("walks the role -> point steps and calls onUpdatePoints with the chosen role", () => {
        const onUpdatePoints = jest.fn();
        const container = renderRow({
            project: multiRoleProject,
            us: multiRoleUs,
            onUpdatePoints,
        });

        fireEvent.click(container.querySelector(".us-points")!);
        fireEvent.click(container.querySelector('a.role[data-role-id="6"]')!);
        expect(container.querySelector(".popover.pop-points-open.active")).not.toBeNull();
        expect(container.querySelectorAll("a.point")).toHaveLength(3);
        // Front's current point is 30 (S) -> marked active.
        expect(container.querySelector('a.point[data-point-id="30"]')).toHaveClass("active");

        fireEvent.click(container.querySelector('a.point[data-point-id="32"]')!);
        expect(onUpdatePoints).toHaveBeenCalledWith(multiRoleUs, 6, 32);
    });

    it("renders the '{point} / {total}' split when a header role is selected (>1 role)", () => {
        const container = renderRow({
            project: multiRoleProject,
            us: multiRoleUs,
            displayRoleId: 6,
        });
        // Front -> point 30 (S); total = 8 + 1 = 9 -> "S / 9".
        const value = container.querySelector(".us-points .points-value")!;
        expect(value.textContent).toBe("S / 9");
        // The total is wrapped in its own <span> (legacy `"{name} / <span>{n}</span>"`).
        expect(value.querySelector("span")!.textContent).toBe("9");
    });

    it("marks the points control not-clickable when there are no computable roles", () => {
        const noRoleProject = {
            ...project,
            roles: [{ id: 9, name: "Stakeholder", computable: false }],
        } as unknown as Project;
        const container = renderRow({ project: noRoleProject, us: unestimatedUs });

        const control = container.querySelector(".us-points");
        expect(control).toHaveClass("not-clickable");
        fireEvent.click(control!);
        expect(container.querySelector(".popover")).toBeNull();
    });
});

describe("BacklogRow — options popup", () => {
    it("opens the .us-option-popup and calls onEdit(us) with i18n labels", () => {
        const onEdit = jest.fn();
        const container = renderRow({ onEdit });

        expect(container.querySelector(".us-option-popup.active")).toBeNull();

        fireEvent.click(container.querySelector(".us-option-popup-button")!);
        expect(container.querySelector(".us-option-popup.active")).not.toBeNull();

        // Visible labels come from the i18n bundle.
        expect(container.querySelector(".e2e-edit.edit-story span")!.textContent).toBe(
            t("COMMON.EDIT"),
        );
        expect(container.querySelector(".e2e-delete span")!.textContent).toBe(t("COMMON.DELETE"));
        expect(container.querySelector(".move-to-top span")!.textContent).toBe(
            t("COMMON.MOVE_TO_TOP"),
        );

        fireEvent.click(container.querySelector(".e2e-edit.edit-story")!);
        expect(onEdit).toHaveBeenCalledWith(us);
        expect(container.querySelector(".us-option-popup.active")).toBeNull();
    });

    it("calls onDelete(us) and onMoveToTop(us) from the options popup", () => {
        const onDelete = jest.fn();
        const deleteContainer = renderRow({ onDelete });
        fireEvent.click(deleteContainer.querySelector(".us-option-popup-button")!);
        fireEvent.click(deleteContainer.querySelector(".e2e-delete")!);
        expect(onDelete).toHaveBeenCalledWith(us);

        const onMoveToTop = jest.fn();
        const moveContainer = renderRow({ onMoveToTop });
        fireEvent.click(moveContainer.querySelector(".us-option-popup-button")!);
        fireEvent.click(moveContainer.querySelector(".move-to-top")!);
        expect(onMoveToTop).toHaveBeenCalledWith(us);
    });

    it("does not open the options popup while the row is saving", () => {
        const container = renderRow({ saving: true });
        expect(container.querySelector(".us-option-popup-button")).toBeDisabled();
        fireEvent.click(container.querySelector(".us-option-popup-button")!);
        expect(container.querySelector(".us-option-popup.active")).toBeNull();
    });
});

describe("BacklogRow — shared popover semantics (M4/M7)", () => {
    it("keeps at most one .popover.active open at a time within a row", () => {
        const container = renderRow();

        fireEvent.click(container.querySelector(".us-status")!);
        expect(container.querySelectorAll(".popover.active")).toHaveLength(1);
        expect(container.querySelector(".popover.pop-status.active")).not.toBeNull();

        // Opening the points editor closes the status popover (single-active).
        fireEvent.click(container.querySelector(".us-points")!);
        expect(container.querySelectorAll(".popover.active")).toHaveLength(1);
        expect(container.querySelector(".popover.pop-status.active")).toBeNull();
    });

    it("enforces single-active ACROSS rows (opening row B closes row A's popover)", () => {
        const { container } = render(
            <>
                <BacklogRow {...makeProps({ us })} />
                <BacklogRow {...makeProps({ us: us2 })} />
            </>,
        );
        const rows = container.querySelectorAll("div.row.us-item-row");
        expect(rows).toHaveLength(2);

        // Open row A's status popover.
        fireEvent.click(rows[0].querySelector(".us-status")!);
        expect(container.querySelectorAll(".popover.active")).toHaveLength(1);
        expect(rows[0].querySelector(".popover.active")).not.toBeNull();

        // Opening row B's status popover must close row A's — still exactly one.
        fireEvent.click(rows[1].querySelector(".us-status")!);
        expect(container.querySelectorAll(".popover.active")).toHaveLength(1);
        expect(rows[0].querySelector(".popover.active")).toBeNull();
        expect(rows[1].querySelector(".popover.active")).not.toBeNull();
    });

    it("closes the open popover on an outside pointer-down", () => {
        const container = renderRow();
        fireEvent.click(container.querySelector(".us-status")!);
        expect(container.querySelector(".popover.active")).not.toBeNull();

        fireEvent.mouseDown(document.body);
        expect(container.querySelector(".popover.active")).toBeNull();
    });

    it("keeps the popover open on a pointer-down INSIDE it", () => {
        const container = renderRow();
        fireEvent.click(container.querySelector(".us-status")!);
        const popover = container.querySelector(".popover.active")!;

        fireEvent.mouseDown(popover);
        expect(container.querySelector(".popover.active")).not.toBeNull();
    });

    it("closes the open popover on Escape", () => {
        const container = renderRow();
        fireEvent.click(container.querySelector(".us-status")!);
        expect(container.querySelector(".popover.active")).not.toBeNull();

        fireEvent.keyDown(document, { key: "Escape" });
        expect(container.querySelector(".popover.active")).toBeNull();
    });
});

describe("BacklogRow — permission gating", () => {
    it("gates every mutating control when modify_us is absent", () => {
        const container = renderRow({
            project: { ...project, my_permissions: ["view_us"] } as unknown as Project,
        });

        expect(container.querySelector(".draggable-us-row")).toBeNull();
        expect(container.querySelector('input[type="checkbox"]')).toBeNull();
        expect(container.querySelector(".us-status .icon-arrow-down")).toBeNull();
        expect(container.querySelector(".us-status")).toHaveClass("not-clickable");
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
        expect(container.querySelector(".e2e-delete")).toBeNull();
        expect(container.querySelector(".e2e-edit.edit-story")).not.toBeNull();
        expect(container.querySelector(".move-to-top")).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// M4 — the authoritative edit gate must combine the raw `modify_us` /
// `delete_us` permission with the project read-only (`archived_code`) state.
// The existing suite covers the permission-absent case; these pin the NEW
// read-only-project dimension: full perms but an archived (read-only) project
// must render the row exactly as a no-permission row (no drag handle, no
// checkbox, no options popup, `readonly` class).
// ---------------------------------------------------------------------------
describe("BacklogRow — read-only project gating (M4)", () => {
    const readOnlyProject = { ...project, archived_code: "ARCH" } as unknown as Project;

    it("marks the row readonly and removes ALL mutating controls on a read-only project (full perms)", () => {
        const container = renderRow({ project: readOnlyProject });
        expect(container.querySelector("div.row.us-item-row")).toHaveClass("readonly");
        // No options popup trigger, no drag handle, no selection checkbox.
        expect(container.querySelector(".us-option")).toBeNull();
        expect(container.querySelector(".draggable-us-row")).toBeNull();
        expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    });

    it("renders the drag handle + options popup on a writable project (positive control)", () => {
        const container = renderRow();
        expect(container.querySelector("div.row.us-item-row")).not.toHaveClass("readonly");
        expect(container.querySelector(".draggable-us-row")).not.toBeNull();
        expect(container.querySelector(".us-option")).not.toBeNull();
    });
});
