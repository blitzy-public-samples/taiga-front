/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Framework-agnostic reproduction of the legacy AngularJS `tgAppMetaService`
 * (`app/modules/services/app-meta.service.coffee`) `setAll` behavior, extracted
 * so the migrated React screens set the SAME document `<title>` and `<head>`
 * meta tags the legacy `KanbanController` / `BacklogController` set on load.
 *
 * The controllers called `appMetaService.setAll(title, description)` inside
 * `firstLoad().then` (kanban `main.coffee` L112-125; backlog `main.coffee`),
 * with the titles/descriptions resolved from `KANBAN.PAGE_TITLE` /
 * `KANBAN.PAGE_DESCRIPTION` (and the BACKLOG equivalents). React set NO title at
 * all, so the browser tab kept whatever the previous AngularJS screen wrote
 * (M22: "React routes leave generic/stale titles").
 *
 * Parity notes (byte-for-byte with the CoffeeScript service):
 *   - `setTitle`       -> the `<head><title>` element text.
 *   - `setDescription` -> `<meta name="description">`, value truncated to 250.
 *   - `setTwitterMetas`-> twitter:card / site / title / description(300) / image.
 *   - `setOpenGraphMetas` -> og:type / site_name / title / description(300) /
 *                            image / url.
 *   - `setAll`         -> title + description + twitter + open-graph, in order.
 * The `_set` element-creation rules (create-if-absent; `og:` keys -> `property=`
 * attribute; every other key -> `name=`; the `title` key -> the `<title>`
 * element) are reproduced exactly so the resulting `<head>` DOM matches.
 *
 * The migration adds ONE lifecycle affordance the legacy service lacked: the
 * React screen mounts/unmounts as a custom element inside the surviving
 * AngularJS shell, so the caller SNAPSHOTS the managed tags before writing them
 * and RESTORES that snapshot on unmount / route (slug) change. This keeps the
 * tab title from going stale when navigating from the React board/backlog to an
 * AngularJS screen, WITHOUT editing the frozen router (AAP 0.2.2) — the
 * AngularJS controllers still overwrite on their own load, so restore is a safe
 * superset of the legacy behavior, not a contract change.
 */

/** Suffix of the branding image used for twitter:image / og:image. */
const BRAND_IMAGE_SUFFIX = "/images/logo-color.png";

/**
 * Legacy `taiga.truncate` (`app/coffee/utils.coffee` L129): if the string is
 * longer than `maxLength`, cut at the last space at or before `maxLength + 1`
 * and append `suffix`. Non-strings pass through unchanged.
 */
