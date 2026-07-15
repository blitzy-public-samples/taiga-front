/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the React `SprintEditLightbox`
 * (app/react/backlog/SprintEditLightbox.tsx).
 *
 * Runs in the browserless jsdom environment (jest.config.js). The milestones
 * API adapter is mocked so no network is touched; the pure `validate()` from
 * `../../shared/validation/sprintForm` runs for real (its exact messages are
 * imported here rather than duplicated, so any drift fails the test).
 *
 * Coverage focus (per the file's validation checklist):
 *  (a) empty name  -> required error shown, the create API is NOT called
 *  (b) inverted date range -> range error attaches to estimated_finish, no API
 *  (c) valid create -> `create` called with the exact writable payload
 *      (name trimmed), then `onChanged` + `onClose` fire
 *  (d) delete flow  -> native confirm accepted, `remove` called with the sprint
 *      id, then `onChanged` + `onClose` fire
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SprintEditLightbox } from "../SprintEditLightbox";
import type { SprintEditLightboxProps } from "../SprintEditLightbox";
import type { Project, Sprint } from "../types";
import type { SprintFormValues } from "../../shared/validation/sprintForm";
import {
    REQUIRED_MESSAGE,
    DATE_RANGE_MESSAGE,
    DATE_INVALID_MESSAGE,
} from "../../shared/validation/sprintForm";
import {
    create as createMilestone,
    save as saveMilestone,
    remove as removeMilestone,
} from "../../shared/api/milestones";
import { HttpError } from "../../shared/api/httpClient";

// Generic save-failure literal rendered by the component (COMMON.SAVE_ERROR).
// Kept as an independent literal (not imported from the SUT) so drift fails.
const GENERIC_SAVE_ERROR = "An error occurred while saving.";

// Mock the frozen-API adapter: create / save / remove become jest mocks so the
// component's persistence calls are captured without any real `fetch`.
jest.mock("../../shared/api/milestones", () => ({
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
}));

const createMock = jest.mocked(createMilestone);
const saveMock = jest.mocked(saveMilestone);
const removeMock = jest.mocked(removeMilestone);

/* -------------------------------------------------------------------------- */
/* Test data factories                                                        */
/* -------------------------------------------------------------------------- */

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 1,
        slug: "my-project",
        name: "My Project",
        my_permissions: ["view_milestones", "modify_milestone", "delete_milestone"],
        roles: [],
        points: [],
        us_statuses: [],
        is_backlog_activated: true,
        is_kanban_activated: true,
        default_us_status: 1,
        total_milestones: null,
        i_am_admin: true,
        ...overrides,
    };
}

function makeSprint(overrides: Partial<Sprint> = {}): Sprint {
    return {
        id: 10,
        name: "Sprint 1",
        slug: "sprint-1",
        project: 1,
        estimated_start: "2021-01-01",
        estimated_finish: "2021-01-15",
        closed: false,
        closed_points: 3,
        total_points: 6,
        user_stories: [],
        ...overrides,
    };
}

function makeValues(overrides: Partial<SprintFormValues> = {}): SprintFormValues {
    return {
        name: "Default Sprint",
        estimated_start: "2021-01-01",
        estimated_finish: "2021-01-15",
        project: 1,
        ...overrides,
    };
}

function renderLightbox(
    overrides: Partial<SprintEditLightboxProps> = {},
): ReturnType<typeof render> {
    const props: SprintEditLightboxProps = {
        open: true,
        mode: "create",
        project: makeProject(),
        sprint: null,
        initialValues: makeValues(),
        lastSprintName: null,
        canDelete: false,
        onChanged: jest.fn(),
        onClose: jest.fn(),
        ...overrides,
    };

    return render(<SprintEditLightbox {...props} />);
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("SprintEditLightbox — closed state", () => {
    it("renders nothing when open is false", () => {
        const { container } = renderLightbox({ open: false });

        expect(container.querySelector(".lightbox-sprint-add-edit")).toBeNull();
    });
});

describe("SprintEditLightbox — validation gates the API", () => {
    it("(a) shows the required error and does NOT call the API when the name is empty", () => {
        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({ name: "" }),
        });

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        // The required message is rendered (in the name field's error span)...
        expect(screen.getByText(REQUIRED_MESSAGE)).toBeInTheDocument();
        // ...and the create endpoint was never reached.
        expect(createMock).not.toHaveBeenCalled();
        expect(saveMock).not.toHaveBeenCalled();
    });

    it("(b) attaches the range error to estimated_finish for an inverted date range", () => {
        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({
                name: "Valid name",
                estimated_start: "2021-02-10",
                estimated_finish: "2021-02-01",
            }),
        });

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        const rangeError = screen.getByText(DATE_RANGE_MESSAGE);
        expect(rangeError).toBeInTheDocument();
        // The range error belongs to the finish (date-end) field, not the start.
        expect(container.querySelector(".date-end")?.parentElement).toContainElement(
            rangeError,
        );
        expect(createMock).not.toHaveBeenCalled();
    });
});

