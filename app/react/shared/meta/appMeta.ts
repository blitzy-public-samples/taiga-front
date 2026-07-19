/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Shared page-metadata adapter for the React Kanban and Backlog roots.
 *
 * Faithful, dependency-free reimplementation of the AngularJS `tgAppMetaService`
 * (`app/modules/services/app-meta.service.coffee`). The migrated
 * `KanbanController` / `BacklogController` used that service to set the browser
 * tab title and the document meta tags once the project resolved
 * (`appMetaService.setAll(title, description)` — kanban/main.coffee L117-122,
 * backlog/main.coffee L105-110). The React ports dropped this behavior, which
 * left the tab title stuck on the static `index.html` default ("Taiga") and,
 * after an AngularJS → React SPA transition, stale on the previous route's
 * title (QA finding F-001).
 *
 * Coexistence / shared-DOM contract: the React roots run INSIDE the living
 * AngularJS 1.5 document (mounted via the `tg-react-kanban` / `tg-react-backlog`
 * custom elements after `angular.bootstrap`). This adapter therefore writes to
 * the SAME `<head>` the AngularJS `tgAppMetaService` wrote to — there is ONE
 * document, ONE `<title>`, and ONE set of meta tags shared across both
 * frameworks. Following the same "read/write the globals the AngularJS shell
 * already establishes" pattern used by {@link ../session/sessionId} and
 * {@link ../config/taigaConfig}, it does not introduce a second head-management
 * mechanism; the callers simply invoke {@link setAll} when the project resolves,
 * exactly where the AngularJS controllers did.
 *
 * Behavioral fidelity: the `<head>` mutations are byte-for-byte identical to the
 * original service — the same `<title>`, `<meta name="description">` (truncated
 * to 250), and the full Twitter Card + Open Graph tag set (descriptions
 * truncated to 300) with the same literal values. The original used jQuery
 * (`$("head ...")`); this port uses native DOM APIs so the React bundle keeps NO
 * jQuery dependency while producing the identical resulting markup.
 *
 * jsdom / SSR safety: every function is a no-op when `document`/`window` are
 * unavailable (a pre-bootstrap call, or the browserless unit-test environment
 * that has no `<head>` mutation to make), so it never throws. It also never
 * calls `console.error`, honoring the strict console-hygiene guard used by the
 * React test suite.
 */

/** Literal Twitter `site` handle, matching the AngularJS service. */
const TWITTER_SITE = "@taigaio";

/** Literal Open Graph `site_name`, matching the AngularJS service. */
const OG_SITE_NAME = "Taiga - Love your projects";

/** `<meta name="description">` length cap (AngularJS `setDescription`). */
const DESCRIPTION_MAX_LENGTH = 250;

/** Twitter/Open Graph description length cap (AngularJS card metas). */
const CARD_DESCRIPTION_MAX_LENGTH = 300;

/**
 * Port of `taiga.truncate` (`app/coffee/utils.coffee` L129).
 *
 * Returns the value unchanged when it is not a string or is already within
 * `maxLength`. Otherwise it trims to the last whole word that fits inside
 * `maxLength + 1` characters and appends `suffix`. Non-string inputs are passed
 * through verbatim (mirroring the CoffeeScript guard) so a missing description
 * degrades to an empty meta value downstream rather than throwing.
 */
export function truncate(
    str: string,
    maxLength: number,
    suffix = "...",
): string {
    if (typeof str !== "string") {
        // Mirror the CoffeeScript `return str if (typeof str != "string") ...`.
        return str;
    }

    let out = str.slice(0);

    if (out.length > maxLength) {
        out = out.substring(0, maxLength + 1);
        out = out.substring(0, Math.min(out.length, out.lastIndexOf(" ")));
        out = out + suffix;
    }

    return out;
}

/** True when a live DOM document is available to mutate. */
function hasDocument(): boolean {
    return typeof document !== "undefined" && document !== null;
}

/** Resolve the `<head>` element, or `null` when unavailable. */
function getHead(): HTMLHeadElement | null {
    if (!hasDocument()) {
        return null;
    }
    return document.head ?? document.getElementsByTagName("head")[0] ?? null;
}

