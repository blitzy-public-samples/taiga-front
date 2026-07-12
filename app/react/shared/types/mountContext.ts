/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Cross-framework bridge payload resolved by the Web-Component adapter
 * (`app/react/bootstrap.ts` -> `readMountContext`) at `connectedCallback` time and
 * passed to each screen as the single `{ context }` prop.
 *
 * LOCKED CONTRACT: field names and types MUST match `bootstrap.ts` byte-for-byte.
 * - projectSlug: from the `project-slug` host attribute or parsed from the
 *   `/project/:pslug/(kanban|backlog)` route (AngularJS app.coffee routes).
 * - token:       JSON-decoded localStorage "token" (AngularJS `$tgStorage`/`auth.coffee`).
 * - sessionId:   reused `window.taiga.sessionId` -> sent as `X-Session-Id`.
 * - apiUrl:      `window.taigaConfig.api`, e.g. "http://localhost:8000/api/v1/".
 * - eventsUrl:   `window.taigaConfig.eventsUrl` (may be absent).
 * - language:    `window.taigaConfig.defaultLanguage`, e.g. "en".
 */
export type MountContext = {
    projectSlug: string | null;
    token: string | null;
    sessionId: string | null;
    apiUrl: string;
    eventsUrl: string | null;
    language: string;
};
