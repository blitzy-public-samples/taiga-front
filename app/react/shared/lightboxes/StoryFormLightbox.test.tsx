/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link StoryFormLightbox} — the shared, self-contained
 * create/edit user-story lightbox that resolves finding C2 (a REAL rich form
 * reproducing `lb-create-edit.jade`, opened via the `.open` contract) and
 * finding M2 (the form owns its field state and surfaces the collected VALUE
 * OBJECT only on submit, never clearing before persistence; server errors are
 * shown in-lightbox while it stays open).
 */

import { cleanup, fireEvent, render } from "@testing-library/react";

import { StoryFormLightbox, type StoryFormLightboxProps } from "./StoryFormLightbox";
import type { Point, ProjectMember, Role, Status, Swimlane } from "../types";

const STATUSES: Status[] = [
    { id: 10, name: "New", color: "#aaa", is_archived: false },
    { id: 11, name: "In progress", color: "#bbb", is_archived: false },
];
const MEMBERS: ProjectMember[] = [
    { id: 1, full_name_display: "Ada Lovelace" },
    { id: 2, username: "grace" },
];
const ROLES: Role[] = [
    { id: 5, name: "Back", computable: true },
    { id: 6, name: "Design", computable: false },
];
const POINTS: Point[] = [
    { id: 100, name: "1" },
    { id: 101, name: "2" },
];
const SWIMLANES: Swimlane[] = [{ id: 8, name: "Lane A" }];

function renderForm(overrides: Partial<StoryFormLightboxProps> = {}) {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    const props: StoryFormLightboxProps = {
        open: true,
        mode: "create",
        onClose,
        onSubmit,
        statuses: STATUSES,
        members: MEMBERS,
        roles: ROLES,
        points: POINTS,
        swimlanes: SWIMLANES,
        defaultSwimlaneId: null,
        isKanban: true,
        initialValues: { status: 10 },
        saving: false,
        errorMessage: null,
        canSubmit: true,
        ...overrides,
    };
    const utils = render(<StoryFormLightbox {...props} />);
    return { ...utils, onSubmit, onClose };
}

afterEach(cleanup);

describe("StoryFormLightbox — open/closed contract", () => {
    it("mounts the host closed (no `.open`, no form) so the e2e selector resolves", () => {
        const { container } = renderForm({ open: false });
        const host = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
        expect(host).toBeInTheDocument();
        expect(host).not.toHaveClass("open");
        expect(host.querySelector("form")).toBeNull();
    });

    it("renders the full form when open (subject, tags, description, status, position)", () => {
        const { container } = renderForm();
        const host = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
        expect(host).toHaveClass("open");
        expect(host.querySelector("input[name='subject']")).toBeInTheDocument();
        // M1: the tag input is revealed by the add-tag button (legacy add-tag flow),
        // so initially only the `.tags-container` + `.e2e-show-tag-input` show.
        expect(host.querySelector(".tags-container")).toBeInTheDocument();
        expect(host.querySelector("button.e2e-show-tag-input")).toBeInTheDocument();
        expect(host.querySelector("input.tag-input")).toBeNull();
        expect(host.querySelector("textarea.description")).toBeInTheDocument();
        expect(host.querySelector("button.status-dropdown")).toBeInTheDocument();
        expect(host.querySelector("fieldset.creation-position")).toBeInTheDocument();
        // M1: the new fields/widgets are present.
        expect(host.querySelector("button.team-requirement")).toBeInTheDocument();
        expect(host.querySelector("button.client-requirement")).toBeInTheDocument();
        expect(host.querySelector("button.due-date-button")).toBeInTheDocument();
        expect(host.querySelector("section.attachments")).toBeInTheDocument();
    });
});

