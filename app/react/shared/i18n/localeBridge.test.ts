/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the runtime i18n locale bridge (review finding M5).
 *
 * These tests assert BEHAVIOR through the real `translate.ts` resolver (rather
 * than by mocking `setTranslations`): after a bundle is published, the dotted
 * keys resolve to the published values, exactly as the React screens observe
 * them at runtime. No React component is mounted here, so `setTranslations`
 * notifies zero subscribers and cannot trip the M10 fail-on-console guard.
 */

import {
    resolveActiveLanguage,
    loadLanguage,
    startLocaleBridge,
    stopLocaleBridge,
} from "./localeBridge";
import { t, hasTranslation, setTranslations } from "./translate";
import localeEn from "../../../locales/taiga/locale-en.json";

/** A minimal `fetch` Response shape sufficient for the bridge. */
interface FakeResponse {
    ok: boolean;
    json: () => Promise<unknown>;
}

/** Build a manually-resolvable promise, for deterministic race ordering. */
function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Flush pending micro/macrotasks so fire-and-forget loads settle. */
async function flush(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
}

describe("shared/i18n/localeBridge (M5)", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        stopLocaleBridge();
        localStorage.clear();
        delete (window as unknown as { taigaConfig?: unknown }).taigaConfig;
        delete (window as unknown as { _version?: unknown })._version;
        document.documentElement.removeAttribute("lang");
        // Start each test from a deterministic NON-English sentinel table so we
        // can positively detect when a bundle is (or is not) published.
        setTranslations({ MARK: { LANG: "sentinel" } } as never);
    });

    afterEach(() => {
        stopLocaleBridge();
        localStorage.clear();
        delete (window as unknown as { taigaConfig?: unknown }).taigaConfig;
        delete (window as unknown as { _version?: unknown })._version;
        document.documentElement.removeAttribute("lang");
        global.fetch = originalFetch;
        // Restore the compiled English table for any subsequent test file hygiene.
        setTranslations(localeEn as never);
    });

    describe("resolveActiveLanguage — precedence (app.coffee L796 parity)", () => {
        it("prefers the logged-in user's stored language (userInfo.lang)", () => {
            localStorage.setItem("userInfo", JSON.stringify({ lang: "es" }));
            (window as unknown as { taigaConfig: Record<string, unknown> }).taigaConfig = {
                defaultLanguage: "fr",
            };
            expect(resolveActiveLanguage()).toBe("es");
        });

        it("falls back to the deployment default when there is no userInfo", () => {
            (window as unknown as { taigaConfig: Record<string, unknown> }).taigaConfig = {
                defaultLanguage: "fr",
            };
            expect(resolveActiveLanguage()).toBe("fr");
        });

        it("falls back to English when neither source provides a language", () => {
            expect(resolveActiveLanguage()).toBe("en");
        });

        it("treats malformed userInfo as absent and uses the default", () => {
            localStorage.setItem("userInfo", "not-json{");
            (window as unknown as { taigaConfig: Record<string, unknown> }).taigaConfig = {
                defaultLanguage: "de",
            };
            expect(resolveActiveLanguage()).toBe("de");
        });

        it("skips an empty userInfo.lang and uses the default", () => {
            localStorage.setItem("userInfo", JSON.stringify({ lang: "" }));
            (window as unknown as { taigaConfig: Record<string, unknown> }).taigaConfig = {
                defaultLanguage: "it",
            };
            expect(resolveActiveLanguage()).toBe("it");
        });

        it("skips userInfo without a lang field and uses the default", () => {
            localStorage.setItem("userInfo", JSON.stringify({ name: "x" }));
            (window as unknown as { taigaConfig: Record<string, unknown> }).taigaConfig = {
                defaultLanguage: "pt-br",
            };
            expect(resolveActiveLanguage()).toBe("pt-br");
        });
    });

    describe("loadLanguage — publish / fallback / stale-guard", () => {
        it("resolves English SYNCHRONOUSLY from the compiled bundle (no fetch)", async () => {
            const fetchMock = jest.fn();
            global.fetch = fetchMock as unknown as typeof fetch;

            await loadLanguage("en");

            expect(fetchMock).not.toHaveBeenCalled();
            // The real English bundle is now active; the sentinel is gone.
            expect(t("KANBAN.SECTION_NAME")).toBe("Kanban");
            expect(hasTranslation("MARK.LANG")).toBe(false);
        });

        it("fetches a non-English bundle and publishes it (version-prefixed URL)", async () => {
            (window as unknown as { _version: string })._version = "/v-test";
            const fetchMock = jest.fn(
                (): Promise<FakeResponse> =>
                    Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({ KANBAN: { SECTION_NAME: "Kanban-ES" } }),
                    }),
            );
            global.fetch = fetchMock as unknown as typeof fetch;

            await loadLanguage("es");

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock).toHaveBeenCalledWith(
                "/v-test/locales/taiga/locale-es.json",
                { headers: { Accept: "application/json" } },
            );
            expect(t("KANBAN.SECTION_NAME")).toBe("Kanban-ES");
        });

        it("keeps the current (fallback) table when the fetch is not ok", async () => {
            const fetchMock = jest.fn(
                (): Promise<FakeResponse> =>
                    Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({}),
                    }),
            );
            global.fetch = fetchMock as unknown as typeof fetch;

            await loadLanguage("es");

            expect(fetchMock).toHaveBeenCalledTimes(1);
            // Sentinel table untouched — the UI keeps showing the prior language.
            expect(t("MARK.LANG")).toBe("sentinel");
        });

        it("keeps the current table when the fetch rejects (no throw)", async () => {
            const fetchMock = jest.fn(
                (): Promise<FakeResponse> => Promise.reject(new Error("network")),
            );
            global.fetch = fetchMock as unknown as typeof fetch;

            await expect(loadLanguage("es")).resolves.toBeUndefined();
            expect(t("MARK.LANG")).toBe("sentinel");
        });

        it("ignores a STALE response when the language changed mid-flight", async () => {
            const esD = deferred<FakeResponse>();
            const frD = deferred<FakeResponse>();
            const fetchMock = jest.fn((url: string): Promise<FakeResponse> => {
                if (url.includes("locale-es.json")) return esD.promise;
                if (url.includes("locale-fr.json")) return frD.promise;
                return Promise.reject(new Error("unexpected url"));
            });
            global.fetch = fetchMock as unknown as typeof fetch;

            const p1 = loadLanguage("es"); // loadedLanguage = "es"
            const p2 = loadLanguage("fr"); // loadedLanguage = "fr" (supersedes es)

            // Resolve the SUPERSEDED es response and the winning fr response.
            esD.resolve({
                ok: true,
                json: () => Promise.resolve({ KANBAN: { SECTION_NAME: "ES-stale" } }),
            });
            frD.resolve({
                ok: true,
                json: () => Promise.resolve({ KANBAN: { SECTION_NAME: "FR-fresh" } }),
            });
            await p1;
            await p2;

            // fr won; the stale es table was discarded.
            expect(t("KANBAN.SECTION_NAME")).toBe("FR-fresh");
        });
    });

    describe("startLocaleBridge / stopLocaleBridge — lifecycle + <html lang> watch", () => {
        it("loads the initial active language on start", async () => {
            (window as unknown as { taigaConfig: Record<string, unknown> }).taigaConfig = {
                defaultLanguage: "es",
            };
            const fetchMock = jest.fn(
                (): Promise<FakeResponse> =>
                    Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({ KANBAN: { SECTION_NAME: "Kanban-ES" } }),
                    }),
            );
            global.fetch = fetchMock as unknown as typeof fetch;

            startLocaleBridge();
            await flush();

            expect(fetchMock).toHaveBeenCalledWith(
                "/locales/taiga/locale-es.json",
                { headers: { Accept: "application/json" } },
            );
            expect(t("KANBAN.SECTION_NAME")).toBe("Kanban-ES");
        });

        it("is idempotent — a second start does not reload", async () => {
            (window as unknown as { taigaConfig: Record<string, unknown> }).taigaConfig = {
                defaultLanguage: "es",
            };
            const fetchMock = jest.fn(
                (): Promise<FakeResponse> =>
                    Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ KANBAN: { SECTION_NAME: "ES" } }),
                    }),
            );
            global.fetch = fetchMock as unknown as typeof fetch;

            startLocaleBridge();
            await flush();
            startLocaleBridge(); // second call — guarded
            await flush();

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("re-loads when <html lang> changes to a new language", async () => {
            // Start in English (no fetch), then simulate AngularJS $translate.use.
            const fetchMock = jest.fn(
                (): Promise<FakeResponse> =>
                    Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({ KANBAN: { SECTION_NAME: "Kanban-FR" } }),
                    }),
            );
            global.fetch = fetchMock as unknown as typeof fetch;

            startLocaleBridge();
            await flush();
            expect(fetchMock).not.toHaveBeenCalled(); // en resolved from bundle

            document.documentElement.setAttribute("lang", "fr");
            await flush();

            expect(fetchMock).toHaveBeenCalledWith(
                "/locales/taiga/locale-fr.json",
                { headers: { Accept: "application/json" } },
            );
            expect(t("KANBAN.SECTION_NAME")).toBe("Kanban-FR");
        });

        it("stops watching after stopLocaleBridge (no reload on further changes)", async () => {
            const fetchMock = jest.fn(
                (): Promise<FakeResponse> =>
                    Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ KANBAN: { SECTION_NAME: "X" } }),
                    }),
            );
            global.fetch = fetchMock as unknown as typeof fetch;

            startLocaleBridge();
            await flush();
            stopLocaleBridge();

            document.documentElement.setAttribute("lang", "fr");
            await flush();

            expect(fetchMock).not.toHaveBeenCalled();
        });
    });
});
