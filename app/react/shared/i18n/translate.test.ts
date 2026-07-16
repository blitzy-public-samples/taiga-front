/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { t, __resetTranslateCacheForTests, type TranslateParams } from "./translate";

/**
 * Install a fake `window.angular` whose injector exposes a `$translate` service
 * backed by `table`. Mirrors the angular-translate `instant(key, params)`
 * contract: returns the key itself when it is missing (as the real service does
 * via its missing-translation handler), and interpolates `{{ name }}`
 * placeholders from the supplied params.
 */
function installAngularTranslate(table: Record<string, string>): void {
    const instant = (key: string, params?: Record<string, unknown>): string => {
        const template = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
        if (!params) {
            return template;
        }
        return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, name: string) =>
            Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m,
        );
    };
    const injector = {
        has: (name: string) => name === "$translate",
        get: (name: string) => (name === "$translate" ? { instant } : undefined),
    };
    (window as unknown as { angular?: unknown }).angular = {
        element: () => ({ injector: () => injector }),
    };
}

function uninstallAngular(): void {
    delete (window as unknown as { angular?: unknown }).angular;
}

describe("shared/i18n/translate", () => {
    afterEach(() => {
        uninstallAngular();
        __resetTranslateCacheForTests();
    });

    describe("without AngularJS (jsdom / pre-bootstrap)", () => {
        it("returns the English fallback verbatim when there are no params", () => {
            expect(t("BACKLOG.SECTION_NAME", "Scrum")).toBe("Scrum");
        });

        it("interpolates {{ name }} placeholders into the fallback", () => {
            expect(
                t("BACKLOG.TOTAL_STORIES", "{{ totalUserStories }} user stories", {
                    totalUserStories: 3,
                }),
            ).toBe("3 user stories");
        });

        it("interpolates unspaced {{name}} placeholders too", () => {
            expect(
                t("US.OPTIONS_LABEL", "Points: {{points}}", { points: 5 }),
            ).toBe("Points: 5");
        });

        it("leaves unknown placeholders untouched", () => {
            expect(t("X.Y", "Hi {{missing}}", { other: 1 })).toBe("Hi {{missing}}");
        });

        it("does not crash when window.angular is a malformed object", () => {
            (window as unknown as { angular?: unknown }).angular = {};
            expect(t("BACKLOG.DOOMLINE", "Project Scope [Doomline]")).toBe(
                "Project Scope [Doomline]",
            );
        });
    });

    describe("with AngularJS present", () => {
        it("returns the localized string from the live catalog (no params)", () => {
            installAngularTranslate({ "BACKLOG.SECTION_NAME": "Scrum-ES" });
            expect(t("BACKLOG.SECTION_NAME", "Scrum")).toBe("Scrum-ES");
        });

        it("localizes AND interpolates via the recovered template", () => {
            installAngularTranslate({
                "BACKLOG.TOTAL_STORIES": "{{ totalUserStories }} historias de usuario",
            });
            expect(
                t("BACKLOG.TOTAL_STORIES", "{{ totalUserStories }} user stories", {
                    totalUserStories: 7,
                }),
            ).toBe("7 historias de usuario");
        });

        it("falls back to English when the key is missing from the catalog", () => {
            installAngularTranslate({ "SOME.OTHER.KEY": "irrelevant" });
            expect(
                t("BACKLOG.ERROR_MOVE_US", "Could not save the new order. Please try again."),
            ).toBe("Could not save the new order. Please try again.");
        });

        it("inserts user content verbatim (React escapes at render, no double-escape)", () => {
            installAngularTranslate({
                "US.DRAG_BUTTON_LABEL": "Reorder user story #{{ref}} {{subject}}",
            });
            const params: TranslateParams = { ref: 1, subject: 'A & B <x>' };
            expect(t("US.DRAG_BUTTON_LABEL", "Reorder user story #{{ref}} {{subject}}", params)).toBe(
                "Reorder user story #1 A & B <x>",
            );
        });

        it("memoizes the resolved service across calls", () => {
            installAngularTranslate({ "COMMON.SAVE": "Guardar" });
            expect(t("COMMON.SAVE", "Save")).toBe("Guardar");
            // Remove Angular: a memoized service keeps returning the localized value.
            uninstallAngular();
            expect(t("COMMON.SAVE", "Save")).toBe("Guardar");
        });

        it("re-attempts resolution until AngularJS becomes available", () => {
            // First call: no Angular -> English fallback, nothing cached.
            expect(t("COMMON.CANCEL", "Cancel")).toBe("Cancel");
            // Angular appears later (post-bootstrap) -> localized.
            installAngularTranslate({ "COMMON.CANCEL": "Cancelar" });
            expect(t("COMMON.CANCEL", "Cancel")).toBe("Cancelar");
        });
    });
});