describe("StoryFormLightbox — validation gate (C2) + M2 submit contract", () => {
    it("disables submit until a subject is present, then emits the value object", () => {
        const { container, onSubmit } = renderForm();
        const submit = container.querySelector("#submitButton") as HTMLButtonElement;
        expect(submit).toBeDisabled();

        const subject = container.querySelector("input[name='subject']") as HTMLInputElement;
        fireEvent.change(subject, { target: { value: "Deploy the thing" } });
        expect(submit).not.toBeDisabled();

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ subject: "Deploy the thing", status: 10, us_position: "bottom" }),
        );
    });

    it("shows the required error after the subject is touched and left empty", () => {
        const { container } = renderForm();
        const subject = container.querySelector("input[name='subject']") as HTMLInputElement;
        fireEvent.blur(subject);
        const err = container.querySelector(".checksley-error-list");
        expect(err).toHaveTextContent("This value is required.");
    });

    it("blocks submit and shows the maxlength error for an over-long subject", () => {
        const { container, onSubmit } = renderForm();
        const subject = container.querySelector("input[name='subject']") as HTMLInputElement;
        fireEvent.change(subject, { target: { value: "x".repeat(501) } });
        fireEvent.blur(subject);
        expect(container.querySelector("#submitButton")).toBeDisabled();
        expect(container.querySelector(".checksley-error-list")).toHaveTextContent("500");
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("keeps submit disabled without the permission (canSubmit=false) even with a valid subject", () => {
        const { container } = renderForm({ canSubmit: false });
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "Valid" },
        });
        expect(container.querySelector("#submitButton")).toBeDisabled();
    });

    it("disables submit while saving is in flight", () => {
        const { container } = renderForm({ saving: true, initialValues: { status: 10, subject: "x" } });
        expect(container.querySelector("#submitButton")).toBeDisabled();
    });

    it("surfaces a server error in-lightbox (kept open, values preserved) — M2", () => {
        const { container } = renderForm({ errorMessage: "The server rejected it." });
        expect(container.querySelector(".lightbox-error")).toHaveTextContent("The server rejected it.");
        // The lightbox is still open (the failed submit did not close it).
        expect(container.querySelector("[tg-lb-create-edit-userstory]")).toHaveClass("open");
    });
});

describe("StoryFormLightbox — rich fields", () => {
    it("adds and removes tags (legacy add-tag button -> input flow, M1 DOM)", () => {
        const { container, onSubmit } = renderForm();
        // The input is hidden until the add-tag button is pressed (legacy flow).
        expect(container.querySelector("input.tag-input")).toBeNull();
        fireEvent.click(container.querySelector("button.e2e-show-tag-input") as Element);
        const tagInput = container.querySelector("input.tag-input") as HTMLInputElement;
        expect(tagInput).toBeInTheDocument();

        fireEvent.change(tagInput, { target: { value: "urgent" } });
        fireEvent.keyDown(tagInput, { key: "Enter" });
        // The chip DOM mirrors the legacy `tg-tag-line-common`:
        // `.tags-container > .tag-wrapper > .tag > span`.
        expect(container.querySelectorAll(".tags-container .tag-wrapper .tag")).toHaveLength(1);
        expect(container.querySelector(".tag-wrapper .tag > span")).toHaveTextContent("urgent");

        fireEvent.click(container.querySelector(".e2e-delete-tag") as Element);
        expect(container.querySelectorAll(".tags-container .tag-wrapper .tag")).toHaveLength(0);

        // Confirm the tag is reflected in the emitted value object after re-adding.
        fireEvent.change(tagInput, { target: { value: "later" } });
        fireEvent.keyDown(tagInput, { key: "Enter" });
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ tags: [["later", null]] }),
        );
    });

    it("selects a status through the dropdown popover", () => {
        const { container, onSubmit } = renderForm();
        fireEvent.click(container.querySelector("button.status-dropdown") as Element);
        const option = container.querySelector('a.status[data-status-id="11"]') as Element;
        fireEvent.click(option);
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 11 }));
    });

    it("shows the swimlane selector only on kanban with swimlanes, and captures the choice", () => {
        const { container, onSubmit } = renderForm();
        const select = container.querySelector("select.swimlane-selector") as HTMLSelectElement;
        expect(select).toBeInTheDocument();
        fireEvent.change(select, { target: { value: "8" } });
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ swimlane: 8 }));
    });

    it("hides the swimlane selector when not on kanban", () => {
        const { container } = renderForm({ isKanban: false });
        expect(container.querySelector("select.swimlane-selector")).toBeNull();
    });

    it("toggles a collaborator assignment", () => {
        const { container, onSubmit } = renderForm();
        const boxes = container.querySelectorAll("li.assigned-list-single input[type='checkbox']");
        expect(boxes).toHaveLength(2);
        fireEvent.click(boxes[0]);
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ assigned_users: [1] }));
    });

    it("shows estimation selectors ONLY for computable roles", () => {
        const { container } = renderForm();
        const selects = container.querySelectorAll("fieldset.ticket-estimation select.points-value");
        // Only the single computable role (Back) yields a selector.
        expect(selects).toHaveLength(1);
        expect(container.querySelector("fieldset.ticket-estimation .role-name")).toHaveTextContent("Back");
    });

    it("captures an estimation point per role", () => {
        const { container, onSubmit } = renderForm();
        const select = container.querySelector("select.points-value") as HTMLSelectElement;
        fireEvent.change(select, { target: { value: "101" } });
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ points: { "5": 101 } }));
    });

    it("toggles is_blocked and reveals the blocked-note field", () => {
        const { container, onSubmit } = renderForm();
        expect(container.querySelector("textarea.blocked-note")).toBeNull();
        fireEvent.click(container.querySelector("button.is-blocked") as Element);
        const note = container.querySelector("textarea.blocked-note") as HTMLTextAreaElement;
        expect(note).toBeInTheDocument();
        fireEvent.change(note, { target: { value: "waiting on API" } });
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ is_blocked: true, blocked_note: "waiting on API" }),
        );
    });
});