describe("SprintEditLightbox — persistence", () => {
    it("(c) creates the milestone with the exact writable payload, then bubbles onChanged + onClose", async () => {
        createMock.mockResolvedValue({
            data: { id: 99 },
            status: 201,
            headers: new Headers(),
        });
        const onChanged = jest.fn();
        const onClose = jest.fn();

        const { container } = renderLightbox({
            mode: "create",
            // Leading/trailing whitespace must be trimmed in the payload.
            initialValues: makeValues({
                name: "  Sprint 3  ",
                estimated_start: "2021-03-01",
                estimated_finish: "2021-03-15",
            }),
            onChanged,
            onClose,
        });

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

        expect(createMock).toHaveBeenCalledTimes(1);
        expect(createMock).toHaveBeenCalledWith({
            project: 1,
            name: "Sprint 3",
            estimated_start: "2021-03-01",
            estimated_finish: "2021-03-15",
        });
        expect(saveMock).not.toHaveBeenCalled();
        expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("edits via save() with the sprint id when in edit mode", async () => {
        saveMock.mockResolvedValue({
            data: { id: 10 },
            status: 200,
            headers: new Headers(),
        });
        const onChanged = jest.fn();
        const onClose = jest.fn();
        const sprint = makeSprint({ id: 10, name: "Renamed" });

        const { container } = renderLightbox({
            mode: "edit",
            sprint,
            canDelete: true,
            initialValues: makeValues({
                name: "Renamed",
                estimated_start: sprint.estimated_start,
                estimated_finish: sprint.estimated_finish,
            }),
            onChanged,
            onClose,
        });

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

        expect(saveMock).toHaveBeenCalledTimes(1);
        expect(saveMock).toHaveBeenCalledWith(10, {
            project: 1,
            name: "Renamed",
            estimated_start: "2021-01-01",
            estimated_finish: "2021-01-15",
        });
        expect(createMock).not.toHaveBeenCalled();
        expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("(d) deletes the milestone after a confirmed native confirm, then bubbles onChanged + onClose", async () => {
        removeMock.mockResolvedValue({
            data: null,
            status: 204,
            headers: new Headers(),
        });
        const confirmSpy = jest
            .spyOn(window, "confirm")
            .mockImplementation(() => true);
        const onChanged = jest.fn();
        const onClose = jest.fn();
        const sprint = makeSprint({ id: 10 });

        const { container } = renderLightbox({
            mode: "edit",
            sprint,
            canDelete: true,
            initialValues: makeValues({
                name: sprint.name,
                estimated_start: sprint.estimated_start,
                estimated_finish: sprint.estimated_finish,
            }),
            onChanged,
            onClose,
        });

        fireEvent.click(container.querySelector(".delete-sprint") as HTMLButtonElement);

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(removeMock).toHaveBeenCalledTimes(1);
        expect(removeMock).toHaveBeenCalledWith(10);
        expect(onChanged).toHaveBeenCalledTimes(1);

        confirmSpy.mockRestore();
    });

    it("does not delete when the native confirm is dismissed", () => {
        const confirmSpy = jest
            .spyOn(window, "confirm")
            .mockImplementation(() => false);
        const onChanged = jest.fn();
        const onClose = jest.fn();
        const sprint = makeSprint({ id: 10 });

        const { container } = renderLightbox({
            mode: "edit",
            sprint,
            canDelete: true,
            initialValues: makeValues(),
            onChanged,
            onClose,
        });

        fireEvent.click(container.querySelector(".delete-sprint") as HTMLButtonElement);

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(removeMock).not.toHaveBeenCalled();
        expect(onChanged).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();

        confirmSpy.mockRestore();
    });
});

describe("SprintEditLightbox — server error handling", () => {
    it("maps HttpError body field errors onto the form, shows the server message, and re-enables submit", async () => {
        createMock.mockRejectedValue(
            new HttpError(
                400,
                "Bad Request",
                { name: ["Name already taken"], _error_message: "Could not save sprint" },
                "http://x/api/v1/milestones",
            ),
        );

        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({ name: "Dup" }),
        });

        const submitButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        // Field error mapped from the server body (ports form.setErrors(data))...
        await waitFor(() => expect(screen.getByText("Name already taken")).toBeInTheDocument());
        // ...plus the generic server toast, and the submit button is re-enabled
        // (the `finally` cleared `submitting`).
        expect(screen.getByText("Could not save sprint")).toBeInTheDocument();
        expect(submitButton.disabled).toBe(false);
    });

    it("uses __all__[0] as the server message when no _error_message is present", async () => {
        createMock.mockRejectedValue(
            new HttpError(400, "Bad Request", { __all__: ["A global problem occurred"] }, "http://x"),
        );

        const { container } = renderLightbox({ mode: "create", initialValues: makeValues() });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        await waitFor(() =>
            expect(screen.getByText("A global problem occurred")).toBeInTheDocument(),
        );
    });

    it("falls back to the generic message for a non-HttpError failure", async () => {
        createMock.mockRejectedValue(new Error("network down"));

        const { container } = renderLightbox({ mode: "create", initialValues: makeValues() });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        await waitFor(() => expect(screen.getByText(GENERIC_SAVE_ERROR)).toBeInTheDocument());
    });
});

describe("SprintEditLightbox — controlled inputs & date normalization", () => {
    it("updates the three editable inputs on change", () => {
        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({ name: "" }),
        });

        const nameInput = container.querySelector(".sprint-name") as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: "Typed sprint" } });
        expect(nameInput.value).toBe("Typed sprint");

        const startInput = container.querySelector(".date-start") as HTMLInputElement;
        fireEvent.change(startInput, { target: { value: "2022-05-01" } });
        expect(startInput.value).toBe("2022-05-01");

        const finishInput = container.querySelector(".date-end") as HTMLInputElement;
        fireEvent.change(finishInput, { target: { value: "2022-05-20" } });
        expect(finishInput.value).toBe("2022-05-20");
    });

    it("reports required errors for both blank dates and focuses the start field", () => {
        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({ name: "Ok", estimated_start: "", estimated_finish: "" }),
        });

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        expect(screen.getAllByText(REQUIRED_MESSAGE)).toHaveLength(2);
        expect(document.activeElement).toBe(container.querySelector(".date-start"));
        expect(createMock).not.toHaveBeenCalled();
    });

    it("focuses the finish field when only the finish date is missing", () => {
        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({
                name: "Ok",
                estimated_start: "2022-01-01",
                estimated_finish: "",
            }),
        });

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        expect(document.activeElement).toBe(container.querySelector(".date-end"));
        expect(createMock).not.toHaveBeenCalled();
    });

    it("passes an unparseable date through so validate reports it (no API call)", () => {
        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({
                name: "Ok",
                estimated_start: "2022-13-45",
                estimated_finish: "2022-01-15",
            }),
        });

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);

        expect(screen.getByText(DATE_INVALID_MESSAGE)).toBeInTheDocument();
        expect(createMock).not.toHaveBeenCalled();
    });
});

