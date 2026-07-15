/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Focused Jest + React Testing Library suite for the per-root ErrorBoundary
// (AAP §0.3.3 "Error boundary per root"). It proves the boundary (a) renders
// children while healthy, (b) shows a contained, class-name-driven fallback
// when a descendant throws, (c) logs a diagnostic WITHOUT leaking any
// session/token material, and (d) isolates the fault from sibling subtrees so a
// crash in a migrated screen cannot unwind past the custom-element host into the
// surrounding AngularJS shell.

import { render, screen } from "@testing-library/react";

import { ErrorBoundary } from "./ErrorBoundary";

/** A child component that throws during render to trip the boundary. */
function Boom(): JSX.Element {
    throw new Error("kaboom in a migrated screen");
}

/** Silence the noisy React/DOM error logging a thrown render produces. */
function withSilencedConsoleError(run: () => void): jest.SpyInstance {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    run();
    return spy;
}

describe("host/ErrorBoundary", () => {
    it("renders its children unchanged while healthy", () => {
        render(
            <ErrorBoundary>
                <span>healthy content</span>
            </ErrorBoundary>,
        );

        expect(screen.getByText("healthy content")).toBeInTheDocument();
    });

    it("renders a contained role=alert fallback with the expected class and copy on throw", () => {
        const spy = withSilencedConsoleError(() => {
            render(
                <ErrorBoundary>
                    <Boom />
                </ErrorBoundary>,
            );
        });

        const alert = screen.getByRole("alert");
        expect(alert).toHaveClass("tg-react-error-boundary");
        expect(alert).toHaveTextContent("Something went wrong while loading this view.");

        spy.mockRestore();
    });

    it("logs a [taiga-react] diagnostic via componentDidCatch but never a token/session", () => {
        const spy = withSilencedConsoleError(() => {
            render(
                <ErrorBoundary>
                    <Boom />
                </ErrorBoundary>,
            );
        });

        const loggedTaigaDiagnostic = spy.mock.calls.some((call) =>
            String(call[0]).includes("[taiga-react]"),
        );
        expect(loggedTaigaDiagnostic).toBe(true);

        // Secrecy: nothing the boundary logs may contain bearer/token/session material.
        const everythingLogged = spy.mock.calls
            .flat()
            .map((arg) => String(arg))
            .join(" ")
            .toLowerCase();
        expect(everythingLogged).not.toContain("bearer");
        expect(everythingLogged).not.toContain("sessionid");

        spy.mockRestore();
    });

    it("isolates the fault so a sibling subtree outside the boundary still renders", () => {
        const spy = withSilencedConsoleError(() => {
            render(
                <div>
                    <span>sibling survives</span>
                    <ErrorBoundary>
                        <Boom />
                    </ErrorBoundary>
                </div>,
            );
        });

        expect(screen.getByText("sibling survives")).toBeInTheDocument();
        expect(screen.getByRole("alert")).toBeInTheDocument();

        spy.mockRestore();
    });
});
