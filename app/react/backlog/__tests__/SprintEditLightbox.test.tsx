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
 * Runs in the browserless jsdom environment (jest.config.js). Only the frozen
 * milestones API adapter is mocked, so no network is ever touched; the pure
 * `validate()` from `../../shared/validation/sprintForm` and the real
 * `HttpError` from `../../shared/api/httpClient` run UNMOCKED. Message constants
 * are imported from the validation module (rather than duplicated) so any drift
 * in the shared copy fails the test.
 *
 * Coverage focus (the file's validation checklist + the component's ported
 * `tgLbCreateEditSprint` behavior, lightboxes.coffee L237):
 *  - closed              -> nothing (no form / `.sprint-name`) is rendered
 *  - empty name          -> required error shown, the create API is NOT called
 *  - inverted range      -> range error attaches to `.date-end`, no API call
 *  - equal start/finish  -> treated as VALID, `create` IS called
 *  - valid create        -> `create` called with the exact writable payload
 *                           (name trimmed, dates normalized), then
 *                           `onChanged` + `onClose` fire
 *  - valid edit          -> `save(sprint.id, payload)`, then bubbles
 *  - server field errors -> `HttpError.body` mapped onto the form without a
 *                           crash and WITHOUT firing `onChanged`
 *  - delete flow         -> gated by edit + `canDelete`; native confirm accepted
 *                           -> `remove(sprint.id)`, then bubbles
 *  - double submit       -> the submit button is disabled while a request is in
 *                           flight, so the API is hit exactly once
 */

// Mock ONLY the frozen milestones API adapter. Declared at the very top (after
// the AGPL header, before the module imports) so ts-jest hoists it above them:
// create / save / remove become jest mocks and no real `fetch` is ever issued.
jest.mock("../../shared/api/milestones", () => ({
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
}));

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

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
import type { HttpResponse } from "../../shared/api/httpClient";

// Strongly-typed handles onto the mocked adapter functions. `jest.mocked`
// preserves the original signatures so `mockResolvedValue` / `mockRejectedValue`
// stay type-checked against the real `HttpResponse<Milestone>` contract.
const createMock = jest.mocked(createMilestone);
const saveMock = jest.mocked(saveMilestone);
const removeMock = jest.mocked(removeMilestone);

// Generic save-failure literal rendered by the component (COMMON.SAVE_ERROR).
// Held as an INDEPENDENT literal (not imported from the SUT) so that a drift in
// the component's fallback copy is caught here rather than silently mirrored.
const GENERIC_SAVE_ERROR = "An error occurred while saving.";

/* -------------------------------------------------------------------------- */
/* Test helpers & data factories                                              */
/* -------------------------------------------------------------------------- */

/** Build a resolved `HttpResponse<T>` matching the real adapter return shape. */
function ok<T>(data: T): HttpResponse<T> {
    return { data, status: 200, headers: new Headers() };
}

/** A minimal but schema-complete {@link Project} fixture. */
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

/** A minimal but schema-complete {@link Sprint} fixture (id defaults to 10). */
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

/** Seed values for the controlled sprint form. */
function makeValues(overrides: Partial<SprintFormValues> = {}): SprintFormValues {
    return {
        name: "Default Sprint",
        estimated_start: "2021-01-01",
        estimated_finish: "2021-01-15",
        project: 1,
        ...overrides,
    };
}

/**
 * Render the lightbox with sensible defaults. The `onChanged` / `onClose`
 * spies are created here and wired in AFTER the caller overrides (so they can
 * never be shadowed), then returned so assertions can inspect them.
 */
function renderLightbox(
    overrides: Partial<SprintEditLightboxProps> = {},
): ReturnType<typeof render> & { onChanged: jest.Mock; onClose: jest.Mock } {
    const onChanged = jest.fn();
    const onClose = jest.fn();

    const props: SprintEditLightboxProps = {
        open: true,
        mode: "create",
        project: makeProject(),
        sprint: null,
        initialValues: makeValues(),
        lastSprintName: null,
        canDelete: false,
        ...overrides,
        // Wired last so an accidental override cannot detach the returned spies.
        onChanged,
        onClose,
    };

    const utils = render(<SprintEditLightbox {...props} />);

    return { ...utils, onChanged, onClose };
}

/** Convenience: fetch the single <form> element rendered by the lightbox. */
function getForm(container: HTMLElement): HTMLFormElement {
    return container.querySelector("form") as HTMLFormElement;
}

/* -------------------------------------------------------------------------- */
/* Shared setup — override `window.confirm` (jsdom's default returns false and  */
/* logs "Not implemented"); restore the original after every test.             */
/* -------------------------------------------------------------------------- */

let originalConfirm: typeof window.confirm;

