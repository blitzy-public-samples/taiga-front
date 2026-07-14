/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the M24 pre-bootstrap hashbang -> HTML5 URL compatibility
 * bridge (`hashbangBridge.ts`). The surviving AngularJS app runs in html5Mode,
 * so authoritative routes are plain pathnames; these tests prove that an inbound
 * legacy/checkpoint `#!/project/<slug>/{kanban,backlog}` hashbang is normalized
 * to its HTML5 pathname (so the routed template that hosts the `<tg-react-*>`
 * element renders and the React screen mounts), while genuine in-page `#anchor`
 * fragments and normal HTML5 navigation are left completely untouched.
 *
 * Conventions (matching the sibling shared specs):
 *   - Ambient Jest globals (`describe`/`it`/`expect`) — no imports.
 *   - `ts-jest` + `jsdom`; jsdom fully implements `history.replaceState` and
 *     keeps `window.location` in sync, so the live-window behaviour is asserted
 *     directly. Each live test resets to a clean HTML5 root in `afterEach`.
 */

import { hashbangRewriteTarget, applyHashbangCompatibility } from "./hashbangBridge";

describe("hashbangRewriteTarget (M24 — pure)", () => {
    it("maps a project route hashbang to its authoritative HTML5 pathname", () => {
        expect(hashbangRewriteTarget({ hash: "#!/project/foo/kanban" })).toBe(
            "/project/foo/kanban",
        );
        expect(hashbangRewriteTarget({ hash: "#!/project/foo/backlog" })).toBe(
            "/project/foo/backlog",
        );
    });

    it("preserves a deep-link query string carried inside the hash", () => {
        expect(
            hashbangRewriteTarget({ hash: "#!/project/foo/backlog?milestone=5" }),
        ).toBe("/project/foo/backlog?milestone=5");
    });

    it("normalizes the bare root hashbang `#!/` to `/`", () => {
        expect(hashbangRewriteTarget({ hash: "#!/" })).toBe("/");
    });

    it("returns null for a plain in-page anchor fragment", () => {
        expect(hashbangRewriteTarget({ hash: "#section-2" })).toBeNull();
        expect(hashbangRewriteTarget({ hash: "#comment-42" })).toBeNull();
    });

    it("returns null for an empty hash (authoritative HTML5 navigation)", () => {
        expect(hashbangRewriteTarget({ hash: "" })).toBeNull();
    });

    it("returns null for a bang hash that is not an absolute route", () => {
        expect(hashbangRewriteTarget({ hash: "#!foo" })).toBeNull();
    });
});

describe("applyHashbangCompatibility (M24 — live window)", () => {
    afterEach(() => {
        // Reset to a clean HTML5 root so tests are order-independent.
        window.history.replaceState(null, "", "/");
    });

    it("rewrites an inbound `#!` route hashbang to the HTML5 pathname and clears the hash", () => {
        window.history.replaceState(null, "", "/#!/project/foo/kanban");
        expect(window.location.hash).toBe("#!/project/foo/kanban");

        applyHashbangCompatibility();

        expect(window.location.pathname).toBe("/project/foo/kanban");
        expect(window.location.hash).toBe("");
    });

    it("preserves a deep-link query carried in the hashbang", () => {
        window.history.replaceState(null, "", "/#!/project/foo/backlog?milestone=5");

        applyHashbangCompatibility();

        expect(window.location.pathname).toBe("/project/foo/backlog");
        expect(window.location.search).toBe("?milestone=5");
        expect(window.location.hash).toBe("");
    });

    it("leaves a plain in-page anchor untouched (no rewrite)", () => {
        window.history.replaceState(null, "", "/project/foo/kanban#section-2");

        applyHashbangCompatibility();

        expect(window.location.pathname).toBe("/project/foo/kanban");
        expect(window.location.hash).toBe("#section-2");
    });

    it("is a strict no-op on normal HTML5 navigation (no hash)", () => {
        window.history.replaceState(null, "", "/project/foo/backlog");

        applyHashbangCompatibility();

        expect(window.location.pathname).toBe("/project/foo/backlog");
        expect(window.location.hash).toBe("");
    });

    it("is idempotent (a second call finds nothing to rewrite)", () => {
        window.history.replaceState(null, "", "/#!/project/foo/kanban");

        applyHashbangCompatibility();
        const afterFirst = window.location.pathname;
        applyHashbangCompatibility();

        expect(window.location.pathname).toBe(afterFirst);
        expect(window.location.pathname).toBe("/project/foo/kanban");
        expect(window.location.hash).toBe("");
    });
});
