/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for {@link BulkStoryLightbox} — the shared bulk create-user-
 * stories lightbox reproducing `lightbox-us-bulk.jade` (finding C2). It owns its
 * field state and emits a {@link BulkStoryValues} object only on submit (M2).
 */

import { cleanup, fireEvent, render } from "@testing-library/react";

import { BulkStoryLightbox, type BulkStoryLightboxProps } from "./BulkStoryLightbox";
import type { Status, Swimlane } from "../types";

const STATUSES: Status[] = [
    { id: 10, name: "New", is_archived: false },
    { id: 11, name: "Ready", is_archived: false },
];
const SWIMLANES: Swimlane[] = [{ id: 8, name: "Lane A" }];

function renderBulk(overrides: Partial<BulkStoryLightboxProps> = {}) {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    const props: BulkStoryLightboxProps = {
        open: true,
        onClose,
        onSubmit,
        statuses: STATUSES,
        swimlanes: SWIMLANES,
        defaultSwimlaneId: null,
        isKanban: true,
        initialStatusId: 10,
        saving: false,
        errorMessage: null,
        canSubmit: true,
        ...overrides,
    };
    const utils = render(<BulkStoryLightbox {...props} />);
    return { ...utils, onSubmit, onClose };
}

afterEach(cleanup);

describe("BulkStoryLightbox — open/closed contract", () => {
    it("mounts the host closed with the e2e marker attribute", () => {
        const { container } = renderBulk({ open: false });
        const host = container.querySelector("[tg-lb-create-bulk-userstories]") as HTMLElement;
        expect(host).toBeInTheDocument();
        expect(host).not.toHaveClass("open");
        expect(host.querySelector("form")).toBeNull();
    });

    it("renders the textarea + status selector + position radios when open", () => {
        const { container } = renderBulk();
        const host = container.querySelector("[tg-lb-create-bulk-userstories]") as HTMLElement;
        expect(host).toHaveClass("open");
        expect(host.querySelector("textarea[name='bulk']")).toBeInTheDocument();
        expect(host.querySelector("button.bulk-status-selector")).toBeInTheDocument();
        expect(host.querySelectorAll("input[name='bulk_us_position']")).toHaveLength(2);
    });
});

describe("BulkStoryLightbox — validation + submit (C2 / M2)", () => {
    it("disables submit until the textarea has content, then emits the value object", () => {
        const { container, onSubmit } = renderBulk();
        const submit = container.querySelector("button.js-submit-button") as HTMLButtonElement;
        expect(submit).toBeDisabled();

        const textarea = container.querySelector("textarea[name='bulk']") as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: "Story A\nStory B" } });
        expect(submit).not.toBeDisabled();

        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith({
            bulk: "Story A\nStory B",
            status: 10,
            swimlane: null,
            us_position: "bottom",
        });
    });

    it("shows the required error and does not submit when empty + touched", () => {
        const { container, onSubmit } = renderBulk();
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).not.toHaveBeenCalled();
        expect(container.querySelector(".checksley-error-list")).toHaveTextContent(
            "This value is required.",
        );
    });

    it("seeds the status from initialStatusId and lets the popover change it", () => {
        const { container, onSubmit } = renderBulk();
        fireEvent.click(container.querySelector("button.bulk-status-selector") as Element);
        const options = container.querySelectorAll("button.bulk-status-option");
        expect(options).toHaveLength(2);
        fireEvent.click(options[1]); // Ready (id 11)

        fireEvent.change(container.querySelector("textarea[name='bulk']") as HTMLTextAreaElement, {
            target: { value: "x" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 11 }));
    });

    it("captures the top insertion position and a swimlane choice", () => {
        const { container, onSubmit } = renderBulk();
        fireEvent.click(
            container.querySelector("input[name='bulk_us_position'][value='top']") as Element,
        );
        fireEvent.change(container.querySelector("select.swimlane-selector") as HTMLSelectElement, {
            target: { value: "8" },
        });
        fireEvent.change(container.querySelector("textarea[name='bulk']") as HTMLTextAreaElement, {
            target: { value: "x" },
        });
        fireEvent.submit(container.querySelector("form") as HTMLFormElement);
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ us_position: "top", swimlane: 8 }),
        );
    });

    it("surfaces a server error in-lightbox and keeps it open (M2)", () => {
        const { container } = renderBulk({ errorMessage: "Bulk failed." });
        expect(container.querySelector(".lightbox-error")).toHaveTextContent("Bulk failed.");
        expect(container.querySelector("[tg-lb-create-bulk-userstories]")).toHaveClass("open");
    });

    it("keeps submit disabled without permission or while saving", () => {
        const noPerm = renderBulk({ canSubmit: false });
        fireEvent.change(
            noPerm.container.querySelector("textarea[name='bulk']") as HTMLTextAreaElement,
            { target: { value: "x" } },
        );
        expect(noPerm.container.querySelector("button.js-submit-button")).toBeDisabled();
        cleanup();

        const savingR = renderBulk({ saving: true });
        fireEvent.change(
            savingR.container.querySelector("textarea[name='bulk']") as HTMLTextAreaElement,
            { target: { value: "x" } },
        );
        expect(savingR.container.querySelector("button.js-submit-button")).toBeDisabled();
    });

    it("calls onClose from the cancel button", () => {
        const { container, onClose } = renderBulk();
        fireEvent.click(container.querySelector("button.cancel") as Element);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
