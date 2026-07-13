/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link AssignedToLightbox} — the shared edit-assignment
 * lightbox (finding C2). It seeds its selection from the story's current
 * collaborators, lets the user toggle members, and emits `(assignedUsers,
 * assignedTo)` on submit (the first selected member becomes the primary
 * assignee); server errors surface in-lightbox (M2).
 */

import { cleanup, fireEvent, render } from "@testing-library/react";

import { AssignedToLightbox, type AssignedToLightboxProps } from "./AssignedToLightbox";
import type { ProjectMember } from "../types";

const MEMBERS: ProjectMember[] = [
    { id: 1, full_name_display: "Ada Lovelace" },
    { id: 2, username: "grace" },
    { id: 3, full_name: "Alan Turing" },
];

function renderAssign(overrides: Partial<AssignedToLightboxProps> = {}) {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    const props: AssignedToLightboxProps = {
        open: true,
        onClose,
        onSubmit,
        members: MEMBERS,
        initialAssignedUsers: [],
        saving: false,
        errorMessage: null,
        canSubmit: true,
        ...overrides,
    };
    const utils = render(<AssignedToLightbox {...props} />);
    return { ...utils, onSubmit, onClose };
}

afterEach(cleanup);

describe("AssignedToLightbox — open/closed contract", () => {
    it("mounts the host closed with the e2e marker attribute", () => {
        const { container } = renderAssign({ open: false });
        const host = container.querySelector("[tg-lb-assignedto]") as HTMLElement;
        expect(host).toBeInTheDocument();
        expect(host).not.toHaveClass("open");
        expect(host.querySelector("form")).toBeNull();
    });

    it("renders one selectable row per member when open", () => {
        const { container } = renderAssign();
        const host = container.querySelector("[tg-lb-assignedto]") as HTMLElement;
        expect(host).toHaveClass("open");
        const rows = host.querySelectorAll("li.user-list-single");
        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveTextContent("Ada Lovelace");
        expect(rows[1]).toHaveTextContent("grace");
        expect(rows[2]).toHaveTextContent("Alan Turing");
    });
});

describe("AssignedToLightbox — selection + submit (C2 / M2)", () => {
    it("seeds the selection from the story's current collaborators", () => {
        const { container } = renderAssign({ initialAssignedUsers: [2] });
        const rows = container.querySelectorAll("li.user-list-single");
        expect(rows[1]).toHaveClass("selected");
        expect(rows[0]).not.toHaveClass("selected");
        const box = rows[1].querySelector("input[type='checkbox']") as HTMLInputElement;
        expect(box.checked).toBe(true);
    });

    it("emits the selected users with the first as the primary assignee", () => {
        const { container, onSubmit } = renderAssign();
        const boxes = container.querySelectorAll("li.user-list-single input[type='checkbox']");
        fireEvent.click(boxes[2]); // Alan (id 3)
        fireEvent.click(boxes[0]); // Ada (id 1)
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        // Selection order preserved; primary = first selected (Alan).
        expect(onSubmit).toHaveBeenCalledWith([3, 1], 3);
    });

    it("emits an empty selection with a null primary when all are cleared", () => {
        const { container, onSubmit } = renderAssign({ initialAssignedUsers: [1] });
        const boxes = container.querySelectorAll("li.user-list-single input[type='checkbox']");
        fireEvent.click(boxes[0]); // toggle Ada off
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith([], null);
    });

    it("does not submit without permission or while saving", () => {
        const noPerm = renderAssign({ canSubmit: false });
        fireEvent.submit(noPerm.container.querySelector("form") as HTMLFormElement);
        expect(noPerm.onSubmit).not.toHaveBeenCalled();
        expect(noPerm.container.querySelector("button.js-submit-button")).toBeDisabled();
        cleanup();

        const savingR = renderAssign({ saving: true });
        fireEvent.submit(savingR.container.querySelector("form") as HTMLFormElement);
        expect(savingR.onSubmit).not.toHaveBeenCalled();
    });

    it("surfaces a server error in-lightbox and keeps it open (M2)", () => {
        const { container } = renderAssign({ errorMessage: "Assignment failed." });
        expect(container.querySelector(".lightbox-error")).toHaveTextContent("Assignment failed.");
        expect(container.querySelector("[tg-lb-assignedto]")).toHaveClass("open");
    });

    it("calls onClose from the cancel button", () => {
        const { container, onClose } = renderAssign();
        fireEvent.click(container.querySelector("button.cancel") as Element);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
