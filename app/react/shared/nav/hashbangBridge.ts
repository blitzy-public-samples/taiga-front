/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Pre-bootstrap hashbang -> HTML5 URL compatibility bridge (review finding M24).
 *
 * The surviving AngularJS 1.5.10 application runs in HTML5 push-state mode
 * (`$locationProvider.html5Mode({enabled: true, requireBase: true})`,
 * `app/coffee/app.coffee` L588), so every AUTHORITATIVE in-app route is a plain
 * pathname (`/project/<slug>/kanban`, `/project/<slug>/backlog`). Those
 * authoritative HTML5 paths already route correctly and mount the React hosts
 * (`<tg-react-kanban>` / `<tg-react-backlog>`).
 *
 * However, legacy / checkpoint ENTRY POINTS still arrive as AngularJS hashbang
 * URLs (`#!/project/<slug>/kanban`) — browser bookmarks, the Home dashboard's
 * project links, and QA acceptance checkpoints. In html5Mode AngularJS does NOT
 * reliably rewrite an inbound `#!` hashbang to its pathname before the initial
 * `$route` resolves, so the app stays on Home, the routed template (which hosts
 * the `<tg-react-*>` Custom Element) is never rendered, and the React screen
 * therefore never mounts (finding M24).
 *
 * This bridge normalizes an inbound `#!` route hashbang to the equivalent HTML5
 * pathname via `history.replaceState` BEFORE `angular.bootstrap(document,
 * ["taiga"])` runs. The react-screens bundle (whose entry is
 * `app/react/index.tsx`) is loaded ahead of `app.js` by
 * `app-loader/app-loader.coffee` (order `elements.js` -> `react-screens.js` ->
 * `app.js`), so invoking {@link applyHashbangCompatibility} at bundle-evaluation
 * time guarantees the browser location is already an HTML5 path by the time
 * AngularJS bootstraps and resolves the first route.
 *
 * Design constraints honoured (Technical Specification AAP §0.6.1; Minimal
 * Change Clause §0.7.2):
 *   - Changes NO frozen Angular route — `app/coffee/app.coffee` is untouched;
 *     the bridge only normalizes the inbound browser URL, exactly what
 *     AngularJS's own (unreliable in html5Mode) hashbang fallback intends.
 *   - Activates ONLY for unambiguous AngularJS route hashbangs (the hash begins
 *     with the default 1.5 `!` hashPrefix followed by an absolute path), so
 *     genuine in-page `#anchor` fragments used by other, out-of-scope screens
 *     are NEVER rewritten.
 *   - Uses `replaceState` (never `assign`/`push`) so it adds no spurious history
 *     entry, and is a strict no-op on normal HTML5 navigation (the common case).
 *
 * @see AAP §0.6.1 — Coexistence Mounting Mechanism / cross-framework navigation.
 */

/**
 * Compute the HTML5 pathname (with any query the hashbang carried) that an
 * inbound hashbang URL should be rewritten to, or `null` when no rewrite
 * applies. Pure and side-effect-free so it can be unit-tested directly against
 * a synthetic `Location`-like object.
 *
 * Taiga hashbang routes carry their query string INSIDE the hash
 * (`#!/project/<slug>/backlog?milestone=5`), so slicing the `!` prefix off the
 * raw hash preserves the deep-link parameters verbatim.
 *
 * @param loc - A `Location`-like object exposing `hash`.
 * @returns The target `"/path[?query]"`, or `null` when the hash is not an
 *          AngularJS route hashbang.
 */
export function hashbangRewriteTarget(loc: { hash: string }): string | null {
    const hash = loc.hash ?? "";
    // The AngularJS 1.5 default hashPrefix is `!`, so a genuine route hash looks
    // like `#!/project/...`. Requiring the leading `!/` guarantees we never
    // touch a plain `#anchor` in-page fragment.
    if (!hash.startsWith("#!/")) {
        return null;
    }
    // Strip the leading `#!`; the remainder is the intended absolute pathname
    // (plus any `?query` the hashbang carried).
    const target = hash.slice(2);
    // Defensive: a route target must be an absolute path.
    return target.startsWith("/") ? target : null;
}

/**
 * Apply the hashbang -> HTML5 compatibility rewrite to the live `window`, before
 * AngularJS bootstraps. Safe to call in any environment: it no-ops when
 * `window` / `history` are unavailable or when no route hashbang is present, and
 * is naturally idempotent (a successful `replaceState` clears the hash, so a
 * second call finds nothing to do).
 */
export function applyHashbangCompatibility(): void {
    if (typeof window === "undefined" || typeof window.history === "undefined") {
        return;
    }
    const target = hashbangRewriteTarget(window.location);
    if (target === null) {
        return;
    }
    try {
        // Preserve any existing history state; only the URL changes.
        window.history.replaceState(window.history.state, "", target);
    } catch {
        // Some embedded / sandboxed contexts forbid `replaceState`; fall back to
        // a hard location replace so the correct HTML5 route still loads without
        // leaving a spurious history entry.
        window.location.replace(target);
    }
}