beforeEach(() => {
    originalConfirm = window.confirm;
    window.confirm = jest.fn(() => true);
});

afterEach(() => {
    window.confirm = originalConfirm;
});

/* -------------------------------------------------------------------------- */
/* Closed state                                                               */
/* -------------------------------------------------------------------------- */

describe("SprintEditLightbox — closed state", () => {
    it("renders no form (nor the .sprint-name input) when open is false", () => {
        const { container } = renderLightbox({ open: false });

        expect(container.querySelector(".lightbox-sprint-add-edit")).toBeNull();
        expect(container.querySelector(".sprint-name")).toBeNull();
        expect(container.querySelector("form")).toBeNull();
    });
});

describe("SprintEditLightbox — open state reveal [#3]", () => {
    // The `.lightbox` SCSS mixin's base is `display:none` and it is revealed ONLY
    // by the `.open` class. When open, the rendered root must carry that class so
    // the compiled CSS makes it visible.
    it("renders the `.lightbox.lightbox-sprint-add-edit` root WITH the `open` class when open", () => {
        const { container } = renderLightbox({ open: true });

        const root = container.querySelector(".lightbox.lightbox-sprint-add-edit");
        expect(root).not.toBeNull();
        expect(root).toHaveClass("open");
    });

    // [M-09] Modal-dialog accessibility via the shared useDialogA11y primitive.
    it("exposes role=dialog + aria-modal with aria-labelledby wired to the title", () => {
        const { container } = renderLightbox({ open: true });
        const dialog = container.querySelector(
            ".lightbox.lightbox-sprint-add-edit",
        ) as HTMLElement;
        expect(dialog).toHaveAttribute("role", "dialog");
        expect(dialog).toHaveAttribute("aria-modal", "true");
        const labelledby = dialog.getAttribute("aria-labelledby");
        expect(labelledby).toBeTruthy();
        const title = container.querySelector("h2.title") as HTMLElement;
        expect(title.id).toBe(labelledby);
        expect((title.textContent ?? "").trim().length).toBeGreaterThan(0);
    });
});

/* -------------------------------------------------------------------------- */
/* Escape-to-close [#7]                                                        */
/* -------------------------------------------------------------------------- */

describe("SprintEditLightbox — Escape-to-close [#7]", () => {
    it("closes on Escape when open", () => {
        const { onClose } = renderLightbox({ open: true });

        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("ignores Escape while closed", () => {
        const { onClose } = renderLightbox({ open: false });

        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).not.toHaveBeenCalled();
    });

    it("defers Escape to the nested delete-confirm dialog while it is open", () => {
        // When the themed delete-confirm is showing, a single Escape must dismiss
        // ONLY that dialog (via its own handler) — never the whole lightbox — so
        // the two layers can't collapse at once. The lightbox handler is gated on
        // `!deleteConfirmOpen`, and the confirm's Escape == Cancel (no delete).
        const { container, onChanged, onClose } = renderLightbox({
            mode: "edit",
            sprint: makeSprint({ id: 42 }),
            canDelete: true,
        });

        fireEvent.click(container.querySelector(".delete-sprint") as HTMLElement);
        expect(document.querySelector(".lightbox-generic-delete.open")).not.toBeNull();

        fireEvent.keyDown(document, { key: "Escape" });

        // The confirm dialog closed; the lightbox stayed open; nothing deleted.
        expect(document.querySelector(".lightbox-generic-delete.open")).toBeNull();
        expect(removeMock).not.toHaveBeenCalled();
        expect(onChanged).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});

/* -------------------------------------------------------------------------- */
/* Validation gates the API                                                   */
/* -------------------------------------------------------------------------- */

describe("SprintEditLightbox — validation gates the API", () => {
    it("shows the required-name error and does NOT call the API when the name is empty", () => {
        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({ name: "" }),
        });

        fireEvent.submit(getForm(container));

        // The required message is rendered (in the name field's error span)...
        expect(screen.getByText(REQUIRED_MESSAGE)).toBeInTheDocument();
        // ...and neither persistence endpoint was reached.
        expect(createMock).not.toHaveBeenCalled();
        expect(saveMock).not.toHaveBeenCalled();
    });

    it("attaches the date-range error to the finish field for an inverted range and does not call create", () => {
        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({
                name: "Valid name",
                estimated_start: "2021-02-10",
                estimated_finish: "2021-02-01",
            }),
        });

        fireEvent.submit(getForm(container));

        const rangeError = screen.getByText(DATE_RANGE_MESSAGE);
        expect(rangeError).toBeInTheDocument();
        // The range error belongs to the finish (`.date-end`) field, not the start.
        expect(container.querySelector(".date-end")?.parentElement).toContainElement(
            rangeError,
        );
        expect(createMock).not.toHaveBeenCalled();
    });

    it("treats equal start/finish dates as VALID and calls create", async () => {
        createMock.mockResolvedValue(ok(makeSprint({ id: 99 })));

        const { container, onChanged } = renderLightbox({
            mode: "create",
            initialValues: makeValues({
                name: "Valid",
                estimated_start: "2021-02-01",
                estimated_finish: "2021-02-01",
            }),
        });

        fireEvent.submit(getForm(container));

        await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    });

    it("reports required errors for both blank dates and focuses the start field", () => {
        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({ name: "Ok", estimated_start: "", estimated_finish: "" }),
        });

        fireEvent.submit(getForm(container));

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

        fireEvent.submit(getForm(container));

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

        fireEvent.submit(getForm(container));

        expect(screen.getByText(DATE_INVALID_MESSAGE)).toBeInTheDocument();
        expect(createMock).not.toHaveBeenCalled();
    });
});

