/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Read-only accessor for the shared session-correlation id.
 *
 * The legacy AngularJS bootstrap creates a single session id ONCE per page
 * load: `taiga.sessionId = taiga.generateUniqueSessionIdentifier()`
 * (app/coffee/app.coffee L26), where `taiga` is assigned at window scope
 * (`@taiga = taiga = {}`, L9) so it is reachable as `window.taiga.sessionId`.
 * AngularJS sends it on every REST request as the `X-Session-Id` header
 * (app/coffee/app.coffee L593, L601) and includes it in the WebSocket auth
 * payload (`data: {token, sessionId}` in app/coffee/modules/events.coffee L243).
 *
 * The React screens MUST reuse this exact value and MUST NEVER mint their own.
 * The events backend uses X-Session-Id to suppress echoing a client's own
 * optimistic changes back to it; a divergent React session id would make the
 * React screen receive and re-apply its OWN updates, producing duplicated /
 * flickering board state. Hence: read verbatim, never generate.
 */

declare global {
    interface Window {
        taiga?: { sessionId?: string } & Record<string, unknown>;
    }
}

/**
 * Returns the shared `window.taiga.sessionId` VERBATIM. Never generates an id:
 * if the AngularJS shell has not populated `window.taiga.sessionId` (for
 * example a jsdom unit test without the shell), returns "" (empty string)
 * rather than synthesizing one.
 */
export const getSessionId = (): string => {
    if (typeof window === "undefined") {
        return "";
    }

    const sessionId = window.taiga?.sessionId;
    return typeof sessionId === "string" ? sessionId : "";
};