describe("StoryFormLightbox — edit mode", () => {
    it("seeds from the story, uses the Save caption, and HIDES the creation-position fieldset", () => {
        const { container, onSubmit } = renderForm({
            mode: "edit",
            initialValues: { subject: "Existing", status: 11, description: "Body" },
        });
        expect(container.querySelector("input[name='subject']")).toHaveValue("Existing");
        expect(container.querySelector("textarea.description")).toHaveValue("Body");
        expect(container.querySelector("#submitButton")).toHaveTextContent("Save");
        expect(container.querySelector("fieldset.creation-position")).toBeNull();

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ subject: "Existing", status: 11 }),
        );
    });

    it("captures the top insertion position on create", () => {
        const { container, onSubmit } = renderForm();
        const top = container.querySelector("input[name='us_position'][value='top']") as HTMLInputElement;
        fireEvent.click(top);
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ us_position: "top" }));
    });
});

describe("StoryFormLightbox — cancel + dirty-close confirmation (M1)", () => {
    it("calls onClose directly from the cancel button when the form is pristine", () => {
        const { container, onClose } = renderForm();
        fireEvent.click(container.querySelector("button.cancel") as Element);
        expect(onClose).toHaveBeenCalledTimes(1);
        // No themed ask dialog is shown for a pristine close.
        const ask = container.querySelector("[tg-lb-generic-ask]") as HTMLElement;
        expect(ask).not.toHaveClass("open");
    });

    it("opens the themed ask dialog (not onClose) when closing a DIRTY form", () => {
        const { container, onClose } = renderForm();
        // Dirty the form.
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "typed" },
        });
        fireEvent.click(container.querySelector("button.cancel") as Element);
        // The close is intercepted: onClose NOT called yet, the ask dialog is open.
        expect(onClose).not.toHaveBeenCalled();
        const ask = container.querySelector("[tg-lb-generic-ask]") as HTMLElement;
        expect(ask).toHaveClass("open");
        expect(ask).toHaveTextContent("You have not saved changes.");
    });

    it("confirming the ask dialog closes the form (onClose)", () => {
        const { container, onClose } = renderForm();
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "typed" },
        });
        fireEvent.click(container.querySelector("button.cancel") as Element);
        fireEvent.click(container.querySelector("[tg-lb-generic-ask] .js-confirm") as Element);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("cancelling the ask dialog keeps the form open (no onClose)", () => {
        const { container, onClose } = renderForm();
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "typed" },
        });
        fireEvent.click(container.querySelector("button.cancel") as Element);
        fireEvent.click(container.querySelector("[tg-lb-generic-ask] .js-cancel") as Element);
        expect(onClose).not.toHaveBeenCalled();
        expect(container.querySelector("[tg-lb-generic-ask]")).not.toHaveClass("open");
        // The story form is still open.
        expect(container.querySelector("[tg-lb-create-edit-userstory]")).toHaveClass("open");
    });

    it("Escape on a dirty form routes through the same dirty-close guard", () => {
        const { container, onClose } = renderForm();
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "typed" },
        });
        const host = container.querySelector("[tg-lb-create-edit-userstory]") as HTMLElement;
        fireEvent.keyDown(host, { key: "Escape" });
        expect(onClose).not.toHaveBeenCalled();
        expect(container.querySelector("[tg-lb-generic-ask]")).toHaveClass("open");
    });
});

describe("StoryFormLightbox — due date (M1)", () => {
    it("sets and clears a due date through the popover", () => {
        const { container, onSubmit } = renderForm();
        fireEvent.click(container.querySelector("button.due-date-button") as Element);
        const dateInput = container.querySelector(".date-picker-container input[type='date']") as HTMLInputElement;
        expect(dateInput).toBeInTheDocument();
        fireEvent.change(dateInput, { target: { value: "2021-06-15" } });
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ due_date: "2021-06-15" }));

        // The clean action clears the due date.
        fireEvent.click(container.querySelector("a.date-picker-clean") as Element);
        (onSubmit as jest.Mock).mockClear();
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ due_date: null }));
    });
});

describe("StoryFormLightbox — team/client requirement (M1)", () => {
    it("toggles team_requirement and client_requirement", () => {
        const { container, onSubmit } = renderForm();
        const team = container.querySelector("button.team-requirement") as HTMLButtonElement;
        const client = container.querySelector("button.client-requirement") as HTMLButtonElement;
        expect(team).not.toHaveClass("active");
        fireEvent.click(team);
        fireEvent.click(client);
        expect(container.querySelector("button.team-requirement")).toHaveClass("active");
        expect(container.querySelector("button.client-requirement")).toHaveClass("active");
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ team_requirement: true, client_requirement: true }),
        );
    });
});

