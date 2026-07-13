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
        expect(host.querySelector("input.tag-input")).toBeInTheDocument();
        expect(host.querySelector("textarea.description")).toBeInTheDocument();
        expect(host.querySelector("button.status-dropdown")).toBeInTheDocument();
        expect(host.querySelector("fieldset.creation-position")).toBeInTheDocument();
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
    it("adds and removes tags", () => {
        const { container, onSubmit } = renderForm();
        const tagInput = container.querySelector("input.tag-input") as HTMLInputElement;
        fireEvent.change(tagInput, { target: { value: "urgent" } });
        fireEvent.keyDown(tagInput, { key: "Enter" });
        expect(container.querySelectorAll("li.tag .tag-name")).toHaveLength(1);
        expect(container.querySelector("li.tag .tag-name")).toHaveTextContent("urgent");

        fireEvent.click(container.querySelector("button.tag-remove") as Element);
        expect(container.querySelectorAll("li.tag")).toHaveLength(0);

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

describe("StoryFormLightbox — cancel", () => {
    it("calls onClose from the cancel button", () => {
        const { container, onClose } = renderForm();
        fireEvent.click(container.querySelector("button.cancel") as Element);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