describe("SprintEditLightbox — DOM fidelity", () => {
    it("renders the exact lightbox class names and the create title", () => {
        const { container } = renderLightbox({ mode: "create" });

        expect(container.querySelector(".lightbox.lightbox-sprint-add-edit")).not.toBeNull();
        expect(container.querySelector(".sprint-name.e2e-sprint-name")).not.toBeNull();
        expect(container.querySelector(".dates .date-start")).not.toBeNull();
        expect(container.querySelector(".dates .date-end")).not.toBeNull();
        expect(
            container.querySelector(".sprint-add-edit-actions .btn-big.button-large.button-block"),
        ).not.toBeNull();
        expect(screen.getByText("New sprint")).toBeInTheDocument();
    });

    it("hides the delete control unless in edit mode with delete permission", () => {
        const { container, rerender } = renderLightbox({ mode: "create", canDelete: true });
        // create mode: never shown
        expect(container.querySelector(".delete-sprint")).toBeNull();

        // edit mode without permission: hidden
        rerender(
            <SprintEditLightbox
                open
                mode="edit"
                project={makeProject()}
                sprint={makeSprint()}
                initialValues={makeValues()}
                lastSprintName={null}
                canDelete={false}
                onChanged={jest.fn()}
                onClose={jest.fn()}
            />,
        );
        expect(container.querySelector(".delete-sprint")).toBeNull();

        // edit mode with permission: shown
        rerender(
            <SprintEditLightbox
                open
                mode="edit"
                project={makeProject()}
                sprint={makeSprint()}
                initialValues={makeValues()}
                lastSprintName={null}
                canDelete
                onChanged={jest.fn()}
                onClose={jest.fn()}
            />,
        );
        expect(container.querySelector(".delete-sprint")).not.toBeNull();
    });

    it("shows the last-sprint hint only on create when a name is provided", () => {
        renderLightbox({ mode: "create", lastSprintName: "Sprint Zero" });

        // The hint reproduces the exact legacy i18n string
        // ("last sprint is <strong> {{lastSprint}} ;-) </strong>"), so the name
        // is embedded (with a ";-)" suffix) inside the <strong> element.
        expect(screen.getByText(/last sprint is/)).toBeInTheDocument();
        expect(screen.getByText(/Sprint Zero/)).toBeInTheDocument();
    });
});