/**
 * Build the card image URL, mirroring the AngularJS
 * `"#{window.location.origin}/#{window._version}/images/logo-color.png"`.
 * `window._version` is read via a local cast (the same convention used by
 * `kanban/Card.tsx`) so this module needs no global `Window` augmentation.
 */
function logoImageUrl(): string {
    if (typeof window === "undefined") {
        return "";
    }
    const origin = window.location?.origin ?? "";
    const version =
        (window as unknown as { _version?: unknown })._version ?? "";
    return `${origin}/${String(version)}/images/logo-color.png`;
}

/** Current page URL, mirroring the AngularJS `window.location.href`. */
function currentHref(): string {
    if (typeof window === "undefined") {
        return "";
    }
    return window.location?.href ?? "";
}

/**
 * Low-level setter mirroring `AppMetaService._set(key, value)`:
 *   - `key === "title"`      → the `<head><title>` text content.
 *   - `key` starts `"og:"`   → `<meta property="{key}">`.
 *   - otherwise              → `<meta name="{key}">`.
 * The target element is created and appended to `<head>` on first use, then
 * updated in place on subsequent calls (so repeated `setAll` invocations never
 * duplicate tags). No-ops when `key` is falsy or no document/head exists.
 */
function setMeta(key: string, value: string): void {
    if (!key) {
        return;
    }
    const head = getHead();
    if (!head) {
        return;
    }

    // Mirror the CoffeeScript `meta.attr("content", value or "")` — a falsy
    // value writes an empty string rather than the literal "undefined"/"null".
    const content = value || "";

    if (key === "title") {
        let title = head.querySelector("title");
        if (!title) {
            title = document.createElement("title");
            head.appendChild(title);
        }
        title.textContent = content;
        return;
    }

    const isOpenGraph = key.indexOf("og:") === 0;
    const selector = isOpenGraph
        ? `meta[property="${key}"]`
        : `meta[name="${key}"]`;
    let meta = head.querySelector<HTMLMetaElement>(selector);
    if (!meta) {
        meta = document.createElement("meta");
        if (isOpenGraph) {
            meta.setAttribute("property", key);
        } else {
            meta.setAttribute("name", key);
        }
        head.appendChild(meta);
    }
    meta.setAttribute("content", content);
}

/** Set the document `<title>` (not truncated). Port of `setTitle`. */
export function setTitle(title: string): void {
    setMeta("title", title);
}

/**
 * Set `<meta name="description">`, truncated to 250 chars. Port of
 * `setDescription`.
 */
export function setDescription(description: string): void {
    setMeta("description", truncate(description, DESCRIPTION_MAX_LENGTH));
}

/**
 * Set the Twitter Card metas (`summary` card, `@taigaio` site, title, 300-char
 * description, logo image). Port of `setTwitterMetas`.
 */
export function setTwitterMetas(title: string, description: string): void {
    setMeta("twitter:card", "summary");
    setMeta("twitter:site", TWITTER_SITE);
    setMeta("twitter:title", title);
    setMeta(
        "twitter:description",
        truncate(description, CARD_DESCRIPTION_MAX_LENGTH),
    );
    setMeta("twitter:image", logoImageUrl());
}

/**
 * Set the Open Graph metas (`object` type, site name, title, 300-char
 * description, logo image, current URL). Port of `setOpenGraphMetas`.
 */
export function setOpenGraphMetas(title: string, description: string): void {
    setMeta("og:type", "object");
    setMeta("og:site_name", OG_SITE_NAME);
    setMeta("og:title", title);
    setMeta(
        "og:description",
        truncate(description, CARD_DESCRIPTION_MAX_LENGTH),
    );
    setMeta("og:image", logoImageUrl());
    setMeta("og:url", currentHref());
}

/**
 * Set the full page metadata from a `title` / `description` pair — the exact
 * composition of `AppMetaService.setAll`: `<title>`, description meta, Twitter
 * Card metas, and Open Graph metas. This is the single entry point the React
 * Kanban / Backlog roots call once their project resolves.
 */
export function setAll(title: string, description: string): void {
    setTitle(title);
    setDescription(description);
    setTwitterMetas(title, description);
    setOpenGraphMetas(title, description);
}
