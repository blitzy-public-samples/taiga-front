/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link CreateEditSprint}.
 *
 * `CreateEditSprint` is the React reproduction of the AngularJS
 * `tgLbCreateEditSprint` directive (`app/coffee/modules/backlog/lightboxes.coffee`)
 * and the DOM of `app/partials/includes/modules/lightbox-sprint-add-edit.jade`.
 * Because the UNCHANGED Taiga SCSS targets specific class names / element
 * hierarchy, these tests assert on the emitted DOM (via `container.querySelector`)
 * as well as on the behavioral contract: the CREATE default dates, the EDIT
 * prefill, `delete_milestone` permission gating, hand-written form validation,
 * the dirty-field PATCH save, and the confirm-guarded delete — all of which flow
 * through the injected {@link ApiClient} so the frozen `/api/v1/` contract (C-1)
 * is exercised exactly as the legacy `$repo` calls were.
 *
 * Conventions (match the repo's React test harness — see `BacklogRow.test.tsx`):
 *   - Jest globals (`describe`/`it`/`expect`/`jest`) are used ambiently (typed by
 *     the `@types/jest` entry in `tsconfig.json#types`); this keeps the mock
 *     matchers (`toHaveBeenCalledWith`) aligned with the `jest.fn()` spies.
 *   - Automatic JSX runtime (`jsx: "react-jsx"`) — no `import React`.
 *   - `ts-jest` + `jsdom`; core matchers + `container.querySelector` prove DOM
 *     parity (no `@testing-library/jest-dom` matchers are required here).
 *   - `import type` is used for every type-only import (`isolatedModules`).
 *
 * The {@link ApiClient} is stubbed with `jest.fn()` spies for the only three
 * methods this component uses (`create`, `save`, `remove`) and cast through
 * `as unknown as ApiClient`; `window.confirm` is stubbed per-test with
 * `jest.spyOn`.
 */

import { render, fireEvent, waitFor } from "@testing-library/react";
import { CreateEditSprint } from "./CreateEditSprint";
import type { CreateEditSprintProps } from "./CreateEditSprint";
import type { ApiClient } from "../../shared/api";
import type { Milestone, Project } from "../../shared/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a {@link Project} carrying the given permission set. All other required
 * fields get inert defaults so tests only vary `my_permissions`.
 *
 * @param permissions - The `my_permissions` array driving the delete gate.
 * @returns A fully-populated {@link Project}.
 */
function makeProject(permissions: string[]): Project {
    return {
        id: 42,
        slug: "proj-42",
        name: "Project 42",
        my_permissions: permissions,
        is_kanban_activated: true,
        is_backlog_activated: true,
        archived_code: null,
    };
}

/**
 * Build a {@link Milestone} (sprint), layering `overrides` over sensible
 * defaults (id 7, "Sprint 7", 2025-01-01 → 2025-01-14).
 *
 * @param overrides - Partial milestone fields to merge over the defaults.
 * @returns A {@link Milestone}.
 */
function makeSprint(overrides: Partial<Milestone> = {}): Milestone {
    return {
        id: 7,
        name: "Sprint 7",
        estimated_start: "2025-01-01",
        estimated_finish: "2025-01-14",
        ...overrides,
    };
}

/** The spy bundle returned by {@link setup} so tests can assert on calls. */
interface Harness {
    props: CreateEditSprintProps;
    createMock: jest.Mock;
    saveMock: jest.Mock;
    removeMock: jest.Mock;
    onClose: jest.Mock;
    onSaved: jest.Mock;
    onDeleted: jest.Mock;
}

/**
 * Build a complete {@link CreateEditSprintProps} object with fresh spies,
 * layering `overrides` over the defaults (open, create mode, full permissions).
 *
 * @param overrides - Partial props to merge over the defaults.
 * @returns A {@link Harness} exposing the props and every spy.
 */
function setup(overrides: Partial<CreateEditSprintProps> = {}): Harness {
    const createMock = jest.fn().mockResolvedValue({});
    const saveMock = jest.fn().mockResolvedValue({});
    const removeMock = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const onSaved = jest.fn();
    const onDeleted = jest.fn();

    const apiClient = {
        create: createMock,
        save: saveMock,
        remove: removeMock,
    } as unknown as ApiClient;

    const props: CreateEditSprintProps = {
        open: true,
        mode: "create",
        sprint: null,
        lastSprint: null,
        project: makeProject(["delete_milestone"]),
        projectId: 42,
        apiClient,
        onClose,
        onSaved,
        onDeleted,
        ...overrides,
    };

    return { props, createMock, saveMock, removeMock, onClose, onSaved, onDeleted };
}

/** Query the sprint-name input from a rendered container. */
function nameInput(container: HTMLElement): HTMLInputElement {
    return container.querySelector('input[name="name"]') as HTMLInputElement;
}

/** Query the estimated-start input from a rendered container. */
function startInput(container: HTMLElement): HTMLInputElement {
    return container.querySelector('input[name="estimated_start"]') as HTMLInputElement;
}

/** Query the estimated-finish input from a rendered container. */
function finishInput(container: HTMLElement): HTMLInputElement {
    return container.querySelector('input[name="estimated_finish"]') as HTMLInputElement;
}

/** Query the <form> element from a rendered container. */
function formEl(container: HTMLElement): HTMLFormElement {
    return container.querySelector("form") as HTMLFormElement;
}

afterEach(() => {
    jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe("CreateEditSprint — visibility", () => {
    it("renders nothing when closed", () => {
        const { props } = setup({ open: false });
        const { container } = render(<CreateEditSprint {...props} />);
        expect(container.firstChild).toBeNull();
    });

    it("renders the lightbox host DOM when open", () => {
        const { props } = setup();
        const { container } = render(<CreateEditSprint {...props} />);

        const root = container.querySelector("div[tg-lb-create-edit-sprint]");
        expect(root).not.toBeNull();
        expect(root?.classList.contains("lightbox")).toBe(true);
        expect(root?.classList.contains("lightbox-sprint-add-edit")).toBe(true);
        expect((root as HTMLElement).style.display).toBe("block");

        // Name input with the exact class list + maxLength the SCSS/e2e rely on.
        const name = nameInput(container);
        expect(name).not.toBeNull();
        expect(name.classList.contains("sprint-name")).toBe(true);
        expect(name.classList.contains("e2e-sprint-name")).toBe(true);
        expect(name.maxLength).toBe(500);

        // Both date inputs + a submit button.
        expect(startInput(container)).not.toBeNull();
        expect(finishInput(container)).not.toBeNull();
        expect(container.querySelector('button[type="submit"]')).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// CREATE mode
// ---------------------------------------------------------------------------

describe("CreateEditSprint — create mode", () => {
    it('shows the "New sprint" title and no delete button', () => {
        const { props } = setup({ mode: "create" });
        const { container } = render(<CreateEditSprint {...props} />);

        expect(container.querySelector("h2.title")?.textContent).toBe("New sprint");
        expect(container.querySelector(".delete-sprint")).toBeNull();
    });

    it("defaults start to the last sprint's finish and finish to +14 days", () => {
        const lastSprint = makeSprint({ id: 3, name: "Sprint 3", estimated_finish: "2025-06-01" });
        const { props } = setup({ mode: "create", lastSprint });
        const { container } = render(<CreateEditSprint {...props} />);

        expect(startInput(container).value).toBe("2025-06-01");
        expect(finishInput(container).value).toBe("2025-06-15");
    });

    it("defaults start to today (finish +14) when there is no last sprint", () => {
        const { props } = setup({ mode: "create", lastSprint: null });
        const { container } = render(<CreateEditSprint {...props} />);

        const start = startInput(container).value;
        expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        // finish must be exactly 14 UTC days after whatever start resolved to.
        const expected = new Date(Date.parse(start));
        expected.setUTCDate(expected.getUTCDate() + 14);
        expect(finishInput(container).value).toBe(expected.toISOString().slice(0, 10));
    });

    it("shows the last-sprint hint label while the name is empty", () => {
        const lastSprint = makeSprint({ id: 3, name: "Sprint 3" });
        const { props } = setup({ mode: "create", lastSprint });
        const { container } = render(<CreateEditSprint {...props} />);

        const label = container.querySelector("label.last-sprint-name");
        expect(label).not.toBeNull();
        expect(label?.classList.contains("disappear")).toBe(false);
        expect(label?.textContent).toBe("Last sprint: Sprint 3");
    });

    it("hides the last-sprint hint once a name is typed", () => {
        const lastSprint = makeSprint({ id: 3, name: "Sprint 3" });
        const { props } = setup({ mode: "create", lastSprint });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "My sprint" } });

        const label = container.querySelector("label.last-sprint-name");
        expect(label?.classList.contains("disappear")).toBe(true);
    });

    it("creates via the milestones endpoint then calls onSaved + onClose", async () => {
        const { props, createMock, onSaved, onClose } = setup({ mode: "create", lastSprint: null });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "Fresh sprint" } });
        fireEvent.change(startInput(container), { target: { value: "2025-07-01" } });
        fireEvent.change(finishInput(container), { target: { value: "2025-07-15" } });
        fireEvent.submit(formEl(container));

        await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
        expect(createMock).toHaveBeenCalledWith("milestones", {
            project: 42,
            name: "Fresh sprint",
            estimated_start: "2025-07-01",
            estimated_finish: "2025-07-15",
        });
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("guards against a double submit while the create is in flight", async () => {
        const { props, createMock, onSaved } = setup({ mode: "create", lastSprint: null });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "Once only" } });
        fireEvent.change(startInput(container), { target: { value: "2025-07-01" } });
        fireEvent.change(finishInput(container), { target: { value: "2025-07-15" } });

        // Two synchronous submits before the first create promise resolves.
        fireEvent.submit(formEl(container));
        fireEvent.submit(formEl(container));

        expect(createMock).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    });
});

