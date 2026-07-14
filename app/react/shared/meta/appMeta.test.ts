/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import {
    truncate,
    setTitle,
    setDescription,
    setAll,
    snapshotManagedMeta,
    restoreManagedMeta,
} from "./appMeta";

/** Read the current document title text. */
function titleText(): string {
    return document.head.querySelector("title")?.textContent ?? "";
}

/** Read a `meta[name=...]` / `meta[property=...]` content, or null if absent. */
function metaContent(selector: string): string | null {
    const el = document.head.querySelector(selector);
    return el ? el.getAttribute("content") : null;
}

describe("appMeta.truncate (legacy taiga.truncate parity)", () => {
    it("returns short strings unchanged", () => {
        expect(truncate("hello", 250)).toBe("hello");
    });

    it("cuts at the last space at or before the limit and appends the suffix", () => {
        // "aaaa bbbb cccc" is 14 chars; limit 8 -> keep up to index 9 ("aaaa bbbb"),
        // then trim back to the last space -> "aaaa" + "...".
        expect(truncate("aaaa bbbb cccc", 8)).toBe("aaaa...");
    });

    it("honors a custom suffix", () => {
        expect(truncate("aaaa bbbb cccc", 8, "\u2026")).toBe("aaaa\u2026");
    });

    it("passes non-strings through unchanged", () => {
        // Deliberate wrong type to mirror the CoffeeScript guard.
        expect(truncate(undefined as unknown as string, 10)).toBeUndefined();
    });
});

describe("appMeta.setTitle / setDescription", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
    });

    it("creates and updates the <title> element", () => {
        setTitle("Kanban - Alpha");
        expect(document.head.querySelectorAll("title")).toHaveLength(1);
        expect(titleText()).toBe("Kanban - Alpha");
        setTitle("Kanban - Beta");
        expect(document.head.querySelectorAll("title")).toHaveLength(1);
        expect(titleText()).toBe("Kanban - Beta");
    });

    it("creates meta[name=description] truncated to 250 chars", () => {
        const long = "word ".repeat(100).trim(); // 499 chars
        setDescription(long);
        const value = metaContent("meta[name='description']");
        expect(value).not.toBeNull();
        expect((value as string).length).toBeLessThanOrEqual(253); // 250 + "..."
        expect((value as string).endsWith("...")).toBe(true);
    });
});

describe("appMeta.setAll (full head block parity)", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
    });

    it("writes the title, description, twitter and open-graph blocks", () => {
        setAll("Kanban - Alpha", "A board for project Alpha");

        expect(titleText()).toBe("Kanban - Alpha");
        expect(metaContent("meta[name='description']")).toBe("A board for project Alpha");

        expect(metaContent("meta[name='twitter:card']")).toBe("summary");
        expect(metaContent("meta[name='twitter:site']")).toBe("@taigaio");
        expect(metaContent("meta[name='twitter:title']")).toBe("Kanban - Alpha");
        expect(metaContent("meta[name='twitter:description']")).toBe("A board for project Alpha");
        expect(metaContent("meta[name='twitter:image']")).toContain("/images/logo-color.png");

        expect(metaContent("meta[property='og:type']")).toBe("object");
        expect(metaContent("meta[property='og:site_name']")).toBe("Taiga - Love your projects");
        expect(metaContent("meta[property='og:title']")).toBe("Kanban - Alpha");
        expect(metaContent("meta[property='og:description']")).toBe("A board for project Alpha");
        expect(metaContent("meta[property='og:image']")).toContain("/images/logo-color.png");
        expect(metaContent("meta[property='og:url']")).not.toBeNull();
    });

    it("uses property= for og:* keys and name= for the rest", () => {
        setAll("T", "D");
        // og:* must NOT be addressable as name=, and twitter:* must NOT be property=.
        expect(document.head.querySelector("meta[name='og:title']")).toBeNull();
        expect(document.head.querySelector("meta[property='twitter:title']")).toBeNull();
    });
});

describe("appMeta snapshot / restore (unmount cleanup — M22)", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
    });

    it("restores a pre-existing title and description to their prior values", () => {
        // Seed the head the way index.jade does (a <title> + description).
        const title = document.createElement("title");
        title.textContent = "Taiga";
        document.head.appendChild(title);
        const desc = document.createElement("meta");
        desc.setAttribute("name", "description");
        desc.setAttribute("content", "original description");
        document.head.appendChild(desc);

        const snapshot = snapshotManagedMeta();
        setAll("Kanban - Alpha", "board description");
        expect(titleText()).toBe("Kanban - Alpha");
        expect(metaContent("meta[name='description']")).toBe("board description");

        restoreManagedMeta(snapshot);
        expect(titleText()).toBe("Taiga");
        expect(metaContent("meta[name='description']")).toBe("original description");
    });

    it("removes tags that did not exist before the screen created them", () => {
        // No twitter/og tags in the head initially.
        expect(document.head.querySelector("meta[property='og:title']")).toBeNull();

        const snapshot = snapshotManagedMeta();
        setAll("Kanban - Alpha", "board description");
        expect(document.head.querySelector("meta[property='og:title']")).not.toBeNull();
        expect(document.head.querySelector("meta[name='twitter:card']")).not.toBeNull();

        restoreManagedMeta(snapshot);
        expect(document.head.querySelector("meta[property='og:title']")).toBeNull();
        expect(document.head.querySelector("meta[name='twitter:card']")).toBeNull();
        expect(document.head.querySelector("meta[name='twitter:image']")).toBeNull();
    });

    it("restores cleanly across a simulated slug change (set A -> restore -> set B -> restore)", () => {
        const title = document.createElement("title");
        title.textContent = "Taiga";
        document.head.appendChild(title);

        const snapA = snapshotManagedMeta();
        setAll("Kanban - Alpha", "alpha");
        expect(titleText()).toBe("Kanban - Alpha");

        restoreManagedMeta(snapA);
        expect(titleText()).toBe("Taiga");

        const snapB = snapshotManagedMeta();
        setAll("Kanban - Beta", "beta");
        expect(titleText()).toBe("Kanban - Beta");

        restoreManagedMeta(snapB);
        expect(titleText()).toBe("Taiga");
        // No orphaned managed tags remain.
        expect(document.head.querySelector("meta[property='og:title']")).toBeNull();
    });
});