/* -------------------------------------------------------------------------- */
/* Persistence (create / edit)                                                */
/* -------------------------------------------------------------------------- */

describe("SprintEditLightbox — persistence", () => {
    it("creates the milestone with the exact writable payload (trimmed name, normalized dates), then fires onChanged + onClose", async () => {
        createMock.mockResolvedValue(ok(makeSprint({ id: 99 })));

        const { container, onChanged, onClose } = renderLightbox({
            mode: "create",
            // Leading/trailing whitespace must be trimmed in the payload.
            initialValues: makeValues({
                name: "  My Sprint  ",
                estimated_start: "2021-03-01",
                estimated_finish: "2021-03-15",
            }),
        });

        fireEvent.submit(getForm(container));

        await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
        expect(createMock).toHaveBeenCalledWith(
            expect.objectContaining({
                project: 1,
                name: "My Sprint",
                estimated_start: "2021-03-01",
                estimated_finish: "2021-03-15",
            }),
        );
        expect(saveMock).not.toHaveBeenCalled();

        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("edits via save(sprint.id, payload) in edit mode, then fires onChanged + onClose", async () => {
        saveMock.mockResolvedValue(ok(makeSprint({ id: 42, name: "New Name" })));

        const { container, onChanged, onClose } = renderLightbox({
            mode: "edit",
            sprint: makeSprint({ id: 42, name: "Old" }),
            canDelete: true,
            initialValues: makeValues({
                name: "New Name",
                estimated_start: "2021-04-01",
                estimated_finish: "2021-04-15",
            }),
        });

        fireEvent.submit(getForm(container));

        await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
        expect(saveMock).toHaveBeenCalledWith(
            42,
            expect.objectContaining({
                project: 1,
                name: "New Name",
                estimated_start: "2021-04-01",
                estimated_finish: "2021-04-15",
            }),
        );
        expect(createMock).not.toHaveBeenCalled();

        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

/* -------------------------------------------------------------------------- */
/* Server-error handling                                                      */
/* -------------------------------------------------------------------------- */

describe("SprintEditLightbox — server error handling", () => {
    it("maps HttpError body field errors onto the form without crashing and does NOT fire onChanged", async () => {
        createMock.mockRejectedValue(
            new HttpError(
                400,
                "Bad Request",
                { name: ["Server says bad name"] },
                "http://x/milestones",
            ),
        );

        const { container, onChanged } = renderLightbox({
            mode: "create",
            initialValues: makeValues({ name: "Valid" }),
        });

        const submitButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
        fireEvent.submit(getForm(container));

        // The server field message is surfaced on the form...
        await waitFor(() => expect(container.textContent).toContain("Server says bad name"));
        // ...the failed request never counts as a change...
        expect(onChanged).not.toHaveBeenCalled();
        // ...and the submit button is re-enabled (the `finally` cleared submitting).
        expect(submitButton.disabled).toBe(false);
    });

    it("uses __all__[0] as the server message when no _error_message is present", async () => {
        createMock.mockRejectedValue(
            new HttpError(400, "Bad Request", { __all__: ["A global problem occurred"] }, "http://x"),
        );

        const { container } = renderLightbox({ mode: "create", initialValues: makeValues() });

        fireEvent.submit(getForm(container));

        await waitFor(() =>
            expect(screen.getByText("A global problem occurred")).toBeInTheDocument(),
        );
    });

    it("falls back to the generic save message for a non-HttpError failure", async () => {
        createMock.mockRejectedValue(new Error("network down"));

        const { container, onChanged } = renderLightbox({
            mode: "create",
            initialValues: makeValues(),
        });

        fireEvent.submit(getForm(container));

        await waitFor(() => expect(screen.getByText(GENERIC_SAVE_ERROR)).toBeInTheDocument());
        expect(onChanged).not.toHaveBeenCalled();
    });
});

/* -------------------------------------------------------------------------- */
/* Delete flow                                                                */
/* -------------------------------------------------------------------------- */

describe("SprintEditLightbox — delete flow", () => {
    it("does not render the delete button in create mode or when canDelete is false", () => {
        // create mode, even with canDelete=true → never shown
        const { container: createC } = renderLightbox({ mode: "create", canDelete: true });
        expect(createC.querySelector(".delete-sprint")).toBeNull();

        // edit mode without permission → hidden
        const { container: noPermC } = renderLightbox({
            mode: "edit",
            sprint: makeSprint({ id: 7 }),
            canDelete: false,
        });
        expect(noPermC.querySelector(".delete-sprint")).toBeNull();
    });

    it("renders the delete button only in edit mode with canDelete", () => {
        const { container } = renderLightbox({
            mode: "edit",
            sprint: makeSprint({ id: 7 }),
            canDelete: true,
        });

        expect(container.querySelector(".delete-sprint")).not.toBeNull();
    });

    it("deletes via remove(sprint.id) after confirming the themed dialog, then fires onChanged + onClose", async () => {
        // [H] Delete confirmation is the themed ConfirmDialog (.lightbox-generic-delete),
        // NOT the native window.confirm. Clicking the delete button OPENS the dialog;
        // deletion only runs after the dialog's confirm (.js-confirm) button is clicked.
        removeMock.mockResolvedValue(ok<unknown>({}));

        const { container, onChanged, onClose } = renderLightbox({
            mode: "edit",
            sprint: makeSprint({ id: 42 }),
            canDelete: true,
            initialValues: makeValues({
                name: "Sprint",
                estimated_start: "2021-04-01",
                estimated_finish: "2021-04-15",
            }),
        });

        const del = container.querySelector(".delete-sprint") as HTMLElement | null;
        expect(del).not.toBeNull();

        // Open the confirm dialog — no removal yet.
        fireEvent.click(del as HTMLElement);
        const dialog = document.querySelector(".lightbox-generic-delete.open");
        expect(dialog).not.toBeNull();
        expect(removeMock).not.toHaveBeenCalled();

        // Confirm the deletion.
        fireEvent.click(dialog!.querySelector(".js-confirm") as HTMLElement);

        await waitFor(() => expect(removeMock).toHaveBeenCalledWith(42));
        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not delete when the themed confirm dialog is cancelled", () => {
        // [H] Cancelling the ConfirmDialog (.js-cancel) dismisses it without deleting.
        const { container, onChanged, onClose } = renderLightbox({
            mode: "edit",
            sprint: makeSprint({ id: 42 }),
            canDelete: true,
        });

        // Open the confirm dialog.
        fireEvent.click(container.querySelector(".delete-sprint") as HTMLElement);
        const dialog = document.querySelector(".lightbox-generic-delete.open");
        expect(dialog).not.toBeNull();

        // Cancel it — dialog closes, nothing deleted.
        fireEvent.click(dialog!.querySelector(".js-cancel") as HTMLElement);

        expect(document.querySelector(".lightbox-generic-delete.open")).toBeNull();
        expect(removeMock).not.toHaveBeenCalled();
        expect(onChanged).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});

/* -------------------------------------------------------------------------- */
/* Double-submit guard                                                        */
/* -------------------------------------------------------------------------- */

describe("SprintEditLightbox — double-submit guard", () => {
    it("disables the submit button while a request is in flight so the API is hit exactly once", () => {
        // A create that never settles keeps the component in the `submitting`
        // state, so the submit button stays disabled after the first submit.
        createMock.mockReturnValue(new Promise<never>(() => { /* never resolves */ }));

        const { container } = renderLightbox({
            mode: "create",
            initialValues: makeValues({
                name: "Valid",
                estimated_start: "2021-03-01",
                estimated_finish: "2021-03-15",
            }),
        });

        fireEvent.submit(getForm(container));

        const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
        expect(submitBtn).toBeDisabled();
        expect(createMock).toHaveBeenCalledTimes(1);
    });
});

/* -------------------------------------------------------------------------- */
/* DOM fidelity & controlled inputs                                           */
/* -------------------------------------------------------------------------- */

describe("SprintEditLightbox — DOM fidelity & controlled inputs", () => {
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

    it("shows the last-sprint hint only on create when a name is provided", () => {
        renderLightbox({ mode: "create", lastSprintName: "Sprint Zero" });

        // Reproduces the legacy i18n string
        // ("last sprint is <strong> {{lastSprint}} ;-) </strong>").
        expect(screen.getByText(/last sprint is/)).toBeInTheDocument();
        expect(screen.getByText(/Sprint Zero/)).toBeInTheDocument();
    });
});
