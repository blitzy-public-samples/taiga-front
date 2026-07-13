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
 * It delegates the modal LIFECYCLE (`.open` visibility, `role="dialog"`,
 * `aria-modal`, focus capture/restore, Escape, focus-trap, the `.close` control)
 * to the shared `Lightbox` shell, and owns the sprint FORM + submit/delete flows.
 *
 * These tests assert the AUTHORITATIVE contract recovered from the legacy source
 * (findings M3, M2, M7):
 *   - `.open`-driven visibility (NOT an inline `display`), `role="dialog"`,
 *     `aria-modal`, `aria-labelledby` -> the title; the host is ALWAYS mounted
 *     but the form renders only while open.
 *   - Title "New sprint" (create) / "Edit Sprint" (edit) — the legacy
 *     `$el.find(".title").text(...)` override; submit label "Save" in both modes.
 *   - CREATE default dates (last-sprint finish / today, +14 days); EDIT prefill;
 *     the i18n last-sprint hint; `delete_milestone` gating.
 *   - Validation matches the legacy checksley EXACTLY: name required + maxlength
 *     500, both dates required, and NO `finish >= start` rule (a finish before a
 *     start is accepted client-side).
 *   - SINGLE success path: create/edit success calls ONLY `onSaved`; delete
 *     success calls ONLY `onDeleted`; `onClose` is reserved for user cancel
 *     (Escape / the close control). This is the legacy-absent "double close" that
 *     M3 flags.
 *   - Error handling (M2): every mutation is awaited inside try/catch; a failure
 *     surfaces a sanitized `role="alert"` message, preserves entered values,
 *     keeps the modal open, and re-enables controls for retry. Controls are
 *     disabled while a request is in flight.
 *   - Delete confirmation is an in-dialog step (no `window.confirm`).
 *
 * Conventions: automatic JSX runtime (no `import React`); `ts-jest` + `jsdom`;
 * `import type` for type-only imports. The {@link ApiClient} is stubbed with
 * `jest.fn()` spies for the three methods used (`create`, `save`, `remove`);
 * `ApiError`/`sanitizeErrorMessage` come from the REAL api barrel so the M2
 * sanitized surface is exercised end-to-end.
 */

import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { CreateEditSprint } from "./CreateEditSprint";
import type { CreateEditSprintProps } from "./CreateEditSprint";
import { ApiError } from "../../shared/api";
import type { ApiClient } from "../../shared/api";
import type { Milestone, Project } from "../../shared/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a {@link Project} carrying the given permission set. */
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

/** Build a {@link Milestone} (sprint), layering `overrides` over defaults. */
function makeSprint(overrides: Partial<Milestone> = {}): Milestone {
    return {
        id: 7,
        name: "Sprint 7",
        estimated_start: "2025-01-01",
        estimated_finish: "2025-01-14",
        ...overrides,
    };
}

/** A deferred promise (manual resolve/reject) for pending-state assertions. */
interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** The spy bundle returned by {@link setup}. */
interface Harness {
    props: CreateEditSprintProps;
    createMock: jest.Mock;
    saveMock: jest.Mock;
    removeMock: jest.Mock;
    onClose: jest.Mock;
    onSaved: jest.Mock;
    onDeleted: jest.Mock;
}

/** Build complete props with fresh spies, layering `overrides` over defaults. */
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

// --- query helpers ---------------------------------------------------------

const root = (c: HTMLElement): HTMLElement =>
    c.querySelector("div[tg-lb-create-edit-sprint]") as HTMLElement;
const nameInput = (c: HTMLElement): HTMLInputElement =>
    c.querySelector('input[name="name"]') as HTMLInputElement;
const startInput = (c: HTMLElement): HTMLInputElement =>
    c.querySelector('input[name="estimated_start"]') as HTMLInputElement;
const finishInput = (c: HTMLElement): HTMLInputElement =>
    c.querySelector('input[name="estimated_finish"]') as HTMLInputElement;
const formEl = (c: HTMLElement): HTMLFormElement =>
    c.querySelector("form") as HTMLFormElement;
const submitBtn = (c: HTMLElement): HTMLButtonElement =>
    c.querySelector('button[type="submit"]') as HTMLButtonElement;
const errorAlert = (c: HTMLElement): HTMLElement | null =>
    c.querySelector('.sprint-lightbox-error[role="alert"]');