export function truncate(str: string, maxLength: number, suffix = "..."): string {
    if (typeof str !== "string") {
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

/** Which kind of head node a managed key maps to (mirrors `_set`). */
type MetaKind = "title" | "name" | "property";

interface ManagedKey {
    key: string;
    kind: MetaKind;
}

/**
 * The exact set of `<head>` nodes `setAll` writes, in write order. Used by the
 * snapshot/restore helpers so cleanup on unmount touches precisely the tags the
 * React screen created or overwrote — nothing else in `<head>`.
 */
const MANAGED_KEYS: ManagedKey[] = [
    { key: "title", kind: "title" },
    { key: "description", kind: "name" },
    { key: "twitter:card", kind: "name" },
    { key: "twitter:site", kind: "name" },
    { key: "twitter:title", kind: "name" },
    { key: "twitter:description", kind: "name" },
    { key: "twitter:image", kind: "name" },
    { key: "og:type", kind: "property" },
    { key: "og:site_name", kind: "property" },
    { key: "og:title", kind: "property" },
    { key: "og:description", kind: "property" },
    { key: "og:image", kind: "property" },
    { key: "og:url", kind: "property" },
];

/**
 * `window.location.origin` + the versioned asset prefix (`window._version`),
 * mirroring the legacy `"#{window.location.origin}/#{window._version}/…"`
 * construction. `_version` defaults to "" (e.g. under jsdom).
 */
function versionedOrigin(): string {
    const version = (window as unknown as { _version?: string })._version ?? "";
    return `${window.location.origin}/${version}`;
}

/** Reproduce `_set`: title -> <title>; `og:*` -> meta[property]; else meta[name]. */
function setMeta(key: string, value: string): void {
    if (!key) {
        return;
    }
    const head = document.head;
    if (key === "title") {
        let el = head.querySelector("title");
        if (!el) {
            el = document.createElement("title");
            head.appendChild(el);
        }
        el.textContent = value || "";
        return;
    }
    const attr = key.indexOf("og:") === 0 ? "property" : "name";
    let el = head.querySelector<HTMLMetaElement>(`meta[${attr}='${key}']`);
    if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        head.appendChild(el);
    }
    el.setAttribute("content", value || "");
}

/** `setTitle` — write the document `<title>`. */
export function setTitle(title: string): void {
    setMeta("title", title);
}

/** `setDescription` — write `<meta name="description">` (truncated to 250). */
export function setDescription(description: string): void {
    setMeta("description", truncate(description, 250));
}

/** `setTwitterMetas` — the twitter-card meta block. */
export function setTwitterMetas(title: string, description: string): void {
    setMeta("twitter:card", "summary");
    setMeta("twitter:site", "@taigaio");
    setMeta("twitter:title", title);
    setMeta("twitter:description", truncate(description, 300));
    setMeta("twitter:image", `${versionedOrigin()}${BRAND_IMAGE_SUFFIX}`);
}

/** `setOpenGraphMetas` — the Open Graph meta block. */
export function setOpenGraphMetas(title: string, description: string): void {
    setMeta("og:type", "object");
    setMeta("og:site_name", "Taiga - Love your projects");
    setMeta("og:title", title);
    setMeta("og:description", truncate(description, 300));
    setMeta("og:image", `${versionedOrigin()}${BRAND_IMAGE_SUFFIX}`);
    setMeta("og:url", window.location.href);
}

/** Legacy `setAll` — title + description + twitter + open-graph, in that order. */
export function setAll(title: string, description: string): void {
    setTitle(title);
    setDescription(description);
    setTwitterMetas(title, description);
    setOpenGraphMetas(title, description);
}

/** A single captured managed-tag value (or its absence). */
interface ManagedMetaEntry {
    key: string;
    kind: MetaKind;
    existed: boolean;
    value: string | null;
}

/** An opaque snapshot of every tag `setAll` manages, for later restoration. */
export interface ManagedMetaSnapshot {
    entries: ManagedMetaEntry[];
}

/** Capture the current value (or absence) of every tag `setAll` manages. */
export function snapshotManagedMeta(): ManagedMetaSnapshot {
    const entries = MANAGED_KEYS.map(({ key, kind }): ManagedMetaEntry => {
        if (kind === "title") {
            const el = document.head.querySelector("title");
            return { key, kind, existed: el != null, value: el ? el.textContent : null };
        }
        const attr = kind === "property" ? "property" : "name";
        const el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}='${key}']`);
        return { key, kind, existed: el != null, value: el ? el.getAttribute("content") : null };
    });
    return { entries };
}

/**
 * Restore a snapshot: reset tags that existed before to their prior value, and
 * remove tags the screen created (that did not exist at snapshot time).
 */
export function restoreManagedMeta(snapshot: ManagedMetaSnapshot): void {
    for (const entry of snapshot.entries) {
        if (entry.kind === "title") {
            const el = document.head.querySelector("title");
            if (entry.existed) {
                if (el) {
                    el.textContent = entry.value ?? "";
                }
            } else if (el) {
                el.remove();
            }
            continue;
        }
        const attr = entry.kind === "property" ? "property" : "name";
        const el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}='${entry.key}']`);
        if (entry.existed) {
            if (el) {
                el.setAttribute("content", entry.value ?? "");
            }
        } else if (el) {
            el.remove();
        }
    }
}
