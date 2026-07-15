/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Props accepted by {@link ErrorBoundary}. Only wraps arbitrary React children.
 */
interface ErrorBoundaryProps {
    children: ReactNode;
}

/**
 * Internal boundary state. `hasError` flips to `true` the first time a
 * descendant throws during rendering / in a lifecycle method.
 */
interface ErrorBoundaryState {
    hasError: boolean;
}

/**
 * Per-root React error boundary.
 *
 * Each React root mounted by `defineElement` is wrapped in one of these so that
 * an uncaught error inside a migrated screen (Kanban / Backlog) renders a small
 * fallback UI instead of unwinding past the custom-element host and crashing the
 * surrounding AngularJS 1.5.10 shell. This is the React equivalent of the
 * fault-isolation the AngularJS app never had between modules.
 *
 * React error boundaries MUST be class components: there is no hook equivalent
 * for `getDerivedStateFromError` / `componentDidCatch`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    public state: ErrorBoundaryState = { hasError: false };

    /**
     * Render-phase reaction: switch to the fallback UI on the next render.
     * Must be pure (no side effects) per the React contract.
     */
    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    /**
     * Commit-phase reaction: log for diagnostics. Kept side-effect-light
     * (console only) so the boundary never introduces its own failure mode.
     */
    componentDidCatch(error: Error, info: ErrorInfo): void {
        // eslint-disable-next-line no-console
        console.error("[taiga-react] Unhandled error in a React root:", error, info.componentStack);
    }

    render(): ReactNode {
        if (this.state.hasError) {
            // Minimal, class-name-driven fallback (no inline styles, no i18n
            // dependency) so the compiled theme can style it consistently.
            return (
                <div className="tg-react-error-boundary" role="alert">
                    <p className="tg-react-error-boundary-message">
                        Something went wrong while loading this view. Please reload the page.
                    </p>
                </div>
            );
        }

        return this.props.children;
    }
}
