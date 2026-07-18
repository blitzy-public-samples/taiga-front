/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * mount.tsx — Web-Components adapter for running React screens in-place inside
 * the AngularJS 1.5.10 shell.
 *
 * This module is the coexistence bridge for the incremental (Strangler)
 * AngularJS -> React migration. It mirrors the repository's existing
 * `elements.js` precedent (the Angular-2+ Web-Components bundle that is already
 * loaded before `angular.bootstrap`): a compiled React bundle is loaded as a
 * plain <script>, registers Custom Elements, and each element renders a React
 * tree via `ReactDOM.createRoot()` into its own host node. Data flows in through
 * HTML attributes ("props down"); screen containers push changes back through
 * the shared API/WebSocket layers ("events up").
 *
 * Load ordering (see app-loader/app-loader.coffee, `loadApp`, lines 110-114):
 *
 *     elements.js  ->  react.js (this bundle)  ->  app.js  ->  angular.bootstrap
 *
 * The custom elements registered by `../index.tsx` (via `mountElement`) are
 * therefore defined *before* AngularJS compiles the hosting Jade partials, so
 * when the router renders `<tg-react-kanban>` / `<tg-react-backlog>` the browser
 * immediately upgrades them and `connectedCallback` mounts React. When AngularJS
 * tears the view down, `disconnectedCallback` unmounts the root so no React tree
 * leaks.
 *
 * IMPORTANT (folder invariant): this is the ONLY file in the entire
 * `app/react/**` tree that is permitted to import `createRoot` from
 * `react-dom/client`. Every other React screen mounts through `mountElement`.
 *
 * Toolchain: React 18.2.0 / react-dom 18.2.0, TypeScript 5.4.5 under `strict`,
 * JSX automatic runtime (`jsx: "react-jsx"`) — hence there is intentionally no
 * `import React from 'react'`; only a type-only import is used. The whole
 * toolchain is kept Node v16.19.1 compatible.
 */

import { createRoot, type Root } from 'react-dom/client';
import type { ComponentType } from 'react';

/**
 * Convert a custom element's HTML attributes into a React props object.
 *
 * Each attribute name is translated from lower-kebab-case (the only casing HTML
 * attribute names preserve) to camelCase so it reads naturally as a React prop,
 * e.g. `project-id` -> `projectId`, `project-slug` -> `projectSlug`. The
 * kebab->camel transform uppercases the character that follows each hyphen.
 *
 * NOTE: HTML attribute values are ALWAYS strings. Screen containers (for example
 * `KanbanApp` / `BacklogApp`) are responsible for coercing individual props to
 * their real types (e.g. `projectId` -> number). This adapter deliberately does
 * not guess types, which keeps the "props down" contract explicit and lossless.
 *
 * @param el The custom-element host whose attributes should be read.
 * @returns A map of camelCased attribute name -> raw string value.
 */
function attrsToProps(el: HTMLElement): Record<string, string> {
    const props: Record<string, string> = {};
    const attributes = el.attributes;

    for (let i = 0; i < attributes.length; i++) {
        const attribute = attributes[i];
        const name = attribute.name.replace(
            /-([a-z0-9])/g,
            (_match: string, char: string): string => char.toUpperCase(),
        );
        props[name] = attribute.value;
    }

    return props;
}

/**
 * Build a Custom Element class that renders the given React component.
 *
 * The returned constructor is registered by `../index.tsx`, e.g.
 *
 * ```ts
 * customElements.define('tg-react-kanban', mountElement(KanbanApp));
 * customElements.define('tg-react-backlog', mountElement(BacklogApp));
 * ```
 *
 * Lifecycle:
 *  - `connectedCallback` creates a React root bound to the element — once; the
 *    guard tolerates the element being moved within the DOM without spawning a
 *    second root — and renders `<Component {...props} />`, where `props` are the
 *    element's camelCased attributes.
 *  - `disconnectedCallback` unmounts the root so the React tree is released when
 *    AngularJS removes the host. The unmount is deferred to a microtask because
 *    AngularJS may synchronously detach the node during a React render pass, and
 *    unmounting synchronously in that window triggers React 18's "unmount during
 *    render" warning. `this._root` is nulled *before* scheduling the unmount to
 *    prevent re-entrancy if the element is reconnected.
 *
 * `observedAttributes` / `attributeChangedCallback` are intentionally omitted:
 * the AngularJS router recreates the element on navigation, so connect/disconnect
 * is sufficient and honours the minimal-change directive.
 *
 * `Component` is typed `ComponentType<any>` because every prop originates as a
 * string attribute; each screen container declares its own precise props and
 * performs the coercion. That `any` is confined to this factory boundary — the
 * returned value is strongly typed as `CustomElementConstructor`.
 *
 * @param Component The React component to mount inside the custom element.
 * @returns A `CustomElementConstructor` suitable for `customElements.define`.
 */
export function mountElement(Component: ComponentType<any>): CustomElementConstructor {
    return class extends HTMLElement {
        /** The React root bound to this host, or `null` while unmounted. */
        private _root: Root | null = null;

        connectedCallback(): void {
            // Guard against double-connect: the AngularJS router may relocate the
            // element within the DOM, which fires connectedCallback again. Reuse
            // the existing root instead of creating a second one. A local binding
            // is used (rather than `this._root` directly) so TypeScript's
            // control-flow narrowing survives the `attrsToProps(this)` call below.
            let root = this._root;
            if (!root) {
                root = createRoot(this);
                this._root = root;
            }

            // Attribute values arrive as strings; containers coerce as needed.
            const props = attrsToProps(this);
            root.render(<Component {...props} />);
        }

        disconnectedCallback(): void {
            // Detach the reference first to guard against re-entrancy, then defer
            // the actual unmount to a microtask. Deferring avoids React 18's
            // "unmount during render" warning when AngularJS synchronously removes
            // the host mid-render; it is also safe under jsdom.
            const root = this._root;
            this._root = null;
            if (root) {
                queueMicrotask(() => root.unmount());
            }
        }
    };
}
