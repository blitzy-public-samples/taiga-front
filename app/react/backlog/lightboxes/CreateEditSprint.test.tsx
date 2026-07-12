/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ApiClient } from "../../shared/api";
import type { Milestone, Project } from "../../shared/types";
import { CreateEditSprint } from "./CreateEditSprint";
import type { CreateEditSprintProps } from "./CreateEditSprint";

const project: Project = {
    id: 1,
    slug: "proj",
    name: "Proj",
    my_permissions: ["delete_milestone", "add_milestone", "modify_us"],
    is_kanban_activated: true,
    is_backlog_activated: true,
};

const projectNoDelete: Project = { ...project, my_permissions: [] };

const editSprint: Milestone = {
    id: 42,
    name: "Sprint 1",
    estimated_start: "2024-01-01",
    estimated_finish: "2024-01-15",
};

function setup(overrides: Partial<CreateEditSprintProps> = {}) {
    const api = {
        create: jest.fn().mockResolvedValue({ id: 99, name: "created" }),
        save: jest.fn().mockResolvedValue({ id: 42, name: "saved" }),
        remove: jest.fn().mockResolvedValue(undefined),
    };
    const onClose = jest.fn();
    const onSaved = jest.fn();
    const onDeleted = jest.fn();

    const props: CreateEditSprintProps = {
        open: true,
        mode: "create",
        sprint: null,
        lastSprint: null,
        project,
        projectId: 1,
        apiClient: api as unknown as ApiClient,
        onClose,
        onSaved,
        onDeleted,
        ...overrides,
    };

    const utils = render(<CreateEditSprint {...props} />);
    return { ...utils, api, onClose, onSaved, onDeleted };
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe("CreateEditSprint", () => {
    it("renders nothing when open is false", () => {
        const { container } = setup({ open: false });
        expect(container.firstChild).toBeNull();
    });

    it("renders the lightbox host and form controls when open", () => {
        const { container } = setup();
        expect(
            container.querySelector("div[tg-lb-create-edit-sprint]"),
        ).not.toBeNull();
        expect(container.querySelector('input[name="name"]')).not.toBeNull();
        expect(container.querySelector(".e2e-sprint-name")).not.toBeNull();
        expect(container.querySelector('button[type="submit"]')).not.toBeNull();
    });

    it("shows the create title in create mode", () => {
        const { container } = setup({ mode: "create" });
        expect(container.querySelector(".title")?.textContent).toBe("New sprint");
    });

    it("shows the sprint name as the title in edit mode", () => {
        const { container } = setup({ mode: "edit", sprint: editSprint });
        expect(container.querySelector(".title")?.textContent).toBe("Sprint 1");
    });

    it("creates a sprint on submit, then calls onSaved and onClose", async () => {
        const { container, api, onSaved, onClose } = setup({
            mode: "create",
            projectId: 7,
        });
        const input = container.querySelector(
            'input[name="name"]',
        ) as HTMLInputElement;
        fireEvent.change(input, { target: { value: "My Sprint" } });

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
        expect(api.create).toHaveBeenCalledWith(
            "milestones",
            expect.objectContaining({ project: 7, name: "My Sprint" }),
        );
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("blocks submit and shows a validation error when the name is empty", async () => {
        const { container, api } = setup({ mode: "create" });
        const input = container.querySelector(
            'input[name="name"]',
        ) as HTMLInputElement;
        fireEvent.change(input, { target: { value: "" } });

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        await waitFor(() =>
            expect(container.querySelector(".error-name")).not.toBeNull(),
        );
        expect(screen.getByText("Name is required")).toBeInTheDocument();
        expect(api.create).not.toHaveBeenCalled();
    });

    it("prefills fields in edit mode and PATCH-saves on submit", async () => {
        const { container, api, onSaved } = setup({
            mode: "edit",
            sprint: editSprint,
        });
        const input = container.querySelector(
            'input[name="name"]',
        ) as HTMLInputElement;
        expect(input.value).toBe("Sprint 1");

        fireEvent.change(input, { target: { value: "Sprint 1 edited" } });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
        expect(api.save).toHaveBeenCalledWith(
            "milestones",
            expect.objectContaining({ id: 42, name: "Sprint 1 edited" }),
            expect.objectContaining({ name: "Sprint 1 edited" }),
            true,
        );
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    });

    it("defaults create dates from the last sprint finish (+14 days)", () => {
        const lastSprint: Milestone = {
            id: 5,
            name: "Prev",
            estimated_finish: "2024-03-01",
        };
        const { container } = setup({ mode: "create", lastSprint });
        expect(
            (
                container.querySelector(
                    'input[name="estimated_start"]',
                ) as HTMLInputElement
            ).value,
        ).toBe("2024-03-01");
        expect(
            (
                container.querySelector(
                    'input[name="estimated_finish"]',
                ) as HTMLInputElement
            ).value,
        ).toBe("2024-03-15");
    });

    it("defaults the create start date to today when there is no last sprint", () => {
        const { container } = setup({ mode: "create", lastSprint: null });
        const start = (
            container.querySelector(
                'input[name="estimated_start"]',
            ) as HTMLInputElement
        ).value;
        expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("deletes the sprint after confirmation in edit mode", async () => {
        const confirmSpy = jest
            .spyOn(window, "confirm")
            .mockReturnValue(true);
        const { container, api, onDeleted } = setup({
            mode: "edit",
            sprint: editSprint,
            project,
        });
        const del = container.querySelector(".delete-sprint") as HTMLButtonElement;
        expect(del).not.toBeNull();

        fireEvent.click(del);
        expect(confirmSpy).toHaveBeenCalledWith(
            "Do you want to delete this sprint?",
        );
        await waitFor(() =>
            expect(api.remove).toHaveBeenCalledWith("milestones", 42),
        );
        await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    });

    it("does not delete when the confirmation is declined", () => {
        jest.spyOn(window, "confirm").mockReturnValue(false);
        const { container, api, onDeleted } = setup({
            mode: "edit",
            sprint: editSprint,
        });
        fireEvent.click(container.querySelector(".delete-sprint") as HTMLButtonElement);
        expect(api.remove).not.toHaveBeenCalled();
        expect(onDeleted).not.toHaveBeenCalled();
    });

    it("hides the delete button without the delete_milestone permission", () => {
        const { container } = setup({
            mode: "edit",
            sprint: editSprint,
            project: projectNoDelete,
        });
        expect(container.querySelector(".delete-sprint")).toBeNull();
    });

    it("hides the delete button in create mode even with permission", () => {
        const { container } = setup({ mode: "create", project });
        expect(container.querySelector(".delete-sprint")).toBeNull();
    });

    it("calls onClose when the close control is clicked", () => {
        const { container, onClose } = setup();
        fireEvent.click(container.querySelector("a.close") as HTMLAnchorElement);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("includes changed dates in the edit PATCH payload", async () => {
        const { container, api } = setup({ mode: "edit", sprint: editSprint });
        fireEvent.change(
            container.querySelector(
                'input[name="estimated_start"]',
            ) as HTMLInputElement,
            { target: { value: "2024-02-01" } },
        );
        fireEvent.change(
            container.querySelector(
                'input[name="estimated_finish"]',
            ) as HTMLInputElement,
            { target: { value: "2024-02-15" } },
        );
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
        expect(api.save).toHaveBeenCalledWith(
            "milestones",
            expect.objectContaining({
                id: 42,
                estimated_start: "2024-02-01",
                estimated_finish: "2024-02-15",
            }),
            expect.objectContaining({
                estimated_start: "2024-02-01",
                estimated_finish: "2024-02-15",
            }),
            true,
        );
    });

    it("shows a date-order error and blocks submit when finish precedes start", async () => {
        const { container, api } = setup({ mode: "create" });
        fireEvent.change(
            container.querySelector('input[name="name"]') as HTMLInputElement,
            { target: { value: "Valid Name" } },
        );
        fireEvent.change(
            container.querySelector(
                'input[name="estimated_start"]',
            ) as HTMLInputElement,
            { target: { value: "2024-05-10" } },
        );
        fireEvent.change(
            container.querySelector(
                'input[name="estimated_finish"]',
            ) as HTMLInputElement,
            { target: { value: "2024-05-01" } },
        );
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        await waitFor(() =>
            expect(
                container.querySelector(".error-estimated-finish"),
            ).not.toBeNull(),
        );
        expect(api.create).not.toHaveBeenCalled();
    });
});
