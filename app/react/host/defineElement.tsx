/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ComponentType } from "react";

import { ErrorBoundary } from "./ErrorBoundary";

/**
 * Props every React root receives from its custom-element host.
 *
 * Sourced from the `data-*` attributes the AngularJS Jade shells put on the
 * `<tg-react-kanban>` / `<tg-react-backlog>` tags:
 *   `data-project-id="{{project.id}}"`  -> `projectId`  (number)
 *   `data-project-slug="{{project.slug}}"` -> `projectSlug` (string)
 *
 * The migrated `KanbanApp` / `BacklogApp` roots MUST accept (at least) these
 * two props; `defineElement` is the single place they are read.
 *
 * Note: AngularJS resolves the `{{project.id}}` interpolation via a `$digest`
 * that may run AFTER the element's first `connectedCallback`. `projectId` can
 * therefore be `NaN` on the very first render and settle to the real value once
 * `attributeChangedCallback` re-renders the root. App roots must tolerate a
 * transient `NaN` projectId (e.g. defer network calls until it is finite).
 */
export interface HostElementProps {
    projectId: number;
    projectSlug: string;
}

/** The `data-*` attributes observed for late AngularJS interpolation updates. */
const OBSERVED_ATTRIBUTES: readonly string[] = ["data-project-id", "data-project-slug"];

/**
 * Build a custom-element (Web Component) class that hosts a React root rendering
 * `Component`, wrapped in an {@link ErrorBoundary} for fault isolation.
 *
 * This mirrors the repository's existing `elements.js` (Angular Elements)
 * coexistence precedent: elements are registered on `window.customElements`
 * before `angular.bootstrap`, mount on `connectedCallback`, and unmount on
 * `disconnectedCallback`. The factory is intentionally generic — it never
 * imports the concrete `KanbanApp` / `BacklogApp` roots (that wiring lives in
 * `../index.tsx`), so `host/` stays free of sibling dependencies.
 *
 * @param Component A React component accepting {@link HostElementProps}.
 * @returns A `CustomElementConstructor` suitable for `customElements.define`.
 */
export function defineElement(Component: ComponentType<HostElementProps>): CustomElementConstructor {
    return class ReactHostElement extends HTMLElement {
        /** The React 18 root bound to this element; `null` while unmounted. */
        private _root: Root | null = null;

        /** Re-render when AngularJS interpolates the `data-*` values post-connect. */
        static get observedAttributes(): readonly string[] {
            return OBSERVED_ATTRIBUTES;
        }

        connectedCallback(): void {
            if (this._root === null) {
                this._root = createRoot(this);
            }
            this.renderRoot();
        }

        attributeChangedCallback(): void {
            // Only react after the initial mount; pre-connect upgrades are
            // handled by connectedCallback's first render.
            if (this._root !== null) {
                this.renderRoot();
            }
        }

        disconnectedCallback(): void {
            this._root?.unmount();
            this._root = null;
        }

        /** Map the host `data-*` dataset into typed props for the React root. */
        private readProps(): HostElementProps {
            return {
                projectId: Number(this.dataset.projectId),
                projectSlug: this.dataset.projectSlug ?? "",
            };
        }

        private renderRoot(): void {
            this._root?.render(
                <ErrorBoundary>
                    <Component {...this.readProps()} />
                </ErrorBoundary>,
            );
        }
    };
}