afterEach(() => {
    jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Lifecycle / visibility (M3)
// ---------------------------------------------------------------------------

describe("CreateEditSprint — lifecycle & visibility", () => {
    it("mounts the host always, but is not `.open` and has no form when closed", () => {
        const { props } = setup({ open: false });
        const { container } = render(<CreateEditSprint {...props} />);

        const host = root(container);
        expect(host).not.toBeNull();
        expect(host.classList.contains("lightbox")).toBe(true);
        expect(host.classList.contains("lightbox-sprint-add-edit")).toBe(true);
        // Closed => no `.open` class (SCSS keeps it at opacity:0) and no content.
        expect(host.classList.contains("open")).toBe(false);
        expect(host.getAttribute("aria-hidden")).toBe("true");
        expect(container.querySelector("form")).toBeNull();
    });

    it("reveals via the `.open` class (never an inline display) when open", () => {
        const { props } = setup();
        const { container } = render(<CreateEditSprint {...props} />);

        const host = root(container);
        expect(host.classList.contains("open")).toBe(true);
        // No inline `display` toggling — visibility is class-driven (C2/M3).
        expect(host.style.display).toBe("");
        expect(host.getAttribute("aria-hidden")).toBeNull();
    });

    it("exposes dialog semantics (role, aria-modal, labelled by the title)", () => {
        const { props } = setup();
        const { container } = render(<CreateEditSprint {...props} />);

        const host = root(container);
        expect(host.getAttribute("role")).toBe("dialog");
        expect(host.getAttribute("aria-modal")).toBe("true");
        const labelledBy = host.getAttribute("aria-labelledby");
        expect(labelledBy).toBeTruthy();
        const title = container.querySelector("h2.title");
        expect(title?.id).toBe(labelledBy);
    });

    it("moves focus to the sprint-name field on open", () => {
        const { props } = setup();
        const { container } = render(<CreateEditSprint {...props} />);
        expect(document.activeElement).toBe(nameInput(container));
    });

    it("emits the DOM the SCSS/e2e depend on (classes, maxLength, date inputs)", () => {
        const { props } = setup();
        const { container } = render(<CreateEditSprint {...props} />);

        const name = nameInput(container);
        expect(name.classList.contains("sprint-name")).toBe(true);
        expect(name.classList.contains("e2e-sprint-name")).toBe(true);
        expect(name.maxLength).toBe(500);

        // Native date pickers keep the `.date-start` / `.date-end` hooks.
        expect(startInput(container).type).toBe("date");
        expect(startInput(container).classList.contains("date-start")).toBe(true);
        expect(finishInput(container).type).toBe("date");
        expect(finishInput(container).classList.contains("date-end")).toBe(true);
        expect(submitBtn(container)).not.toBeNull();
    });

    it("closes on Escape and on the close control (never on success)", () => {
        const { props, onClose } = setup();
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.keyDown(root(container), { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.click(container.querySelector("a.close") as HTMLAnchorElement);
        expect(onClose).toHaveBeenCalledTimes(2);
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

    it('labels the submit button "Save"', () => {
        const { props } = setup({ mode: "create" });
        const { container } = render(<CreateEditSprint {...props} />);
        expect(submitBtn(container).textContent).toBe("Save");
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
        const expected = new Date(Date.parse(start));
        expected.setUTCDate(expected.getUTCDate() + 14);
        expect(finishInput(container).value).toBe(expected.toISOString().slice(0, 10));
    });

    it("shows the localized last-sprint hint while the name is empty", () => {
        const lastSprint = makeSprint({ id: 3, name: "Sprint 3" });
        const { props } = setup({ mode: "create", lastSprint });
        const { container } = render(<CreateEditSprint {...props} />);

        const label = container.querySelector("label.last-sprint-name");
        expect(label).not.toBeNull();
        expect(label?.classList.contains("disappear")).toBe(false);
        // From the LAST_SPRINT_NAME template ("last sprint is <strong>{{lastSprint}}</strong> ;-)"),
        // stripped of tags, with the name rendered as an escaped React child.
        expect(label?.textContent).toContain("Sprint 3");
        expect(label?.querySelector("strong")?.textContent).toBe("Sprint 3");
    });

    it("hides the last-sprint hint once a name is typed", () => {
        const lastSprint = makeSprint({ id: 3, name: "Sprint 3" });
        const { props } = setup({ mode: "create", lastSprint });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "My sprint" } });
        const label = container.querySelector("label.last-sprint-name");
        expect(label?.classList.contains("disappear")).toBe(true);
    });

    it("creates via the milestones endpoint then calls ONLY onSaved (single close path)", async () => {
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
        // The hook's onSaved already closes; the modal must NOT also call onClose.
        expect(onClose).not.toHaveBeenCalled();
    });

    it("guards against a double submit while the create is in flight", async () => {
        const { props, createMock, onSaved } = setup({ mode: "create", lastSprint: null });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "Once only" } });
        fireEvent.change(startInput(container), { target: { value: "2025-07-01" } });
        fireEvent.change(finishInput(container), { target: { value: "2025-07-15" } });

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
    it('prefills the fields and shows the "Edit Sprint" title', () => {
        const sprint = makeSprint();
        const { props } = setup({ mode: "edit", sprint });
        const { container } = render(<CreateEditSprint {...props} />);

        // Legacy `$el.find(".title").text("Edit Sprint")` — NOT the sprint name.
        expect(container.querySelector("h2.title")?.textContent).toBe("Edit Sprint");
        expect(nameInput(container).value).toBe("Sprint 7");
        expect(startInput(container).value).toBe("2025-01-01");
        expect(finishInput(container).value).toBe("2025-01-14");
    });

    it("renders the delete button (with legacy text/title) when the user has delete_milestone", () => {
        const sprint = makeSprint();
        const { props } = setup({
            mode: "edit",
            sprint,
            project: makeProject(["delete_milestone"]),
        });
        const { container } = render(<CreateEditSprint {...props} />);

        const del = container.querySelector("button.btn-link.delete-sprint") as HTMLButtonElement;
        expect(del).not.toBeNull();
        expect(del.getAttribute("title")).toBe("delete sprint");
        expect(del.querySelector("svg.icon-trash use")?.getAttribute("xlink:href")).toBe("#icon-trash");
        // Legacy `.delete-sprint-text` renders ACTION_DELETE_SPRINT verbatim.
        expect(container.querySelector(".delete-sprint-text")?.textContent).toBe(
            "Do you want to delete this sprint?",
        );
    });

    it("hides the delete button without delete_milestone", () => {
        const sprint = makeSprint();
        const { props } = setup({ mode: "edit", sprint, project: makeProject([]) });
        const { container } = render(<CreateEditSprint {...props} />);
        expect(container.querySelector(".delete-sprint")).toBeNull();
    });

    it("saves only the modified attrs via a dirty PATCH then calls ONLY onSaved", async () => {
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
        expect(onClose).not.toHaveBeenCalled();
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
// Validation (M3 — matches legacy checksley EXACTLY)
// ---------------------------------------------------------------------------

describe("CreateEditSprint — validation", () => {
    it("blocks submit and shows the name error when the name is empty", () => {
        const { props, createMock } = setup({ mode: "create", lastSprint: null });
        const { container } = render(<CreateEditSprint {...props} />);

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

    it("accepts a finish date earlier than the start date (no unproven finish>=start rule, M3)", async () => {
        const { props, createMock, onSaved } = setup({ mode: "create", lastSprint: null });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "Backwards" } });
        fireEvent.change(startInput(container), { target: { value: "2025-07-10" } });
        fireEvent.change(finishInput(container), { target: { value: "2025-07-01" } });
        fireEvent.submit(formEl(container));

        // No client-side finish error is produced; the create proceeds.
        expect(container.querySelector(".error-estimated-finish")).toBeNull();
        await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
        expect(createMock).toHaveBeenCalledWith("milestones", {
            project: 42,
            name: "Backwards",
            estimated_start: "2025-07-10",
            estimated_finish: "2025-07-01",
        });
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    });
});

// ---------------------------------------------------------------------------
// Error handling / pending state (M2)
// ---------------------------------------------------------------------------

describe("CreateEditSprint — error handling & pending state (M2)", () => {
    it("surfaces the backend's sanitized message, preserves values, and stays open on create failure", async () => {
        const { props, createMock, onSaved } = setup({ mode: "create", lastSprint: null });
        createMock.mockRejectedValueOnce(
            new ApiError(400, { _error_message: "Sprint name already taken" }),
        );
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "Dup sprint" } });
        fireEvent.change(startInput(container), { target: { value: "2025-07-01" } });
        fireEvent.change(finishInput(container), { target: { value: "2025-07-15" } });
        fireEvent.submit(formEl(container));

        await waitFor(() => expect(errorAlert(container)).not.toBeNull());
        expect(errorAlert(container)?.textContent).toBe("Sprint name already taken");
        // The success path never fired, values are preserved, modal stays open.
        expect(onSaved).not.toHaveBeenCalled();
        expect(nameInput(container).value).toBe("Dup sprint");
        expect(root(container).classList.contains("open")).toBe(true);
        // Controls are re-enabled so the user can retry.
        expect(submitBtn(container).disabled).toBe(false);
    });

    it("maps a non-ApiError rejection to a generic sanitized message", async () => {
        const { props, createMock } = setup({ mode: "create", lastSprint: null });
        createMock.mockRejectedValueOnce(new Error("socket hang up"));
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "Net fail" } });
        fireEvent.change(startInput(container), { target: { value: "2025-07-01" } });
        fireEvent.change(finishInput(container), { target: { value: "2025-07-15" } });
        fireEvent.submit(formEl(container));

        await waitFor(() => expect(errorAlert(container)).not.toBeNull());
        // Never leaks the raw error text.
        expect(errorAlert(container)?.textContent).toBe(
            "Something went wrong. Please try again.",
        );
        expect(errorAlert(container)?.textContent).not.toContain("socket hang up");
    });

    it("disables the form controls while the create request is in flight", async () => {
        const { props, createMock } = setup({ mode: "create", lastSprint: null });
        const d = deferred<Record<string, never>>();
        createMock.mockReturnValueOnce(d.promise);
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.change(nameInput(container), { target: { value: "Pending" } });
        fireEvent.change(startInput(container), { target: { value: "2025-07-01" } });
        fireEvent.change(finishInput(container), { target: { value: "2025-07-15" } });
        fireEvent.submit(formEl(container));

        // While the promise is unresolved, controls are disabled (pending).
        await waitFor(() => expect(submitBtn(container).disabled).toBe(true));
        expect(nameInput(container).disabled).toBe(true);
        expect(startInput(container).disabled).toBe(true);
        expect(submitBtn(container).getAttribute("aria-busy")).toBe("true");

        await act(async () => {
            d.resolve({});
            await Promise.resolve();
        });

        await waitFor(() => expect(submitBtn(container).disabled).toBe(false));
    });
});