// ---------------------------------------------------------------------------
// EDIT mode
// ---------------------------------------------------------------------------

describe("CreateEditSprint — edit mode", () => {
    it("prefills the fields and titles from the sprint", () => {
        const sprint = makeSprint();
        const { props } = setup({ mode: "edit", sprint });
        const { container } = render(<CreateEditSprint {...props} />);

        expect(container.querySelector("h2.title")?.textContent).toBe("Sprint 7");
        expect(nameInput(container).value).toBe("Sprint 7");
        expect(startInput(container).value).toBe("2025-01-01");
        expect(finishInput(container).value).toBe("2025-01-14");
    });

    it("renders the delete button when the user has delete_milestone", () => {
        const sprint = makeSprint();
        const { props } = setup({
            mode: "edit",
            sprint,
            project: makeProject(["delete_milestone"]),
        });
        const { container } = render(<CreateEditSprint {...props} />);

        const del = container.querySelector("button.btn-link.delete-sprint");
        expect(del).not.toBeNull();
        expect(del?.querySelector("svg.icon-trash use")?.getAttribute("xlink:href")).toBe("#icon-trash");
        expect(container.querySelector(".delete-sprint-text")?.textContent).toBe("delete sprint");
    });

    it("hides the delete button without delete_milestone", () => {
        const sprint = makeSprint();
        const { props } = setup({ mode: "edit", sprint, project: makeProject([]) });
        const { container } = render(<CreateEditSprint {...props} />);

        expect(container.querySelector(".delete-sprint")).toBeNull();
    });

    it("saves only the modified attrs via a dirty PATCH", async () => {
        const sprint = makeSprint();
        const { props, saveMock, onSaved, onClose } = setup({ mode: "edit", sprint });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "Renamed" } });
        fireEvent.submit(formEl(container));

        await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
        expect(saveMock).toHaveBeenCalledWith(
            "milestones",
            expect.objectContaining({ id: 7, name: "Renamed" }),
            { name: "Renamed" },
            true,
        );
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("sends an empty modified set when nothing changed", async () => {
        const sprint = makeSprint();
        const { props, saveMock, onSaved } = setup({ mode: "edit", sprint });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.submit(formEl(container));

        await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
        expect(saveMock).toHaveBeenCalledWith(
            "milestones",
            expect.objectContaining({ id: 7 }),
            {},
            true,
        );
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    });

    it("includes both dates in the modified set when they change", async () => {
        const sprint = makeSprint();
        const { props, saveMock } = setup({ mode: "edit", sprint });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(startInput(container), { target: { value: "2025-02-01" } });
        fireEvent.change(finishInput(container), { target: { value: "2025-02-20" } });
        fireEvent.submit(formEl(container));

        await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
        expect(saveMock).toHaveBeenCalledWith(
            "milestones",
            expect.objectContaining({
                estimated_start: "2025-02-01",
                estimated_finish: "2025-02-20",
            }),
            { estimated_start: "2025-02-01", estimated_finish: "2025-02-20" },
            true,
        );
    });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("CreateEditSprint — validation", () => {
    it("blocks submit and shows the name error when the name is empty", () => {
        const { props, createMock } = setup({ mode: "create", lastSprint: null });
        const { container } = render(<CreateEditSprint {...props} />);

        // Defaults leave the name empty; submit as-is.
        fireEvent.submit(formEl(container));

        const err = container.querySelector(".error.error-name");
        expect(err).not.toBeNull();
        expect(err?.textContent).toBe("Name is required");
        expect(createMock).not.toHaveBeenCalled();
    });

    it("shows date errors when the dates are cleared", () => {
        const { props, createMock } = setup({ mode: "create", lastSprint: null });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "Named" } });
        fireEvent.change(startInput(container), { target: { value: "" } });
        fireEvent.change(finishInput(container), { target: { value: "" } });
        fireEvent.submit(formEl(container));

        expect(container.querySelector(".error-name")).toBeNull();
        expect(container.querySelector(".error-estimated-start")).not.toBeNull();
        expect(container.querySelector(".error-estimated-finish")).not.toBeNull();
        expect(createMock).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Delete + close
// ---------------------------------------------------------------------------

describe("CreateEditSprint — delete & close", () => {
    it("removes the sprint after the user confirms", async () => {
        jest.spyOn(window, "confirm").mockReturnValue(true);
        const sprint = makeSprint();
        const { props, removeMock, onDeleted, onClose } = setup({ mode: "edit", sprint });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.click(container.querySelector("button.delete-sprint") as HTMLButtonElement);

        await waitFor(() => expect(removeMock).toHaveBeenCalledTimes(1));
        expect(removeMock).toHaveBeenCalledWith("milestones", 7);
        await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not remove the sprint when the user cancels", () => {
        jest.spyOn(window, "confirm").mockReturnValue(false);
        const sprint = makeSprint();
        const { props, removeMock, onDeleted } = setup({ mode: "edit", sprint });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.click(container.querySelector("button.delete-sprint") as HTMLButtonElement);

        expect(removeMock).not.toHaveBeenCalled();
        expect(onDeleted).not.toHaveBeenCalled();
    });

    it("closes when the close control is clicked", () => {
        const { props, onClose } = setup();
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.click(container.querySelector("a.close") as HTMLAnchorElement);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
