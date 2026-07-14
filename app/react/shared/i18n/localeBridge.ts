/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * localeBridge.ts
 *
 * Runtime i18n bridge (M5). It resolves the deployment's ACTIVE language exactly
 * as the surviving AngularJS app does and loads the matching message bundle into
 * the framework-agnostic resolver (`translate.ts` -> `setTranslations`), so the
 * React screens render the SAME localized strings AngularJS produces — a hard
 * requirement for visual/DOM parity in non-English deployments.
 *
 * WHY: `app.coffee` (L792-805) computes
 *   `preferedLangCode = JSON.parse(localStorage.userInfo)?.lang
 *        || window.taigaConfig.defaultLanguage || "en"`
 * and configures `angular-translate` with the loader URL template
 *   `window._version + "/locales/{part}/locale-{lang}.json"`  (part = "taiga")
 * plus `fallbackLanguage("en")`. The language can also change at runtime
 * (`$translate.use(lang)` in `auth.coffee` L92-94), at which point the app sets
 * the `<html lang>` attribute. This module reproduces all three behaviors:
 *   1. resolve the active language from the SAME sources and precedence;
 *   2. load its bundle asynchronously and publish it via `setTranslations`;
 *   3. watch `<html lang>` and re-load when the language changes live.
 *
 * ISOLATION: no AngularJS import. It reads only the shared browser globals
 * (`localStorage`, `window.taigaConfig`, `window._version`, `document`) the two
 * frameworks already share, and `fetch` for the bundle — exactly the seam the
 * AAP's coexistence model prescribes (Section 0.6.1).
 *
 * The compiled English bundle is imported so that switching BACK to English (or
 * starting in English) resolves instantly WITHOUT a network round-trip — English
 * is the fallback language and is always available.
 */

import localeEn from "../../../locales/taiga/locale-en.json";
import { setTranslations, type TranslationTable } from "./translate";

/** `window._version` asset prefix (e.g. "/v-1710"); "" under jsdom / tests. */
function versionPrefix(): string {
    return (window as unknown as { _version?: string })._version ?? "";
}

/**
 * Resolve the active language code using the EXACT precedence AngularJS uses
 * (`app.coffee` L796): the logged-in user's stored preference wins, then the
 * deployment default, then hard-coded English.
 *
 * `localStorage.userInfo` is a single `JSON.stringify` of the user object (as
 * written by `auth.coffee` via `$tgStorage.set`); a missing key or malformed
 * value falls through to the next source, mirroring the `?.`/`||` chain.
 *
 * @returns A BCP-47-ish language code such as `"en"`, `"es"`, `"pt-br"`.
 */
export function resolveActiveLanguage(): string {
    try {
        const raw = localStorage.getItem("userInfo");
        if (raw !== null) {
            const parsed: unknown = JSON.parse(raw);
            const lang = (parsed as { lang?: unknown } | null)?.lang;
            if (typeof lang === "string" && lang.length > 0) {
                return lang;
            }
        }
    } catch {
        // Malformed userInfo — fall through to the deployment default.
    }

    const cfg =
        (window as unknown as { taigaConfig?: Record<string, unknown> })
            .taigaConfig ?? {};
    const def = cfg.defaultLanguage;
    if (typeof def === "string" && def.length > 0) {
        return def;
    }

    return "en";
}

/** Build the locale bundle URL, mirroring the AngularJS loader `urlTemplate`. */
function localeUrl(lang: string): string {
    return `${versionPrefix()}/locales/taiga/locale-${lang}.json`;
}

/**
 * The language whose bundle is currently loaded (or in flight). Guards against
 * redundant re-loads when `<html lang>` mutates without a real language change.
 */
let loadedLanguage: string | null = null;

/**
 * Load and publish the message bundle for `lang`. English resolves synchronously
 * from the compiled bundle (fallback language, always present); every other
 * language is fetched. A failed fetch leaves the current table intact — English
 * remains the visible fallback, exactly like `angular-translate`'s
 * `fallbackLanguage("en")`.
 *
 * @param lang - The language code to activate.
 */
export async function loadLanguage(lang: string): Promise<void> {
    loadedLanguage = lang;

    if (lang === "en") {
        setTranslations(localeEn as unknown as TranslationTable);
        return;
    }

    try {
        const response = await fetch(localeUrl(lang), {
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            // Keep the English fallback visible (do not blank the UI).
            return;
        }
        const table = (await response.json()) as TranslationTable;
        // Ignore a stale response if the language changed again mid-flight.
        if (loadedLanguage === lang) {
            setTranslations(table);
        }
    } catch {
        // Network / parse failure -> retain the current (fallback) table.
    }
}

/** Guards `startLocaleBridge` against double-initialization. */
let started = false;
/** The live `<html lang>` observer, retained so tests can stop the bridge. */
let htmlLangObserver: MutationObserver | null = null;

/**
 * Start the runtime locale bridge. Idempotent — safe to call once from the React
 * entry (`index.tsx`). Loads the initial active language, then watches the
 * `<html lang>` attribute (which AngularJS updates on a live language switch) and
 * re-loads the bundle whenever it changes.
 *
 * @returns A `stop()` function that disconnects the observer and resets the
 *   guard — primarily for deterministic teardown in unit tests.
 */
export function startLocaleBridge(): () => void {
    if (started) {
        return stopLocaleBridge;
    }
    started = true;

    // 1. Initial language.
    void loadLanguage(resolveActiveLanguage());

    // 2. React to live language switches. AngularJS sets `<html lang>` to the
    //    active code on `$translate.use`; treat that attribute as the signal.
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
        htmlLangObserver = new MutationObserver(() => {
            const htmlLang = document.documentElement.getAttribute("lang");
            const next =
                htmlLang !== null && htmlLang.length > 0
                    ? htmlLang
                    : resolveActiveLanguage();
            if (next !== loadedLanguage) {
                void loadLanguage(next);
            }
        });
        htmlLangObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["lang"],
        });
    }

    return stopLocaleBridge;
}

/** Disconnect the `<html lang>` observer and reset the start guard (tests). */
export function stopLocaleBridge(): void {
    if (htmlLangObserver !== null) {
        htmlLangObserver.disconnect();
        htmlLangObserver = null;
    }
    started = false;
    loadedLanguage = null;
}
