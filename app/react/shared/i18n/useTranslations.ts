/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useTranslations.ts
 *
 * React binding for the framework-agnostic i18n resolver in `translate.ts`.
 *
 * WHY THIS EXISTS (M5): the surviving AngularJS app resolves visible text with
 * `angular-translate`, whose active language is loaded at runtime from
 * `${window._version}/locales/taiga/locale-{lang}.json` (see `app.coffee`
 * L792-805) and can be switched live via `$translate.use(lang)`
 * (`auth.coffee` L92-94). The React screens reproduce that behavior through
 * `localeBridge.ts`, which loads the active-language bundle ASYNCHRONOUSLY and
 * calls `setTranslations()`. Because that load completes AFTER the React root
 * has already mounted (and can also happen again when the user changes their
 * language), the components that render translated text must re-render when the
 * table changes.
 *
 * `useTranslations()` wires a component into the `translate.ts` change
 * notifications via React's `useSyncExternalStore`. Calling it once at the root
 * of each mounted screen (`KanbanBoard`, `Backlog`) is sufficient: there is NO
 * `React.memo` in the React tree, so a root re-render propagates to every
 * descendant that calls `t()`.
 *
 * The hook returns the current translations version (a monotonically increasing
 * number). Callers typically ignore the value — subscribing for the re-render is
 * the point — but it is returned so a component may use it as a dependency /
 * cache-buster if needed.
 */

import { useSyncExternalStore } from "react";

import { getTranslationsVersion, subscribeToTranslations } from "./translate";

/**
 * Subscribe the calling component to i18n table changes.
 *
 * @returns The current translations version (changes whenever the active
 *          language bundle is swapped via `setTranslations`).
 */
export function useTranslations(): number {
    // Server snapshot === client snapshot: the table is a module singleton, so
    // the same value is safe for any (non-SSR) environment.
    return useSyncExternalStore(
        subscribeToTranslations,
        getTranslationsVersion,
        getTranslationsVersion,
    );
}
