/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the shared page-metadata adapter
 * (app/react/shared/meta/appMeta.ts).
 *
 * Runs in the browserless jsdom environment (jest.config.js). Every test starts
 * from an empty `<head>` so tag creation vs. in-place update can be asserted
 * deterministically. The adapter is a faithful port of the AngularJS
 * `tgAppMetaService` (app/modules/services/app-meta.service.coffee), so these
 * tests pin the same head mutations: the `<title>`, `<meta name="description">`
 * (truncated to 250), and the full Twitter Card + Open Graph tag set
 * (descriptions truncated to 300).
 */

import {
    setAll,
    setDescription,
    setOpenGraphMetas,
    setTitle,
    setTwitterMetas,
    truncate,
} from "./appMeta";

/** Read a `<meta name=...>` content attribute (null when the tag is absent). */
function metaByName(name: string): string | null {
    const el = document.head.querySelector<HTMLMetaElement>(
        `meta[name="${name}"]`,
    );
    return el ? el.getAttribute("content") : null;
}

/** Read a `<meta property=...>` content attribute (null when absent). */
function metaByProperty(property: string): string | null {
    const el = document.head.querySelector<HTMLMetaElement>(
        `meta[property="${property}"]`,
    );
    return el ? el.getAttribute("content") : null;
}

beforeEach(() => {
    // Start every test from a pristine <head> so "created on first use" and
    // "updated in place" can both be asserted without cross-test leakage.
    document.head.innerHTML = "";
    document.title = "";
    (window as unknown as { _version?: unknown })._version = "v-test";
});

afterEach(() => {
    delete (window as unknown as { _version?: unknown })._version;
});

describe("shared/meta/appMeta — truncate (port of taiga.truncate)", () => {
    it("returns short strings unchanged", () => {
        expect(truncate("hello", 10)).toBe("hello");
    });

    it("returns a string exactly at the limit unchanged", () => {
        expect(truncate("hello", 5)).toBe("hello");
    });

    it("truncates at the last word boundary and appends the suffix", () => {
        // length 18 > 10 → substring(0,11)="hello world" → lastIndexOf(' ')=5
        // → substring(0,5)="hello" → + "..." → "hello...".
        expect(truncate("hello world foobar", 10)).toBe("hello...");
    });

    it("collapses to just the suffix when there is no word boundary", () => {
        // No space → lastIndexOf(' ')=-1 → substring(0,0)="" → "...".
        expect(truncate("aaaaaaaaaaaaaaaaaaaa", 5)).toBe("...");
    });

    it("honors a custom suffix", () => {
        expect(truncate("hello world foobar", 10, "…")).toBe("hello…");
    });

    it("passes non-string values through unchanged (CoffeeScript guard)", () => {
        expect(truncate(undefined as unknown as string, 250)).toBeUndefined();
        expect(truncate(null as unknown as string, 250)).toBeNull();
        expect(truncate(123 as unknown as string, 250)).toBe(123);
    });
});

describe("shared/meta/appMeta — setTitle", () => {
    it("sets the document <title> (not truncated)", () => {
        const longTitle = "T".repeat(400);
        setTitle(longTitle);

        expect(document.title).toBe(longTitle);
        expect(document.head.querySelectorAll("title")).toHaveLength(1);
    });

    it("updates the existing <title> in place on repeated calls", () => {
        setTitle("First");
        setTitle("Second");

        expect(document.title).toBe("Second");
        expect(document.head.querySelectorAll("title")).toHaveLength(1);
    });
});

describe("shared/meta/appMeta — setDescription", () => {
    it("sets meta[name=description]", () => {
        setDescription("A short project description.");

        expect(metaByName("description")).toBe("A short project description.");
    });

    it("truncates the description to 250 characters", () => {
        // 300 words of "aa " → far longer than 250 chars; result must be capped.
        const longDescription = `${"word ".repeat(120)}tail`;
        setDescription(longDescription);

        const content = metaByName("description");
        expect(content).not.toBeNull();
        // truncate(…,250) yields at most 250 + suffix ("...") length.
        expect((content as string).length).toBeLessThanOrEqual(253);
        expect(content).toMatch(/\.\.\.$/);
    });

    it("creates a single description tag and updates it in place", () => {
        setDescription("one");
        setDescription("two");

        expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(
            1,
        );
        expect(metaByName("description")).toBe("two");
    });
});

