/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { getSessionId } from "./sessionId";

describe("shared/session/sessionId", () => {
    afterEach(() => {
        delete window.taiga;
    });

    it("returns window.taiga.sessionId verbatim", () => {
        window.taiga = { sessionId: "abc" };

        expect(getSessionId()).toBe("abc");
    });

    it("does NOT generate/mint an id when window.taiga is absent", () => {
        delete window.taiga;

        expect(getSessionId()).toBe("");
    });

    it("returns '' when window.taiga exists but sessionId is missing", () => {
        window.taiga = {};

        expect(getSessionId()).toBe("");
    });

    it("reuses the exact shared value on repeated calls (never regenerates)", () => {
        window.taiga = { sessionId: "shared-session-xyz" };

        const first = getSessionId();
        const second = getSessionId();

        expect(first).toBe("shared-session-xyz");
        expect(second).toBe("shared-session-xyz");
        expect(first).toBe(second);
    });
});