// ---------------------------------------------------------------------------
// Delete (in-dialog confirmation — no window.confirm)
// ---------------------------------------------------------------------------

describe("CreateEditSprint — delete", () => {
    it("asks for confirmation in-dialog, then removes and calls ONLY onDeleted", async () => {
        const sprint = makeSprint();
        const { props, removeMock, onDeleted, onClose } = setup({ mode: "edit", sprint });
        const { container } = render(<CreateEditSprint {...props} />);

        // 1) Click delete -> in-dialog confirmation appears (no window.confirm).
        fireEvent.click(container.querySelector("button.delete-sprint") as HTMLButtonElement);
        const confirm = container.querySelector(".delete-sprint-confirm");
        expect(confirm).not.toBeNull();
        expect(confirm?.querySelector(".delete-sprint-confirm-title")?.textContent).toBe(
            "Delete sprint",
        );
        expect(confirm?.querySelector(".delete-sprint-confirm-name")?.textContent).toBe(
            "Sprint 7",
        );
        expect(removeMock).not.toHaveBeenCalled();

        // 2) Accept -> remove -> single onDeleted path (never onClose).
        fireEvent.click(
            container.querySelector(".delete-sprint-confirm-accept") as HTMLButtonElement,
        );
        await waitFor(() => expect(removeMock).toHaveBeenCalledTimes(1));
        expect(removeMock).toHaveBeenCalledWith("milestones", 7);
        await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
        expect(onClose).not.toHaveBeenCalled();
    });

    it("dismisses the confirmation on cancel without removing", () => {
        const sprint = makeSprint();
        const { props, removeMock, onDeleted } = setup({ mode: "edit", sprint });
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.click(container.querySelector("button.delete-sprint") as HTMLButtonElement);
        expect(container.querySelector(".delete-sprint-confirm")).not.toBeNull();

        fireEvent.click(
            container.querySelector(".delete-sprint-confirm-cancel") as HTMLButtonElement,
        );
        expect(container.querySelector(".delete-sprint-confirm")).toBeNull();
        // The delete trigger is back.
        expect(container.querySelector("button.delete-sprint")).not.toBeNull();
        expect(removeMock).not.toHaveBeenCalled();
        expect(onDeleted).not.toHaveBeenCalled();
    });

    it("surfaces a sanitized error and stays open when the delete fails", async () => {
        const sprint = makeSprint();
        const { props, removeMock, onDeleted } = setup({ mode: "edit", sprint });
        removeMock.mockRejectedValueOnce(new ApiError(500, {}));
        const { container } = render(<CreateEditSprint {...props} />);

        fireEvent.click(container.querySelector("button.delete-sprint") as HTMLButtonElement);
        fireEvent.click(
            container.querySelector(".delete-sprint-confirm-accept") as HTMLButtonElement,
        );

        await waitFor(() => expect(errorAlert(container)).not.toBeNull());
        expect(errorAlert(container)?.textContent).toBe(
            "The server encountered an error. Please try again later.",
        );
        expect(onDeleted).not.toHaveBeenCalled();
        expect(root(container).classList.contains("open")).toBe(true);
    });
});
