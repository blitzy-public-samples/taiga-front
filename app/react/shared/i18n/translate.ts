/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Framework-agnostic i18n resolver for the React screens.
 *
 * The surviving AngularJS app resolves visible text through `angular-translate`
 * (configured in `app/coffee/app.coffee`: `$translatePartialLoaderProvider`
 * loads the `taiga` locale bundle, `useSanitizeValueStrategy('escapeParameters')`
 * escapes only the interpolated PARAMETERS — not the translation value itself —
 * and `$translateMessageFormatInterpolation` supplies interpolation).
 *
 * To render the IDENTICAL resolved strings the legacy Jade templates produced —
 * a hard requirement for visual/DOM parity — the React tree ships with the same
 * English message bundle (`app/locales/taiga/locale-en.json`) compiled in, and
 * resolves the dotted keys the templates referenced (e.g.
 * `BACKLOG.SUMMARY.PROJECT_POINTS`, `KANBAN.TITLE_ACTION_FOLD`).
 *
 * `setTranslations()` lets the mount bootstrap swap in the runtime-loaded table
 * for the active language (so a non-English deployment resolves correctly)
 * without any component code change; until then the bundled English table is
 * authoritative and deterministic (which the Jest suite relies on).
 *
 * Interpolation mirrors angular-translate's default `{{ name }}` token (spaces
 * tolerated) and also accepts the message-format `{ name }` token, so both
 * `TOTAL_STORIES` ("{{ totalUserStories }} user stories") and any ICU-style
 * key resolve. Missing keys return the key verbatim — the exact
 * angular-translate fallback — so an absent string is visible rather than blank.
 */

// Bundled English message table (visual source of truth). `resolveJsonModule`
// (tsconfig) types this as a deep record; esbuild + ts-jest both inline JSON.
import localeEn from "../../../locales/taiga/locale-en.json";

/** A (possibly nested) translation table as loaded from a locale JSON file. */
export type TranslationTable = { [key: string]: string | TranslationTable };

/** Interpolation parameter bag (values are coerced + escaped before insertion). */
export type TranslateParams = Record<string, string | number | null | undefined>;

/** The active table; defaults to the compiled English bundle. */
let table: TranslationTable = localeEn as unknown as TranslationTable;

/**
 * Flattened `"A.B.C" -> "value"` cache, rebuilt whenever the table changes.
 * Flattening once keeps `t()` O(1) on the hot render path.
 */
let flat: Record<string, string> = {};

/** Recursively flatten a nested translation table into dotted keys. */
function flatten(node: TranslationTable, prefix: string, out: Record<string, string>): void {
    for (const key of Object.keys(node)) {
        const value = node[key];
        const full = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "string") {
            out[full] = value;
        } else if (value && typeof value === "object") {
            flatten(value, full, out);
        }
    }
}

/** Rebuild the flattened cache from the current `table`. */
function rebuild(): void {
    const out: Record<string, string> = {};
    flatten(table, "", out);
    flat = out;
}

rebuild();

/**
 * Replace the active translation table (e.g. with the runtime-loaded bundle for
 * the deployment's active language). Passing a nested table is fine — it is
 * flattened on assignment.
 */
export function setTranslations(next: TranslationTable): void {
    table = next ?? {};
    rebuild();
}

/**
 * Minimal HTML-escape for interpolated parameters, matching angular-translate's
 * `escapeParameters` strategy (the translation VALUE is left intact; only the
 * substituted params are escaped, preventing injected user content from
 * breaking out as markup when a value legitimately carries HTML like `<br/>`).
 */
function escapeParam(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Resolve a dotted translation key to its (interpolated) string.
 *
 * @param key    Dotted key, e.g. `"BACKLOG.SUMMARY.CLOSED_POINTS"`.
 * @param params Optional interpolation values for `{{ token }}` / `{ token }`.
 * @returns      The resolved string, or `key` verbatim when unknown.
 */
export function t(key: string, params?: TranslateParams): string {
    const template = flat[key];
    if (template === undefined) {
        return key;
    }
    if (!params) {
        return template;
    }
    // Replace `{{ name }}` (angular-translate default) and `{ name }`
    // (message-format) tokens; unknown tokens are left untouched.
    return template.replace(/\{\{?\s*([\w.$]+)\s*\}?\}/g, (match, token: string) => {
        const value = params[token];
        if (value === null || value === undefined) {
            return match;
        }
        return escapeParam(String(value));
    });
}

/** Whether a dotted key resolves in the active table. */
export function hasTranslation(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(flat, key);
}
