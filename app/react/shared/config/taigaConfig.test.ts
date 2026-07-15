/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    getApiUrl,
    getEventsUrl,
    getEventsMaxMissedHeartbeats,
    getEventsHeartbeatIntervalTime,
    getDefaultLanguage,
    getThemes,
    getDefaultTheme,
    getBaseHref,
    getConfig,
} from "./taigaConfig";

const DEFAULT_THEMES = ["taiga", "taiga-legacy", "material-design", "high-contrast"];

describe("taigaConfig adapter", () => {
    const originalConfig = window.taigaConfig;

    afterEach(() => {
        // Restore whatever the environment provided (jsdom leaves this undefined).
        window.taigaConfig = originalConfig;
    });

    describe("when window.taigaConfig is not set", () => {
        beforeEach(() => {
            window.taigaConfig = undefined;
        });

        it("returns the documented defaults for every getter", () => {
            expect(getApiUrl()).toBe("http://localhost:8000/api/v1/");
            expect(getEventsUrl()).toBeNull();
            expect(getEventsMaxMissedHeartbeats()).toBe(5);
            expect(getEventsHeartbeatIntervalTime()).toBe(60000);
            expect(getDefaultLanguage()).toBe("en");
            expect(getThemes()).toEqual(DEFAULT_THEMES);
            expect(getDefaultTheme()).toBe("taiga");
            expect(getBaseHref()).toBe("/");
        });

        it("getConfig() returns a fully populated default configuration", () => {
            expect(getConfig()).toEqual({
                api: "http://localhost:8000/api/v1/",
                eventsUrl: null,
                eventsMaxMissedHeartbeats: 5,
                eventsHeartbeatIntervalTime: 60000,
                defaultLanguage: "en",
                themes: DEFAULT_THEMES,
                defaultTheme: "taiga",
                baseHref: "/",
            });
        });
    });

    describe("when window.taigaConfig provides values", () => {
        beforeEach(() => {
            window.taigaConfig = {
                api: "https://api.example.com/api/v1/",
                eventsUrl: "wss://events.example.com",
                eventsMaxMissedHeartbeats: 9,
                eventsHeartbeatIntervalTime: 12345,
                defaultLanguage: "es",
                themes: ["material-design"],
                defaultTheme: "material-design",
                baseHref: "/taiga/",
                debug: true,
            };
        });

        it("returns the configured values from window.taigaConfig", () => {
            expect(getApiUrl()).toBe("https://api.example.com/api/v1/");
            expect(getEventsUrl()).toBe("wss://events.example.com");
            expect(getEventsMaxMissedHeartbeats()).toBe(9);
            expect(getEventsHeartbeatIntervalTime()).toBe(12345);
            expect(getDefaultLanguage()).toBe("es");
            expect(getThemes()).toEqual(["material-design"]);
            expect(getDefaultTheme()).toBe("material-design");
            expect(getBaseHref()).toBe("/taiga/");
        });

        it("getConfig() carries through non-required keys alongside the typed ones", () => {
            const config = getConfig();

            expect(config.api).toBe("https://api.example.com/api/v1/");
            expect(config.debug).toBe(true);
        });
    });

    describe("lazy evaluation", () => {
        it("reflects mutations made to window.taigaConfig after module import", () => {
            window.taigaConfig = { api: "https://first.example.com/api/v1/" };
            expect(getApiUrl()).toBe("https://first.example.com/api/v1/");

            window.taigaConfig = { api: "https://second.example.com/api/v1/" };
            expect(getApiUrl()).toBe("https://second.example.com/api/v1/");
        });
    });

    describe("partial configuration", () => {
        beforeEach(() => {
            window.taigaConfig = { api: "https://partial.example.com/api/v1/" };
        });

        it("uses the provided key and falls back to defaults for the rest", () => {
            expect(getApiUrl()).toBe("https://partial.example.com/api/v1/");
            expect(getDefaultLanguage()).toBe("en");
            expect(getThemes()).toEqual(DEFAULT_THEMES);
        });

        it("getConfig() merges the provided value over the defaults", () => {
            const config = getConfig();

            expect(config.api).toBe("https://partial.example.com/api/v1/");
            expect(config.baseHref).toBe("/");
            expect(config.defaultTheme).toBe("taiga");
        });
    });

    describe("malformed values", () => {
        beforeEach(() => {
            window.taigaConfig = {
                api: 123 as unknown as string,
                themes: ["ok", 5] as unknown as string[],
                eventsMaxMissedHeartbeats: "nope" as unknown as number,
            };
        });

        it("falls back to defaults when a value has the wrong type", () => {
            expect(getApiUrl()).toBe("http://localhost:8000/api/v1/");
            expect(getThemes()).toEqual(DEFAULT_THEMES);
            expect(getEventsMaxMissedHeartbeats()).toBe(5);
        });
    });

    describe("explicit null events URL", () => {
        beforeEach(() => {
            window.taigaConfig = { eventsUrl: null };
        });

        it("preserves an explicitly null eventsUrl (events disabled)", () => {
            expect(getEventsUrl()).toBeNull();
        });
    });
});
