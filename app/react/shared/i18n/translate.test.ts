/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    t,
    setTranslations,
    hasTranslation,
    subscribeToTranslations,
    getTranslationsVersion,
} from "./translate";

describe("shared/i18n/translate", () => {
    // Restore the bundled English table after any test that overrides it.
    const RESTORE = { KANBAN: { SECTION_NAME: "Kanban" } };

    afterEach(() => {
        setTranslations(RESTORE as never);
    });

    it("resolves real dotted keys from the bundled English locale", () => {
        // Reset to the compiled bundle by re-importing is not needed: the module
        // starts with the bundle. These assertions run before any override.
        expect(hasTranslation("BACKLOG.SUMMARY.PROJECT_POINTS")).toBe(true);
        expect(t("BACKLOG.SUMMARY.CLOSED_POINTS")).toBe("closed<br />points");
        expect(t("KANBAN.TITLE_ACTION_FOLD")).toBeTruthy();
    });

    it("returns the key verbatim for an unknown key (angular-translate fallback)", () => {
        expect(t("THIS.KEY.DOES.NOT.EXIST")).toBe("THIS.KEY.DOES.NOT.EXIST");
    });

    it("interpolates {{ token }} (angular-translate default, spaces tolerated)", () => {
        setTranslations({ X: { Y: "{{ totalUserStories }} user stories" } } as never);
        expect(t("X.Y", { totalUserStories: 12 })).toBe("12 user stories");
    });

    it("interpolates { token } (message-format style)", () => {
        setTranslations({ X: { Y: "count { n }" } } as never);
        expect(t("X.Y", { n: 3 })).toBe("count 3");
    });

    it("escapes interpolated parameters (escapeParameters strategy)", () => {
        setTranslations({ X: { Y: "hi {{ q }}" } } as never);
        expect(t("X.Y", { q: "<b>&\"'" })).toBe("hi &lt;b&gt;&amp;&quot;&#39;");
    });

    it("leaves the translation value HTML intact (only params are escaped)", () => {
        setTranslations({ X: { Y: "line<br />break {{ q }}" } } as never);
        expect(t("X.Y", { q: "x" })).toBe("line<br />break x");
    });

    it("leaves unknown tokens untouched", () => {
        setTranslations({ X: { Y: "{{ known }} {{ unknown }}" } } as never);
        expect(t("X.Y", { known: "A" })).toBe("A {{ unknown }}");
    });
});

describe("shared/i18n/translate — change subscription (M5)", () => {
    const RESTORE = { KANBAN: { SECTION_NAME: "Kanban" } };
    afterEach(() => {
        setTranslations(RESTORE as never);
    });

    it("notifies subscribers and bumps the version when the table is swapped", () => {
        const listener = jest.fn();
        const before = getTranslationsVersion();
        const unsubscribe = subscribeToTranslations(listener);

        setTranslations({ X: { Y: "hi" } } as never);

        expect(listener).toHaveBeenCalledTimes(1);
        expect(getTranslationsVersion()).toBe(before + 1);
        unsubscribe();
    });

    it("stops notifying after unsubscribe", () => {
        const listener = jest.fn();
        const unsubscribe = subscribeToTranslations(listener);
        unsubscribe();

        setTranslations({ X: { Y: "hi" } } as never);

        expect(listener).not.toHaveBeenCalled();
    });

    it("supports multiple independent subscribers", () => {
        const a = jest.fn();
        const b = jest.fn();
        const unsubA = subscribeToTranslations(a);
        const unsubB = subscribeToTranslations(b);

        setTranslations({ X: { Y: "hi" } } as never);

        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
        unsubA();
        unsubB();
    });
});
