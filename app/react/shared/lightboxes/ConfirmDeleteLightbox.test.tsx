/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { ConfirmDeleteLightbox } from "./ConfirmDeleteLightbox";

/**
 * C7 localized delete-confirmation modal. Verifies the authoritative
 * `lightbox-generic-delete` DOM + legacy catalogue strings, the confirm/cancel
 * wiring, the busy guard, and Escape-to-cancel (via the shared Lightbox shell).
 */
describe("ConfirmDeleteLightbox (C7 localized delete modal)", () => {
    it("keeps the host mounted but CLOSED (no .open, no content) when open=false", () => {
        const { container } = render(
            <ConfirmDeleteLightbox
                open={false}
                subject="Anything"
                onConfirm={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        const host = container.querySelector(".lightbox.lightbox-generic-delete");
        expect(host).toBeInTheDocument();
        expect(host).toHaveAttribute("tg-lb-generic-delete");
        expect(host).not.toHaveClass("open");
        // Content renders only while open.
        expect(container.querySelector(".js-confirm")).toBeNull();
    });

    it("renders the legacy DOM + localized strings + trash icon when open", () => {
        const { container } = render(
            <ConfirmDeleteLightbox
                open
                subject="My story"
                onConfirm={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        const host = container.querySelector(".lightbox-generic-delete");
        expect(host).toHaveClass("open");
        expect(host).toHaveAttribute("role", "dialog");

        // form > h2.title + p(span.subtitle + span.message)
        expect(container.querySelector("form h2.title")?.textContent).toBe(
            "Delete user story",
        );
        expect(container.querySelector("form p span.subtitle")?.textContent).toBe(
            "Are you sure you want to delete?",
        );
        expect(container.querySelector("form p span.message")?.textContent).toBe(
            "My story",
        );

        // .options > .js-cancel (Cancel) + .js-confirm (trash icon + Delete)
        expect(container.querySelector(".options .js-cancel span")?.textContent).toBe(
            "Cancel",
        );
        const confirm = container.querySelector(".options .js-confirm");
        expect(confirm?.querySelector("span")?.textContent).toBe("Delete");
        expect(confirm?.querySelector("svg.icon.icon-trash use")).toBeInTheDocument();
    });

    it("escapes the subject as a text node (never dangerouslySetInnerHTML)", () => {
        const { container } = render(
            <ConfirmDeleteLightbox
                open
                subject={"<img src=x onerror=alert(1)>"}
                onConfirm={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        const message = container.querySelector("span.message");
        // The raw markup is present as TEXT, and produced NO injected element.
        expect(message?.textContent).toBe("<img src=x onerror=alert(1)>");
        expect(message?.querySelector("img")).toBeNull();
    });

    it("calls onConfirm / onCancel on the respective controls", () => {
        const onConfirm = jest.fn();
        const onCancel = jest.fn();
        const { container } = render(
            <ConfirmDeleteLightbox
                open
                subject="X"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />,
        );
        fireEvent.click(container.querySelector(".js-confirm")!);
        expect(onConfirm).toHaveBeenCalledTimes(1);
        fireEvent.click(container.querySelector(".js-cancel")!);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("disables both controls and suppresses the handlers while busy", () => {
        const onConfirm = jest.fn();
        const onCancel = jest.fn();
        const { container } = render(
            <ConfirmDeleteLightbox
                open
                busy
                subject="X"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />,
        );
        const confirm = container.querySelector(".js-confirm") as HTMLButtonElement;
        const cancel = container.querySelector(".js-cancel") as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        expect(cancel.disabled).toBe(true);
        fireEvent.click(confirm);
        fireEvent.click(cancel);
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it("Escape requests cancel (shared Lightbox shell)", () => {
        const onCancel = jest.fn();
        const { container } = render(
            <ConfirmDeleteLightbox
                open
                subject="X"
                onConfirm={jest.fn()}
                onCancel={onCancel}
            />,
        );
        const host = container.querySelector(".lightbox-generic-delete") as HTMLElement;
        fireEvent.keyDown(host, { key: "Escape" });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
