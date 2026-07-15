/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Focused Jest suite for the custom-element host factory (AAP §0.3.3
// "Custom-element host / adapter bridge" + §0.6.1). It verifies the Web
// Component lifecycle that lets a React root mount inside the living AngularJS
// document: one root per element on connect, `data-*` → typed props (tolerating
// the transient NaN projectId AngularJS produces before `$digest`), re-render on
// late attribute interpolation, clean unmount on disconnect, a fresh root on
// reattach (no "createRoot called twice" warning), and ErrorBoundary isolation
// so a throwing root never crashes the host element.

import { act } from "@testing-library/react";
import type { ComponentType } from "react";

import { defineElement } from "./defineElement";
import type { HostElementProps } from "./defineElement";

/** Unique tag per registration — customElements.define rejects duplicate names. */
let tagCounter = 0;
function uniqueTag(): string {
    tagCounter += 1;
    return `tg-test-host-${tagCounter}`;
}

/** Register a host element for a component under a fresh tag and return the tag. */
function registerHost(Component: ComponentType<HostElementProps>): string {
    const tag = uniqueTag();
    customElements.define(tag, defineElement(Component));
    return tag;
}

/** A root that renders its props so mount/update are observable via textContent. */
const PropsProbe: ComponentType<HostElementProps> = ({ projectId, projectSlug }) => (
    <div data-testid="probe">
        id:{String(projectId)}|slug:{projectSlug}
    </div>
);

/** A root that throws during render to exercise the ErrorBoundary path. */
const ThrowingRoot: ComponentType<HostElementProps> = () => {
    throw new Error("root render failed");
};

/** Track appended hosts so each test can tear them down inside act(). */
const appended: HTMLElement[] = [];

function mount(el: HTMLElement): void {
    appended.push(el);
    act(() => {
        document.body.appendChild(el);
    });
}

afterEach(() => {
    act(() => {
        while (appended.length > 0) {
            appended.pop()?.remove();
        }
    });
});

describe("host/defineElement", () => {
    it("returns an HTMLElement subclass without self-registering it", () => {
        const tag = uniqueTag();
        const Ctor = defineElement(PropsProbe);

        expect(Ctor.prototype instanceof HTMLElement).toBe(true);
        // The factory must NOT call customElements.define itself.
        expect(customElements.get(tag)).toBeUndefined();
    });

    it("observes exactly the data-project-id / data-project-slug attributes", () => {
        const Ctor = defineElement(PropsProbe) as unknown as {
            observedAttributes: string[];
        };
        expect(Ctor.observedAttributes).toEqual(["data-project-id", "data-project-slug"]);
    });

    it("mounts one root on connect and maps data-* to typed props", () => {
        const tag = registerHost(PropsProbe);
        const el = document.createElement(tag);
        el.setAttribute("data-project-id", "42");
        el.setAttribute("data-project-slug", "my-project");

        mount(el);

        expect(el.textContent).toContain("id:42");
        expect(el.textContent).toContain("slug:my-project");
        expect(el.querySelectorAll('[data-testid="probe"]')).toHaveLength(1);
    });

    it("tolerates a transient NaN projectId before AngularJS interpolates the value", () => {
        const tag = registerHost(PropsProbe);
        const el = document.createElement(tag); // no data-project-id yet

        mount(el);

        expect(el.textContent).toContain("id:NaN");
    });

    it("re-renders with the settled value when the data-project-id attribute changes", () => {
        const tag = registerHost(PropsProbe);
        const el = document.createElement(tag);

        mount(el);
        expect(el.textContent).toContain("id:NaN");

        act(() => {
            el.setAttribute("data-project-id", "7");
        });

        expect(el.textContent).toContain("id:7");
    });

    it("unmounts the root and clears the container on disconnect", () => {
        const tag = registerHost(PropsProbe);
        const el = document.createElement(tag);
        el.setAttribute("data-project-id", "1");

        mount(el);
        expect(el.textContent).toContain("id:1");

        act(() => {
            el.remove();
        });

        expect(el.textContent).toBe("");
    });

    it("mounts a fresh root on reattach with no 'createRoot called twice' warning", () => {
        const tag = registerHost(PropsProbe);
        const el = document.createElement(tag);
        el.setAttribute("data-project-id", "3");

        mount(el);
        act(() => {
            el.remove();
        });

        const consoleErrorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        act(() => {
            document.body.appendChild(el);
        });
        appended.push(el);

        expect(el.textContent).toContain("id:3");
        const warnedAboutDoubleRoot = consoleErrorSpy.mock.calls.some((call) =>
            String(call[0]).includes("createRoot"),
        );
        expect(warnedAboutDoubleRoot).toBe(false);

        consoleErrorSpy.mockRestore();
    });

    it("shows the ErrorBoundary fallback while the host element survives when the root throws", () => {
        const consoleErrorSpy = jest
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        const tag = registerHost(ThrowingRoot);
        const el = document.createElement(tag);

        mount(el);

        // The React fault is contained inside the host: fallback rendered...
        expect(el.querySelector(".tg-react-error-boundary")).not.toBeNull();
        expect(el.querySelector('[role="alert"]')).not.toBeNull();
        // ...and the custom element itself is still attached to the document.
        expect(document.body.contains(el)).toBe(true);

        consoleErrorSpy.mockRestore();
    });
});