describe("shared/meta/appMeta — setTwitterMetas", () => {
    it("sets the full Twitter Card tag set", () => {
        setTwitterMetas("Kanban - My Project", "The kanban panel.");

        expect(metaByName("twitter:card")).toBe("summary");
        expect(metaByName("twitter:site")).toBe("@taigaio");
        expect(metaByName("twitter:title")).toBe("Kanban - My Project");
        expect(metaByName("twitter:description")).toBe("The kanban panel.");
        expect(metaByName("twitter:image")).toBe(
            `${window.location.origin}/v-test/images/logo-color.png`,
        );
    });

    it("truncates the twitter:description to 300 characters", () => {
        const longDescription = `${"word ".repeat(120)}tail`;
        setTwitterMetas("Title", longDescription);

        const content = metaByName("twitter:description");
        expect(content).not.toBeNull();
        expect((content as string).length).toBeLessThanOrEqual(303);
        expect(content).toMatch(/\.\.\.$/);
    });
});

describe("shared/meta/appMeta — setOpenGraphMetas", () => {
    it("sets the full Open Graph tag set as meta[property=...]", () => {
        setOpenGraphMetas("Backlog - My Project", "The backlog panel.");

        expect(metaByProperty("og:type")).toBe("object");
        expect(metaByProperty("og:site_name")).toBe("Taiga - Love your projects");
        expect(metaByProperty("og:title")).toBe("Backlog - My Project");
        expect(metaByProperty("og:description")).toBe("The backlog panel.");
        expect(metaByProperty("og:image")).toBe(
            `${window.location.origin}/v-test/images/logo-color.png`,
        );
        expect(metaByProperty("og:url")).toBe(window.location.href);
    });

    it("writes og tags with a property attribute (not name)", () => {
        setOpenGraphMetas("T", "D");

        expect(
            document.head.querySelector('meta[property="og:title"]'),
        ).not.toBeNull();
        expect(document.head.querySelector('meta[name="og:title"]')).toBeNull();
    });
});

describe("shared/meta/appMeta — setAll", () => {
    it("sets the title, description, and Twitter + Open Graph metas together", () => {
        setAll("Kanban - My Project", "The kanban panel, with user stories.");

        expect(document.title).toBe("Kanban - My Project");
        expect(metaByName("description")).toBe(
            "The kanban panel, with user stories.",
        );
        expect(metaByName("twitter:title")).toBe("Kanban - My Project");
        expect(metaByProperty("og:title")).toBe("Kanban - My Project");
    });

    it("is idempotent — repeated calls update in place without duplicating tags", () => {
        setAll("Kanban - Project A", "Description A.");
        setAll("Kanban - Project B", "Description B.");

        expect(document.title).toBe("Kanban - Project B");
        expect(document.head.querySelectorAll("title")).toHaveLength(1);
        expect(
            document.head.querySelectorAll('meta[name="description"]'),
        ).toHaveLength(1);
        expect(
            document.head.querySelectorAll('meta[name="twitter:title"]'),
        ).toHaveLength(1);
        expect(
            document.head.querySelectorAll('meta[property="og:title"]'),
        ).toHaveLength(1);
        expect(metaByName("description")).toBe("Description B.");
        expect(metaByName("twitter:title")).toBe("Kanban - Project B");
        expect(metaByProperty("og:title")).toBe("Kanban - Project B");
    });

    it("writes an empty content string for a falsy description rather than 'undefined'", () => {
        setAll("Only Title", "");

        expect(document.title).toBe("Only Title");
        expect(metaByName("description")).toBe("");
        expect(metaByName("twitter:description")).toBe("");
        expect(metaByProperty("og:description")).toBe("");
    });
});
