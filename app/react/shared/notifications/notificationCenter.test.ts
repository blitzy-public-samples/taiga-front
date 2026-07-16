/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Unit suite for the framework-agnostic notification bus that surfaces
// recoverable failures to the user (QA finding [ERR-1]). The bus is pure
// pub/sub — no React, no DOM, no console — so it is asserted directly.

import {
    clearNotificationListeners,
    notify,
    notifyError,
    notifyInfo,
    notifySuccess,
    subscribeNotifications,
} from "./notificationCenter";
import type { AppNotification } from "./notificationCenter";

afterEach(() => {
    clearNotificationListeners();
});

describe("shared/notifications/notificationCenter", () => {
    it("delivers an emitted notification to a subscriber", () => {
        const received: AppNotification[] = [];
        subscribeNotifications((n) => received.push(n));

        const emitted = notifyError("boom");

        expect(received).toHaveLength(1);
        expect(received[0]).toBe(emitted);
        expect(received[0].level).toBe("error");
        expect(received[0].message).toBe("boom");
    });

    it("assigns strictly increasing, unique ids", () => {
        const a = notify("info", "a");
        const b = notify("info", "b");
        const c = notify("info", "c");

        expect(b.id).toBeGreaterThan(a.id);
        expect(c.id).toBeGreaterThan(b.id);
        expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    });

    it("maps the convenience helpers to the right levels", () => {
        expect(notifyError("x").level).toBe("error");
        expect(notifySuccess("x").level).toBe("success");
        expect(notifyInfo("x").level).toBe("info");
    });

    it("fans out to every subscriber", () => {
        const first: string[] = [];
        const second: string[] = [];
        subscribeNotifications((n) => first.push(n.message));
        subscribeNotifications((n) => second.push(n.message));

        notify("success", "hi");

        expect(first).toEqual(["hi"]);
        expect(second).toEqual(["hi"]);
    });

    it("stops delivering after unsubscribe (idempotent unsubscribe)", () => {
        const received: string[] = [];
        const unsubscribe = subscribeNotifications((n) => received.push(n.message));

        notify("info", "one");
        unsubscribe();
        unsubscribe(); // second call is a harmless no-op
        notify("info", "two");

        expect(received).toEqual(["one"]);
    });

    it("does not deliver the in-flight event to a listener added during dispatch", () => {
        const late: string[] = [];
        subscribeNotifications(() => {
            // Subscribe a second listener WHILE the first is being dispatched.
            subscribeNotifications((n) => late.push(n.message));
        });

        notify("info", "first"); // late listener must NOT see "first"
        expect(late).toEqual([]);

        notify("info", "second"); // now it does
        expect(late).toEqual(["second"]);
    });

    it("isolates a throwing subscriber so others still receive the event", () => {
        const good: string[] = [];
        subscribeNotifications(() => {
            throw new Error("subscriber blew up");
        });
        subscribeNotifications((n) => good.push(n.message));

        // Must not throw out of notify(), and the good listener still runs.
        expect(() => notify("error", "resilient")).not.toThrow();
        expect(good).toEqual(["resilient"]);
    });

    it("clearNotificationListeners removes every subscriber", () => {
        const received: string[] = [];
        subscribeNotifications((n) => received.push(n.message));

        clearNotificationListeners();
        notify("info", "after-clear");

        expect(received).toEqual([]);
    });
});
