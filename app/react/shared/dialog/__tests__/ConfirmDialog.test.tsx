/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { render, screen, fireEvent } from "@testing-library/react";

import { ConfirmDialog } from "../ConfirmDialog";

describe("ConfirmDialog", () => {
    const baseProps = {
        open: true,
        title: "Delete user story",
        message: <>Are you sure?</>,
        onConfirm: jest.fn(),
        onCancel: jest.fn(),
    };

    it("renders nothing when closed", () => {
        const { container } = render(<ConfirmDialog {...baseProps} open={false} />);
        expect(container.firstChild).toBeNull();
    });

    it("reveals via the .lightbox.open contract with generic-delete wrapper", () => {
        render(<ConfirmDialog {...baseProps} />);
        const dialog = screen.getByRole("dialog");
        expect(dialog).toHaveClass("lightbox");
        expect(dialog).toHaveClass("lightbox-generic-delete");
        expect(dialog).toHaveClass("open");
        expect(dialog).toHaveAttribute("aria-modal", "true");
        expect(dialog).toHaveAttribute("aria-label", "Delete user story");
    });

    it("uses the generic-ask wrapper and no trash icon for the ask variant", () => {
        const { container } = render(<ConfirmDialog {...baseProps} variant="ask" />);
        const dialog = screen.getByRole("dialog");
        expect(dialog).toHaveClass("lightbox-generic-ask");
        expect(container.querySelector(".icon-trash")).toBeNull();
    });

    it("shows the trash icon for the delete variant", () => {
        const { container } = render(<ConfirmDialog {...baseProps} />);
        expect(container.querySelector(".icon-trash")).not.toBeNull();
    });

    it("renders title, subtitle and message", () => {
        render(<ConfirmDialog {...baseProps} subtitle="This cannot be undone" />);
        expect(screen.getByText("Delete user story")).toBeInTheDocument();
        expect(screen.getByText("This cannot be undone")).toBeInTheDocument();
        expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    });

    it("omits the subtitle span when no subtitle is given", () => {
        const { container } = render(<ConfirmDialog {...baseProps} />);
        expect(container.querySelector(".subtitle")).toBeNull();
    });

    it("defaults confirm/cancel labels for the delete variant", () => {
        render(<ConfirmDialog {...baseProps} />);
        expect(screen.getByText("Delete")).toBeInTheDocument();
        expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("defaults the confirm label to Accept for the ask variant", () => {
        render(<ConfirmDialog {...baseProps} variant="ask" />);
        expect(screen.getByText("Accept")).toBeInTheDocument();
    });

    it("honors custom labels", () => {
        render(
            <ConfirmDialog {...baseProps} confirmLabel="Remove it" cancelLabel="Keep" />,
        );
        expect(screen.getByText("Remove it")).toBeInTheDocument();
        expect(screen.getByText("Keep")).toBeInTheDocument();
    });

    it("invokes onConfirm when the confirm button is clicked", () => {
        const onConfirm = jest.fn();
        render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} />);
        fireEvent.click(screen.getByText("Delete"));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("invokes onCancel when the cancel button is clicked", () => {
        const onCancel = jest.fn();
        render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
        fireEvent.click(screen.getByText("Cancel"));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("invokes onCancel when the close icon is clicked", () => {
        const onCancel = jest.fn();
        render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
        fireEvent.click(screen.getByLabelText("close"));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("invokes onCancel on Escape", () => {
        const onCancel = jest.fn();
        render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
        fireEvent.keyDown(document, { key: "Escape" });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("disables buttons and ignores clicks/Escape while busy", () => {
        const onConfirm = jest.fn();
        const onCancel = jest.fn();
        render(
            <ConfirmDialog
                {...baseProps}
                busy
                onConfirm={onConfirm}
                onCancel={onCancel}
            />,
        );
        const confirmBtn = screen.getByText("Delete").closest("button")!;
        const cancelBtn = screen.getByText("Cancel").closest("button")!;
        expect(confirmBtn).toBeDisabled();
        expect(cancelBtn).toBeDisabled();
        fireEvent.click(confirmBtn);
        fireEvent.click(cancelBtn);
        fireEvent.keyDown(document, { key: "Escape" });
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });
});