describe("StoryFormLightbox — attachments (M1)", () => {
    it("queues a selected file, shows it, allows removal, and emits it on submit", () => {
        const { container, onSubmit } = renderForm();
        expect(container.querySelector(".attachments-empty")).toBeInTheDocument();
        const fileInput = container.querySelector("input#add-attach[type='file']") as HTMLInputElement;
        const file = new File(["data"], "spec.pdf", { type: "application/pdf" });
        fireEvent.change(fileInput, { target: { files: [file] } });

        const rows = container.querySelectorAll(".attachment-list .single-attachment");
        expect(rows).toHaveLength(1);
        expect(container.querySelector(".single-attachment .attachment-name span:last-child")).toHaveTextContent(
            "spec.pdf",
        );
        expect(container.querySelector(".attachments-empty")).toBeNull();
        expect(container.querySelector(".attachments-num")).toHaveTextContent("1");

        // Submit carries the queued file.
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        const submitted = (onSubmit as jest.Mock).mock.calls[0][0];
        expect(submitted.attachmentsToAdd).toHaveLength(1);
        expect(submitted.attachmentsToAdd[0].name).toBe("spec.pdf");

        // Removing the queued file empties the list again.
        fireEvent.click(container.querySelector(".single-attachment .attachment-delete") as Element);
        expect(container.querySelectorAll(".attachment-list .single-attachment")).toHaveLength(0);
    });

    it("seeds existing attachments and queues a deletion on submit (edit mode)", () => {
        const { container, onSubmit } = renderForm({
            mode: "edit",
            initialValues: {
                subject: "Existing",
                status: 11,
                attachments: [{ id: 42, name: "old.txt" }],
            },
        });
        expect(container.querySelectorAll(".attachment-list .single-attachment")).toHaveLength(1);
        expect(container.querySelector(".single-attachment .attachment-name span:last-child")).toHaveTextContent(
            "old.txt",
        );
        // Delete the existing attachment -> queued for deletion, hidden immediately.
        fireEvent.click(container.querySelector(".single-attachment .attachment-delete") as Element);
        expect(container.querySelectorAll(".attachment-list .single-attachment")).toHaveLength(0);
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        const submitted = (onSubmit as jest.Mock).mock.calls[0][0];
        expect(submitted.attachmentsToDelete).toEqual([42]);
        expect(submitted.attachments).toEqual([]);
    });
});

describe("StoryFormLightbox — tag autocomplete + colour (M1)", () => {
    it("suggests project tags and adds the selected one with its palette colour", () => {
        const { container, onSubmit } = renderForm({
            projectTagsColors: { backend: "#123456", frontend: "#abcdef" },
        });
        fireEvent.click(container.querySelector("button.e2e-show-tag-input") as Element);
        const tagInput = container.querySelector("input.tag-input") as HTMLInputElement;
        fireEvent.change(tagInput, { target: { value: "back" } });
        const suggestions = container.querySelectorAll(".tags-dropdown li");
        expect(suggestions).toHaveLength(1);
        expect(container.querySelector(".tags-dropdown-name")).toHaveTextContent("backend");
        fireEvent.click(suggestions[0]);
        // Added with the project colour.
        expect(container.querySelector(".tag-wrapper .tag > span")).toHaveTextContent("backend");
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ tags: [["backend", "#123456"]] }),
        );
    });

    it("assigns a picked colour to a brand-new tag not in the project palette", () => {
        const { container, onSubmit } = renderForm({ projectTagsColors: { backend: "#123456" } });
        fireEvent.click(container.querySelector("button.e2e-show-tag-input") as Element);
        const tagInput = container.querySelector("input.tag-input") as HTMLInputElement;
        fireEvent.change(tagInput, { target: { value: "novel" } });
        // Open the colour dropdown and pick the first swatch.
        fireEvent.click(container.querySelector(".color-selector .tag-color") as Element);
        const swatch = container.querySelector(".color-selector-dropdown-list .color-selector-option") as HTMLElement;
        fireEvent.click(swatch);
        // Save the tag.
        fireEvent.click(container.querySelector(".add-tag-input button.save") as Element);
        fireEvent.change(container.querySelector("input[name='subject']") as HTMLInputElement, {
            target: { value: "S" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        const submitted = (onSubmit as jest.Mock).mock.calls[0][0];
        expect(submitted.tags).toHaveLength(1);
        expect(submitted.tags[0][0]).toBe("novel");
        // The first default palette swatch is #D35163.
        expect(submitted.tags[0][1]).toBe("#D35163");
    });
});
