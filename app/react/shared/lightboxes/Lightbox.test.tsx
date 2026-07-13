/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Component tests for the reusable {@link Lightbox} modal shell. This one
 * component closes findings C2 (the `.open`-only visibility contract the
 * preserved `lightbox.scss` reveals — NOT inline `display`), and M7 (dialog
 * semantics, Escape-to-close, focus capture/restore, and the Tab focus-trap).
 */

import { cleanup, fireEvent, render } from "@testing-library/react";

import { Lightbox } from "./Lightbox";

afterEach(cleanup);

describe("Lightbox — visibility contract (C2) + host", () => {
    it("is always mounted; closed = base `.lightbox` WITHOUT `.open` + aria-hidden", () => {
        const { container } = render(
            <Lightbox open={false} onClose={jest.fn()} markerAttr="tg-lb-demo" ariaLabel="Demo">
                <p>content</p>
            </Lightbox>,
        );
        const host = container.querySelector(".lightbox") as HTMLElement;
        expect(host).toBeInTheDocument();
        expect(host).not.toHaveClass("open");
        expect(host).toHaveAttribute("aria-hidden", "true");
        expect(host).toHaveAttribute("role", "dialog");
        expect(host).toHaveAttribute("aria-modal", "true");
        // Marker attribute applied imperatively (effect) so e2e host selectors resolve.
        expect(host).toHaveAttribute("tg-lb-demo");
        // Content is NOT mounted while closed (legacy form(ng-if=lightboxOpen)).
        expect(host).not.toHaveTextContent("content");
    });

    it("open = adds `.open`, drops aria-hidden, mounts content + the close control", () => {
        const { container } = render(
            <Lightbox open onClose={jest.fn()} ariaLabel="Demo">
                <p>content</p>
            </Lightbox>,
        );
        const host = container.querySelector(".lightbox") as HTMLElement;
        expect(host).toHaveClass("open");
        expect(host).not.toHaveAttribute("aria-hidden");
        expect(host).toHaveTextContent("content");
        expect(host.querySelector("a.close")).toBeInTheDocument();
    });

    it("omits the close control when showClose is false", () => {
        const { container } = render(
            <Lightbox open showClose={false} onClose={jest.fn()} ariaLabel="Demo">
                <p>content</p>
            </Lightbox>,
        );
        expect(container.querySelector("a.close")).toBeNull();
    });

    it("prefers aria-labelledby over aria-label when a labelledById is given", () => {
        const { container } = render(
            <Lightbox open onClose={jest.fn()} labelledById="the-title" ariaLabel="ignored">
                <h2 id="the-title">Title</h2>
            </Lightbox>,
        );
        const host = container.querySelector(".lightbox") as HTMLElement;
        expect(host).toHaveAttribute("aria-labelledby", "the-title");
        expect(host).not.toHaveAttribute("aria-label");
    });
});

describe("Lightbox — close affordances (M7)", () => {
    it("calls onClose when the close control is clicked", () => {
        const onClose = jest.fn();
        const { container } = render(
            <Lightbox open onClose={onClose} ariaLabel="Demo">
                <p>content</p>
            </Lightbox>,
        );
        fireEvent.click(container.querySelector("a.close") as Element);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose on Escape", () => {
        const onClose = jest.fn();
        const { container } = render(
            <Lightbox open onClose={onClose} ariaLabel="Demo">
                <input aria-label="field" />
            </Lightbox>,
        );
        fireEvent.keyDown(container.querySelector(".lightbox") as Element, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe("Lightbox — focus lifecycle (M7)", () => {
    it("moves focus to the initialFocusSelector on open and restores the invoker on close", () => {
        // A persistent invoker button that owns focus before the dialog opens.
        const invoker = document.createElement("button");
        invoker.textContent = "open";
        document.body.appendChild(invoker);
        invoker.focus();
        expect(document.activeElement).toBe(invoker);

        const { rerender, container } = render(
            <Lightbox open={false} onClose={jest.fn()} initialFocusSelector="input[name='a']" ariaLabel="Demo">
                <input name="a" aria-label="a" />
            </Lightbox>,
        );

        rerender(
            <Lightbox open onClose={jest.fn()} initialFocusSelector="input[name='a']" ariaLabel="Demo">
                <input name="a" aria-label="a" />
            </Lightbox>,
        );
        const field = container.querySelector("input[name='a']") as HTMLInputElement;
        expect(document.activeElement).toBe(field);

        // Close -> focus returns to the original invoker.
        rerender(
            <Lightbox open={false} onClose={jest.fn()} initialFocusSelector="input[name='a']" ariaLabel="Demo">
                <input name="a" aria-label="a" />
            </Lightbox>,
        );
        expect(document.activeElement).toBe(invoker);

        document.body.removeChild(invoker);
    });

    it("wraps focus with Tab at the last focusable and Shift+Tab at the first (trap)", () => {
        const { container } = render(
            <Lightbox open onClose={jest.fn()} ariaLabel="Demo">
                <input name="first" aria-label="first" />
                <input name="last" aria-label="last" />
            </Lightbox>,
        );
        const host = container.querySelector(".lightbox") as HTMLElement;
        const focusables = Array.from(host.querySelectorAll("a.close, input")) as HTMLElement[];
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        last.focus();
        fireEvent.keyDown(host, { key: "Tab" });
        expect(document.activeElement).toBe(first);

        first.focus();
        fireEvent.keyDown(host, { key: "Tab", shiftKey: true });
        expect(document.activeElement).toBe(last);
    });
});
