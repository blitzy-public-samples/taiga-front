/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { ConfirmAskLightbox } from "./ConfirmAskLightbox";

/**
 * M1 dirty-close confirmation ("ask") modal. Verifies the authoritative
 * `lightbox-generic-ask` DOM + legacy catalogue strings (COMMON.ACCEPT /
 * COMMON.CANCEL), the confirm/cancel wiring, the busy guard, escaped text
 * nodes, and Escape-to-cancel (via the shared Lightbox shell).
 */
describe("ConfirmAskLightbox (M1 dirty-close ask modal)", () => {
    it("keeps the host mounted but CLOSED (no .open, no content) when open=false", () => {
        const { container } = render(
            <ConfirmAskLightbox
                open={false}
                title="Are you sure?"
                onConfirm={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        const host = container.querySelector(".lightbox.lightbox-generic-ask");
        expect(host).toBeInTheDocument();
        expect(host).toHaveAttribute("tg-lb-generic-ask");
        expect(host).not.toHaveClass("open");
        expect(container.querySelector(".js-confirm")).toBeNull();
    });

    it("renders the legacy DOM + localized strings when open", () => {
        const { container } = render(
            <ConfirmAskLightbox
                open
                title="You have not saved changes."
                subtitle="Sub"
                message="Msg"
                onConfirm={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        const host = container.querySelector(".lightbox-generic-ask");
        expect(host).toHaveClass("open");
        expect(host).toHaveAttribute("role", "dialog");

        // form > h2.title + p(span.subtitle + span.message)
        expect(container.querySelector("form h2.title")?.textContent).toBe(
            "You have not saved changes.",
        );
        expect(container.querySelector("form p span.subtitle")?.textContent).toBe(
            "Sub",
        );
        expect(container.querySelector("form p span.message")?.textContent).toBe(
            "Msg",
        );

        // .options > .js-cancel (Cancel) + .js-confirm (Accept)
        expect(container.querySelector(".options .js-cancel span")?.textContent).toBe(
            "Cancel",
        );
        expect(container.querySelector(".options .js-confirm span")?.textContent).toBe(
            "Accept",
        );
    });

    it("defaults subtitle/message to empty strings", () => {
        const { container } = render(
            <ConfirmAskLightbox
                open
                title="T"
                onConfirm={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        expect(container.querySelector("span.subtitle")?.textContent).toBe("");
        expect(container.querySelector("span.message")?.textContent).toBe("");
    });

    it("escapes the title as a text node (never dangerouslySetInnerHTML)", () => {
        const { container } = render(
            <ConfirmAskLightbox
                open
                title={"<img src=x onerror=alert(1)>"}
                onConfirm={jest.fn()}
                onCancel={jest.fn()}
            />,
        );
        const title = container.querySelector("h2.title");
        expect(title?.textContent).toBe("<img src=x onerror=alert(1)>");
        expect(title?.querySelector("img")).toBeNull();
    });

    it("calls onConfirm / onCancel on the respective controls", () => {
        const onConfirm = jest.fn();
        const onCancel = jest.fn();
        const { container } = render(
            <ConfirmAskLightbox
                open
                title="X"
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
            <ConfirmAskLightbox
                open
                busy
                title="X"
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
            <ConfirmAskLightbox
                open
                title="X"
                onConfirm={jest.fn()}
                onCancel={onCancel}
            />,
        );
        const host = container.querySelector(".lightbox-generic-ask") as HTMLElement;
        fireEvent.keyDown(host, { key: "Escape" });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
